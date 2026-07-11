"use client";

// ResumeAI Pro — client-side AI bridge.
// Strategy (ADR-001 Consolidated AI Routing):
// All AI requests route through ProviderRouter.chat() to ensure unified
// failovers, key/model rotation, and caching.

import { ProviderRouter, type RouterOptions } from "./ai/services/router";
import type { ChatRequest } from "./ai/providers/interface";
import { localGenerate } from "./local-engine";
import { isPuterInCooldown, markPuterCooldown, isPuterQuotaError } from "./provider-cooldown";
import { buildStandardDirective } from "./optimizer-directive-engine";
import { getPromptCache, setPromptCache, buildPromptHash } from "./prompt-cache";
import { withTimeout, OptimizationProviderExhaustedError, OPTIMIZER_CALL_TIMEOUT_MS } from "./pipeline-watchdog";
import { useApp } from "./store";
import { truncatePromptToTokenLimit, MAX_INPUT_TOKENS } from "./ai-diagnostics";
import {
  checkPuterUsageStatus as _checkPuterUsageStatus,
  getPuterMonthlyUsage as _getPuterMonthlyUsage,
  type PuterMonthlyUsage,
} from "./puter-client";

// Re-export Puter usage functions for the UI
export const checkPuterUsageStatus = _checkPuterUsageStatus;
export const getPuterMonthlyUsage = _getPuterMonthlyUsage;
export type { PuterMonthlyUsage };

// Re-export clearAllProviderCooldowns for compatibility
export { clearAllProviderCooldowns } from "./provider-cooldown";
export { OptimizationProviderExhaustedError, OPTIMIZER_CALL_TIMEOUT_MS };

// Re-export provider-selection static helpers from the router for backward compatibility
export {
  hasValidApiKey,
  getFallbackChain,
  getOrderedFallbackProviders,
  selectProvider,
  selectProviderForAgent,
} from "./ai/services/router";

declare global {
  interface Window {
    puter?: any;
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message: string = "No AI provider available.") {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class ProviderReturnedEmptyResponse extends Error {
  constructor(message: string = "The AI provider returned an empty response.\nPlease retry or switch providers.") {
    super(message);
    this.name = "ProviderReturnedEmptyResponse";
    console.log("[PROVIDER]\nEmpty response detected.");
  }
}

export const OPTIMIZER_DIRECTIVE: string = `(engine-sourced — see buildStandardDirective())`;

/**
 * Generate the optimizer directive from the stored config.
 */
export function getOptimizerDirective(): string {
  let customDirective: string | undefined;

  try {
    const state: any = useApp.getState();
    const c = state?.optimizerDirective;

    if (c) {
      customDirective = c.customDirectiveOverride?.trim() || undefined;
    }
    if (customDirective) {
      console.log("[getOptimizerDirective] Applied (CUSTOM OVERRIDE)", {
        length: customDirective.length,
      });
      return customDirective;
    }
    const directive = buildStandardDirective(c ?? null);
    console.log("[getOptimizerDirective] Applied (GENERATED from engine)", {
      length: directive.length,
    });
    return directive;
  } catch (err) {
    console.warn("[getOptimizerDirective] Error resolving config, using engine fallback:", err);
    const fallback = buildStandardDirective(null);
    console.log("[getOptimizerDirective] Applied (FALLBACK)", {
      length: fallback.length,
    });
    return fallback;
  }
}

export interface AICallOptions {
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  preferLocal?: boolean;
  preferServer?: boolean;
  taskCategory?: "document" | "interactive" | "development";
  isOptimizerCall?: boolean;
  timeoutMs?: number;
  excludeProviderIds?: string[];
  enableRetries?: boolean;
  enableProviderSwitch?: boolean;
  agentType?: "optimizer" | "supervisor" | "guardian" | "assembler" | "emergency" | "simple" | "reasoning";
  providerId?: string;
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
  modelOverride?: string;
  signal?: AbortSignal;
}

export interface AICallResult {
  text: string;
  provider: string;
  latencyMs: number;
  tokensEstimate: number;
  isLocalEngine?: boolean;
}

const estTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Robustly extract a JSON object from an LLM response.
 */
export function extractJSON<T = any>(raw: string): T {
  if (typeof raw !== "string") {
    throw new Error("extractJSON: input is not a string");
  }
  if (!raw.trim()) {
    throw new Error("extractJSON: input is empty");
  }

  let cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through
  }

  const firstBrace = cleaned.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          continue;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth++;
        continue;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          const slice = cleaned.slice(firstBrace, i + 1);
          try {
            return JSON.parse(slice) as T;
          } catch {
            // fall through
          }
          break;
        }
      }
    }
  }

  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const slice = cleaned.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {
      // fall through
    }
  }

  const preview = cleaned.slice(0, 80).replace(/\n/g, " ");
  throw new Error(
    `AI did not return valid JSON. Response started with: "${preview}${cleaned.length > 80 ? "..." : ""}". ` +
    `This usually means the AI returned prose instead of structured data. ` +
    `Try again, or check that your default AI provider is correctly configured.`
  );
}

