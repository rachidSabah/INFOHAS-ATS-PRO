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
  /**
   * Task hint forwarded to ProviderRouter for capability-weighted model
   * selection (Phase 8.1.3.1).
   */
  agentTask?: string;
  /**
   * Pipeline agent identity (Agent Configuration Center key, e.g.
   * "job-intelligence", "summary-optimizer", "reflection"). When set, the
   * call participates in the per-agent AI config resolution:
   *   explicit pinning > job AI lock > Agent Config Center > app defaults.
   * Any call carrying this flag is treated as SUPERVISED (inherits the job
   * AI configuration lock + single supervised recovery cycle).
   */
  pipelineAgent?: string;
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

  // === AI READINESS GATE — JOB CONFIG LOCK (directives #30, #31, #36, #42) ===
  // When the Resume Optimizer runs under a locked AI configuration, EVERY
  // optimizer agent inherits the locked provider+model from the single raw
  // call path — no agent may independently select an arbitrary/unvalidated
  // model. The fallback chain is additionally RESTRICTED to the locked,
  // pre-validated providers (no unvalidated failovers). Explicit per-call
  // pinning (providerId already set) takes precedence.
  //
  // === AGENT CONFIGURATION CENTER (Task 7) ===
  // Calls tagged with `pipelineAgent` are SUPERVISED calls: they inherit the
  // job lock AND receive generation-parameter defaults (temperature /
  // maxTokens / timeout) from the agent's stored configuration. Outside a
  // locked job, a configured agent may also contribute its preferred
  // provider+model (resolution: explicit > lock > agent config > defaults).
  const supervisedCall = !!opts.isOptimizerCall || !!opts.pipelineAgent;
  let lockProviderId = opts.providerId;
  let lockModel = opts.modelOverride;
  let lockExclude: string[] | undefined;
  let lockActive = false;
  if (supervisedCall && !lockProviderId && !lockModel) {
    try {
      const { getJobAILock, getActiveJobModel } = await import("./ai/readiness/config-lock");
      const lock = getJobAILock();
      const active = lock ? getActiveJobModel() : null;
      if (lock && active) {
        lockActive = true;
        lockProviderId = active.providerId;
        lockModel = active.model;
        const validated = new Set([lock.primary.providerId, ...lock.fallbacks.map((f) => f.providerId)]);
        lockExclude = lock.eligibleProviderIds.filter((id) => !validated.has(id));
      }
    } catch {
      // lock module unavailable — proceed with normal routing
    }
  }

  // Per-agent config contribution (Agent Configuration Center). Provider/model
  // only when NO lock is active and the caller did not pin explicitly.
  let agentCfg: { providerId?: string; model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number } | null = null;
  if (opts.pipelineAgent) {
    try {
      const { resolveAgentAIOptions } = await import("./agents/agent-ai-config");
      agentCfg = resolveAgentAIOptions(
        opts.pipelineAgent,
        !!(opts.providerId || opts.modelOverride),
        lockActive,
      );
    } catch {
      // agent config module unavailable — proceed with call-site values only
    }
  }

  const effProviderId = opts.providerId ?? lockProviderId ?? agentCfg?.providerId;
  const effModel = opts.modelOverride ?? lockModel ?? agentCfg?.model;
  const effTemperature = opts.temperature ?? agentCfg?.temperature;
  const effMaxTokens = opts.maxTokens ?? agentCfg?.maxTokens;
  const effTimeoutMs = opts.timeoutMs ?? agentCfg?.timeoutMs;

  const chatRequest: ChatRequest = {
    messages: opts.messages
      ? opts.messages
      : opts.systemPrompt
        ? [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: userPrompt },
          ]
        : [{ role: "user", content: userPrompt }],
    model: effModel,
    temperature: effTemperature,
    topP: opts.topP,
    maxTokens: effMaxTokens,
    signal: opts.signal,
  };

  const routerOptions: RouterOptions = {
    preferredProviderId: effProviderId,
    requestType: "chat",
    ...opts,
    providerId: effProviderId,
    modelOverride: effModel,
    temperature: effTemperature,
    maxTokens: effMaxTokens,
    timeoutMs: effTimeoutMs,
    excludeProviderIds: lockExclude?.length
      ? Array.from(new Set([...(opts.excludeProviderIds ?? []), ...lockExclude]))
      : opts.excludeProviderIds,
  } as RouterOptions;

  // Single execution path with ONE supervised recovery cycle (directives
  // #14/#35): FAIL → CLASSIFY → AUTO-HEAL → VALIDATE → one repaired retry,
  // or failover to a pre-validated fallback. Never an infinite retry loop.
  //
  // === RATE GOVERNOR (proactive pacing, Option 1) =========================
  // Pace the call under the provider's RPM cap BEFORE hitting the router:
  // bursty parallel agents queue here instead of colliding into 429s.
  // No-op when capacity is available; the enableRateGovernor flag disables
  // it entirely. A governor failure must NEVER block the call path.
  let governor: typeof import("./ai/rate-governor")["rateGovernor"] | undefined;
  try {
    const mod = await import("./ai/rate-governor");
    governor = mod.rateGovernor;
    await governor.acquire(effProviderId, effModel);
  } catch {
    governor = undefined; // proceed ungoverned
  }
  let res;
  try {
    res = await ProviderRouter.chat(chatRequest, routerOptions);
  } catch (primaryErr: any) {
    try { governor?.reportFailure(effProviderId, effModel, primaryErr); } catch { /* never block */ }
    if (supervisedCall && !controllerAborted(opts.signal)) {
      try {
        const { supervisedRecovery } = await import("./ai/readiness/preflight");
        const recovered = await supervisedRecovery(primaryErr);
        let recoveredRoute: { providerId: string; model: string } | null = recovered ?? null;
        if (recoveredRoute) {
          console.warn(`[AI] Supervised recovery: retrying once via ${recoveredRoute.providerId} (${recoveredRoute.model})`);
          try { await governor?.acquire(recoveredRoute.providerId, recoveredRoute.model); } catch { /* never block */ }
          let retryRes;
          try {
            retryRes = await ProviderRouter.chat(
              { ...chatRequest, model: recoveredRoute.model },
              {
                ...routerOptions,
                preferredProviderId: recoveredRoute.providerId,
                providerId: recoveredRoute.providerId,
                modelOverride: recoveredRoute.model,
                singleProvider: true,
              }
            );
          } catch (retryErr: any) {
            try { governor?.reportFailure(recoveredRoute.providerId, recoveredRoute.model, retryErr); } catch { /* never block */ }
            throw retryErr;
          }
          try { governor?.reportSuccess(recoveredRoute.providerId, recoveredRoute.model); } catch { /* never block */ }
          return {
            text: retryRes.text,
            provider: retryRes.provider,
            latencyMs: retryRes.latencyMs,
            tokensEstimate: retryRes.inputTokens
              ? (retryRes.inputTokens + (retryRes.outputTokens ?? 0))
              : estTokens(userPrompt),
            isLocalEngine: retryRes.provider.includes("Local Engine") || !!(retryRes as any).isLocalEngine,
          };
        }
      } catch (recoveryErr: any) {
        console.warn(`[AI] Supervised recovery failed: ${recoveryErr?.message ?? recoveryErr}`);
      }
    }
    throw primaryErr;
  }

  try { governor?.reportSuccess(effProviderId, effModel); } catch { /* never block */ }

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

