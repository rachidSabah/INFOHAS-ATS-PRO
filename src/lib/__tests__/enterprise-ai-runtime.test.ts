// ============================================================================
// Enterprise AI Runtime — Comprehensive Phase 4 Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Type & Mock Imports ──────────────────────────────────────────────────

import type {
  AIProvider,
  ProviderConfig,
  ChatRequest,
  ChatResponse,
  ProviderHealth,
  AuthCredentials,
  AuthStatus,
  ModelInfo,
  StreamHandler,
  CapabilityRequirement,
} from "../enterprise-ai-runtime/types";

import { FAILOVER_LEVELS } from "../enterprise-ai-runtime/types";
import { ProviderRegistry } from "../enterprise-ai-runtime/provider-registry";
import { CapabilityEngine } from "../enterprise-ai-runtime/capability-engine";
import { AuthManager } from "../enterprise-ai-runtime/auth-manager";
import { HealthMonitor } from "../enterprise-ai-runtime/health-monitor";
import { RetryManager } from "../enterprise-ai-runtime/retry-manager";
import { FailoverEngine } from "../enterprise-ai-runtime/failover-engine";
import { EnterpriseAIRuntime } from "../enterprise-ai-runtime/runtime";
import { LocalEngineProvider } from "../enterprise-ai-runtime/local-engine";

// ── Mock Provider ───────────────────────────────────────────────────────

function createMockProvider(id: string, name: string, models: ModelInfo[]): AIProvider {
  return {
    id,
    name,
    models,
    initialize: vi.fn(),
    shutdown: vi.fn(),
    authenticate: vi.fn().mockResolvedValue({ authenticated: true, needsRefresh: false }),
    refresh: vi.fn().mockResolvedValue({ authenticated: true, needsRefresh: false }),
    chat: vi.fn().mockResolvedValue({
      text: `Response from ${name}`,
      provider: id,
      model: models[0]?.id ?? "unknown",
      latencyMs: 100,
      finishReason: "stop" as const,
    }),
    stream: vi.fn().mockImplementation(async (_req: ChatRequest, handler: StreamHandler) => {
      handler.onChunk?.("chunk");
      handler.onDone?.({
        text: "streamed response",
        provider: id,
        model: models[0]?.id ?? "unknown",
        latencyMs: 100,
        finishReason: "stop" as const,
      });
      return {
        text: "streamed response",
        provider: id,
        model: models[0]?.id ?? "unknown",
        latencyMs: 100,
        finishReason: "stop" as const,
      };
    }),
    embeddings: vi.fn(),
    vision: vi.fn(),
    reasoning: vi.fn(),
    tools: vi.fn(),
    supportsCapability: vi.fn().mockReturnValue(true),
    estimateCost: vi.fn().mockReturnValue({
      estimatedInputCost: 10,
      estimatedOutputCost: 20,
      totalEstimatedCost: 30,
      currency: "micro-dollars" as const,
    }),
    estimateLatency: vi.fn().mockReturnValue({ estimatedMs: 500, confidence: "medium" as const }),
    estimateQuality: vi.fn().mockReturnValue({ estimatedScore: 80, confidence: "medium" as const }),
    health: vi.fn().mockResolvedValue({
      status: "healthy" as const,
      latencyMs: 50,
      lastChecked: Date.now(),
      successRate: 100,
      consecutiveFailures: 0,
      circuitState: "closed" as const,
    }),
  };
}

function createModel(id: string, provider: string, overrides?: Partial<ModelInfo>): ModelInfo {
  return {
    id,
    provider,
    providerName: provider,
    family: "test",
    version: "1.0",
    contextSize: 128_000,
    capabilities: {
      reasoning: true,
      vision: false,
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      functionCalling: true,
    },
    speed: 80,
    quality: 85,
    reliability: 90,
    costPerInputToken: 5,
    costPerOutputToken: 15,
    rateLimitPerMinute: 100,
    available: true,
    ...overrides,
  };
}

function createConfig(id: string): ProviderConfig {
  return {
    id,
    name: `Provider ${id}`,
    type: "test",
    auth: { type: "api-key", apiKey: "test-key" },
    timeout: 30000,
    maxRetries: 3,
    rateLimitPerMinute: 100,
  };
}

