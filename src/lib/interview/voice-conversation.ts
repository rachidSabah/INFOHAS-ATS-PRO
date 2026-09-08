// ============================================================================
// ResumeAI Pro — Conversational voice mock interview engine (pure, tested).
//
// Bridges two existing surfaces into a NEW real-time experience:
//   • AiMockInterview (CareerTools) already runs a conversational AI loop,
//     but answers are TYPED.
//   • VoiceInterviewSession already records SPEECH, but against a fixed
//     question package evaluated after the fact (Sonru-style, not a
//     conversation).
// This module holds the pure logic for the missing piece: a live voice
// conversation where the AI speaks questions (TTS), the candidate answers
// out loud (live ASR), and delivery metrics + a final report come back.
//
// Everything here is deterministic and node-testable: turn parsing, delivery
// metrics, report aggregation, prompt builders, and TTS text splitting.
// ============================================================================
import { analyzeFillerWords } from "@/hooks/interview/useFillerWordDetector";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceAnswerMetrics {
  wordCount: number;
  /** Speaking pace, words per minute. */
  wpm: number;
  fillerCount: number;
  /** Fillers per word (0..1) — "um/uh/like" density. */
  fillerDensity: number;
  durationMs: number;
  /** 0–100 local delivery score (pace band + filler density + substance). */
  score: number;
}

export type VoiceTurnRole = "interviewer" | "candidate";

export interface VoiceTurn {
  role: VoiceTurnRole;
  /** Raw display text (full AI reply for interviewer, transcript for candidate). */
  text: string;
  /** Interviewer only — the extracted question (what TTS reads aloud). */
  question?: string;
  /** Interviewer only — feedback about the previous answer, when present. */
  feedback?: string;
  /** Candidate only — delivery metrics for this answer. */
  metrics?: VoiceAnswerMetrics;
  /** Candidate only — true when the question was skipped without an answer. */
  skipped?: boolean;
  at: string;
}

export interface ParsedInterviewerTurn {
  /** Feedback about the previous answer (everything before the question). */
  feedback?: string;
  /** The question to ask next (last sentence containing "?"). */
  question?: string;
  /** Full raw text — used for the transcript bubble. */
  displayText: string;
}

export interface VoiceReportConfig {
  position: string;
  topicLabel: string;
  /** Questions the user asked for up front (target of the session). */
  targetQuestions: number;
}

export interface VoiceReport {
  totals: {
    questions: number;
    answered: number;
    skipped: number;
    talkTimeMs: number;
  };
  delivery: {
    avgWpm: number;
    totalFillers: number;
    avgFillerDensity: number;
    score: number;
    verdict: string;
  };
  perQuestion: Array<{
    index: number;
    question: string;
    answerPreview: string;
    wpm: number;
    fillers: number;
    score: number;
    skipped: boolean;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI turn parsing — split "feedback + next question" from one AI reply
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split an interviewer reply into feedback + question.
 * Heuristic: the question is the LAST sentence that contains a "?";
 * everything before it (if anything) is feedback. Tolerates markdown
 * bullets and multi-line replies; never throws on garbage.
 */
export function parseInterviewerTurn(raw: string): ParsedInterviewerTurn {
  const displayText = (raw ?? "").trim();
  if (!displayText) return { displayText: "" };

  // Sentences = split after . ! ? followed by whitespace/end, keeping the delimiter.
  const sentences = displayText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return { displayText };

  let qIndex = -1;
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].includes("?")) {
      qIndex = i;
      break;
    }
  }
  if (qIndex === -1) {
    // No question mark anywhere — treat the whole reply as the prompt/question.
    return { question: displayText, displayText };
  }

  const question = sentences[qIndex];
  const feedback = sentences
    .slice(0, qIndex)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { feedback: feedback || undefined, question, displayText };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery metrics
// ─────────────────────────────────────────────────────────────────────────────

/** Ideal speaking pace band for interviews (words per minute). */
const WPM_MIN = 115;
const WPM_MAX = 175;
/** Filler density thresholds (fraction of words). */
const FILLER_WARN = 0.05;
const FILLER_BAD = 0.1;
/** Answers under this many words read as too thin for an interview. */
const MIN_SUBSTANCE_WORDS = 25;

/**
 * Local delivery score — deterministic, no AI:
 *   start 100; pace outside the band −1 per 3 wpm; filler density penalties;
 *   thin answer (under MIN_SUBSTANCE_WORDS) −15.
 */
export function scoreDelivery(m: Omit<VoiceAnswerMetrics, "score">): number {
  let score = 100;
  if (m.wpm > 0) {
    if (m.wpm < WPM_MIN) score -= Math.round((WPM_MIN - m.wpm) / 3);
    else if (m.wpm > WPM_MAX) score -= Math.round((m.wpm - WPM_MAX) / 3);
  } else {
    score -= 30; // no pace signal at all
  }
  if (m.fillerDensity >= FILLER_BAD) score -= 25;
  else if (m.fillerDensity >= FILLER_WARN) score -= 10;
  if (m.wordCount > 0 && m.wordCount < MIN_SUBSTANCE_WORDS) score -= 15;
  if (m.wordCount === 0) score = 0;
  return Math.max(0, Math.min(100, score));
}

