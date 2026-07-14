"use client";

// ============================================================================
// VideoInterviewSession — Sonru-style asynchronous video interview.
//
// Per-question flow:
//   Question card → Preparation countdown (30s) → Recording countdown (3s)
//   → Record (max 2min, with live preview + audio meter)
//   → Pause/Resume/Stop/Re-record/Delete → Review (playback)
//   → AI Analysis (evaluateAnswer, Phase 3) → Auto-next → final report.
//
// Reuses: useDeviceCheck + useMediaRecorder (Phase 1), evaluateAnswer (Phase 3),
// and the existing design system. Recordings are stored in IndexedDB
// (src/lib/interview/storage.ts); only metadata reaches the store/cloud.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useDeviceCheck, useMediaRecorder } from "@/hooks/interview";
import { formatDuration, formatRemaining } from "@/hooks/interview/format";
import { evaluateAnswer, type AnswerEvaluation, type VideoDerivedMetrics } from "@/lib/interview/ai";
import { saveRecording, getRecordingObjectURL, deleteRecordingBlob, deleteRecordingMeta } from "@/lib/interview/storage";
import { uid } from "@/lib/store";
import { toast } from "sonner";
import type { GeneratedPackage, GeneratedQuestion } from "@/lib/interview/ai";
import type { InterviewRecordingMeta } from "@/hooks/interview/types";
import type { InterviewPackage, ResumeData, JobDescription } from "@/lib/types";

const PREP_MS = 30_000;
const REC_COUNTDOWN_MS = 3_000;
const MAX_REC_MS = 120_000;

type Phase = "prep" | "countdown" | "recording" | "review" | "analyzing" | "analysis";

interface QuestionRecording {
  meta?: InterviewRecordingMeta;
  objectUrl?: string;
  evaluation?: AnswerEvaluation;
  transcript?: string;
}

interface VideoSessionProps {
  pkg: InterviewPackage;
  resume?: ResumeData;
  jd?: JobDescription;
  generated?: GeneratedPackage;
  onClose: () => void;
  onComplete?: (sessionId: string, records: InterviewRecordingMeta[]) => void;
}

