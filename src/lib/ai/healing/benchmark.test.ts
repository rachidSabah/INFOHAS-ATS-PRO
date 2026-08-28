// ============================================================================
// Provider-Aware Benchmark — model resolution tests (model selection
// authority bug fix). The provider's own CONFIGURED modelName must be pinged
// first; the static enabledModels seed list is only a fallback. No network.
// ============================================================================

import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers: [],
      providerSettings: { autoHealProviders: false },
      updateProvider: vi.fn(),
    }),
  },
}));
vi.mock("../../provider-cooldown", () => ({ isProviderInCooldown: () => false }));
vi.mock("../../circuit-breaker", () => ({ getCooldownRemaining: () => 0, resetCircuitBreaker: vi.fn() }));
vi.mock("../../rate-limit-tracker", () => ({
  rateLimitTracker: { isRateLimited: () => false, getCooldownRemainingMs: () => 0, recordSuccess: vi.fn() },
}));
vi.mock("../../provider-health", () => ({ recordSuccess: vi.fn(), recordFailure: vi.fn() }));
vi.mock("../../services/router", () => ({ ProviderRouter: { chat: vi.fn() } }));
vi.mock("../../services/manager", () => ({ ProviderManager: { fetchModels: vi.fn(), testConnection: vi.fn() } }));
vi.mock("../../heal-history", () => ({ recordHealEvent: vi.fn() }));

import { resolveProviderBenchmarkModel } from "./benchmark";
import type { AIProvider } from "../../types";

function makeProvider(overrides: Partial<any> = {}): AIProvider {
  return {
    id: "p_groq", name: "Groq", type: "groq", isActive: true,
    modelName: "", enabledModels: [], timeout: 15000,
    ...overrides,
  } as unknown as AIProvider;
}

describe("resolveProviderBenchmarkModel — model selection authority", () => {
  it("pings the CONFIGURED modelName first (the model the user picked from Fetch models)", () => {
    const provider = makeProvider({
      modelName: "llama-3.1-8b-instant", // live-selected, NOT first in enabledModels
      enabledModels: ["llama-3.3-70b-versatile"], // static seed list — retired id
    });
    const { model, source } = resolveProviderBenchmarkModel(provider);
    expect(model).toBe("llama-3.1-8b-instant");
    expect(source).toBe("configured");
  });

  it("falls back to enabledModels[0] only when modelName is empty", () => {
    const provider = makeProvider({ modelName: "", enabledModels: ["some-fallback-model"] });
    const { model, source } = resolveProviderBenchmarkModel(provider);
    expect(model).toBe("some-fallback-model");
    expect(source).toBe("enabled");
  });

  it("falls back to the catalog default when no model is configured at all", () => {
    const provider = makeProvider({ type: "groq", modelName: "", enabledModels: [] });
    const { model, source } = resolveProviderBenchmarkModel(provider);
    expect(model).toBe("llama-3.3-70b-versatile"); // groq catalog default
    expect(source).toBe("catalog");
  });

  it("reports (none configured) for a custom provider without any model", () => {
    const provider = makeProvider({ type: "custom", modelName: "", enabledModels: [] });
    const { model, source } = resolveProviderBenchmarkModel(provider);
    expect(model).toBe("(none configured)");
    expect(source).toBe("none");
  });

  it("ignores a whitespace-only modelName", () => {
    const provider = makeProvider({ modelName: "   ", enabledModels: ["fallback-model"] });
    const { model, source } = resolveProviderBenchmarkModel(provider);
    expect(model).toBe("fallback-model");
    expect(source).toBe("enabled");
  });
});
