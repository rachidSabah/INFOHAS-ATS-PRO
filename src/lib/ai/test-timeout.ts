// ============================================================================
// Reasoning-aware test-connection timeout — Task 24①.
//
// Live evidence (2026-08-30 audit): Zen reasoning-route free models answer in
// 8-33s (nemotron-3-ultra-free: 200 OK at 8.1s / 21s / 33s across probes),
// but every test-connection layer capped at 10-15s (adapter testConnection
// 10s, manager proxy body 15s, edge route 15s hard cap, direct client probe
// 10s). A VERIFIED-WORKING provider was therefore declared "down" whenever
// its default model happened to be a reasoning model — the "OpenCode Zen is
// down" false alarm.
//
// Contract: model names that indicate a reasoning/thinking route get the
// provider's own generous timeout (floored at 30s, capped at 60s); fast
// models keep the existing snappy caps exactly.
//
// Pure module — no imports — so it is safe to use from the Edge runtime
// route (src/app/api/providers/test) which cannot use "@/ " aliases.
// ============================================================================

/** Ceiling for reasoning-model test calls. */
export const REASONING_TEST_TIMEOUT_MS = 60000;

/** Floor for reasoning-model test calls — below 30s a reasoning route
 *  routinely false-times-out even when healthy (observed 8-33s). */
export const REASONING_MIN_TEST_TIMEOUT_MS = 30000;

/** Default cap for fast (non-reasoning) test calls — today's behavior. */
export const DEFAULT_FAST_TEST_TIMEOUT_MS = 15000;

/**
 * Tokens that indicate a reasoning/thinking model route. Matched against
 * non-alphanumeric-delimited tokens of the lowercased model id, so
 * "gpt-4o" ("4o") never matches "o1"/"o3"/"o4" and "3.5" stays inert.
 */
const REASONING_MODEL_TOKENS: ReadonlySet<string> = new Set([
  "ultra",
  "reasoning",
  "thinking",
  "think",
  "r1",
  "qwq",
  "o1",
  "o3",
  "o4",
]);

export function isReasoningModelName(modelName?: string | null): boolean {
  if (!modelName) return false;
  const tokens = modelName.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  return tokens.some((t) => REASONING_MODEL_TOKENS.has(t));
}

export interface ResolveTestTimeoutOpts {
  /** The provider's configured default model id (e.g. "nemotron-3-ultra-free"). */
  modelName?: string | null;
  /** The provider's configured timeout (provider.timeout), may be unset. */
  providerTimeoutMs?: number | null;
  /** Cap for fast models. Default 15000 (adapter/direct-probe sites pass 10000). */
  fastCapMs?: number;
  /** Ceiling for reasoning models. Default 60000. */
  reasoningCapMs?: number;
}

/**
 * Resolve the test-connection timeout for a provider/model pair.
 *
 * - Reasoning models: clamp(max(providerTimeout || 60000, 30000), ≤ cap) —
 *   the provider's generosity is honored, tiny timeouts are floored at 30s
 *   (a reasoning route cannot answer faster reliably), 60s ceiling.
 * - Fast models: min(providerTimeout || cap, cap) — identical to the
 *   pre-fix behavior at every call site.
 */
export function resolveTestTimeoutMs(opts: ResolveTestTimeoutOpts): number {
  const fastCap = opts.fastCapMs ?? DEFAULT_FAST_TEST_TIMEOUT_MS;
  const reasoningCap = opts.reasoningCapMs ?? REASONING_TEST_TIMEOUT_MS;
  const providerTimeout = typeof opts.providerTimeoutMs === "number" && opts.providerTimeoutMs > 0
    ? opts.providerTimeoutMs
    : null;

  if (isReasoningModelName(opts.modelName)) {
    const base = providerTimeout ?? REASONING_TEST_TIMEOUT_MS;
    return Math.min(Math.max(base, REASONING_MIN_TEST_TIMEOUT_MS), reasoningCap);
  }
  return Math.min(providerTimeout ?? fastCap, fastCap);
}
