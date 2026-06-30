// ============================================================================
// Provider Platform Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock callAI before imports
vi.mock("../ai", () => ({
  callAI: vi.fn(),
}));

// Mock circuit-breaker
vi.mock("../circuit-breaker", () => ({
  isProviderAvailable: vi.fn(),
}));

// Mock store
vi.mock("../store", () => ({
  useApp: {
    getState: vi.fn(),
  },
}));

import { callAI } from "../ai";
import { isProviderAvailable } from "../circuit-breaker";
import { useApp } from "../store";
import {
  buildProviderRoutes,
  callWithRouting,
  callDefaultProvider,
  type ProviderPlatformConfig,
} from "./provider-platform";

function makeMockState(overrides?: Record<string, any>) {
  return {
    providers: [],
    providerSettings: {
      defaultProviderId: null,
      fallbackProviderIds: [],
      ...overrides?.providerSettings,
    },
    ...overrides,
  };
}

describe("buildProviderRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isProviderAvailable as any).mockReturnValue(true);
  });

  function setupProviders(...providers: { id: string; modelName?: string }[]) {
    (useApp.getState as any).mockReturnValue(
      makeMockState({
        providers: providers.map((p) => ({
          id: p.id,
          modelName: p.modelName ?? `${p.id}-model`,
          provider: p.id,
          model: p.modelName ?? `${p.id}-model`,
          taskCategory: "document",
          enabled: true,
        })),
      }),
    );
  }

  it("returns providers in configured priority order", () => {
    setupProviders(
      { id: "pute://" },
      { id: "openai" },
      { id: "claude" },
    );

    const routes = buildProviderRoutes({
      priorityOrder: ["claude", "openai", "pute://"],
    });

    expect(routes).toHaveLength(3);
    expect(routes[0].providerId).toBe("claude");
    expect(routes[1].providerId).toBe("openai");
    expect(routes[2].providerId).toBe("pute://");
    expect(routes[0].isFallback).toBe(false);
  });

  it("respects circuit breaker when useCircuitBreaker=true", () => {
    (isProviderAvailable as any).mockImplementation(
      (id: string) => id !== "pute://",
    );

    setupProviders(
      { id: "pute://" },
      { id: "openai" },
    );

    const routes = buildProviderRoutes({ useCircuitBreaker: true });
    expect(routes).toHaveLength(1);
    expect(routes[0].providerId).toBe("openai");
  });

  it("includes circuit-broken providers when useCircuitBreaker=false", () => {
    (isProviderAvailable as any).mockImplementation(
      (id: string) => id !== "pute://",
    );

    setupProviders(
      { id: "pute://" },
      { id: "openai" },
    );

    const routes = buildProviderRoutes({ useCircuitBreaker: false });
    expect(routes).toHaveLength(2);
  });

  it("uses default provider when no priorityOrder given", () => {
    setupProviders(
      { id: "claude" },
      { id: "openai" },
    );
    (useApp.getState as any).mockReturnValue(
      makeMockState({
        providers: [
          { id: "claude", modelName: "claude-model", provider: "claude", model: "claude-model", taskCategory: "document", enabled: true },
          { id: "openai", modelName: "openai-model", provider: "openai", model: "openai-model", taskCategory: "document", enabled: true },
        ],
        providerSettings: {
          defaultProviderId: "openai",
          fallbackProviderIds: ["claude"],
        },
      }),
    );

    const routes = buildProviderRoutes();
    expect(routes[0].providerId).toBe("openai");
    expect(routes[0].isFallback).toBe(false);
    expect(routes[1].providerId).toBe("claude");
    expect(routes[1].isFallback).toBe(true);
  });

  it("deduplicates providers", () => {
    setupProviders(
      { id: "openai" },
    );
    (useApp.getState as any).mockReturnValue(
      makeMockState({
        providers: [
          { id: "openai", modelName: "o1", provider: "openai", model: "o1", taskCategory: "document", enabled: true },
        ],
        providerSettings: {
          defaultProviderId: "openai",
          fallbackProviderIds: ["openai"], // duplicate
        },
      }),
    );

    const routes = buildProviderRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].providerId).toBe("openai");
  });

  it("returns empty array when no providers exist", () => {
    (useApp.getState as any).mockReturnValue(makeMockState());
    const routes = buildProviderRoutes();
    expect(routes).toHaveLength(0);
  });
});

