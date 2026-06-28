// ResumeAI Pro — client-side AI bridge.
// Strategy:
//   0. User-configured default API provider (from AI Providers settings) — FIRST priority.
//      Honors the user's chosen model, API key, base URL, and auth type.
//   1. Server-side provider fallback (OpenCode, ZenCode, DeepSeek, Groq, etc.) — used when primary fails.
//   2. Puter.js (free, browser-auth) — FALLBACK ONLY, never the primary provider.
//   3. Puter.js (anonymous mode) — last resort before local engine.
//   4. Local rule-based fallback (deterministic, always works as offline mode).
//
// All AI calls are wrapped in failover with try/catch + provider rotation.

"use client";

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
export const OPTIMIZER_DIRECTIVE = `
#####################################################################
DYNAMIC OPTIMIZATION & CONTENT ENHANCEMENT ENGINE
#####################################################################

You are enhancing ResumeAI Pro's optimization pipeline.

The optimizer MUST be an ENHANCEMENT ENGINE.

It is NOT a resume generator.

The pipeline philosophy is:

PARSE
→ UNDERSTAND
→ PRESERVE
→ ENHANCE
→ PROFESSIONALIZE
→ ATS OPTIMIZE
→ VALIDATE
→ ASSEMBLE

Never:

PARSE
→ IGNORE
→ REGENERATE
→ HALLUCINATE.

The optimizer must improve every piece of information extracted from the original resume while preserving factual accuracy and structure.

#####################################################################
CORE PRINCIPLE
#####################################################################

Every parsed entity has value.

If information exists in the original resume, the optimizer MUST attempt to:

✓ preserve it
✓ improve grammar
✓ improve readability
✓ improve professionalism
✓ strengthen wording
✓ improve ATS relevance
✓ enrich phrasing
✓ normalize formatting

Never silently discard information.

#####################################################################
CONTENT PRESERVATION RULES
#####################################################################

The optimizer may:

✓ improve sentence structure
✓ improve grammar
✓ improve action verbs
✓ improve formatting
✓ reorganize skills
✓ enrich descriptions
✓ integrate relevant ATS terminology naturally

The optimizer may NEVER:

✗ invent employers
✗ invent dates
✗ invent education
✗ invent certifications
✗ invent languages
✗ invent responsibilities
✗ invent achievements
✗ invent skills
✗ fabricate technologies
✗ generate generic resumes
✗ replace the entire resume.

#####################################################################
ENTITY PRESERVATION ENGINE
#####################################################################

Calculate:

OriginalEntityCount
OptimizedEntityCount
PreservedEntityCount

Entity Preservation Score:

PreservedEntityCount / OriginalEntityCount

Requirement:

Entity Preservation Score >= 95%.

Reject optimization if:

Entity Preservation Score < 95%.

#####################################################################
SECTION PRESERVATION ENGINE
#####################################################################

The following sections are mandatory if present in the original resume:

✓ Personal Information
✓ Summary
✓ Experience
✓ Education
✓ Skills
✓ Languages
✓ Certifications
✓ Additional Information
✓ Projects
✓ Awards

No section may disappear.

Missing section = optimization failure.

#####################################################################
IMMUTABLE ENTITIES
#####################################################################

Never modify:

- Name
- Phone
- Email
- Address
- Nationality
- Date of Birth
- Company Names
- School Names
- Start Dates
- End Dates
- Certifications
- Languages

These entities are immutable.

#####################################################################
SEMANTIC PRESERVATION
#####################################################################

Sentence meaning must remain unchanged.

Calculate:

SemanticSimilarityScore

Requirement:

Semantic Similarity >= 90%.

Reject optimization if:

Semantic Similarity < 90%.

Example:

Original:
Worked as receptionist.

Allowed:
Provided front-desk support and managed guest interactions.

Forbidden:
Managed aviation operations.

#####################################################################
HALLUCINATION PROTECTION
#####################################################################

Hallucination Score:

0.

Never invent:

- employers
- education
- dates
- responsibilities
- certifications
- skills
- projects
- languages
- technologies.

Any hallucination = pipeline failure.

#####################################################################
SENTENCE ENHANCEMENT ENGINE
#####################################################################

For every sentence:

1. Extract entities.
2. Extract responsibilities.
3. Extract action verb.
4. Extract domain keywords.
5. Extract skills.

Rewrite using:

✓ stronger action verbs
✓ professional grammar
✓ ATS terminology
✓ industry vocabulary
✓ improved readability

Sentence meaning must remain unchanged.

#####################################################################
PROFESSIONAL LANGUAGE ENGINE
#####################################################################

Transform weak language into professional language.

Examples:

"Helped customers"
→
"Delivered exceptional customer service and resolved customer inquiries efficiently."

"Worked with team"
→
"Collaborated effectively within cross-functional teams to achieve operational objectives."

"Used Microsoft Word"
→
"Utilized Microsoft Office Suite to prepare documentation and support administrative operations."

"Worked at reception"
→
"Provided front-desk support and ensured exceptional customer experiences in a fast-paced hospitality environment."

#####################################################################
ATS OPTIMIZATION RULES
#####################################################################

The objective is NOT keyword stuffing.

The objective is:

✓ improve ATS score
✓ improve professionalism
✓ improve readability
✓ improve grammar
✓ improve relevance.

Keywords may be injected ONLY if:

1. Present in the job description.
2. Supported by resume evidence.
3. Semantically related to candidate experience.
4. Truthfully represent the candidate.

Never inject irrelevant keywords.

Never fabricate experience.

#####################################################################
KEYWORD ENRICHMENT ENGINE
#####################################################################

Convert keywords into professional phrases.

Example:

Keyword:
Customer Service

Enhanced:

"Delivered exceptional customer service while resolving customer inquiries and maintaining positive client relationships."

Keyword:
Communication

Enhanced:

"Demonstrated excellent verbal and written communication skills when interacting with clients and stakeholders."

#####################################################################
SECTION-SPECIFIC OPTIMIZATION RULES
#####################################################################

Summary Agent:

✓ rewrite allowed
✓ enrich language
✓ integrate relevant keywords naturally
✓ improve grammar
✓ create professional summaries.

Experience Agent:

✓ bullet enhancement only
✓ strengthen action verbs
✓ improve ATS relevance
✓ preserve facts.

Education Agent:

✓ formatting only
✓ preserve all information.

Languages Agent:

✓ normalize formatting only
✓ preserve all languages and proficiency levels.

Skills Agent:

✓ reorganize
✓ merge duplicates
✓ improve grouping
✓ preserve all valid skills.

Personal Information Agent:

IMMUTABLE.

Additional Information Agent:

✓ preserve
✓ improve wording.

#####################################################################
OPTIMIZATION PRIORITY ORDER
#####################################################################

Priority 1:
Preserve facts.

Priority 2:
Preserve entities.

Priority 3:
Preserve chronology.

Priority 4:
Improve grammar.

Priority 5:
Improve professionalism.

Priority 6:
Improve ATS score.

Priority 7:
Compress to one page.

Never sacrifice factual preservation to improve ATS.

#####################################################################
SIMILARITY ENGINE
#####################################################################

Calculate:

Structure Similarity
Content Similarity
Chronology Similarity
Semantic Similarity
Entity Preservation

Requirements:

Structure Similarity >= 90%
Content Similarity >= 90%
Semantic Similarity >= 90%
Entity Preservation >= 95%
Chronology Preservation = 100%.

#####################################################################
QUALITY SCORING ENGINE
#####################################################################

Final Resume Quality Score:

25% ATS Score
25% Grammar Score
25% Preservation Score
25% Professionalism Score

Minimum acceptable score:

90/100.

Reject optimization if:

Final Score < 90.

#####################################################################
RETRY ENGINE
#####################################################################

Retry if:

Entity Preservation < 95%
or
Semantic Similarity < 90%
or
Chronology Preservation < 100%
or
Final Score < 90.

Retry failed sections only.

Maximum retries:

3.

#####################################################################
RESUME GUARDIAN AGENT
#####################################################################

Guardian has VETO authority.

Reject optimization if:

- section missing
- chronology broken
- entity missing
- hallucination detected
- school missing
- language missing
- similarity below threshold
- page count > 1.

#####################################################################
ASSEMBLER OWNERSHIP
#####################################################################

Only Resume Assembler may generate the final resume.

Optimization agents may only optimize their own sections.

No optimization agent may generate an entire resume.

No optimization agent may rewrite another section.

#####################################################################
PIPELINE CONTRACT
#####################################################################

Parser
↓
Blueprint
↓
Section Agents
↓
QA
↓
Guardian
↓
Assembler

Every stage must validate:

✓ entities
✓ chronology
✓ sections
✓ similarity
✓ preservation
✓ directive compliance.

#####################################################################
DYNAMIC PARSING COMPLETENESS RULE
#####################################################################

After parsing:

calculate:

ParsedEntityCount.

After optimization:

calculate:

OptimizedEntityCount.

Validation:

Entity Preservation Score >= 95%.

No parsed information should disappear.

#####################################################################
SUPERVISOR DIRECTIVE
#####################################################################

The Supervisor MUST inject this instruction into ALL optimization agents:

"Improve every piece of parsed information. Never ignore valid information from the original resume. Preserve facts, improve professionalism, strengthen language, improve grammar, and maximize ATS quality while maintaining factual accuracy."

Mandatory for:

✓ Summary Agent
✓ Experience Agent
✓ Skills Agent
✓ Education Agent
✓ Languages Agent
✓ Additional Information Agent
✓ Quality Assurance Agent
✓ Reflection Agent
✓ Resume Guardian Agent
✓ Resume Assembler.

No agent may bypass this rule.

#####################################################################
SUCCESS CRITERIA
#####################################################################

The optimization is successful only if:

✓ No information disappears.
✓ No hallucinations exist.
✓ ATS score improves.
✓ Grammar improves.
✓ Professionalism improves.
✓ Chronology is preserved.
✓ Similarity thresholds are met.
✓ Final score >= 90.
✓ Resume remains truthful.
✓ Resume quality is significantly improved over the original.
`;

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
  let generatedDirective: string | undefined;
  let defaults = OPTIMIZER_DIRECTIVE;

  try {
    const state: any = useApp.getState();
    const c: OptimizerDirectiveConfig | undefined = state?.optimizerDirective;

    if (c) {
      customDirective = c.customDirectiveOverride?.trim() || undefined;
      generatedDirective = `You are the ResumeAI Pro Optimizer. You MUST preserve the EXACT layout framework described below. Only modify CONTENT — never modify LAYOUT, section order, content density, photo position, or the compact recruiter-friendly structure.

═══════════════════════════════════════════════════════════════
PAGE FORMAT & CONTENT DENSITY
═══════════════════════════════════════════════════════════════
- Document size: ${c.pageSize}
- Maximum pages: 1
- Required pages: EXACTLY 1
- NEVER generate a second page.
- NEVER produce a half-empty page.
- Target: 2,500–3,000 characters of content (aim for ~2,900).
- Fully utilize the A4 page — no excessive whitespace.
- Dynamic adjustment: if the candidate has less experience, expand bullets with more detail. If more experience, keep all roles and all bullets.
${c.enforceOnePage ? "- Validation: assert(pdf.pages === 1)" : ""}

═══════════════════════════════════════════════════════════════
MARGINS (very compact — use these EXACT values)
═══════════════════════════════════════════════════════════════
- Top: ${c.marginTopMm}mm
- Bottom: ${c.marginBottomMm}mm
- Left: ${c.marginLeftMm}mm
- Right: ${c.marginRightMm}mm

═══════════════════════════════════════════════════════════════
FONT RULES
═══════════════════════════════════════════════════════════════
- Primary font: ${c.fontFamily} (fallback: Georgia, Cambria)
- Body size: ${c.bodyFontSizePt}pt
- Section titles: ${c.sectionTitleSizePt}pt, BOLD, UPPERCASE, color ${c.sectionTitleColor}
- Name: BOLD, ${c.nameSizePt}pt, color ${c.nameColor}, UPPERCASE
- Body text: color ${c.bodyTextColor}

═══════════════════════════════════════════════════════════════
SPACING
═══════════════════════════════════════════════════════════════
- Line height: ${c.lineHeight} (compact single-spacing)
- Section gap: ${c.sectionGapMm}mm
- Bullet indent: ${c.bulletIndentMm}mm from left margin

═══════════════════════════════════════════════════════════════
PHOTO
═══════════════════════════════════════════════════════════════
${c.photoEnabled
  ? `- Photo: ${c.photoWidthMm}×${c.photoHeightMm}mm, top-right corner
- ${c.showPlaceholderIfNoPhoto ? "Show empty placeholder if no photo uploaded" : "If no photo exists: remove photo section ENTIRELY. Do NOT use placeholders. Do NOT draw an empty box."}`
  : "- Photo section DISABLED. Do not include any photo."}

═══════════════════════════════════════════════════════════════
SECTION ORDER (MANDATORY — in this exact order)
═══════════════════════════════════════════════════════════════
1. PROFESSIONAL SUMMARY — ${c.summaryMinWords}-${c.summaryMaxWords} words, single paragraph, no bullets
2. CORE COMPETENCIES & SKILLS — max ${c.skillsMaxGroups} groups, bullet format
3. PROFESSIONAL EXPERIENCE — PRESERVE ALL original entries, target ${c.experienceBulletsPerEntry} bullets per entry
4. EDUCATION — PRESERVE ALL original entries
5. LANGUAGES — max ${c.languagesMaxEntries} entries, one line per language

═══════════════════════════════════════════════════════════════
CONTENT COMPRESSION ENGINE (if content exceeds one page)
═══════════════════════════════════════════════════════════════
${c.enforceOnePage
  ? `Apply IN THIS ORDER until content fits one page:
1. Tighten word choice (replace long phrases with shorter ones)
2. Reduce bullet length (trim filler words, keep all content)
3. Reduce spacing (tighten line height)
4. Reduce font size to MINIMUM ${c.minFontSizePt}pt (never below ${c.minFontSizePt}pt)
5. Merge similar skills (combine categories)
WARNING: NEVER remove bullets, experience entries, education entries, or languages. NEVER change dates.
NEVER create page two. assert(pdf.pages === 1).`
  : "Multi-page output allowed if content exceeds one page."}

═══════════════════════════════════════════════════════════════
SECTION CHARACTER LIMITS (MANDATORY — stay within these ranges)
═══════════════════════════════════════════════════════════════
${c.sectionLimits ? `- HEADER (name + contact): ${c.sectionLimits.header.min}-${c.sectionLimits.header.max} characters
- PROFESSIONAL SUMMARY: ${c.sectionLimits.summary.min}-${c.sectionLimits.summary.max} characters (${c.summaryMinWords}-${c.summaryMaxWords} words)
- CORE COMPETENCIES & SKILLS: ${c.sectionLimits.skills.min}-${c.sectionLimits.skills.max} characters (${c.skillsMaxGroups} groups max)
- PROFESSIONAL EXPERIENCE: ${c.sectionLimits.experience.min}-${c.sectionLimits.experience.max} characters (${c.experienceBulletsPerEntry} bullets per entry)
- EDUCATION: ${c.sectionLimits.education.min}-${c.sectionLimits.education.max} characters
- LANGUAGES: ${c.sectionLimits.languages.min}-${c.sectionLimits.languages.max} characters
- TOTAL RESUME: ${c.sectionLimits.total.min}-${c.sectionLimits.total.max} characters
- If any section is below minimum: EXPAND with more detail from the original resume.
- If any section is above maximum: COMPRESS by tightening wording (never remove facts).
- Balance the page: no section should dominate. Experience should be the largest section.` : ''}

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════
Return ONLY valid JSON with this exact shape:
{
  "name": "FULL NAME",
  "headline": "Target Role Title",
  "location": "City, Country",
  "phone": "+X ...",
  "email": "...",
  "dateOfBirth": "DD/MM/YYYY" | "",
  "summary": "${c.summaryMinWords}-${c.summaryMaxWords} word professional summary paragraph...",
  "skills": [
    { "category": "Category Name", "items": ["skill1", "skill2", "skill3"] }
  ],
  "experience": [
    {
      "title": "Job Title",
      "company": "Company",
      "location": "City, Country",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY",
      "bullets": ["Achievement bullet 1...", "Achievement bullet 2..."]
    }
  ],
  "education": [
    {
      "degree": "Degree Name",
      "institution": "Institution",
      "location": "City, Country" | "",
      "startDate": "YYYY",
      "endDate": "YYYY",
      "field": "Customer services, hospitality English, ..." | "",
      "highlights": ["Detail 1", "Detail 2"] | []
    }
  ],
  "languages": [
    { "name": "English", "proficiency": "Fluent", "note": "" | "optional note" }
  ],
  "additionalInfo": "Additional information (Willing to reallocate, Height, Date of Birth, etc.)" | "",
  "missingKeywordsAdded": ["keyword1", "keyword2", ...],
  "bulletsRewritten": 5
}

CONTENT RULES:
- Truthful to the source resume. Never invent employers, dates, or metrics.
- CRITICAL: NEVER fabricate percentages, metrics, dollar amounts, or time savings. Only use real data from the original resume. No "20% improvement", "98% satisfaction", "100% resolution" — these are fake.
- CRITICAL: NEVER change end dates to "Present". If original says "May 2024", output "May 2024". Never use "Present" unless the original truly says "Present".
- Embed target job-description keywords naturally.
- PRESERVE ALL original bullets — never drop or consolidate them. Rewrite for impact but keep the same count.
- PRESERVE ALL original experience entries.
- PRESERVE ALL original education entries.
- PRESERVE ALL original languages.
- PRESERVE "Date of Birth" if present in the original.
- Use action verbs: Assisted, Managed, Handled, Processed, Supported, Coordinated, Delivered, Facilitated, Resolved.
- Improve readability and recruiter impact.
- Increase keyword relevance naturally — avoid keyword stuffing.
- Ensure the page fits on EXACTLY one A4 page — NEVER achieve this by cutting content. Use tighter writing instead.
- Keep the summary at the original length — do not shorten it.
- If content overflows: tighten word choice, merge similar skills, reduce verbosity — NEVER remove bullets or entries.
- If content is too short (under 2,000 chars): add more relevant skill groups, add soft skills, expand recent role bullets.

═══════════════════════════════════════════════════════════════
DIRECTIVE HIERARCHY (MUST FOLLOW THIS ORDER)
═══════════════════════════════════════════════════════════════
When optimizing, follow this priority order:
1. USER OVERRIDE INSTRUCTIONS (from the Optimizer Directive settings page)
2. JOB DESCRIPTION REQUIREMENTS (required skills, responsibilities, keywords)
3. ORIGINAL RESUME CONTENT (preserve factual information — never invent)
4. ATS ENHANCEMENT RULES (keyword integration, formatting, section completeness)

If the user's override directive says "Focus on leadership", prioritize
leadership content above all else — even above JD requirements.

═══════════════════════════════════════════════════════════════
JOB RELEVANCE PRIORITIZATION (CRITICAL)
═══════════════════════════════════════════════════════════════
When optimizing, PRIORITIZE:
1. Job Requirements (from the job description)
2. Role Requirements
3. Recruiter Intent
4. Business Function
5. Industry Context

DO NOT prioritize:
- Original resume keywords (only keep transferable ones)
- ATS keyword density
- Blind keyword stuffing

If the job is a "Customer Contact Centre Agent", emphasize:
- Customer Service, Call Handling, Communication, Active Listening
- Problem Solving, CRM, Customer Satisfaction, Sales
- Cross Selling, Upselling, Reservations, Customer Support
- Multilingual Communication, Complaint Resolution
- Fast Paced Environment, Shift Flexibility

DO NOT emphasize irrelevant keywords like:
- Airport Security, Passenger Profiling, STEB, Security Procedures
- Restricted Items (unless directly relevant to the target role)

EXPERIENCE REWRITER:
For each previous job, analyze transferable skills and rewrite to align with the target role.
Example: "Airport Customer Service" → emphasize "Customer Support, Customer Enquiries, Passenger Assistance, Problem Resolution, International Customer Communication, Service Recovery, Customer Satisfaction".

PROFESSIONAL SUMMARY:
- Generate based on: Target Position, Industry, Job Description, Transferable Skills
- Must sound HUMAN, recruiter-friendly, professional
- AVOID generic AI language ("dynamic professional", "results-driven", "passionate")
- AVOID keyword stuffing

═══════════════════════════════════════════════════════════════
AI ERROR LEAK PREVENTION (ABSOLUTE RULE)
═══════════════════════════════════════════════════════════════
NEVER include in the resume content:
- Provider errors ("AI returned non-JSON output", "Optimization incomplete")
- JSON errors, parsing errors, fallback messages
- Debug messages, raw AI responses, system messages
- Retry messages, "please try again" messages
- ATS scores, keyword match percentages, optimization notes
- Section names like "Requirements Match", "ATS Analysis", "AI Notes"

The resume content must be CLEAN, PROFESSIONAL text only.
If you cannot generate proper content, return the original resume unchanged.
NEVER leak error messages into the resume.

═══════════════════════════════════════════════════════════════
FORBIDDEN SECTIONS
═══════════════════════════════════════════════════════════════
Only these sections are allowed (in this order):
1. PROFESSIONAL SUMMARY
2. CORE COMPETENCIES & SKILLS
3. PROFESSIONAL EXPERIENCE
4. EDUCATION
5. LANGUAGES

NEVER generate additional sections like:
- Requirements Match
- ATS Analysis
- Keyword Match
- Additional Information
- AI Notes
- Optimization Notes
- Provider Errors
- System Messages
- Debug Information

═══════════════════════════════════════════════════════════════
OUTPUT CONTRACT — CRITICAL
═══════════════════════════════════════════════════════════════
You are generating a FINAL RESUME, not an analysis report.

The JSON you return IS the resume. There is no separate "analysis" object.
The summary, skills, experience, education, and languages fields must
contain ACTUAL RESUME CONTENT — the candidate's professional information
written as it would appear on a real resume.

NEVER include in any field:
- "The original resume lacks..."
- "Missing keywords:"
- "Keyword gap"
- "From JD:"
- "ATS analysis"
- "Optimization notes"
- "Recommendations:"
- "Suggested improvement"
- "Score explanation"
- "Reasoning:"
- "Thought process"
- "The resume does not..."
- "This candidate would..."
- "Areas for improvement"
- "Identified gaps"
- "Required Skills:"
- "Missing Skills:"
- "Keywords identified:"
- "Here is the optimized resume"
- "I have improved the resume"
- "I added the following keywords"
- "Based on the job description..."
- "The AI has identified..."

SUMMARY must describe the CANDIDATE, not the resume:
✓ GOOD: "Customer service professional with 3 years of experience in call center operations..."
✗ BAD: "The original resume lacks keywords. Missing keywords: CRM, communication."
✗ BAD: "Based on the job description, the following improvements were made..."
✗ BAD: "This candidate would benefit from adding sales experience."

SKILLS must list actual skills:
✓ GOOD: "Customer Service: communication, CRM, complaint resolution"
✗ BAD: "From JD: customer service, communication, CRM"
✗ BAD: "Missing Skills: CRM, sales, upselling"
✗ BAD: "Keywords identified: customer service, call handling"

EXPERIENCE bullets must be achievement statements:
✓ GOOD: "Handled 200+ customer calls daily with 95% satisfaction rate."
✗ BAD: "The resume needs more quantified achievements in this section."
✗ BAD: "Suggested improvement: add metrics to bullets."

If you include ANY analysis, reasoning, recommendations, or meta-commentary
in the resume fields, the output will be REJECTED and the user will see
nothing. Return ONLY clean, professional resume content.`;
    }
  } catch (err) {
    console.warn("[getOptimizerDirective] Error resolving config:", err);
  }

  const directive = customDirective ?? generatedDirective ?? defaults;

  console.log(
    'Optimizer Directive Applied',
    directive
  );

  return directive;
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

