// ============================================================================
// Rate Governor — proactive, cross-provider request pacing (Option 1).
//
// The pipeline lost agents to provider 429s because every agent fired
// independently: N concurrent calls × retries collide with the provider's
// RPM ceiling, the provider answers 429, and the run degrades. The existing
// layers are REACTIVE (rate-limit-tracker parks a provider AFTER a 429; the
// router fails over; Gemini's adapter paces only Gemini). This module makes
// pacing PROACTIVE and UNIVERSAL at the single raw call path (callAIRaw /
// callAIRawStreamed in src/lib/ai.ts):
//
//   - Per provider:model token bucket refilled at the provider's RPM
//     (config.rateLimitPerMinute when configured, conservative default
//     otherwise) — bursty agents are queued, not rejected.
//   - AIMD (additive increase / multiplicative decrease): on success the
//     bucket's burst capacity creeps back up; on a 429 it halves (min 1)
//     and the provider parks for the server's Retry-After when an adapter
//     surfaced one (err.retryAfterSeconds / retryAfterMs), else a bounded
//     exponential window (same curve as rate-limit-tracker).
//   - FIFO ticketing — fairness across agents; no agent can starve another
//     by bursting.
//   - Hard wait ceiling: acquire() never blocks a call longer than
//     MAX_WAIT_MS even if the bucket is parked — it proceeds best-effort
//     (a possible 429 is handled by the existing recovery layers) so the
//     governor can never deadlock or permanently stall a run.
//
// Zero behavioral change when capacity is available: acquire() resolves
// immediately, results and routes are untouched. Disabled entirely by
// flipping the `enableRateGovernor` feature flag to false.
// ============================================================================

import { rateLimitBackoffMs } from "../rate-limit-tracker";

/** Conservative default RPM for providers without an explicit cap. */
export const DEFAULT_RPM = 10;
/** Never wait longer than this for a token — proceed best-effort after it. */
export const MAX_WAIT_MS = 120_000;
/** Burst capacity ceiling, expressed in requests (bucket max tokens). */
export const MAX_BURST = 6;
/** Poll interval while waiting for a token (ms). */
const TICK_MS = 100;

interface Bucket {
  /** Currently available fractional tokens (capacity = burst). */
  tokens: number;
  /** Last refill timestamp (ms). */
  lastRefill: number;
  /** Current burst capacity — AIMD-adjusted, ≤ MAX_BURST. */
  burst: number;
  /** Epoch ms until which the bucket is parked (429 Retry-After). */
  parkedUntil: number;
  /** Next FIFO ticket to hand out. */
  nextTicket: number;
  /** Ticket currently being served (all tickets < serving are done/abandoned). */
  serving: number;
  /** Last resolved RPM for this key (reused by sync success/failure reports). */
  rpm: number;
}

export interface RateGovernorOptions {
  /** Feature flag — false disables all pacing (immediate acquire). */
  enabled?: boolean;
}

function parseRetryAfterFromError(err: any): number | null {
  if (!err) return null;
  // Adapter-surfaced structured hints first (openai-compatible attaches
  // retryAfterSeconds; other adapters may attach retryAfterMs).
  if (Number.isFinite(err.retryAfterMs) && err.retryAfterMs > 0) return Number(err.retryAfterMs);
  if (Number.isFinite(err.retryAfterSeconds) && err.retryAfterSeconds > 0) return Number(err.retryAfterSeconds) * 1000;
  // Message fallback: "retry after Ns" / "retry-after: N"
  const msg = String(err?.message ?? "");
  const m = msg.match(/retry[- ]after[^0-9]*(\d+)/i);
  if (m) return Number(m[1]) * 1000;
  return null;
}

/** Public helper — extract a Retry-After hint (ms) from any thrown error. */
export function retryAfterMsFromError(err: any): number | null {
  return parseRetryAfterFromError(err);
}

function isRateLimitError(err: any): boolean {
  if (!err) return false;
  const status = err.statusCode ?? err.status;
  if (status === 429) return true;
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests");
}

export class RateGovernor {
  private buckets = new Map<string, Bucket>();
  /** Consecutive-429 streak per key — drives the bounded exponential backoff. */
  private streaks = new Map<string, number>();
  private enabled: boolean;

  constructor(opts?: RateGovernorOptions) {
    this.enabled = opts?.enabled ?? true;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private key(providerId?: string, model?: string): string {
    return `${providerId ?? "unknown"}:${model ?? "*"}`;
  }

  /** Resolve the effective RPM for a provider (caller-supplied cap wins). */
  resolveRpm(providerId?: string, configuredRpm?: number): number {
    if (Number.isFinite(configuredRpm) && (configuredRpm as number) > 0) return configuredRpm as number;
    return DEFAULT_RPM;
  }

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: MAX_BURST, lastRefill: Date.now(), burst: MAX_BURST, parkedUntil: 0, nextTicket: 0, serving: 0, rpm: DEFAULT_RPM };
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Read the app store once: feature-flag state + the provider's configured
   * RPM cap (AIProvider.rateLimitPerMinute). Lazy dynamic import keeps this
   * module cycle-free; the module registry caches the import after first use.
   */
  private async readStoreInfo(providerId?: string): Promise<{ enabled: boolean; configuredRpm?: number }> {
    try {
      if (typeof window === "undefined") return { enabled: this.enabled };
      const { useApp } = await import("../store");
      const st = useApp.getState();
      const flags = st?.flags;
      const enabled = this.enabled && !(flags && flags.enableRateGovernor === false);
      const prov = providerId ? (st?.providers ?? []).find((p: any) => p?.id === providerId) : undefined;
      const rpm = Number(prov?.rateLimitPerMinute);
      return { enabled, configuredRpm: Number.isFinite(rpm) && rpm > 0 ? rpm : undefined };
    } catch {
      return { enabled: this.enabled };
    }
  }

