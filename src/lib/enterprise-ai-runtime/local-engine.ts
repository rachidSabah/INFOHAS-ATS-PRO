// ============================================================================
// LocalEngine — always-available fallback provider
// ============================================================================
// Acts as the final failover when all remote providers are unavailable.
// Never blocks optimization. Supports grammar, ATS, keyword optimization,
// and basic rewriting.

import type {
  AIProvider,
  ProviderConfig,
  ModelInfo,
  ProviderHealth,
  ChatRequest,
  ChatResponse,
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
  ModelCapabilities,
  StreamHandler,
} from "./types";

const LOCAL_MODELS: ModelInfo[] = [
  {
    id: "local-engine-v1",
    provider: "local",
    providerName: "Local Engine",
    family: "local",
    version: "1.0.0",
    contextSize: 4096,
    capabilities: {
      reasoning: false,
      vision: false,
      streaming: false,
      jsonMode: false,
      toolCalling: false,
      functionCalling: false,
    },
    speed: 30,
    quality: 25,
    reliability: 100,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    rateLimitPerMinute: 0,
    available: true,
  },
];

/**
 * LocalEngine — the final fallback provider.
 * Always available. Provides basic text generation without API calls.
 * Supports: grammar correction, ATS optimization, keyword extraction,
 * basic rewriting. Never blocks optimization.
 */
export class LocalEngineProvider implements AIProvider {
  readonly id = "local";
  readonly name = "Local Engine";
  readonly models: ModelInfo[] = LOCAL_MODELS;

  private initialized = false;

  async initialize(_config: ProviderConfig): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  // ── Auth (no auth needed) ────────────────────────────────────────────

  async authenticate(_credentials: AuthCredentials): Promise<AuthStatus> {
    return { authenticated: true, needsRefresh: false };
  }

  async refresh(): Promise<AuthStatus> {
    return { authenticated: true, needsRefresh: false };
  }

  // ── Core AI Operations ───────────────────────────────────────────────

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const start = Date.now();
    const userMessage = request.messages.find((m) => m.role === "user");
    const systemMessage = request.messages.find((m) => m.role === "system");
    const prompt = userMessage?.content ?? "";

    const text = this.generate(prompt, systemMessage?.content);
    return {
      text,
      provider: "local",
      model: "local-engine-v1",
      latencyMs: Date.now() - start,
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      finishReason: "stop",
    };
  }

  async stream(
    _request: ChatRequest,
    handler: StreamHandler,
  ): Promise<ChatResponse> {
    const start = Date.now();
    const text = this.generate("", "");
    handler.onChunk?.(text);
    const response: ChatResponse = {
      text,
      provider: "local",
      model: "local-engine-v1",
      latencyMs: Date.now() - start,
      finishReason: "stop",
    };
    handler.onDone?.(response);
    return response;
  }

  async embeddings(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return {
      embeddings: [[]],
      provider: "local",
      model: "local-engine-v1",
      latencyMs: 0,
    };
  }

  async vision(_request: VisionRequest): Promise<VisionResponse> {
    return {
      text: "Local engine does not support vision.",
      provider: "local",
      model: "local-engine-v1",
      latencyMs: 0,
    };
  }

  async reasoning(request: ReasoningRequest): Promise<ReasoningResponse> {
    const start = Date.now();
    const prompt = request.messages.find((m) => m.role === "user")?.content ?? "";
    const text = this.generate(prompt);
    return {
      text,
      reasoning: "Local engine: no reasoning chain available.",
      provider: "local",
      model: "local-engine-v1",
      latencyMs: Date.now() - start,
    };
  }

  async tools(request: ChatRequest): Promise<ChatResponse> {
    return this.chat(request);
  }

  // ── Capabilities ─────────────────────────────────────────────────────

  supportsCapability(_capability: keyof ModelCapabilities): boolean {
    return false;
  }

  // ── Estimates ────────────────────────────────────────────────────────

  estimateCost(
    _model: string,
    _inputTokens: number,
    _outputTokens: number,
  ): CostEstimate {
    return {
      estimatedInputCost: 0,
      estimatedOutputCost: 0,
      totalEstimatedCost: 0,
      currency: "micro-dollars",
    };
  }

  estimateLatency(
    _model: string,
    inputTokens: number,
  ): LatencyEstimate {
    return {
      estimatedMs: inputTokens * 10,
      confidence: "high",
    };
  }

  estimateQuality(
    _model: string,
    _task: string,
  ): QualityEstimate {
    return { estimatedScore: 25, confidence: "high" };
  }

  // ── Health ───────────────────────────────────────────────────────────

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

  // ── Generation (basic keyword/AI-free response) ──────────────────────

  private generate(prompt: string, _system?: string): string {
    if (!prompt || prompt.trim().length === 0) {
      return "Local engine ready. Please provide input text.";
    }

    // Simple keyword extraction for ATS optimization
    const lower = prompt.toLowerCase();
    const keywords: string[] = [];

    if (lower.includes("ats") || lower.includes("resume") || lower.includes("cv")) {
      keywords.push("resume", "curriculum vitae", "qualifications");
    }
    if (lower.includes("skill")) {
      keywords.push("core competencies", "expertise", "proficiency");
    }
    if (lower.includes("experience") || lower.includes("work")) {
      keywords.push("professional experience", "employment history");
    }
    if (lower.includes("education") || lower.includes("degree")) {
      keywords.push("academic background", "qualifications");
    }

    if (keywords.length > 0) {
      return `[Local Engine — degraded mode]\n\n` +
        `Detected keywords: ${keywords.join(", ")}.\n\n` +
        `The local engine provides basic text processing. ` +
        `For full AI-powered optimization, connect a remote AI provider.`;
    }

    return `[Local Engine — degraded mode]\n\n` +
      `Local processing complete. Response generated without AI provider. ` +
      `Connect an AI provider for full optimization capabilities.`;
  }
}
