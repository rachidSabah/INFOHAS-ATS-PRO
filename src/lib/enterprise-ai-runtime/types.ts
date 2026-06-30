// ============================================================================
// Enterprise AI Runtime — Core Types
// ============================================================================
// The AIProvider contract that every provider adapter must implement.
// No provider-specific logic exists outside this interface.

export type ProviderId = string;
export type ModelId = string;

// ── Authentication ─────────────────────────────────────────────────────────

export type AuthType =
  | "api-key"      // Bearer token / API key header
  | "oauth"        // OAuth 2.0 (Antigravity, Google)
  | "device-flow"  // Device Authorization (Antigravity CLI)
  | "puter-auth"   // Puter.js authenticated
  | "puter-anon"   // Puter.js anonymous
  | "none";        // Local engine, no auth

export interface AuthCredentials {
  type: AuthType;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  expiresAt?: number; // epoch ms
  scopes?: string[];
}

export interface AuthStatus {
  authenticated: boolean;
  expiresAt?: number;
  needsRefresh: boolean;
  error?: string;
}

// ── Chat ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface ChatResponse {
  text: string;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter";
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
  raw?: unknown;
}

// ── Capabilities ───────────────────────────────────────────────────────────

export interface ModelCapabilities {
  reasoning: boolean;
  vision: boolean;
  streaming: boolean;
  jsonMode: boolean;
  toolCalling: boolean;
  functionCalling: boolean;
  codeInterpreter?: boolean;
  grounding?: boolean;
}

export interface ModelInfo {
  id: ModelId;
  provider: ProviderId;
  providerName: string;
  family: string;
  version: string;
  contextSize: number;
  capabilities: ModelCapabilities;
  speed: number;         // tokens/sec (0-100 scale for relative comparison)
  quality: number;       // 0-100
  reliability: number;   // 0-100
  costPerInputToken: number;   // in micro-dollars (1 = $0.000001)
  costPerOutputToken: number;
  rateLimitPerMinute: number;
  available: boolean;
}

export interface CapabilityRequirement {
  minContext?: number;
  reasoning?: boolean;
  vision?: boolean;
  streaming?: boolean;
  jsonMode?: boolean;
  toolCalling?: boolean;
  minQuality?: number;    // 0-100
  minReliability?: number; // 0-100
  maxCost?: number;       // micro-dollars per output token
}

// ── Provider ───────────────────────────────────────────────────────────────

export interface ProviderHealth {
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  latencyMs: number;
  lastChecked: number;
  successRate: number;      // 0-100
  consecutiveFailures: number;
  circuitState: "closed" | "open" | "half-open";
  cooldownUntil?: number;
  lastError?: string;
}

export interface ProviderStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalCost: number;          // micro-dollars
  averageLatencyMs: number;
  averageQualityScore: number; // 0-100
  averageAtsImprovement: number;
  lastUsed: number;
}

export interface RateLimitInfo {
  requestsThisMinute: number;
  tokensThisMinute: number;
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  remainingTokens: number;
  resetAt: number;
}

// ── Stream Events ──────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "chunk"; text: string }
  | { type: "done"; text: string; inputTokens?: number; outputTokens?: number }
  | { type: "error"; error: string }
  | { type: "progress"; percent: number; message: string }
  | { type: "cancel" }
  | { type: "reconnect" };

export interface StreamHandler {
  onChunk?(text: string): void;
  onDone?(result: ChatResponse): void;
  onError?(error: Error): void;
  onProgress?(percent: number, message: string): void;
  onReconnect?(): void;
  signal?: AbortSignal;
}

// ── Embeddings ─────────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  provider: ProviderId;
  model: string;
  latencyMs: number;
  inputTokens?: number;
}

// ── Vision ─────────────────────────────────────────────────────────────────

export interface VisionRequest {
  imageUrl: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
}

export interface VisionResponse {
  text: string;
  provider: ProviderId;
  model: string;
  latencyMs: number;
}

// ── Reasoning ──────────────────────────────────────────────────────────────