// ============================================================================
// 1. ProviderRegistry Tests
// ============================================================================

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("registers a provider", async () => {
    const mock = createMockProvider("test", "Test Provider", [createModel("m1", "test")]);
    const config = createConfig("test");
    const reg = await registry.register(mock, config);
    expect(registry.get("test")).toBeDefined();
    expect(registry.getProviderCount()).toBe(1);
    expect(registry.getProvider("test")).toBe(mock);
  });

  it("unregisters a provider", async () => {
    const mock = createMockProvider("test", "Test", [createModel("m1", "test")]);
    await registry.register(mock, createConfig("test"));
    expect(registry.unregister("test")).toBe(true);
    expect(registry.get("test")).toBeUndefined();
    expect(registry.getProviderCount()).toBe(0);
  });

  it("returns all registered providers", async () => {
    const m1 = createMockProvider("p1", "P1", [createModel("m1", "p1")]);
    const m2 = createMockProvider("p2", "P2", [createModel("m2", "p2")]);
    await registry.register(m1, createConfig("p1"));
    await registry.register(m2, createConfig("p2"));
    expect(registry.getAll().length).toBe(2);
  });

  it("indexes model info on registration", async () => {
    const model = createModel("gpt-4", "openai");
    const mock = createMockProvider("openai", "OpenAI", [model]);
    await registry.register(mock, createConfig("openai"));
    expect(registry.getModel("gpt-4")).toBeDefined();
    expect(registry.getModel("gpt-4")?.contextSize).toBe(128_000);
    expect(registry.getModelCount()).toBe(1);
  });

  it("queries models by provider", async () => {
    const mock = createMockProvider("openai", "OpenAI", [
      createModel("gpt-4", "openai"),
      createModel("gpt-3.5", "openai"),
    ]);
    await registry.register(mock, createConfig("openai"));
    const models = registry.getModelsByProvider("openai");
    expect(models.length).toBe(2);
  });

  it("finds models by criteria", async () => {
    const mock = createMockProvider("test", "Test", [
      createModel("fast-model", "test", { speed: 95, quality: 60 }),
      createModel("quality-model", "test", { speed: 60, quality: 95 }),
    ]);
    await registry.register(mock, createConfig("test"));
    const fast = registry.findModels({ speed: 95 });
    expect(fast.length).toBe(1);
    expect(fast[0].id).toBe("fast-model");
  });

  it("tracks call stats", async () => {
    const mock = createMockProvider("test", "Test", [createModel("m1", "test")]);
    await registry.register(mock, createConfig("test"));
    registry.recordCall("test", true, 100, 50, 200, 85);
    registry.recordCall("test", false, 200, 30, 100, 0);
    const stats = registry.getStats("test");
    expect(stats?.totalCalls).toBe(2);
    expect(stats?.successfulCalls).toBe(1);
    expect(stats?.failedCalls).toBe(1);
    expect(stats?.averageLatencyMs).toBe(150);
    expect(stats?.totalCost).toBe(80);
  });

  it("only returns healthy providers", async () => {
    const h1 = createMockProvider("healthy", "Healthy", [createModel("hm1", "healthy")]);
    const h2 = createMockProvider("degraded", "Degraded", [createModel("dm1", "degraded")]);
    h2.health = vi.fn().mockResolvedValue({
      status: "degraded", latencyMs: 500, lastChecked: Date.now(),
      successRate: 50, consecutiveFailures: 2, circuitState: "closed",
    });
    const h3 = createMockProvider("unhealthy", "Unhealthy", [createModel("um1", "unhealthy")]);
    h3.health = vi.fn().mockResolvedValue({
      status: "unhealthy", latencyMs: 0, lastChecked: Date.now(),
      successRate: 10, consecutiveFailures: 10, circuitState: "open",
    });
    await registry.register(h1, createConfig("healthy"));
    await registry.register(h2, createConfig("degraded"));
    await registry.register(h3, createConfig("unhealthy"));
    const healthy = registry.getAllHealthy();
    expect(healthy.length).toBe(2); // healthy + degraded, not unhealthy
  });
});

// ============================================================================
// 2. AuthManager Tests
// ============================================================================

