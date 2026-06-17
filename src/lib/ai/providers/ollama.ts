// Ollama provider adapter — for self-hosted LLMs.
// API: POST http://localhost:11434/api/chat  { model, messages, stream: false }
import { ProviderError } from "./openai-compatible";
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";

export class OllamaProvider implements AIProviderAdapter {
  readonly type = "ollama";

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    const baseUrl = (config.baseUrl || "http://localhost:11434").replace(/\/$/, "");
    const model = req.model || config.modelName || "llama3.3:70b";

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: req.temperature ?? config.temperature,
          num_predict: req.maxTokens ?? config.maxTokens,
        },
      }),
      signal: req.signal ?? AbortSignal.timeout(config.timeout),
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ProviderError(`Ollama ${res.status}: ${errText.slice(0, 200)}`, res.status, latencyMs);
    }
    const data = await res.json();
    return {
      text: data?.message?.content ?? "",
      provider: "ollama",
      model,
      latencyMs,
      inputTokens: data?.prompt_eval_count,
      outputTokens: data?.eval_count,
      finishReason: data?.done ? "stop" : undefined,
      raw: data,
    };
  }

  async testConnection(config: ProviderConfig) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${(config.baseUrl || "http://localhost:11434").replace(/\/$/, "")}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = (data?.models ?? []).map((m: any) => m.name);
      return { ok: true, latencyMs: Math.round(performance.now() - t0), message: `Connected — ${models.length} models available`, response: models.slice(0, 5).join(", ") };
    } catch (e: any) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), message: e?.message || "Ollama not reachable" };
    }
  }

  async listModels(config: ProviderConfig): Promise<string[]> {
    const res = await fetch(`${(config.baseUrl || "http://localhost:11434").replace(/\/$/, "")}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.models ?? []).map((m: any) => m.name);
  }
}

export const ollamaProvider = new OllamaProvider();
