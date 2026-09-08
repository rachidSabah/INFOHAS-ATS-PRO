// ============================================================================
// Voice mock interview — conversation engine tests (pure functions, node env)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  parseInterviewerTurn,
  computeAnswerMetrics,
  scoreDelivery,
  estimateDurationMs,
  buildVoiceReport,
  buildFirstQuestionPrompt,
  buildNextQuestionPrompt,
  buildSummaryPrompt,
  splitForSpeech,
  type VoiceTurn,
} from "./voice-conversation";

const ctx = {
  topicLabel: "Cabin Crew / Flight Attendant",
  topicDescription: "Aviation service, safety, emergency procedures",
  position: "Cabin Crew (Emirates)",
  questionExamples: ["Tell me about a difficult passenger."],
};

// ── parseInterviewerTurn ─────────────────────────────────────────────────────
describe("parseInterviewerTurn", () => {
  it("splits feedback from the final question", () => {
    const r = parseInterviewerTurn(
      "Good answer — you used the STAR structure well. Now, tell me about a time you handled a medical emergency onboard?",
    );
    expect(r.feedback).toBe("Good answer — you used the STAR structure well.");
    expect(r.question).toBe("Now, tell me about a time you handled a medical emergency onboard?");
    expect(r.displayText).toContain("medical emergency");
  });

  it("returns only the question when there is no feedback", () => {
    const r = parseInterviewerTurn("Why do you want to work for this airline?");
    expect(r.feedback).toBeUndefined();
    expect(r.question).toBe("Why do you want to work for this airline?");
  });

  it("uses the LAST question sentence when several contain ?", () => {
    const r = parseInterviewerTurn("Hmm, interesting? Anyway — what would you do if a passenger refused to fasten their seatbelt?");
    expect(r.question).toBe("Anyway — what would you do if a passenger refused to fasten their seatbelt?");
    expect(r.feedback).toContain("Hmm, interesting?");
  });

  it("treats a reply without ? as a question prompt (defensive)", () => {
    const r = parseInterviewerTurn("Please describe your experience with safety procedures.");
    expect(r.question).toContain("safety procedures");
    expect(r.feedback).toBeUndefined();
  });

  it("never throws on garbage or empty input", () => {
    expect(parseInterviewerTurn("").displayText).toBe("");
    expect(parseInterviewerTurn(undefined as unknown as string).displayText).toBe("");
    expect(parseInterviewerTurn("   ").question).toBeUndefined();
  });
});

// ── metrics & scoring ────────────────────────────────────────────────────────
describe("computeAnswerMetrics and scoreDelivery", () => {
  it("counts words, fillers and derives wpm from duration", () => {
    // 120 words in 60s → 120 wpm. Add 6 fillers → density 0.05.
    const words = Array.from({ length: 120 }, (_, i) => (i % 20 === 0 ? "um" : `word${i}`)).join(" ");
    const m = computeAnswerMetrics(words, 60_000);
    expect(m.wordCount).toBe(120);
    expect(m.fillerCount).toBe(6);
    expect(m.wpm).toBe(120);
    expect(m.fillerDensity).toBeCloseTo(0.05, 5);
  });

  it("scores a clean, in-band, substantial answer high", () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const m = computeAnswerMetrics(words, 60_000); // 120 wpm, 0 fillers
    expect(m.score).toBeGreaterThanOrEqual(95);
  });

  it("penalizes fast speech, heavy fillers and thin answers", () => {
    const fast = scoreDelivery({ wordCount: 100, wpm: 265, fillerCount: 0, fillerDensity: 0, durationMs: 22_600 });
    expect(fast).toBeLessThan(75); // (265-175)/3 = 30 penalty
    const fillers = scoreDelivery({ wordCount: 100, wpm: 140, fillerCount: 12, fillerDensity: 0.12, durationMs: 42_800 });
    expect(fillers).toBe(75); // 100 - 25 (density ≥ 0.1)
    const thin = scoreDelivery({ wordCount: 10, wpm: 150, fillerCount: 0, fillerDensity: 0, durationMs: 4_000 });
    expect(thin).toBe(85); // 100 - 15 (substance)
  });

  it("zero-word transcripts score 0 and stay clamped", () => {
    expect(computeAnswerMetrics("", 10_000).score).toBe(0);
    expect(scoreDelivery({ wordCount: 0, wpm: 0, fillerCount: 0, fillerDensity: 0, durationMs: 0 })).toBe(0);
    expect(scoreDelivery({ wordCount: 5, wpm: 999, fillerCount: 9, fillerDensity: 1, durationMs: 300 })).toBeGreaterThanOrEqual(0);
  });

  it("estimates duration from words at 150 wpm baseline", () => {
    expect(estimateDurationMs("one two three")).toBe(Math.round((3 / 150) * 60_000));
    expect(estimateDurationMs("")).toBe(0);
    expect(estimateDurationMs(null as unknown as string)).toBe(0);
  });
});

// ── report aggregation ───────────────────────────────────────────────────────
function interviewer(q: string, feedback?: string): VoiceTurn {
  return { role: "interviewer", text: `${feedback ?? ""} ${q}`.trim(), question: q, feedback, at: new Date().toISOString() };
}
function candidate(text: string, metrics?: VoiceTurn["metrics"], skipped = false): VoiceTurn {
  return { role: "candidate", text, metrics, skipped, at: new Date().toISOString() };
}

