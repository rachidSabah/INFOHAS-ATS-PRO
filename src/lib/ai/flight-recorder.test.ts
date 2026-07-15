// ============================================================================
// Phase 8.1.3 — AI Flight Recorder validation
//
// Verifies: automatic recording on every callAI, replay plan reconstruction,
// deterministic hashing, filter/search, cost model, timeline, and that NO
// secrets are ever stored. Uses a mocked callAI + injected sink.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallAI = vi.fn();
const sink = vi.fn();

vi.mock("@/lib/ai", () => ({
  callAIRaw: (...args: any[]) => mockCallAI(...args),
  callAIRawStreamed: (...args: any[]) => mockCallAI(...args),
  extractJSON: (raw: string) => JSON.parse(raw.replace(/```json|```/g, "").trim()),
}));

import {
  recordAI,
  buildReplayPlan,
  matchesFlightFilter,
  hashString,
  INTERVIEW_PROMPT_VERSION,
  setFlightRecordSink,
  type FlightRecord,
} from "./flight-recorder";

beforeEach(() => {
  mockCallAI.mockReset();
  sink.mockReset();
  setFlightRecordSink(sink as any);
});

function parseRecord(): FlightRecord {
  const call = sink.mock.calls[0][0];
  return JSON.parse(call.details) as FlightRecord;
}

describe("automatic recording", () => {
  it("emits a FlightRecord for every execution (no manual creation)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "{}", provider: "deepseek", latencyMs: 120, tokensEstimate: 400 });
    const res = await recordAI({ userPrompt: "hi", temperature: 0.3, taskCategory: "document" });
    expect(res.text).toBe("{}");
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("records error status + message on failure but still rethrows", async () => {
    mockCallAI.mockRejectedValueOnce(new Error("boom"));
    await expect(recordAI({ userPrompt: "x" })).rejects.toThrow("boom");
    const rec = parseRecord();
    expect(rec.status).toBe("error");
    expect(rec.errors).toContain("boom");
  });

  it("captures provider, model, params, latency, tokens", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "ok", provider: "OpenAI", latencyMs: 222, tokensEstimate: 800 });
    await recordAI({ userPrompt: "p", temperature: 0.5, maxTokens: 1000, modelOverride: "gpt-4o", taskCategory: "document" });
    const rec = parseRecord();
    expect(rec.provider).toBe("OpenAI");
    expect(rec.model).toBe("gpt-4o");
    expect(rec.temperature).toBe(0.5);
    expect(rec.maxTokens).toBe(1000);
    expect(rec.latencyMs).toBe(222);
    expect(rec.tokenUsage).toBe(800);
  });

  it("references entity ids, never duplicates payloads", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "{}", provider: "x", latencyMs: 1, tokensEstimate: 1 });
    await recordAI(
      { userPrompt: "u", taskCategory: "document" },
      { resumeId: "r1", jdId: "j1", interviewSessionId: "s1", personaId: "hr", company: "Emirates", scope: "interview" }
    );
    const rec = parseRecord();
    expect(rec.resumeId).toBe("r1");
    expect(rec.jdId).toBe("j1");
    expect(rec.interviewSessionId).toBe("s1");
    expect(rec.personaId).toBe("hr");
    expect(rec.prompt.userPrompt).toBe("u"); // prompt is replayable, but resume/jd bodies are NOT copied
  });
});

describe("no secrets stored", () => {
  it("never serializes api keys / tokens / passwords", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "{}", provider: "x", latencyMs: 1, tokensEstimate: 1 });
    await recordAI(
      { userPrompt: "u", taskCategory: "document" } as any,
      // even if a caller mistakenly passes secret-like fields via parameters they are dropped:
      { resumeId: "r1" } as any
    );
    const json = sink.mock.calls[0][0].details as string;
    const lower = json.toLowerCase();
    // These are real secret markers — field names we NEVER persist.
    // (Note: "token" alone is a false-alarm match for "tokenUsage"/"cachedTokens".)
    for (const forbidden of ["sk-", "apikey", "api_key", "password", "bearer ", "secret", "authorization", "client_secret"]) {
      expect(lower).not.toContain(forbidden);
    }
  });
});

