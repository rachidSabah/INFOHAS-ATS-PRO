// ============================================================================
// Provider Auto-Heal engine tests — directives #3, #4, #6, #13 (acceptance
// tests TEST 1, TEST 2, TEST 3, TEST 5).
// Uses injected ping/fetchCatalog deps + a mocked store so no network runs.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const updateProvider = vi.fn();

function makeProvider(overrides: Partial<any> = {}): any {
  return {
    id: "p_groq", name: "Groq", type: "groq", isActive: true, allowedForRegularUsers: true,
    apiKey: "sk-secret", baseUrl: "https://api.groq.com/openai/v1",
    modelName: "hy3-free", enabledModels: [], priority: 10, retryAttempts: 0,
    status: "degraded", usage: { requests: 10, tokens: 0, errors: 3, avgLatencyMs: 200, cost: 0 },
    health: { consecutiveFailures: 2, consecutiveSuccesses: 0, lastError: "Invalid model: hy3-free" },
    ...overrides,
  };
}

const providers = [makeProvider()];

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers,
      providerSettings: { autoHealProviders: true },
      updateProvider,
    }),
  },
}));

vi.mock("../../provider-cooldown", () => ({
  isProviderInCooldown: () => false,
}));
vi.mock("../../circuit-breaker", () => ({
  getCooldownRemaining: () => 0,
  resetCircuitBreaker: vi.fn(),
}));
vi.mock("../../rate-limit-tracker", () => ({
  rateLimitTracker: { isRateLimited: () => false, getCooldownRemainingMs: () => 0, recordSuccess: vi.fn() },
}));
vi.mock("../../provider-health", () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));
vi.mock("../../services/manager", () => ({
  ProviderManager: { fetchModels: vi.fn(), testConnection: vi.fn() },
}));
vi.mock("../../services/router", () => ({
  ProviderRouter: { chat: vi.fn() },
}));

import { ProviderHealer, pickReplacementModel } from "../healing/provider-healer";

beforeEach(() => {
  updateProvider.mockReset();
  providers.length = 0;
  providers.push(makeProvider());
  // Clear the healer's static pending-retest timers + failure counters —
  // they persist across tests and would otherwise leak counts (DEEP 1 → DEEP 2).
  ProviderHealer.resetRetestState();
});

