"use client";

// ============================================================================
// VideoInterviewSession — Sonru-style asynchronous video interview.
//
// Per-question flow:
//   Question card → Preparation countdown (30s) → Recording countdown (3s)
//   → Record (max 2min, with live preview + audio meter + live transcript)
//   → Pause/Resume/Stop/Re-record/Delete → Review (playback + transcript)
//   → AI Analysis (evaluateAnswer with real transcript + WPM + filler count)
//   → Skip / Previous / Next → Final Report.
//
// Reuses: useDeviceCheck + useMediaRecorder + useSpeechRecognition + useFillerWordDetector
// (Phase 1 + Sonru extensions), evaluateAnswer (Phase 3), generateHiringRecommendation
// (final report), and the existing design system. Recordings are stored in
// IndexedDB (src/lib/interview/storage.ts); only metadata reaches the store/cloud.
//
// Sonru-spec features implemented here:
//   ✓ Webcam preview  ✓ Camera recording  ✓ Microphone recording
//   ✓ Video timer  ✓ Countdown timer  ✓ Preparation time
//   ✓ Retry rules (re-record)  ✓ Next/Previous/Skip
//   ✓ Fullscreen mode  ✓ Recording status  ✓ Audio level visualization
//   ✓ Video quality validation  ✓ Microphone + Camera permission handling
//   ✓ Browser compatibility banner  ✓ Mobile responsive
//   ✓ Live transcript  ✓ Filler-word / WPM signals to AI
//   ✓ Final report (hiring recommendation + ATS readiness)
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import {
  useDeviceCheck,
  useMediaRecorder,
  useAudioMeter,
  useSpeechRecognition,
  analyzeFillerWords,
  normalizeWpmToScore,
  normalizeFillerCountToScore,
} from "@/hooks/interview";
import { formatDuration, formatRemaining } from "@/hooks/interview/format";
import {
  evaluateAnswer,
  generateHiringRecommendation,
  buildInterviewMatchScore,
  type AnswerEvaluation,
  type VideoDerivedMetrics,
  type InterviewFinalReport,
  type InterviewMatchScore,
  type GeneratedPackage,
  type GeneratedQuestion,
} from "@/lib/interview/ai";
import { saveRecording, getRecordingObjectURL, deleteRecordingBlob, deleteRecordingMeta } from "@/lib/interview/storage";
import { uid } from "@/lib/store";
import { toast } from "sonner";
import type { InterviewRecordingMeta } from "@/hooks/interview/types";
import type { InterviewPackage, ResumeData, JobDescription } from "@/lib/types";

const PREP_MS = 30_000;
const REC_COUNTDOWN_MS = 3_000;
const MAX_REC_MS = 120_000;
// Minimum recommended capture quality (Sonru "Video quality validation").
const MIN_VIDEO_WIDTH = 640;
const MIN_VIDEO_FPS = 24;

type Phase = "prep" | "countdown" | "recording" | "review" | "analyzing" | "analysis" | "final-report";

interface QuestionRecording {
  meta?: InterviewRecordingMeta;
  objectUrl?: string;
  evaluation?: AnswerEvaluation;
  transcript?: string;
  /** Marked true when the user skipped this question without recording. */
  skipped?: boolean;
}

interface VideoSessionProps {
  pkg: InterviewPackage;
  resume?: ResumeData;
  jd?: JobDescription;
  generated?: GeneratedPackage;
  onClose: () => void;
  onComplete?: (
    sessionId: string,
    records: InterviewRecordingMeta[],
    finalReport?: InterviewFinalReport
  ) => void;
}

