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

  it("omits temperature for GPT-5 and reasoning models that reject custom temperatures", async () => {
    const chatMock = vi.fn((_msgs?: any, _opts?: any) => fakePuterStream([{ type: "text", text: "result" }]));
    (globalThis as any).window.puter.ai.chat = chatMock;

    await puterAdapter.stream(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0.15 },
      { id: "p", name: "Puter", type: "puter", modelName: "gpt-5.4-nano", timeout: 30000, maxTokens: 100, temperature: 0.15 } as any,
      () => {},
    );

    expect(chatMock).toHaveBeenCalledTimes(1);
    const calledOpts = chatMock.mock.calls[0]![1];
    expect(calledOpts.model).toBe("gpt-5.4-nano");
    expect(calledOpts.temperature).toBeUndefined();
  });

  it("omits temperature when model is omitted (Puter default is gpt-5-nano)", async () => {
    const chatMock = vi.fn((_msgs?: any, _opts?: any) => fakePuterStream([{ type: "text", text: "result" }]));
    (globalThis as any).window.puter.ai.chat = chatMock;

    await puterAdapter.stream(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0.15 },
      { id: "p", name: "Puter", type: "puter", timeout: 30000, maxTokens: 100 } as any,
      () => {},
    );

    expect(chatMock).toHaveBeenCalledTimes(1);
    const calledOpts = chatMock.mock.calls[0]![1];
    expect(calledOpts.temperature).toBeUndefined();
  });

  it("passes temperature for models that support it (e.g. gpt-4o, claude)", async () => {
    const chatMock = vi.fn((_msgs?: any, _opts?: any) => fakePuterStream([{ type: "text", text: "result" }]));
    (globalThis as any).window.puter.ai.chat = chatMock;

    await puterAdapter.stream(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0.3 },
      { id: "p", name: "Puter", type: "puter", modelName: "gpt-4o", timeout: 30000, maxTokens: 100 } as any,
      () => {},
    );

    expect(chatMock).toHaveBeenCalledTimes(1);
    const calledOpts = chatMock.mock.calls[0]![1];
    expect(calledOpts.temperature).toBe(0.3);
  });

  it("retries without temperature when puter.ai.chat throws a 400 temperature error", async () => {
    let callCount = 0;
    const chatMock = vi.fn((_msgs: any, _opts: any) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("400 Unsupported value: 'temperature' does not support 0.15 with this model. Only the default (1) value is supported.");
      }
      return fakePuterStream([{ type: "text", text: "recovered output" }]);
    });
    (globalThis as any).window.puter.ai.chat = chatMock;

    const chunks: string[] = [];
    // Force custom-model that wasn't caught by the regex initially
    const res = await puterAdapter.stream(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0.15 },
      { id: "p", name: "Puter", type: "puter", modelName: "custom-upstream-model", timeout: 30000, maxTokens: 100 } as any,
      (c: string) => chunks.push(c),
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    // First call had temperature
    expect(chatMock.mock.calls[0]![1].temperature).toBe(0.15);
    // Retry had temperature removed
    expect(chatMock.mock.calls[1]![1].temperature).toBeUndefined();
    expect(res.text).toBe("recovered output");
    expect(chunks).toEqual(["recovered output"]);
  });
});
