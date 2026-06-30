// ============================================================================
// ProviderAdapterFactory — converts store provider objects → AIProvider instances
// ============================================================================
// Bridge between legacy store-based provider configs and the Enterprise AI Runtime.

import type {
  AIProvider,
  ProviderConfig,
  ProviderHealth,
  ModelInfo,
  ModelCapabilities,
  ChatRequest,
  ChatResponse,
  StreamHandler,
  AuthCredentials,
  AuthStatus,
  EmbeddingRequest,
  EmbeddingResponse,
  VisionRequest,
  VisionResponse,
  ReasoningRequest,
  ReasoningResponse,
  CostEstimate,
  LatencyEstimate,
  QualityEstimate,
} from "./types";

// ── Wraps a legacy store provider object into AIProvider ─────────────────

export class StoreProviderAdapter implements AIProvider {
  readonly id: string;
  readonly name: string;
  readonly models: ModelInfo[];

  private storeProvider: any;
  private providerConfig: ProviderConfig;

  constructor(storeProvider: any) {
    this.storeProvider = storeProvider;
    this.id = storeProvider.id || storeProvider.type || "unknown";
    this.name = storeProvider.name || storeProvider.type || "Unknown Provider";

    const modelId = storeProvider.modelName || storeProvider.defaultModel || "default";
    const supportsReasoning = storeProvider.supportsReasoning !== false;
    const supportsVision = storeProvider.supportsVision === true;
    const supportsTools = storeProvider.supportsTools === true;

    this.models = [
      {
        id: modelId,
        provider: this.id,
        providerName: this.name,
        family: storeProvider.type || "generic",
        version: storeProvider.version || "1.0",
        contextSize: storeProvider.contextSize || 128_000,
        capabilities: {
          reasoning: supportsReasoning,
          vision: supportsVision,
          streaming: true,
          jsonMode: true,
          toolCalling: supportsTools,
          functionCalling: supportsTools,
        },
        speed: storeProvider.speedRank ?? 50,
        quality: storeProvider.qualityRank ?? 50,
        reliability: storeProvider.reliabilityRank ?? 50,
        costPerInputToken: storeProvider.costPerInputToken ?? 5,
        costPerOutputToken: storeProvider.costPerOutputToken ?? 15,
        rateLimitPerMinute: storeProvider.rateLimitPerMinute ?? 60,
        available: storeProvider.isActive !== false,
      },
    ];

    const hasApiKey = !!storeProvider.apiKey;
    let authType: "api-key" | "oauth" | "none" = "none";
    if (storeProvider.authType === "oauth") authType = "oauth";
    else if (hasApiKey) authType = "api-key";

    this.providerConfig = {
      id: this.id,
      name: this.name,
      type: storeProvider.type || "generic",
      auth: {
        type: authType,
        apiKey: storeProvider.apiKey,
      },
      timeout: storeProvider.timeoutMs ?? 30_000,
      maxRetries: storeProvider.maxRetries ?? 3,
      rateLimitPerMinute: storeProvider.rateLimitPerMinute ?? 60,
    };
  }

  async initialize(_config: ProviderConfig): Promise<void> {
    // Store provider already initialized — no-op
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for store-based providers
  }

  // ── Auth ──────────────────────────────────────────────────────────────

  async authenticate(_credentials: AuthCredentials): Promise<AuthStatus> {
    return {
      authenticated: this.providerConfig.auth.type === "none" || !!this.providerConfig.auth.apiKey,
      needsRefresh: false,
    };
  }

  async refresh(): Promise<AuthStatus> {
    return { authenticated: true, needsRefresh: false };
  }

  // ── Core AI Operations ────────────────────────────────────────────────

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { callAI } = await import("../ai");
    const start = Date.now();
    const userMessage = request.messages.find((m) => m.role === "user");
    const systemMessage = request.messages.find((m) => m.role === "system");

    const result = await callAI({
      userPrompt: userMessage?.content ?? "",
      systemPrompt: systemMessage?.content,
      temperature: request.temperature,
      maxTokens: request.maxTokens ?? 4096,
      taskCategory: request.tools ? "development" : "document",
    });

    return {
      text: result.text,
      provider: this.id,
      model: request.model || this.models[0].id,
      latencyMs: Date.now() - start,
      inputTokens: result.tokensEstimate ?? 0,
      outputTokens: 0,
      finishReason: "stop",
    };
  }

  async stream(
    _request: ChatRequest,
    handler: StreamHandler,
  ): Promise<ChatResponse> {
    handler.onError?.(new Error("Streaming through bridge not yet supported"));
    throw new Error("Streaming through StoreProviderAdapter not yet supported");
  }

  async embeddings(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return { embeddings: [[]], provider: this.id, model: this.models[0].id, latencyMs: 0 };
  }

  async vision(_request: VisionRequest): Promise<VisionResponse> {
    return { text: "Vision not available through bridge provider.", provider: this.id, model: this.models[0].id, latencyMs: 0 };
  }

  async reasoning(request: ReasoningRequest): Promise<ReasoningResponse> {
    const response = await this.chat(request);
    return { ...response, reasoning: "" };
  }

  async tools(request: ChatRequest): Promise<ChatResponse> {
    return this.chat(request);
  }

  // ── Capabilities ─────────────────────────────────────────────────────

  supportsCapability(_capability: keyof ModelCapabilities): boolean {
    return true;
  }

  // ── Estimates ─────────────────────────────────────────────────────────

  estimateCost(
    _model: string,
    inputTokens: number,
    outputTokens: number,
  ): CostEstimate {
    return {
      estimatedInputCost: inputTokens * 5,
      estimatedOutputCost: outputTokens * 15,
      totalEstimatedCost: (inputTokens + outputTokens) * 10,
      currency: "micro-dollars",
    };
  }

  estimateLatency(_model: string, _inputTokens: number): LatencyEstimate {
    return { estimatedMs: 1000, confidence: "low" };
  }

  estimateQuality(_model: string, _task: string): QualityEstimate {
    return { estimatedScore: 70, confidence: "low" };
  }

  // ── Health ────────────────────────────────────────────────────────────

  async health(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      latencyMs: 0,
      lastChecked: Date.now(),
      successRate: 100,
      consecutiveFailures: 0,
      circuitState: "closed",
    };
  }
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createProvidersFromStore(storeProviders: any[]): StoreProviderAdapter[] {
  return storeProviders
    .filter((p) => p.isActive !== false && p.type !== "puter" && p.type !== "local")
    .map((p) => new StoreProviderAdapter(p));
}

export async function registerStoreProvidersWithRuntime(
  runtime: { registerProvider: (provider: AIProvider, config: ProviderConfig) => Promise<void> },
  storeProviders: any[],
): Promise<void> {
  const adapters = createProvidersFromStore(storeProviders);
  for (const adapter of adapters) {
    await runtime.registerProvider(adapter, adapter["providerConfig"] as unknown as ProviderConfig);
  }
}
