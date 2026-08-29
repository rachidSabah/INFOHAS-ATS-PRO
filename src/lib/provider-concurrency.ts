// ============================================================================
// Provider Concurrency Limiter — per-provider in-flight semaphore (S3)
//
// The pipeline fires parallel AI calls (intelligence stage: Job Intelligence
// + Company Intelligence; locked pipeline: Summary/Skills/Experience
// optimizers in one stage). On free setups ALL of those funnel into the SAME
// provider — 4 simultaneous requests to one free-tier endpoint can
// self-inflict 429s that look identical to provider-side quota exhaustion.
//
// This module caps concurrent in-flight requests PER PROVIDER:
//   - at most `cap` traffic slots per provider (default 2)
//   - an acquire beyond the cap WAITS up to maxWaitMs for a slot to free up,
//     then reports busy (the router falls through to the next provider)
//   - PROBES (requestType "test": preflight / benchmark / heal pings) bypass
//     the limiter entirely — diagnostics are never queued behind traffic
//   - caps are strictly per provider; provider B is never blocked by
//     provider A's saturation
//
// The router wraps each per-provider attempt in acquire/try/finally-release.
// Slots are held across the WHOLE attempt (rotations included) — rotations
// are sequential, so this only throttles DIFFERENT pipeline agents racing
// for the same provider, which is exactly the failure mode being prevented.
// ============================================================================

/** Default concurrent in-flight traffic requests per provider. */
export const DEFAULT_PROVIDER_CONCURRENCY = 2;

/** Default max time a call waits for a slot before being reported busy. */
export const DEFAULT_PROVIDER_SLOT_WAIT_MS = 10_000;

interface ConcurrencyOpts { cap: number; maxWaitMs: number }

let opts: ConcurrencyOpts = {
  cap: DEFAULT_PROVIDER_CONCURRENCY,
  maxWaitMs: DEFAULT_PROVIDER_SLOT_WAIT_MS,
};

/** In-flight counters per provider id. */
const inFlight = new Map<string, number>();
/** FIFO waiters per provider id. */
const waiters = new Map<string, Array<() => void>>();

/** Test/settings hook — adjust cap and wait at runtime. */
export function setProviderConcurrencyOpts(next: Partial<ConcurrencyOpts>): void {
  opts = { ...opts, ...next };
}

export function getProviderConcurrencyOpts(): ConcurrencyOpts {
  return { ...opts };
}

/** Current in-flight count for a provider (0 when idle). */
export function getProviderInFlight(providerId: string): number {
  return inFlight.get(providerId) ?? 0;
}

function notifyNextWaiter(providerId: string): void {
  const q = waiters.get(providerId);
  if (q && q.length > 0) {
    const wake = q.shift()!;
    wake();
  }
}

/**
 * Acquire a traffic slot for a provider.
 * Returns false when no slot freed up within maxWaitMs (busy).
 * Probes pass `probe: true` — they bypass the limiter entirely.
 */
export async function acquireProviderSlot(
  providerId: string,
  probe?: { probe?: boolean },
  maxWaitMsOverride?: number,
): Promise<boolean> {
  if (probe?.probe) return true; // probes are never throttled

  const maxWait = maxWaitMsOverride ?? opts.maxWaitMs;
  const canEnter = (): boolean => (inFlight.get(providerId) ?? 0) < opts.cap;

  if (canEnter()) {
    inFlight.set(providerId, (inFlight.get(providerId) ?? 0) + 1);
    return true;
  }

  // Queue and wait for a release, bounded by maxWait.
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const q = waiters.get(providerId);
      if (q) {
        const i = q.indexOf(wake);
        if (i >= 0) q.splice(i, 1);
      }
      if (ok) {
        inFlight.set(providerId, (inFlight.get(providerId) ?? 0) + 1);
      }
      resolve(ok);
    };
    const wake = (): void => {
      // Only enter if the freed slot is still available (another waiter may
      // have taken it — it will be woken next by its own notify).
      if (canEnter()) finish(true);
      else finish(false);
    };
    const q = waiters.get(providerId) ?? [];
    q.push(wake);
    waiters.set(providerId, q);
    const timer = setTimeout(() => finish(false), maxWait);
  });
}

/**
 * Release a previously acquired traffic slot and wake the next waiter.
 * Safe to call even when the slot was bypassed (probe) — it normalizes the
 * counter to zero instead of going negative.
 */
export function releaseProviderSlot(providerId: string): void {
  const current = inFlight.get(providerId) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) inFlight.delete(providerId);
  else inFlight.set(providerId, next);
  notifyNextWaiter(providerId);
}

/**
 * Run `fn` inside a provider slot. Convenience wrapper used by the router:
 *   - probe → runs fn directly (no slot)
 *   - busy  → resolves to the `busyValue` sentinel without running fn
 */
export async function withProviderSlot<T>(
  providerId: string,
  fn: () => Promise<T>,
  o?: { probe?: boolean; maxWaitMs?: number; busyValue: T },
): Promise<T> {
  const acquired = await acquireProviderSlot(providerId, o, o?.maxWaitMs);
  if (!acquired) return o!.busyValue;
  try {
    return await fn();
  } finally {
    releaseProviderSlot(providerId);
  }
}

/** Test isolation helper — clears all counters and waiters. */
export function __resetProviderConcurrencyForTests(): void {
  inFlight.clear();
  for (const q of waiters.values()) q.length = 0;
  waiters.clear();
  opts = { cap: DEFAULT_PROVIDER_CONCURRENCY, maxWaitMs: DEFAULT_PROVIDER_SLOT_WAIT_MS };
}
