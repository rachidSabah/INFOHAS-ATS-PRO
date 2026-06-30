"use client";

// ResumeAI Pro — client-side AI bridge.
// Strategy:
//   0. User-configured default API provider (from AI Providers settings) — FIRST priority.
//      Honors the user's chosen model, API key, base URL, and auth type.
//   1. Server-side provider fallback (OpenCode, ZenCode, DeepSeek, Groq, etc.) — used when primary fails.
//   2. Puter.js (free, browser-auth) — FALLBACK ONLY, never the primary provider.
//   3. Puter.js (anonymous mode) — last resort before local engine.
import { localGenerate } from "./local-engine";
import { isProviderInCooldown, markProvider429Cooldown, markProvider401Cooldown, markProviderTimeoutCooldown, isTimeoutError, clearAllProviderCooldowns, isPuterInCooldown, markPuterCooldown, isPuterQuotaError, isFailedToFetchError, PROVIDER_COOLDOWN_PREFIX, PROVIDER_429_COOLDOWN_MS, PROVIDER_401_COOLDOWN_MS, PUTER_COOLDOWN_KEY, PUTER_COOLDOWN_MS } from "./provider-cooldown";
// Re-export clearAllProviderCooldowns for backward compatibility (Optimizer.tsx imports it from ./ai)
export { clearAllProviderCooldowns };
import { buildStandardDirective } from "./optimizer-directive-engine";
//
// All AI calls are wrapped in failover with try/catch + provider rotation.

import { withTimeout, OptimizationProviderExhaustedError, AI_CALL_TIMEOUT_MS, OPTIMIZER_CALL_TIMEOUT_MS, PROVIDER_TIMEOUT_COOLDOWN_MS } from "./pipeline-watchdog";
export { OptimizationProviderExhaustedError, OPTIMIZER_CALL_TIMEOUT_MS };

import { useApp } from "./store";
import { startAICall, truncatePromptToTokenLimit, checkTokenLimit, MAX_INPUT_TOKENS } from "./ai-diagnostics";
import { getRequestQueue, withRateLimitRetry, isRateLimitError, getRateLimitErrorMessage, getRecommendedFallbacks, isOpenCodeZenFree, startOptimizationTracking, stopOptimizationTracking } from "./provider-capabilities";
import type { AIProvider, FallbackChainConfig, OptimizerDirectiveConfig } from "./types";
import {
  checkPuterUsageStatus as _checkPuterUsageStatus,
  getPuterMonthlyUsage as _getPuterMonthlyUsage,
  type PuterMonthlyUsage,
} from "./puter-client";

// Re-export Puter usage functions for the UI
export const checkPuterUsageStatus = _checkPuterUsageStatus;
export const getPuterMonthlyUsage = _getPuterMonthlyUsage;
export type { PuterMonthlyUsage };

import {
  circuitBreakerSuccess,
  circuitBreakerFailure,
  shouldSkipForOptimization,
  EMERGENCY_ONLY_PROVIDERS,
} from "./circuit-breaker";

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

export function hasValidApiKey(p: any): boolean {
  if (!p) return false;
  // Free providers that don't require API keys
  if (p.type === "puter" || p.type === "local") return true;
  if (p.type === "opencode") return true; // OpenCode: explicitly free models (factory.ts L20)
  if (p.type === "custom" && p.authType === "none") return true;
  // Providers that explicitly declare no API key needed
  if (p.requiresApiKey === false) return true;
  const key = p.apiKey;
  if (key === undefined || key === null) return false;
  if (typeof key !== "string") return false;
  const trimmed = key.trim();
  if (trimmed === "" || trimmed === "undefined" || trimmed === "null") return false;
  return true;
}

/**
 * Get the user-configured fallback chain from the store.
 * Returns null if the chain is disabled or not configured.
 */
export function getFallbackChain(): FallbackChainConfig | null {
  try {
    const state: any = useApp.getState();
    const chain = state?.fallbackChain;
    if (!chain || !chain.enabled) return null;
    return chain as FallbackChainConfig;
  } catch {
    return null;
  }
}

export const PROVIDER_ALIASES: Record<string, string[]> = {
  p_google: ["p_google_gemini"],
  p_google_gemini: ["p_google"],
  p_zencode: ["p_opencode", "zencode"],
  p_opencode: ["p_zencode"],
};

/**
 * Build an ordered list of fallback providers from the user's configured chain.
 *
 * This replaces the hardcoded `allProviders.filter(p => p.isActive)` logic.
 * The chain is traversed in order (index 0 = highest priority).
 * Each entry specifies a providerId + model, and may override generation params.
 *
 * Returns an array of { provider, model, overrides } objects.
 * Only enabled entries with valid API keys are included.
 */