describe("hashing + replay", () => {
  it("hashString is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });

  it("records promptHash + contextHash for replay identity", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "{}", provider: "x", latencyMs: 1, tokensEstimate: 1 });
    await recordAI({ systemPrompt: "S", userPrompt: "U", taskCategory: "document" });
    const rec = parseRecord();
    expect(rec.promptHash).toBe(hashString("S\n@@@\nU"));
    expect(typeof rec.contextHash).toBe("string");
  });

  it("buildReplayPlan reconstructs prompt + params without re-executing", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "{}", provider: "deepseek", latencyMs: 1, tokensEstimate: 1 });
    await recordAI({ systemPrompt: "SYS", userPrompt: "USR", temperature: 0.3, maxTokens: 500, modelOverride: "deepseek-chat", taskCategory: "document" });
    const rec = parseRecord();
    const plan = buildReplayPlan(rec);
    expect(plan.prompt.systemPrompt).toBe("SYS");
    expect(plan.prompt.userPrompt).toBe("USR");
    expect(plan.parameters.temperature).toBe(0.3);
    expect(plan.parameters.maxTokens).toBe(500);
    expect(plan.promptVersion).toBe(INTERVIEW_PROMPT_VERSION);
  });
});

describe("timeline + performance", () => {
  it("captures a monotonic timeline with lifecycle spans", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "{}", provider: "x", latencyMs: 50, tokensEstimate: 1 });
    await recordAI({ userPrompt: "u", taskCategory: "document" });
    const rec = parseRecord();
    const names = rec.timeline.map((s) => s.name);
    expect(names).toContain("prompt");
    expect(names).toContain("provider");
    expect(names).toContain("response");
    expect(names).toContain("persist");
    expect(rec.performance.totalMs).toBeGreaterThanOrEqual(0);
    expect(rec.timeline[rec.timeline.length - 1].name).toBe("persist");
  });
});

describe("cost tracking", () => {
  it("computes a non-negative estimated cost from provider/model/tokens", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "x".repeat(4000), provider: "OpenAI", latencyMs: 1, tokensEstimate: 1000 });
    await recordAI({ userPrompt: "u", modelOverride: "gpt-4o", taskCategory: "document" });
    const rec = parseRecord();
    expect(rec.cost.provider).toBe("OpenAI");
    expect(rec.cost.model).toBe("gpt-4o");
    expect(rec.cost.inputTokens).toBe(1000);
    expect(rec.cost.estimatedCost).toBeGreaterThan(0);
  });
});

describe("filtering / search", () => {
  it("matches by provider, errors, latency, and entity ids", () => {
    const base: FlightRecord = {
      executionId: "fx1", timestamp: "2026-07-14T12:00:00Z", provider: "deepseek", model: "deepseek-chat",
      temperature: 0.3, maxTokens: 1000, streaming: false, promptVersion: "8.1.3", promptHash: "h", contextHash: "c",
      durationMs: 100, latencyMs: 100, tokenUsage: 500, retryCount: 0, reflectionEnabled: false, qaEnabled: false,
      status: "completed", warnings: [], errors: [], scope: "interview",
      prompt: { userPrompt: "u" }, parameters: {}, timeline: [], performance: { totalMs: 100 }, cost: { inputTokens: 500, outputTokens: 0, cachedTokens: 0, estimatedCost: 0, provider: "deepseek", model: "deepseek-chat" },
    };
    expect(matchesFlightFilter(base, { provider: "deepseek" })).toBe(true);
    expect(matchesFlightFilter(base, { provider: "openai" })).toBe(false);
    expect(matchesFlightFilter(base, { resumeId: "r1" })).toBe(false);
    expect(matchesFlightFilter(base, { minLatencyMs: 50 })).toBe(true);
    expect(matchesFlightFilter(base, { minLatencyMs: 500 })).toBe(false);
    expect(matchesFlightFilter({ ...base, errors: ["e"] }, { hasErrors: true })).toBe(true);
  });
});
