// AIProvider interface — the contract every provider adapter must implement.
// All AI requests in the application go through this interface via the ProviderRouter.

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  /** Nucleus sampling (0-1). Phase 8.1.3.2A: propagated to provider bodies. */
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  /**
   * Skip the proxy's edge response cache for this call. Set by testConnection
   * so the Providers-panel "Test" button always measures the LIVE upstream
   * and never reports a stale cached answer as a healthy provider.
   */
  noCache?: boolean;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

export interface ChatResponse {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter";
  toolCalls?: Array<{ id: string; name: string; arguments: any }>;
  raw?: any;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  headersJson?: string;
  parametersJson?: string;
  requestTemplate?: string;
  responsePath?: string;
  streamingEnabled?: boolean;
  timeout: number;
  maxTokens: number;
  temperature: number;
  /** Provider-default nucleus sampling (0-1). Phase 8.1.3.2A. */
  topP?: number;
  retryAttempts?: number;
  rateLimitPerMinute?: number;
  authType?: "bearer" | "header" | "query" | "none";
  costPerInputToken?: number;
  costPerOutputToken?: number;
  // Puter.js specific
  applicationId?: string;
  clientId?: string;
  redirectUri?: string;
  enabledModels?: string[];
}

/**
 * Every provider adapter implements this interface.
 * The router calls provider.chat(req) — never the underlying API directly.
 */
export interface AIProviderAdapter {
  readonly type: string;
  chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse>;
  testConnection(config: ProviderConfig): Promise<{ ok: boolean; latencyMs: number; message: string; response?: string }>;
  listModels?(config: ProviderConfig): Promise<string[]>;
  /**
   * OPTIONAL streaming. Implemented only by adapters whose backend natively
   * streams (e.g. Puter.js via window.puter.ai.chat). When absent, callers fall
   * back to `chat` + chunked emission — so the pipeline NEVER needs a second
   * code path. Text chunks are piped through `onChunk`; the promise resolves
   * with the assembled ChatResponse.
   */
  stream?(req: ChatRequest, config: ProviderConfig, onChunk: (text: string) => void): Promise<ChatResponse>;
}