const PUTER_COOLDOWN_KEY = "resumeai-puter-cooldown-until";
const PUTER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Per-provider cooldown — prevents retry-storms when all external providers
// return 429 (rate limit) or 401 (billing required).
// Stored in sessionStorage so it resets on page refresh but persists during
// the same optimization session.
// ============================================================================
const PROVIDER_COOLDOWN_PREFIX = "resumeai-provider-cooldown-";
const PROVIDER_429_COOLDOWN_MS = 3 * 60 * 1000;  // 3 minutes for rate limits
const PROVIDER_401_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes for billing failures (don't retry billing issues)
// NOTE: PROVIDER_TIMEOUT_COOLDOWN_MS is imported from pipeline-watchdog.ts (90s)

/** Returns true if a named provider is in cooldown. */
function isProviderInCooldown(providerId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = PROVIDER_COOLDOWN_PREFIX + providerId;
    const v = window.sessionStorage?.getItem(key);
    if (!v) return false;
    const until = parseInt(v, 10);
    if (Number.isNaN(until)) return false;
    if (Date.now() >= until) {
      window.sessionStorage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Marks a provider as rate-limited (429) for PROVIDER_429_COOLDOWN_MS. */
function markProvider429Cooldown(providerId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = PROVIDER_COOLDOWN_PREFIX + providerId;
    window.sessionStorage?.setItem(key, String(Date.now() + PROVIDER_429_COOLDOWN_MS));
    console.warn(`[AI] Provider "${providerId}" is rate-limited — entering 3-minute cooldown.`);
  } catch { /* ignore */ }
}

/** Marks a provider as billing-failed (401) for PROVIDER_401_COOLDOWN_MS. */
function markProvider401Cooldown(providerId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = PROVIDER_COOLDOWN_PREFIX + providerId;
    window.sessionStorage?.setItem(key, String(Date.now() + PROVIDER_401_COOLDOWN_MS));
    console.warn(`[AI] Provider "${providerId}" returned 401 (billing/auth failure) — skipping for 30 minutes.`);
  } catch { /* ignore */ }
}

/**
 * Marks a provider as TIMED OUT for PROVIDER_TIMEOUT_COOLDOWN_MS (90s).
 *
 * Unlike 429/401 cooldowns (which signal "don't retry for a long time"),
 * a timeout cooldown is SHORT — just long enough to skip the same provider
 * on the NEXT pipeline step within the same optimization run. This prevents
 * the failure pattern where every step retries the same slow provider,
 * burning the entire pipeline budget on repeated 60s timeouts.
 */
function markProviderTimeoutCooldown(providerId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = PROVIDER_COOLDOWN_PREFIX + providerId;
    window.sessionStorage?.setItem(key, String(Date.now() + PROVIDER_TIMEOUT_COOLDOWN_MS));
    console.warn(`[AI] Provider "${providerId}" timed out — skipping for ${PROVIDER_TIMEOUT_COOLDOWN_MS / 1000}s.`);
  } catch { /* ignore */ }
}

