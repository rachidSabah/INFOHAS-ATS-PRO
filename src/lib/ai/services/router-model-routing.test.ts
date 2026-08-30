// ============================================================================
// MODEL-ROUTING SAFETY tests — the "hy3-free leak" regression.
//
// Guards the two structural fixes:
//   1. modelForProvider: a model override is only honoured for the PINNED
//      provider; every other chain provider uses its OWN configured model.
//   2. singleProvider: the chain is cut to exactly the pinned provider.
//   3. Model errors now trigger model rotation through enabledModels (the
//      first-line auto-repair for stale model ids).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeAdapter = {
  type: "fake",
  chat: vi.fn(),
  testConnection: vi.fn(),
};

const updateProvider = vi.fn();

const PROVIDERS = vi.hoisted(() => [
  {
    id: "p_zen", name: "ZenCode", type: "fake", isActive: true, allowedForRegularUsers: true,
    modelName: "hy3-free", enabledModels: ["hy3-free", "deepseek-v4-flash-free"], priority: 10, retryAttempts: 0,
  },
  {
    id: "p_nvidia", name: "NVIDIA NIM", type: "fake", isActive: true, allowedForRegularUsers: true,
    modelName: "nvidia/nemotron-3-super", enabledModels: ["nvidia/nemotron-3-super"], priority: 20, retryAttempts: 0,
  },
  {
    id: "p_groq", name: "Groq", type: "fake", isActive: true, allowedForRegularUsers: true,
    modelName: "llama-3.3-70b-versatile", enabledModels: ["llama-3.3-70b-versatile"], priority: 30, retryAttempts: 0,
  },
]);

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers: PROVIDERS,
      providerSettings: { fallbackProviderIds: [], retryAttempts: 0 },
      user: { role: "super_admin" },
      addProviderLog: vi.fn(),
      updateProvider,
    }),
  },
  uid: () => "pl-test",
}));

vi.mock("./factory", () => ({
  ProviderFactory: { get: () => fakeAdapter },
  ProviderError: class extends Error {},
}));

vi.mock("../../provider-cooldown", () => ({
  isProviderInCooldown: () => false,
  getProviderCooldownRemainingMs: () => 0,
  getProviderCooldownClass: () => null,
  markProvider429Cooldown: vi.fn(),
  markProvider401Cooldown: vi.fn(),
  markProviderTimeoutCooldown: vi.fn(),
  recordTrafficCooldownFromError: vi.fn(), // traffic-vs-probe cooldown authority
  clearProviderCooldownOnSuccess: vi.fn(), // evidence-based early clear (P1)
  isTimeoutError: () => false,
  clearAllProviderCooldowns: vi.fn(),
}));

vi.mock("../../rate-limit-tracker", () => ({
  rateLimitTracker: { isRateLimited: () => false, record429: vi.fn(), getCooldownRemainingMs: () => 0, recordSuccess: vi.fn() },
}));

vi.mock("../../local-engine", () => ({ localGenerate: () => "" }));

import { ProviderRouter } from "./router";

beforeEach(() => {
  fakeAdapter.chat.mockReset();
  updateProvider.mockReset();
});