describe("buildVoiceReport", () => {
  const config = { position: "Cabin Crew (Emirates)", topicLabel: "Cabin Crew", targetQuestions: 3 };

  it("aggregates answered questions with their metrics", () => {
    const turns: VoiceTurn[] = [
      interviewer("Q1 about safety?"),
      candidate("A solid forty-word answer about safety.", {
        wordCount: 120, wpm: 140, fillerCount: 2, fillerDensity: 0.017, durationMs: 51_400, score: 90,
      }),
      interviewer("Q2 about service?", "Nice one."),
      candidate("Another answer with metrics.", {
        wordCount: 100, wpm: 160, fillerCount: 0, fillerDensity: 0, durationMs: 37_500, score: 95,
      }),
    ];
    const r = buildVoiceReport(turns, config);
    expect(r.totals.questions).toBe(2);
    expect(r.totals.answered).toBe(2);
    expect(r.totals.talkTimeMs).toBe(51_400 + 37_500);
    expect(r.delivery.avgWpm).toBe(150);
    expect(r.delivery.totalFillers).toBe(2);
    expect(r.delivery.score).toBe(93); // Math.round((90 + 95) / 2) = 93
    expect(r.perQuestion[0].question).toBe("Q1 about safety?");
    expect(r.perQuestion[0].score).toBe(90);
    expect(r.perQuestion[1].skipped).toBe(false);
    expect(r.delivery.verdict).toContain("delivery");
  });

  it("counts skipped answers and keeps them out of the averages", () => {
    const turns: VoiceTurn[] = [
      interviewer("Q1?"),
      candidate("", undefined, true),
      interviewer("Q2?"),
      candidate("An answer.", { wordCount: 120, wpm: 140, fillerCount: 0, fillerDensity: 0, durationMs: 51_400, score: 90 }),
    ];
    const r = buildVoiceReport(turns, config);
    expect(r.totals.skipped).toBe(1);
    expect(r.totals.answered).toBe(1);
    expect(r.delivery.avgWpm).toBe(140);
    expect(r.perQuestion[0].skipped).toBe(true);
    expect(r.perQuestion[0].answerPreview).toBe("— skipped —");
  });

  it("handles an empty session defensively", () => {
    const r = buildVoiceReport([], config);
    expect(r.totals.questions).toBe(0);
    expect(r.delivery.score).toBe(0);
    expect(r.delivery.verdict).toContain("No answers recorded");
  });

  it("is defensive against null/garbage turns arrays", () => {
    const r = buildVoiceReport(null as unknown as VoiceTurn[], config);
    expect(r.totals.questions).toBe(0);
    expect(buildVoiceReport([{ role: "garbage" } as unknown as VoiceTurn], config).totals.questions).toBe(0);
  });
});

// ── prompt builders ──────────────────────────────────────────────────────────
describe("prompt builders", () => {
  it("first-question prompt pins topic, position and TTS length constraint", () => {
    const p = buildFirstQuestionPrompt(ctx);
    expect(p.systemPrompt).toContain("Cabin Crew (Emirates)");
    expect(p.systemPrompt).toContain("SPOKEN");
    expect(p.systemPrompt).toContain("under 45 words");
    expect(p.systemPrompt).toContain("NEVER return JSON");
    expect(p.userPrompt).toContain("first question");
    expect(p.userPrompt).toContain("Session ID:");
  });

  it("next-question prompt carries conversation history and the latest answer", () => {
    const history = [
      { role: "interviewer" as const, text: "Q1?" },
      { role: "candidate" as const, text: "My answer about safety." },
    ];
    const p = buildNextQuestionPrompt(ctx, history, "My answer about safety.");
    expect(p.userPrompt).toContain("INTERVIEWER: Q1?");
    expect(p.userPrompt).toContain("CANDIDATE: My answer about safety.");
    expect(p.systemPrompt).toContain("speech-recognition errors");
  });

  it("summary prompt requests the fixed plain-text sections", () => {
    const p = buildSummaryPrompt(ctx, [
      { role: "interviewer", text: "Q?" },
      { role: "candidate", text: "A." },
    ]);
    expect(p.systemPrompt).toContain("Strengths:");
    expect(p.systemPrompt).toContain("Improvements:");
    expect(p.systemPrompt).toContain("Overall:");
    expect(p.userPrompt).toContain("Q: Q?");
    expect(p.userPrompt).toContain("A: A.");
  });

  it("works without optional topic context fields", () => {
    const p = buildFirstQuestionPrompt({ topicLabel: "Technical", position: "Data Scientist" });
    expect(p.systemPrompt).toContain("Technical");
    expect(p.systemPrompt).not.toContain("EXAMPLES");
  });
});

// ── TTS splitting ────────────────────────────────────────────────────────────
describe("splitForSpeech", () => {
  it("returns short text as a single chunk", () => {
    expect(splitForSpeech("Short question?")).toEqual(["Short question?"]);
    expect(splitForSpeech("")).toEqual([]);
    expect(splitForSpeech("   ")).toEqual([]);
  });

  it("splits long text on sentence boundaries only", () => {
    const text = "First sentence is fairly long and sets the context for the interview overall. Second sentence asks the actual question now?";
    const chunks = splitForSpeech(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(60);
      expect(c.endsWith(" ")).toBe(false);
    }
    // Rejoining preserves the full text (whitespace aside).
    expect(chunks.join(" ")).toBe(text);
  });

  it("never cuts mid-word for an over-long sentence without punctuation", () => {
    const long = "word ".repeat(80).trim(); // no sentence punctuation
    const chunks = splitForSpeech(long, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    expect(chunks.join(" ").split(/\s+/).length).toBe(80);
  });

  it("collapses whitespace before splitting", () => {
    const chunks = splitForSpeech("Hello   there.  How   are you?", 30);
    expect(chunks.join(" ")).toBe("Hello there. How are you?");
  });
});
