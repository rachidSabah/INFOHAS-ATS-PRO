// Puter.js provider adapter — runs in the browser, uses window.puter.
// Free for end users — they authenticate with their own Google account via Puter.
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";
// Curated fallback ids — SINGLE SOURCE OF TRUTH (src/lib/puter-models.ts).
// The LIVE catalog is fetched via ProviderManager.fetchModels() →
// /api/providers/models → api.puter.com/puterai/chat/models.
import {
  PUTER_CURATED_MODEL_IDS,
  supportsCustomTemperature,
  isPuterTemperatureError,
  sanitizePuterChatOpts,
} from "../../puter-models";
// Shared lazy loader (singleton, readiness-polled). The SDK is intentionally
// NOT loaded eagerly in layout — this is the single load path for AI calls.
import { ensurePuterLoaded } from "../../puter-loader";

/**
 * Dynamically load the Puter.js SDK script and wait for it to be ready.
 * This avoids the automatic WebSocket connection that happens when the
 * script is loaded eagerly via <script> tag in the HTML.
 */
function loadPuterScript(): Promise<void> {
  return ensurePuterLoaded("ai").then(() => undefined);
}

/**
 * Wrap a non-async iterator (one exposing only `.next()`) into an
 * AsyncIterable so it can be consumed with `for await`. This handles
 * Puter.js stream responses that return a plain iterator object rather than
 * a native AsyncIterable.
 */
function makeAsyncIterable(iterator: any): AsyncIterable<any> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.resolve(iterator.next()),
      };
    },
  };
}

export class PuterProvider implements AIProviderAdapter {
  readonly type = "puter";

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    const { getPuterProvider } = await import("../../providers/puter-provider");
    const puter = getPuterProvider();
    const model = req.model || config.modelName;

    // Delegate execution to the canonical Puter OAuth provider to reuse its
    // robust account rotation on 429, session checks, and anonymous fallback.
    const result = await puter.generate({
      systemPrompt: req.messages.find((m) => m.role === "system")?.content,
      userPrompt: req.messages.find((m) => m.role === "user")?.content || "",
      maxTokens: req.maxTokens,
      temperature: supportsCustomTemperature(model) ? req.temperature : undefined,
      topP: req.topP,
      model: model,
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
    return config.enabledModels ?? [...PUTER_CURATED_MODEL_IDS];
  }

  /**
   * Streaming — Puter.js is the only backend that natively streams in this app.
   * Iterates the AsyncIterable that window.puter.ai.chat returns when
   * `stream: true`, piping every text chunk through `onChunk`. Errors (including
   * "error" parts from the stream) reject so the pipeline can cool down / fall
   * back exactly as the non-streaming path would.
   */
  async stream(req: ChatRequest, config: ProviderConfig, onChunk: (text: string) => void): Promise<ChatResponse> {
    const t0 = performance.now();
    await loadPuterScript();
    if (typeof window === "undefined" || !window.puter?.ai?.chat) {
      throw new Error("Puter.js is not available for streaming.");
    }

    const { getPuterProvider } = await import("../../providers/puter-provider");
    const puter = getPuterProvider();
    if (!puter.isAuthenticated() && !window.puter?.ai?.chat) {
      throw new Error("Puter authentication required for streaming.");
    }

    const messages = req.messages;
    const model = req.model || config.modelName;
    const rawTemp = req.temperature ?? config.temperature ?? 0.7;
    const chatOpts: any = sanitizePuterChatOpts({
      max_tokens: req.maxTokens ?? config.maxTokens,
      temperature: rawTemp,
      stream: true,
      ...(model ? { model } : {}),
    });

    const runStream = async (opts: any) => {
      let response: any = window.puter.ai.chat(messages as any, opts);
      // window.puter.ai.chat(..., {stream:true}) may return either:
      //   (a) an AsyncIterable directly, or
      //   (b) a Promise that resolves to an AsyncIterable, or
      //   (c) a plain iterator object exposing a `.next()` method.
      // Await if it's a thenable (case b) before the iterable check.
      if (response && typeof response.then === "function") {
        response = await response;
      }
      const isAsyncIterable =
        response && typeof (response as any)[Symbol.asyncIterator] === "function";
      const isIterator =
        response && typeof (response as any).next === "function";
      if (!response || (!isAsyncIterable && !isIterator)) {
        throw new Error("Puter.js streaming response was not iterable.");
      }

      let textAcc = "";
      let sawError = "";
      // Normalize to an AsyncIterable for the for-await loop.
      const iterable: AsyncIterable<any> = isAsyncIterable
        ? (response as AsyncIterable<any>)
        : makeAsyncIterable(response);
      for await (const part of iterable) {
        if (part?.type === "text" && part.text) {
          textAcc += part.text;
          onChunk(part.text);
        } else if (part?.type === "error") {
          sawError = part.message || "Puter stream error";
          break;
        } else if (typeof part === "string") {
          textAcc += part;
          onChunk(part);
        }
      }

      if (sawError) {
        throw new Error(sawError);
      }

      return textAcc;
    };

    let fullText = "";
    try {
      fullText = await runStream(chatOpts);
    } catch (streamErr: any) {
      // If error is about unsupported temperature and temperature was set, retry once without temperature
      if (isPuterTemperatureError(streamErr) && "temperature" in chatOpts && fullText.length === 0) {
        console.warn(
          `[Puter Stream] Model ${model || "default"} rejected temperature ${chatOpts.temperature}. Retrying without temperature.`
        );
        const retryOpts = { ...chatOpts };
        delete retryOpts.temperature;
        fullText = await runStream(retryOpts);
      } else {
        throw streamErr;
      }
    }

    return {
      text: fullText,
      provider: "Puter.js (streamed)",
      model: model || "puter-default",
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

export const puterProvider = new PuterProvider();