describe("AuthManager", () => {
  let auth: AuthManager;

  beforeEach(() => {
    auth = new AuthManager();
  });

  it("stores and retrieves credentials", () => {
    auth.store("openai", { type: "api-key", apiKey: "sk-123" });
    const creds = auth.get("openai");
    expect(creds?.apiKey).toBe("sk-123");
  });

  it("detects valid api-key credentials", () => {
    auth.store("openai", { type: "api-key", apiKey: "sk-valid" });
    expect(auth.hasValidCredentials("openai")).toBe(true);
  });

  it("detects missing credentials", () => {
    expect(auth.hasValidCredentials("nonexistent")).toBe(false);
  });

  it("detects empty api keys", () => {
    auth.store("empty", { type: "api-key", apiKey: "" });
    expect(auth.hasValidCredentials("empty")).toBe(false);
  });

  it("builds auth headers for api-key type", () => {
    auth.store("openai", { type: "api-key", apiKey: "sk-123" });
    const headers = auth.buildHeaders("openai");
    expect(headers.Authorization).toBe("Bearer sk-123");
  });

  it("builds auth headers for oauth type", () => {
    auth.store("anthropic", { type: "oauth", accessToken: "oauth-token" });
    const headers = auth.buildHeaders("anthropic");
    expect(headers.Authorization).toBe("Bearer oauth-token");
  });

  it("returns empty headers for no-auth providers", () => {
    auth.store("local", { type: "none" });
    const headers = auth.buildHeaders("local");
    expect(headers).toEqual({});
  });

  it("detects token expiry and refresh need", () => {
    const expired = Date.now() - 10_000;
    auth.store("test", { type: "api-key", apiKey: "key", expiresAt: expired });
    expect(auth.hasValidCredentials("test")).toBe(false);
  });

  it("updates access token after refresh", () => {
    auth.store("test", { type: "api-key", apiKey: "initial-key" });
    auth.updateToken("test", "refreshed-token", Date.now() + 3600000);
    expect(auth.get("test")?.accessToken).toBe("refreshed-token");
  });

  it("removes credentials", () => {
    auth.store("test", { type: "api-key", apiKey: "key" });
    auth.remove("test");
    expect(auth.hasValidCredentials("test")).toBe(false);
  });

  it("initializes from config array", () => {
    const configs = [
      { id: "p1", name: "P1", type: "test", auth: { type: "api-key" as const, apiKey: "k1" }, timeout: 30_000, maxRetries: 3, rateLimitPerMinute: 100 },
      { id: "p2", name: "P2", type: "test", auth: { type: "none" as const }, timeout: 30_000, maxRetries: 3, rateLimitPerMinute: 100 },
    ];
    auth.initializeFromConfig(configs);
    expect(auth.hasValidCredentials("p1")).toBe(true);
    expect(auth.hasValidCredentials("p2")).toBe(true);
  });

  it("lists authenticated providers", () => {
    auth.store("p1", { type: "api-key", apiKey: "valid" });
    auth.store("p2", { type: "api-key", apiKey: "" });
    auth.store("p3", { type: "none" });
    const authed = auth.getAuthenticatedProviders();
    expect(authed).toContain("p1");
    expect(authed).toContain("p3");
    expect(authed).not.toContain("p2");
  });

  it("clears all credentials", () => {
    auth.store("p1", { type: "api-key", apiKey: "k1" });
    auth.store("p2", { type: "none" });
    auth.clearAll();
    expect(auth.hasValidCredentials("p1")).toBe(false);
    expect(auth.hasValidCredentials("p2")).toBe(false);
  });
});

// ============================================================================
// 3. HealthMonitor Tests
// ============================================================================