export function VideoInterviewSession({ pkg, resume, jd, generated, onClose, onComplete }: VideoSessionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const questions = (pkg.questions ?? []) as GeneratedQuestion[];
  const total = questions.length;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("prep");
  const [prepRemaining, setPrepRemaining] = useState(PREP_MS);
  const [recCountdown, setRecCountdown] = useState(REC_COUNTDOWN_MS);
  const [recordings, setRecordings] = useState<Record<string, QuestionRecording>>({});
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [finalReport, setFinalReport] = useState<InterviewFinalReport | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  // Camera activation state — drives the inline preview + retry button shown
  // during prep & countdown. The camera is requested as soon as the session
  // mounts (not deferred to recording start) so the user sees themselves and
  // can verify the device works without leaving for the Device Check tab.
  const [cameraActivating, setCameraActivating] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Incremented every time a new stream is successfully acquired so that the
  // re-bind useEffect below has a *reactive* dependency to trigger on.
  const [streamKey, setStreamKey] = useState(0);

  const { snapshot: deviceSnapshot, getStream, requestCameraAndMic, stopPreview } = useDeviceCheck({
    videoRef,
    enablePreview: false, // we manage the stream manually so it persists across phases
  });

  // Preview audio meter — runs during prep & countdown so the user can verify
  // their mic is picking up sound BEFORE the recording starts. The recorder
  // has its own internal meter that takes over once recording begins.
  const previewMeter = useAudioMeter(0.08);
  const { start: startMeter, stop: stopMeter } = previewMeter;

  // Live transcript for the active recording. Reset whenever we move to a new
  // question or start a new recording.
  const speech = useSpeechRecognition({ continuous: true, interimResults: false });
  const { start: startSpeech, stop: stopSpeech, reset: resetSpeech } = speech;

  const sessionId = useMemo(() => uid("sess"), []);
  const current = questions[currentIndex];
  const isLast = currentIndex === total - 1;
  const currentRec = recordings[current?.id ?? ""];
  const percent = Math.round(((currentIndex + 1) / Math.max(total, 1)) * 100);

  // ---- derived: video quality warning ---------------------------------------
  const videoQualityWarning = useMemo(() => {
    const caps = deviceSnapshot.previewCapabilities;
    if (!caps) return null;
    const issues: string[] = [];
    if (caps.width > 0 && caps.width < MIN_VIDEO_WIDTH) {
      issues.push(`Low resolution (${caps.width}×${caps.height}). Recommend ≥640×480.`);
    }
    if (caps.fps > 0 && caps.fps < MIN_VIDEO_FPS) {
      issues.push(`Low frame rate (${caps.fps} fps). Recommend ≥24 fps.`);
    }
    return issues.length ? issues.join(" ") : null;
  }, [deviceSnapshot.previewCapabilities]);

  // ---- derived: browser compatibility banner --------------------------------
  const compatWarning = useMemo(() => {
    const c = deviceSnapshot.compatibility;
    if (!c.secureContext) {
      return "This page is not in a secure context (https:// or localhost). Camera and microphone will not work.";
    }
    if (!c.mediaDevices || !c.getUserMedia) {
      return "This browser does not support navigator.mediaDevices. Use an up-to-date Chrome, Edge, Safari, or Firefox.";
    }
    if (!c.mediaRecorder) {
      return "This browser does not support MediaRecorder. Recording will be unavailable.";
    }
    return null;
  }, [deviceSnapshot.compatibility]);

  // ---- ensure camera+mic stream when entering recording -------------------
  const ensureStream = useCallback(async () => {
    let stream = getStream();
    if (!stream || stream.getVideoTracks().length === 0) {
      stream = await requestCameraAndMic();
    }
    return stream;
  }, [getStream, requestCameraAndMic]);

  // ---- activate camera early so the user sees a live preview during prep --
  // This is the fix for the "no video frame during prep/countdown" issue: the
  // camera is requested as soon as the session mounts AND whenever we move to
  // a new question (which resets to the prep phase). The stream is attached to
  // videoRef by useDeviceCheck, and the <video> element is rendered in all
  // three phases (prep / countdown / recording) below. The same stream is
  // reused by recorder.start() so there is no flicker between phases.
  const activateCamera = useCallback(async () => {
    setCameraActivating(true);
    setCameraError(null);
    try {
      const stream = await requestCameraAndMic();
      if (!stream) {
        // deviceSnapshot.error may not be updated yet — show a generic message.
        setCameraError("Camera/microphone access failed. Check browser permissions and retry.");
      } else {
        // Bump streamKey so the re-bind effect fires even if phase hasn't changed.
        setStreamKey((k) => k + 1);
        // Start the preview audio meter so the user can see mic input live.
        startMeter(stream);
      }
    } catch (e: any) {
      setCameraError(e?.message || "Could not activate camera.");
    } finally {
      setCameraActivating(false);
    }
  }, [requestCameraAndMic, startMeter]);

  // Activate the camera on mount AND whenever we transition back to the prep
  // phase (e.g. when moving to the next question). The effect is gated on
  // `phase === "prep"` so it doesn't re-request mid-recording.
  useEffect(() => {
    if (phase !== "prep") return;
    // If we already have a live stream (e.g. user navigated back), just
    // re-attach the preview meter; don't re-request permission.
    const existing = getStream();
    if (existing && existing.getVideoTracks().length > 0) {
      startMeter(existing);
      // Still bump streamKey so the re-bind effect below fires for the newly
      // mounted <video> element that appeared when we returned to prep.
      setStreamKey((k) => k + 1);
      return;
    }
    // First mount or stream was stopped — request fresh.
    void activateCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex]); // intentionally excludes activateCamera/getStream/startMeter

  // Re-bind the already-acquired stream to whichever <video> element is
  // currently mounted. Because the <video> is conditionally rendered per
  // phase (prep / countdown / recording), React unmounts the old element and
  // mounts a fresh one with srcObject === null on every phase change. The
  // stream is only attached inside requestCameraAndMic on first request, so
  // without this the new element stays black.
  //
  // IMPORTANT: `streamKey` is the reactive signal. It increments whenever a
  // new stream is acquired (inside activateCamera). `phase` ensures we also
  // re-run when the <video> is remounted due to a phase transition. `getStream`
  // is a stable function ref and is NOT a useful dependency here.
  useEffect(() => {
    const el = videoRef.current;
    const stream = getStream();
    if (!el || !stream) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
      el.muted = true;
    }
    // play() can fail silently under strict autoplay policies; retry once after
    // a short tick to allow the browser to paint the element first.
    const tryPlay = () =>
      el.play().catch(() => {
        setTimeout(() => el.play().catch(() => {}), 200);
      });
    tryPlay();
  }, [phase, currentIndex, streamKey, getStream]);

  // ---- when a recording is finalized --------------------------------------
  const onRecorderComplete = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number) => {
      const q = questions[currentIndex];
      if (!q) return;
      // Stop speech recognition and freeze the transcript.
      stopSpeech();
      // Stop the preview meter (recorder has its own).
      stopMeter();
      const transcript = speech.transcript.trim();
      const id = uid("rec");
      const meta: InterviewRecordingMeta = {
        id,
        sessionId,
        questionId: q.id,
        questionNumber: currentIndex + 1,
        resumeId: resume?.id,
        jdId: jd?.id,
        mimeType: mimeType || blob.type,
        sizeBytes: blob.size,
        durationMs,
        createdAt: new Date().toISOString(),
      };
      try {
        await saveRecording(meta, blob);
        const objectUrl = URL.createObjectURL(blob);
        setRecordings((prev) => ({ ...prev, [q.id]: { meta, objectUrl, transcript } }));
        setPhase("review");
      } catch (e: any) {
        setError(e?.message || "Failed to save recording.");
      }
    },
    [currentIndex, questions, jd?.id, resume?.id, sessionId, stopSpeech, stopMeter, speech]
  );

  const recorder = useMediaRecorder({ maxDurationMs: MAX_REC_MS, onComplete: onRecorderComplete });

  const startRecording = useCallback(async () => {
    try {
      const stream = await ensureStream();
      if (!stream) {
        setError("Camera/microphone unavailable. Run the device check first.");
        return;
      }
      // Stop the preview meter before the recorder starts its own internal
      // meter on the same stream (two AnalyserNodes on one source is fine in
      // Web Audio, but stopping the preview avoids double-RAF work).
      stopMeter();
      setPhase("recording");
      resetSpeech();
      startSpeech();
      recorder.start(stream);
    } catch (e: any) {
      setError(e?.message || "Could not start recording.");
    }
  }, [ensureStream, recorder, startSpeech, resetSpeech, stopMeter]);

  // ---- preparation countdown ----------------------------------------------
  useEffect(() => {
    if (phase !== "prep") return;
    setPrepRemaining(PREP_MS);
    const step = 250;
    const id = setInterval(() => {
      setPrepRemaining((r) => {
        if (r <= step) {
          clearInterval(id);
          setPhase("countdown");
          return 0;
        }
        return r - step;
      });
    }, step);
    return () => clearInterval(id);
  }, [phase, currentIndex]);

  // ---- recording countdown -------------------------------------------------
  useEffect(() => {
    if (phase !== "countdown") return;
    setRecCountdown(REC_COUNTDOWN_MS);
    const step = 100;
    const id = setInterval(() => {
      setRecCountdown((r) => {
        if (r <= step) {
          clearInterval(id);
          startRecording();
          return 0;
        }
        return r - step;
      });
    }, step);
    return () => clearInterval(id);
  }, [phase, startRecording]);

  // ---- re-record / delete --------------------------------------------------
  const reRecord = useCallback(async () => {
    const q = current;
    if (!q) return;
    const rec = recordings[q.id];
    if (rec?.meta) {
      await deleteRecordingBlob(rec.meta.id).catch(() => {});
      await deleteRecordingMeta(rec.meta.id).catch(() => {});
      if (rec.objectUrl) URL.revokeObjectURL(rec.objectUrl);
    }
    setRecordings((prev) => {
      const next = { ...prev };
      delete next[q.id];
      return next;
    });
    setError(null);
    speech.reset();
    setPhase("prep");
  }, [current, recordings, speech]);

  // ---- skip (optional per Sonru spec) --------------------------------------
  const skipQuestion = useCallback(() => {
    const q = current;
    if (!q) return;
    setRecordings((prev) => ({
      ...prev,
      [q.id]: { skipped: true },
    }));
    speech.stop();
    setError(null);
    // Move on (or finish).
    if (isLast) {
      void finishSession();
    } else {
      setCurrentIndex((i) => Math.min(i + 1, total - 1));
      setPhase("prep");
    }
  }, [current, isLast, total, speech]);

  // ---- analyze (Part 6) ----------------------------------------------------
  const analyze = useCallback(async () => {
    const q = current;
    const rec = recordings[q?.id ?? ""];
    if (!q || !rec) return;
    setPhase("analyzing");
    try {
      const transcript = rec.transcript || "";
      const durationMs = rec.meta?.durationMs ?? 0;
      // Use the pure helper directly (no hook needed here — `analyze` is a
      // callback, not a component body, so calling the React hook variant
      // would violate the rules of hooks).
      const fillerStats = analyzeFillerWords(transcript, durationMs);
      const wpmScore = normalizeWpmToScore(fillerStats.wpm);
      const fillerScore = normalizeFillerCountToScore(fillerStats.count, fillerStats.wordCount);
      const evaluation = await evaluateAnswer({
        question: q,
        answerText: transcript || "(no speech detected — answer was non-verbal or speech recognition was unavailable)",
        resume,
        jd,
        videoMetrics: {
          videoAvailable: true,
          eyeContact: null, // vision-based gaze tracking not available without a face model
          wordsPerMinute: fillerStats.wpm || null,
          fillerWordCount: fillerStats.count,
        } as VideoDerivedMetrics,
      });
      // If the model returned nulls for the speech-derived dimensions, patch
      // them with our deterministic measurements.
      if (evaluation.speakingSpeed == null && wpmScore != null) {
        evaluation.speakingSpeed = wpmScore;
      }
      if (evaluation.fillerWords == null && fillerScore != null) {
        evaluation.fillerWords = fillerScore;
      }
      setRecordings((prev) => ({ ...prev, [q.id]: { ...rec, evaluation } }));
      setPhase("analysis");
    } catch (e: any) {
      setError(e?.message || "Analysis failed.");
      setPhase("review");
    }
  }, [current, jd, recordings, resume]);

  // ---- pre-compute match score for the final report ------------------------
  const matchScore: InterviewMatchScore | null = useMemo(() => {
    if (!resume) return null;
    return buildInterviewMatchScore(resume, jd);
  }, [resume, jd]);

  // ---- finish session: build final report and bubble up --------------------
  const finishSession = useCallback(async () => {
    setGeneratingReport(true);
    try {
      // Iterate entries directly so we have stable questionId alongside each
      // recording (avoids the fragile `Object.values` + reverse-lookup pattern).
      const entries = Object.entries(recordings);
      const metaRecords: InterviewRecordingMeta[] = [];
      const evaluations: Array<{
        questionId: string;
        category: string;
        subType?: string;
        overallScore: number;
        strengths: string[];
        weaknesses: string[];
        suggestions: string[];
      }> = [];
      let skippedCount = 0;
      for (const [questionId, rec] of entries) {
        if (rec.skipped) {
          skippedCount += 1;
          continue;
        }
        if (rec.meta) metaRecords.push(rec.meta);
        if (rec.evaluation) {
          const q = questions.find((qq) => qq.id === questionId);
          evaluations.push({
            questionId,
            category: q?.category ?? "hr",
            subType: q?.subType,
            overallScore: rec.evaluation.overallScore,
            strengths: rec.evaluation.strengths,
            weaknesses: rec.evaluation.weaknesses,
            suggestions: rec.evaluation.suggestions,
          });
        }
      }
      const report = await generateHiringRecommendation({
        evaluations,
        totalCount: total,
        skippedCount,
        matchScore,
        useAI: true,
        resumeId: resume?.id,
        jdId: jd?.id,
        company: jd?.company ?? pkg.company,
      });
      setFinalReport(report);
      setPhase("final-report");
      onComplete?.(sessionId, metaRecords, report);
    } catch (e: any) {
      // If the final-report AI call fails, still let the user exit.
      setError(e?.message || "Could not generate final report.");
      const metaRecords: InterviewRecordingMeta[] = Object.values(recordings)
        .filter((r) => !!r.meta)
        .map((r) => r.meta!) as InterviewRecordingMeta[];
      onComplete?.(sessionId, metaRecords);
      onClose();
    } finally {
      setGeneratingReport(false);
    }
  }, [recordings, questions, total, matchScore, resume?.id, jd?.id, jd?.company, pkg.company, onComplete, onClose, sessionId]);

  // ---- navigation ----------------------------------------------------------
  const goNext = useCallback(() => {
    if (isLast) {
      void finishSession();
    } else {
      setCurrentIndex((i) => Math.min(i + 1, total - 1));
      setError(null);
      speech.reset();
      setPhase("prep");
    }
  }, [isLast, finishSession, total, speech]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
    setError(null);
    speech.reset();
    setPhase("prep");
  }, [speech]);

  // ---- fullscreen mode -----------------------------------------------------
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen?.();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    } catch {
      /* fullscreen can be blocked by user agent settings; non-fatal */
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ---- cleanup stream on unmount -------------------------------------------
  useEffect(
    () => () => {
      stopPreview();
      speech.stop();
      previewMeter.stop();
    },
    [stopPreview, speech, previewMeter]
  );

  if (!current) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Icon name="AlertCircle" className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="mt-3 text-sm text-muted-foreground">No questions available.</p>
          <Button onClick={onClose} variant="outline" className="mt-4">Back</Button>
        </CardContent>
      </Card>
    );
  }

  const cat = CATEGORY_META[current.category] ?? CATEGORY_META.hr;
  const subTypeLabel = current.subType ? SUB_TYPE_LABELS[current.subType] : null;

  // ---- FINAL REPORT PHASE --------------------------------------------------
  if (phase === "final-report" && finalReport) {
    return (
      <FinalReportView
        report={finalReport}
        matchScore={matchScore}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="space-y-4" ref={containerRef}>
      {/* Browser compatibility banner */}
      {compatWarning && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-2.5 flex items-start gap-2">
          <Icon name="AlertTriangle" className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span className="text-xs text-amber-700 dark:text-amber-400">{compatWarning}</span>
        </div>
      )}

      {/* Header + progress */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="Video" className="w-5 h-5 text-brand shrink-0" />
              <div className="min-w-0">
                <h2 className="font-semibold text-sm sm:text-base truncate">
                  {pkg.role ?? "Video Interview"}{pkg.company ? ` at ${pkg.company}` : ""}
                </h2>
                <p className="text-xs text-muted-foreground">Asynchronous video interview (Sonru-style)</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFullscreen}
                className="gap-1.5"
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                <Icon name={isFullscreen ? "Minimize2" : "Maximize2"} className="w-4 h-4" />
                <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
                <Icon name="X" className="w-4 h-4" /> Exit
              </Button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-muted-foreground">Question {currentIndex + 1} of {total}</span>
            <span className="font-bold text-brand">{percent}%</span>
          </div>
          <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
            <motion.div className="h-full bg-gradient-to-r from-brand to-brand-dark rounded-full" animate={{ width: `${percent}%` }} transition={{ duration: 0.3 }} />
          </div>
        </CardContent>
      </Card>

      {/* Question card */}
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: `${cat.color}15`, color: cat.color }}>
              <Icon name={cat.icon} className="w-3.5 h-3.5" /> {cat.label}
            </div>
            {subTypeLabel && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-brand/10 text-brand" title="Sonru question family">
                {subTypeLabel}
              </span>
            )}
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: `${DIFF_COLOR[current.difficulty] ?? "#888"}20`, color: DIFF_COLOR[current.difficulty] ?? "#888" }}>
              {current.difficulty}
            </span>
            {currentRec?.evaluation && (
              <Badge variant="outline" className="text-[10px] gap-1"><Icon name="CheckCircle2" className="w-3 h-3" /> Scored {currentRec.evaluation.overallScore}</Badge>
            )}
            {currentRec?.skipped && (
              <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground"><Icon name="SkipForward" className="w-3 h-3" /> Skipped</Badge>
            )}
            {current.personaName && (
              <Badge variant="outline" className="text-[10px] gap-1"><Icon name="User" className="w-3 h-3" /> {current.personaName}</Badge>
            )}
          </div>

          <p className="text-base sm:text-lg font-semibold text-pretty">{current.question}</p>

          {current.talkingPoints?.length > 0 && (
            <div className="rounded-lg bg-secondary/40 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Icon name="Lightbulb" className="w-3.5 h-3.5 text-gold" /> Talking Points
              </div>
              <ul className="space-y-1">
                {current.talkingPoints.map((t, j) => (
                  <li key={j} className="text-xs text-foreground/80 flex gap-2"><span className="text-brand shrink-0">›</span> <span>{t}</span></li>
                ))}
              </ul>
            </div>
          )}

          {/* === Live camera preview frame ===
              Rendered continuously during prep, countdown, AND recording so the
              user always sees themselves and can verify the camera is working.
              This fixes the regression where the video frame was only visible
              during the recording phase — the user had no way to confirm their
              camera/mic were active before the countdown ended. */}

          {/* PREP phase — camera preview + prep timer overlay + device status */}
          {phase === "prep" && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                {/* key="prep" forces React to mount a fresh <video> node when
                    entering the prep phase, so the re-bind effect always runs
                    on a clean element (srcObject starts null). */}
                <video key="video-prep" ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
                {/* Overlay: prep timer + "Preview" badge */}
                <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-medium text-white bg-black/50 px-2 py-1 rounded-full">
                  <Icon name="Camera" className="w-3 h-3" /> Preview
                </div>
                <div className="absolute top-2 right-2 flex items-center gap-1.5 text-[10px] font-medium text-white bg-brand/80 px-2 py-1 rounded-full">
                  <Icon name="Clock" className="w-3 h-3" /> {formatRemaining(prepRemaining)}
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center bg-black/50 backdrop-blur-sm rounded-xl px-6 py-4">
                    <div className="text-4xl font-bold text-white tabular-nums">{formatRemaining(prepRemaining)}</div>
                    <p className="text-xs text-white/90 mt-1">Prepare your answer</p>
                  </div>
                </div>
                {/* Camera activating spinner / error overlay */}
                {cameraActivating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <div className="text-center">
                      <Icon name="Loader2" className="w-6 h-6 animate-spin text-white mx-auto" />
                      <p className="text-xs text-white/80 mt-2">Starting camera…</p>
                    </div>
                  </div>
                )}
                {cameraError && !cameraActivating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                    <div className="text-center max-w-xs px-4">
                      <Icon name="Camera" className="w-8 h-8 text-red-400 mx-auto" />
                      <p className="text-xs text-white/90 mt-2 font-medium">Camera unavailable</p>
                      <p className="text-[10px] text-white/70 mt-1">{cameraError}</p>
                      <Button size="sm" variant="outline" onClick={activateCamera} className="mt-3 gap-1.5 bg-white/10 border-white/30 text-white hover:bg-white/20">
                        <Icon name="RefreshCw" className="w-3.5 h-3.5" /> Retry
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Inline device status — lets the user verify camera + mic
                  without leaving for the separate Device Check tab. */}
              <div className="flex items-center gap-2 flex-wrap text-[10px]">
                <DeviceStatusPill
                  ok={deviceSnapshot.cameraPermission === "granted" && !!deviceSnapshot.previewActive}
                  label="Camera"
                  icon="Camera"
                  detail={deviceSnapshot.previewCapabilities ? `${deviceSnapshot.previewCapabilities.width}×${deviceSnapshot.previewCapabilities.height}` : undefined}
                />
                <DeviceStatusPill
                  ok={deviceSnapshot.micPermission === "granted"}
                  label="Mic"
                  icon="Mic"
                />
                <DeviceStatusPill
                  ok={previewMeter.active}
                  label="Audio"
                  icon="Activity"
                  detail={previewMeter.active ? "live" : "silent"}
                />
              </div>

              {/* Preview audio meter — shows mic input level during prep so the
                  user can verify their microphone is picking up sound. */}
              <AudioMeterBar level={previewMeter.level} />

              {/* Prep controls */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground">Recording starts automatically when the timer ends.</p>
                <div className="flex gap-2">
                  {!cameraError && !cameraActivating && (
                    <Button size="sm" variant="ghost" onClick={activateCamera} className="gap-1.5 text-muted-foreground" title="Re-initialise camera & microphone">
                      <Icon name="RefreshCw" className="w-3.5 h-3.5" /> Retry camera
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setPhase("countdown")} className="gap-1.5">
                    <Icon name="SkipForward" className="w-4 h-4" /> Skip prep
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* COUNTDOWN phase — camera preview with big countdown number overlay */}
          {phase === "countdown" && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                <video key="video-countdown" ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-medium text-white bg-black/50 px-2 py-1 rounded-full">
                  <Icon name="Video" className="w-3 h-3" /> Get ready
                </div>
                {/* Big countdown number centered on the video feed */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-7xl sm:text-8xl font-bold text-white tabular-nums drop-shadow-2xl">
                    {Math.ceil(recCountdown / 1000)}
                  </div>
                </div>
                <div className="absolute bottom-2 left-2 right-2 text-center">
                  <p className="text-xs text-white/90 bg-black/40 inline-block px-2 py-1 rounded-full">Recording starts automatically</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">Look at the camera and get ready to speak.</p>
            </div>
          )}

          {/* RECORDING phase — same video frame, with REC badge + controls */}
          {phase === "recording" && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                <video key="video-recording" ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-medium text-white bg-black/50 px-2 py-1 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> REC {formatDuration(recorder.elapsedMs)}
                </div>
                {recorder.maxDurationMs && (
                  <div className="absolute bottom-2 left-2 right-2">
                    <div className="h-1 bg-white/30 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500" style={{ width: `${Math.min(100, (recorder.elapsedMs / recorder.maxDurationMs) * 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
              {/* audio meter */}
              <AudioMeterBar level={recorder.level} />
              {/* live transcript (if supported) */}
              {speech.supported && (
                <div className="rounded-lg bg-secondary/40 p-2.5 max-h-24 overflow-y-auto">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                    <Icon name="Captions" className="w-3 h-3" /> Live transcript
                    {speech.listening && <span className="text-emerald-600 ml-1">●</span>}
                  </div>
                  <p className="text-xs text-foreground/80">
                    {speech.transcript || speech.interimTranscript || <span className="italic text-muted-foreground">Listening…</span>}
                  </p>
                </div>
              )}
              {!speech.supported && (
                <p className="text-[10px] text-muted-foreground italic">
                  Live speech-to-text is not supported in this browser. The AI will evaluate video/audio signals only.
                </p>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-muted-foreground">Max {formatDuration(recorder.maxDurationMs ?? 0)}</div>
                <div className="flex gap-2">
                  {recorder.state === "recording" ? (
                    <Button size="sm" variant="outline" onClick={recorder.pause} className="gap-1.5"><Icon name="Pause" className="w-4 h-4" /> Pause</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={recorder.resume} className="gap-1.5"><Icon name="Play" className="w-4 h-4" /> Resume</Button>
                  )}
                  <Button size="sm" onClick={recorder.stop} className="bg-red-600 hover:bg-red-700 text-white gap-1.5"><Icon name="Square" className="w-4 h-4" /> Stop</Button>
                </div>
              </div>
            </div>
          )}

          {/* Phase: REVIEW */}
          {phase === "review" && currentRec?.objectUrl && (
            <div className="space-y-3">
              <video src={currentRec.objectUrl} className="w-full rounded-xl bg-black aspect-video" controls playsInline />
              {currentRec.transcript && (
                <div className="rounded-lg bg-secondary/40 p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                    <Icon name="Captions" className="w-3 h-3" /> Transcript
                  </div>
                  <p className="text-xs text-foreground/80 whitespace-pre-wrap">{currentRec.transcript}</p>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  {formatDuration(currentRec.meta?.durationMs ?? 0)} · {((currentRec.meta?.sizeBytes ?? 0) / 1024 / 1024).toFixed(1)} MB
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={reRecord} className="gap-1.5 text-destructive"><Icon name="RotateCcw" className="w-4 h-4" /> Re-record</Button>
                  <Button size="sm" onClick={analyze} className="bg-brand hover:bg-brand-dark text-white gap-1.5"><Icon name="Sparkles" className="w-4 h-4" /> Analyze answer</Button>
                </div>
              </div>
            </div>
          )}

          {/* Phase: ANALYZING */}
          {phase === "analyzing" && (
            <div className="text-center py-6">
              <Icon name="Loader2" className="w-6 h-6 animate-spin text-brand mx-auto" />
              <p className="text-sm text-muted-foreground mt-2">Analyzing your answer…</p>
            </div>
          )}

          {/* Phase: ANALYSIS (feedback) */}
          {phase === "analysis" && currentRec?.evaluation && (
            <>
              <EvaluationCard evaluation={currentRec.evaluation} idealAnswer={current.recommendedAnswer} />
              <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={goPrev} disabled={currentIndex === 0} className="gap-1.5">
                  <Icon name="ArrowLeft" className="w-4 h-4" /> Previous
                </Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={reRecord} className="gap-1.5"><Icon name="RotateCcw" className="w-4 h-4" /> Re-record</Button>
                  <Button size="sm" onClick={goNext} className="bg-brand hover:bg-brand-dark text-white gap-1.5" disabled={generatingReport}>
                    {generatingReport ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : null}
                    {isLast ? "Finish" : "Next"} <Icon name={isLast ? "Flag" : "ArrowRight"} className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Skip button — visible in prep / countdown / review phases */}
          {(phase === "prep" || phase === "countdown" || phase === "review") && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={skipQuestion} className="gap-1.5 text-muted-foreground" title="Skip this question (optional)">
                <Icon name="SkipForward" className="w-3.5 h-3.5" /> Skip question
              </Button>
            </div>
          )}

          {videoQualityWarning && phase === "prep" && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-2 flex items-start gap-2">
              <Icon name="AlertTriangle" className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span className="text-[11px] text-amber-700 dark:text-amber-400">{videoQualityWarning}</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-2.5 flex items-start gap-2">
              <Icon name="AlertCircle" className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="text-xs text-red-700 dark:text-red-400">{error}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Final report — full-screen card shown after the last question
// ----------------------------------------------------------------------------

function FinalReportView({
  report,
  matchScore,
  onClose,
}: {
  report: InterviewFinalReport;
  matchScore: InterviewMatchScore | null;
  onClose: () => void;
}) {
  const verdictColor = VERDICT_COLORS[report.verdict];
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <Icon name="Trophy" className="w-7 h-7 text-gold" />
          <div>
            <h2 className="font-display text-xl font-bold">Final Interview Report</h2>
            <p className="text-xs text-muted-foreground">
              {report.answeredCount} of {report.totalCount} answered · {report.skippedCount} skipped
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border p-3 flex flex-col items-center justify-center text-center">
            <ScoreRing value={report.overallScore} size={88} label="Score" />
            <div className="text-xs font-semibold mt-1">Interview Score</div>
          </div>
          <div className="rounded-xl border border-border p-3 flex flex-col items-center justify-center text-center">
            <div className="text-2xl font-bold" style={{ color: verdictColor }}>{report.verdictLabel.split("—")[0].trim()}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{report.verdictLabel.split("—")[1]?.trim() ?? ""}</div>
            <div className="text-xs font-semibold mt-1">Hiring Recommendation</div>
          </div>
          <div className="rounded-xl border border-border p-3 flex flex-col items-center justify-center text-center">
            <ScoreRing value={report.atsReadiness} size={88} label="ATS" />
            <div className="text-xs font-semibold mt-1">ATS Readiness</div>
          </div>
        </div>

        {matchScore && (
          <div className="rounded-xl bg-secondary/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Icon name="Briefcase" className="w-3.5 h-3.5" /> Resume ↔ JD Match
            </div>
            <div className="grid sm:grid-cols-5 gap-2 text-[11px]">
              <MatchBar label="Overall" value={matchScore.overall} />
              <MatchBar label="Skills" value={matchScore.skillMatch} />
              <MatchBar label="Keywords" value={matchScore.keywordMatch} />
              <MatchBar label="Experience" value={matchScore.experienceMatch} />
              <MatchBar label="Industry" value={matchScore.industryMatch} />
            </div>
            <div className="grid sm:grid-cols-2 gap-2 mt-2 text-[11px]">
              {matchScore.missingSkills.length > 0 && (
                <div>
                  <div className="font-semibold text-amber-600">Missing Skills</div>
                  <div className="text-muted-foreground">{matchScore.missingSkills.join(", ")}</div>
                </div>
              )}
              {matchScore.missingKeywords.length > 0 && (
                <div>
                  <div className="font-semibold text-amber-600">Missing ATS Keywords</div>
                  <div className="text-muted-foreground">{matchScore.missingKeywords.join(", ")}</div>
                </div>
              )}
              <div>
                <div className="font-semibold">Seniority</div>
                <div className="text-muted-foreground capitalize">{matchScore.seniority}</div>
              </div>
              <div>
                <div className="font-semibold">Industry</div>
                <div className="text-muted-foreground">{matchScore.industry}</div>
              </div>
            </div>
          </div>
        )}

        {Object.keys(report.categoryAverages).length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Category Averages</div>
            <div className="space-y-1.5">
              {Object.entries(report.categoryAverages).map(([cat, val]) => (
                <div key={cat} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 capitalize text-muted-foreground">{cat}</span>
                  <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${val}%`, background: val >= 70 ? "#10B981" : val >= 50 ? "#F59E0B" : "#DC2626" }} />
                  </div>
                  <span className="w-7 text-right font-semibold">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          <ReportList title="Top Strengths" icon="CheckCircle2" color="text-emerald-600" items={report.topStrengths} />
          <ReportList title="Top Weaknesses" icon="AlertTriangle" color="text-amber-600" items={report.topWeaknesses} />
          <ReportList title="Action Items" icon="Lightbulb" color="text-brand" items={report.actionItems} />
        </div>

        <div className="rounded-xl bg-brand/5 dark:bg-brand/10 border border-brand/30 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand mb-1 flex items-center gap-1.5">
            <Icon name="Sparkles" className="w-3.5 h-3.5" /> Hiring Committee Narrative
          </div>
          <p className="text-xs text-foreground/80 leading-relaxed">{report.narrative}</p>
        </div>

        <div className="flex justify-end">
          <Button onClick={onClose} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
            <Icon name="Check" className="w-4 h-4" /> Save & Exit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MatchBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: value >= 70 ? "#10B981" : value >= 50 ? "#F59E0B" : "#DC2626" }} />
      </div>
    </div>
  );
}