describe("ProviderHealer", () => {
  it("TEST 1 — model_error: refreshes catalog, selects compatible model, validates, recovers", async () => {
    // lastError is already classified → the single ping here IS the validation.
    const ping = vi.fn().mockResolvedValue({ ok: true, latencyMs: 90, reply: "READY" });
    const fetchCatalog = vi.fn().mockResolvedValue({ ok: true, models: ["llama-3.3-70b-versatile", "mixtral-8x7b"] });

    const report = await ProviderHealer.healProvider("p_groq", "manual", undefined, { ping, fetchCatalog });

    expect(fetchCatalog).toHaveBeenCalled();
    expect(report.result).toBe("recovered");
    expect(report.previousModel).toBe("hy3-free");
    expect(report.newModel).toBe("llama-3.3-70b-versatile");
    // Safe repair: only model mapping was written — never keys/endpoints.
    expect(updateProvider).toHaveBeenCalledWith("p_groq", expect.objectContaining({
      modelName: "llama-3.3-70b-versatile",
    }));
    const healthPatch = updateProvider.mock.calls.map((c) => c[1]).find((p: any) => p.health?.successfulRepairs === 1);
    expect(healthPatch).toBeTruthy();
    expect(healthPatch.health.healState).toBe("recovered");
  });

  it("model_error replacement prefers the LIVE catalog over the static enabledModels list", () => {
    // enabledModels is the static seed list — often holds RETIRED ids.
    // The live catalog (freshly fetched) must win so heal never swaps one
    // retired model id for another.
    const picked = pickReplacementModel(
      makeProvider({ enabledModels: ["deepseek-v4-flash-free"] }),
      ["mistral-small-2506", "unknown-family-model"],
      "hy3-free"
    );
    expect(picked).toBe("mistral-small-2506");
  });

  it("model_error replacement falls back to enabledModels when the live catalog is unavailable", () => {
    const picked = pickReplacementModel(
      makeProvider({ enabledModels: ["deepseek-v4-flash-free"] }),
      [], // catalog fetch failed
      "hy3-free"
    );
    expect(picked).toBe("deepseek-v4-flash-free");
  });

  it("DEEP 1 — post-cooldown retest failure with a MODEL error runs a heal round instead of dead-ending", async () => {
    vi.useFakeTimers();
    try {
      providers[0] = makeProvider({ modelName: "old-model", enabledModels: [] });
      // 1st ping = post-cooldown retest probe (fails, model retired);
      // 2nd ping = heal-round validation (succeeds with the replacement).
      const ping = vi.fn()
        .mockResolvedValueOnce({ ok: false, latencyMs: 10, error: "The model `old-model` does not exist" })
        .mockResolvedValueOnce({ ok: true, latencyMs: 40, reply: "READY" });
      const fetchCatalog = vi.fn().mockResolvedValue({ ok: true, models: ["llama-3.1-8b-instant"] });

      ProviderHealer.scheduleCooldownRetest("p_groq", 1000, { ping, fetchCatalog });
      await vi.advanceTimersByTimeAsync(1000);

      expect(ping).toHaveBeenCalledTimes(2);
      const modelPatch = updateProvider.mock.calls.map((c) => c[1]).find((p: any) => p.modelName);
      expect(modelPatch?.modelName).toBe("llama-3.1-8b-instant");
      const healthPatch = updateProvider.mock.calls.map((c) => c[1]).find((p: any) => p.health?.healState === "recovered");
      expect(healthPatch).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("DEEP 2 — post-cooldown retest failure with a rate limit re-schedules a bounded retest", async () => {
    vi.useFakeTimers();
    try {
      const ping = vi.fn().mockResolvedValue({ ok: false, latencyMs: 5, error: "HTTP 429: rate limit exceeded" });

      ProviderHealer.scheduleCooldownRetest("p_groq", 1000, { ping });
      await vi.advanceTimersByTimeAsync(1000); // 1st probe fails → re-schedule ~60s
      expect(ping).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000); // 2nd probe runs
      expect(ping).toHaveBeenCalledTimes(2);

      const healthPatch = updateProvider.mock.calls.map((c) => c[1]).find((p: any) => p.health?.lastDiagnosis)?.health;
      expect(healthPatch?.healState).toBe("cooldown");
      expect(healthPatch?.lastDiagnosis).toMatch(/re-test 1\/3/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("DEEP 3 — model replacement validated against a rate limit keeps the new model (cooldown, not manual)", async () => {
    providers[0] = makeProvider({ modelName: "hy3-free", enabledModels: [] });
    const ping = vi.fn().mockResolvedValue({ ok: false, latencyMs: 20, error: "HTTP 429: rate limit exceeded" });
    const fetchCatalog = vi.fn().mockResolvedValue({ ok: true, models: ["llama-3.1-8b-instant"] });

    const report = await ProviderHealer.healProvider("p_groq", "auto", "The model `hy3-free` does not exist", { ping, fetchCatalog });

    expect(report.result).toBe("cooldown");
    expect(report.newModel).toBe("llama-3.1-8b-instant");
    expect(report.action).toMatch(/rate limit/i);
    // The new mapping STAYS — the rate limit says nothing against the model.
    const modelPatch = updateProvider.mock.calls.map((c) => c[1]).find((p: any) => p.modelName);
    expect(modelPatch?.modelName).toBe("llama-3.1-8b-instant");
  });

  it("DEEP 4 — STALE endpoint error re-validates first: fresh pass recovers without touching config", async () => {
    providers[0] = makeProvider({
      baseUrl: "https://api.groq.com/openai/v1",
      health: {
        consecutiveFailures: 1, consecutiveSuccesses: 0,
        lastError: "HTTP 404: 404 page not found",
        lastFailureAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min old
      },
    });
    const ping = vi.fn().mockResolvedValue({ ok: true, latencyMs: 55, reply: "READY" });

    const report = await ProviderHealer.healProvider("p_groq", "manual", undefined, { ping, fetchCatalog: vi.fn() });

    expect(report.result).toBe("recovered");
    expect(ping).toHaveBeenCalledTimes(1); // only the fresh validation — no repair pings
    const wroteUrl = updateProvider.mock.calls.some((c) => "baseUrl" in (c[1] ?? {}));
    expect(wroteUrl).toBe(false); // configuration untouched
    expect(report.diagnosis).toMatch(/stale/i);
  });

  it("DEEP 5 — healAllProviders isolates a throwing provider and continues the sweep", async () => {
    providers.length = 0;
    providers.push(
      makeProvider({ id: "p_a", name: "A", health: { consecutiveFailures: 1, consecutiveSuccesses: 0, lastError: "Invalid model: boom-a" } }),
      makeProvider({ id: "p_b", name: "B", health: { consecutiveFailures: 1, consecutiveSuccesses: 0, lastError: "Invalid model: boom-b" } }),
    );
    const ping = vi.fn()
      .mockRejectedValueOnce(new Error("validation socket exploded")) // provider A's heal round crashes
      .mockResolvedValue({ ok: true, latencyMs: 30, reply: "READY" });
    const fetchCatalog = vi.fn().mockResolvedValue({ ok: true, models: ["fix-model"] });

    const reports = await ProviderHealer.healAllProviders("manual", { ping, fetchCatalog });

    expect(reports).toHaveLength(2);
    expect(reports[0].result).toBe("failed");
    expect(reports[0].problem).toBe("Heal round crashed");
    expect(reports[1].result).toBe("recovered");
  });

  it("TEST 3 — cooldown: no configuration change, cooldown result, re-test scheduled", async () => {
    providers[0] = makeProvider({
      health: { consecutiveFailures: 1, consecutiveSuccesses: 0, rateLimitedUntil: new Date(Date.now() + 60000).toISOString() },
    });
    const ping = vi.fn();
    const fetchCatalog = vi.fn();

    const report = await ProviderHealer.healProvider("p_groq", "auto", "429 rate limit", { ping, fetchCatalog });

    expect(report.result).toBe("cooldown");
    expect(ping).not.toHaveBeenCalled();
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(updateProvider).not.toHaveBeenCalledWith("p_groq", expect.objectContaining({ modelName: expect.anything() }));
  });

  it("TEST 5 — auth_error: never repairs keys, reports manual heal requirement", async () => {
    providers[0] = makeProvider({ health: { consecutiveFailures: 1, consecutiveSuccesses: 0, lastError: "HTTP 401: invalid api key" } });
    const ping = vi.fn();
    const fetchCatalog = vi.fn();

    const report = await ProviderHealer.healProvider("p_groq", "auto", undefined, { ping, fetchCatalog });

    expect(report.result).toBe("manual_required");
    expect(report.failureKind).toBe("auth_error");
    expect(fetchCatalog).not.toHaveBeenCalled();
    // Keys are user assets — the healer must never write provider.apiKey.
    const wroteApiKey = updateProvider.mock.calls.some((c) => "apiKey" in (c[1] ?? {}));
    expect(wroteApiKey).toBe(false);
  });

  it("TEST 2 — endpoint_error with a drifted URL: restores the catalog endpoint, validates, recovers", async () => {
    providers[0] = makeProvider({
      type: "groq",
      baseUrl: "https://api.groq.com/old/v9",
      health: { consecutiveFailures: 1, consecutiveSuccesses: 0, lastError: "HTTP 404: 404 page not found" },
    });
    const ping = vi.fn().mockResolvedValue({ ok: true, latencyMs: 70, reply: "READY" }); // validation ping

    const report = await ProviderHealer.healProvider("p_groq", "manual", undefined, { ping, fetchCatalog: vi.fn() });

    expect(report.result).toBe("recovered");
    expect(report.previousEndpoint).toBe("https://api.groq.com/old/v9");
    expect(report.newEndpoint).toBe("https://api.groq.com/openai/v1");
    const urlPatch = updateProvider.mock.calls.map((c) => c[1]).find((p: any) => p.baseUrl);
    expect(urlPatch.baseUrl).toBe("https://api.groq.com/openai/v1");
  });

  it("endpoint repair reverts the user's URL when validation still fails", async () => {
    providers[0] = makeProvider({
      baseUrl: "https://api.groq.com/old/v9",
      health: { consecutiveFailures: 1, consecutiveSuccesses: 0, lastError: "HTTP 404: 404 page not found" },
    });
    const ping = vi.fn().mockResolvedValue({ ok: false, latencyMs: 15, error: "HTTP 404: 404 page not found" });

    const report = await ProviderHealer.healProvider("p_groq", "manual", undefined, { ping, fetchCatalog: vi.fn() });

    expect(report.result).toBe("manual_required");
    const patches = updateProvider.mock.calls.map((c) => c[1]);
    // Repair then revert — the user's original URL is preserved.
    const urlPatches = patches.filter((p: any) => "baseUrl" in (p ?? {}));
    expect(urlPatches.length).toBeGreaterThanOrEqual(2);
    expect(urlPatches[urlPatches.length - 1].baseUrl).toBe("https://api.groq.com/old/v9");
  });

  it("healthy provider with a passing diagnosis ping is marked recovered without config changes", async () => {
    providers[0] = makeProvider({ health: { consecutiveFailures: 0, consecutiveSuccesses: 0 } });
    const ping = vi.fn().mockResolvedValue({ ok: true, latencyMs: 50, reply: "READY" });

    const report = await ProviderHealer.healProvider("p_groq", "auto", undefined, { ping, fetchCatalog: vi.fn() });

    expect(report.result).toBe("recovered");
    expect(updateProvider).not.toHaveBeenCalledWith("p_groq", expect.objectContaining({ modelName: expect.anything() }));
  });
});
