// ============================================================================
// EnterpriseAIRuntime — unified facade for all AI operations
// ============================================================================
// Agents call this class ONLY. Never call providers directly.
// The runtime handles: provider selection, auth, retry, failover, streaming,
// health monitoring, telemetry, and circuit breaking.

import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ExecutionPlan,
  ExecutionResult,
  StreamHandler,
  ModelCapabilities,
  CapabilityRequirement,
  ProviderConfig,
  RuntimeConfig,
  TelemetryEntry,
  FailoverLevel,
  EmbeddingRequest,
  EmbeddingResponse,
  VisionRequest,
  VisionResponse,
  ReasoningRequest,
  ReasoningResponse,
} from "./types";
import { ProviderRegistry } from "./provider-registry";
import { CapabilityEngine } from "./capability-engine";
import { AuthManager } from "./auth-manager";
import { HealthMonitor } from "./health-monitor";
import { RetryManager } from "./retry-manager";
import { FailoverEngine } from "./failover-engine";

export class EnterpriseAIRuntime {
  readonly registry: ProviderRegistry;
  readonly capabilities: CapabilityEngine;
  readonly auth: AuthManager;
  readonly health: HealthMonitor;
  readonly retry: RetryManager;
  readonly failover: FailoverEngine;

  private config: RuntimeConfig;
  private telemetry: TelemetryEntry[] = [];
  private initialized = false;

  // Keep a reference to the local engine provider for failover
  private localProvider: AIProvider | null = null;

  constructor(config?: Partial<RuntimeConfig>) {
    this.registry = new ProviderRegistry();
    this.auth = new AuthManager();
    this.capabilities = new CapabilityEngine(this.registry);
    this.health = new HealthMonitor(this.registry);
    this.retry = new RetryManager(config ? {
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 60000,
    } : undefined);
    this.failover = new FailoverEngine(
      this.registry,
      this.health,
      this.retry,
    );
    this.config = {
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 60000,
      enableCircuitBreaker: true,
      enableTelemetry: true,
      providers: [],
      ...config,
    };
  }

  // ── Initialization ───────────────────────────────────────────────────

  /**
   * Initialize the runtime with provider configurations.
   * Auto-registers all providers, indexes models, checks health.
   */
  async initialize(configs?: ProviderConfig[]): Promise<void> {
    if (this.initialized) return;

    const providers = configs ?? this.config.providers;
    // Auth is initialized by the app layer before calling this
    this.auth.initializeFromConfig(providers);

    if (this.config.enableCircuitBreaker) {
      this.health.startPeriodicChecks();
    }

    this.initialized = true;
  }

  /**
   * Register a provider adapter with the runtime.
   */
  async registerProvider(
    provider: AIProvider,
    config: ProviderConfig,
  ): Promise<void> {
    if (config.id === "local") {
      this.localProvider = provider;
      this.failover.setLocalProvider(provider);
    }
    await this.registry.register(provider, config);
  }

  /**
   * Shut down the runtime gracefully.
   */
  async shutdown(): Promise<void> {
    this.health.stopPeriodicChecks();
    for (const reg of this.registry.getAll()) {
      await reg.provider.shutdown();
    }
    this.initialized = false;
  }

  // ── Core AI Operations ───────────────────────────────────────────────