function ReportList({ title, icon, color, items }: { title: string; icon: string; color: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
        <Icon name={icon} className={`w-3.5 h-3.5 ${color}`} /> {title}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1 text-xs text-foreground/80">
          {items.map((s, i) => <li key={i} className="flex gap-1.5"><span className={color + " shrink-0"}>•</span> <span>{s}</span></li>)}
        </ul>
      ) : (
        <p className="text-[11px] italic text-muted-foreground">No items.</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// helpers / sub-components
// ----------------------------------------------------------------------------

/**
 * Inline device-status pill — shows a green check / red cross for camera, mic,
 * and audio level. Lets the user verify their devices work WITHOUT leaving the
 * video session for the separate Device Check tab.
 */
function DeviceStatusPill({
  ok,
  label,
  icon,
  detail,
}: {
  ok: boolean;
  label: string;
  icon: string;
  detail?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded-full border ${
        ok
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
          : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-400"
      }`}
      title={ok ? `${label}: active` : `${label}: not ready`}
    >
      <Icon name={icon} className="w-3 h-3" />
      <span className="font-medium">{label}</span>
      <Icon name={ok ? "CheckCircle2" : "XCircle"} className="w-3 h-3" />
      {detail && <span className="text-[9px] opacity-70">· {detail}</span>}
    </div>
  );
}

function AudioMeterBar({ level }: { level: number }) {
  const pct = Math.round(level * 100);
  const color = pct > 75 ? "#DC2626" : pct > 35 ? "#F59E0B" : "#10B981";
  return (
    <div className="space-y-1">
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[10px] text-muted-foreground">Mic input</div>
    </div>
  );
}

function EvaluationCard({ evaluation, idealAnswer }: { evaluation: AnswerEvaluation; idealAnswer: string }) {
  const dims: { key: keyof AnswerEvaluation; label: string }[] = [
    { key: "communication", label: "Communication" },
    { key: "confidence", label: "Confidence" },
    { key: "grammar", label: "Grammar" },
    { key: "fluency", label: "Fluency" },
    { key: "professionalism", label: "Professionalism" },
    { key: "contentRelevance", label: "Content Relevance" },
    { key: "starStructure", label: "STAR Structure" },
    { key: "roleFit", label: "Role Fit" },
    { key: "eyeContact", label: "Eye Contact" },
    { key: "speakingSpeed", label: "Speaking Speed" },
    { key: "fillerWords", label: "Filler Words" },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-brand/30 bg-brand/5 dark:bg-brand/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Sparkles" className="w-4 h-4 text-brand" />
          <span className="text-sm font-semibold">AI Feedback</span>
        </div>
        <ScoreRing value={evaluation.overallScore} size={48} label="Score" />
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
        {dims.map(({ key, label }) => {
          const v = evaluation[key] as number | null;
          if (v == null) {
            return (
              <div key={label} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="text-[10px] text-muted-foreground italic">N/A</span>
              </div>
            );
          }
          return (
            <div key={label} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${v}%`, background: v >= 70 ? "#10B981" : v >= 50 ? "#F59E0B" : "#DC2626" }} />
              </div>
              <span className="w-7 text-right font-semibold">{v}</span>
            </div>
          );
        })}
      </div>
      {evaluation.strengths.length > 0 && (
        <Expandable title="Strengths" icon="CheckCircle2" color="text-emerald-600">
          {evaluation.strengths.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-emerald-600 shrink-0">✓</span> {s}</li>)}
        </Expandable>
      )}
      {evaluation.weaknesses.length > 0 && (
        <Expandable title="Weaknesses" icon="AlertTriangle" color="text-amber-600">
          {evaluation.weaknesses.map((w, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-600 shrink-0">→</span> {w}</li>)}
        </Expandable>
      )}
      {evaluation.suggestions.length > 0 && (
        <Expandable title="Suggestions" icon="Lightbulb" color="text-brand">
          {evaluation.suggestions.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-brand shrink-0">›</span> {s}</li>)}
        </Expandable>
      )}
      {idealAnswer && (
        <Expandable title="Ideal Answer" icon="Sparkles" color="text-gold">
          <li className="text-xs leading-relaxed">{idealAnswer}</li>
        </Expandable>
      )}
    </motion.div>
  );
}

function Expandable({ title, icon, color, children }: { title: string; icon: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
        <Icon name={icon} className={`w-3.5 h-3.5 ${color}`} /> {title}
      </div>
      <ul className="space-y-0.5 text-xs text-foreground/80">{children}</ul>
    </div>
  );
}

// category + difficulty presentation (mirrors Interview.tsx)
const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
  technical: { label: "Technical", icon: "Code2", color: "#1154A3" },
  behavioral: { label: "Behavioral", icon: "Users", color: "#F59E0B" },
  situational: { label: "Situational", icon: "GitBranch", color: "#10B981" },
  hr: { label: "HR", icon: "UserCheck", color: "#8B5CF6" },
  company: { label: "Company-specific", icon: "Building2", color: "#EC4899" },
};

const DIFF_COLOR: Record<string, string> = { easy: "#10B981", medium: "#F59E0B", hard: "#DC2626", adaptive: "#3B82F6" };

const SUB_TYPE_LABELS: Record<string, string> = {
  "hr": "HR",
  "behavioral": "Behavioral",
  "star": "STAR",
  "technical": "Technical",
  "situational": "Situational",
  "company-fit": "Company Fit",
  "leadership": "Leadership",
  "problem-solving": "Problem Solving",
  "resume-specific": "Resume-Specific",
  "jd-specific": "JD-Specific",
};

const VERDICT_COLORS: Record<string, string> = {
  "strong-yes": "#10B981",
  "yes": "#22C55E",
  "lean-yes": "#F59E0B",
  "no": "#F97316",
  "strong-no": "#DC2626",
};
