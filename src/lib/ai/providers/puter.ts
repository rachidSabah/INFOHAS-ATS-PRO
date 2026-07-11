// Puter.js provider adapter — runs in the browser, uses window.puter.
// Free for end users — they authenticate with their own Google account via Puter.
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";

/**
 * Dynamically load the Puter.js SDK script and wait for it to be ready.
 * This avoids the automatic WebSocket connection that happens when the
 * script is loaded eagerly via <script> tag in the HTML.
 */
function loadPuterScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Puter.js requires a browser environment"));
      return;
    }
    if (window.puter?.ai?.chat) {
      resolve(); // already loaded
      return;
    }
    // Create the script tag dynamically
    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.async = true;
    script.onload = () => {
      // After the script loads, wait for puter to be ready
      const check = setInterval(() => {
        if (window.puter?.ai?.chat) {
          clearInterval(check);
          clearTimeout(timeout);
          // Suppress Puter's auto-connection banner
          try {
            if (window.puter && !(window.puter as any)._quietSet) {
              try { Object.defineProperty(window.puter, 'quiet', { value: true, writable: true, configurable: true }); }
              catch(e) { window.puter.quiet = true; }
              (window.puter as any)._quietSet = true;
            }
          } catch (_) { /* best-effort */ }
          resolve();
        }
      }, 50);
      const timeout = setTimeout(() => {
        clearInterval(check);
        if (window.puter?.ai?.chat) resolve();
        else reject(new Error("Puter.js SDK failed to initialize"));
      }, 15000);
    };
    script.onerror = () => reject(new Error("Failed to load Puter.js SDK script"));
    document.head.appendChild(script);
  });
}

export class PuterProvider implements AIProviderAdapter {
  readonly type = "puter";

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    const { getPuterProvider } = await import("../../providers/puter-provider");
    const puter = getPuterProvider();

    // Delegate execution to the canonical Puter OAuth provider to reuse its
    // robust account rotation on 429, session checks, and anonymous fallback.
    const result = await puter.generate({
      systemPrompt: req.messages.find((m) => m.role === "system")?.content,
      userPrompt: req.messages.find((m) => m.role === "user")?.content || "",
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      model: req.model || config.modelName,
    });

    return {
      text: result.text,
      provider: result.provider,
      model: req.model || config.modelName || "puter-default",
      latencyMs: Math.round(performance.now() - t0),
      inputTokens: undefined,
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
    return config.enabledModels ?? ["gpt-5.4-nano", "gpt-5-nano", "gpt-4o-mini", "gpt-4o", "claude-sonnet-4-5", "claude-3-5-sonnet", "gemini-2.5-flash", "deepseek-chat", "llama-3.3-70b", "mistral-large"];
  }
}

export const puterProvider = new PuterProvider();
