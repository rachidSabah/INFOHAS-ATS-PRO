// ============================================================================
// PREFLIGHT MODEL-ROTATION tests — the "fresh key still 429s" regression.
//
// Live evidence (2026-08-30, opencode.ai/zen/v1): the Zen free limiter is
// keyed to the REQUESTER'S IP, not the API key — FreeUsageLimitError fires
// even with no key at all, and per-model upstream routes churn independently
// (nemotron-3-ultra-free 200 OK while mimo-v2.5-free 429s from the same IP).
//
// The readiness gate previously gave up on a provider whose CONFIGURED model
// was quota-limited — blocking the whole optimizer even though sibling free
// models on the SAME provider answered fine. Normal chats already rotate
// models through enabledModels (router classifyRotationError); the gate must
// do the same before declaring a provider not ready, and it must report the
// WORKING model so the job lock pins it.
//
// Guarantees under test:
//   1. Quota/429/model-error on the configured model → rotate through
//      enabledModels siblings (max 3) → candidate passes with the working
//      sibling as candidate.model.
//   2. Auth errors (401/402/403) NEVER rotate models — another model on the
//      same dead credential cannot help (router parity).
//   3. A passing primary is never re-pinged (no wasted calls).
//   4. Rotation is bounded: at most 3 sibling pings after the primary fails.
//   5. When every sibling fails too, the candidate fails with the PRIMARY
//      error preserved (the most truthful diagnostic for the UI).
//   6. A provider with no enabledModels rotates nothing (single ping).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const updateProvider = vi.fn();

function makeProvider(overrides: Partial<any> = {}): any {
  return {
    id: "p_zen", name: "OpenCode Zen", type: "opencode", isActive: true, allowedForRegularUsers: true,
    baseUrl: "https://opencode.ai/zen/v1", apiKey: "zk-fresh-never-used",
    modelName: "mimo-v2.5-free",
    enabledModels: ["mimo-v2.5-free", "hy3-free", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free", "laguna-s-2.1-free"],
    priority: 10, retryAttempts: 0, timeout: 15000,
    status: "healthy", usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
    health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
    ...overrides,
  };
}

const providers = [makeProvider()];

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers,
      providerSettings: { defaultProviderId: "p_zen", autoHealProviders: false },
      user: { role: "super_admin" },
      updateProvider,
    }),
  },
}));

vi.mock("../../provider-cooldown", () => ({ isProviderInCooldown: () => false, getProviderCooldownRemainingMs: () => 0, getProviderCooldownClass: () => null }));
vi.mock("../../circuit-breaker", () => ({ getCooldownRemaining: () => 0, resetCircuitBreaker: vi.fn() }));
vi.mock("../../rate-limit-tracker", () => ({
  rateLimitTracker: { isRateLimited: () => false, getCooldownRemainingMs: () => 0, recordSuccess: vi.fn() },
}));
vi.mock("../../provider-health", () => ({ recordSuccess: vi.fn(), recordFailure: vi.fn() }));
vi.mock("../../services/manager", () => ({ ProviderManager: { fetchModels: vi.fn(), testConnection: vi.fn() } }));
vi.mock("../../services/router", () => ({ ProviderRouter: { chat: vi.fn() } }));
vi.mock("../../model-registry", () => ({
  modelRegistry: { findByProvider: () => [] },
}));
vi.mock("../healing/provider-healer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../healing/provider-healer")>();
  return { ...mod, ProviderHealer: { ...mod.ProviderHealer, healAllProviders: vi.fn().mockResolvedValue([]) } };
});

import { runReadinessPreflight } from "./preflight";

const QUOTA_ERR = "FreeUsageLimitError: Rate limit exceeded. Please try again later.";

beforeEach(() => {
  updateProvider.mockReset();
  providers.length = 0;
  providers.push(makeProvider());
});