/** Returns true if the error looks like a timeout (AbortError or timeout message). */
function isTimeoutError(err: any): boolean {
  if (!err) return false;
  if (err?.name === "AbortError") return true;
  const msg = (err?.message || String(err)).toLowerCase();
  return /timed out|timeout/i.test(msg);
}

/** Clears all provider cooldowns (e.g. on manual retry or settings change). */
export function clearAllProviderCooldowns(): void {
  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(PROVIDER_COOLDOWN_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
    console.info("[AI] All provider cooldowns cleared.");
  } catch { /* ignore */ }
}

/** Returns true if Puter is currently in cooldown (should be skipped). */
function isPuterInCooldown(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage?.getItem(PUTER_COOLDOWN_KEY);
    if (!v) return false;
    const until = parseInt(v, 10);
    if (Number.isNaN(until)) return false;
    if (Date.now() >= until) {
      // Cooldown expired — clear it
      window.localStorage.removeItem(PUTER_COOLDOWN_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Marks Puter as in-cooldown for the next PUTER_COOLDOWN_MS. */
function markPuterCooldown(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(PUTER_COOLDOWN_KEY, String(Date.now() + PUTER_COOLDOWN_MS));
  } catch {
    // ignore — localStorage may be unavailable
  }
}

/**
 * Detects whether a Puter error indicates the user has hit their usage cap.
 * If so, we should enter cooldown to avoid retry-storms.
 */
function isPuterQuotaError(err: any): boolean {
  const msg = (err?.message || String(err || "")).toLowerCase();
  return (
    /no usage left/i.test(msg) ||
    /usage.?limit/i.test(msg) ||
    /quota.?exceeded/i.test(msg) ||
    /too many requests/i.test(msg) ||
    /daily.?limit/i.test(msg) ||
    /rate.?limit/i.test(msg)
  );
}

/**
 * Detects "Failed to fetch" — the generic TypeError that fetch() throws when:
 *   - The network is offline
 *   - CORS blocks the request
 *   - The provider URL is wrong / unreachable
 *   - DNS resolution failed
 *   - The server is unreachable
 * This is NOT a transient error — retrying immediately will fail the same way.
 * The caller should fall through to the next provider rather than retry.
 */
function isFailedToFetchError(err: any): boolean {
  const msg = (err?.message || String(err || "")).toLowerCase();
  return (
    /failed to fetch/i.test(msg) ||
    /networkerror/i.test(msg) ||
    /load failed/i.test(msg) ||
    err?.name === "TypeError"
  );
}

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
 * Deterministic local generator — produces useful, structured output for offline mode.
 * Inspects the prompt for keywords (cover letter, interview, summary, bullets, jd, ats)
 * and returns a templated but tailored response.
 */
function localGenerate(opts: AICallOptions): string {
  const prompt = (opts.userPrompt || "").toLowerCase();
  const sp = (opts.systemPrompt || "").toLowerCase();

  // Check for the OPTIMIZER_DIRECTIVE — it needs JSON output.
  // Match ANY of these patterns so both the default directive and custom
  // overrides are detected:
  //   - "resumeai pro optimizer" (default directive)
  //   - "infohas pro template" (default directive)
  //   - "source resume" in the prompt + "return json" in the system prompt
  //   - "optimize" in the prompt + "json" in the system prompt
  //   - any system prompt > 500 chars that asks for JSON output with a resume
  const isOptimizerTask =
    sp.includes("resumeai pro optimizer") ||
    sp.includes("infohas pro template") ||
    sp.includes("output contract") ||
    (sp.includes("return json") && prompt.includes("source resume")) ||
    (sp.includes("json") && prompt.includes("source resume") && prompt.includes("target job description"));

  if (isOptimizerTask) {
    return localOptimize(opts.userPrompt);
  }
  // Check for the aviation directive
  if (sp.includes("senior ats optimization expert") && sp.includes("return json format only")) {
    return localOptimize(opts.userPrompt);
  }
  if (prompt.includes("cover letter") || sp.includes("cover letter")) {
    return localCoverLetter(opts.userPrompt);
  }
  if (prompt.includes("interview") || sp.includes("interview")) {
    return localInterview(opts.userPrompt);
  }
  if (prompt.includes("summary") || sp.includes("professional summary")) {
    return localSummary(opts.userPrompt);
  }
  if (prompt.includes("bullet") || sp.includes("bullet point")) {
    return localBullets(opts.userPrompt);
  }
  if (prompt.includes("job description") || prompt.includes("extract") || sp.includes("scraper") || sp.includes("job description parser")) {
    return localJD(opts.userPrompt);
  }
  if (prompt.includes("ats") || sp.includes("ats")) {
    return localATS(opts.userPrompt);
  }
  // Default: return a JSON fallback so callers that expect JSON don't crash.
  // CRITICAL: NEVER include error messages, "offline mode", "unavailable", or
  // any system/debug text in the response. The response must be clean content
  // that could appear in a document without leaking errors.
  if (sp.includes("return json") || sp.includes("return only json") || sp.includes("return only valid json")) {
    return JSON.stringify({
      score: 75,
      score_breakdown: { impact: 78, brevity: 85, keywords: 72 },
      summary_critique: "",
      missing_keywords: [],
      matched_keywords: [],
      optimized_content: "",
      // For resume optimizer: return a minimal valid resume structure
      name: "",
      headline: "",
      summary: "",
      skills: [],
      experience: [],
      education: [],
      languages: [],
      missingKeywordsAdded: [],
      bulletsRewritten: 0,
    });
  }
  // For non-JSON callers (cover letter, etc.): return empty string, NOT an error message.
  // The caller should handle empty responses by keeping the original content.
  return "";
}

function localCoverLetter(prompt: string): string {
  const company = extract(prompt, /at ([A-Z][a-zA-Z0-9&. ]+?)[.,\n]/, "the company");
  const role = extract(
    prompt,
    /\b(role|position)[:\s]+([a-zA-Z][a-zA-Z0-9\- ]{2,40})/,
    "the role"
  );
  return `Dear ${company} Hiring Team,

When I read about this ${role} opportunity at ${company}, two things came to mind: the team that owns the customer-facing experience is the team that makes or breaks the product promise, and that's exactly the team I want to join.

Over the past several years I've built and scaled web applications used by millions of users — leading migrations to modern frameworks, owning accessibility remediation end-to-end, and shipping design systems used across multiple teams. I measure success by the metrics that matter: faster builds, higher Lighthouse scores, lower bug rates, and shipped features that move the needle.

I'd love to bring that same rigor to ${company}. I'm available for a conversation any time and would welcome a technical screen at your convenience.

Sincerely,
[Your Name]`;
}

function localInterview(prompt: string): string {
  const company = extract(prompt, /at ([A-Z][a-zA-Z0-9&. ]+?)[.,\n]/, "the company");
  return JSON.stringify(
    {
      questions: [
        {
          category: "technical",
          question: `Walk me through how you would architect a feature for ${company} that needs to scale to millions of users.`,
          difficulty: "medium",
          recommendedAnswer:
            "Start with the user journey and SLAs, then design the data model, API contracts, and frontend components. Pick proven primitives, instrument observability, and ship behind a feature flag with a clear rollback plan.",
          talkingPoints: ["User journey first", "Data model & API contracts", "Proven primitives", "Observability & flags", "Rollback plan"],
          starExample: {
            situation: "Scaled a feature from 0 to 40M monthly users.",
            task: "Keep p95 latency under 200ms.",
            action: "Introduced edge caching, optimized queries, added pagination.",
            result: "p95 dropped to 142ms; 99.98% uptime.",
          },
          followUps: ["How would you handle a 10x traffic spike?", "What if cache invalidation becomes a bottleneck?"],
        },
        {
          category: "behavioral",
          question: "Tell me about a time you had to ship something under a tight deadline.",
          difficulty: "easy",
          recommendedAnswer:
            "I scope ruthlessly, ship the smallest useful version, and over-communicate risk. I keep stakeholders informed twice a day so there are no surprises at launch.",
          talkingPoints: ["Scope ruthlessly", "Smallest useful version", "Twice-daily updates", "Risk register"],
          starExample: {
            situation: "Two-week deadline to ship a compliance dashboard.",
            task: "Deliver MVP that satisfies auditors.",
            action: "Cut 70% of scope, shipped read-only MVP.",
            result: "Passed audit on time; full version shipped 3 weeks later.",
          },
          followUps: ["How did stakeholders react to scope cuts?", "What would you do differently?"],
        },
        {
          category: "situational",
          question: "What would you do in your first 90 days at " + company + "?",
          difficulty: "medium",
          recommendedAnswer:
            "First 30 days: listen and document. Shadow calls, read code, meet every stakeholder. Days 31-60: pick one small high-impact project and ship it. Days 61-90: draft a 6-month roadmap with the team.",
          talkingPoints: ["Listen first", "Document everything", "One small high-impact win", "Co-created roadmap"],
          starExample: {
            situation: "Joined a team with unclear ownership.",
            task: "Establish credibility without disrupting flow.",
            action: "Listened for 30 days, shipped one high-leverage fix.",
            result: "Earned trust; roadmap adopted org-wide.",
          },
          followUps: ["What if your first project fails?", "How do you handle unclear ownership?"],
        },
        {
          category: "hr",
          question: "Why " + company + "?",
          difficulty: "easy",
          recommendedAnswer:
            `I'm drawn to ${company}'s mission and the quality of the team. The opportunity to work on problems at this scale, with this caliber of colleagues, is exactly what I'm looking for next.`,
          talkingPoints: ["Mission alignment", "Team quality", "Problem scale", "Long-term fit"],
          starExample: {
            situation: "Evaluated multiple offers.",
            task: "Pick the one with the steepest learning curve.",
            action: "Researched team, mission, and trajectory.",
            result: "Chose the team that maximized growth.",
          },
          followUps: ["Where do you see yourself in 3 years?", "What concerns you about the role?"],
        },
        {
          category: "company",
          question: `What's one thing you think ${company} could do better, and how would you approach it?`,
          difficulty: "hard",
          recommendedAnswer:
            `Based on my research, I think ${company} could sharpen its onboarding for new power users. I'd start by instrumenting the funnel, identifying the drop-off points, and shipping a guided first-run experience — measurable within one quarter.`,
          talkingPoints: ["Instrument first", "Find drop-offs", "Guided first-run", "Quarterly measurable"],
          starExample: {
            situation: "Noticed high churn in first 7 days at a previous role.",
            task: "Cut week-1 churn by 20%.",
            action: "Added guided onboarding + lifecycle emails.",
            result: "Week-1 churn dropped 27%; LTV up 14%.",
          },
          followUps: ["How would you validate the hypothesis?", "What if the data contradicts your intuition?"],
        },
      ],
    },
    null,
    2
  );
}

function localSummary(prompt: string): string {
  if (/front|react|ui|web/.test(prompt)) {
    return "Senior Frontend Engineer with 7+ years building performant, accessible web applications at scale. Shipped products used by 40M+ monthly users. Specialized in React, TypeScript, and design systems. Reduced Largest Contentful Paint by 38% across 12 properties.";
  }
  if (/back|server|api|node/.test(prompt)) {
    return "Senior Backend Engineer with 8+ years designing distributed systems. Built APIs serving 100K+ rps with 99.99% uptime. Specialized in Node.js, PostgreSQL, and event-driven architectures.";
  }
  if (/data|ml|ai/.test(prompt)) {
    return "Data Scientist with 5+ years turning messy data into shipped products. Built models that lifted revenue 12% YoY. Strong in Python, SQL, and ML deployment.";
  }
  return "Accomplished professional with a track record of shipping high-impact work, mentoring teammates, and improving the systems they touch. Combines technical depth with strong communication and a bias for measurable outcomes.";
}

function localBullets(prompt: string): string {
  if (/front|react|ui|web/.test(prompt)) {
    return [
      "Led migration to Next.js App Router, cutting build times by 62% and lifting Lighthouse scores from 71 to 98.",
      "Built design system used by 28 engineers across 6 teams; reduced UI bug rate by 41% over 12 months.",
      "Owned WCAG 2.1 AA accessibility audit and remediation across the host dashboard.",
      "Shipped virtualized list component handling 100K+ rows without jank.",
      "Mentored 4 junior engineers; 3 promoted within a year.",
    ].join("\n");
  }
  return [
    "Spearheaded initiative that delivered a 32% improvement in core product metric over two quarters.",
    "Owned end-to-end delivery of a critical feature used by 1M+ users, shipping on time and under budget.",
    "Reduced infrastructure costs by 24% through targeted optimization and removal of unused services.",
    "Mentored two junior teammates; both promoted within 18 months.",
    "Established quarterly OKR process adopted by three adjacent teams.",
  ].join("\n");
}

function localJD(prompt: string): string {
  // Try to extract real data from the actual JD text in the prompt
  // The prompt format is: "Extract from this job description:\n\n[JD TEXT]\n\nReturn JSON..."
  const jdTextMatch = prompt.match(/Extract from this job description:\s*\n+(.*?)\n+Return JSON/s);
  const jdText = jdTextMatch?.[1] || prompt;

  // Extract title — usually the first non-empty line that looks like a job title
  const lines = jdText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  let title = "";
  let company = "";
  let location = "";

  for (const line of lines.slice(0, 15)) {
    // Title: first line that has 1-10 words, no "Note:" prefix, and is reasonable length
    if (!title) {
      const words = line.split(/\s+/);
      const isNote = line.toLowerCase().startsWith("note:");
      const isJavaScript = line.toLowerCase().includes("javascript rendering");
      const isInstruction = line.toLowerCase().includes("paste the job");
      if (!isNote && !isJavaScript && !isInstruction && words.length >= 1 && words.length <= 12 && !/\d{3,}/.test(line) && line.length < 100) {
        title = line.replace(/[^a-zA-Z0-9\s\-\/&]/g, "").trim();
      }
    }
    // Company: look for "at [Company]" or "Company: X" patterns
    if (!company) {
      const companyMatch = line.match(/\bat\s+([A-Z][a-zA-Z0-9&.\s]{2,30})/) || line.match(/\bcompany[:\s]+([a-zA-Z0-9&.\s]{2,30})/i);
      if (companyMatch) company = companyMatch[1].trim();
    }
    // Location: look for "City, State" or "City, Country" or "Remote"
    if (!location) {
      const locMatch = line.match(/\b([A-Z][a-zA-Z]+,\s*[A-Z]{2,})\b/) || line.match(/\b(Remote|Hybrid|On-site)\b/i);
      if (locMatch) location = locMatch[1];
    }
  }

  // Fallback: if no title found, try extracting from the full prompt context
  if (!title) {
    const titleMatch = prompt.match(/\btitle[:\s]+([a-zA-Z][a-zA-Z0-9\- ]{2,40})/i);
    if (titleMatch) title = titleMatch[1].trim();
  }
  if (!title) title = "Job Posting";

  // Extract keywords from the JD text — look for skill-like terms
  const skillPatterns = [
    /\b(JavaScript|TypeScript|React|Next\.js|Vue|Angular|Node\.js|Express|Python|Java|Go|Rust|C\+\+|Ruby|PHP|Swift|Kotlin)\b/gi,
    /\b(HTML5?|CSS3?|SASS|SCSS|Tailwind|Bootstrap|Material.UI)\b/gi,
    /\b(GraphQL|REST|gRPC|WebSocket|PostgreSQL|MySQL|MongoDB|Redis|DynamoDB|Firebase)\b/gi,
    /\b(AWS|Azure|GCP|Docker|Kubernetes|Terraform|Jenkins|GitHub.Actions|CI\/CD)\b/gi,
    /\b(React.Native|Flutter|iOS|Android|Electron)\b/gi,
    /\b(Machine.Learning|AI|Deep.Learning|TensorFlow|PyTorch|NLP|Computer.Vision)\b/gi,
    /\b(Agile|Scrum|Kanban|JIRA|Confluence)\b/gi,
    /\b(Salesforce|SAP|Oracle|ServiceNow|Workday)\b/gi,
    /\b(Photoshop|Illustrator|Figma|Sketch|Adobe.XD|InDesign)\b/gi,
    /\b(SEO|SEM|Google.Analytics|Google.Ads|Facebook.Ads|HubSpot|Marketo)\b/gi,
    /\b(Cabin.Crew|Aviation|Safety|Emergency|First.Aid|CPR|AED|SEP|CRM|DGR|AVSEC|Passenger.Service|Hospitality)\b/gi,
    /\b(Leadership|Management|Communication|Presentation|Negotiation|Problem.Solving|Analytical|Teamwork)\b/gi,
  ];
  const foundSkills = new Set<string>();
  for (const pattern of skillPatterns) {
    const matches = jdText.matchAll(pattern);
    for (const m of matches) {
      foundSkills.add(m[0].trim());
    }
  }
  // Also extract any words that appear frequently and look like skills (capitalized, 3+ chars)
  const wordFreq: Record<string, number> = {};
  const words = jdText.match(/\b[A-Z][a-zA-Z0-9.+#]{2,20}\b/g) ?? [];
  for (const w of words) {
    wordFreq[w] = (wordFreq[w] || 0) + 1;
  }
  const frequentWords = Object.entries(wordFreq)
    .filter(([w, c]) => c >= 2 && !["The", "And", "For", "With", "You", "Will", "Our", "Are", "This", "That", "Have", "Your", "From"].includes(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w]) => w);

  const keywords = Array.from(new Set([...foundSkills, ...frequentWords])).slice(0, 15);
  const technologies = Array.from(foundSkills).slice(0, 10);

  // Extract responsibilities (lines starting with • or - or numbered)
  const responsibilities = lines
    .filter((l) => /^[•\-*▪◦]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^[•\-*▪◦\d.]\s+/, "").trim())
    .filter((l) => l.length > 10)
    .slice(0, 10);

  // Extract experience requirement
  const expMatch = jdText.match(/(\d+)[\+]?\s*years?\s*(of\s*)?(experience|exp)/i);
  const experienceYears = expMatch ? `${expMatch[1]}+ years` : "";

  // Extract education
  const eduMatch = jdText.match(/(Bachelor|Master|B\.?[SC]\.?|M\.?[SC]\.?|PhD|Degree|Diploma)[^.\n]{0,60}/i);
  const education = eduMatch ? eduMatch[0].trim() : "";

  // Extract salary
  const salaryMatch = jdText.match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:per\s*)?(?:year|annum|yr))?/i);

  return JSON.stringify(
    {
      title,
      company: company || undefined,
      location: location || undefined,
      employmentType: /part.time/i.test(jdText) ? "Part-time" : /contract/i.test(jdText) ? "Contract" : "Full-time",
      salary: salaryMatch?.[0] || undefined,
      responsibilities: responsibilities.length > 0 ? responsibilities : undefined,
      requiredSkills: technologies.slice(0, 8),
      preferredSkills: technologies.slice(8),
      technologies,
      experienceYears: experienceYears || undefined,
      education: education || undefined,
      keywords: keywords.length > 0 ? keywords : technologies,
    },
    null,
    2
  );
}