export function getOrderedFallbackProviders(excludeProviderIdOrIds?: string | string[]): Array<{
  provider: any;
  model: string;
  overrides: { temperature?: number; maxTokens?: number; timeoutMs?: number; topP?: number };
}> {
  const state: any = useApp.getState();
  const allProviders: any[] = state?.providers || [];
  const chain = getFallbackChain();

  const excludeIds = typeof excludeProviderIdOrIds === "string"
    ? [excludeProviderIdOrIds]
    : (excludeProviderIdOrIds || []);

  const isProviderExcluded = (p: any) => {
    if (excludeIds.length === 0) return false;
    const pid = p.id || p.name || p.type;
    return (p.id && excludeIds.includes(p.id)) ||
           (p.name && excludeIds.includes(p.name)) ||
           (p.type && excludeIds.includes(p.type)) ||
           (pid && excludeIds.includes(pid));
  };

  // If chain is disabled or empty, fall back to legacy behavior (all active providers)
  if (!chain || !chain.entries || chain.entries.length === 0) {
    console.info("[AI] Fallback chain disabled or empty — using legacy provider order (all active providers)");
    const active = allProviders
      .filter((p) => p.isActive && p.type !== "puter" && p.type !== "local" && hasValidApiKey(p) && !isProviderExcluded(p));

    // Sort by reliability rank: paid/explicit > gemini > mistral > nvidia > openrouter > zencode > opencode > others
    const reliabilityRank: Record<string, number> = {
      gemini: 1,
      mistral: 2,
      nvidia: 3,
      openrouter: 4,
      zencode: 5,
      opencode: 6,
    };
    active.sort((a, b) => {
      const isFreeA = isOpenCodeZenFree(a);
      const isFreeB = isOpenCodeZenFree(b);
      if (isFreeA !== isFreeB) return isFreeA ? 1 : -1;
      const rankA = reliabilityRank[a.type] ?? 100;
      const rankB = reliabilityRank[b.type] ?? 100;
      return rankA - rankB;
    });

    return active.map((p) => ({ provider: p, model: p.modelName || "", overrides: {} }));
  }

  // Use the user's configured chain order
  const result: Array<{ provider: any; model: string; overrides: any }> = [];
  for (const entry of chain.entries) {
    if (!entry.enabled) continue;
    if (isProviderExcluded({ id: entry.providerId })) continue; // don't retry the primary / excluded

    // 1. Exact provider ID match
    let provider = allProviders.find((p) => p.id === entry.providerId);

    // 2. Provider type match
    if (!provider) {
      const entryType = entry.providerId.replace(/^p_/, "").replace(/_/g, "-");
      provider = allProviders.find((p) =>
        p.type === entryType ||
        p.type === entry.providerId.replace(/^p_/, "")
      );
    }

    // 3. Provider name match
    if (!provider) {
      const cleanEntryId = entry.providerId.toLowerCase().replace(/^p_/, "").replace(/_/g, " ").replace(/-/g, " ");
      provider = allProviders.find((p) => {
        const pName = (p.name || "").toLowerCase();
        return pName.includes(cleanEntryId) || cleanEntryId.includes(pName);
      });
    }

    // 4. Enabled model matching
    if (!provider) {
      provider = allProviders.find((p) =>
        p.enabledModels?.includes(entry.model) || p.modelName === entry.model
      );
    }

    // 5. Provider aliases matching
    if (!provider) {
      const aliases = PROVIDER_ALIASES[entry.providerId] || [];
      for (const alias of aliases) {
        provider = allProviders.find((p) => p.id === alias);
        if (provider) break;

        const aliasType = alias.replace(/^p_/, "").replace(/_/g, "-");
        provider = allProviders.find((p) =>
          p.type === aliasType ||
          p.type === alias.replace(/^p_/, "") ||
          p.id?.includes(aliasType) ||
          (p.name && p.name.toLowerCase().includes(aliasType))
        );
        if (provider) break;
      }
    }

    if (!provider) {
      console.warn(`[AI] Fallback chain entry "${entry.id}": provider "${entry.providerId}" not found — skipping`);
      continue;
    }
    if (!provider.isActive) {
      console.info(`[AI] Fallback chain entry "${entry.id}": provider "${provider.name}" is inactive — skipping`);
      continue;
    }
    if (!hasValidApiKey(provider)) {
      console.info(`[AI] Fallback chain entry "${entry.id}": provider "${provider.name}" has no valid API key — skipping`);
      continue;
    }

    result.push({
      provider,
      model: entry.model || provider.modelName || "",
      overrides: {
        temperature: entry.temperature,
        maxTokens: entry.maxTokens,
        timeoutMs: entry.timeoutMs,
        topP: entry.topP,
      },
    });
  }

  // CRITICAL: If the fallback chain found NO providers (all IDs mismatched),
  // fall back to ALL active providers so the user still gets results.
  if (result.length === 0) {
    console.warn("[AI] Fallback chain found 0 active providers — falling back to ALL active providers");
    const active = allProviders
      .filter((p) => p.isActive && p.type !== "puter" && p.type !== "local" && hasValidApiKey(p) && !isProviderExcluded(p));

    const reliabilityRank: Record<string, number> = {
      gemini: 1,
      mistral: 2,
      nvidia: 3,
      "opencode-zen": 4,
      openrouter: 5,
      zencode: 6,
      opencode: 7,
    };
    active.sort((a, b) => {
      const isFreeA = isOpenCodeZenFree(a);
      const isFreeB = isOpenCodeZenFree(b);
      if (isFreeA !== isFreeB) return isFreeA ? 1 : -1;
      const rankA = reliabilityRank[a.type] ?? 100;
      const rankB = reliabilityRank[b.type] ?? 100;
      return rankA - rankB;
    });

    return active.map((p) => ({ provider: p, model: p.modelName || "", overrides: {} }));
  }

  console.info(`[AI] Fallback chain: ${result.length} active entries (from ${chain.entries.length} total)`);
  return result;
}

/**
 * Tier categories based on provider.priority (lower = better).
 * These match the D1 seed data:
 *   Tier 1: priority < 35   (Antigravity 10, OpenCode 20, ZenCode 30)
 *   Tier 2: priority 35-65  (Gemini 40, Nvidia 50, Groq 60)
 *   Tier 3: priority 66-200 (OpenRouter 70, Mistral 80)
 *   Tier 4: priority > 200  (Puter 999 — emergency only)
 */
const TIER_PRIORITY_MAX = [35, 65, 200, Infinity];

function getProviderTier(p: any): number {
  const pri = p.priority ?? 50;
  if (pri <= TIER_PRIORITY_MAX[0]) return 1;
  if (pri <= TIER_PRIORITY_MAX[1]) return 2;
  if (pri <= TIER_PRIORITY_MAX[2]) return 3;
  return 4;
}

/**
 * Common filter: active, non-emergency, healthy, with valid API key, not excluded.
 */
function isAvailableForSelection(p: any, excludeIds?: string[]): boolean {
  const pid = p.id || p.name || p.type;
  const excluded = excludeIds?.some((eid) =>
    pid === eid || p.id === eid || p.name === eid || p.type === eid
  );
  return (
    p.isActive &&
    p.type !== "local" &&
    !EMERGENCY_ONLY_PROVIDERS.has(p.id) &&
    !EMERGENCY_ONLY_PROVIDERS.has(p.type) &&
    !shouldSkipForOptimization(p.id) &&
    !shouldSkipForOptimization(p.type) &&
    hasValidApiKey(p) &&
    !excluded
  );
}

export async function selectProvider(excludeIds?: string[]): Promise<any> {
  const state: any = useApp.getState();
  const providers: any[] = state?.providers || [];
  const settings = state?.providerSettings || {};

  // Filter + sort by priority (lowest = highest priority)
  const available = providers
    .filter((p: any) => isAvailableForSelection(p, excludeIds))
    .sort((a: any, b: any) => (a.priority ?? 50) - (b.priority ?? 50));

  // 1. User-configured default (if available and tier-appropriate)
  if (available.length > 0) {
    const defaultId = settings.defaultProviderId;
    const defaultProv = defaultId ? available.find((p) => p.id === defaultId) : null;
    if (defaultProv) return defaultProv;
    return available[0]; // highest priority available
  }

  // No provider available — log diagnostics
  const activeProviders = providers.filter((p: any) => p.isActive && p.type !== "puter" && p.type !== "local");
  const withKeys = activeProviders.filter((p: any) => hasValidApiKey(p));
  console.warn(
    `[ROUTER] No AI provider available. ` +
    `Active providers: ${activeProviders.length}, ` +
    `With valid API keys: ${withKeys.length}, ` +
    `Excluded IDs: ${JSON.stringify(excludeIds || [])}`
  );

  // 3. Offline Engine
  return { id: "local-engine", name: "Local Engine (offline mode)", type: "local" };
}

/**
 * Agent-aware provider selection.
 * Assigns different tier providers based on the agent's role:
 *
 *   Agent type        | Tiers  | Purpose
 *   ------------------|--------|----------------------------------------------
 *   "optimizer"       | 1-2    | Main optimization — highest quality needed
 *   "supervisor"      | 2-3    | Validation — reasonable quality, cost-efficient
 *   "guardian"        | 2-3    | Secret scanning — fast, cost-efficient
 *   "assembler"       | 2-3    | Final formatting — decent output
 *   "emergency"       | 4      | Last resort — only Puter
 *
 * Falls back to selectProvider() if no tier-matching provider found.
 */
