// ============================================================================
// Provider Cooldown — Rate-limit and error cooldown management
//
// Extracted from ai.ts for modularity.
// Manages sessionStorage/localStorage-based cooldown timers for AI providers
// that have been rate-limited (429), authentication-failed (401), or timed out.
// ============================================================================

"use client";

export const PUTER_COOLDOWN_KEY = "resumeai-puter-cooldown-until";
export const PUTER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Per-provider cooldown — prevents retry-storms when all external providers
// return 429 (rate limit) or 401 (billing required).
// Stored in sessionStorage so it resets on page refresh but persists during
// the same optimization session.
// ============================================================================
export const PROVIDER_COOLDOWN_PREFIX = "resumeai-provider-cooldown-";
export const PROVIDER_429_COOLDOWN_MS = 3 * 60 * 1000;  // 3 minutes for rate limits
export const PROVIDER_401_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes for billing failures (don't retry billing issues)
// NOTE: PROVIDER_TIMEOUT_COOLDOWN_MS is imported from pipeline-watchdog.ts (90s)
import { PROVIDER_TIMEOUT_COOLDOWN_MS } from "./pipeline-watchdog";

/** Returns true if a named provider is in cooldown. */
export function isProviderInCooldown(providerId: string): boolean {
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
export function markProvider429Cooldown(providerId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = PROVIDER_COOLDOWN_PREFIX + providerId;
    window.sessionStorage?.setItem(key, String(Date.now() + PROVIDER_429_COOLDOWN_MS));
    console.warn(`[AI] Provider "${providerId}" is rate-limited — entering 3-minute cooldown.`);
  } catch { /* ignore */ }
}

/** Marks a provider as billing-failed (401) for PROVIDER_401_COOLDOWN_MS. */
export function markProvider401Cooldown(providerId: string): void {
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
export function markProviderTimeoutCooldown(providerId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = PROVIDER_COOLDOWN_PREFIX + providerId;
    window.sessionStorage?.setItem(key, String(Date.now() + PROVIDER_TIMEOUT_COOLDOWN_MS));
    console.warn(`[AI] Provider "${providerId}" timed out — skipping for ${PROVIDER_TIMEOUT_COOLDOWN_MS / 1000}s.`);
  } catch { /* ignore */ }
}

/** Returns true if the error looks like a timeout (AbortError or timeout message). */
export function isTimeoutError(err: any): boolean {
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
export function isPuterInCooldown(): boolean {
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
export function markPuterCooldown(): void {
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
export function isPuterQuotaError(err: any): boolean {
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
export function isFailedToFetchError(err: any): boolean {
  const msg = (err?.message || String(err || "")).toLowerCase();
  return (
    /failed to fetch/i.test(msg) ||
    /networkerror/i.test(msg) ||
    /load failed/i.test(msg) ||
    err?.name === "TypeError"
  );
}

