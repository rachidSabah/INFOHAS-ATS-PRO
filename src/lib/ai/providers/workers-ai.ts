// Workers AI provider adapter — Cloudflare-native rescue tier.
//
// Runs through the SAME-Origin chat proxy (/api/providers/chat) with
// `workersAI: true`; the edge route executes the in-account AI binding
// (getRequestContext().env.AI.run) instead of an upstream fetch. That means:
//   - zero external egress → nothing to block, no per-IP third-party quota
//   - free tier (10,000 neurons/day) → RESERVED as a rescue tier by the
//     router: the provider id is in EMERGENCY_ONLY_PROVIDERS, so it is never
//     selected as a PRIMARY engine, only attempted after the routed provider
//     (puter) fails, ahead of paid fallbacks (mistral).
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";
import { ProviderError } from "./openai-compatible";
import { WORKERS_AI_DEFAULT_MODEL, WORKERS_AI_MODEL_OPTIONS } from "./workers-ai-core";

export class WorkersAIProvider implements AIProviderAdapter {
  readonly type = "workers-ai";

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    if (typeof window === "undefined") {
      throw new ProviderError("Workers AI adapter requires the app's browser context (server code should call env.AI directly).", 400, 0);
    }

    // Edge response cache opt-in — identical prompts share one edge hit
    // instead of burning neurons twice (same pattern as openai-compatible).
    let cacheEnabled = false;
    if (!req.noCache) {
      try {
        const { useApp } = await import("../../store");
        cacheEnabled = useApp.getState()?.providerSettings?.enableCaching !== false;
      } catch { cacheEnabled = false; }
    }

    const model = req.model || config.modelName || WORKERS_AI_DEFAULT_MODEL;
    const proxyRes = await fetch("/api/providers/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workersAI: true,
        model,
        messages: req.messages,
        maxTokens: req.maxTokens ?? config.maxTokens,
        temperature: req.temperature ?? config.temperature,
        topP: req.topP ?? config.topP,
        // Router-injected attempt budget (withAttemptDeadline) — same
        // semantics as the REST providers' proxy calls.
        timeoutMs: req.timeoutMs ?? config.timeout,
        cacheEnabled,
      }),
      signal: req.signal ?? AbortSignal.timeout(config.timeout),
    });
    const latencyMs = Math.round(performance.now() - t0);
    const data = (await proxyRes.json().catch(() => ({}))) as any;
    if (!proxyRes.ok || !data.ok) {
      const err = new ProviderError(
        `Workers AI: ${data.error || data.message || `HTTP ${proxyRes.status}`}`,
        proxyRes.status === 501 ? 501 : proxyRes.status,
        latencyMs,
      );
      if (Number.isFinite(data?.retryAfterSeconds) && data.retryAfterSeconds > 0) {
        (err as any).retryAfterSeconds = Number(data.retryAfterSeconds);
      }
      throw err;
    }
    return {
      text: String(data.text ?? ""),
      provider: "Workers AI (native)",
      model,
      latencyMs,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
    };
  }

  async testConnection(config: ProviderConfig) {
    const t0 = performance.now();
    try {
      const res = await this.chat(
        { messages: [{ role: "user", content: "Reply with: OK" }], maxTokens: 20, noCache: true },
        config,
      );
      return { ok: true, latencyMs: res.latencyMs, message: `Workers AI OK — ${res.model}`, response: res.text };
    } catch (e: any) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), message: e?.message || "Workers AI binding not available" };
    }
  }

  async listModels(config: ProviderConfig): Promise<string[]> {
    return config.enabledModels ?? [...WORKERS_AI_MODEL_OPTIONS];
  }
}

export const workersAIProvider = new WorkersAIProvider();
