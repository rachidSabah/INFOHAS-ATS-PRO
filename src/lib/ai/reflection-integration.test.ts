// ============================================================================
// Phase 8.1.3.3 — Reflection integration through the Universal AI Core.
//
// Verifies that enabling reflection on recordAI: captures a reflection block
// in the emitted FlightRecord, fires the OnReflection middleware hook, does NOT
// mutate the returned response, and is STREAMING-SAFE (runs only after the
// response is fully assembled). Uses a mocked raw call + a mocked reflection
// pass so no network is required.
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
import { DEFAULT_REFLECTION_CONFIG } from "./reflection-engine";

beforeEach(() => {
  mockCallAI.mockReset();
  mockCallAIStreamed.mockReset();
  sink.mockReset();
  clearHooks();
  setFlightRecordSink(sink as any);
});

function parseRecord(): FlightRecord {
  // The reflection pass also emits its own FlightRecord, so the MAIN record is
  // the last sink call in each test.
  const last = sink.mock.calls[sink.mock.calls.length - 1][0];
  return JSON.parse(last.details) as FlightRecord;
}

describe("reflection middleware integration", () => {
  it("captures a reflection block in the FlightRecord when enabled", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });
    // The reflection pass is itself a recordAI call; mock the raw layer for it too.
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 88, confidence: 92, summary: "solid", retryRecommended: false, hallucinationRisk: 0.1, determinismRisk: 0.1 }),
      provider: "OpenAI",
      latencyMs: 20,
      tokensEstimate: 30,
      isLocalEngine: false,
    });

    await recordAI(
      { userPrompt: "write a resume summary" },
      { reflectionEnabled: true, reflectionConfig: { ...DEFAULT_REFLECTION_CONFIG, reflectionEnabled: true } },
    );

    const rec = parseRecord();
    expect(rec.reflectionEnabled).toBe(true);
    expect(rec.reflection).toBeDefined();
    expect(rec.reflection!.score).toBe(88);
    expect(rec.reflection!.outcome).toBe("ok");
    expect(rec.reflection!.retryRecommended).toBe(false);
    expect(rec.diagnostics?.reflectionEnabled).toBe(true);
    expect(rec.diagnostics?.reflectionScore).toBe(88);
    expect(rec.timeline.some((s) => s.name === "reflection")).toBe(true);
  });

  it("does NOT record reflection when disabled (identical to before)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });
    const res = await recordAI({ userPrompt: "write a resume summary" });
    expect(res.text).toBe("final answer");
    const rec = parseRecord();
    expect(rec.reflectionEnabled).toBe(false);
    expect(rec.reflection).toBeUndefined();
    expect(rec.diagnostics?.reflectionEnabled).toBe(false);
  });

  it("fires the OnReflection middleware hook (no bypass)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 70, confidence: 80, summary: "ok", retryRecommended: false }),
      provider: "OpenAI",
      latencyMs: 20,
      tokensEstimate: 30,
      isLocalEngine: false,
    });

    const seen: string[] = [];
    registerHook("OnReflection", (ctx: any) => { seen.push(ctx.point); });

    await recordAI(
      { userPrompt: "x" },
      { reflectionEnabled: true, reflectionConfig: { ...DEFAULT_REFLECTION_CONFIG, reflectionEnabled: true } },
    );
    expect(seen).toContain("OnReflection");
  });

  it("streaming is safe: reflection runs after full assembly, response unchanged", async () => {
    const chunks: string[] = [];
    mockCallAIStreamed.mockImplementationOnce(async (_opts: any, onChunk: (t: string) => void) => {
      for (const c of ["chunk1", "chunk2"]) onChunk(c);
      return { text: "chunk1chunk2", provider: "Puter.js (streamed)", latencyMs: 10, tokensEstimate: 5, isLocalEngine: false };
    });
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 90, confidence: 90, summary: "ok", retryRecommended: false }),
      provider: "OpenAI",
      latencyMs: 20,
      tokensEstimate: 30,
      isLocalEngine: false,
    });

    const res = await recordAI(
      { userPrompt: "x", stream: true },
      { stream: true, onChunk: (c) => chunks.push(c), reflectionEnabled: true, reflectionConfig: { ...DEFAULT_REFLECTION_CONFIG, reflectionEnabled: true } },
    );

    // Chunks were delivered before reflection; final text identical.
    expect(chunks).toEqual(["chunk1", "chunk2"]);
    expect(res.text).toBe("chunk1chunk2");
    const rec = parseRecord();
    expect(rec.streaming).toBe(true);
    expect(rec.reflection).toBeDefined();
    expect(rec.reflection!.score).toBe(90);
  });
});
