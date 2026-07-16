// ============================================================================
// Phase8.1.3.6 — Decision integration through the Universal AI Core.
//
// Verifies that enabling Decision on recordAI: captures a decision block in the
// emitted FlightRecord (consuming reflection + qa + validation when enabled),
// fires the OnDecision middleware hook, does NOT mutate the returned response, is
// STREAMING-SAFE (runs only after the response is fully assembled, after
// Validation), and is byte-identical when disabled. Uses a mocked raw call so no
// network is required. Mirrors the Validation integration test layout.
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
import { DEFAULT_DECISION_CONFIG } from "./decision-engine";

beforeEach(() => {
  mockCallAI.mockReset();
  mockCallAIStreamed.mockReset();
  sink.mockReset();
  clearHooks();
  setFlightRecordSink(sink as any);
});

function parseRecord(): FlightRecord {
  // The QA/Reflection/Validation/Decision passes each emit their own FlightRecord,
  // so the MAIN record is the last sink call in each test.
  const last = sink.mock.calls[sink.mock.calls.length - 1][0];
  return JSON.parse(last.details) as FlightRecord;
}

describe("decision middleware integration", () => {
  it("captures a decision block in the FlightRecord when enabled", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });

    await recordAI(
      { userPrompt: "build a resume" },
      { scope: "resume-builder", decisionEnabled: true, decisionConfig: { ...DEFAULT_DECISION_CONFIG, decisionEnabled: true } },
    );

    const rec = parseRecord();
    expect(rec.decisionEnabled).toBe(true);
    expect(rec.decision).toBeDefined();
    expect(rec.decision!.status).toBe("accept"); // nothing upstream fired → all-engines-pass/continue→accept
    expect(rec.decision!.deterministic).toBe(true);
    expect(rec.diagnostics?.decisionEnabled).toBe(true);
    expect(rec.diagnostics?.decisionStatus).toBe("accept");
    expect(rec.timeline.some((s) => s.name === "decision")).toBe(true);
  });

  it("does NOT record decision when disabled (identical to before)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });
    const res = await recordAI({ userPrompt: "write a resume summary" });
    expect(res.text).toBe("final answer");
    const rec = parseRecord();
    expect(rec.decisionEnabled).toBe(false);
    expect(rec.decision).toBeUndefined();
    expect(rec.diagnostics?.decisionEnabled).toBe(false);
  });

  it("fires the OnDecision middleware hook (no bypass)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });

    const seen: string[] = [];
    registerHook("OnDecision", (ctx: any) => { seen.push(ctx.point); });

    await recordAI(
      { userPrompt: "x" },
      { decisionEnabled: true, decisionConfig: { ...DEFAULT_DECISION_CONFIG, decisionEnabled: true } },
    );
    expect(seen).toContain("OnDecision");
  });

  it("streaming is safe: decision runs after full assembly, response unchanged", async () => {
    const chunks: string[] = [];
    mockCallAIStreamed.mockImplementationOnce(async (_opts: any, onChunk: (t: string) => void) => {
      for (const c of ["chunk1", "chunk2"]) onChunk(c);
      return { text: "chunk1chunk2", provider: "Puter.js (streamed)", latencyMs: 10, tokensEstimate: 5, isLocalEngine: false };
    });

    const res = await recordAI(
      { userPrompt: "x", stream: true },
      { stream: true, onChunk: (c) => chunks.push(c), decisionEnabled: true, decisionConfig: { ...DEFAULT_DECISION_CONFIG, decisionEnabled: true } },
    );

    expect(chunks).toEqual(["chunk1", "chunk2"]);
    expect(res.text).toBe("chunk1chunk2");
    const rec = parseRecord();
    expect(rec.streaming).toBe(true);
    expect(rec.decision).toBeDefined();
  });

  it("consumes upstream verdicts: validation failure → reject decision", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });

    const { DEFAULT_VALIDATION_CONFIG } = await import("./validation-engine");
    await recordAI(
      { userPrompt: "x" },
      {
        scope: "resume-builder",
        decisionEnabled: true,
        decisionConfig: { ...DEFAULT_DECISION_CONFIG, decisionEnabled: true },
        validationEnabled: true,
        validationConfig: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true },
      },
    );
    const rec = parseRecord();
    // Response has no resume sections → validation fails → decision reject.
    expect(rec.decision!.status).toBe("reject");
  });
});