describe("HealthMonitor", () => {
  let registry: ProviderRegistry;
  let monitor: HealthMonitor;

  beforeEach(() => {
    registry = new ProviderRegistry();
    monitor = new HealthMonitor(registry, {
      failureThreshold: 3,
      successThreshold: 2,
      halfOpenMaxCalls: 1,
      cooldownMs: 100,
    });
  });

  it("allows calls by default for untracked providers", () => {
    expect(monitor.isAllowed("unknown")).toBe(true);
  });

  it("records success and updates health", async () => {
    // First register a provider
    const provider = createMockProvider("openai", "OpenAI", [createModel("gpt-4", "openai")]);
    await registry.register(provider, createConfig("openai"));

    monitor.recordSuccess("openai", 100);
    const reg = registry.get("openai");
    expect(reg?.health.status).toBe("healthy");
    expect(reg?.health.latencyMs).toBe(100);
  });

  it("opens circuit after consecutive failures", () => {
    monitor.recordFailure("openai", "err1");
    monitor.recordFailure("openai", "err2");
    monitor.recordFailure("openai", "err3");
    const circuit = monitor.getCircuitState("openai");
    expect(circuit?.state).toBe("open");
    expect(monitor.isAllowed("openai")).toBe(false);
  });

  it("blocks calls when circuit is open", () => {
    monitor.recordFailure("openai", "err1");
    monitor.recordFailure("openai", "err2");
    monitor.recordFailure("openai", "err3");
    expect(monitor.isAllowed("openai")).toBe(false);
  });

  it("transitions to half-open after cooldown", async () => {
    monitor.recordFailure("openai", "err1");
    monitor.recordFailure("openai", "err2");
    monitor.recordFailure("openai", "err3");

    // Wait for cooldown to elapse
    await new Promise((r) => setTimeout(r, 150));

    expect(monitor.isAllowed("openai")).toBe(true);
    const circuit = monitor.getCircuitState("openai");
    expect(circuit?.state).toBe("half-open");
  });

  it("closes circuit after success in half-open", () => {
    // Open the circuit
    monitor.recordFailure("openai", "err1");
    monitor.recordFailure("openai", "err2");
    monitor.recordFailure("openai", "err3");
    // Manually set to half-open
    const circuit = monitor.getCircuitState("openai")!;
    circuit.state = "half-open";

    // Record successes to close
    monitor.recordSuccess("openai", 50);
    monitor.recordSuccess("openai", 50);
    const updated = monitor.getCircuitState("openai");
    expect(updated?.state).toBe("closed");
  });

  it("resets circuit breaker via resetCircuit", () => {
    monitor.recordFailure("openai", "err1");
    monitor.recordFailure("openai", "err2");
    monitor.recordFailure("openai", "err3");
    expect(monitor.isAllowed("openai")).toBe(false);

    monitor.resetCircuit("openai");
    expect(monitor.isAllowed("openai")).toBe(true);
    const circuit = monitor.getCircuitState("openai");
    expect(circuit?.state).toBe("closed");
    expect(circuit?.consecutiveFailures).toBe(0);
  });

  it("returns circuit summary", () => {
    monitor.recordFailure("p1", "fail");
    monitor.recordFailure("p2", "fail");
    monitor.recordFailure("p2", "fail");
    const summary = monitor.getCircuitSummary();
    expect(summary.length).toBe(2);
    const p2 = summary.find((s) => s.providerId === "p2");
    expect(p2?.failures).toBe(2);
  });
});

// ============================================================================
// 4. RetryManager Tests
// ============================================================================

describe("RetryManager", () => {
  let retry: RetryManager;

  beforeEach(() => {
    retry = new RetryManager({ maxRetries: 2, baseDelayMs: 10, timeoutMs: 1000 });
  });

  it("succeeds on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await retry.execute(fn);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockRejectedValueOnce(new Error("500 server error"))
      .mockResolvedValue("success");
    const result = await retry.execute(fn);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns failure after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent error"));
    const result = await retry.execute(fn);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3); // initial + 2 retries
    expect(result.error).toContain("All");
  });

  it("should retry on rate limit errors", () => {
    expect(retry.shouldRetry(new Error("429 rate limit"))).toBe(true);
    expect(retry.shouldRetry(new Error("500 internal error"))).toBe(true);
    expect(retry.shouldRetry(new Error("service unavailable"))).toBe(true);
    expect(retry.shouldRetry(new Error("timeout"))).toBe(true);
    expect(retry.shouldRetry(new Error("econnrefused"))).toBe(true);
  });

  it("should NOT retry on auth errors", () => {
    expect(retry.shouldRetry(new Error("401 unauthorized"))).toBe(false);
    expect(retry.shouldRetry(new Error("403 forbidden"))).toBe(false);
    expect(retry.shouldRetry(new Error("invalid api key"))).toBe(false);
  });

  it("supports config updates", () => {
    expect(retry.getConfig().maxRetries).toBe(2);
    retry.updateConfig({ maxRetries: 5 });
    expect(retry.getConfig().maxRetries).toBe(5);
  });
});

// ============================================================================
// 5. CapabilityEngine Tests
// ============================================================================

