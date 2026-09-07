// DirectProbePolicy — decides whether ProviderManager.testConnection may
// attempt the "direct client IP probe" fallback (a browser fetch straight to
// the provider URL) when the /api/providers/test proxy reports HTTP 429.
//
// WHY THIS EXISTS
// The proxy egresses from shared Cloudflare Pages IPs whose free-tier quotas
// are drained by other tenants; a browser probe uses the USER's residential
// IP and can succeed for CORS-enabled providers (e.g. Google Generative
// Language API). Commit 5ff64b42 introduced it for exactly that rescue path.
//
// THE PROBLEM IT CAUSES
// For CORS-hostile providers (opencode.ai returns no Access-Control-Allow-
// Origin) the probe can NEVER succeed, and every failed preflight is logged
// BY THE BROWSER ITSELF — noise that cannot be suppressed from JavaScript.
// Users testing a provider row then see alarming `net::ERR_FAILED` +
// "blocked by CORS policy" stacks for a fallback that was always destined
// to fail.
//
// THE RULES (pure, testable)
// 1. Only probe when the proxy explicitly reported rateLimited (429).
// 2. Only probe in a real browser (the code path is client-only anyway).
// 3. NEVER probe a demoted provider (isActive = false) — it is excluded from
//    the live routing chain, so a residential-IP rescue is pointless noise.
// 4. Never probe localhost (same-machine endpoints don't need an IP rescue).
// 5. Never re-probe a host that already failed with a network/CORS error:
//    failures are remembered in localStorage with a TTL, so the console
//    noise happens at most once per host per window. A successful probe
//    clears the memory so a provider that later ships CORS headers is
//    rescued again.

/** How long a failed-probe host stays remembered. 24h bounds the damage of
 * mis-remembering a host that merely had a transient outage (a network
 * failure and a CORS rejection are indistinguishable TypeError("Failed to
 * fetch") from the caller's perspective). */
export const DIRECT_PROBE_BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

const STORAGE_KEY = "directProbe.corsBlockedHosts";

export interface DirectProbeContext {
  /** The /api/providers/test proxy reported HTTP 429 (rateLimited). */
  rateLimited: boolean;
  /** provider.isActive — undefined counts as active (legacy rows). */
  providerIsActive: boolean;
  /** provider.baseUrl — the host the probe would hit. */
  baseUrl?: string;
  /** typeof window !== "undefined". */
  isBrowser: boolean;
  /** Hosts remembered as CORS/network-hostile (not yet expired). */
  blockedHosts: ReadonlySet<string>;
}

/** Extract the hostname from a base URL; null when absent/unparseable. */
export function extractProbeHost(baseUrl?: string): string | null {
  if (!baseUrl || typeof baseUrl !== "string") return null;
  try {
    const url = new URL(baseUrl.includes("://") ? baseUrl : `https://${baseUrl}`);
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The full go / no-go decision for the browser-direct probe. */
export function shouldAttemptDirectProbe(ctx: DirectProbeContext): boolean {
  if (!ctx.rateLimited) return false;
  if (!ctx.isBrowser) return false;
  // Demoted providers are excluded from the live chain — probing them from
  // the user's residential IP cannot change any runtime outcome, and for
  // CORS-hostile upstreams (opencode.ai) it only spams the console.
  if (ctx.providerIsActive === false) return false;
  const host = extractProbeHost(ctx.baseUrl);
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return false;
  if (ctx.blockedHosts.has(host)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// localStorage memory (injected Storage so tests stay pure)
// ---------------------------------------------------------------------------

interface BlockedHostEntry {
  [host: string]: number; // epoch ms when the probe failed
}

/** localStorage can throw (privacy mode, disabled storage) — never let the
 * diagnostics path crash over a cache. */
export function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const s = window.localStorage;
    // Touch it — some environments hand out a storage object that throws on use.
    s.getItem(STORAGE_KEY);
    return s;
  } catch {
    return null;
  }
}

/** Load remembered hosts, dropping expired entries. Corrupt payloads are
 * treated as empty (and left alone — the next remember() overwrites). */
export function loadBlockedProbeHosts(storage: Storage | null, now = Date.now()): Set<string> {
  const out = new Set<string>();
  if (!storage) return out;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as BlockedHostEntry;
    if (!parsed || typeof parsed !== "object") return out;
    for (const [host, failedAt] of Object.entries(parsed)) {
      if (typeof failedAt !== "number" || !Number.isFinite(failedAt)) continue;
      if (now - failedAt > DIRECT_PROBE_BLOCK_TTL_MS) continue; // expired
      out.add(host.toLowerCase());
    }
  } catch {
    // corrupt JSON → treat as empty
  }
  return out;
}

/** Remember a host whose direct probe failed (CORS or network), TTL-bounded. */
export function rememberBlockedProbeHost(storage: Storage | null, host: string, now = Date.now()): void {
  if (!storage || !host) return;
  try {
    const key = host.toLowerCase();
    let parsed: BlockedHostEntry = {};
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw) as BlockedHostEntry;
        if (p && typeof p === "object") parsed = p;
      } catch {
        parsed = {};
      }
    }
    parsed[key] = now;
    storage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // quota / privacy mode — diagnostics must never crash over a cache
  }
}

/** Clear a host's memory (probe succeeded — the host speaks CORS again). */
export function clearBlockedProbeHost(storage: Storage | null, host: string): void {
  if (!storage || !host) return;
  try {
    const key = host.toLowerCase();
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as BlockedHostEntry;
    if (!parsed || typeof parsed !== "object" || !(key in parsed)) return;
    delete parsed[key];
    storage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}
