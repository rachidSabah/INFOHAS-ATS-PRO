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
