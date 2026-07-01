// Google Gemini provider adapter.
// Supports BOTH:
//   1. Native Gemini API (baseUrl without /openai/) — uses :generateContent?key=
//   2. OpenAI-compatible endpoint (baseUrl with /openai/) — uses /chat/completions + Bearer
//
// Includes a sliding-window rate limiter to stay under Google's free-tier RPM cap.
// Without throttling, bursty optimization calls hit 429 immediately even when
// the daily quota (1500 RPD) is untouched.
import { OpenAICompatibleProvider, ProviderError } from "./openai-compatible";
import type { ChatRequest, ChatResponse, ProviderConfig } from "./interface";

// ============================================================================
// Sliding-window rate limiter — per-key, per-model
// ============================================================================
class SlidingWindowRateLimiter {
  private windows = new Map<string, number[]>();

  /** Wait until a request slot is available under `rpm` requests per 60s. */
  async waitSlot(key: string, rpm: number): Promise<void> {
    const now = Date.now();
    const windowStart = now - 60_000;

    let timestamps = this.windows.get(key) ?? [];
    // Prune expired entries
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= rpm) {
      // We're at the limit — wait until the oldest timestamp expires
      const oldest = timestamps[0];
      const waitMs = oldest + 60_000 - now + 50; // +50ms buffer
      if (waitMs > 0) {
        console.info(`[GeminiRateLimit] At ${rpm} RPM — waiting ${Math.ceil(waitMs)}ms before next request`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
      // Re-prune after waiting (in case other requests accumulated)
      const afterWait = Date.now() - 60_000;
      timestamps = (this.windows.get(key) ?? []).filter((t) => t > afterWait);
    }

    timestamps.push(Date.now());
    this.windows.set(key, timestamps);
  }
}

const rateLimiter = new SlidingWindowRateLimiter();

export class GeminiProvider extends OpenAICompatibleProvider {
  constructor() { super("gemini"); }

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const baseUrl = (config.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");

    // OpenAI-compatible endpoint (/v1beta/openai/) — delegate to parent which uses
    // /chat/completions with Authorization: Bearer ***
    if (baseUrl.includes("/openai")) {
      return super.chat(req, config);
    }

    // === Rate limit: respect config.rateLimitPerMinute or default to 8 RPM ===
    // Google's free tier is ~10-30 RPM; we stay safely under at 8.
    const rpm = config.rateLimitPerMinute ?? 8;
    const model = req.model || config.modelName || "gemini-2.0-flash";
    const rateLimitKey = `${config.id ?? "gemini"}:${model}`;
    await rateLimiter.waitSlot(rateLimitKey, rpm);

    const t0 = performance.now();
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
    const res = await fetch(`${baseUrl}/models?key=${encodeURIComponent(key)}`, {
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
