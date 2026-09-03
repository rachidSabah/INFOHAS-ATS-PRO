// ============================================================================
// Router governance tests (directives #12, #11, #9)
//
// - a provider-level quota failure (429 / "Monthly usage limit reached")
//   MUST NOT trigger model rotation (blind rotation eliminated)
// - model rotation is reserved for model-not-found / unsupported errors
// - rotation candidates are compatibility-validated (no arbitrary names)
// - health registry observations are recorded for successes/failures
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers: [],
      providerSettings: { retryAttempts: 1 },
      user: { role: "super_admin" },
      updateProvider: vi.fn(),
    }),
  },
  uid: () => "uid",
}));
vi.mock("../../rate-limit-tracker", () => ({ rateLimitTracker: { recordSuccess: vi.fn(), isRateLimited: () => false } }));
vi.mock("../../provider-cooldown", () => ({
  isProviderInCooldown: () => false,
  getProviderCooldownRemainingMs: () => 0,
  getProviderCooldownClass: () => null,
  markProvider429Cooldown: vi.fn(),
  markProvider401Cooldown: vi.fn(),
  markProviderTimeoutCooldown: vi.fn(),
  recordTrafficCooldownFromError: vi.fn(),
  clearProviderCooldownOnSuccess: vi.fn(),
  isTimeoutError: (e: any) => /timeout/i.test(e?.message ?? ""),
}));
vi.mock("../../provider-concurrency", () => ({
  acquireProviderSlot: vi.fn().mockResolvedValue({ release: vi.fn() }),
  releaseProviderSlot: vi.fn(),
  getProviderInFlight: () => 0,
  getProviderConcurrencyOpts: () => ({}),
  getEffectiveProviderCap: () => 5,
  getConfiguredProviderCap: () => 5,
  recordProviderRateLimitHit: vi.fn(),
  recordProviderTrafficSuccess: vi.fn(),
}));
vi.mock("../../model-registry", () => ({ modelRegistry: { getBestForTask: () => null, size: () => 0 } }));
vi.mock("../../prompt-cache", () => ({
  getPromptCache: () => undefined,
  setPromptCache: vi.fn(),
  buildPromptHash: () => "hash",
}));
vi.mock("../../token-rotation", () => ({
  tryRotateProviderToken: vi.fn().mockResolvedValue({ success: false }),
  isRotatableAuthError: () => false,
}));
vi.mock("../../pipeline-watchdog", () => ({
  withTimeout: (p: any) => Promise.resolve(p),
  OptimizationProviderExhaustedError: class extends Error {},
  AI_CALL_TIMEOUT_MS: 30000,
}));
vi.mock("../../ai-diagnostics", () => ({ truncatePromptToTokenLimit: (m: any) => m, MAX_INPUT_TOKENS: 100000 }));
vi.mock("../../provider-capabilities", () => ({ isOpenCodeZenFree: () => false }));
vi.mock("../../circuit-breaker", () => ({ shouldSkipForOptimization: () => false, EMERGENCY_ONLY_PROVIDERS: new Set() }));
vi.mock("../../local-engine", () => ({ localGenerate: vi.fn() }));
vi.mock("../../agent-event-bus", () => ({ globalEventBus: { emit: vi.fn(), on: vi.fn() } }));
vi.mock("../../upstream-domain", () => ({
  upstreamDomainOf: () => null,
  buildUpstreamBlockMap: () => new Map(),
  UPSTREAM_QUOTA_DIVERT_REASON: "divert",
}));
vi.mock("../factory", () => ({
  ProviderFactory: { get: () => ({ chat: vi.fn() }) },
  ProviderError: class extends Error {},
}));
vi.mock("../fallback", () => ({
  FallbackManager: {
    buildChain: () => [],
    shouldRetry: () => false,
    backoffDelay: () => 0,
  },
  toProviderConfig: (p: any) => ({ apiKey: p?.apiKey ?? "", modelName: p?.modelName ?? "" }),
}));

import { ProviderRouter } from "../services/router";
import { aiHealthManager } from "../health/ai-health-manager";

const classify = (e: any) => (ProviderRouter as any).classifyRotationError(e);

describe("classifyRotationError — no blind model rotation (directive #12)", () => {
  it("429 does NOT trigger model rotation (quota is provider-level)", () => {
    const r = classify({ statusCode: 429, message: "Too many requests" });
    expect(r.keyRotation).toBe(true);
    expect(r.modelRotation).toBe(false);
  });

  it("\"Monthly usage limit reached\" does NOT trigger model rotation", () => {
    const r = classify({ statusCode: 429, message: "Monthly usage limit reached" });
    expect(r.modelRotation).toBe(false);
  });

  it("rate-limit wording does NOT trigger model rotation", () => {
    const r = classify({ message: "rate limit exceeded, slow down" });
    expect(r.keyRotation).toBe(true);
    expect(r.modelRotation).toBe(false);
  });

  it("model-not-found DOES trigger model rotation (stale model repair)", () => {
    const r = classify({ statusCode: 404, message: "The model `hy3-free` does not exist" });
    expect(r.modelRotation).toBe(true);
  });

  it("\"Model not supported by provider\" DOES trigger model rotation", () => {
    const r = classify({ statusCode: 401, message: "Model not supported by provider" });
    expect(r.modelRotation).toBe(true);
  });

  it("plain 401 keeps key rotation but not model rotation", () => {
    const r = classify({ statusCode: 401, message: "invalid api key" });
    expect(r.keyRotation).toBe(true);
    expect(r.modelRotation).toBe(false);
  });

  it("plain 500 triggers nothing (5xx is transient/provider-level)", () => {
    const r = classify({ statusCode: 503, message: "service unavailable" });
    expect(r.keyRotation).toBe(false);
    expect(r.modelRotation).toBe(false);
  });
});

describe("router → health registry evidence (directive #9)", () => {
  beforeEach(() => {
    aiHealthManager.reset();
  });

  it("health registry remains authoritative for observed outcomes", () => {
    // Simulate traffic evidence flowing into the central registry (the same
    // registry the Agent Configuration Center + benchmark + Route Manager read).
    aiHealthManager.recordSuccess({ providerId: "p1", providerName: "P1", canonicalModelId: "m1", ok: true, latencyMs: 80 });
    aiHealthManager.recordFailure({ providerId: "p1", providerName: "P1", canonicalModelId: "m1", ok: false, httpStatus: 429, errorMessage: "429" });
    const rec = aiHealthManager.getHealth("p1", "m1");
    expect(rec.state).toBe("rate_limited");
    expect(rec.errorCategory).toBe("rate_limit");
    expect(rec.httpStatus).toBe(429);
  });
});
