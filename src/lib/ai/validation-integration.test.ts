// ============================================================================
// Phase 8.1.3.5 — Validation integration through the Universal AI Core.
//
// Verifies that enabling Validation on recordAI: captures a validation block in
// the emitted FlightRecord (consuming reflection + qa when enabled), fires the
// OnValidation middleware hook, does NOT mutate the returned response, is
// STREAMING-SAFE (runs only after the response is fully assembled, after QA),
// and is byte-identical when disabled. Uses a mocked raw call so no network is
// required. Mirrors the QA integration test layout.
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
import { DEFAULT_VALIDATION_CONFIG } from "./validation-engine";

beforeEach(() => {
  mockCallAI.mockReset();
  mockCallAIStreamed.mockReset();
  sink.mockReset();
  clearHooks();
  setFlightRecordSink(sink as any);
});

function parseRecord(): FlightRecord {
  // The QA/Reflection/Validation passes each emit their own FlightRecord, so the
  // MAIN record is the last sink call in each test.
  const last = sink.mock.calls[sink.mock.calls.length - 1][0];
  return JSON.parse(last.details) as FlightRecord;
}

describe("validation middleware integration", () => {
  it("captures a validation block in the FlightRecord when enabled", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "Summary\nExperience\nEducation\nSkills\nContact: a@b.com +1 555 0100", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });

    await recordAI(
      { userPrompt: "build a resume" },
      { scope: "resume-builder", validationEnabled: true, validationConfig: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } },
    );

    const rec = parseRecord();
    expect(rec.validationEnabled).toBe(true);
    expect(rec.validation).toBeDefined();
    expect(rec.validation!.profile).toBe("resume-builder");
    expect(rec.validation!.outcome).toBe("passed");
    expect(rec.validation!.deterministic).toBe(true);
    expect(rec.diagnostics?.validationEnabled).toBe(true);
    expect(rec.diagnostics?.validationOutcome).toBe("passed");
    expect(rec.timeline.some((s) => s.name === "validation")).toBe(true);
  });

  it("does NOT record validation when disabled (identical to before)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "final answer", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });
    const res = await recordAI({ userPrompt: "write a resume summary" });
    expect(res.text).toBe("final answer");
    const rec = parseRecord();
    expect(rec.validationEnabled).toBe(false);
    expect(rec.validation).toBeUndefined();
    expect(rec.diagnostics?.validationEnabled).toBe(false);
  });

  it("fires the OnValidation middleware hook (no bypass)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "Summary\nExperience\nEducation\nSkills\nContact: a@b.com +1 555 0100", provider: "OpenAI", latencyMs: 50, tokensEstimate: 10, isLocalEngine: false });

    const seen: string[] = [];
    registerHook("OnValidation", (ctx: any) => { seen.push(ctx.point); });

    await recordAI(
      { userPrompt: "x" },
      { validationEnabled: true, validationConfig: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } },
    );
    expect(seen).toContain("OnValidation");
  });

  it("streaming is safe: validation runs after full assembly, response unchanged", async () => {
    const chunks: string[] = [];
    mockCallAIStreamed.mockImplementationOnce(async (_opts: any, onChunk: (t: string) => void) => {
      for (const c of ["chunk1", "chunk2"]) onChunk(c);
      return { text: "chunk1chunk2", provider: "Puter.js (streamed)", latencyMs: 10, tokensEstimate: 5, isLocalEngine: false };
    });

    const res = await recordAI(
      { userPrompt: "x", stream: true },
      { stream: true, onChunk: (c) => chunks.push(c), validationEnabled: true, validationConfig: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } },
    );

    expect(chunks).toEqual(["chunk1", "chunk2"]);
    expect(res.text).toBe("chunk1chunk2");
    const rec = parseRecord();
    expect(rec.streaming).toBe(true);
    expect(rec.validation).toBeDefined();
  });
});
