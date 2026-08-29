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
export const PROVIDER_429_COOLDOWN_MS = 3 * 60 * 1000;  // 3 minutes for transient rate limits
export const PROVIDER_401_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes for billing failures (don't retry billing issues)
// NOTE: PROVIDER_TIMEOUT_COOLDOWN_MS is imported from pipeline-watchdog.ts (90s)
import { PROVIDER_TIMEOUT_COOLDOWN_MS } from "./pipeline-watchdog";
import { rateLimitTracker, RATE_LIMIT_BACKOFF_CAP_MS } from "./rate-limit-tracker";

// P1 — QUOTA-CLASS COOLDOWN. A 429 whose body says "FreeUsageLimitError /
// usage limit / quota" means the account/model quota is EXHAUSTED and resets
// on an hourly/daily window — it will NOT recover in 3 minutes. Parking such
// providers for the short window made the router re-attempt a quota-dead
// provider every 3 minutes all day (retry treadmill: wasted request + latency
// on the first call of each cycle). The cap is the SAME constant as the
// tracker's backoff cap, so both cooldown layers stay aligned.
export const PROVIDER_QUOTA_COOLDOWN_MS = RATE_LIMIT_BACKOFF_CAP_MS; // 30 minutes

/** Quota-exhaustion wording inside a 429 body (mirrors the healer's classifier). */
const QUOTA_EXHAUSTION_RE = /FreeUsageLimitError|usage.?limit|quota|daily|monthly/i;

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

/**
 * Marks a provider as rate-limited for an EXPLICIT duration (P1/P2).
 * Used when the provider tells us the class (quota) or the exact window
 * (Retry-After). Clamped to [5s, PROVIDER_QUOTA_COOLDOWN_MS].
 */
export function markProviderRateLimitCooldown(providerId: string, durationMs: number): void {
  if (typeof window === "undefined") return;
  const clamped = Math.min(Math.max(durationMs, 5_000), PROVIDER_QUOTA_COOLDOWN_MS);
  try {
    const key = PROVIDER_COOLDOWN_PREFIX + providerId;
    window.sessionStorage?.setItem(key, String(Date.now() + clamped));
    console.warn(`[AI] Provider "${providerId}" rate-limited — cooldown ${Math.round(clamped / 1000)}s.`);
  } catch { /* ignore */ }
}

/** Marks a provider as quota-exhausted for PROVIDER_QUOTA_COOLDOWN_MS (30 min). */
export function markProviderQuotaCooldown(providerId: string): void {
  markProviderRateLimitCooldown(providerId, PROVIDER_QUOTA_COOLDOWN_MS);
}

/**
 * Clears a provider's cooldown on SUCCESS evidence (P1 early-clear).
 * A successful call — real traffic or an honest probe — is strictly stronger
 * evidence than any timer, so a stale cooldown (e.g. a 30-min quota window
 * that outlived the actual quota reset) must not keep blocking the provider.
 */
export function clearProviderCooldownOnSuccess(providerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(PROVIDER_COOLDOWN_PREFIX + providerId);
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

// ============================================================================
// TRAFFIC-vs-PROBE cooldown authority (bug fix — "cooldown even though the
// API was never used")
//
// The router previously armed provider cooldowns (sessionStorage 180s /
// 30min / 90s + the in-memory rate-limit tracker window) on EVERY failed
// request. But the app's own health probes — readiness-gate preflight pings,
// benchmark pings, heal diagnosis/retest pings — travel through the SAME
// router path with requestType "test". Free-tier models (e.g. ZenCode
// "hy3-free") rate-limit those probes constantly, so every probe re-armed a
// fresh 180s cooldown: providers sat in a perpetual "Temporary cooldown —
// 180s remaining" cycle with ZERO real user traffic.
//
// Rule now enforced in ONE place:
//   - PROBE failure  ("test") → honest health evidence only. The
//     benchmark/healer machinery records consecutiveFailures / lastError /
//     healState and schedules a BOUNDED retest. No traffic-blocking cooldown.
//   - REAL traffic failure → cooldown armed as before, so failover moves to
//     the next provider and the failed one is re-tested after the window.
// ============================================================================

/** Record (or intentionally skip) router-level cooldowns for a failed AI call. */
export function recordTrafficCooldownFromError(opts: {
  /** Provider identity used for the sessionStorage cooldown key. */
  cooldownId: string;
  /** Provider id used for the in-memory rate-limit tracker key. */
  providerId: string;
  /** Configured model (tracker key part). */
  modelName?: string;
  /** Raw error object/message from the failed call. */
  error: any;
  /** HTTP status code when available. */
  statusCode?: number;
  /** Pre-computed timeout classification (router's isTimeoutError). */
  isTimeout: boolean;
  /** Router requestType — "test" = probe (preflight / benchmark / heal ping). */
  requestType?: string;
  /** Extra auth-failure patterns (the speculative race additionally matched
   *  /billing/|/payment/ before unification — preserved per call site). */
  authExtra?: RegExp;
}): void {
  // PROBES NEVER ARM TRAFFIC COOLDOWNS. A probe 429 is evidence ("this
  // provider is rate-limited right now"), not usage — blocking real traffic
  // for it punished providers the user never actually used.
  if (opts.requestType === "test") return;

  const msg = opts.error?.message ?? String(opts.error ?? "");
  const status = opts.statusCode ?? opts.error?.statusCode;
  if (status === 429 || /429/.test(msg) || /rate.?limit/i.test(msg) || /FreeUsageLimitError/i.test(msg)) {
    rateLimitTracker.record429(opts.providerId, opts.modelName ?? "default");
    // P1/P2 — three evidence classes, most specific wins:
    //   1. Retry-After (exact window relayed by the proxy) — honored verbatim,
    //      clamped to [5s, PROVIDER_QUOTA_COOLDOWN_MS].
    //   2. Quota-exhaustion wording — the long window (a quota will NOT reset
    //      in 3 minutes; short windows caused the all-day retry treadmill).
    //   3. Plain 429 (burst/short limit) — the classic 3-minute window.
    const retryAfterS = parseRetryAfterSeconds(opts.error);
    if (retryAfterS !== null) {
      markProviderRateLimitCooldown(opts.cooldownId, retryAfterS * 1000);
    } else if (QUOTA_EXHAUSTION_RE.test(msg)) {
      markProviderQuotaCooldown(opts.cooldownId);
    } else {
      markProvider429Cooldown(opts.cooldownId);
    }
  } else if (status === 401 || /401/.test(msg) || /CreditsError/i.test(msg) || (opts.authExtra?.test(msg) ?? false)) {
    markProvider401Cooldown(opts.cooldownId);
  } else if (opts.isTimeout) {
    markProviderTimeoutCooldown(opts.cooldownId);
  }
}

/**
 * P2 — extract an exact retry window (seconds) from a failed call's error.
 * Priority: explicit fields relayed by the proxy (`retryAfterSeconds` /
 * `retryAfter`), then response-header maps, then an "(retry-after: Ns)" note
 * embedded in the error text. Supports delta-seconds and HTTP-date formats.
 * Returns null when the provider gave no usable hint.
 */
export function parseRetryAfterSeconds(error: any): number | null {
  if (!error) return null;
  const fromValue = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
    if (typeof v === "string" && v.trim() !== "") {
      const asNum = Number(v.trim());
      if (Number.isFinite(asNum) && asNum > 0) return Math.floor(asNum);
      const ts = Date.parse(v);
      if (!Number.isNaN(ts)) {
        const s = Math.ceil((ts - Date.now()) / 1000);
        if (s > 0) return s;
      }
    }
    return null;
  };

  const direct = fromValue(error.retryAfterSeconds) ?? fromValue(error.retryAfter);
  if (direct !== null) return direct;

  // Header-map shapes (fetch Response.headers-like or plain objects).
  for (const h of [error.responseHeaders, error.headers]) {
    if (!h) continue;
    const v = typeof h.get === "function" ? h.get("retry-after") : (h["retry-after"] ?? h["Retry-After"]);
    const parsed = fromValue(v);
    if (parsed !== null) return parsed;
  }

  // Message-embedded note (the proxy appends "(retry-after: Ns)").
  const m = /retry.?after[^0-9]{0,16}(\d{1,5})/i.exec(String(error.message ?? error ?? ""));
  if (m) {
    const s = parseInt(m[1], 10);
    if (s > 0) return s;
  }
  return null;
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

