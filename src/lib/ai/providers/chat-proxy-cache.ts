// ============================================================================
// Provider chat proxy — edge response cache (Cloudflare Cache API).
//
// WHY THIS EXISTS (architecture evidence, 2026-09-06):
//   The browser CANNOT call provider APIs directly — verified live against
//   https://opencode.ai/zen/v1: no Access-Control-Allow-Origin on /models,
//   OPTIONS /chat/completions 404s. So EVERY provider call funnels through
//   /api/providers/chat (Pages Function) and egresses from Cloudflare's
//   SHARED edge IPs. OpenCode Zen's free-usage limiter is keyed to the
//   REQUESTER'S IP (zen-free-models.ts; upstream anomalyco/opencode #33318 —
//   a fresh key or new account does NOT lift it), so all users collectively
//   exhaust ONE IP quota: the "opencode zen is always limits hits" report.
//
//   The admin toggle providerSettings.enableCaching ("Cache identical
//   prompts for 1 hour to save tokens") existed in the UI but was wired to
//   NOTHING. This module makes it real at the exact choke point: identical
//   prompts are served from the edge cache and cost ZERO upstream calls —
//   no Zen quota, no tokens, no latency. Cache keys are per-(model, prompt)
//   and deliberately NEVER include the API key, so users SHARE hits instead
//   of sharing exhaustion.
//
// Guarantees:
//   - Cache is best-effort: every failure path (no Cache API, quota, JSON
//     mismatch) resolves to null/no-op and the request proceeds upstream.
//   - Only successful (ok:true, text-shaped) responses are stored; errors
//     are never cached so retry/failover layers always see fresh evidence.
//   - TTL is 1 hour, matching the toggle's stated promise exactly.
// ============================================================================

export const CHAT_CACHE_TTL_SECONDS = 3600;

/** Versioned synthetic origin — bump v1 → v2 to invalidate all keys cleanly. */
const CACHE_KEY_PREFIX = "https://chat-cache.internal/v1/providers-chat";

/**
 * SHA-256 hex digest via the edge-native WebCrypto (workerd and node ≥18
 * both expose crypto.subtle globally).
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ChatCacheKeyParts {
  baseUrl: string;
  model?: string;
  messages?: unknown;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

/**
 * Build the cache key from PROMPT identity. Deliberately excludes the API
 * key: no key material ever enters a cache key, and identical prompts from
 * different users collapse into ONE shared upstream call.
 * Returns null when the request is not keyable (caller skips caching).
 */
export async function chatCacheKey(parts: ChatCacheKeyParts): Promise<string | null> {
  const { baseUrl, model, messages, maxTokens, temperature, topP } = parts;
  if (!baseUrl || !Array.isArray(messages) || messages.length === 0) return null;
  const payload = JSON.stringify([
    baseUrl,
    model ?? "",
    messages,
    maxTokens ?? "",
    temperature ?? "",
    topP ?? "",
  ]);
  return `${CACHE_KEY_PREFIX}/${await sha256Hex(payload)}`;
}

function cacheAvailable(): boolean {
  try {
    return typeof caches !== "undefined" && !!(caches as any).default;
  } catch {
    return false;
  }
}

/**
 * Look up a prior identical prompt. Returns the cached response JSON
 * (augmented with cached:true) or null on any miss/failure.
 */
export async function matchCachedChat(key: string | null): Promise<Record<string, unknown> | null> {
  if (!key || !cacheAvailable()) return null;
  try {
    const hit = await (caches as any).default.match(key);
    if (!hit) return null;
    const data = await hit.json();
    if (data && data.ok === true && typeof data.text === "string") {
      return { ...data, cached: true };
    }
    return null;
  } catch {
    return null; // cache must never break the request
  }
}

/**
 * Store a SUCCESSFUL response for the TTL. Errors are never cached — the
 * client-side cooldown/failover layers must always see fresh upstream
 * evidence on the next attempt.
 */
export async function putCachedChat(key: string | null, body: Record<string, unknown>): Promise<void> {
  if (!key || !cacheAvailable()) return;
  if (body?.ok !== true || typeof body?.text !== "string") return;
  try {
    const res = new Response(JSON.stringify(body), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${CHAT_CACHE_TTL_SECONDS}`,
      },
    });
    await (caches as any).default.put(key, res);
  } catch {
    /* best-effort — a cache write failure must never fail the request */
  }
}