describe("preflight model rotation (Zen free-model per-IP limits)", () => {
  it("rotates to a working sibling free model and reports IT as the candidate model", async () => {
    // mimo (configured) → 429 quota; hy3 (dead sibling) → model error;
    // nemotron-3-ultra-free → healthy. The gate must find and pin the sibling.
    const ping = vi.fn(async (_provider: any, model: any) => {
      if (model === "mimo-v2.5-free") return { ok: false, latencyMs: 40, error: QUOTA_ERR };
      if (model === "hy3-free") return { ok: false, latencyMs: 30, error: "The model `hy3-free` is not supported" };
      if (model === "nemotron-3-ultra-free") return { ok: true, latencyMs: 150, reply: "READY" };
      throw new Error(`unexpected ping for ${model}`);
    });
    const result = await runReadinessPreflight({ deps: { ping } });
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    expect(c.ok).toBe(true);
    expect(c.model).toBe("nemotron-3-ultra-free");
    expect(result.passed).toHaveLength(1);
    expect(result.selected?.model).toBe("nemotron-3-ultra-free");
    // tried: mimo (primary) → hy3 → nemotron (success); stops there.
    expect(ping.mock.calls.map(([, m]) => m)).toEqual([
      "mimo-v2.5-free", "hy3-free", "nemotron-3-ultra-free",
    ]);
  });

  it("never rotates on auth errors — a sibling model cannot fix a dead credential", async () => {
    providers[0] = makeProvider({ apiKey: "sk-dead" });
    const ping = vi.fn(async (_provider: any, model: any) =>
      model === "mimo-v2.5-free"
        ? { ok: false, latencyMs: 25, error: "401 Unauthorized: invalid API key" }
        : { ok: true, latencyMs: 100, reply: "READY" }
    );
    const result = await runReadinessPreflight({ deps: { ping } });
    const c = result.candidates[0];
    expect(c.ok).toBe(false);
    // exactly ONE ping: the configured model only, no sibling attempts.
    expect(ping).toHaveBeenCalledTimes(1);
    expect(ping.mock.calls[0][1]).toBe("mimo-v2.5-free");
    expect(result.passed).toHaveLength(0);
  });

  it("does not re-ping when the configured model passes on the first try", async () => {
    const ping = vi.fn(async () => ({ ok: true, latencyMs: 120, reply: "READY" }));
    const result = await runReadinessPreflight({ deps: { ping } });
    expect(ping).toHaveBeenCalledTimes(1);
    expect(result.candidates[0].ok).toBe(true);
    expect(result.candidates[0].model).toBe("mimo-v2.5-free");
  });

  it("caps model rotation at 3 sibling attempts after the primary fails", async () => {
    providers[0] = makeProvider({
      enabledModels: ["mimo-v2.5-free", "sib-1", "sib-2", "sib-3", "sib-4", "sib-5"],
    });
    const ping = vi.fn(async (_provider: any, model: any) =>
      model === "sib-4"
        ? { ok: true, latencyMs: 100, reply: "READY" }
        : { ok: false, latencyMs: 30, error: QUOTA_ERR }
    );
    const result = await runReadinessPreflight({ deps: { ping } });
    // primary + at most 3 siblings — sib-4/sib-5 must NEVER be pinged.
    const triedModels = ping.mock.calls.map(([, m]) => m);
    expect(triedModels).toEqual(["mimo-v2.5-free", "sib-1", "sib-2", "sib-3"]);
    expect(result.candidates[0].ok).toBe(false);
  });

  it("keeps the PRIMARY error when every sibling also fails", async () => {
    providers[0] = makeProvider({ enabledModels: ["mimo-v2.5-free", "alt-1", "alt-2"] });
    const ping = vi.fn(async (_provider: any, model: any) => ({
      ok: false as const,
      latencyMs: 30,
      error: model === "mimo-v2.5-free" ? QUOTA_ERR : `model ${model} is not supported`,
    }));
    const result = await runReadinessPreflight({ deps: { ping } });
    const c = result.candidates[0];
    expect(c.ok).toBe(false);
    expect(c.model).toBe("mimo-v2.5-free");
    expect(c.error).toContain("FreeUsageLimitError");
    expect(result.passed).toHaveLength(0);
  });

  it("rotates nothing for a provider without enabledModels", async () => {
    providers[0] = makeProvider({ enabledModels: undefined });
    const ping = vi.fn(async () => ({ ok: false, latencyMs: 30, error: QUOTA_ERR }));
    const result = await runReadinessPreflight({ deps: { ping } });
    expect(ping).toHaveBeenCalledTimes(1);
    expect(result.candidates[0].ok).toBe(false);
  });

  it("treats upstream model-unavailable errors as rotation-worthy (zen route churn)", async () => {
    const ping = vi.fn(async (_provider: any, model: any) =>
      model === "mimo-v2.5-free"
        ? { ok: false, latencyMs: 40, error: "Error from provider (Console): Upstream request failed: Model is unavailable." }
        : model === "hy3-free"
          ? { ok: false, latencyMs: 40, error: "Endpoint is unavailable." }
          : { ok: true, latencyMs: 140, reply: "READY" }
    );
    const result = await runReadinessPreflight({ deps: { ping } });
    expect(result.candidates[0].ok).toBe(true);
    expect(result.candidates[0].model).toBe("nemotron-3-ultra-free");
  });
});
