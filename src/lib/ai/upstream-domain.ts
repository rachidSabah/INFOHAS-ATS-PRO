// ============================================================================
// Task 24 — Upstream failure-domain diversion
//
// Several seeded providers are ALIASES of the same upstream API: "OpenCode
// Zen" (p_opencode) and "ZenCode" (p_zencode) both resolve to
// opencode.ai/zen — one Cloudflare-level, IP-keyed free limiter. When that
// limiter closes a 429 quota window, attempting the sibling alias is not a
// failover at all: it burns a request (and cooldown slot) against the SAME
// limited pool, and can extend the IP penalty.
//
// This module identifies each provider's upstream failure domain (the
// normalized upstream host) so the router can:
//   1. seed a block-map from providers already in a 429/quota cooldown, and
//   2. skip (divert) later same-domain siblings to the next DISTINCT engine
//      (NVIDIA / Mistral / Google / OpenRouter / Puter), emitting a
//      structured skip event that lands in the trajectory Skips tab.
//
// Pure logic only — no I/O, no store access. Router wiring lives in
// services/router.ts (chat + stream share the gate).
// ============================================================================

export interface UpstreamSource {
  id?: string;
  name?: string;
  type?: string;
  baseUrl?: string | null;
  apiUrl?: string | null;
}

/** Structured skip reason emitted when a sibling is diverted. */
export const UPSTREAM_QUOTA_DIVERT_REASON = "upstream_quota_divert" as const;

/**
 * Normalize a provider's endpoint to its upstream failure domain.
 *
 *   https://opencode.ai/zen/v1        → "opencode.ai"
 *   HTTPS://WWW.OpenCode.AI:443/zen/  → "opencode.ai"
 *   (no URL)                          → "id:<id>"   (own domain — never falsely diverted)
 *
 * The host (not the URL) is the right granularity: the Zen free limiter is
 * keyed per upstream IP pool, so path- or port-level differences are
 * irrelevant to whether a sibling shares the quota fate.
 *
 * NOTE: diversion requires URL EVIDENCE of a shared upstream. URL-less
 * providers are always their own domain — same `type` alone proves nothing
 * (two custom providers of type "openai" may point at different hosts).
 */
export function upstreamDomainOf(p: UpstreamSource): string {
  const raw = (p.baseUrl || p.apiUrl || "").trim();
  if (!raw) return `id:${p.id || p.name || "unknown"}`;
  try {
    const u = new URL(raw);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // Not an absolute URL (custom template or typo) — best-effort host token.
    const host = raw.toLowerCase().split("/")[0];
    return host || `id:${p.id || p.name || "unknown"}`;
  }
}

/**
 * Seed the upstream block-map for a chain: for every provider the predicate
 * reports as quota-blocked (429 / quota cooldown class), mark its upstream
 * domain as blocked by THAT provider. The first blocked sibling in chain
 * order wins (deterministic attribution for the skip event).
 *
 * Non-quota cooldown classes (401 auth, timeout) deliberately do NOT block
 * the domain: those are per-credential / per-request failures — a sibling
 * with a different key may still succeed.
 */
export function buildUpstreamBlockMap(
  chain: UpstreamSource[],
  isQuotaBlocked: (id: string) => boolean
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of chain) {
    const id = p.id || p.name || "";
    if (!id || !isQuotaBlocked(id)) continue;
    const domain = upstreamDomainOf(p);
    if (!map.has(domain)) map.set(domain, id);
  }
  return map;
}
