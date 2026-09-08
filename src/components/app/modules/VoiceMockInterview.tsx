"use client";

// ============================================================================
// VoiceMockInterview — real-time AI voice mock interview (recommendation #4).
//
// The missing piece between two existing surfaces:
//   • AiMockInterview — conversational AI, but TEXT-only answers.
//   • VoiceInterviewSession — speech I/O, but a fixed Sonru-style question
//     package evaluated after the fact, not a conversation.
//
// Here the AI asks questions OUT LOUD (browser speechSynthesis, chunked to
// dodge Chrome's long-utterance cutoff), the candidate answers by speaking
// (live Web Speech ASR with interim captions), and after every answer the AI
// gives one sentence of feedback plus the next question. Local delivery
// metrics (pace / fillers / substance) accrue per answer and roll up into a
// final report alongside an AI coaching summary.
//
// Reuses: useSpeechRecognition + useSpeechSynthesis (hooks/interview),
// analyzeFillerWords (via voice-conversation), recordAI routing (document
// task category — API providers, proven to follow the interview prompts),
// and the INTERVIEW_TOPICS config exported from CareerTools.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { toast } from "sonner";
import { recordAI } from "@/lib/ai/flight-recorder";
import { useSpeechRecognition, useSpeechSynthesis } from "@/hooks/interview";
import {
  buildFirstQuestionPrompt,
  buildNextQuestionPrompt,
  buildSummaryPrompt,
  buildVoiceReport,
  computeAnswerMetrics,
  parseInterviewerTurn,
  splitForSpeech,
  type InterviewTopicContext,
  type VoiceTurn,
  type VoiceReportConfig,
} from "@/lib/interview/voice-conversation";
import { INTERVIEW_TOPICS, POSITION_PRESETS, TOPIC_QUESTION_EXAMPLES } from "./CareerTools";

type Phase = "setup" | "session" | "report";
type SessionBusy = "idle" | "thinking" | "listening" | "evaluating";

const QUESTION_COUNTS = [3, 5, 8] as const;
const MIN_ANSWER_WORDS = 3;

