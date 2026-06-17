// Z.ai fallback provider — uses the server-side /api/ai/chat route (z-ai-web-dev-sdk).
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";

export class ZaiFallbackProvider implements AIProviderAdapter {
  readonly type = "z-ai-fallback";

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    const sysMsg = req.messages.find((m) => m.role === "system");
    const userMsgs = req.messages.filter((m) => m.role !== "system");
    const userPrompt = userMsgs.map((m) => m.content).join("\n\n");

    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemPrompt: sysMsg?.content,
        userPrompt,
        maxTokens: req.maxTokens ?? config.maxTokens,
        temperature: req.temperature ?? config.temperature,
      }),
      signal: req.signal ?? AbortSignal.timeout(config.timeout),
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Z.ai fallback ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return {
      text: data.text,
      provider: "z-ai-fallback",
      model: config.modelName || "glm-4.6",
      latencyMs,
    };
  }

  async testConnection(config: ProviderConfig) {
    const t0 = performance.now();
    try {
      const res = await this.chat({ messages: [{ role: "user", content: "Reply with: OK" }], maxTokens: 10 }, config);
      return { ok: true, latencyMs: res.latencyMs, message: `Z.ai OK — ${res.model}`, response: res.text };
    } catch (e: any) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), message: e?.message || "Z.ai fallback unavailable" };
    }
  }
}

export const zaiFallbackProvider = new ZaiFallbackProvider();