  /** Refill fractional tokens elapsed since lastRefill (capacity = burst). */
  private refill(b: Bucket, rpm: number, now: number): void {
    const ratePerMs = rpm / 60_000;
    b.tokens = Math.min(b.burst, b.tokens + (now - b.lastRefill) * ratePerMs);
    b.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, Math.max(0, ms)));
  }

  /**
   * Wait until a request token is available for this provider:model.
   * Resolves when a token is consumed, OR after MAX_WAIT_MS (best-effort
   * proceed — never deadlock). Resolves immediately when disabled.
   */
  async acquire(providerId?: string, model?: string, configuredRpm?: number): Promise<void> {
    const storeInfo = await this.readStoreInfo(providerId);
    if (!storeInfo.enabled) return;
    const effRpm = configuredRpm ?? storeInfo.configuredRpm;
    const rpm = this.resolveRpm(providerId, effRpm);
    const key = this.key(providerId, model);
    const deadline = Date.now() + MAX_WAIT_MS;
    const b = this.bucket(key);
    b.rpm = rpm; // sync success/failure reports reuse this
    const myTicket = b.nextTicket++; // FIFO — take a ticket once, up front

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = Date.now();
      if (now >= deadline) {
        // Abandon: if it's our turn, advance serving so the queue moves on.
        if (b.serving === myTicket) b.serving = myTicket + 1;
        return; // hard ceiling — best-effort proceed
      }
      this.refill(b, rpm, now);

      if (now < b.parkedUntil) {
        await this.sleep(Math.min(b.parkedUntil - now, deadline - now, 5_000));
        continue;
      }

      if (b.serving === myTicket && b.tokens >= 1) {
        b.tokens -= 1;
        b.serving = myTicket + 1;
        return;
      }

      await this.sleep(Math.min(TICK_MS, deadline - now));
    }
  }

  /** Report a successful call — capacity creeps back up (additive increase). */
  reportSuccess(providerId?: string, model?: string, configuredRpm?: number): void {
    const key = this.key(providerId, model);
    const b = this.bucket(key);
    if (!this.enabled) return;
    const rpm = this.resolveRpm(providerId, configuredRpm ?? b.rpm);
    this.refill(b, rpm, Date.now());
    b.burst = Math.min(MAX_BURST, b.burst + 0.5);
    this.streaks.delete(key);
  }

  /**
   * Report a failed call. Only rate-limit-shaped errors reshape the bucket:
   * burst halves (multiplicative decrease, min 1) and the provider parks for
   * the server's Retry-After when known, else the bounded exponential curve.
   * Other errors are ignored (they carry no quota signal).
   */
  reportFailure(providerId?: string, model?: string, err?: any, configuredRpm?: number): void {
    if (!this.enabled) return;
    if (!isRateLimitError(err)) return;
    const key = this.key(providerId, model);
    const b = this.bucket(key);
    const rpm = this.resolveRpm(providerId, configuredRpm ?? b.rpm);
    this.refill(b, rpm, Date.now());
    b.burst = Math.max(1, Math.floor(b.burst / 2));
    b.tokens = Math.min(b.tokens, 0.5); // drain remaining burst on a 429
    const streak = (this.streaks.get(key) ?? 0) + 1;
    this.streaks.set(key, streak);
    const explicit = parseRetryAfterFromError(err);
    const backoff = explicit ?? rateLimitBackoffMs(streak);
    b.parkedUntil = Math.max(b.parkedUntil, Date.now() + backoff);
  }

  /** Test/ops introspection: milliseconds remaining on a park, 0 if none. */
  parkedFor(providerId?: string, model?: string): number {
    const b = this.buckets.get(this.key(providerId, model));
    if (!b) return 0;
    return Math.max(0, b.parkedUntil - Date.now());
  }

  /** Test/ops introspection: current burst capacity for this provider:model. */
  burstOf(providerId?: string, model?: string): number {
    const b = this.buckets.get(this.key(providerId, model));
    return b ? b.burst : MAX_BURST;
  }

  /** Reset all state (tests). */
  reset(): void {
    this.buckets.clear();
    this.streaks.clear();
  }
}

/**
 * Singleton — the single raw call path (src/lib/ai.ts) routes through this.
 * Browser-only by design: the paced multi-agent pipeline runs in the page;
 * on the server / in node (SSR routes, tests) the governor defaults OFF so
 * single-shot per-request calls and test suites are never queued. The
 * enableRateGovernor feature flag can still disable it in the browser.
 */
export const rateGovernor = new RateGovernor({ enabled: typeof window !== "undefined" });

/** Feature-flag helper — `enableRateGovernor: false` disables pacing. */
export function applyRateGovernorFlag(flags: Record<string, boolean> | undefined | null): void {
  rateGovernor.setEnabled(!(flags && flags.enableRateGovernor === false));
}
