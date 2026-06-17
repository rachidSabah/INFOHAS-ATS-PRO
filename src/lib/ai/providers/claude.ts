// Anthropic Claude provider adapter — uses /v1/messages with x-api-key header.
import { OpenAICompatibleProvider, ProviderError } from "./openai-compatible";
import type { ChatRequest, ChatResponse, ProviderConfig } from "./interface";

export class ClaudeProvider extends OpenAICompatibleProvider {
  constructor() { super("claude"); }

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    const baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
    const model = req.model || config.modelName || "claude-3-5-sonnet-20241022";

    // Claude separates system prompt from messages
    const sysMsg = req.messages.find((m) => m.role === "system");
    const userMsgs = req.messages.filter((m) => m.role !== "system");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey || "",
      "anthropic-version": "2023-06-01",
      ...this.parseJson(config.headersJson),
    };

    const body: Record<string, any> = {
      model,
      max_tokens: req.maxTokens ?? config.maxTokens,
      temperature: req.temperature ?? config.temperature,
      messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
      ...(sysMsg ? { system: sysMsg.content } : {}),
      ...this.parseJson(config.parametersJson),
    };

    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal ?? AbortSignal.timeout(config.timeout),
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ProviderError(`Claude API ${res.status}: ${errText.slice(0, 200)}`, res.status, latencyMs);
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? "";
    return {
      text,
      provider: "claude",
      model,
      latencyMs,
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
      finishReason: data?.stop_reason,
      raw: data,
    };
  }

  async listModels(config: ProviderConfig): Promise<string[]> {
    const baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        "x-api-key": config.apiKey || "",
        "anthropic-version": "2023-06-01",
        ...this.parseJson(config.headersJson),
      },
      signal: AbortSignal.timeout(Math.min(config.timeout, 10000)),
    });
    if (!res.ok) {
      throw new Error(`Claude listModels ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const data = await res.json();
    return (data?.data ?? []).map((m: any) => m.id).filter(Boolean).sort();
  }
}

export const claudeProvider = new ClaudeProvider();
