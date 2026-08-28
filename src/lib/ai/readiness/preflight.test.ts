// ============================================================================
// AI Readiness Gate tests — TEST FIRST → SELECT BEST → LOCK (directives
// #24–#29, #46). All pings are injected; no network, no real providers.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const updateProvider = vi.fn();

function makeProvider(overrides: Partial<any> = {}): any {
  return {
    id: "p_a", name: "ProviderA", type: "openai", isActive: true, allowedForRegularUsers: true,
    baseUrl: "https://api.openai.com/v1", apiKey: "sk-x",
    modelName: "gpt-4o-mini", enabledModels: ["gpt-4o-mini"], priority: 10, retryAttempts: 0, timeout: 15000,
    status: "healthy", usage: { requests: 5, tokens: 0, errors: 0, avgLatencyMs: 300, cost: 0 },
    health: { consecutiveFailures: 0, consecutiveSuccesses: 2 },
    ...overrides,
  };
}

const providers = [makeProvider(), makeProvider({ id: "p_b", name: "ProviderB", priority: 20 })];

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers,
      providerSettings: { defaultProviderId: "p_a", autoHealProviders: false },
      updateProvider,
    }),
  },
}));

vi.mock("../../provider-cooldown", () => ({ isProviderInCooldown: () => false }));
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

import { runReadinessPreflight, runReadinessGate, computeReadinessScore } from "./preflight";
import { classifyProviderFailure } from "../healing/error-classifier";
import { setJobAILock, getJobAILock, clearJobAILock, activateFallback, getActiveJobModel } from "./config-lock";
import { ProviderHealer } from "../healing/provider-healer";

beforeEach(() => {
  clearJobAILock();
  updateProvider.mockReset();
  providers.length = 0;
  providers.push(makeProvider(), makeProvider({ id: "p_b", name: "ProviderB", priority: 20 }));
});

describe("computeReadinessScore", () => {
  it("failed candidates score 0", () => {
    const { score } = computeReadinessScore(providers[0], false, 500, classifyProviderFailure("404 model not found"));
    expect(score).toBe(0);
  });

  it("a fast, healthy candidate outranks a slow one (reliability beats pure latency)", () => {
    const fast = computeReadinessScore(providers[0], true, 400).score;
    const slow = computeReadinessScore(providers[0], true, 5000).score;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe("runReadinessPreflight", () => {
  it("pings every candidate with ITS OWN model and ranks the passed ones", async () => {
    const ping = vi.fn(async (provider: any) =>
      provider.id === "p_a"
        ? { ok: true, latencyMs: 120, reply: "READY" }
        : { ok: false, latencyMs: 30, error: "The model `hy3-free` does not exist" }
    );
    const result = await runReadinessPreflight({ deps: { ping } });

    expect(result.candidates).toHaveLength(2);
    expect(result.selected?.providerId).toBe("p_a");
    expect(result.passed).toHaveLength(1);
    expect(result.fallbackChain).toHaveLength(0);
    expect(result.eligibleIds).toEqual(["p_a", "p_b"]);
    expect(result.candidates[1].classification?.kind).toBe("model_error");
  });

  it("cooldown providers are reported without a real ping", async () => {
    providers[0] = makeProvider({
      health: { consecutiveFailures: 1, consecutiveSuccesses: 0, rateLimitedUntil: new Date(Date.now() + 60000).toISOString() },
    });
    const ping = vi.fn().mockResolvedValue({ ok: true, latencyMs: 50, reply: "READY" });
    const result = await runReadinessPreflight({ deps: { ping } });
    expect(ping).toHaveBeenCalledTimes(1); // only p_b pinged — p_a skipped
    expect(result.candidates[0].ok).toBe(false);
    expect(result.candidates[0].error).toMatch(/cooldown/i);
  });
});

describe("runReadinessGate", () => {
  it("locks the best validated model + pre-validated fallback chain", async () => {
    const ping = vi.fn(async (provider: any) =>
      provider.id === "p_a"
        ? { ok: true, latencyMs: 100, reply: "READY" }
        : { ok: true, latencyMs: 250, reply: "READY" }
    );
    const gate = await runReadinessGate({ deps: { ping } });

    expect(gate.lock).toBeTruthy();
    expect(gate.lock!.primary.providerId).toBe("p_a"); // faster provider wins on equal validity
    expect(gate.lock!.fallbacks.map((f) => f.providerId)).toEqual(["p_b"]);
    expect(getJobAILock()?.primary.model).toBe("gpt-4o-mini");
    expect(gate.summary).toMatch(/AI engine ready/i);
  });

  it("ABSOLUTE RULE #46 — with no validated provider the gate refuses to lock and gives per-provider diagnostics", async () => {
    const ping = vi.fn().mockResolvedValue({ ok: false, latencyMs: 40, error: "HTTP 401: invalid api key" });
    const gate = await runReadinessGate({ deps: { ping } });

    expect(gate.lock).toBeNull();
    expect(gate.summary).toMatch(/No AI provider passed/i);
    expect(gate.summary).toContain("ProviderA");
    expect(gate.summary).toContain("ProviderB");
    expect(getJobAILock()).toBeNull();
  });

  it("when Auto-Heal is ON and everything fails, it heals once and re-runs the preflight once (no loops)", async () => {
    // enable auto-heal for this test
    (providers as any).autoHeal = true;
    const healAll = vi.mocked(ProviderHealer.healAllProviders);
    healAll.mockResolvedValue([
      {
        providerId: "p_a", providerName: "ProviderA", problem: "Invalid model", failureKind: "model_error",
        diagnosis: "d", action: "a", result: "recovered", mode: "auto",
      } as any,
    ]);
    // Rebuild store with autoHealProviders ON
    const { useApp } = await import("../../store");
    const originalGetState = useApp.getState;
    (useApp as any).getState = () => ({
      ...(originalGetState() as any),
      providerSettings: { defaultProviderId: "p_a", autoHealProviders: true },
    });

    let phase = 0;
    const ping = vi.fn(async () => {
      phase++;
      return phase <= 2
        ? { ok: false, latencyMs: 30, error: "Invalid model: hy3-free" }
        : { ok: true, latencyMs: 110, reply: "READY" }; // after heal
    });

    const gate = await runReadinessGate({ deps: { ping } });

    expect(healAll).toHaveBeenCalledTimes(1); // exactly ONE heal round — no loops
    expect(gate.healed).toBe(true);
    expect(gate.lock).toBeTruthy();
    expect(gate.lock!.primary.providerId).toBe("p_a");

    (useApp as any).getState = originalGetState;
  });
});

describe("config-lock + supervisor failover", () => {
  it("activateFallback switches the active model and counts the failover", () => {
    setJobAILock({
      jobId: "j1",
      lockedAt: new Date().toISOString(),
      primary: { providerId: "p_a", providerName: "A", model: "m1", readinessScore: 90 },
      fallbacks: [{ providerId: "p_b", providerName: "B", model: "m2", readinessScore: 80 }],
      eligibleProviderIds: ["p_a", "p_b"],
      activeIndex: 0,
      failoverCount: 0,
      events: [],
    });
    expect(getActiveJobModel()?.providerId).toBe("p_a");
    activateFallback(0, "primary failed");
    const active = getActiveJobModel();
    expect(active?.providerId).toBe("p_b");
    expect(getJobAILock()?.failoverCount).toBe(1);
  });
});
