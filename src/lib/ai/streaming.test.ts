// ============================================================================
// Phase 8.1.3.2B — Universal Streaming Integration (Flight Recorder + pipeline)
//
// Verifies: streaming executes through the SAME recordAI pipeline as
// non-streaming (no bypass of Flight Recorder / hooks / config), chunks are
// delivered to the consumer, streaming metadata is captured, and the hooks
// chain fires identically. Uses a mocked raw streaming function so no network
// or browser Puter dependency is required.
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

beforeEach(() => {
  mockCallAI.mockReset();
  mockCallAIStreamed.mockReset();
  sink.mockReset();
  clearHooks();
  setFlightRecordSink(sink as any);
});

function parseRecord(): FlightRecord {
  return JSON.parse(sink.mock.calls[0][0].details) as FlightRecord;
}

describe("streaming through recordAI", () => {
  it("delivers chunks to the consumer and returns the assembled result", async () => {
    const chunks: string[] = [];
    mockCallAIStreamed.mockImplementationOnce(async (_opts: any, onChunk: (t: string) => void) => {
      for (const c of ["Hello", " ", "world"]) onChunk(c);
      return { text: "Hello world", provider: "Puter.js (streamed)", latencyMs: 50, tokensEstimate: 4, isLocalEngine: false };
    });

    const res = await recordAI(
      { userPrompt: "hi", temperature: 0.3, taskCategory: "document", stream: true },
      { stream: true, onChunk: (c) => chunks.push(c) },
    );

    expect(res.text).toBe("Hello world");
    expect(chunks).toEqual(["Hello", " ", "world"]);
    expect(mockCallAIStreamed).toHaveBeenCalledTimes(1);
    expect(mockCallAI).not.toHaveBeenCalled(); // streaming path, not non-streaming
  });

  it("flags the record as streaming and captures chunkCount + streamMeta", async () => {
    mockCallAIStreamed.mockImplementationOnce(async (_opts: any, onChunk: (t: string) => void) => {
      for (const c of ["a", "b", "c", "d"]) onChunk(c);
      return { text: "abcd", provider: "Puter.js (streamed)", latencyMs: 10, tokensEstimate: 1, isLocalEngine: false };
    });

    await recordAI({ userPrompt: "x", stream: true }, { stream: true, onChunk: () => {} });

    const rec = parseRecord();
    expect(rec.streaming).toBe(true);
    expect(rec.diagnostics?.executionType).toBe("streaming");
    expect(rec.diagnostics?.chunkCount).toBe(4);
    expect(rec.diagnostics?.streamingStatus).toBe("completed");
    expect(rec.streamMeta?.chunkCount).toBe(4);
    expect(rec.streamMeta?.streamingStatus).toBe("completed");
    expect(rec.streamMeta?.streamingEndMs).toBeGreaterThanOrEqual(rec.streamMeta?.streamingStartMs ?? 0);
    // streaming span present in timeline
    expect(rec.timeline.some((s) => s.name === "streaming")).toBe(true);
  });

  it("passes through the full middleware hook chain (no bypass)", async () => {
    mockCallAIStreamed.mockImplementationOnce(async (_opts: any, onChunk: (t: string) => void) => {
      onChunk("x");
      return { text: "x", provider: "Puter.js (streamed)", latencyMs: 1, tokensEstimate: 1, isLocalEngine: false };
    });

    const seen: string[] = [];
    const points = ["BeforePrompt", "AfterPrompt", "BeforeContext", "AfterContext",
      "BeforeProvider", "AfterProvider", "BeforeResponse", "AfterResponse",
      "BeforePersist", "AfterPersist", "OnSuccess"] as const;
    for (const p of points) registerHook(p, (ctx: any) => { seen.push(ctx.point); });

    await recordAI({ userPrompt: "x", stream: true }, { stream: true, onChunk: () => {} });

    for (const p of points) expect(seen).toContain(p);
    expect(seen[seen.indexOf("BeforeProvider")]).toBe("BeforeProvider");
    expect(seen[seen.indexOf("AfterProvider")]).toBe("AfterProvider");
  });

  it("records abort status when the stream is aborted", async () => {
    mockCallAIStreamed.mockImplementationOnce(async () => {
      throw new DOMException("aborted", "AbortError");
    });

    const ac = new AbortController();
    await expect(
      recordAI({ userPrompt: "x", stream: true, signal: ac.signal }, { stream: true, onChunk: () => {} })
    ).rejects.toThrow();

    const rec = parseRecord();
    expect(rec.status).toBe("error");
    expect(rec.diagnostics?.streamingStatus).toBe("aborted");
    expect(rec.streamMeta?.streamingStatus).toBe("aborted");
  });

  it("non-streaming path is unchanged (callAIRaw, not callAIRawStreamed)", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "static", provider: "OpenAI", latencyMs: 5, tokensEstimate: 2, isLocalEngine: false });
    const chunks: string[] = [];
    await recordAI({ userPrompt: "x" }, { onChunk: (c) => chunks.push(c) });
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(mockCallAIStreamed).not.toHaveBeenCalled();
    expect(chunks).toEqual([]); // onChunk ignored on non-streaming
    expect(parseRecord().streaming).toBe(false);
  });
});