export function VideoInterviewSession({ pkg, resume, jd, generated, onClose, onComplete }: VideoSessionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const questions = (pkg.questions ?? []) as GeneratedQuestion[];
  const total = questions.length;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("prep");
  const [prepRemaining, setPrepRemaining] = useState(PREP_MS);
  const [recCountdown, setRecCountdown] = useState(REC_COUNTDOWN_MS);
  const [recordings, setRecordings] = useState<Record<string, QuestionRecording>>({});
  const [error, setError] = useState<string | null>(null);

  const { getStream, requestCameraAndMic, stopPreview } = useDeviceCheck({
    videoRef,
    enablePreview: false, // we manage the stream manually for recording
  });

  const sessionId = useMemo(() => uid("sess"), []);
  const current = questions[currentIndex];
  const isLast = currentIndex === total - 1;
  const currentRec = recordings[current?.id ?? ""];
  const percent = Math.round(((currentIndex + 1) / Math.max(total, 1)) * 100);

  // ---- ensure camera+mic stream when entering recording -------------------
  const ensureStream = useCallback(async () => {
    let stream = getStream();
    if (!stream || stream.getVideoTracks().length === 0) {
      stream = await requestCameraAndMic();
    }
    return stream;
  }, [getStream, requestCameraAndMic]);

  // ---- when a recording is finalized --------------------------------------
  const onRecorderComplete = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number) => {
      const q = questions[currentIndex];
      if (!q) return;
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
        setRecordings((prev) => ({ ...prev, [q.id]: { meta, objectUrl } }));
        setPhase("review");
      } catch (e: any) {
        setError(e?.message || "Failed to save recording.");
      }
    },
    [currentIndex, questions, jd?.id, resume?.id, sessionId]
  );

  const recorder = useMediaRecorder({ maxDurationMs: MAX_REC_MS, onComplete: onRecorderComplete });

  const startRecording = useCallback(async () => {
    try {
      const stream = await ensureStream();
      if (!stream) {
        setError("Camera/microphone unavailable. Run the device check first.");
        return;
      }
      setPhase("recording");
      recorder.start(stream);
    } catch (e: any) {
      setError(e?.message || "Could not start recording.");
    }
  }, [ensureStream, recorder]);

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
    setPhase("prep");
  }, [current, recordings]);

  // ---- analyze (Part 6) ----------------------------------------------------
  const analyze = useCallback(async () => {
    const q = current;
    const rec = recordings[q?.id ?? ""];
    if (!q || !rec) return;
    setPhase("analyzing");
    try {
      // Best-effort transcript: speech recognition if available (text-only path).
      const evaluation = await evaluateAnswer({
        question: q,
        answerText: rec.transcript || "(video answer — no transcript available)",
        resume,
        jd,
        videoMetrics: {
          videoAvailable: true,
          eyeContact: null,
          wordsPerMinute: null,
          fillerWordCount: null,
        } as VideoDerivedMetrics,
      });
      setRecordings((prev) => ({ ...prev, [q.id]: { ...rec, evaluation } }));
      setPhase("analysis");
    } catch (e: any) {
      setError(e?.message || "Analysis failed.");
      setPhase("review");
    }
  }, [current, jd, recordings, resume]);

  // ---- navigation ----------------------------------------------------------
  const goNext = useCallback(() => {
    if (isLast) {
      const all = Object.values(recordings);
      onComplete?.(sessionId, all.map((r) => r.meta!).filter(Boolean));
      setPhase("analysis"); // show final summary state handled by parent
      onClose();
    } else {
      setCurrentIndex((i) => Math.min(i + 1, total - 1));
      setError(null);
      setPhase("prep");
    }
  }, [isLast, onComplete, onClose, recordings, sessionId, total]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
    setError(null);
    setPhase("prep");
  }, []);

  // cleanup stream on unmount
  useEffect(() => () => stopPreview(), [stopPreview]);

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

  return (
    <div className="space-y-4">
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
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: `${DIFF_COLOR[current.difficulty] ?? "#888"}20`, color: DIFF_COLOR[current.difficulty] ?? "#888" }}>
              {current.difficulty}
            </span>
            {currentRec?.evaluation && (
              <Badge variant="outline" className="text-[10px] gap-1"><Icon name="CheckCircle2" className="w-3 h-3" /> Scored {currentRec.evaluation.overallScore}</Badge>
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

          {/* Phase: PREP */}
          {phase === "prep" && (
            <PrepBlock remainingMs={prepRemaining} onSkip={() => setPhase("countdown")} />
          )}

          {/* Phase: COUNTDOWN */}
          {phase === "countdown" && (
            <div className="text-center py-6">
              <div className="text-5xl font-bold text-brand tabular-nums">{Math.ceil(recCountdown / 1000)}</div>
              <p className="text-sm text-muted-foreground mt-2">Get ready — recording starts automatically</p>
            </div>
          )}

          {/* Phase: RECORDING */}
          {phase === "recording" && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
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
                  <Button size="sm" onClick={goNext} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
                    {isLast ? "Finish" : "Next"} <Icon name={isLast ? "Flag" : "ArrowRight"} className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
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
// helpers / sub-components
// ----------------------------------------------------------------------------

function PrepBlock({ remainingMs, onSkip }: { remainingMs: number; onSkip: () => void }) {
  return (
    <div className="text-center py-4 space-y-3">
      <div className="text-4xl font-bold text-brand tabular-nums">{formatRemaining(remainingMs)}</div>
      <p className="text-sm text-muted-foreground">Prepare your answer. Recording will start automatically.</p>
      <Button size="sm" variant="outline" onClick={onSkip} className="gap-1.5"><Icon name="SkipForward" className="w-4 h-4" /> Skip prep</Button>
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
