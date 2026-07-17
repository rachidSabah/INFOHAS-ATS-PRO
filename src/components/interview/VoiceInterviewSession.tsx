"use client";

// ============================================================================
// VoiceInterviewSession — Sonru-style asynchronous VOICE-ONLY interview.
//
// A thin variant of VideoInterviewSession. Key differences:
//   • Uses audio-only getUserMedia constraints (no camera).
//   • No <video> preview — shows a live audio waveform / level meter instead.
//   • Reuses the exact same phase state machine, AI evaluation, IndexedDB
//     storage, speech-to-text pipeline, and final-report flow as the video
//     session (DRY: the underlying hooks and lib functions are shared).
//
// Reuses: useDeviceCheck (audio-only mode) + useMediaRecorder (audio MIME) +
// useSpeechRecognition + analyzeFillerWords + evaluateAnswer +
// generateHiringRecommendation + buildInterviewMatchScore.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
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
import { saveRecording, deleteRecordingBlob, deleteRecordingMeta } from "@/lib/interview/storage";
import { uid } from "@/lib/store";
import type { InterviewRecordingMeta } from "@/hooks/interview/types";
import type { InterviewPackage, ResumeData, JobDescription } from "@/lib/types";

const PREP_MS = 30_000;
const REC_COUNTDOWN_MS = 3_000;
const MAX_REC_MS = 120_000;

type Phase = "prep" | "countdown" | "recording" | "review" | "analyzing" | "analysis" | "final-report";

interface QuestionRecording {
  meta?: InterviewRecordingMeta;
  objectUrl?: string;
  evaluation?: AnswerEvaluation;
  transcript?: string;
  skipped?: boolean;
}

interface VoiceSessionProps {
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

export function VoiceInterviewSession({ pkg, resume, jd, generated, onClose, onComplete }: VoiceSessionProps) {
  // We don't pass a videoRef — voice mode never opens a camera.
  const { snapshot: deviceSnapshot, getStream, requestCameraAndMic, stopPreview } = useDeviceCheck({
    enablePreview: false,
  });
  const questions = (pkg.questions ?? []) as GeneratedQuestion[];
  const total = questions.length;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("prep");
  const [prepRemaining, setPrepRemaining] = useState(PREP_MS);
  const [recCountdown, setRecCountdown] = useState(REC_COUNTDOWN_MS);
  const [recordings, setRecordings] = useState<Record<string, QuestionRecording>>({});
  const [error, setError] = useState<string | null>(null);
  const [finalReport, setFinalReport] = useState<InterviewFinalReport | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  // Mic activation state — drives the inline audio waveform + retry button
  // shown during prep & countdown. The mic is requested as soon as the session
  // mounts so the user can verify their microphone works (and see the live
  // audio level) BEFORE the recording actually starts. Mirrors the video
  // session's camera-activation pattern.
  const [micActivating, setMicActivating] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  // Preview audio meter — runs during prep & countdown so the user can verify
  // their mic is picking up sound BEFORE the recording starts.
  const previewMeter = useAudioMeter(0.08);

  const speech = useSpeechRecognition({ continuous: true, interimResults: false });

  const sessionId = useMemo(() => uid("sess"), []);
  const current = questions[currentIndex];
  const isLast = currentIndex === total - 1;
  const currentRec = recordings[current?.id ?? ""];
  const percent = Math.round(((currentIndex + 1) / Math.max(total, 1)) * 100);

  const compatWarning = useMemo(() => {
    const c = deviceSnapshot.compatibility;
    if (!c.secureContext) {
      return "This page is not in a secure context (https:// or localhost). Microphone will not work.";
    }
    if (!c.mediaDevices || !c.getUserMedia) {
      return "This browser does not support navigator.mediaDevices. Use an up-to-date Chrome, Edge, Safari, or Firefox.";
    }
    if (!c.mediaRecorder) {
      return "This browser does not support MediaRecorder. Recording will be unavailable.";
    }
    return null;
  }, [deviceSnapshot.compatibility]);

  // ---- ensure mic stream when entering recording ---------------------------
  const ensureStream = useCallback(async () => {
    let stream = getStream();
    if (!stream || stream.getAudioTracks().length === 0) {
      // Explicit audio-only request (no camera).
      stream = await requestCameraAndMic({ video: false, audio: true });
    }
    return stream;
  }, [getStream, requestCameraAndMic]);

  // ---- activate mic early so the user sees a live audio waveform during prep --
  // Mirrors the video session's camera-activation pattern: the mic is requested
  // as soon as the session mounts so the user can verify their audio input
  // (waveform + level meter + "Audio: live" status pill) BEFORE the recording
  // starts. The same stream is reused by recorder.start() so there is no
  // audible glitch between phases.
  const activateMic = useCallback(async () => {
    setMicActivating(true);
    setMicError(null);
    try {
      const stream = await requestCameraAndMic({ video: false, audio: true });
      if (!stream) {
        setMicError(
          deviceSnapshot.error ??
            "Microphone access failed. Check permissions and retry."
        );
      } else {
        previewMeter.start(stream);
      }
    } catch (e: any) {
      setMicError(e?.message || "Could not activate microphone.");
    } finally {
      setMicActivating(false);
    }
  }, [requestCameraAndMic, previewMeter, deviceSnapshot.error]);

  // Activate the mic on mount AND whenever we transition back to the prep
  // phase (e.g. when moving to the next question).
  useEffect(() => {
    if (phase !== "prep") return;
    const existing = getStream();
    if (existing && existing.getAudioTracks().length > 0) {
      previewMeter.start(existing);
      return;
    }
    void activateMic();
    // We intentionally only depend on `phase` + `currentIndex` so the mic is
    // re-activated when moving to a new question's prep phase, not on every
    // render. The activation is idempotent.
  }, [phase, currentIndex]);

  // ---- when a recording is finalized --------------------------------------
  const onRecorderComplete = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number) => {
      const q = questions[currentIndex];
      if (!q) return;
      speech.stop();
      previewMeter.stop();
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
    [currentIndex, questions, jd?.id, resume?.id, sessionId, speech, previewMeter]
  );