export interface ReasoningRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export interface ReasoningResponse {
  text: string;
  reasoning: string;  // the reasoning chain/thinking
  provider: ProviderId;
  model: string;
  latencyMs: number;
}

// ── Cost Estimates ─────────────────────────────────────────────────────────

export interface CostEstimate {
  estimatedInputCost: number;  // micro-dollars
  estimatedOutputCost: number;
  totalEstimatedCost: number;
  currency: "micro-dollars" | "usd";
}

export interface LatencyEstimate {
  estimatedMs: number;
  confidence: "low" | "medium" | "high";
}

export interface QualityEstimate {
  estimatedScore: number; // 0-100
  confidence: "low" | "medium" | "high";
}

// ── Provider Config ────────────────────────────────────────────────────────

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  type: string;
  baseUrl?: string;
  auth: AuthCredentials;
  models?: string[];
  timeout: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  costPerInputToken?: number;
  costPerOutputToken?: number;
  metadata?: Record<string, unknown>;
}

// ── AI Provider Interface — THE UNIVERSAL CONTRACT ────────────────────────

export interface AIProvider {
  // Identity
  readonly id: ProviderId;
  readonly name: string;
  readonly models: ModelInfo[];

  // Lifecycle
  initialize(config: ProviderConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Authentication
  authenticate(credentials: AuthCredentials): Promise<AuthStatus>;
  refresh(): Promise<AuthStatus>;

  // Core AI Operations
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest, handler: StreamHandler): Promise<ChatResponse>;
  embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  vision(request: VisionRequest): Promise<VisionResponse>;
  reasoning(request: ReasoningRequest): Promise<ReasoningResponse>;
  tools(request: ChatRequest): Promise<ChatResponse>;

  // Capabilities
  supportsCapability(capability: keyof ModelCapabilities): boolean;

  // Estimates
  estimateCost(model: string, inputTokens: number, outputTokens: number): CostEstimate;
  estimateLatency(model: string, inputTokens: number): LatencyEstimate;
  estimateQuality(model: string, task: string): QualityEstimate;

  // Health
  health(): Promise<ProviderHealth>;
}

// ── Registry ───────────────────────────────────────────────────────────────

export interface ProviderRegistration {
  provider: AIProvider;
  config: ProviderConfig;
  registeredAt: number;
  health: ProviderHealth;
  stats: ProviderStats;
}

// ── Runtime ────────────────────────────────────────────────────────────────

export interface RuntimeConfig {
  defaultProvider?: ProviderId;
  defaultModel?: string;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  enableCircuitBreaker: boolean;
  enableTelemetry: boolean;
  providers: ProviderConfig[];
}

export interface ExecutionPlan {
  providerId: ProviderId;
  modelId: ModelId;
  estimatedCost: CostEstimate;
  estimatedLatency: LatencyEstimate;
  estimatedQuality: QualityEstimate;
  reasoning: string;
}

export interface ExecutionResult {
  response: ChatResponse;
  plan: ExecutionPlan;
  retries: number;
  failoverLevel: number; // 0=first try, 1=retry, 2=diff model, 3=diff provider, 4=local
  totalLatencyMs: number;
  warnings: string[];
}

// ── Failover ───────────────────────────────────────────────────────────────

export type FailoverLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const FAILOVER_LEVELS = {
  PRIMARY: 0 as FailoverLevel,
  SAME_PROVIDER_RETRY: 1 as FailoverLevel,
  DIFFERENT_MODEL: 2 as FailoverLevel,
  DIFFERENT_PROVIDER: 3 as FailoverLevel,
  EMERGENCY_FALLBACK: 4 as FailoverLevel,
  LOCAL_ENGINE: 5 as FailoverLevel,
} as const;

// ── Telemetry ──────────────────────────────────────────────────────────────

export interface TelemetryEntry {
  providerId: ProviderId;
  modelId: string;
  task: string;
  success: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  qualityScore: number;
  failoverLevel: FailoverLevel;
  error?: string;
  timestamp: number;
}