describe("CapabilityEngine", () => {
  let registry: ProviderRegistry;
  let engine: CapabilityEngine;

  beforeEach(async () => {
    registry = new ProviderRegistry();
    engine = new CapabilityEngine(registry);

    const openaiMock = createMockProvider("openai", "OpenAI", [
      createModel("gpt-4", "openai", { quality: 95, speed: 70, costPerOutputToken: 30 }),
      createModel("gpt-3.5", "openai", { quality: 75, speed: 90, costPerOutputToken: 5 }),
    ]);
    const anthropicMock = createMockProvider("anthropic", "Anthropic", [
      createModel("claude-3", "anthropic", { quality: 93, speed: 65, costPerOutputToken: 25 }),
    ]);

    await registry.register(openaiMock, createConfig("openai"));
    await registry.register(anthropicMock, createConfig("anthropic"));
  });

  it("selects best model for high quality requirement", () => {
    const selection = engine.selectModel({ minQuality: 90 });
    expect(selection).not.toBeNull();
    expect(selection!.model.quality).toBeGreaterThanOrEqual(90);
  });

  it("selects cheapest model when cost is constrained", () => {
    const selection = engine.selectModel({ maxCost: 10 });
    expect(selection).not.toBeNull();
    expect(selection!.model.costPerOutputToken).toBeLessThanOrEqual(10);
    expect(selection!.modelId).toBe("gpt-3.5");
  });

  it("returns null when no models meet requirements", () => {
    const selection = engine.selectModel({ minQuality: 99 });
    expect(selection).toBeNull();
  });

  it("respects reasoning capability requirement", () => {
    const models = registry.findModels({});
    for (const m of models) {
      expect(engine.supportsCapability(m, "reasoning")).toBe(true);
    }
  });

  it("builds an execution plan with cost estimates", () => {
    const plan = engine.buildPlan({}, 1000);
    expect(plan).not.toBeNull();
    expect(plan!.estimatedCost.totalEstimatedCost).toBeGreaterThan(0);
    expect(plan!.estimatedLatency.estimatedMs).toBeGreaterThan(0);
    expect(plan!.estimatedQuality.estimatedScore).toBeGreaterThan(0);
  });

  it("returns null plan when no model available", () => {
    // Unregister all providers
    registry.unregister("openai");
    registry.unregister("anthropic");
    const plan = engine.buildPlan({}, 1000);
    expect(plan).toBeNull();
  });

  it("learns from telemetry and updates model scores", () => {
    const telemetry = [
      { providerId: "openai", modelId: "gpt-4", task: "ats", success: true, latencyMs: 200, inputTokens: 500, outputTokens: 200, cost: 100, qualityScore: 90, failoverLevel: 0 as const, timestamp: Date.now() },
      { providerId: "openai", modelId: "gpt-4", task: "ats", success: true, latencyMs: 300, inputTokens: 500, outputTokens: 200, cost: 100, qualityScore: 85, failoverLevel: 0 as const, timestamp: Date.now() },
    ];
    const modelBefore = registry.getModel("gpt-4");
    const qualityBefore = modelBefore?.quality;

    engine.incorporateTelemetry(telemetry);
    const modelAfter = registry.getModel("gpt-4");
    // Quality should have been updated (80% old + 20% avg telemetry)
    expect(modelAfter?.quality).not.toBe(qualityBefore);
  });
});

// ============================================================================
// 6. FailoverEngine Tests
// ============================================================================

describe("FailoverEngine", () => {
  let registry: ProviderRegistry;
  let monitor: HealthMonitor;
  let retry: RetryManager;
  let failover: FailoverEngine;
  let localProvider: LocalEngineProvider;

  beforeEach(async () => {
    registry = new ProviderRegistry();
    monitor = new HealthMonitor(registry, {
      failureThreshold: 3,
      successThreshold: 2,
      halfOpenMaxCalls: 1,
      cooldownMs: 100,
    });
    retry = new RetryManager({ maxRetries: 1, baseDelayMs: 10, timeoutMs: 1000 });
    localProvider = new LocalEngineProvider();
    await localProvider.initialize({
      id: "local", name: "Local", type: "local",
      auth: { type: "none" }, timeout: 30000, maxRetries: 0, rateLimitPerMinute: 0,
    });

    failover = new FailoverEngine(registry, monitor, retry, localProvider);
  });

  it("executes successfully on primary provider", async () => {
    const mock = createMockProvider("primary", "Primary", [
      createModel("m1", "primary", { speed: 80, quality: 85 }),
    ]);
    const mockChat = vi.mocked(mock.chat);
    mockChat.mockResolvedValue({
      text: "success", provider: "primary", model: "m1",
      latencyMs: 50, finishReason: "stop",
    });
    await registry.register(mock, createConfig("primary"));

    const plan = {
      providerId: "primary", modelId: "m1",
      estimatedCost: { estimatedInputCost: 0, estimatedOutputCost: 0, totalEstimatedCost: 0, currency: "micro-dollars" as const },
      estimatedLatency: { estimatedMs: 50, confidence: "high" as const },
      estimatedQuality: { estimatedScore: 85, confidence: "high" as const },
      reasoning: "Direct call",
    };

    const result = await failover.executeWithFailover(
      { messages: [{ role: "user" as const, content: "hello" }] },
      plan,
    );
    expect(result.response.text).toBe("success");
    expect(result.failoverLevel).toBe(FAILOVER_LEVELS.PRIMARY);
  });

  it("falls back to local engine when primary fails", async () => {
    const mock = createMockProvider("failing", "Failing", [
      createModel("m1", "failing"),
    ]);
    const mockChat = vi.mocked(mock.chat);
    mockChat.mockRejectedValue(new Error("500 server error"));
    await registry.register(mock, createConfig("failing"));

    const plan = {
      providerId: "failing", modelId: "m1",
      estimatedCost: { estimatedInputCost: 0, estimatedOutputCost: 0, totalEstimatedCost: 0, currency: "micro-dollars" as const },
      estimatedLatency: { estimatedMs: 50, confidence: "high" as const },
      estimatedQuality: { estimatedScore: 85, confidence: "high" as const },
      reasoning: "Direct call",
    };

    const result = await failover.executeWithFailover(
      { messages: [{ role: "user" as const, content: "hello" }] },
      plan,
    );
    expect(result.failoverLevel).toBe(FAILOVER_LEVELS.LOCAL_ENGINE);
    expect(result.response.text).toContain("Local Engine");
  });
});

