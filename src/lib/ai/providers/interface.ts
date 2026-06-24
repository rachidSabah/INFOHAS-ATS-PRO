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
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
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
}