  /**
   * Execute a chat request with intelligent model selection and failover.
   * This is the primary entry point for all optimization agents.
   * Agents NEVER call providers directly.
   */
  async chat(
    request: ChatRequest,
    requirements?: CapabilityRequirement,
    task?: string,
  ): Promise<ExecutionResult> {
    this.ensureInitialized();

    // Step 1: Build execution plan based on capability requirements
    const defaultReqs: CapabilityRequirement = {
      ...requirements,
      toolCalling: requirements?.toolCalling || (request.tools ? true : undefined),
    };

    const inputTokens = this.estimateInputTokens(request);
    const plan = this.capabilities.buildPlan(defaultReqs, inputTokens, task);
    if (!plan) {
      throw new Error("No suitable AI provider available for this request");
    }

    // Step 2: Execute with full failover
    const result = await this.failover.executeWithFailover(request, plan);

    // Step 3: Record telemetry
    this.recordTelemetry({
      providerId: result.response.provider,
      modelId: result.response.model,
      task: task ?? "chat",
      success: true,
      latencyMs: result.totalLatencyMs,
      inputTokens: result.response.inputTokens ?? 0,
      outputTokens: result.response.outputTokens ?? 0,
      cost: this.estimateCallCost(result),
      qualityScore: plan.estimatedQuality.estimatedScore,
      failoverLevel: result.failoverLevel as FailoverLevel,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Stream a chat response. Supports cancellation, reconnect, progress events.
   */
  async stream(
    request: ChatRequest,
    handler: StreamHandler,
    requirements?: CapabilityRequirement,
    task?: string,
  ): Promise<void> {
    this.ensureInitialized();

    const inputTokens = this.estimateInputTokens(request);
    const plan = this.capabilities.buildPlan(
      { ...requirements, streaming: true },
      inputTokens,
      task,
    );

    if (!plan) {
      handler.onError?.(new Error("No suitable streaming provider available"));
      return;
    }

    const provider = this.registry.getProvider(plan.providerId);
    if (!provider) {
      handler.onError?.(new Error(`Provider ${plan.providerId} not found`));
      return;
    }

    try {
      await provider.stream(
        { ...request, model: plan.modelId, stream: true },
        handler,
      );
    } catch (error) {
      handler.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Request embeddings from the best available provider.
   */
  async embeddings(
    request: EmbeddingRequest,
  ): Promise<EmbeddingResponse> {
    this.ensureInitialized();
    const providers = this.registry.getAllHealthy();
    if (providers.length === 0) throw new Error("No provider available for embeddings");
    return providers[0].provider.embeddings(request);
  }

  /**
   * Process a vision request from the best vision-capable provider.
   */
  async vision(
    request: VisionRequest,
  ): Promise<VisionResponse> {
    this.ensureInitialized();
    const provider = this.selectProvider("vision");
    if (!provider) throw new Error("No vision-capable provider available");
    return provider.vision(request);
  }

  /**
   * Execute a reasoning request (includes reasoning chain in response).
   */
  async reasoning(
    request: ReasoningRequest,
  ): Promise<ReasoningResponse> {
    this.ensureInitialized();
    const provider = this.selectProvider("reasoning");
    if (!provider) throw new Error("No reasoning-capable provider available");
    return provider.reasoning(request);
  }

  // ── Provider Selection ───────────────────────────────────────────────

  /**
   * Select the best provider for a given capability.
   */
  private selectProvider(capability: keyof ModelCapabilities): AIProvider | undefined {
    const candidates = this.registry.getAllHealthy();
    for (const reg of candidates) {
      if (reg.provider.supportsCapability(capability)) {
        return reg.provider;
      }
    }
    return undefined;
  }

  // ── Telemetry ────────────────────────────────────────────────────────

  /**
   * Record a telemetry entry.
   */
  private recordTelemetry(entry: TelemetryEntry): void {
    if (!this.config.enableTelemetry) return;
    this.telemetry.push(entry);

    // Limit telemetry buffer to 1000 entries
    if (this.telemetry.length > 1000) {
      this.telemetry = this.telemetry.slice(-500);
    }
  }

  /**
   * Get all telemetry entries.
   */
  getTelemetry(): TelemetryEntry[] {
    return [...this.telemetry];
  }

  /**
   * Feed telemetry back into the capability engine for learning.
   */
  incorporateTelemetry(): void {
    if (this.telemetry.length === 0) return;
    this.capabilities.incorporateTelemetry(this.telemetry);
  }

  // ── Estimates ────────────────────────────────────────────────────────

  private estimateInputTokens(request: ChatRequest): number {
    const text = request.messages.map((m) => m.content).join(" ");
    return Math.ceil(text.length / 4); // rough estimate
  }

  private estimateCallCost(result: ExecutionResult): number {
    const inputTokens = result.response.inputTokens ?? 0;
    const outputTokens = result.response.outputTokens ?? 0;
    // Rough: $0.00001 per token (10 micro-dollars)
    return (inputTokens + outputTokens) * 10;
  }

  // ── Utilities ────────────────────────────────────────────────────────

  /**
   * Check if the runtime has any registered providers.
   */
  hasProviders(): boolean {
    return this.registry.getProviderCount() > 0;
  }

  /**
   * Get the count of healthy providers.
   */
  getHealthyProviderCount(): number {
    return this.registry.getAllHealthy().length;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "EnterpriseAIRuntime not initialized. Call initialize() first.",
      );
    }
  }

  /**
   * Create a runtime instance ready for testing.
   */
  static createForTesting(): EnterpriseAIRuntime {
    const runtime = new EnterpriseAIRuntime({
      enableTelemetry: false,
    });
    runtime.initialized = true;
    return runtime;
  }
}