/** True when the caller's AbortSignal already fired — recovery is pointless. */
function controllerAborted(signal?: AbortSignal): boolean {
  return !!signal && signal.aborted;
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

  // === AI READINESS GATE — JOB CONFIG LOCK (streaming parity, directives #30/#31) ===
  // Same resolution as callAIRaw: supervised calls (isOptimizerCall or
  // pipelineAgent) inherit the job lock; the Agent Configuration Center
  // contributes generation defaults — and provider/model ONLY when no lock
  // is active and the caller did not pin explicitly.
  const supervisedCallStream = !!opts.isOptimizerCall || !!opts.pipelineAgent;
  let lockProviderId = opts.providerId;
  let lockModel = opts.modelOverride;
  let lockExcludeStream: string[] | undefined;
  let lockActiveStream = false;
  if (supervisedCallStream && !lockProviderId && !lockModel) {
    try {
      const { getJobAILock, getActiveJobModel } = await import("./ai/readiness/config-lock");
      const lock = getJobAILock();
      const active = lock ? getActiveJobModel() : null;
      if (lock && active) {
        lockActiveStream = true;
        lockProviderId = active.providerId;
        lockModel = active.model;
        const validated = new Set([lock.primary.providerId, ...lock.fallbacks.map((f) => f.providerId)]);
        lockExcludeStream = lock.eligibleProviderIds.filter((id) => !validated.has(id));
      }
    } catch {
      // lock module unavailable — proceed with normal routing
    }
  }

  let agentCfgStream: { providerId?: string; model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number } | null = null;
  if (opts.pipelineAgent) {
    try {
      const { resolveAgentAIOptions } = await import("./agents/agent-ai-config");
      agentCfgStream = resolveAgentAIOptions(
        opts.pipelineAgent,
        !!(opts.providerId || opts.modelOverride),
        lockActiveStream,
      );
    } catch {
      // agent config module unavailable — proceed with call-site values only
    }
  }

  const effProviderIdStream = opts.providerId ?? lockProviderId ?? agentCfgStream?.providerId;
  const effModelStream = opts.modelOverride ?? lockModel ?? agentCfgStream?.model;
  const effTemperatureStream = opts.temperature ?? agentCfgStream?.temperature;
  const effMaxTokensStream = opts.maxTokens ?? agentCfgStream?.maxTokens;
  const effTimeoutMsStream = opts.timeoutMs ?? agentCfgStream?.timeoutMs;

  const chatRequest: ChatRequest = {
    messages: opts.messages
      ? opts.messages
      : opts.systemPrompt
        ? [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: userPrompt },
          ]
        : [{ role: "user", content: userPrompt }],
    model: effModelStream,
    temperature: effTemperatureStream,
    topP: opts.topP,
    maxTokens: effMaxTokensStream,
    signal: opts.signal,
  };

  const routerOptions: RouterOptions = {
    preferredProviderId: effProviderIdStream,
    requestType: "chat",
    ...opts,
    providerId: effProviderIdStream,
    modelOverride: effModelStream,
    temperature: effTemperatureStream,
    maxTokens: effMaxTokensStream,
    timeoutMs: effTimeoutMsStream,
    excludeProviderIds: lockExcludeStream?.length
      ? Array.from(new Set([...(opts.excludeProviderIds ?? []), ...lockExcludeStream]))
      : opts.excludeProviderIds,
  } as RouterOptions;

  // === RATE GOVERNOR (proactive pacing, streaming parity) ================
  // Same contract as callAIRaw: acquire before the router, report the
  // outcome after. A governor failure never blocks the call path.
  let governorStream: typeof import("./ai/rate-governor")["rateGovernor"] | undefined;
  try {
    const mod = await import("./ai/rate-governor");
    governorStream = mod.rateGovernor;
    await governorStream.acquire(effProviderIdStream, effModelStream);
  } catch {
    governorStream = undefined; // proceed ungoverned
  }
  let res;
  try {
    res = await ProviderRouter.stream(chatRequest, routerOptions, onChunk);
  } catch (streamErr: any) {
    try { governorStream?.reportFailure(effProviderIdStream, effModelStream, streamErr); } catch { /* never block */ }
    throw streamErr;
  }
  try { governorStream?.reportSuccess(effProviderIdStream, effModelStream); } catch { /* never block */ }

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
