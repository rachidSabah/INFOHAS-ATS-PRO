// ============================================================================
// Workers AI router selection semantics (Task 16)
//
// The free neurons/day quota must be RESERVED for failover:
//   - normal selection NEVER picks workers-ai (emergency-only gate)
//   - explicit agent routes / emergency rescue MAY target it (allowEmergency)
//   - no API key is required (auth is the account binding itself)
// ============================================================================

import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers: [],
      providerSettings: { retryAttempts: 1, puterEmergencyRescue: true },
      user: { role: "super_admin" },
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
vi.mock("../../prompt-cache", () => ({ getPromptCache: () => undefined, setPromptCache: vi.fn(), buildPromptHash: () => "hash" }));
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
// NOTE: circuit-breaker is NOT mocked — the real EMERGENCY_ONLY_PROVIDERS set
// (puter + workers-ai) drives the gates under test here.
vi.mock("../../local-engine", () => ({ localGenerate: vi.fn() }));
vi.mock("../../agent-event-bus", () => ({ globalEventBus: { emit: vi.fn(), on: vi.fn() } }));
vi.mock("../../upstream-domain", () => ({
  upstreamDomainOf: () => null,
  buildUpstreamBlockMap: () => new Map(),
  UPSTREAM_QUOTA_DIVERT_REASON: "divert",
}));

import { hasValidApiKey, isAvailableForSelection, selectProviderForAgent } from "../services/router";
import { EMERGENCY_ONLY_PROVIDERS } from "../../circuit-breaker";

const WORKERSAI_ROW = {
  id: "p_workersai", name: "Workers AI (native, free rescue)", type: "workers-ai",
  priority: 5, isActive: true, status: "untested", apiKey: "", allowedForRegularUsers: true,
};
const MISTRAL_ROW = {
  id: "p_mistral", name: "Mistral", type: "mistral",
  priority: 10, isActive: true, status: "healthy", apiKey: "sk-test", allowedForRegularUsers: true,
};
const PUTER_ROW = {
  id: "p_puter", name: "Puter.js", type: "puter",
  priority: 1, isActive: true, status: "degraded", allowedForRegularUsers: true,
};

describe("Workers AI emergency-only gating", () => {
  it("registers p_workersai + workers-ai as emergency-only providers", () => {
    expect(EMERGENCY_ONLY_PROVIDERS.has("workers-ai")).toBe(true);
    expect(EMERGENCY_ONLY_PROVIDERS.has("p_workersai")).toBe(true);
  });

  it("needs NO API key (native account binding auth)", () => {
    expect(hasValidApiKey(WORKERSAI_ROW)).toBe(true);
    expect(hasValidApiKey({ ...WORKERSAI_ROW, apiKey: undefined })).toBe(true);
  });

  it("is EXCLUDED from normal selection (quota protection) but ALLOWED via allowEmergency", () => {
    expect(isAvailableForSelection(WORKERSAI_ROW)).toBe(false);
    expect(isAvailableForSelection(WORKERSAI_ROW, [], { allowEmergency: true })).toBe(true);
  });

  it("selection prefers the paid provider — workers-ai is never a primary engine", async () => {
    const { useApp } = await import("../../store");
    (useApp.getState as any) = () => ({
      providers: [MISTRAL_ROW, WORKERSAI_ROW],
      providerSettings: { retryAttempts: 1, puterEmergencyRescue: true },
      user: { role: "super_admin" },
    });
    const picked = await selectProviderForAgent("supervisor");
    expect(picked.id).toBe("p_mistral");
  });

  it("EMERGENCY RESCUE can still reach workers-ai when everything else is exhausted", async () => {
    const { useApp } = await import("../../store");
    (useApp.getState as any) = () => ({
      providers: [WORKERSAI_ROW], // mistral excluded / burned, puter absent
      providerSettings: { retryAttempts: 1, puterEmergencyRescue: true },
      user: { role: "super_admin" },
    });
    const picked = await selectProviderForAgent("supervisor");
    expect(picked.id).toBe("p_workersai");
  });
});