export async function selectProviderForAgent(
  agentType: "optimizer" | "supervisor" | "guardian" | "assembler" | "emergency",
  excludeIds?: string[]
): Promise<any> {
  // Emergency = only Tier 4 (Puter, etc.)
  if (agentType === "emergency") {
    const state: any = useApp.getState();
    const providers: any[] = state?.providers || [];
    const emergency = providers.find(
      (p: any) => EMERGENCY_ONLY_PROVIDERS.has(p.id) || EMERGENCY_ONLY_PROVIDERS.has(p.type)
    );
    if (emergency && isAvailableForSelection(emergency, excludeIds)) return emergency;
  }

  // Map agent type to max allowed tier
  const tierMax: Record<string, number> = {
    optimizer: 2,
    supervisor: 3,
    guardian: 3,
    assembler: 3,
  };
  const maxTier = tierMax[agentType] ?? 3;

  const state: any = useApp.getState();
  const providers: any[] = state?.providers || [];

  const eligible = providers
    .filter((p: any) => isAvailableForSelection(p, excludeIds) && getProviderTier(p) <= maxTier)
    .sort((a: any, b: any) => (a.priority ?? 50) - (b.priority ?? 50));

  if (eligible.length > 0) return eligible[0];

  // Fallback to general selection
  return selectProvider(excludeIds);
}