  const recorder = useMediaRecorder({ maxDurationMs: MAX_REC_MS, onComplete: onRecorderComplete });

  const startRecording = useCallback(async () => {
    try {
      const stream = await ensureStream();
      if (!stream) {
        setError("Microphone unavailable. Run the device check first.");
        return;
      }
      // Stop the preview meter before the recorder starts its own.
      previewMeter.stop();
      setPhase("recording");
      speech.reset();
      speech.start();
      recorder.start(stream);
    } catch (e: any) {
      setError(e?.message || "Could not start recording.");
    }
  }, [ensureStream, recorder, speech, previewMeter]);

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

  // ---- re-record -----------------------------------------------------------
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

  // ---- skip ----------------------------------------------------------------
  const skipQuestion = useCallback(() => {
    const q = current;
    if (!q) return;
    setRecordings((prev) => ({ ...prev, [q.id]: { skipped: true } }));
    speech.stop();
    setError(null);
    if (isLast) {
      void finishSession();
    } else {
      setCurrentIndex((i) => Math.min(i + 1, total - 1));
      setPhase("prep");
    }
  }, [current, isLast, total, speech]);

  // ---- analyze -------------------------------------------------------------
  const analyze = useCallback(async () => {
    const q = current;
    const rec = recordings[q?.id ?? ""];
    if (!q || !rec) return;
    setPhase("analyzing");
    try {
      const transcript = rec.transcript || "";
      const durationMs = rec.meta?.durationMs ?? 0;
      const fillerStats = analyzeFillerWords(transcript, durationMs);
      const wpmScore = normalizeWpmToScore(fillerStats.wpm);
      const fillerScore = normalizeFillerCountToScore(fillerStats.count, fillerStats.wordCount);
      const evaluation = await evaluateAnswer({
        question: q,
        answerText: transcript || "(no speech detected — answer was non-verbal or speech recognition was unavailable)",
        resume,
        jd,
        videoMetrics: {
          videoAvailable: false, // voice-only — no video dimensions apply
          eyeContact: null,
          wordsPerMinute: fillerStats.wpm || null,
          fillerWordCount: fillerStats.count,
        } as VideoDerivedMetrics,
      });
      if (evaluation.speakingSpeed == null && wpmScore != null) {
        evaluation.speakingSpeed = wpmScore;
      }
      if (evaluation.fillerWords == null && fillerScore != null) {
        evaluation.fillerWords = fillerScore;
      }
      // Eye-contact always N/A for voice-only.
      evaluation.eyeContact = null;
      setRecordings((prev) => ({ ...prev, [q.id]: { ...rec, evaluation } }));
      setPhase("analysis");
    } catch (e: any) {
      setError(e?.message || "Analysis failed.");
      setPhase("review");
    }
  }, [current, jd, recordings, resume]);