/**
 * Compute delivery metrics for a spoken answer. Uses the shared
 * analyzeFillerWords (word count, fillers, wpm) and adds the score.
 */
export function computeAnswerMetrics(transcript: string, durationMs: number): VoiceAnswerMetrics {
  const stats = analyzeFillerWords(transcript ?? "", Math.max(0, durationMs ?? 0));
  const metrics: Omit<VoiceAnswerMetrics, "score"> = {
    wordCount: stats.wordCount,
    wpm: stats.wpm,
    fillerCount: stats.count,
    fillerDensity: stats.density,
    durationMs: Math.max(0, durationMs ?? 0),
  };
  return { ...metrics, score: scoreDelivery(metrics) };
}

/** Fallback duration from word count at a 150 wpm baseline (ms). */
export function estimateDurationMs(transcript: string): number {
  const words = (transcript ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / 150) * 60_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Report aggregation
// ─────────────────────────────────────────────────────────────────────────────

function verdictFor(score: number): string {
  if (score >= 85) return "Confident delivery — pace and clarity are on target.";
  if (score >= 70) return "Solid delivery with room to tighten pace or trim fillers.";
  if (score >= 50) return "Uneven delivery — practice pacing and cut filler words.";
  return "Delivery needs work — speak slower, pause instead of using fillers.";
}

/**
 * Aggregate a session's turns into a deterministic report. Interviewer turns
 * supply the questions; candidate turns supply metrics. Defensive against
 * malformed/partial sessions (e.g. user ends before the first answer).
 */
export function buildVoiceReport(turns: VoiceTurn[], config: VoiceReportConfig): VoiceReport {
  const safeTurns = Array.isArray(turns) ? turns : [];
  const interviewerTurns = safeTurns.filter((t) => t && t.role === "interviewer" && t.question);
  const candidateTurns = safeTurns.filter((t) => t && t.role === "candidate");
  const answered = candidateTurns.filter((t) => !t.skipped && (t.text ?? "").trim().length > 0);
  const skipped = candidateTurns.filter((t) => t.skipped).length;

  const perQuestion: VoiceReport["perQuestion"] = [];
  let answerCursor = 0;
  interviewerTurns.forEach((q, i) => {
    const answer = candidateTurns[answerCursor];
    answerCursor += 1;
    const skippedThis = !answer || answer.skipped;
    const metrics = skippedThis ? undefined : answer.metrics;
    perQuestion.push({
      index: i + 1,
      question: q.question ?? "",
      answerPreview: skippedThis ? "— skipped —" : (answer.text ?? "").trim().slice(0, 160),
      wpm: metrics?.wpm ?? 0,
      fillers: metrics?.fillerCount ?? 0,
      score: metrics?.score ?? 0,
      skipped: !!skippedThis,
    });
  });

  const talkTimeMs = answered.reduce((sum, t) => sum + (t.metrics?.durationMs ?? 0), 0);
  const withMetrics = answered.filter((t) => t.metrics && t.metrics.wpm > 0);
  const avgWpm = withMetrics.length
    ? Math.round(withMetrics.reduce((s, t) => s + (t.metrics?.wpm ?? 0), 0) / withMetrics.length)
    : 0;
  const totalFillers = answered.reduce((s, t) => s + (t.metrics?.fillerCount ?? 0), 0);
  const totalWords = answered.reduce((s, t) => s + (t.metrics?.wordCount ?? 0), 0);
  const avgFillerDensity = totalWords > 0 ? totalFillers / totalWords : 0;

  const deliveryScore = answered.length
    ? Math.round(answered.reduce((s, t) => s + (t.metrics?.score ?? 0), 0) / answered.length)
    : 0;

  return {
    totals: {
      questions: interviewerTurns.length,
      answered: answered.length,
      skipped,
      talkTimeMs,
    },
    delivery: {
      avgWpm,
      totalFillers,
      avgFillerDensity,
      score: deliveryScore,
      verdict: answered.length ? verdictFor(deliveryScore) : "No answers recorded in this session.",
    },
    perQuestion,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builders — mirror the proven AiMockInterview prompts, voice-adapted
// ─────────────────────────────────────────────────────────────────────────────

const SEED = () => Math.floor(Math.random() * 1_000_000);

export interface PromptPair {
  systemPrompt: string;
  userPrompt: string;
}

export interface InterviewTopicContext {
  topicLabel: string;
  topicDescription?: string;
  position: string;
  questionExamples?: string[];
}

function examplesBlock(examples?: string[]): string {
  const list = (examples ?? []).filter(Boolean);
  if (list.length === 0) return "";
  return `\n\nHere are EXAMPLES of the kind of questions to ask for this topic (do NOT use these exact words — generate similar ones):\n${list
    .map((q) => `- ${q}`)
    .join("\n")}\n\nCRITICAL: Your question MUST be relevant to the selected topic. Do NOT ask generic software engineering questions unless the topic is "Technical".`;
}

/** First question of the session — spoken aloud verbatim, so keep it short. */
export function buildFirstQuestionPrompt(ctx: InterviewTopicContext): PromptPair {
  const topic = ctx.topicDescription ? `Topic: ${ctx.topicLabel} (${ctx.topicDescription}). ` : `Topic: ${ctx.topicLabel}. `;
  return {
    systemPrompt:
      `You are an expert interviewer conducting a SPOKEN mock interview for a ${ctx.position} position. ${topic}` +
      `Ask ONE realistic interview question at a time — the kind a real interviewer would ask for this specific role and topic. ` +
      `The question will be read aloud by text-to-speech, so keep it under 45 words and conversational. Wait for the candidate's spoken answer. ` +
      `After each answer, give ONE sentence of specific feedback, then ask the next question. Always respond in plain text — NEVER return JSON.` +
      examplesBlock(ctx.questionExamples),
    userPrompt:
      `Start a spoken mock interview for: Position: ${ctx.position}. ${topic}\n` +
      `Ask the first question. It MUST be specific to the ${ctx.topicLabel} topic and the ${ctx.position} role.\n` +
      `\n[Session ID: ${SEED()} — generate a unique question]`,
  };
}

/** Next question — includes the full conversation so follow-ups stay coherent. */
export function buildNextQuestionPrompt(
  ctx: InterviewTopicContext,
  history: Array<{ role: "interviewer" | "candidate"; text: string }>,
  lastAnswer: string,
): PromptPair {
  const convo = history
    .slice(-10)
    .map((t) => `${t.role === "interviewer" ? "INTERVIEWER" : "CANDIDATE"}: ${t.text}`)
    .join("\n");
  return {
    systemPrompt:
      `You are an expert interviewer conducting a SPOKEN mock interview for a ${ctx.position} position. ${`Topic: ${ctx.topicLabel}. `}` +
      `The candidate just answered your question out loud (the transcript may contain speech-recognition errors — be forgiving). ` +
      `Give ONE sentence of specific feedback on their answer, then ask the next question on a DIFFERENT aspect of the role. ` +
      `The question will be read aloud by text-to-speech, so keep it under 45 words and conversational. ` +
      `Always respond in plain text — NEVER return JSON.` +
      examplesBlock(ctx.questionExamples),
    userPrompt:
      `Conversation so far:\n${convo}\n\nCANDIDATE (latest answer, via speech-to-text): ${lastAnswer}\n\n` +
      `Give your one-sentence feedback and ask the next question. It MUST stay relevant to the ${ctx.topicLabel} topic and the ${ctx.position} role.\n` +
      `\n[Session ID: ${SEED()} — generate a unique question]`,
  };
}

/** End-of-session overall assessment (displayed as plain text). */
export function buildSummaryPrompt(ctx: InterviewTopicContext, history: Array<{ role: "interviewer" | "candidate"; text: string }>): PromptPair {
  const convo = history
    .map((t) => `${t.role === "interviewer" ? "Q" : "A"}: ${t.text}`)
    .join("\n");
  return {
    systemPrompt:
      `You are an interview coach reviewing a full SPOKEN mock interview transcript for a ${ctx.position} position (topic: ${ctx.topicLabel}). ` +
      `Write a concise coaching summary in EXACTLY this plain-text format (no markdown, no JSON):\n` +
      `Strengths: <2 bullet-style sentences on what worked>\nImprovements: <2 bullet-style sentences on what to improve>\nOverall: <one-sentence verdict with a 0-100 readiness estimate like "Readiness: 72/100 — reason">.`,
    userPrompt: `Transcript:\n${convo}\n\nWrite the coaching summary now.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split text into utterance-sized chunks for speechSynthesis. Chrome cuts off
 * long utterances, so we split on sentence boundaries and cap chunk length —
 * never mid-sentence. Defensive against empty input.
 */
export function splitForSpeech(text: string, maxChars = 180): string[] {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const pushChunk = (piece: string) => {
    if (!piece) return;
    if (!current) {
      current = piece;
      return;
    }
    if ((current + " " + piece).length <= maxChars) {
      current = current + " " + piece;
    } else {
      chunks.push(current);
      current = piece;
    }
  };

  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      pushChunk(sentence);
      continue;
    }
    // Over-long sentence: chunk on word boundaries — never mid-word.
    let buf = "";
    for (const word of sentence.split(" ")) {
      if ((buf + " " + word).trim().length <= maxChars) {
        buf = (buf + " " + word).trim();
      } else {
        if (buf) chunks.push(buf);
        // Degenerate mega-word (no spaces within maxChars) — hard cap it.
        buf = word.length > maxChars ? word.slice(0, maxChars) : word;
      }
    }
    if (buf) chunks.push(buf);
    current = "";
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}