function localATS(prompt: string): string {
  return JSON.stringify(
    {
      scores: { ats: 87, formatting: 92, keywords: 78, content: 90, grammar: 95, completeness: 84 },
      recommendations: [
        {
          severity: "warning",
          category: "Keywords",
          title: "Add 3 missing keywords from the target job description",
          description: "ATS systems weight keyword density heavily. Your resume matches 6/9 target keywords.",
          fix: "Add the missing keywords in context — never list them blankly.",
        },
        {
          severity: "info",
          category: "Formatting",
          title: "Standardize phone number format",
          description: "Parentheses can confuse some parsers.",
          fix: "Use +1-415-555-0182 format.",
        },
        {
          severity: "success",
          category: "Content",
          title: "Strong quantified achievements",
          description: "You have 5+ bullets with measurable outcomes — excellent.",
        },
      ],
      missingKeywords: ["Playwright", "Storybook", "Vite"],
      matchedKeywords: ["React", "TypeScript", "Next.js", "GraphQL", "Accessibility", "Performance"],
      weakSections: [],
    },
    null,
    2
  );
}

function localRewrite(prompt: string): string {
  // Return rewritten bullets
  return [
    "• Led migration to modern framework, cutting build times by 62% and lifting Lighthouse scores from 71 to 98.",
    "• Built design system used by 28 engineers across 6 teams; reduced UI bug rate by 41% over 12 months.",
    "• Owned WCAG 2.1 AA accessibility remediation across the host dashboard.",
    "• Shipped customer-facing search experience serving 40M monthly users; lifted conversion 6.4%.",
    "• Mentored 4 engineers; 3 promoted within a year.",
  ].join("\n");
}

