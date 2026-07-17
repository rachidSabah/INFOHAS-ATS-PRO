"use client";

// ResumeAI Pro — client-side AI bridge.
// Strategy (ADR-001 Consolidated AI Routing):
// All AI requests route through ProviderRouter.chat() to ensure unified
// failovers, key/model rotation, and caching.

import { ProviderRouter, type RouterOptions } from "./ai/services/router";
import type { ChatRequest } from "./ai/providers/interface";
import { localGenerate } from "./local-engine";
import { buildStandardDirective } from "./optimizer-directive-engine";
import { getPromptCache, setPromptCache, buildPromptHash } from "./prompt-cache";
import { OptimizationProviderExhaustedError, OPTIMIZER_CALL_TIMEOUT_MS } from "./pipeline-watchdog";
import { useApp } from "./store";
import { useShallow } from "zustand/react/shallow";
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
  userPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** Nucleus sampling (0-1). Phase 8.1.3.2A: now propagated end-to-end. */
  topP?: number;
  preferLocal?: boolean;
  preferServer?: boolean;
  taskCategory?: "document" | "interactive" | "development";
  isOptimizerCall?: boolean;
  timeoutMs?: number;
  excludeProviderIds?: string[];
  enableRetries?: boolean;
  enableProviderSwitch?: boolean;
  agentType?: "optimizer" | "supervisor" | "guardian" | "assembler" | "emergency" | "simple" | "reasoning";
  /** Task hint forwarded to ProviderRouter for capability-weighted model selection (Phase 8.1.3.1). */
  agentTask?: string;
  providerId?: string;
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
  modelOverride?: string;
  signal?: AbortSignal;
  /** Phase 8.1.3.2B — when true, deliver the response as streamed chunks via an
   *  onChunk callback (provided to callAIStreamed/recordAI). Non-streaming
   *  callers ignore this. */
  stream?: boolean;
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
 * RAW AI entrypoint — delegates directly to ProviderRouter (ADR-001).
 *
 * Phase 8.1.3.1: this is the SINGLE place that talks to the Provider Router.
 * Only the Flight Recorder's `recordAI()` is allowed to call this directly.
 * Feature code must NOT import `callAIRaw` — use `callAI` (auto-recorded) or
 * `recordAI` (with metadata).
 */
export async function callAIRaw(opts: AICallOptions): Promise<AICallResult> {
  const userPrompt = opts.userPrompt ?? "";
  const chatRequest: ChatRequest = {
    messages: opts.messages
      ? opts.messages
      : opts.systemPrompt
        ? [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: userPrompt },
          ]
        : [{ role: "user", content: userPrompt }],
    model: opts.modelOverride,
    temperature: opts.temperature,
    topP: opts.topP,
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
      : estTokens(userPrompt),
    isLocalEngine: res.provider.includes("Local Engine") || !!(res as any).isLocalEngine,
  };
}

/**
 * Main AI entrypoint (backward-compatible).
 *
 * Phase 8.1.3.1 — UNIVERSAL PIPELINE: `callAI` now delegates to the Flight
 * Recorder's `recordAI()`, so EVERY existing caller is automatically recorded
 * with ZERO behavioral change. `recordAI` internally calls `callAIRaw` (the
 * only raw provider path). This guarantees a single, unified, observed
 * execution pipeline without touching call-sites.
 *
 * `recordAI` is imported lazily to avoid a static import cycle between this
 * module and the flight recorder.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const { recordAI } = await import("./ai/flight-recorder");
  return recordAI(opts, { scope: "other", feature: "callAI (auto)", module: "src/lib/ai.ts" });
}

/**
 * RAW streaming entrypoint — delegates to ProviderRouter.stream() (the single
 * router, extended with streaming). Phase 8.1.3.2B: this is the ONLY raw
 * streaming path, mirroring `callAIRaw` for non-streaming. Only `recordAI` may
 * call this directly.
 */
export async function callAIRawStreamed(
  opts: AICallOptions,
  onChunk: (chunk: string) => void
): Promise<AICallResult> {
  const userPrompt = opts.userPrompt ?? "";
  const chatRequest: ChatRequest = {
    messages: opts.messages
      ? opts.messages
      : opts.systemPrompt
        ? [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: userPrompt },
          ]
        : [{ role: "user", content: userPrompt }],
    model: opts.modelOverride,
    temperature: opts.temperature,
    topP: opts.topP,
    maxTokens: opts.maxTokens,
    signal: opts.signal,
  };

  const routerOptions: RouterOptions = {
    preferredProviderId: opts.providerId,
    singleProvider: !!opts.providerId,
    requestType: "chat",
    ...opts,
  };

  const res = await ProviderRouter.stream(chatRequest, routerOptions, onChunk);

  return {
    text: res.text,
    provider: res.provider,
    latencyMs: res.latencyMs,
    tokensEstimate: res.inputTokens
      ? (res.inputTokens + (res.outputTokens ?? 0))
      : estTokens(userPrompt),
    isLocalEngine: res.provider.includes("Local Engine") || !!(res as any).isLocalEngine,
  };
}

/**
 * Streaming entrypoint — Phase 8.1.3.2B UNIVERSAL STREAMING.
 *
 * Streaming is now a FIRST-CLASS path through the SAME architecture as
 * `callAI`: it delegates to `recordAI` (with `stream: true`), so every streamed
 * execution is automatically recorded by the Flight Recorder, passes through
 * the middleware hooks, and consumes the shared configuration — with NO bypass
 * of ProviderRouter / Puter cooldown / failover. The only behavioural difference
 * from the old implementation is that delivery is now progressive through the
 * single ProviderRouter.stream path instead of a hand-rolled direct
 * `window.puter.ai.chat` call.
 *
 * The public signature `(opts, onChunk)` is preserved for callers.
 */
export async function callAIStreamed(
  opts: AICallOptions,
  onChunk: (chunk: string) => void
): Promise<AICallResult> {
  const { recordAI } = await import("./ai/flight-recorder");
  return recordAI(opts, {
    scope: "other",
    feature: "callAIStreamed (auto)",
    module: "src/lib/ai.ts",
    stream: true,
    onChunk,
  });
}

// React store helpers
export function useAIProviders() {
  return useApp(useShallow((s) => s.providers.filter((p) => p.isActive).sort((a, b) => a.priority - b.priority)));
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
