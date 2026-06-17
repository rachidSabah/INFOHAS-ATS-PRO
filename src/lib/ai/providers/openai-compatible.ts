// OpenAI-compatible provider adapter.
// Also used by: DeepSeek, Groq, OpenRouter, Together AI, HuggingFace (all use the OpenAI schema).
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";

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
      max_tokens: req.maxTokens ?? config.maxTokens,
      stream: false,
      ...this.parseJson(config.parametersJson),
    };
    if (req.tools?.length) {
      body.tools = req.tools;
    }

    const url = `${baseUrl}/chat/completions${config.authType === "query" && config.apiKey ? `?api_key=${encodeURIComponent(config.apiKey)}` : ""}`;
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

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
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
        { ...config, timeout: Math.min(config.timeout, 10000) }
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
    const data = await res.json();
    // OpenAI-compatible APIs return { data: [{ id: "model-name", ... }, ...] }
    const models: string[] = (data?.data ?? data?.models ?? []).map((m: any) => m.id || m.name).filter(Boolean);
    return models.sort();
  }
}

export class ProviderError extends Error {
  constructor(message: string, public statusCode: number, public latencyMs: number) {
    super(message);
    this.name = "ProviderError";
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
