// ============================================================================
// Phase 8.1.3.2B — ProviderRouter.stream test.
//
// Verifies the SINGLE router's streaming entrypoint reuses the same fallback
// chain/cooldown/selection as chat() and pipes chunks through onChunk. The
// router is tested with a mocked store + a streaming-capable fake adapter so
// no network/browser Puter dependency is needed.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeAdapter = {
  type: "fake",
  chat: vi.fn(),
  testConnection: vi.fn(),
  stream: vi.fn(),
};

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers: [
        { id: "p1", name: "Fake", type: "fake", isActive: true, allowedForRegularUsers: true, modelName: "fake-model", priority: 50, retryAttempts: 0 },
      ],
      providerSettings: { fallbackProviderIds: [] },
      user: { role: "user" },
      addProviderLog: vi.fn(),
    }),
  },
  uid: () => "pl-test",
}));

vi.mock("./factory", () => ({
  ProviderFactory: { get: () => fakeAdapter },
  ProviderError: class extends Error {},
}));

vi.mock("../../../provider-cooldown", () => ({
  isProviderInCooldown: () => false,
  markProvider429Cooldown: vi.fn(),
  markProvider401Cooldown: vi.fn(),
  markProviderTimeoutCooldown: vi.fn(),
  recordTrafficCooldownFromError: vi.fn(), // traffic-vs-probe cooldown authority
  clearProviderCooldownOnSuccess: vi.fn(), // evidence-based early clear (P1)
  isTimeoutError: () => false,
  clearAllProviderCooldowns: vi.fn(),
}));

vi.mock("../../../rate-limit-tracker", () => ({
  rateLimitTracker: { isRateLimited: () => false, record429: vi.fn(), getCooldownRemainingMs: () => 0, recordSuccess: vi.fn() },
}));

vi.mock("../../../local-engine", () => ({ localGenerate: () => "" }));

import { ProviderRouter } from "./router";

beforeEach(() => {
  fakeAdapter.chat.mockReset();
  fakeAdapter.stream.mockReset();
});

describe("ProviderRouter.stream", () => {
  it("calls adapter.stream and pipes chunks through onChunk", async () => {
    fakeAdapter.stream.mockImplementationOnce(async (_req: any, _cfg: any, onChunk: (t: string) => void) => {
      onChunk("Hi");
      onChunk(" there");
      return { text: "Hi there", provider: "Fake (streamed)", model: "fake-model", latencyMs: 12 };
    });

    const chunks: string[] = [];
    const res = await ProviderRouter.stream(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0.5 },
      {},
      (c) => chunks.push(c),
    );

    expect(res.text).toBe("Hi there");
    expect(chunks).toEqual(["Hi", " there"]);
    expect(fakeAdapter.stream).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.chat).not.toHaveBeenCalled();
  });

  it("falls back to chat + chunked emission when adapter has no stream()", async () => {
    const chatOnlyAdapter = { type: "chatonly", chat: vi.fn(), testConnection: vi.fn() };
    // Swap the factory to return a non-streaming adapter for this test only.
    const { ProviderFactory } = await import("./factory");
    const prev = ProviderFactory.get;
    ProviderFactory.get = () => chatOnlyAdapter;
    chatOnlyAdapter.chat.mockResolvedValueOnce({ text: "abc def", provider: "ChatOnly", model: "m", latencyMs: 5 } as any);

    const chunks: string[] = [];
    try {
      const res = await ProviderRouter.stream(
        { messages: [{ role: "user", content: "hi" }] },
        {},
        (c) => chunks.push(c),
      );
      expect(res.text).toBe("abc def");
      expect(chunks.join("")).toContain("abc def"); // progressive through single path
      expect(chatOnlyAdapter.chat).toHaveBeenCalledTimes(1);
    } finally {
      ProviderFactory.get = prev;
    }
  });
});
