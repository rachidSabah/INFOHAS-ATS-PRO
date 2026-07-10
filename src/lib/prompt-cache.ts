// ============================================================================
// Prompt Cache — Feature 4: Client-Side Semantic & Sentence Caching
//
// Persistent localStorage cache keyed by a fast FNV-1a hash of
// (systemPrompt + userPrompt + modelOverride).
//
// Design goals:
//   - Instant cache-hit response (0ms, no network)
//   - Max 40 entries to stay well under the 5MB localStorage quota
//   - 6-hour TTL — fresh enough that AI drift won't surprise users
//   - Never caches: empty responses, local-engine results, error results
//   - LRU-style eviction: oldest createdAt is evicted first when at cap
//   - All errors are silently swallowed — cache is best-effort only
// ============================================================================

"use client";

const CACHE_PREFIX = "rag_prompt_";
const MAX_ENTRIES = 40;
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface PromptCacheEntry {
  text: string;
  provider: string;
  latencyMs: number;
  tokensEstimate: number;
  createdAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Fast FNV-1a 32-bit hash — non-cryptographic, purely for dedup keys.
// ---------------------------------------------------------------------------
export function promptHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(hash: string): string {
  return `${CACHE_PREFIX}${hash}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readEntry(key: string): PromptCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as PromptCacheEntry;
    // TTL check
    if (!entry.expiresAt || Date.now() > entry.expiresAt) {
      window.localStorage.removeItem(key);
      return null;
    }
    // Sanity check
    if (!entry.text || entry.text.trim().length < 10) {
      window.localStorage.removeItem(key);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

/**
 * Evict oldest entries until we are below MAX_ENTRIES.
 * Reads createdAt from each entry and sorts ascending (oldest first).
 */
function evictIfNeeded(): void {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith(CACHE_PREFIX)
    );
    if (keys.length < MAX_ENTRIES) return;

    // Collect (key, createdAt) pairs
    const withAge: { key: string; createdAt: number }[] = [];
    for (const k of keys) {
      try {
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const entry = JSON.parse(raw) as PromptCacheEntry;
        withAge.push({ key: k, createdAt: entry.createdAt ?? 0 });
      } catch {
        // Corrupt entry — delete it
        window.localStorage.removeItem(k);
      }
    }

    // Sort oldest first, delete until we have room
    withAge.sort((a, b) => a.createdAt - b.createdAt);
    const toDelete = withAge.slice(0, Math.max(1, withAge.length - MAX_ENTRIES + 5));
    for (const { key: k } of toDelete) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // localStorage may be full or unavailable — ignore
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a cached AI result by content hash.
 * Returns null on miss, expired entry, or any error.
 */
export function getPromptCache(hash: string): { text: string; provider: string; latencyMs: number; tokensEstimate: number } | null {
  const entry = readEntry(cacheKey(hash));
  if (!entry) return null;
  console.info(`[PromptCache] HIT hash=${hash.slice(0, 8)} provider="${entry.provider}" (cached ${Math.round((Date.now() - entry.createdAt) / 60000)}m ago)`);
  return {
    text: entry.text,
    provider: `${entry.provider} (cached)`,
    latencyMs: 0,
    tokensEstimate: entry.tokensEstimate,
  };
}

/**
 * Store an AI result in the persistent cache.
 * Silently no-ops for: empty text, local-engine results, or any error.
 */
export function setPromptCache(
  hash: string,
  result: { text: string; provider: string; latencyMs: number; tokensEstimate: number; isLocalEngine?: boolean }
): void {
  if (typeof window === "undefined") return;
  // Never cache local/offline results
  if (result.isLocalEngine) return;
  if (!result.text || result.text.trim().length < 10) return;
  // Never cache empty provider names (indicates error path)
  if (!result.provider) return;

  try {
    evictIfNeeded();
    const now = Date.now();
    const entry: PromptCacheEntry = {
      text: result.text,
      provider: result.provider,
      latencyMs: result.latencyMs,
      tokensEstimate: result.tokensEstimate,
      createdAt: now,
      expiresAt: now + TTL_MS,
    };
    window.localStorage.setItem(cacheKey(hash), JSON.stringify(entry));
    console.info(`[PromptCache] STORED hash=${hash.slice(0, 8)} provider="${result.provider}"`);
  } catch {
    // localStorage full or unavailable — ignore
  }
}

/**
 * Build the cache hash key for a callAI opts object.
 */
export function buildPromptHash(opts: {
  systemPrompt?: string;
  userPrompt: string;
  modelOverride?: string;
}): string {
  const components = [
    opts.systemPrompt ?? "",
    opts.userPrompt,
    opts.modelOverride ?? "",
  ].join("\x00");
  return promptHash(components);
}

/**
 * Clear all prompt cache entries from localStorage.
 */
export function clearPromptCache(): void {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith(CACHE_PREFIX)
    );
    for (const k of keys) window.localStorage.removeItem(k);
    console.info(`[PromptCache] Cleared ${keys.length} entries`);
  } catch {
    // ignore
  }
}

/**
 * Returns cache stats for diagnostics.
 */
export function getPromptCacheStats(): { total: number; valid: number; expired: number } {
  if (typeof window === "undefined") return { total: 0, valid: 0, expired: 0 };
  try {
    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith(CACHE_PREFIX)
    );
    let valid = 0;
    let expired = 0;
    const now = Date.now();
    for (const k of keys) {
      try {
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const entry = JSON.parse(raw) as PromptCacheEntry;
        if (entry.expiresAt && now > entry.expiresAt) {
          expired++;
        } else {
          valid++;
        }
      } catch {
        expired++;
      }
    }
    return { total: keys.length, valid, expired };
  } catch {
    return { total: 0, valid: 0, expired: 0 };
  }
}
