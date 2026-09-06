// ============================================================================
// Workers AI provider (Task 16) — core mapping + factory + chain placement
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  WORKERS_AI_DEFAULT_MODEL,
  WORKERS_AI_MODEL_OPTIONS,
  buildWorkersAIRunInput,
  mapWorkersAIResponse,
  isWorkersAIQuotaError,
  runWorkersAIChat,
} from "../ai/providers/workers-ai-core";
import { workersAIProvider } from "../ai/providers/workers-ai";
import { ProviderFactory } from "../ai/services/factory";
import { FallbackManager } from "../ai/services/fallback";

describe("Workers AI core mapping", () => {
  it("buildWorkersAIRunInput maps roles (tool → assistant) and clamps limits", () => {
    const input = buildWorkersAIRunInput(
      [
        { role: "system", content: "You are an ATS optimizer." },
        { role: "tool", content: "tool output" },
        { role: "user", content: "Rewrite this resume." },
        { role: "user", content: "" }, // empty content filtered out
      ] as any,
      { maxTokens: 999999, temperature: 5 },
    );
    expect(input.messages).toHaveLength(3);
    expect(input.messages[0]).toEqual({ role: "system", content: "You are an ATS optimizer." });
    expect(input.messages[1].role).toBe("assistant"); // tool folded into assistant
    expect(input.max_tokens).toBe(8192); // clamped
    expect(input.temperature).toBe(2); // clamped
    expect(input.top_p).toBeUndefined(); // absent topP → no key
  });

  it("buildWorkersAIRunInput falls back to a default user message when empty", () => {
    const input = buildWorkersAIRunInput([]);
    expect(input.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("buildWorkersAIRunInput includes top_p when provided", () => {
    const input = buildWorkersAIRunInput([{ role: "user", content: "hi" }], { topP: 0.9 });
    expect(input.top_p).toBe(0.9);
  });

  it("mapWorkersAIResponse handles the native binding envelope", () => {
    const mapped = mapWorkersAIResponse({
      response: "Hello!",
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
    expect(mapped.text).toBe("Hello!");
    expect(mapped.inputTokens).toBe(12);
    expect(mapped.outputTokens).toBe(3);
    expect(mapped.finishReason).toBe("stop");
  });

  it("mapWorkersAIResponse handles REST + nested envelopes and content arrays", () => {
    expect(mapWorkersAIResponse({ data: { response: "nested" } }).text).toBe("nested");
    expect(mapWorkersAIResponse({ result: { response: "wrapped" } }).text).toBe("wrapped");
    expect(mapWorkersAIResponse({ data: "plain" }).text).toBe("plain");
    expect(mapWorkersAIResponse({ content: [{ text: "a" }, { text: "b" }] }).text).toBe("ab");
  });

  it("mapWorkersAIResponse strips <think> reasoning traces from distill models", () => {
    const mapped = mapWorkersAIResponse({ response: "<think>reasoning here</think>\nFinal JSON" });
    expect(mapped.text).toBe("Final JSON");
  });

  it("isWorkersAIQuotaError classifies neuron/quota exhaustion", () => {
    expect(isWorkersAIQuotaError(new Error("You have exceeded your daily neurons limit"))).toBe(true);
    expect(isWorkersAIQuotaError(new Error("Account reached quota 429"))).toBe(true);
    expect(isWorkersAIQuotaError(new Error("model not found"))).toBe(false);
  });

  it("runWorkersAIChat rejects non-Workers model ids", async () => {
    await expect(
      runWorkersAIChat({ run: async () => ({}) }, { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/Invalid Workers AI model/);
  });

  it("runWorkersAIChat executes env.AI.run with mapped input and returns normalized output", async () => {
    const calls: Array<{ model: string; input: any }> = [];
    const fakeAI = {
      run: async (model: string, input: any) => {
        calls.push({ model, input });
        return { response: "  <think>x</think>OK  ", usage: { prompt_tokens: 5, completion_tokens: 2 } };
      },
    };
    const out = await runWorkersAIChat(fakeAI as any, {
      messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
      maxTokens: 100,
      temperature: 0.3,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(WORKERS_AI_DEFAULT_MODEL);
    expect(calls[0].input.messages).toHaveLength(2);
    expect(calls[0].input.max_tokens).toBe(100);
    expect(out.text).toBe("OK"); // think-trace stripped + trimmed
    expect(out.outputTokens).toBe(2);
  });

  it("runWorkersAIChat enforces the attempt deadline with an AbortError", async () => {
    const hangingAI = { run: () => new Promise(() => {}) }; // never resolves
    await expect(
      runWorkersAIChat(hangingAI as any, { messages: [{ role: "user", content: "hi" }], timeoutMs: 1000 }),
    ).rejects.toMatchObject({ name: "AbortError" });
  }, 5000);
});

describe("Workers AI factory registration", () => {
  it("ProviderFactory resolves the workers-ai adapter", () => {
    expect(ProviderFactory.get("workers-ai")).toBe(workersAIProvider);
    expect(ProviderFactory.listTypes()).toContain("workers-ai");
  });

  it("adapter listModels prefers enabledModels then the curated option list", async () => {
    expect(await workersAIProvider.listModels({ enabledModels: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"] } as any))
      .toEqual(["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
    expect(await workersAIProvider.listModels({} as any)).toEqual(WORKERS_AI_MODEL_OPTIONS);
  });
});

describe("Workers AI chain placement (rescue tier)", () => {
  // Mirrors the PRODUCTION providerSettings: defaultProviderId=p_puter,
  // fallbackProviderIds=[p_workersai, p_mistral, p_nvidia] (config op applied
  // post-deploy), p_zencode demoted isActive=0.
  const settings: any = {
    defaultProviderId: "p_puter",
    fallbackProviderIds: ["p_workersai", "p_mistral", "p_nvidia"],
  };

  it("FallbackManager.buildChain yields puter → workers-ai → mistral → nvidia", () => {
    const chain = FallbackManager.buildChain(
      [
        { id: "p_mistral", type: "mistral", priority: 10, isActive: true, status: "healthy" },
        { id: "p_nvidia", type: "nvidia", priority: 12, isActive: true, status: "healthy" },
        { id: "p_workersai", type: "workers-ai", priority: 5, isActive: true, status: "untested" },
        { id: "p_puter", type: "puter", priority: 1, isActive: true, status: "degraded" },
        { id: "p_zencode", type: "opencode-zen", priority: 3, isActive: false, status: "down" }, // demoted — must NOT appear
      ] as any,
      settings,
    );
    const ids = chain.map((p: any) => p.id);
    // Default first → fallbacks in saved order → others by priority.
    expect(ids).toEqual(["p_puter", "p_workersai", "p_mistral", "p_nvidia"]); // zen excluded (inactive)
  });

  it("buildChain excludes workers-ai when inactive", () => {
    const chain = FallbackManager.buildChain(
      [
        { id: "p_workersai", type: "workers-ai", priority: 5, isActive: false, status: "untested" },
        { id: "p_mistral", type: "mistral", priority: 10, isActive: true, status: "healthy" },
      ] as any,
      { defaultProviderId: null, fallbackProviderIds: [] } as any,
    );
    expect(chain.map((p: any) => p.id)).toEqual(["p_mistral"]);
  });
});
