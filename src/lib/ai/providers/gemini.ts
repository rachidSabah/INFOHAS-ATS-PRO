// Google Gemini provider adapter.
// Supports BOTH:
//   1. Native Gemini API (baseUrl without /openai/) — uses :generateContent?key=
//   2. OpenAI-compatible endpoint (baseUrl with /openai/) — uses /chat/completions + Bearer
import { OpenAICompatibleProvider, ProviderError } from "./openai-compatible";
import type { ChatRequest, ChatResponse, ProviderConfig } from "./interface";

export class GeminiProvider extends OpenAICompatibleProvider {
  constructor() { super("gemini"); }

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const baseUrl = (config.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");

    // OpenAI-compatible endpoint (/v1beta/openai/) — delegate to parent which uses
    // /chat/completions with Authorization: Bearer header
    if (baseUrl.includes("/openai")) {
      return super.chat(req, config);
    }

    // Native Gemini API — use :generateContent with ?key= query param
    const t0 = performance.now();
    const model = req.model || config.modelName || "gemini-2.0-flash";
    const key = config.apiKey || "";

    const url = `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

    const sysMsg = req.messages.find((m) => m.role === "system");
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

    const body: Record<string, any> = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? config.temperature,
        maxOutputTokens: req.maxTokens ?? config.maxTokens,
      },
      ...(sysMsg ? { systemInstruction: { parts: [{ text: sysMsg.content }] } } : {}),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.parseJson(config.headersJson) },
      body: JSON.stringify(body),
      signal: req.signal ?? AbortSignal.timeout(config.timeout),
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ProviderError(`Gemini API ${res.status}: ${errText.slice(0, 200)}`, res.status, latencyMs);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    return {
      text,
      provider: "gemini",
      model,
      latencyMs,
      inputTokens: data?.usageMetadata?.promptTokenCount,
      outputTokens: data?.usageMetadata?.candidatesTokenCount,
      finishReason: data?.candidates?.[0]?.finishReason,
      raw: data,
    };
  }

  async listModels(config: ProviderConfig): Promise<string[]> {
    const baseUrl = (config.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");

    // OpenAI-compatible endpoint — delegate to parent
    if (baseUrl.includes("/openai")) {
      return super.listModels(config);
    }

    // Native Gemini API — uses /models?key=
    const key = config.apiKey || "";
    const res = await fetch(`${baseUrl}/models?key=${encodeURIComponent(key)}&pageSize=100`, {
      method: "GET",
      signal: AbortSignal.timeout(Math.min(config.timeout, 10000)),
    });
    if (!res.ok) {
      throw new Error(`Gemini listModels ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const data = await res.json();
    return (data?.models ?? [])
      .map((m: any) => m.name?.replace(/^models\//, "") || m.name)
      .filter((n: string) => n && !n.includes("/"))
      .sort();
  }
}

export const geminiProvider = new GeminiProvider();