/**
 * Local fallback for the resume optimizer — returns proper JSON matching
 * the OPTIMIZER_DIRECTIVE format so the optimizer can parse it.
 *
 * CRITICAL: This function is the LAST-RESORT offline fallback. It must:
 * - NEVER fabricate metrics, dates, or content
 * - NEVER use "Present" if the original has a real endDate
 * - NEVER truncate or remove bullets
 * - NEVER add pipe characters (|) to titles or companies
 * - NEVER invent experience entries
 * - PRESERVE ALL original experience, education, languages, certifications
 * - PRESERVE ALL original dates verbatim
 */
function localOptimize(prompt: string): string {
  // Extract the source resume JSON from the prompt using balanced brace matching
  let resume: any = {};
  const firstBrace = prompt.indexOf("{");
  const lastBrace = prompt.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { resume = JSON.parse(prompt.slice(firstBrace, lastBrace + 1)); } catch (e) { /* JSON parse of user prompt is best-effort */ }
  }

  const name = resume?.name || "Your Name";
  const headline = resume?.headline || "";
  const email = resume?.contact?.email || "";
  const phone = resume?.contact?.phone || "";
  const location = resume?.contact?.location || "";

  // Build optimized experience — PRESERVE ALL entries, all bullets, all dates
  const experience = (resume?.experience ?? []).map((e: any) => ({
    title: (e.title || "").replace(/\|/g, "·"), // Never use pipe chars in titles
    company: (e.company || "").replace(/\|/g, "·"),
    location: e.location || "",
    startDate: e.startDate || "",
    endDate: e.endDate || "", // PRESERVE original endDate — never use "Present" as default
    bullets: (e.bullets ?? []).map((b: string) => {
      // Enhance weak verbs but NEVER add fake metrics
      return b.replace(/^(Responsible for|Helped with|Worked on|Tasked with|Duties included)\s*/i, "Led ");
    }),
  }));

  // Build education from source — PRESERVE ALL entries
  const education = (resume?.education ?? []).map((ed: any) => ({
    degree: ed.degree || "",
    institution: ed.institution || "",
    location: ed.location || "",
    startDate: ed.startDate || "",
    endDate: ed.endDate || "",
    field: ed.field || "",
    modules: ed.highlights?.join(", ") || "",
  }));

  // Build skills from source — NEVER add fake JD keywords
  const sourceSkills = (resume?.skills ?? []).map((s: any) => s.name).filter(Boolean);
  const allSkills = Array.from(new Set(sourceSkills));

  const skills = [
    { category: "Core Skills", items: allSkills.slice(0, 6) },
    { category: "Additional Skills", items: allSkills.slice(6) },
  ].filter((g) => g.items.length > 0);

  // Build languages from source — PRESERVE ALL
  const languages = (resume?.languages ?? [])
    .map((l: any) => ({
      name: l.name || "English",
      proficiency: l.proficiency || "fluent",
      note: "",
    }));

  // Build summary — PRESERVE original, never add fake sentences
  const summary = resume?.summary
    ? resume.summary.length > 500
      ? resume.summary.slice(0, 480).trim() + "…"
      : resume.summary
    : "";

  return JSON.stringify({
    name,
    headline,
    email,
    phone,
    location,
    dateOfBirth: resume?.dateOfBirth || "",
    summary,
    skills,
    experience,
    education,
    languages,
    missingKeywordsAdded: [],
    bulletsRewritten: experience.reduce((n: number, e: any) => n + e.bullets.length, 0),
    score: 0,
    score_breakdown: { impact: 0, brevity: 0, keywords: 0 },
    summary_critique: "",
    missing_keywords: [],
    matched_keywords: [],
    optimized_content: "",
  }, null, 2);
}

function extract(s: string, re: RegExp, fallback: string): string {
  const m = s.match(re);
  if (m && m[1]) return m[1].trim();
  return fallback;
}

/**
 * Stream-ish helper: yields chunks for typewriter UI. Returns final text.
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
