// ============================================================================
// Zen proactive health probing — shared by the Workers API cron and tests.
// Ingests the Zen catalog, keeps pricing-free candidates, then fires a
// 1-token synthetic probe per candidate (6s cap each, parallel). Only ids
// answering 200 OK survive. Empty result means "keep the old cache" — the
// caller must never wipe known-good state on a failed run (e.g. a transient
// edge 429 would otherwise nuke the pool for an hour).
// Pure except for the injected fetch — fully unit-testable.
// ============================================================================

import { filterZenIngestedModels } from "./zen-free-models";

export const ZEN_PROBE_TIMEOUT_MS = 6000;
export const ZEN_PROBE_MAX_TOKENS = 1;

export interface ZenProbeDeps {
  fetchImpl?: typeof fetch;
  nowMs?: number;
}

/**
 * 1-token probe: true only on HTTP 200 (any body). 401/403/404/429 and
 * network errors all count as unhealthy — the registry/breaker owns the
 * distinction at request time; the cron only admits proven-answering ids.
 */
export async function probeZenModel(
  baseUrl: string,
  modelId: string,
  apiKey: string,
  deps?: ZenProbeDeps
): Promise<boolean> {
  const f = deps?.fetchImpl ?? fetch;
  const base = (baseUrl || "").replace(/\/$/, "");
  if (!base || !modelId) return false;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ATSOptimizer-Cron/1.0",
  };
  if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
  try {
    const res = await f(base + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: ZEN_PROBE_MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(ZEN_PROBE_TIMEOUT_MS),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export interface ZenCatalogResult {
  candidates: string[];
  pricingAvailable: boolean;
}

/** Fetch + pricing-discriminate the catalog (no probing). Null on failure. */
export async function ingestZenCatalog(
  baseUrl: string,
  apiKey: string,
  deps?: ZenProbeDeps
): Promise<ZenCatalogResult | null> {
  const f = deps?.fetchImpl ?? fetch;
  const base = (baseUrl || "").replace(/\/$/, "");
  if (!base) return null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ATSOptimizer-Cron/1.0",
  };
  if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
  try {
    const res = await f(base + "/models", {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    const raw: any[] = Array.isArray((data as any)?.data) ? (data as any).data : [];
    let pricing = false;
    const entries = raw.map((m: any) => {
      const p = m?.pricing ?? null;
      if (p && typeof p === "object") pricing = true;
      return { id: m?.id ?? m?.name, pricing };
    });
    return { candidates: filterZenIngestedModels(entries), pricingAvailable: pricing };
  } catch {
    return null;
  }
}

/**
 * Full refresh pass: ingest → probe → verified ids. Returns null when
 * nothing could be verified (caller retains existing cache).
 */
export async function refreshZenVerifiedModels(
  baseUrl: string,
  apiKey: string,
  deps?: ZenProbeDeps
): Promise<{ ids: string[]; pricingAvailable: boolean } | null> {
  const catalog = await ingestZenCatalog(baseUrl, apiKey, deps);
  if (!catalog || catalog.candidates.length === 0) return null;
  const settled = await Promise.allSettled(
    catalog.candidates.map(async (id) => ({
      id,
      healthy: await probeZenModel(baseUrl, id, apiKey, deps),
    }))
  );
  const verified: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.healthy) verified.push(r.value.id);
  }
  if (verified.length === 0) return null;
  return { ids: verified, pricingAvailable: catalog.pricingAvailable };
}