function assert(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// ============================================================================
// Puter.js helpers — user-initiated auth + status checks
// ============================================================================

/**
 * Check if Puter.js is loaded and the user is signed in.
 * Returns: { loaded, signedIn, user }
 *   - loaded: whether the Puter.js script has loaded (window.puter exists)
 *   - signedIn: whether the user is authenticated to Puter
 *   - user: the Puter user object if signed in, else null
 *
 * This is safe to call anytime — it does NOT open popups.
 */
export function getPuterStatus(): { loaded: boolean; signedIn: boolean; user: any | null } {
  if (typeof window === "undefined" || !window.puter) {
    return { loaded: false, signedIn: false, user: null };
  }
  try {
    let signedIn = false;
    if (window.puter.auth) {
      if (typeof window.puter.auth.isSignedIn === "function") {
        signedIn = !!window.puter.auth.isSignedIn();
      } else {
        // If isSignedIn isn't a function, assume not signed in
        signedIn = false;
      }
    }
    // We don't call getUser() here because it may throw if not signed in.
    // The UI can call getPuterUser() separately when needed.
    return { loaded: true, signedIn, user: null };
  } catch {
    return { loaded: true, signedIn: false, user: null };
  }
}

/**
 * Get the signed-in Puter user's info (email, username, etc.).
 * Returns null if not signed in or Puter isn't loaded.
 * Does NOT open a popup — only reads existing session.
 */
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

/**
 * Sign in to Puter — MUST be called from a user click handler.
 *
 * Per https://docs.puter.com/Auth/signIn/:
 *   "The puter.auth.signIn() function must be triggered by a user action (such
 *   as a click event) because it opens a popup window. Most browsers block
 *   popups that are not initiated by user interactions."
 *
 * So this function should only be called from an onClick handler in the UI.
 * Calling it from an async flow (like callAI) will likely be blocked by the
 * browser's popup blocker.
 *
 * Returns: { ok: boolean; user?: any; error?: string }
 */
export async function signInToPuter(): Promise<{ ok: boolean; user?: any; error?: string }> {
  if (typeof window === "undefined" || !window.puter?.auth) {
    return { ok: false, error: "Puter.js is not loaded. Please refresh the page." };
  }
  try {
    // signIn() opens a popup. Because this is called from a click handler,
    // the browser allows it.
    await window.puter.auth.signIn();
    const user = await window.puter.auth.getUser().catch(() => null);
    return { ok: true, user };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Puter sign-in was cancelled or failed." };
  }
}

/**
 * Sign out of Puter.
 */
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

/**
 * OPTIMIZER DIRECTIVE — InfoHAS Pro template (STRICT MASTER LAYOUT)
 *
 * This directive is the PERMANENT FORMATTING AUTHORITY for all generated resumes.
 * It is derived from the user's master layout reference and must NEVER be deviated from.
 *
 * PAGE FORMAT:
 *   - A4 (210 × 297 mm)
 *   - Exactly 1 page. NEVER generate a second page. assert(pdf.pages === 1).
 *
 * MARGINS (very compact):
 *   - Top: 0.25 inch (6.35mm)
 *   - Bottom: 0.25 inch (6.35mm)
 *   - Left: 0.35 inch (8.89mm)
 *   - Right: 0.35 inch (8.89mm)
 *
 * FONT:
 *   - Primary: Times New Roman
 *   - Fallback: Georgia, Cambria
 *   - Body: 10pt–11pt
 *   - Section titles: 12pt–13pt, Bold, UPPERCASE, DARK RED (#8B0000)
 *
 * HEADER (two-column):
 *   - Left column (70%): Name, headline, location|phone, email, DOB — all left-aligned, compact
 *   - Right column (30%): Passport-style photo, 3.0cm × 4.0cm (30×40mm), top-right
 *   - If NO photo: remove photo section entirely. Do NOT use placeholders.
 *
 * SECTION ORDER (mandatory, no exceptions):
 *   1. PROFESSIONAL SUMMARY — 4-6 lines, single paragraph, no bullets
 *   2. CORE COMPETENCIES & SKILLS — max 4 groups, bullet format
 *   3. PROFESSIONAL EXPERIENCE — largest section, 3-5 bullets per position
 *   4. EDUCATION — max 2-3 entries
 *   5. LANGUAGES — one line per language
 *
 * ATS RULES:
 *   - ALLOWED: bold text, bullet points, simple separators
 *   - NOT ALLOWED: tables, columns inside body, text boxes, graphics, charts, icons, progress bars
 *   - Photo ONLY permitted in header
 *
 * CONTENT COMPRESSION (if content exceeds one page):
 *   1. Compress summary
 *   2. Reduce bullet length
 *   3. Remove repetitive achievements
 *   4. Reduce spacing
 *   5. Reduce font size to minimum 10pt
 *   6. Merge similar skills
 *   NEVER create page two.
 */
export const OPTIMIZER_DIRECTIVE: string = `(engine-sourced — see buildStandardDirective())`;

/**


/**
 * Generate the optimizer directive from the stored config.
 *
 * This reads the `optimizerDirective` config from the Zustand store (which is
 * synced from D1) and generates a directive string with the exact values the
 * super admin configured. If the config has a `customDirectiveOverride` set,
 * that COMPLETELY REPLACES the generated directive.
 *
 * If the store isn't available (e.g. during SSR) or the config is missing,
 * falls back to the hardcoded OPTIMIZER_DIRECTIVE constant above.
 *
 * Usage in the Optimizer:
 *   const directive = getOptimizerDirective();
 *   const result = await callAI({ systemPrompt: directive, ... });
 */
export function getOptimizerDirective(): string {
  let customDirective: string | undefined;

  try {
    const state: any = useApp.getState();
    const c: OptimizerDirectiveConfig | undefined = state?.optimizerDirective;

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
  // If true, prefer the local generator (no network). Used for offline mode.
  preferLocal?: boolean;
  // If true, force the server route.
  preferServer?: boolean;
  // Task category — controls which providers are eligible.
  // "document" = Resume/ATS/Cover Letter/Interview/PDF → API providers ONLY (never Puter)
  // "interactive" = Chat/Playground/Assistant → any provider (including Puter)
  // "development" = AI Dev Agent/Builder → any provider
  // If omitted, defaults to "document" (safest — API providers only).
  taskCategory?: "document" | "interactive" | "development";
  // If true, this is the resume optimizer call — validate the directive integrity.
  // Only the optimizer call should have this set; JI, Company, SkillGap, QA, Reflection
  // should NOT, because their prompts don't contain one-page compression directives.
  isOptimizerCall?: boolean;
  /**
   * Per-call timeout override in milliseconds. Defaults to AI_CALL_TIMEOUT_MS (60s).
   * The Resume / Aviation Optimizer call should pass OPTIMIZER_CALL_TIMEOUT_MS (120s)
   * because it ships a ~22k-char directive + 8k output tokens and legitimately
   * takes 70–110s on slower free-tier providers.
   */
  timeoutMs?: number;
  excludeProviderIds?: string[];
  enableRetries?: boolean;
  enableProviderSwitch?: boolean;
}

export interface AICallResult {
  text: string;
  provider: string;
  latencyMs: number;
  tokensEstimate: number;
  /** If true, this response came from the local offline engine, NOT a real AI provider.
   *  Callers should treat this as a degraded/fallback result and warn the user. */
  isLocalEngine?: boolean;
}

const estTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Race a promise against a timeout. Resolves with the promise result or rejects
 * with a timeout error. Used to prevent AI provider calls from hanging forever
 * (e.g. Puter sign-in popup that the user dismisses, or a slow provider endpoint).
 */


// ============================================================================
// Puter Cooldown — prevents retry storms after "No usage left" / quota errors
// ============================================================================
// When Puter hits its free-tier usage cap, it returns errors like:
//   "No usage left for request" / "usage_limit_exceeded" / "quota exceeded"
// If we keep retrying Puter on every subsequent callAI(), we burn through
// the same error path repeatedly — producing a "Failed to fetch" loop.
// Instead, once Puter fails with a quota error, we skip Puter entirely
// for the next 5 minutes. The user can still fall through to local generator.

/**
 * Robustly extract a JSON object from an LLM response.
 *
 * LLMs frequently return JSON wrapped in markdown fences, preceded by prose
 * ("Here is the optimized resume:"), or with trailing commentary. This helper
 * handles all those cases and ONLY throws if no JSON object can be found.
 *
 * Strategy (in order):
 *   1. Strip markdown fences ```json ... ``` or ``` ... ```.
 *   2. Try to parse the cleaned text directly.
 *   3. If that fails, find the first `{` and last `}` and try to parse the slice.
 *   4. If that fails, find the first `[` and last `]` and try to parse the slice.
 *   5. If all fail, throw an Error with a helpful message that includes the
 *      first 80 chars of the input so the caller can log it.
 *
 * This is the SINGLE source of truth for parsing AI JSON in the app.
 * Use it everywhere instead of `JSON.parse(text)` to prevent the
 * "Unexpected token 'S', 'Senior Fro'..." class of crashes.
 */
export function extractJSON<T = any>(raw: string): T {
  if (typeof raw !== "string") {
    throw new Error("extractJSON: input is not a string");
  }
  if (!raw.trim()) {
    throw new Error("extractJSON: input is empty");
  }

  // Step 1: strip markdown fences
  let cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  // Step 2: try direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through
  }

  // Step 3: extract balanced JSON object {...} using brace depth
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

  // Step 4: extract first [ ... last ]
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

  // Step 5: nothing worked — throw with a helpful preview
  const preview = cleaned.slice(0, 80).replace(/\n/g, " ");
  throw new Error(
    `AI did not return valid JSON. Response started with: "${preview}${cleaned.length > 80 ? "..." : ""}". ` +
    `This usually means the AI returned prose instead of structured data. ` +
    `Try again, or check that your default AI provider is correctly configured.`
  );
}

/**
 * Call a user-configured AI provider (from AI Providers settings).
 *
 * This is the FIRST priority in the callAI() chain — if the user has set a
 * default provider with a valid API key and base URL, we use it directly.
 * Supports OpenAI-compatible chat completions format (which covers OpenAI,
 * Claude via proxy, Gemini via proxy, DeepSeek, Groq, Mistral, OpenRouter,
 * Together, HuggingFace, Ollama, and custom OpenAI-compatible endpoints).
 *
 * Auth types:
 *   - "bearer": Authorization: Bearer <key>  (default, OpenAI-style)
 *   - "header": custom header from headersJson
 *   - "query":  ?key=<key> query param
 *   - "none":   no auth (e.g. local Ollama)
 *
 * Returns the extracted text from the response, or throws on error.
 */
async function callUserProvider(
  provider: any,
  opts: AICallOptions,
): Promise<string> {
  if (!provider) throw new Error("No provider");
  if (!provider.isActive) throw new Error(`Provider "${provider.name}" is inactive`);

  // === PUTER: use the browser SDK, NOT fetch() ===
  // Puter has NO REST API — it only works via window.puter.ai.chat().
  // If we try to fetch() https://api.puter.com/chat/completions, we get 404.
  if (provider.type === "puter" || provider.providerCategory === "browser_auth") {
    // Skip Puter entirely if it's in cooldown (user hit usage cap recently)
    if (isPuterInCooldown()) {
      throw new Error("Puter is in cooldown (usage cap recently hit). Skipping — try again in a few minutes or configure an API provider in Settings.");
    }
    if (typeof window === "undefined" || !window.puter?.ai?.chat) {
      throw new Error("Puter.js not loaded. Please refresh the page.");
    }
    // Ensure signed in (consistent with puter.ts adapter)
    try {
      if (window.puter.auth?.isSignedIn && !window.puter.auth.isSignedIn()) {
        await window.puter.auth.signIn();
      }
    } catch { /* anonymous OK for some endpoints */ }
    const messages = opts.systemPrompt
      ? [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ]
      : [{ role: "user", content: opts.userPrompt }];

    const chatOpts: any = {
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
    };
    if (provider.modelName) chatOpts.model = provider.modelName;

    try {
      const resp: any = await withTimeout(
        window.puter.ai.chat(messages, chatOpts),
        45000,
        "Puter AI chat",
      );

      let text = "";
      if (typeof resp === "string") {
        text = resp;
      } else if (resp?.message?.content) {
        text = Array.isArray(resp.message.content)
          ? resp.message.content.map((c: any) => c?.text ?? "").join("")
          : String(resp.message.content);
      } else if (resp?.text) {
        text = resp.text;
      } else if (resp?.toString && typeof resp.toString === "function") {
        const str = resp.toString();
        if (str && str !== "[object Object]") text = str;
      }
      if (!text) {
        try { text = JSON.stringify(resp); } catch { text = String(resp ?? ""); }
      }
      if (!text || !text.trim()) {
        throw new Error("Puter returned an empty response");
      }
      return text;
    } catch (e: any) {
      // If Puter returned a quota/usage-limit error, enter cooldown so we
      // don't keep retrying Puter on every subsequent callAI().
      if (isPuterQuotaError(e)) {
        markPuterCooldown();
        console.warn("[AI] Puter hit usage cap — entering 5-minute cooldown. Falling through to next provider.");
      }
      throw e;
    }
  }

  // === All other providers: use fetch() to their REST API ===
  // Route through the server-side CORS proxy when running in browser.
  // Direct browser-to-provider fetch fails for many providers (Nvidia, Anthropic, etc.)
  // that block browser-origin requests via CORS.
  const baseUrl = (provider.apiUrl || provider.baseUrl || "").trim();
  if (!baseUrl) throw new Error(`Provider "${provider.name}" has no base URL`);

  if (typeof window !== "undefined") {
    // Browser path: use server-side proxy to avoid CORS
    const authType = provider.authType || "bearer";
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
    messages.push({ role: "user", content: opts.userPrompt });

    // Check provider-level cooldown before making the request
    const providerCooldownId = provider.id || provider.name || provider.type;
    if (isProviderInCooldown(providerCooldownId)) {
      throw new Error(`Provider "${provider.name}" is in cooldown (previously rate-limited or auth-failed). Skipping.`);
    }

    // Determine the effective timeout for this call.
    // opts.timeoutMs is set by callAI for the Resume/Aviation Optimizer call
    // (OPTIMIZER_CALL_TIMEOUT_MS = 120s). Default to provider.timeout or 30s.
    const effectiveTimeoutMs = opts.timeoutMs && opts.timeoutMs > 0
      ? opts.timeoutMs
      : (provider.timeout ?? 30) * 1000;

    const ac = new AbortController();
    // Give the inner fetch a 5s buffer BEYOND the effective timeout so the
    // proxy's AbortController (which respects timeoutMs) fires first and
    // returns a proper timeout error — instead of the client fetch aborting
    // with a generic AbortError that doesn't trigger cooldown logic.
    const fetchTimeoutMs = Math.min(effectiveTimeoutMs + 5000, 185_000);
    const fetchTimer = setTimeout(() => ac.abort(), fetchTimeoutMs);
    let proxyRes: Response;
    try {
      proxyRes = await fetch("/api/providers/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          apiKey: provider.apiKey,
          authType,
          headersJson: provider.headersJson,
          model: provider.modelName || "gpt-4o-mini",
          messages,
          maxTokens: opts.maxTokens ?? provider.maxTokens ?? 4096,
          temperature: opts.temperature ?? provider.temperature ?? 0.7,
          responsePath: provider.responsePath,
          // Send BOTH for backward compat: timeout (seconds, old) + timeoutMs (ms, new).
          // The proxy prefers timeoutMs when present.
          timeout: Math.floor(effectiveTimeoutMs / 1000),
          timeoutMs: effectiveTimeoutMs,
        }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(fetchTimer);
    }

    const proxyData = await proxyRes.json();
    if (!proxyData.ok) {
      // The proxy returns `error` AND `message` (and `isTimeout` for aborts).
      // Use all three to construct a timeout-detectable error message.
      const errMsg = proxyData.error || proxyData.message || `Provider "${provider.name}" returned an error`;
      const err: any = new Error(errMsg);
      if (proxyData.isTimeout === true) {
        err.name = "AbortError"; // so isTimeoutError() detects it
      }
      throw err;
    }
    const text = (proxyData.text || "").trim();
    if (!text) {
      throw new Error(`Provider "${provider.name}" returned an empty response`);
    }
    return text;
  }

  // Build the chat-completions URL.
  const url = baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  // Build headers
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authType = provider.authType || "bearer";

  // === GOOGLE GEMINI API ===
  // Two endpoint types, different auth methods:
  //   1. OpenAI-compatible (/v1beta/openai/...): Authorization: Bearer
  //   2. Native API (/v1/models/...:generateContent): ?key= query param
  // The x-goog-api-key header works but can be stripped by some edge runtimes.
  const isGemini = provider.type === "gemini" || provider.type === "google" ||
    baseUrl.includes("generativelanguage.googleapis.com");
  const isGeminiOpenAI = isGemini && baseUrl.includes("/openai/");

  if (isGemini) {
    if (isGeminiOpenAI) {
      // OpenAI-compatible endpoint: use Bearer token
      if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }
    // Native endpoint: key appended as ?key= below — no auth header
  } else if (provider.apiKey && authType === "bearer") {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  } else if (provider.apiKey && authType === "header") {
    // Merge custom headers from headersJson
    try {
      const custom = provider.headersJson ? JSON.parse(provider.headersJson) : {};
      Object.assign(headers, custom);
    } catch {
      // ignore malformed headersJson
    }
  } else if (provider.apiKey && authType === "query") {
    // query param — append to URL (handled below)
  }
  // authType === "none" → no auth header

  // Build body — OpenAI chat completions format
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: opts.userPrompt });

  const body: Record<string, any> = {
    model: provider.modelName || "gpt-4o-mini",
    messages,
    max_tokens: opts.maxTokens ?? provider.maxTokens ?? 4096,
    temperature: opts.temperature ?? provider.temperature ?? 0.7,
    stream: false,
  };

  // Build final URL (with query param for native Gemini or authType === "query")
  let finalUrl = url;
  if (isGemini && !isGeminiOpenAI && provider.apiKey) {
    // Native Gemini endpoint: append ?key=API_KEY
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${sep}key=${encodeURIComponent(provider.apiKey)}`;
  } else if (authType === "query" && provider.apiKey) {
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${sep}key=${encodeURIComponent(provider.apiKey)}`;
  }

  // Fetch with sequential queue + rate-limit retry
  // For OpenCode Zen free models: maxConcurrent=1, backoff 1s/2s/4s, max 3 attempts
  const timeoutMs = provider.timeout && provider.timeout > 0 ? provider.timeout * 1000 : 30000;
  const queue = getRequestQueue(provider);
  const data = await queue.run(() =>
    withRateLimitRetry(
      async () => {
        const r = await withTimeout(
          fetch(finalUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          }),
          timeoutMs,
          `Provider "${provider.name}" call`,
        );

        if (!r.ok) {
          const errText = await r.text().catch(() => "");
          const error: any = new Error(
            `Provider "${provider.name}" returned HTTP ${r.status}: ${errText.slice(0, 200)}`,
          );
          error.statusCode = r.status;
          error.statusText = r.statusText;
          try {
            const parsed = JSON.parse(errText);
            if (parsed?.error?.type) {
              error.type = parsed.error.type;
              error.message += ` [${parsed.error.type}]`;
            } else if (errText.includes("FreeUsageLimitError")) {
              error.type = "FreeUsageLimitError";
            }
            if (parsed?.error?.code) error.statusCode = parsed.error.code;
          } catch {
            if (errText.includes("FreeUsageLimitError")) {
              error.type = "FreeUsageLimitError";
            }
          }
          throw error;
        }

        return r.json();
      },
      provider,
    ),
  );

  // Extract text from common response shapes:
  //   OpenAI-style:    data.choices[0].message.content
  //   Anthropic-style: data.content[0].text
  //   Gemini-style:    data.candidates[0].content.parts[0].text
  //   Custom:          use provider.responsePath
  let text = "";
  if (provider.responsePath) {
    // Walk the path — e.g. "choices[0].message.content"
    text = provider.responsePath
      .split(".")
      .reduce((acc: any, key: string) => {
        const m = key.match(/^([^\[]+)(?:\[(\d+)\])?$/);
        if (!m) return acc;
        const v = acc?.[m[1]];
        return m[2] !== undefined ? v?.[parseInt(m[2], 10)] : v;
      }, data) ?? "";
  } else if (data?.choices?.[0]?.message?.content) {
    text = data.choices[0].message.content;
  } else if (Array.isArray(data?.content) && data.content[0]?.text) {
    text = data.content[0].text;
  } else if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    text = data.candidates[0].content.parts[0].text;
  } else if (typeof data?.text === "string") {
    text = data.text;
  } else if (typeof data?.content === "string") {
    text = data.content;
  } else {
    // Last resort — stringify and hope for the best
    text = JSON.stringify(data);
  }

  if (typeof text !== "string") text = String(text ?? "");
  if (!text.trim()) {
    throw new Error(`Provider "${provider.name}" returned an empty response`);
  }
  return text;
}

