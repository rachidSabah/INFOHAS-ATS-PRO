// OpenAI-compatible provider adapter.
// Also used by: DeepSeek, Groq, OpenRouter, Together AI, HuggingFace (all use the OpenAI schema).
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";
import { resolveTestTimeoutMs } from "../test-timeout";

export class OpenAICompatibleProvider implements AIProviderAdapter {
  constructor(public readonly type: string = "openai") {}

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = req.model || config.modelName || "gpt-4o-mini";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.parseJson(config.headersJson),
    };
    if (config.apiKey) {
      if (config.authType === "query") {
        // appended below
      } else if (config.authType === "header" && this.type === "claude") {
        headers["x-api-key"] = config.apiKey;
        headers["anthropic-version"] = headers["anthropic-version"] || "2023-06-01";
      } else {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }
    }

    const body: Record<string, any> = {
      model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? config.temperature,
      top_p: req.topP ?? config.topP,
      max_tokens: req.maxTokens ?? config.maxTokens,
      stream: false,
      ...this.parseJson(config.parametersJson),
    };
    if (req.tools?.length) {
      body.tools = req.tools;
    }

    const url = `${baseUrl}/chat/completions${config.authType === "query" && config.apiKey ? `?api_key=${encodeURIComponent(config.apiKey)}` : ""}`;

    // CORS proxy fallback for browser clients calling third-party provider APIs
    const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("0.0.0.0");
    if (typeof window !== "undefined" && !isLocal) {
      const proxyRes = await fetch("/api/providers/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          apiKey: config.apiKey,
          authType: config.authType,
          headersJson: config.headersJson,
          model,
          messages: req.messages,
          maxTokens: req.maxTokens ?? config.maxTokens,
          temperature: req.temperature ?? config.temperature,
          topP: req.topP ?? config.topP,
          timeoutMs: config.timeout,
        }),
        signal: req.signal ?? AbortSignal.timeout(config.timeout),
      });
      const latencyMs = Math.round(performance.now() - t0);
      if (!proxyRes.ok) {
        const errText = await proxyRes.text().catch(() => "");
        const err = new ProviderError(`Proxy: ${errText.slice(0, 200)}`, proxyRes.status, latencyMs);
        // P2 — the proxy relays the upstream Retry-After hint as
        // `retryAfterSeconds`; attach it so the cooldown layer can honor the
        // provider's exact window instead of guessing.
        try {
          const j = JSON.parse(errText) as any;
          if (Number.isFinite(j?.retryAfterSeconds) && j.retryAfterSeconds > 0) {
            (err as any).retryAfterSeconds = Number(j.retryAfterSeconds);
          }
        } catch { /* non-JSON body — message note path still works */ }
        throw err;
      }
      const data = (await proxyRes.json()) as any;
      if (!data.ok) {
        throw new ProviderError(`Proxy: ${data.error || "Unknown proxy error"}`, 500, latencyMs);
      }
      return {
        text: data.text,
        provider: this.type,
        model,
        latencyMs,
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal ?? AbortSignal.timeout(config.timeout),
    });

    const latencyMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ProviderError(`${this.type} API ${res.status}: ${errText.slice(0, 200)}`, res.status, latencyMs);
    }

    const data = (await res.json()) as any;
    // Order matters: some free reasoning models (e.g. hy3-free) return an empty
    // `content` but emit their answer in `reasoning_content`/`reasoning`. If we
    // only checked `content` first, the optimizer would receive an empty resume.
    const msg = data?.choices?.[0]?.message ?? {};
    const text =
      msg?.content ||
      msg?.reasoning_content ||
      msg?.reasoning ||
      data?.choices?.[0]?.text ||
      "";
    return {
      text,
      provider: this.type,
      model,
      latencyMs,
      inputTokens: data?.usage?.prompt_tokens,
      outputTokens: data?.usage?.completion_tokens,
      finishReason: data?.choices?.[0]?.finish_reason,
      raw: data,
    };
  }

  async testConnection(config: ProviderConfig) {
    const t0 = performance.now();
    try {
      const res = await this.chat(
        { messages: [{ role: "user", content: "Reply with exactly: OK" }], maxTokens: 10 },
        // Task 24① — reasoning-aware: fast models keep the 10s cap; a
        // reasoning-route default model gets ≥30s (floor) up to 60s, since
        // verified-working Zen reasoning models answer in 8-33s.
        { ...config, timeout: resolveTestTimeoutMs({ modelName: config.modelName, providerTimeoutMs: config.timeout, fastCapMs: 10000 }) }
      );
      return { ok: true, latencyMs: res.latencyMs, message: `OK — ${res.model}`, response: res.text };
    } catch (e: any) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), message: e?.message || "Connection failed" };
    }
  }

  protected parseJson(s?: string): Record<string, any> {
    if (!s) return {};
    try { return JSON.parse(s); } catch { return {}; }
  }

  /**
   * Fetch the list of available models from the provider's /models endpoint.
   * Works with OpenAI, DeepSeek, Groq, OpenRouter, Together, HuggingFace,
   * Mistral, Cohere, Perplexity, OpenCode, ZenCode — any OpenAI-compatible API.
   */
  async listModels(config: ProviderConfig): Promise<string[]> {
    const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    const headers: Record<string, string> = {
      ...this.parseJson(config.headersJson),
    };
    if (config.apiKey) {
      if (config.authType === "header") {
        headers["x-api-key"] = config.apiKey;
      } else {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }
    }
    const url = config.authType === "query" && config.apiKey
      ? `${baseUrl}/models?api_key=${encodeURIComponent(config.apiKey)}`
      : `${baseUrl}/models`;

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(Math.min(config.timeout, 10000)),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ProviderError(`${this.type} listModels ${res.status}: ${errText.slice(0, 200)}`, res.status, 0);
    }
    const data = (await res.json()) as any;
    // OpenAI-compatible APIs return { data: [{ id: "model-name", ... }, ...] }
    const models: string[] = (data?.data ?? data?.models ?? []).map((m: any) => m.id || m.name).filter(Boolean);
    return models.sort();
  }
}

