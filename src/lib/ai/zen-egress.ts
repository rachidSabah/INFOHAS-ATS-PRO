// ============================================================================
// Zen egress routing — flag-aware URL resolution for CLIENT call sites.
//
// manager.ts / openai-compatible.ts / custom.ts / model-discovery.ts hand the
// provider's baseUrl to the /api/providers/* edge proxies. When the Super
// Admin flag `zenRelayEnabled` is on (default), canonical opencode.ai URLs
// are swapped for the managed Vercel relay (AWS egress) so Zen's per-IP free
// limiter sees a SECOND, independent quota bucket instead of Cloudflare's
// shared edge pool. See docs/ZEN_SHARED_EGRESS_HEALTH.md.
//
// WHY A SEPARATE MODULE (not zen-free-models.ts): the flag lives in the
// Zustand store, and a static store import here would create an
// adapter→store import cycle (same reason openai-compatible.ts lazy-imports
// the store for enableCaching) and drag the store into the Workers API
// bundle, which imports zen-free-models transitively. Dynamic import keeps
// every bundle clean.
//
// Flag semantics match the rest of the app: `undefined` = enabled (the
// SEED default is on), explicit `false` = off → pass the URL through
// untouched. Any store failure = pass through (fail-open to direct egress,
// never break a chat call on a routing detail).
// ============================================================================

import { resolveZenEgressBaseUrl } from "./zen-free-models";

export async function zenEgressBaseUrl(
  baseUrl: string | undefined | null
): Promise<string | undefined | null> {
  if (!baseUrl) return baseUrl;
  try {
    const { useApp } = await import("@/lib/store");
    return resolveZenEgressBaseUrl(baseUrl, useApp.getState()?.flags?.zenRelayEnabled !== false);
  } catch {
    return baseUrl;
  }
}