/**
 * Main AI entrypoint. Tries user-default-provider → Puter → server (z-ai) → local fallback.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const t0 = performance.now();
  const taskCategory = opts.taskCategory || "document";

  // Per-call timeout — defaults to AI_CALL_TIMEOUT_MS (60s), but the
  // Resume / Aviation Optimizer call passes OPTIMIZER_CALL_TIMEOUT_MS (120s)
  // because it ships a ~22k-char directive + 8k output tokens.
  const callTimeoutMs = opts.timeoutMs && opts.timeoutMs > 0
    ? Math.min(opts.timeoutMs, 180_000) // hard cap at 3 min to protect pipeline budget
    : AI_CALL_TIMEOUT_MS;

  // Check token limits and truncate userPrompt if needed
  let finalOpts = { ...opts };
  const systemText = opts.systemPrompt ?? "";
  const userText = opts.userPrompt ?? "";
  const totalTokens = estTokens(systemText + userText);
  const maxTokens = MAX_INPUT_TOKENS;
  if (totalTokens > maxTokens) {
    const systemTokens = estTokens(systemText);
    const userBudget = Math.max(0, maxTokens - systemTokens);
    finalOpts.userPrompt = truncatePromptToTokenLimit(opts.userPrompt, userBudget);
  }

  // Helper to check if a provider is excluded
  const isExcluded = (pId: string) => {
    if (!opts.excludeProviderIds || opts.excludeProviderIds.length === 0) return false;
    return opts.excludeProviderIds.includes(pId);
  };

  // Select provider using selectProvider()
  const provider = await selectProvider(opts.excludeProviderIds);
  assert(provider !== null, "Provider is null");

  // Logging selected provider
  console.log(`[ROUTER]\nProvider selected: ${provider.name === "Puter.js" ? "Puter" : provider.name}`);
  if ((opts.isOptimizerCall || taskCategory === "document") && provider.type === "puter") {
    console.log("[ROUTER]\nIndustry ATS Mode using Puter.");
  }

  // Execute the selected provider
  if (provider.type === "local") {
    // If all real providers are unavailable, fall back to the local engine
    // for a best-effort output rather than completely failing the user.
    const text = localGenerate(finalOpts);
    assert(text !== "", "Provider response is empty");
    if (text === "" || text == null || text.length === 0) {
      throw new ProviderReturnedEmptyResponse("The AI provider returned an empty response.\nPlease retry or switch providers.");
    }
    return {
      text,
      provider: "Local Engine (offline mode)",
      latencyMs: Math.round(performance.now() - t0),
      tokensEstimate: estTokens(finalOpts.userPrompt),
      isLocalEngine: true,
    };
  }

  if (provider.type === "puter") {
    const { getPuterProvider } = await import("./providers/puter-provider");
    const puterProvider = getPuterProvider();
    try {
      const resp = await withTimeout(
        puterProvider.generate({
          systemPrompt: finalOpts.systemPrompt,
          userPrompt: finalOpts.userPrompt,
          maxTokens: finalOpts.maxTokens,
          temperature: finalOpts.temperature,
          model: provider.modelName,
        }),
        callTimeoutMs,
        "Puter.generate"
      );

      const text = resp.text;
      assert(text !== "", "Provider response is empty");
      if (!text || text.length === 0) {
        throw new ProviderReturnedEmptyResponse();
      }

      return {
        text,
        provider: "Puter.js",
        latencyMs: Math.round(performance.now() - t0),
        tokensEstimate: estTokens(finalOpts.userPrompt + (finalOpts.systemPrompt ?? "")),
      };
    } catch (e: any) {
      // Puter failed — try fallback providers using the USER-CONFIGURED fallback chain
      console.warn(`[AI] Puter failed: ${e?.message || e}. Trying fallback chain...`);
      const providerErrors: string[] = [`Puter: ${e?.message || e}`];
      const fallbackChain = getOrderedFallbackProviders(opts.excludeProviderIds); // respects user's configured order

      for (const { provider: fallbackProvider, model: fbModel, overrides: fbOverrides } of fallbackChain) {
        const fbCooldownId = fallbackProvider.id || fallbackProvider.name || fallbackProvider.type;
        if (isProviderInCooldown(fbCooldownId) || isExcluded(fbCooldownId)) {
          console.info(`[AI] Skipping ${fallbackProvider.name} — in cooldown or excluded.`);
          providerErrors.push(`${fallbackProvider.name}: in cooldown or excluded`);
          continue;
        }
        console.log(`[ROUTER]\nProvider selected: ${fallbackProvider.name} (model: ${fbModel || fallbackProvider.modelName || "default"})`);
        try {
          // Apply chain overrides (model, temperature, maxTokens, timeout)
          const chainOpts = {
            ...finalOpts,
            ...(fbModel ? {} : {}), // model is passed via provider override below
            ...(fbOverrides.temperature !== undefined ? { temperature: fbOverrides.temperature } : {}),
            ...(fbOverrides.maxTokens !== undefined ? { maxTokens: fbOverrides.maxTokens } : {}),
          };
          const chainTimeoutMs = fbOverrides.timeoutMs || callTimeoutMs;
          // Override the provider's model for this call
          const providerWithModel = fbModel ? { ...fallbackProvider, modelName: fbModel } : fallbackProvider;
          const text = await withTimeout(
            callUserProvider(providerWithModel, chainOpts),
            chainTimeoutMs,
            `${fallbackProvider.name}.generate`
          );
          assert(text !== "", "Provider response is empty");
          if (!text || text.length === 0) throw new ProviderReturnedEmptyResponse();
          return {
            text,
            provider: fallbackProvider.name,
            latencyMs: Math.round(performance.now() - t0),
            tokensEstimate: estTokens(finalOpts.userPrompt + (finalOpts.systemPrompt ?? "")),
          };
        } catch (secErr: any) {
          const secErrMsg = secErr?.message || String(secErr);
          // Mark provider cooldowns on terminal errors
          if (secErr?.statusCode === 429 || /429/.test(secErrMsg) || /rate.?limit/i.test(secErrMsg) || /FreeUsageLimitError/i.test(secErrMsg)) {
            markProvider429Cooldown(fbCooldownId);
          } else if (secErr?.statusCode === 401 || /401/.test(secErrMsg) || /billing/i.test(secErrMsg) || /payment/i.test(secErrMsg) || /CreditsError/i.test(secErrMsg)) {
            markProvider401Cooldown(fbCooldownId);
          } else if (isTimeoutError(secErr)) {
            markProviderTimeoutCooldown(fbCooldownId);
          }
          providerErrors.push(`${fallbackProvider.name}: ${secErrMsg}`);
          console.warn(`[AI] Secondary provider ${fallbackProvider.name} failed: ${secErrMsg}`);
        }
      }

      // All providers exhausted — fall back to local engine for best-effort output.
      // (Inline equivalent of the non-Puter branch's localGenerate fallback.
      //  Previously called fallbackToLocalEngine() which was never defined —
      //  this fixes that latent ReferenceError.)
      console.warn("[AI] Puter + all secondary providers failed. Falling back to local engine.");
      const localText = localGenerate(finalOpts);
      if (localText) {
        return {
          text: localText,
          provider: "Local Engine (fallback)",
          latencyMs: Math.round(performance.now() - t0),
          tokensEstimate: estTokens(finalOpts.userPrompt + (finalOpts.systemPrompt ?? "")),
          isLocalEngine: true,
        };
      }
      throw new OptimizationProviderExhaustedError(
        `All AI providers failed for this request.\n${providerErrors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`
      );
    }
  }

  // Secondary/API Provider — wrap in timeout
  const providerErrors: string[] = [];
  const primaryCooldownId = provider.id || provider.name || provider.type;

  // Try primary provider only if not in cooldown and not excluded
  if (!isProviderInCooldown(primaryCooldownId) && !isExcluded(primaryCooldownId)) {
    try {
      const text = await withTimeout(
        callUserProvider(provider, finalOpts),
        callTimeoutMs,
        `${provider.name}.generate`
      );
      assert(text !== "", "Provider response is empty");
      if (!text || text.length === 0) throw new ProviderReturnedEmptyResponse();
      circuitBreakerSuccess(primaryCooldownId, Math.round(performance.now() - t0));
      return {
        text,
        provider: provider.name,
        latencyMs: Math.round(performance.now() - t0),
        tokensEstimate: estTokens(finalOpts.userPrompt + (finalOpts.systemPrompt ?? "")),
      };
    } catch (e: any) {
      const eMsg = e?.message || String(e);
      if (e?.statusCode === 429 || /429/.test(eMsg) || /rate.?limit/i.test(eMsg) || /FreeUsageLimitError/i.test(eMsg)) {
        circuitBreakerFailure(primaryCooldownId, "rate_limit");
        console.log("[PROVIDER]\nPrimary provider returned 429.");
        
        // Try alternate API keys before marking as rate-limited
        const alternateKeys = (provider as any).alternateApiKeys as string[] | undefined;
        if (alternateKeys && alternateKeys.length > 0) {
          let altSuccess = false;
          for (let ki = 0; ki < alternateKeys.length; ki++) {
            const altKey = alternateKeys[ki];
            if (!altKey || altKey.trim() === "") continue;
            console.log(`[PROVIDER] Trying alternate API key #${ki + 1} for ${provider.name}...`);
            try {
              const altProvider = { ...provider, apiKey: altKey };
              const text = await withTimeout(
                callUserProvider(altProvider, finalOpts),
                callTimeoutMs,
                `${provider.name}.generate (alt key #${ki + 1})`
              );
              assert(text !== "", "Provider response is empty");
              if (text && text.length > 0) {
                console.log(`[PROVIDER] Alternate key #${ki + 1} succeeded for ${provider.name}.`);
                altSuccess = true;
                return {
                  text,
                  provider: provider.name,
                  latencyMs: Math.round(performance.now() - t0),
                  tokensEstimate: estTokens(finalOpts.userPrompt + (finalOpts.systemPrompt ?? "")),
                };
              }
            } catch (altErr: any) {
              const altMsg = altErr?.message || String(altErr);
              if (altErr?.statusCode === 429 || /429/.test(altMsg) || /rate.?limit/i.test(altMsg)) {
                console.warn(`[PROVIDER] Alternate key #${ki + 1} also rate-limited for ${provider.name}.`);
              } else {
                console.warn(`[PROVIDER] Alternate key #${ki + 1} failed for ${provider.name}: ${altMsg}`);
              }
            }
          }
          if (!altSuccess) {
            console.warn(`[PROVIDER] All ${alternateKeys.length} alternate keys exhausted for ${provider.name}. Marking as rate-limited.`);
          }
        }
        
        markProvider429Cooldown(primaryCooldownId);
      } else if (e?.statusCode === 401 || /401/.test(eMsg) || /billing/i.test(eMsg) || /payment/i.test(eMsg) || /CreditsError/i.test(eMsg)) {
        circuitBreakerFailure(primaryCooldownId, "auth");
        markProvider401Cooldown(primaryCooldownId);
      } else if (isTimeoutError(e)) {
        circuitBreakerFailure(primaryCooldownId, "timeout");
        markProviderTimeoutCooldown(primaryCooldownId);
      } else {
        circuitBreakerFailure(primaryCooldownId, "network");
      }
      providerErrors.push(`${provider.name}: ${eMsg}`);
      console.warn(`[AI] Primary provider ${provider.name} failed: ${eMsg}. Trying fallbacks...`);
    }
  } else {
    console.warn(`[AI] Primary provider ${provider.name} is in cooldown — skipping to fallbacks.`);
    providerErrors.push(`${provider.name}: in cooldown (rate-limited or auth-failed)`);
  }

  // === FALLBACK LOGIC: Try secondary providers, then local engine ===
  //
  // BUDGET GUARD: If the primary already consumed its full callTimeout budget,
  // skip ALL secondary fallback providers and jump directly to local engine.
  // This prevents the pipeline from burning 300s+ on fallback attempts that
  // are unlikely to succeed when the primary also timed out.
  const elapsedMs = Math.round(performance.now() - t0);
  const budgetExhausted = elapsedMs >= callTimeoutMs;

  if (budgetExhausted) {
    console.warn(`[AI] Budget exhausted (${elapsedMs}ms ≥ ${callTimeoutMs}ms call timeout). Skipping secondary providers → local engine.`);
    const localText = localGenerate(finalOpts);
    if (localText) {
      return {
        text: localText,
        provider: "Local Engine (fallback)",
        latencyMs: elapsedMs,
        tokensEstimate: estTokens(finalOpts.userPrompt + (finalOpts.systemPrompt ?? "")),
        isLocalEngine: true,
      };
    }
    throw new OptimizationProviderExhaustedError(
      `All AI providers failed for this optimization request.\n${providerErrors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`
    );
  }

  const state = useApp.getState();
  const allProviders = state.providers || [];
  const puter = allProviders.find((p: any) => p.type === "puter" && p.isActive);
  let puterAuthenticated = false;
  if (puter) {
    try {
      const { getPuterProvider } = await import("./providers/puter-provider");
      const puterProvider = getPuterProvider();
      puterAuthenticated = await puterProvider.tryRefresh();
    } catch {
      puterAuthenticated = false;
    }
  }

  // === FIRST: Try secondary providers from user's configured fallback chain ===
  // This runs BEFORE Puter to avoid hitting Puter's rate limits when a working
  // API provider exists in the chain.
  const excludeChainIds = [provider.id, ...(opts.excludeProviderIds || [])];
  const otherSecondary = getOrderedFallbackProviders(excludeChainIds);
  for (const { provider: altProvider, model: altModel, overrides: altOverrides } of otherSecondary) {
    const altCooldownId = altProvider.id || altProvider.name || altProvider.type;
    if (isProviderInCooldown(altCooldownId) || isExcluded(altCooldownId)) {
      console.info(`[AI] Skipping ${altProvider.name} — in cooldown or excluded.`);
      providerErrors.push(`${altProvider.name}: in cooldown or excluded`);
      continue;
    }
    console.log(`[ROUTER]\nProvider selected: ${altProvider.name} (model: ${altModel || altProvider.modelName || "default"})`);
    try {
      // Apply chain overrides (model, temperature, maxTokens, timeout)
      const chainOpts = {
        ...finalOpts,
        ...(altOverrides.temperature !== undefined ? { temperature: altOverrides.temperature } : {}),
        ...(altOverrides.maxTokens !== undefined ? { maxTokens: altOverrides.maxTokens } : {}),
      };
      const chainTimeoutMs = altOverrides.timeoutMs || callTimeoutMs;
      const providerWithModel = altModel ? { ...altProvider, modelName: altModel } : altProvider;
      const text = await withTimeout(
        callUserProvider(providerWithModel, chainOpts),
        chainTimeoutMs,
        `${altProvider.name}.generate`
      );
      assert(text !== "", "Provider response is empty");
      if (!text || text.length === 0) throw new ProviderReturnedEmptyResponse();
      return {
        text,
        provider: altProvider.name,
        latencyMs: Math.round(performance.now() - t0),
        tokensEstimate: estTokens(finalOpts.userPrompt + (finalOpts.systemPrompt ?? "")),
      };
    } catch (altErr: any) {
      const altErrMsg = altErr?.message || String(altErr);
      if (altErr?.statusCode === 429 || /429/.test(altErrMsg) || /rate.?limit/i.test(altErrMsg) || /FreeUsageLimitError/i.test(altErrMsg)) {
        markProvider429Cooldown(altCooldownId);
      } else if (altErr?.statusCode === 401 || /401/.test(altErrMsg) || /billing/i.test(altErrMsg) || /payment/i.test(altErrMsg) || /CreditsError/i.test(altErrMsg)) {
        markProvider401Cooldown(altCooldownId);
      } else if (isTimeoutError(altErr)) {
        markProviderTimeoutCooldown(altCooldownId);
      }
      providerErrors.push(`${altProvider.name}: ${altErrMsg}`);
      console.warn(`[AI] Alternate provider ${altProvider.name} failed: ${altErrMsg}`);
    }
  }

  // === ALL API PROVIDERS EXHAUSTED — fall back to local engine ===
  console.warn("[AI] All API providers failed. Falling back to local engine.");
  const localText = localGenerate(finalOpts);
  if (localText) {
    return {
      text: localText,
      provider: "Local Engine (fallback)",
      latencyMs: Math.round(performance.now() - t0),
      tokensEstimate: estTokens(finalOpts.userPrompt + (finalOpts.systemPrompt ?? "")),
      isLocalEngine: true,
    };
  }
  throw new OptimizationProviderExhaustedError(
    `All AI providers failed for this optimization request.\n${providerErrors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`
  );
}

/**
 */