describe("MODEL-ROUTING SAFETY — model override must not leak across providers", () => {
  it("modelForProvider: honours the override ONLY for the pinned provider", () => {
    const opts = { preferredProviderId: "p_zen", modelOverride: "hy3-free" } as any;
    const req: any = { model: "hy3-free", messages: [] };
    const zen = PROVIDERS[0] as any;
    const nvidia = PROVIDERS[1] as any;
    const groq = PROVIDERS[2] as any;

    expect(ProviderRouter.modelForProvider(zen, opts, req)).toBe("hy3-free");
    expect(ProviderRouter.modelForProvider(nvidia, opts, req)).toBeUndefined();
    expect(ProviderRouter.modelForProvider(groq, opts, req)).toBeUndefined();
  });

  it("modelForProvider: without a pin, an unsupported requested model falls back to the provider's own model", () => {
    const opts = { modelOverride: "hy3-free" } as any;
    const req: any = { model: "hy3-free", messages: [] };
    const nvidia = PROVIDERS[1] as any;
    // NVIDIA does not list hy3-free in enabledModels → must NOT receive it.
    expect(ProviderRouter.modelForProvider(nvidia, opts, req)).toBeUndefined();
  });

  it("chain fallback after a pinned failure uses each provider's OWN model (no hy3-free propagation)", async () => {
    // Pinned ZenCode fails on BOTH of its models (primary + rotation); the
    // chain must continue with NVIDIA using ITS OWN configured model —
    // NEVER "hy3-free".
    fakeAdapter.chat.mockImplementation(async (req: any) => {
      if (req.model === "hy3-free" || req.model === "deepseek-v4-flash-free") {
        throw new Error("API returned HTTP 400: Invalid model");
      }
      return { text: "READY", provider: "ok", model: req.model, latencyMs: 10 } as any;
    });

    const res = await ProviderRouter.chat(
      { messages: [{ role: "user", content: "status check" }], model: "hy3-free" },
      { preferredProviderId: "p_zen", modelOverride: "hy3-free", timeoutMs: 5000 }
    );

    expect(res.text).toBe("READY");
    const calls = fakeAdapter.chat.mock.calls as any[];
    // The pinned provider received the override...
    expect(calls.some((c) => c[0]?.model === "hy3-free")).toBe(true);
    // ...and no DOWNSTREAM provider ever received a foreign model id: every
    // non-ZenCode call must have model=undefined (adapter falls back to its
    // own config.modelName) and NVIDIA's own modelName in the config.
    const nvidiaCalls = calls.filter((c) => c[1]?.modelName === "nvidia/nemotron-3-super");
    expect(nvidiaCalls.length).toBeGreaterThanOrEqual(1);
    expect(nvidiaCalls.every((c) => c[0]?.model === undefined || c[0]?.model === "nvidia/nemotron-3-super")).toBe(true);
    expect(calls.filter((c) => c[0]?.model === "hy3-free").every((c) => c[1]?.modelName === "hy3-free" || c[1]?.modelName === "deepseek-v4-flash-free")).toBe(true);
  });

  it("singleProvider: cuts the chain to the pinned provider — no cross-provider fallback", async () => {
    fakeAdapter.chat.mockImplementation(async () => {
      throw new Error("API returned HTTP 429: rate limit");
    });

    await expect(
      ProviderRouter.chat(
        { messages: [{ role: "user", content: "status check" }], model: "hy3-free" },
        { preferredProviderId: "p_zen", singleProvider: true, modelOverride: "hy3-free", timeoutMs: 5000 }
      )
    ).rejects.toThrow(/429/);

    // Only the pinned provider was attempted (rotation may retry its own
    // models) — NO other provider's model may appear in any call.
    const modelsUsed = (fakeAdapter.chat.mock.calls as any[]).map((c) => c[0]?.model);
    expect(modelsUsed.every((m) => m === "hy3-free" || m === "deepseek-v4-flash-free")).toBe(true);
  });

  it("model errors trigger model rotation through the provider's enabledModels and persist the working model", async () => {
    fakeAdapter.chat.mockImplementation(async (req: any) => {
      if (req.model === "hy3-free") {
        throw new Error("API returned HTTP 404: The model `hy3-free` does not exist or you do not have access to it.");
      }
      return { text: "READY", provider: "ZenCode", model: req.model, latencyMs: 8 } as any;
    });

    const res = await ProviderRouter.chat(
      { messages: [{ role: "user", content: "status check" }], model: "hy3-free" },
      { preferredProviderId: "p_zen", singleProvider: true, modelOverride: "hy3-free", timeoutMs: 5000 }
    );

    expect(res.text).toBe("READY");
    expect(res.model).toBe("deepseek-v4-flash-free");
    // The working replacement model is persisted as the provider's default.
    expect(updateProvider).toHaveBeenCalledWith("p_zen", expect.objectContaining({ modelName: "deepseek-v4-flash-free" }));
  });
});