// ============================================================================
// 7. EnterpriseAIRuntime Tests
// ============================================================================

describe("EnterpriseAIRuntime", () => {
  it("initializes and shuts down", async () => {
    const runtime = new EnterpriseAIRuntime({ enableTelemetry: false });
    await runtime.initialize();
    expect(runtime.hasProviders()).toBe(false);
    await runtime.shutdown();
  });

  it("registers providers and indexes models", async () => {
    const runtime = new EnterpriseAIRuntime({ enableTelemetry: false });
    await runtime.initialize();

    const mock = createMockProvider("test", "Test Provider", [
      createModel("test-model", "test"),
    ]);
    await runtime.registerProvider(mock, createConfig("test"));

    expect(runtime.registry.getProviderCount()).toBe(1);
    expect(runtime.registry.getModelCount()).toBe(1);
    expect(runtime.hasProviders()).toBe(true);
    await runtime.shutdown();
  });

  it("throws when not initialized", async () => {
    const runtime = new EnterpriseAIRuntime();
    await expect(
      runtime.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("not initialized");
  });

  it("creates a test instance", () => {
    const runtime = EnterpriseAIRuntime.createForTesting();
    expect(runtime.hasProviders()).toBe(false); // no providers registered
  });

  it("returns empty telemetry initially", () => {
    const runtime = new EnterpriseAIRuntime({ enableTelemetry: true });
    expect(runtime.getTelemetry()).toEqual([]);
  });
});

// ============================================================================
// 8. LocalEngineProvider Tests
// ============================================================================

describe("LocalEngineProvider", () => {
  let local: LocalEngineProvider;

  beforeEach(async () => {
    local = new LocalEngineProvider();
    await local.initialize({
      id: "local", name: "Local Engine", type: "local",
      auth: { type: "none" }, timeout: 30000, maxRetries: 0, rateLimitPerMinute: 0,
    });
  });

  it("has correct identity", () => {
    expect(local.id).toBe("local");
    expect(local.name).toBe("Local Engine");
    expect(local.models.length).toBe(1);
  });

  it("always authenticates successfully", async () => {
    const status = await local.authenticate({ type: "none" });
    expect(status.authenticated).toBe(true);
  });

  it("responds to chat", async () => {
    const response = await local.chat({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(response.provider).toBe("local");
    expect(response.text).toBeTruthy();
  });

  it("recognizes ATS keywords", async () => {
    const response = await local.chat({
      messages: [{ role: "user", content: "Optimize my resume for ATS" }],
    });
    expect(response.text).toContain("keyword");
  });

  it("is always healthy", async () => {
    const health = await local.health();
    expect(health.status).toBe("healthy");
  });

  it("returns zero-cost estimates", () => {
    const cost = local.estimateCost("local", 100, 50);
    expect(cost.totalEstimatedCost).toBe(0);
  });

  it("supports only streaming capability", () => {
    expect(local.supportsCapability("streaming")).toBe(false);
    expect(local.supportsCapability("vision")).toBe(false);
    expect(local.supportsCapability("reasoning")).toBe(false);
  });

  it("shuts down gracefully", async () => {
    await expect(local.shutdown()).resolves.toBeUndefined();
  });
});