export async function callAIStreamed(opts: AICallOptions, onChunk: (chunk: string) => void): Promise<AICallResult> {
  const t0 = performance.now();

  // === Try real streaming via Puter.js first (if available) ===
  // Per https://docs.puter.com/AI/chat/ — stream: true returns an async iterable
  // of chunks: { type: 'text', text: '...' } | { type: 'error', message: '...' }
  if (!opts.preferServer && !opts.preferLocal && typeof window !== "undefined" && window.puter?.ai?.chat) {
    // Check if Puter is in cooldown
    if (!isPuterInCooldown()) {
      try {
        const messages = opts.systemPrompt
          ? [
              { role: "system", content: opts.systemPrompt },
              { role: "user", content: opts.userPrompt },
            ]
          : [{ role: "user", content: opts.userPrompt }];

        // Build options — only pass model if the user configured one
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
        } catch (e) { console.warn("[AI] Puter model lookup failed:", e); }

        const response: any = await withTimeout(
          window.puter.ai.chat(messages, chatOpts),
          60000, // 60s for streamed calls (longer because chunks arrive over time)
          "Puter AI chat (streamed)",
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
        // If Puter hit its usage cap, enter cooldown
        if (isPuterQuotaError(e)) {
          markPuterCooldown();
          console.warn("[AI Streamed] Puter usage cap hit — entering 5-minute cooldown. Falling through to non-streamed callAI.");
        } else if (!/auth|sign.?in|unauthor|401|403/i.test(msg)) {
          console.warn("[AI Streamed] Puter streaming failed, falling through to non-streamed callAI:", msg);
        }
        // Fall through to the non-streamed path below
      }
    }
  }

  // === Fallback: non-streamed callAI + simulated streaming ===
  const result = await callAI(opts);
  // Simulate streaming for snappier UX
  const words = result.text.split(/(\s+)/);
  for (let i = 0; i < words.length; i++) {
    onChunk(words[i]);
    // Speed up for long outputs
    if (i % 12 === 0) await new Promise((r) => setTimeout(r, 8));
  }
  return result;
}

/** Helper for React components to read providers from the store */
export function useAIProviders() {
  return useApp((s) => s.providers.filter((p) => p.isActive).sort((a, b) => a.priority - b.priority));
}

export function usePreferredProvider() {
  return useApp((s) =>
    s.providers.find((p) => p.isActive) ??
    null
  );
}
