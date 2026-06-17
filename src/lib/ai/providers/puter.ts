// Puter.js provider adapter — runs in the browser, uses window.puter.
// Free for end users — they authenticate with their own Google account via Puter.
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";

export class PuterProvider implements AIProviderAdapter {
  readonly type = "puter";

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    if (typeof window === "undefined" || !window.puter?.ai?.chat) {
      throw new Error("Puter.js not loaded. Ensure <script src='https://js.puter.com/v2/'> is in the layout.");
    }
    // Ensure signed in
    try {
      if (window.puter.auth?.isSignedIn && !window.puter.auth.isSignedIn()) {
        await window.puter.auth.signIn();
      }
    } catch { /* anonymous OK for some endpoints */ }

    const model = req.model || config.modelName || "claude-sonnet-4";
    const resp = await window.puter.ai.chat(
      req.messages.map((m) => ({ role: m.role, content: m.content })),
      { model, max_tokens: req.maxTokens ?? config.maxTokens, temperature: req.temperature ?? config.temperature, stream: false }
    );

    const text =
      typeof resp === "string" ? resp :
      resp?.message?.content ??
      resp?.text ??
      (Array.isArray(resp?.message?.content) ? resp.message.content.map((c: any) => c?.text ?? "").join("") : JSON.stringify(resp));

    return {
      text: typeof text === "string" ? text : String(text),
      provider: "puter",
      model,
      latencyMs: Math.round(performance.now() - t0),
      inputTokens: undefined, // Puter doesn't return usage
      outputTokens: undefined,
    };
  }

  async testConnection(config: ProviderConfig) {
    const t0 = performance.now();
    try {
      const res = await this.chat({ messages: [{ role: "user", content: "Reply with: OK" }], maxTokens: 10 }, config);
      return { ok: true, latencyMs: res.latencyMs, message: `Puter OK — ${res.model}`, response: res.text };
    } catch (e: any) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), message: e?.message || "Puter not available" };
    }
  }

  async listModels(config: ProviderConfig): Promise<string[]> {
    return config.enabledModels ?? ["claude-sonnet-4", "gpt-4o", "gemini-2.0-flash", "llama-3.3-70b", "mistral-large"];
  }
}

export const puterProvider = new PuterProvider();
