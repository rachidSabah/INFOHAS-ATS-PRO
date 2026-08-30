// ============================================================================
// ZEN FREE-MODEL REGISTRY — single source of truth for OpenCode Zen free
// models (types: opencode / opencode-zen / zencode, baseUrl
// https://opencode.ai/zen/v1).
//
// WHY THIS EXISTS (live evidence, 2026-08-30):
//   1. Free-model availability churns constantly — ids vanish from
//      /zen/v1/models and reappear (hy3-free is gone; big-pickle returned).
//      A stale static list makes the UI offer models the API no longer serves.
//   2. The free-usage limiter is keyed to the REQUESTER'S IP, not the API key
//      (FreeUsageLimitError fires keyless; upstream issue anomalyco/opencode
//      #33318) — and per-model upstream routes fail independently ("Model is
//      unavailable" / 503 on one sibling while another answers 200 from the
//      same IP). A fresh key or new account does NOT lift the limit.
//   3. Region locks exist per model (muse-spark-1.2-contributor-free → 403
//      RegionError) and some free models are only served on the /responses
//      endpoint family, not the OpenAI-compatible /chat/completions route the
//      app uses — so they must never be shipped as chat defaults.
//
// The preflight gate + router rotate through enabledModels siblings on
// quota/model errors; this registry keeps those lists honest and the default
// pointed at a model that was verified ANSWERING at verification time.
// ============================================================================

/** Date of the last live probe of https://opencode.ai/zen/v1 (UTC). */
export const ZEN_VERIFICATION_DATE = "2026-08-30";

/**
 * Model ids that no longer exist on /zen/v1/models (or consistently 401
 * "Model not supported"). Never ship these in enabledModels / defaults.
 */
export const ZEN_DEAD_MODEL_IDS: readonly string[] = [
  "hy3-free",
  "hy3-free-stealth",
  "north-mini-code-free",
  "minimax-m2.5-free",
  "nemotron-3-super-free",
  "qwen3-30b-a3b-free",
  "gemma-3-27b-free",
  "llama-4-maverick-free",
  "llama-4-scout-free",
];

/**
 * Models that answer only outside this app's route family (region-locked
 * and/or served exclusively on the /responses or /messages endpoint family,
 * not the OpenAI-compatible /chat/completions the app uses).
 */
export const ZEN_REGION_LOCKED_MODEL_IDS: readonly string[] = [
  "muse-spark-1.2-contributor-free",
];

/**
 * Free models verified ANSWERING (HTTP 200, real completion) at
 * ZEN_VERIFICATION_DATE, best-first. Models that are valid ids but currently
 * limited/unavailable from the probe network (big-pickle, mimo-v2.5-free,
 * deepseek-v4-flash-free, ling-3.0-flash-fin-free) stay usable via rotation —
 * they are NOT listed here because "verified working" means observed 200.
 */
export const ZEN_VERIFIED_WORKING_FREE_MODELS: readonly string[] = [
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "laguna-s-2.1-free",
];

/** The default free model — head of the verified-working list. */
export const ZEN_PREFERRED_DEFAULT = ZEN_VERIFIED_WORKING_FREE_MODELS[0];

const UNUSABLE_ZEN_IDS = new Set<string>([...ZEN_DEAD_MODEL_IDS, ...ZEN_REGION_LOCKED_MODEL_IDS]);

/**
 * Filter an enabledModels list for Zen: drop dead/region-locked ids, trim,
 * drop empties, dedupe, preserve order. Unknown ids pass through —
 * availability churns and the catalog must not silently swallow new models.
 */
export function sanitizeZenEnabledModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of models) {
    if (typeof m !== "string") continue;
    const id = m.trim();
    if (id === "" || UNUSABLE_ZEN_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Pick the default Zen model from an enabled list: first usable id
 * (dead/region-locked skipped), else the verified preferred default.
 */
export function pickZenDefaultModel(
  enabledModels: unknown,
  fallback: string = ZEN_PREFERRED_DEFAULT
): string {
  const usable = sanitizeZenEnabledModels(enabledModels);
  return usable[0] ?? fallback;
}