export type ProviderErrorCategory =
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "MODEL_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK_ERROR"
  | "INVALID_REQUEST"
  | "PROVIDER_ENDPOINT_ERROR"
  | "COOLDOWN"
  | "UNKNOWN_PROVIDER_ERROR"
  | "UNKNOWN";

export const PROVIDER_ERROR_CATEGORY_LABELS: Record<ProviderErrorCategory, string> = {
  AUTHENTICATION_ERROR: "Authentication Configuration Error",
  AUTHORIZATION_ERROR: "Authorization Error",
  MODEL_NOT_FOUND: "Model Not Found",
  MODEL_UNAVAILABLE: "Model Unavailable",
  RATE_LIMIT: "Rate Limited",
  PROVIDER_TIMEOUT: "Provider Timeout",
  PROVIDER_NETWORK_ERROR: "Network Error",
  INVALID_REQUEST: "Invalid Request",
  PROVIDER_ENDPOINT_ERROR: "Provider Endpoint Error",
  COOLDOWN: "Provider In Cooldown",
  UNKNOWN_PROVIDER_ERROR: "Unknown Provider",
  UNKNOWN: "Unknown Error",
};

/**
 * Map an arbitrary provider error (status code + message) to a stable
 * diagnostic category. This lets the UI distinguish, e.g., a missing API key
 * (AUTHENTICATION_ERROR) from a model that simply doesn't exist on the
 * provider (MODEL_NOT_FOUND), instead of lumping everything into "failed".
 */
export function classifyProviderError(err: unknown): {
  category: ProviderErrorCategory;
  statusCode: number;
  message: string;
} {
  const message = (typeof err === "string" ? err : (err as any)?.message) || "Unknown provider error";
  const statusCode = (err as any)?.statusCode ?? (err as any)?.status ?? 0;

  // Message-pattern matches take priority because proxy errors often carry a
  // descriptive string even when the HTTP status is generic.
  const m = message.toLowerCase();
  if (m.includes("missing or invalid authorization") || m.includes("invalid api key") || m.includes("unauthorized") || m.includes("authentication")) {
    return { category: "AUTHENTICATION_ERROR", statusCode, message };
  }
  if (m.includes("forbidden") || m.includes("permission") || m.includes("not allowed")) {
    return { category: "AUTHORIZATION_ERROR", statusCode, message };
  }
  if (m.includes("end of life") || m.includes("no longer available") || m.includes("deprecated") || m.includes("model is unavailable")) {
    return { category: "MODEL_UNAVAILABLE", statusCode, message };
  }
  if (m.includes("does not exist") || m.includes("not found") || m.includes("unknown model") || m.includes("invalid model")) {
    return { category: "MODEL_NOT_FOUND", statusCode, message };
  }
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return { category: "RATE_LIMIT", statusCode, message };
  }
  if (m.includes("timeout") || m.includes("timed out") || m.includes("upstream request failed")) {
    return { category: "PROVIDER_TIMEOUT", statusCode, message };
  }
  if (m.includes("network") || m.includes("econnrefused") || m.includes("dns") || m.includes("fetch failed")) {
    return { category: "PROVIDER_NETWORK_ERROR", statusCode, message };
  }
  if (m.includes("cooldown")) {
    return { category: "COOLDOWN", statusCode, message };
  }

  // Fall back to HTTP status code.
  switch (statusCode) {
    case 400: return { category: "INVALID_REQUEST", statusCode, message };
    case 401: return { category: "AUTHENTICATION_ERROR", statusCode, message };
    case 403: return { category: "AUTHORIZATION_ERROR", statusCode, message };
    case 404: return { category: "PROVIDER_ENDPOINT_ERROR", statusCode, message };
    case 408: return { category: "PROVIDER_TIMEOUT", statusCode, message };
    case 410: return { category: "MODEL_UNAVAILABLE", statusCode, message };
    case 422: return { category: "INVALID_REQUEST", statusCode, message };
    case 429: return { category: "RATE_LIMIT", statusCode, message };
    case 500:
    case 502:
    case 503:
    case 504: return { category: "PROVIDER_ENDPOINT_ERROR", statusCode, message };
    default:
      if (statusCode >= 400) return { category: "UNKNOWN", statusCode, message };
      return { category: "UNKNOWN_PROVIDER_ERROR", statusCode, message };
  }
}

export class ProviderError extends Error {
  category: ProviderErrorCategory;
  constructor(message: string, public statusCode: number, public latencyMs: number, category?: ProviderErrorCategory) {
    super(message);
    this.name = "ProviderError";
    this.category = category ?? classifyProviderError({ message, statusCode }).category;
  }
}

// Singleton instances
export const openaiProvider = new OpenAICompatibleProvider("openai");
export const deepseekProvider = new OpenAICompatibleProvider("deepseek");
export const groqProvider = new OpenAICompatibleProvider("groq");
export const openrouterProvider = new OpenAICompatibleProvider("openrouter");
export const togetherProvider = new OpenAICompatibleProvider("together");
export const huggingfaceProvider = new OpenAICompatibleProvider("huggingface");
export const mistralProvider = new OpenAICompatibleProvider("mistral");
export const cohereProvider = new OpenAICompatibleProvider("cohere");
export const perplexityProvider = new OpenAICompatibleProvider("perplexity");