describe("callWithRouting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isProviderAvailable as any).mockReturnValue(true);
    (useApp.getState as any).mockReturnValue(
      makeMockState({
        providers: [
          { id: "openai", modelName: "o1", provider: "openai", model: "o1", taskCategory: "document", enabled: true },
          { id: "claude", modelName: "claude-3", provider: "claude", model: "claude-3", taskCategory: "document", enabled: true },
        ],
      }),
    );
  });

  it("uses the first available provider", async () => {
    (callAI as any).mockResolvedValue({
      text: "result from openai",
      provider: "openai",
      latencyMs: 100,
    });

    const result = await callWithRouting(
      { systemPrompt: "You are helpful", userPrompt: "Hello" },
      { priorityOrder: ["openai", "claude"] },
    );

    expect(result.text).toBe("result from openai");
    expect(result.usedProvider.providerId).toBe("openai");
    expect(result.attemptedRoutes).toHaveLength(1);
  });

  it("falls back to next provider when first fails", async () => {
    (callAI as any)
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce({
        text: "result from claude",
        provider: "claude",
        latencyMs: 200,
      });

    const result = await callWithRouting(
      { userPrompt: "Hello" },
      { priorityOrder: ["openai", "claude"] },
    );

    expect(result.text).toBe("result from claude");
    expect(result.usedProvider.providerId).toBe("claude");
    expect(result.attemptedRoutes).toHaveLength(2);
    expect(result.attemptedRoutes[0].providerId).toBe("openai");
    expect(result.attemptedRoutes[1].providerId).toBe("claude");
  });

  it("throws when all providers fail", async () => {
    (callAI as any)
      .mockRejectedValueOnce(new Error("openai error"))
      .mockRejectedValueOnce(new Error("claude error"));

    await expect(
      callWithRouting({ userPrompt: "test" }, { priorityOrder: ["openai", "claude"] }),
    ).rejects.toThrow("claude error");
  });

  it("throws when no routes available", async () => {
    (useApp.getState as any).mockReturnValue(makeMockState());

    await expect(
      callWithRouting({ userPrompt: "test" }),
    ).rejects.toThrow("No providers available");
  });

  it("passes options through to callAI", async () => {
    (callAI as any).mockResolvedValue({
      text: "ok",
      provider: "openai",
      latencyMs: 50,
    });

    await callWithRouting(
      { systemPrompt: "sys", userPrompt: "usr" },
      {
        maxTokens: 500,
        temperature: 0.5,
        timeoutMs: 30000,
        isOptimizerCall: true,
        taskCategory: "document",
        priorityOrder: ["openai"],
      },
    );

    expect(callAI).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "sys",
        userPrompt: "usr",
        maxTokens: 500,
        temperature: 0.5,
        timeoutMs: 30000,
        isOptimizerCall: true,
        taskCategory: "document",
      }),
    );
  });
});

describe("callDefaultProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isProviderAvailable as any).mockReturnValue(true);
  });

  it("uses the default provider without fallback", async () => {
    (useApp.getState as any).mockReturnValue(
      makeMockState({
        providers: [
          { id: "openai", modelName: "o1", provider: "openai", model: "o1", taskCategory: "document", enabled: true },
        ],
        providerSettings: { defaultProviderId: "openai", fallbackProviderIds: [] },
      }),
    );

    (callAI as any).mockResolvedValue({
      text: "default result",
      provider: "openai",
      latencyMs: 100,
    });

    const result = await callDefaultProvider(
      { userPrompt: "Hello" },
    );

    expect(result.text).toBe("default result");
    expect(result.usedProvider.providerId).toBe("openai");
    expect(result.attemptedRoutes).toHaveLength(1);
  });

  it("throws when no provider available", async () => {
    (useApp.getState as any).mockReturnValue(makeMockState());

    await expect(
      callDefaultProvider({ userPrompt: "test" }),
    ).rejects.toThrow("No provider available");
  });
});
