// ============================================================================
// Phase 8.1.3.2B — Puter provider streaming adapter test.
//
// Verifies the ONLY native streaming source (Puter.js window.puter.ai.chat,
// an AsyncIterable) pipes text chunks through onChunk and assembles them into
// a ChatResponse. Uses a fake async iterable + stubbed canonical provider lookup;
// no real network / SDK.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub the canonical Puter provider lookup so no real SSO/session module loads.
vi.mock("../../providers/puter-provider", () => ({
  getPuterProvider: () => ({ isAuthenticated: () => true }),
}));

// Minimal in-memory async iterable that mimics window.puter.ai.chat({stream:true}).
function fakePuterStream(parts: Array<{ type: string; text?: string; message?: string } | string>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const p of parts) yield p;
    },
  };
}

describe("PuterProvider.stream", () => {
  let puterAdapter: any;

  beforeEach(async () => {
    (globalThis as any).window = {
      location: { hostname: "example.com" },
      puter: { ai: { chat: vi.fn(() => fakePuterStream([
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
      ])) } },
    };
    vi.resetModules();
    const mod = await import("./puter");
    puterAdapter = new mod.PuterProvider();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    vi.restoreAllMocks();
  });

  it("streams text chunks via onChunk and assembles the full response", async () => {
    const chunks: string[] = [];
    const res = await puterAdapter.stream(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0.5 },
      { id: "p", name: "Puter", type: "puter", modelName: "gpt-4o", timeout: 30000, maxTokens: 100, temperature: 0.7 } as any,
      (c: string) => chunks.push(c),
    );

    expect(res.text).toBe("Hello world");
    expect(chunks).toEqual(["Hello", " world"]);
    expect(res.provider).toContain("streamed");
  });

  it("rejects on an error part from the stream", async () => {
    (globalThis as any).window.puter.ai.chat = vi.fn(() => fakePuterStream([
      { type: "text", text: "partial" },
      { type: "error", message: "rate limited" },
    ]));
    await expect(
      puterAdapter.stream(
        { messages: [{ role: "user", content: "hi" }] },
        { id: "p", name: "Puter", type: "puter", modelName: "gpt-4o", timeout: 30000, maxTokens: 100, temperature: 0.7 } as any,
        () => {},
      )
    ).rejects.toThrow(/rate limited/);
  });
});