  // ---- pre-compute match score for the final report -----------------------
  const matchScore: InterviewMatchScore | null = useMemo(() => {
    if (!resume) return null;
    return buildInterviewMatchScore(resume, jd);
  }, [resume, jd]);

  // ---- finish session ------------------------------------------------------
  const finishSession = useCallback(async () => {
    setGeneratingReport(true);
    try {
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

  // ---- cleanup -------------------------------------------------------------
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

  if (phase === "final-report" && finalReport) {
    return <VoiceFinalReportView report={finalReport} matchScore={matchScore} onClose={onClose} />;
  }

  return (
    <div className="space-y-4">
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
              <Icon name="Mic" className="w-5 h-5 text-brand shrink-0" />
              <div className="min-w-0">
                <h2 className="font-semibold text-sm sm:text-base truncate">
                  {pkg.role ?? "Voice Interview"}{pkg.company ? ` at ${pkg.company}` : ""}
                </h2>
                <p className="text-xs text-muted-foreground">Asynchronous voice interview (Sonru-style, audio only)</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 shrink-0">
              <Icon name="X" className="w-4 h-4" /> Exit
            </Button>
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
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-brand/10 text-brand">{subTypeLabel}</span>
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

          {/* === Live audio waveform frame ===
              Rendered continuously during prep, countdown, AND recording so the
              user always sees the live mic level and can verify their microphone
              is working. Mirrors the video session's camera-preview fix. */}

          {/* PREP phase — waveform + prep timer overlay + device status */}
          {phase === "prep" && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-brand/10 to-brand-dark/20 aspect-video flex items-center justify-center">
                <VoiceWaveform level={previewMeter.level} active={previewMeter.active} />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-medium text-white bg-black/50 px-2 py-1 rounded-full">
                  <Icon name="Mic" className="w-3 h-3" /> Preview
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
                {micActivating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <div className="text-center">
                      <Icon name="Loader2" className="w-6 h-6 animate-spin text-white mx-auto" />
                      <p className="text-xs text-white/80 mt-2">Starting microphone…</p>
                    </div>
                  </div>
                )}
                {micError && !micActivating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                    <div className="text-center max-w-xs px-4">
                      <Icon name="Mic" className="w-8 h-8 text-red-400 mx-auto" />
                      <p className="text-xs text-white/90 mt-2 font-medium">Microphone unavailable</p>
                      <p className="text-[10px] text-white/70 mt-1">{micError}</p>
                      <Button size="sm" variant="outline" onClick={activateMic} className="mt-3 gap-1.5 bg-white/10 border-white/30 text-white hover:bg-white/20">
                        <Icon name="RefreshCw" className="w-3.5 h-3.5" /> Retry
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Inline device status — mic + audio level */}
              <div className="flex items-center gap-2 flex-wrap text-[10px]">
                <VoiceDeviceStatusPill
                  ok={deviceSnapshot.micPermission === "granted"}
                  label="Mic"
                  icon="Mic"
                />
                <VoiceDeviceStatusPill
                  ok={previewMeter.active}
                  label="Audio"
                  icon="Activity"
                  detail={previewMeter.active ? "live" : "silent"}
                />
              </div>

              {/* Preview audio meter */}
              <AudioMeterBar level={previewMeter.level} />

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground">Recording starts automatically when the timer ends.</p>
                <div className="flex gap-2">
                  {!micError && !micActivating && (
                    <Button size="sm" variant="ghost" onClick={activateMic} className="gap-1.5 text-muted-foreground" title="Re-initialise microphone">
                      <Icon name="RefreshCw" className="w-3.5 h-3.5" /> Retry mic
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setPhase("countdown")} className="gap-1.5">
                    <Icon name="SkipForward" className="w-4 h-4" /> Skip prep
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* COUNTDOWN phase — waveform with big countdown number overlay */}
          {phase === "countdown" && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-brand/10 to-brand-dark/20 aspect-video flex items-center justify-center">
                <VoiceWaveform level={previewMeter.level} active={previewMeter.active} />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-medium text-white bg-black/50 px-2 py-1 rounded-full">
                  <Icon name="Mic" className="w-3 h-3" /> Get ready
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-7xl sm:text-8xl font-bold text-white tabular-nums drop-shadow-2xl">
                    {Math.ceil(recCountdown / 1000)}
                  </div>
                </div>
                <div className="absolute bottom-2 left-2 right-2 text-center">
                  <p className="text-xs text-white/90 bg-black/40 inline-block px-2 py-1 rounded-full">Recording starts automatically</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">Take a breath and get ready to speak.</p>
            </div>
          )}

          {/* RECORDING phase — same waveform frame, with REC badge + controls */}
          {phase === "recording" && (
            <div className="space-y-3">
              {/* Audio-only "preview" — animated waveform driven by mic level. */}
              <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-brand/10 to-brand-dark/20 aspect-video flex items-center justify-center">
                <VoiceWaveform level={recorder.level} active={recorder.state === "recording"} />
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
              <AudioMeterBar level={recorder.level} />
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
                  Live speech-to-text is not supported in this browser. The AI will evaluate audio signals only.
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

          {phase === "review" && currentRec?.objectUrl && (
            <div className="space-y-3">
              <audio src={currentRec.objectUrl} controls className="w-full" />
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

          {phase === "analyzing" && (
            <div className="text-center py-6">
              <Icon name="Loader2" className="w-6 h-6 animate-spin text-brand mx-auto" />
              <p className="text-sm text-muted-foreground mt-2">Analyzing your answer…</p>
            </div>
          )}

          {phase === "analysis" && currentRec?.evaluation && (
            <>
              <VoiceEvaluationCard evaluation={currentRec.evaluation} idealAnswer={current.recommendedAnswer} />
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

          {(phase === "prep" || phase === "countdown" || phase === "review") && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={skipQuestion} className="gap-1.5 text-muted-foreground" title="Skip this question (optional)">
                <Icon name="SkipForward" className="w-3.5 h-3.5" /> Skip question
              </Button>
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
// Sub-components
// ----------------------------------------------------------------------------

function VoiceWaveform({ level, active }: { level: number; active: boolean }) {
  // Render 24 vertical bars whose heights are derived from the current mic
  // level + a pseudo-random distribution so the visual feels alive.
  const bars = Array.from({ length: 24 });
  const seed = useRef(Math.random() * 1000);
  return (
    <div className="flex items-center gap-1 h-24" aria-hidden="true">
      {bars.map((_, i) => {
        const phase = Math.sin(seed.current + i * 0.7) * 0.5 + 0.5;
        const heightPct = active
          ? 12 + Math.min(100, Math.round(level * 100 * (0.4 + phase * 0.6)))
          : 8 + Math.round(phase * 12);
        return (
          <div
            key={i}
            className="w-1.5 rounded-full bg-brand/70 transition-all duration-150"
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </div>
  );
}

/**
 * Inline device-status pill for the voice session — shows a green check / red
 * cross for mic permission and audio level. Lets the user verify their mic
 * works WITHOUT leaving for the separate Device Check tab.
 */
function VoiceDeviceStatusPill({
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

function VoiceEvaluationCard({ evaluation, idealAnswer }: { evaluation: AnswerEvaluation; idealAnswer: string }) {
  // Voice-only: skip the eyeContact dimension entirely (always N/A).
  const dims: { key: keyof AnswerEvaluation; label: string }[] = [
    { key: "communication", label: "Communication" },
    { key: "confidence", label: "Confidence" },
    { key: "grammar", label: "Grammar" },
    { key: "fluency", label: "Fluency" },
    { key: "professionalism", label: "Professionalism" },
    { key: "contentRelevance", label: "Content Relevance" },
    { key: "starStructure", label: "STAR Structure" },
    { key: "roleFit", label: "Role Fit" },
    { key: "speakingSpeed", label: "Speaking Speed" },
    { key: "fillerWords", label: "Filler Words" },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-brand/30 bg-brand/5 dark:bg-brand/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Sparkles" className="w-4 h-4 text-brand" />
          <span className="text-sm font-semibold">AI Feedback (Voice)</span>
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
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-1 flex items-center gap-1">
            <Icon name="CheckCircle2" className="w-3.5 h-3.5" /> Strengths
          </div>
          <ul className="space-y-0.5 text-xs text-foreground/80">
            {evaluation.strengths.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-emerald-600 shrink-0">✓</span> {s}</li>)}
          </ul>
        </div>
      )}
      {evaluation.weaknesses.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-1 flex items-center gap-1">
            <Icon name="AlertTriangle" className="w-3.5 h-3.5" /> Weaknesses
          </div>
          <ul className="space-y-0.5 text-xs text-foreground/80">
            {evaluation.weaknesses.map((w, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-600 shrink-0">→</span> {w}</li>)}
          </ul>
        </div>
      )}
      {evaluation.suggestions.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand mb-1 flex items-center gap-1">
            <Icon name="Lightbulb" className="w-3.5 h-3.5" /> Suggestions
          </div>
          <ul className="space-y-0.5 text-xs text-foreground/80">
            {evaluation.suggestions.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-brand shrink-0">›</span> {s}</li>)}
          </ul>
        </div>
      )}
      {idealAnswer && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gold mb-1 flex items-center gap-1">
            <Icon name="Sparkles" className="w-3.5 h-3.5" /> Ideal Answer
          </div>
          <p className="text-xs leading-relaxed text-foreground/80">{idealAnswer}</p>
        </div>
      )}
    </motion.div>
  );
}

function VoiceFinalReportView({
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
            <h2 className="font-display text-xl font-bold">Final Voice Interview Report</h2>
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
          <div className="rounded-xl bg-secondary/40 p-3 text-[11px]">
            <div className="font-semibold mb-1">Resume ↔ JD Match: {matchScore.overall}/100</div>
            <div className="text-muted-foreground">
              Skills {matchScore.skillMatch} · Keywords {matchScore.keywordMatch} · Experience {matchScore.experienceMatch} · Industry {matchScore.industryMatch}
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
          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-1 flex items-center gap-1">
              <Icon name="CheckCircle2" className="w-3.5 h-3.5" /> Top Strengths
            </div>
            {report.topStrengths.length > 0 ? (
              <ul className="space-y-1 text-xs text-foreground/80">
                {report.topStrengths.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-emerald-600 shrink-0">•</span> <span>{s}</span></li>)}
              </ul>
            ) : <p className="text-[11px] italic text-muted-foreground">No items.</p>}
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-1 flex items-center gap-1">
              <Icon name="AlertTriangle" className="w-3.5 h-3.5" /> Top Weaknesses
            </div>
            {report.topWeaknesses.length > 0 ? (
              <ul className="space-y-1 text-xs text-foreground/80">
                {report.topWeaknesses.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-600 shrink-0">•</span> <span>{s}</span></li>)}
              </ul>
            ) : <p className="text-[11px] italic text-muted-foreground">No items.</p>}
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand mb-1 flex items-center gap-1">
              <Icon name="Lightbulb" className="w-3.5 h-3.5" /> Action Items
            </div>
            {report.actionItems.length > 0 ? (
              <ul className="space-y-1 text-xs text-foreground/80">
                {report.actionItems.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-brand shrink-0">•</span> <span>{s}</span></li>)}
              </ul>
            ) : <p className="text-[11px] italic text-muted-foreground">No items.</p>}
          </div>
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
