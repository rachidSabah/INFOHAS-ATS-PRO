import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { ClaudeProvider } from "./providers/claude";
import { GeminiProvider } from "./providers/gemini";
import { toProviderConfig } from "./services/fallback";
import type { AIProvider } from "../types";

// Capture the body each adapter sends, without hitting the network.
function mockFetchOnce(bodyCapture: { value?: any }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: any) => {
      bodyCapture.value = init ? JSON.parse(init.body) : undefined;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function fakeProvider(over: Partial<AIProvider> = {}): AIProvider {
  return {
    id: "p1", name: "Test", type: "openai", providerCategory: "api",
    supportsServerSide: true, supportsClientSide: false, supportsStreaming: false,
    supportsFunctionCalling: false, supportsJsonMode: false, requiresBrowserAuth: false,
    requiresApiKey: false, priority: 1, isActive: true, timeout: 30000,
    maxTokens: 1024, temperature: 0.7, retryAttempts: 1, status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
    ...over,
  } as unknown as AIProvider;
}

describe("Top-P propagation (Phase 8.1.3.2A)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("propagates topP through toProviderConfig", () => {
    const cfg = toProviderConfig(fakeProvider({ topP: 0.9 }));
    expect(cfg.topP).toBe(0.9);
  });

  it("sends top_p to OpenAI-compatible body when set on request", async () => {
    const cap: any = {};
    mockFetchOnce(cap);
    const p = new OpenAICompatibleProvider("openai");
    await p.chat(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0.5, topP: 0.85 },
      { ...toProviderConfig(fakeProvider({ topP: 0.5 })) },
    );
    expect(cap.value.top_p).toBe(0.85); // request value wins over config default
  });

  it("falls back to provider-config top_p when not on request", async () => {
    const cap: any = {};
    mockFetchOnce(cap);
    const p = new OpenAICompatibleProvider("openai");
    await p.chat(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
      { ...toProviderConfig(fakeProvider({ topP: 0.42 })) },
    );
    expect(cap.value.top_p).toBe(0.42);
  });

  it("sends top_p to Claude body", async () => {
    const cap: any = {};
    mockFetchOnce(cap);
    const p = new ClaudeProvider();
    await p.chat(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, topP: 0.77 },
      { ...toProviderConfig(fakeProvider()), baseUrl: "https://api.anthropic.com/v1" },
    );
    expect(cap.value.top_p).toBe(0.77);
  });

  it("sends topP to Gemini generationConfig", async () => {
    const cap: any = {};
    mockFetchOnce(cap);
    const p = new GeminiProvider();
    await p.chat(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100, topP: 0.6 },
      { ...toProviderConfig(fakeProvider()), baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    );
    expect(cap.value.generationConfig.topP).toBe(0.6);
  });

  it("does not send top_p when undefined (backward compatible shape)", async () => {
    const cap: any = {};
    mockFetchOnce(cap);
    const p = new OpenAICompatibleProvider("openai");
    await p.chat(
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
      { ...toProviderConfig(fakeProvider()) },
    );
    // undefined top_p is dropped from JSON, so key should be absent.
    expect(cap.value.top_p).toBeUndefined();
  });
});