export function VoiceMockInterview() {
  // ── setup state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("setup");
  const [topic, setTopic] = useState<string>("cabin-crew");
  const [position, setPosition] = useState<string>("");
  const [customPosition, setCustomPosition] = useState<string>("");
  const [targetQuestions, setTargetQuestions] = useState<number>(5);
  const [voiceURI, setVoiceURI] = useState<string>("");
  const [rate, setRate] = useState<number>(1);

  // ── session state ──────────────────────────────────────────────────────────
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [busy, setBusy] = useState<SessionBusy>("idle");
  const [currentQuestion, setCurrentQuestion] = useState<string>("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);

  // ── report state ───────────────────────────────────────────────────────────
  const [report, setReport] = useState<ReturnType<typeof buildVoiceReport> | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [summaryLoading, setSummaryLoading] = useState(false);

  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const answerStartRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnsRef = useRef<VoiceTurn[]>([]);
  turnsRef.current = turns;

  // Mirror the recognizer state into refs so async handlers (which capture a
  // render-time closure) can read the LATEST transcript after stop()+delay.
  const transcriptRef = useRef("");
  const interimRef = useRef("");
  useEffect(() => {
    transcriptRef.current = speech.transcript;
    interimRef.current = speech.interimTranscript;
  }, [speech.transcript, speech.interimTranscript]);

  const selectedTopic = INTERVIEW_TOPICS.find((t) => t.id === topic);
  const positionPresets = POSITION_PRESETS[topic] ?? [];
  const effectivePosition = customPosition.trim() || position || (selectedTopic?.label ?? "the role");

  const topicContext: InterviewTopicContext = useMemo(
    () => ({
      topicLabel: selectedTopic?.label ?? "General",
      topicDescription: selectedTopic?.description,
      position: effectivePosition,
      questionExamples: TOPIC_QUESTION_EXAMPLES[topic] ?? [],
    }),
    [selectedTopic, effectivePosition, topic],
  );

  const reportConfig: VoiceReportConfig = useMemo(
    () => ({ position: effectivePosition, topicLabel: selectedTopic?.label ?? "General", targetQuestions }),
    [effectivePosition, selectedTopic, targetQuestions],
  );

  const englishVoices = useMemo(
    () => tts.voices.filter((v) => v.lang?.toLowerCase().startsWith("en")),
    [tts.voices],
  );

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  /** Speak a question aloud (unless muted / unsupported). */
  const speakQuestion = useCallback(
    (text: string) => {
      if (!autoSpeak || !tts.supported) return;
      tts.speak(splitForSpeech(text), { voiceURI: voiceURI || undefined, rate });
    },
    [autoSpeak, tts, voiceURI, rate],
  );

  // ── session flow ───────────────────────────────────────────────────────────

  const askAI = useCallback(
    async (pair: { systemPrompt: string; userPrompt: string }): Promise<string> => {
      const res = await recordAI({
        systemPrompt: pair.systemPrompt,
        userPrompt: pair.userPrompt,
        maxTokens: 500,
        taskCategory: "document", // API providers — proven prompt followers
        temperature: 0.9,
      });
      return res.text ?? "";
    },
    [],
  );

  const startInterview = async () => {
    setPhase("session");
    setTurns([]);
    setError(null);
    setQuestionIndex(0);
    setSessionEnded(false);
    setReport(null);
    setSummary("");
    setBusy("thinking");
    try {
      const raw = await askAI(buildFirstQuestionPrompt(topicContext));
      const parsed = parseInterviewerTurn(raw);
      const q = parsed.question ?? raw;
      setTurns([{ role: "interviewer", text: raw, question: q, feedback: parsed.feedback, at: new Date().toISOString() }]);
      setCurrentQuestion(q);
      setQuestionIndex(1);
      scrollToBottom();
      speakQuestion(q);
    } catch (e: any) {
      setError(e?.message || "Failed to start the interview. Please try again.");
      toast.error(e?.message || "Failed to start the interview.");
      setPhase("setup");
    } finally {
      setBusy("idle");
    }
  };

  const beginAnswer = () => {
    if (busy !== "idle" || !speech.supported) return;
    tts.cancel();
    speech.reset();
    answerStartRef.current = Date.now();
    speech.start();
    setBusy("listening");
  };

  const finishAnswer = async () => {
    if (busy !== "listening") return;
    speech.stop();
    setBusy("evaluating");

    // Give the recognizer a beat to flush its final result after stop(), then
    // read the ref mirrors (state captured in this closure would be stale).
    await new Promise((r) => setTimeout(r, 500));
    const flushed = [transcriptRef.current.trim(), interimRef.current.trim()].filter(Boolean).join(" ");
    const transcript = flushed.trim();
    const durationMs = Date.now() - answerStartRef.current;

    // Nothing usable captured → let the user retry without advancing.
    if (transcript.split(/\s+/).filter(Boolean).length < MIN_ANSWER_WORDS) {
      speech.reset();
      setBusy("idle");
      toast.error("I didn't catch that — hold the mic and answer again.");
      return;
    }

    const metrics = computeAnswerMetrics(transcript, durationMs);
    const nextTurns: VoiceTurn[] = [
      ...turnsRef.current,
      { role: "candidate", text: transcript, metrics, at: new Date().toISOString() },
    ];
    setTurns(nextTurns);
    scrollToBottom();
    speech.reset();

    // Last question reached → wrap up into the report.
    if (questionIndex >= targetQuestions) {
      await endSession(nextTurns);
      return;
    }

    try {
      const raw = await askAI(
        buildNextQuestionPrompt(
          topicContext,
          nextTurns.map((t) => ({ role: t.role, text: t.text })),
          transcript,
        ),
      );
      const parsed = parseInterviewerTurn(raw);
      const q = parsed.question ?? raw;
      setTurns([...nextTurns, { role: "interviewer", text: raw, question: q, feedback: parsed.feedback, at: new Date().toISOString() }]);
      setCurrentQuestion(q);
      setQuestionIndex((i) => i + 1);
      scrollToBottom();
      speakQuestion(q);
    } catch (e: any) {
      setError(e?.message || "The interviewer lost the thread — try again.");
      toast.error(e?.message || "Failed to get the next question.");
    } finally {
      setBusy("idle");
    }
  };

  const skipQuestion = async () => {
    if (busy !== "idle") return;
    const nextTurns: VoiceTurn[] = [
      ...turnsRef.current,
      { role: "candidate", text: "", skipped: true, at: new Date().toISOString() },
    ];
    setTurns(nextTurns);
    if (questionIndex >= targetQuestions) {
      await endSession(nextTurns);
      return;
    }
    setBusy("thinking");
    try {
      const raw = await askAI(
        buildNextQuestionPrompt(
          topicContext,
          nextTurns.map((t) => ({ role: t.role, text: t.text || "(skipped)" })),
          "(The candidate skipped this question.)",
        ),
      );
      const parsed = parseInterviewerTurn(raw);
      const q = parsed.question ?? raw;
      setTurns([...nextTurns, { role: "interviewer", text: raw, question: q, feedback: parsed.feedback, at: new Date().toISOString() }]);
      setCurrentQuestion(q);
      setQuestionIndex((i) => i + 1);
      scrollToBottom();
      speakQuestion(q);
    } catch (e: any) {
      toast.error(e?.message || "Failed to move on.");
    } finally {
      setBusy("idle");
    }
  };

  const endSession = async (finalTurns?: VoiceTurn[]) => {
    tts.cancel();
    speech.stop();
    const allTurns = finalTurns ?? turnsRef.current;
    const rep = buildVoiceReport(allTurns, reportConfig);
    setReport(rep);
    setPhase("report");
    setSessionEnded(true);

    // AI coaching summary runs in the background — the metrics report shows first.
    setSummaryLoading(true);
    try {
      const text = await askAI(
        buildSummaryPrompt(
          topicContext,
          allTurns.map((t) => ({ role: t.role, text: t.text })),
        ),
      );
      setSummary(text.trim());
    } catch {
      setSummary(""); // metrics report still stands on its own
    } finally {
      setSummaryLoading(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const payload = {
      app: "ResumeAI Pro — Voice Mock Interview",
      generatedAt: new Date().toISOString(),
      config: { ...reportConfig, targetQuestions },
      turns: turns.map((t) => ({ role: t.role, text: t.text, skipped: t.skipped, metrics: t.metrics })),
      report,
      aiSummary: summary,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-interview-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded.");
  };

  const copyTranscript = () => {
    const text = turns
      .map((t) => `${t.role === "interviewer" ? "Q" : "A"}: ${t.text}`)
      .join("\n\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success("Transcript copied."),
      () => toast.error("Copy failed."),
    );
  };

  const testVoice = () => {
    tts.speak(splitForSpeech("This is how your interviewer will sound. Ready when you are."), {
      voiceURI: voiceURI || undefined,
      rate,
    });
  };

  // ── Setup screen ───────────────────────────────────────────────────────────
  if (phase === "setup") {
    const voiceReady = speech.supported && tts.supported;
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="AudioLines" className="w-6 h-6 text-brand" /> Voice Mock Interview
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            A real AI interviewer speaks questions aloud — you answer by voice. Live captions, delivery
            metrics, and a coaching report at the end.
          </p>
        </div>

        {!voiceReady && (
          <Card>
            <CardContent className="p-4 flex items-start gap-3">
              <Icon name="AlertTriangle" className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-semibold">Voice features need a compatible browser</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {!speech.supported && "Speech recognition (answering by voice) is unavailable here — Chrome or Edge on desktop works best. "}
                  {!tts.supported && "Speech synthesis (spoken questions) is unavailable here. "}
                  The AI mock interview still works with typed answers.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4 sm:p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">Topic</label>
                <select
                  value={topic}
                  onChange={(e) => { setTopic(e.target.value); setPosition(""); setCustomPosition(""); }}
                  className="w-full h-9 px-2 rounded border border-input bg-background text-sm"
                >
                  {INTERVIEW_TOPICS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">Position</label>
                <select
                  value={position}
                  onChange={(e) => { setPosition(e.target.value); setCustomPosition(""); }}
                  className="w-full h-9 px-2 rounded border border-input bg-background text-sm"
                >
                  <option value="">Custom / default</option>
                  {positionPresets.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">Custom position (optional)</label>
              <Input value={customPosition} onChange={(e) => setCustomPosition(e.target.value)} placeholder={effectivePosition} />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Questions</label>
                <div className="flex gap-2">
                  {QUESTION_COUNTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setTargetQuestions(n)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${targetQuestions === n ? "bg-brand text-white border-brand" : "bg-background border-border hover:bg-secondary"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Interviewer voice</label>
                <div className="flex gap-2">
                  <select
                    value={voiceURI}
                    onChange={(e) => setVoiceURI(e.target.value)}
                    className="flex-1 h-9 px-2 rounded border border-input bg-background text-xs"
                  >
                    <option value="">Default voice</option>
                    {englishVoices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" onClick={testVoice} disabled={!tts.supported} className="h-9 gap-1.5">
                    <Icon name="Volume2" className="w-3.5 h-3.5" /> Test
                  </Button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-muted-foreground shrink-0">Speed {rate.toFixed(1)}×</span>
                  <input
                    type="range" min={0.7} max={1.5} step={0.1} value={rate}
                    onChange={(e) => setRate(parseFloat(e.target.value))}
                    className="flex-1 accent-[hsl(var(--brand))]"
                  />
                </div>
              </div>
            </div>

            <Button onClick={startInterview} disabled={!voiceReady} className="w-full gap-2">
              <Icon name="Mic" className="w-4 h-4" /> Start voice interview
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              {targetQuestions} questions · answers spoken aloud · transcription happens in your browser
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Report screen ──────────────────────────────────────────────────────────
  if (phase === "report" && report) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <Icon name="ClipboardCheck" className="w-6 h-6 text-brand" /> Interview Report
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {reportConfig.position} · {reportConfig.topicLabel} · {report.totals.answered}/{report.totals.questions} answered
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copyTranscript} className="gap-1.5"><Icon name="Copy" className="w-3.5 h-3.5" /> Transcript</Button>
            <Button variant="outline" size="sm" onClick={downloadReport} className="gap-1.5"><Icon name="Download" className="w-3.5 h-3.5" /> JSON</Button>
            <Button size="sm" onClick={() => setPhase("setup")} className="gap-1.5"><Icon name="RotateCcw" className="w-3.5 h-3.5" /> New session</Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-5 flex flex-col items-center gap-2">
              <ScoreRing value={report.delivery.score} size={110} stroke={9} label="Delivery" />
              <p className="text-xs text-muted-foreground text-center leading-relaxed">{report.delivery.verdict}</p>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardContent className="p-5 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Avg pace", value: `${report.delivery.avgWpm} wpm`, icon: "Gauge" },
                  { label: "Filler words", value: String(report.delivery.totalFillers), icon: "MessageSquareX" },
                  { label: "Talk time", value: `${Math.round(report.totals.talkTimeMs / 1000)}s`, icon: "Timer" },
                  { label: "Skipped", value: String(report.totals.skipped), icon: "SkipForward" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border p-3 text-center">
                    <Icon name={s.icon} className="w-4 h-4 text-brand mx-auto mb-1" />
                    <div className="text-lg font-bold">{s.value}</div>
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-secondary/30 border border-border p-3">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">AI coaching summary</div>
                {summaryLoading ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-2"><Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> Reviewing your transcript…</p>
                ) : summary ? (
                  <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">{summary}</pre>
                ) : (
                  <p className="text-xs text-muted-foreground">Summary unavailable — the delivery metrics above still apply.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-5 space-y-2">
            <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5 mb-2">
              <Icon name="ListChecks" className="w-4 h-4 text-brand" /> Question-by-question
            </h3>
            {report.perQuestion.map((q) => (
              <div key={q.index} className="rounded-xl border border-border p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold text-foreground">{q.index}. {q.question}</p>
                  <Badge variant={q.skipped ? "outline" : q.score >= 85 ? "success" : q.score >= 60 ? "warning" : "danger"} className="text-[10px] shrink-0">
                    {q.skipped ? "skipped" : `${q.score}/100`}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">“{q.answerPreview}”</p>
                {!q.skipped && (
                  <p className="text-[10px] text-muted-foreground font-mono">{q.wpm} wpm · {q.fillers} filler{q.fillers === 1 ? "" : "s"}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Session screen ─────────────────────────────────────────────────────────
  const listening = busy === "listening";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-xl font-bold flex items-center gap-2">
            <Icon name="AudioLines" className="w-5 h-5 text-brand" /> Voice Interview
            <Badge variant="outline" className="text-[10px] font-mono">{questionIndex}/{targetQuestions}</Badge>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{reportConfig.position} · {reportConfig.topicLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
            <input type="checkbox" checked={autoSpeak} onChange={(e) => { setAutoSpeak(e.target.checked); if (!e.target.checked) tts.cancel(); }} className="rounded border-input" />
            <Icon name="Volume2" className="w-3.5 h-3.5" /> Read aloud
          </label>
          <Button variant="outline" size="sm" onClick={() => speakQuestion(currentQuestion)} disabled={tts.speaking || !currentQuestion} className="h-8 gap-1.5">
            <Icon name="Repeat" className="w-3.5 h-3.5" /> Repeat
          </Button>
          <Button variant="outline" size="sm" onClick={() => endSession()} className="h-8 gap-1.5">
            <Icon name="PhoneOff" className="w-3.5 h-3.5" /> End &amp; report
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
          <Icon name="AlertCircle" className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Conversation */}
      <div ref={scrollRef} className="rounded-xl border border-border bg-card p-4 space-y-3 overflow-y-auto scrollbar-thin" style={{ maxHeight: "calc(100vh - 340px)" }}>
        {turns.map((t, i) =>
          t.role === "interviewer" ? (
            <div key={i} className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                <Icon name="Bot" className="w-4 h-4 text-brand" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-secondary/50 border border-border px-3.5 py-2.5 max-w-[85%]">
                {t.feedback && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-1">{t.feedback}</p>}
                <p className="text-sm text-foreground leading-relaxed">{t.question ?? t.text}</p>
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2.5 justify-end">
              <div className={`rounded-2xl rounded-tr-sm px-3.5 py-2.5 max-w-[85%] border ${t.skipped ? "bg-secondary/20 border-dashed border-border" : "bg-brand/10 border-brand/20"}`}>
                <p className="text-sm text-foreground leading-relaxed">{t.skipped ? <em className="text-muted-foreground">— skipped —</em> : t.text}</p>
                {t.metrics && (
                  <p className="text-[10px] text-muted-foreground font-mono mt-1">
                    {t.metrics.wpm} wpm · {t.metrics.fillerCount} filler{t.metrics.fillerCount === 1 ? "" : "s"} · {t.metrics.score}/100
                  </p>
                )}
              </div>
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <Icon name="User" className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          ),
        )}

        {busy === "thinking" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pl-11">
            <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> The interviewer is thinking…
          </div>
        )}
        {tts.speaking && (
          <div className="flex items-center gap-2 text-xs text-brand pl-11">
            <Icon name="Volume2" className="w-3.5 h-3.5 animate-pulse" /> Speaking — your mic is paused.
          </div>
        )}
        {listening && speech.interimTranscript && (
          <div className="flex justify-end">
            <div className="rounded-2xl rounded-tr-sm bg-secondary/30 border border-dashed border-border px-3.5 py-2.5 max-w-[85%]">
              <p className="text-sm text-muted-foreground italic">{speech.interimTranscript}…</p>
            </div>
          </div>
        )}
      </div>

      {/* Mic controls */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
          {listening ? (
            <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" /> Listening — answer out loud, then press stop.</>
          ) : busy === "evaluating" ? (
            <><Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> Checking your answer…</>
          ) : (
            <><Icon name="Mic" className="w-3.5 h-3.5" /> Press the mic, answer, then press stop.</>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={skipQuestion} disabled={busy !== "idle"} className="h-9 gap-1.5">
            <Icon name="SkipForward" className="w-3.5 h-3.5" /> Skip
          </Button>
          {listening ? (
            <Button size="sm" onClick={finishAnswer} className="h-9 gap-1.5 bg-red-600 hover:bg-red-700 text-white">
              <Icon name="Square" className="w-3.5 h-3.5" /> Stop answer
            </Button>
          ) : (
            <Button size="sm" onClick={beginAnswer} disabled={busy !== "idle" || !speech.supported || tts.speaking} className="h-9 gap-1.5">
              <Icon name="Mic" className="w-3.5 h-3.5" /> Answer
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