/**
 * Main AI entrypoint — delegates directly to ProviderRouter (ADR-001).
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const chatRequest: ChatRequest = {
    messages: opts.messages
      ? opts.messages
      : opts.systemPrompt
        ? [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userPrompt },
          ]
        : [{ role: "user", content: opts.userPrompt }],
    model: opts.modelOverride,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    signal: opts.signal,
  };

  const routerOptions: RouterOptions = {
    preferredProviderId: opts.providerId,
    singleProvider: !!opts.providerId,
    requestType: "chat",
    ...opts,
  };

  const res = await ProviderRouter.chat(chatRequest, routerOptions);

  return {
    text: res.text,
    provider: res.provider,
    latencyMs: res.latencyMs,
    tokensEstimate: res.inputTokens
      ? (res.inputTokens + (res.outputTokens ?? 0))
      : estTokens(opts.userPrompt),
    isLocalEngine: res.provider.includes("Local Engine") || !!(res as any).isLocalEngine,
  };
}

/**
 * Streaming entrypoint — uses Puter.js direct streaming if available,
 * else falls back to callAI + simulated word-by-word streaming.
 */
export async function callAIStreamed(opts: AICallOptions, onChunk: (chunk: string) => void): Promise<AICallResult> {
  const t0 = performance.now();

  if (!opts.preferServer && !opts.preferLocal && typeof window !== "undefined" && window.puter?.ai?.chat) {
    if (!isPuterInCooldown()) {
      try {
        const messages = opts.messages
          ? opts.messages
          : opts.systemPrompt
            ? [
                { role: "system", content: opts.systemPrompt },
                { role: "user", content: opts.userPrompt },
              ]
            : [{ role: "user", content: opts.userPrompt }];

        const chatOpts: any = {
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.7,
          stream: true,
        };

        try {
          const state: any = useApp.getState();
          const puterProvider = (state?.providers || []).find(
            (p: any) => p.type === "puter" && p.isActive && p.modelName,
          );
          if (puterProvider?.modelName) {
            chatOpts.model = puterProvider.modelName;
          }
        } catch (e) {
          console.warn("[AI] Puter model lookup failed:", e);
        }

        const response: any = await withTimeout(
          window.puter.ai.chat(messages, chatOpts),
          60000,
          "Puter AI chat (streamed)"
        );

        let fullText = "";
        for await (const part of response as AsyncIterable<any>) {
          if (part?.type === "text" && part.text) {
            fullText += part.text;
            onChunk(part.text);
          } else if (part?.type === "error") {
            throw new Error(part.message || "Puter stream error");
          }
        }

        if (fullText.trim().length > 0) {
          return {
            text: fullText,
            provider: "Puter.js (streamed)",
            latencyMs: Math.round(performance.now() - t0),
            tokensEstimate: estTokens(opts.userPrompt + (opts.systemPrompt ?? "")),
          };
        }
      } catch (e: any) {
        const msg = e?.message || String(e || "");
        if (isPuterQuotaError(e)) {
          markPuterCooldown();
          console.warn("[AI Streamed] Puter usage cap hit — entering 5-minute cooldown.");
        } else if (!/auth|sign.?in|unauthor|401|403/i.test(msg)) {
          console.warn("[AI Streamed] Puter streaming failed, falling through to callAI:", msg);
        }
      }
    }
  }

  // Fallback: non-streamed callAI + simulated streaming
  const result = await callAI(opts);
  const words = result.text.split(/(\s+)/);
  for (let i = 0; i < words.length; i++) {
    onChunk(words[i]);
    if (i % 12 === 0) await new Promise((r) => setTimeout(r, 8));
  }
  return result;
}

// React store helpers
export function useAIProviders() {
  return useApp((s) => s.providers.filter((p) => p.isActive).sort((a, b) => a.priority - b.priority));
}

export function usePreferredProvider() {
  return useApp((s) =>
    s.providers.find((p) => p.isActive) ??
    null
  );
}

// Puter.js user helpers
export function getPuterStatus(): { loaded: boolean; signedIn: boolean; user: any | null } {
  if (typeof window === "undefined" || !window.puter) {
    return { loaded: false, signedIn: false, user: null };
  }
  try {
    let signedIn = false;
    if (window.puter.auth) {
      if (typeof window.puter.auth.isSignedIn === "function") {
        signedIn = !!window.puter.auth.isSignedIn();
      }
    }
    return { loaded: true, signedIn, user: null };
  } catch {
    return { loaded: true, signedIn: false, user: null };
  }
}

export async function getPuterUser(): Promise<any | null> {
  if (typeof window === "undefined" || !window.puter?.auth) return null;
  try {
    const isSignedIn = typeof window.puter.auth.isSignedIn === "function"
      ? window.puter.auth.isSignedIn()
      : false;
    if (!isSignedIn) return null;
    const user = await window.puter.auth.getUser();
    return user || null;
  } catch {
    return null;
  }
}

export async function signInToPuter(): Promise<{ ok: boolean; user?: any; error?: string }> {
  if (typeof window === "undefined" || !window.puter?.auth) {
    return { ok: false, error: "Puter.js is not loaded. Please refresh the page." };
  }
  try {
    await window.puter.auth.signIn();
    const user = await window.puter.auth.getUser().catch(() => null);
    return { ok: true, user };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Puter sign-in was cancelled or failed." };
  }
}

export async function signOutFromPuter(): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.puter?.auth) {
    return { ok: false, error: "Puter.js is not loaded." };
  }
  try {
    await window.puter.auth.signOut();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Sign-out failed." };
  }
}
