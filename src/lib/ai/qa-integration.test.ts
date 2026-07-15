// ============================================================================
// Phase 8.1.3.4 — QA integration through the Universal AI Core.
//
// Verifies that enabling QA on recordAI: captures a QA block in the emitted
// FlightRecord, fires the OnQA middleware hook, does NOT mutate the returned
// response, and is STREAMING-SAFE (runs only after the response is fully
// assembled). Uses a mocked raw call + a mocked QA pass so no network is
// required. Mirrors the Reflection integration test layout.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallAI = vi.fn();
const mockCallAIStreamed = vi.fn();
const sink = vi.fn();

vi.mock("@/lib/ai", () => ({
  callAIRaw: (...args: any[]) => mockCallAI(...args),
  callAIRawStreamed: (...args: any[]) => mockCallAIStreamed(...args),
  extractJSON: (raw: string) => JSON.parse(raw.replace(/```json|```/g, "").trim()),
}));

import {
  recordAI,
  setFlightRecordSink,
  type FlightRecord,
} from "./flight-recorder";
import { registerHook, clearHooks } from "./hooks";
import { DEFAULT_QA_CONFIG } from "./qa-engine";

beforeEach(() => {
  mockCallAI.mockReset();
  mockCallAIStreamed.mockReset();
  sink.mockReset();
  clearHooks();
  setFlightRecordSink(sink as any);
});

function parseRecord(): FlightRecord {
  // The QA pass also emits its own FlightRecord, so the MAIN record is the last
  // sink call in each test.
  const last = sink.mock.calls[sink.mock.calls.length - 1][0];
  return JSON.parse(last.details) as FlightRecord;
}

describe("qa middleware integration", () => {
  it("captures a QA block in the FlightRecord when enabled", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });
    // The QA pass is itself a recordAI call; mock the raw layer for it too.
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 88, confidence: 92, summary: "solid", failRecommended: false, hallucinationRisk: 0.1, policyRisk: 0.0, incompletenessRisk: 0.1, findings: [] }),
      provider: "OpenAI",
      latencyMs: 20,
      tokensEstimate: 30,
      isLocalEngine: false,
    });

    await recordAI(
      { userPrompt: "write a resume summary" },
      { qaEnabled: true, qaConfig: { ...DEFAULT_QA_CONFIG, qaEnabled: true } },
    );

    const rec = parseRecord();
    expect(rec.qaEnabled).toBe(true);
    expect(rec.qa).toBeDefined();
    expect(rec.qa!.score).toBe(88);
    expect(rec.qa!.outcome).toBe("passed");
    expect(rec.qa!.failRecommended).toBe(false);
    expect(rec.diagnostics?.qaEnabled).toBe(true);
    expect(rec.diagnostics?.qaScore).toBe(88);
    expect(rec.timeline.some((s) => s.name === "qa")).toBe(true);
  });

  it("does NOT record QA when disabled (identical to before)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });
    const res = await recordAI({ userPrompt: "write a resume summary" });
    expect(res.text).toBe("final answer");
    const rec = parseRecord();
    expect(rec.qaEnabled).toBe(false);
    expect(rec.qa).toBeUndefined();
    expect(rec.diagnostics?.qaEnabled).toBe(false);
  });

  it("fires the OnQA middleware hook (no bypass)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 70, confidence: 80, summary: "ok", failRecommended: false }),
      provider: "OpenAI",
      latencyMs: 20,
      tokensEstimate: 30,
      isLocalEngine: false,
    });

    const seen: string[] = [];
    registerHook("OnQA", (ctx: any) => { seen.push(ctx.point); });

    await recordAI(
      { userPrompt: "x" },
      { qaEnabled: true, qaConfig: { ...DEFAULT_QA_CONFIG, qaEnabled: true } },
    );
    expect(seen).toContain("OnQA");
  });

  it("streaming is safe: QA runs after full assembly, response unchanged", async () => {
    const chunks: string[] = [];
    mockCallAIStreamed.mockImplementationOnce(async (_opts: any, onChunk: (t: string) => void) => {
      for (const c of ["chunk1", "chunk2"]) onChunk(c);
      return { text: "chunk1chunk2", provider: "Puter.js (streamed)", latencyMs: 10, tokensEstimate: 5, isLocalEngine: false };
    });
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 90, confidence: 90, summary: "ok", failRecommended: false }),
      provider: "OpenAI",
      latencyMs: 20,
      tokensEstimate: 30,
      isLocalEngine: false,
    });

    const res = await recordAI(
      { userPrompt: "x", stream: true },
      { stream: true, onChunk: (c) => chunks.push(c), qaEnabled: true, qaConfig: { ...DEFAULT_QA_CONFIG, qaEnabled: true } },
    );

    // Chunks were delivered before QA; final text identical.
    expect(chunks).toEqual(["chunk1", "chunk2"]);
    expect(res.text).toBe("chunk1chunk2");
    const rec = parseRecord();
    expect(rec.streaming).toBe(true);
    expect(rec.qa).toBeDefined();
    expect(rec.qa!.score).toBe(90);
  });
});
