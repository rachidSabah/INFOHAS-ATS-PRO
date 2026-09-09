// ============================================================================
// Zen free-model ingestion — edge-safe dynamic discovery for OpenCode Zen.
// Fetches GET {base}/models, discriminates free tier by pricing metadata
// (prompt === 0 AND completion === 0) with the name heuristic as fallback,
// and caches the sanitized id list for 1 hour (Cloudflare Cache API with an
// in-memory fallback) so the worker detects newly introduced free models
// without a redeploy. Every failure path resolves to null and callers fall
// back to the static heuristic — ingestion must never break a request.
// ============================================================================

import { filterZenIngestedModels, ZenIngestedModel } from "../zen-free-models";

export const ZEN_INGEST_TTL_SECONDS = 3600;

const ZEN_INGEST_KEY_PREFIX = "https://zen-ingest.internal/v1/free-models";

/** KV key inside the existing CACHE namespace (shared with the Worker). */
export const ZEN_KV_KEY = "opencode_free_models_v1";

/** Minimal KV surface (Cloudflare KVNamespace subset) — injected for tests. */
export interface ZenKV {
  get(key: string, type: "json"): Promise<any>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function ingestCacheAvailable(): boolean {
  try {
    return typeof caches !== "undefined" && !!(caches as any).default;
  } catch {
    return false;
  }
}

const memIngest = new Map<string, { ids: string[]; pricing: boolean; until: number }>();

function memGet(key: string): { ids: string[]; pricing: boolean } | null {
  const e = memIngest.get(key);
  if (!e) return null;
  if (Date.now() >= e.until) {
    memIngest.delete(key);
    return null;
  }
  return { ids: e.ids, pricing: e.pricing };
}

function memSet(key: string, ids: string[], pricing: boolean): void {
  if (memIngest.size > 50) memIngest.clear();
  memIngest.set(key, { ids, pricing, until: Date.now() + ZEN_INGEST_TTL_SECONDS * 1000 });
}

export interface ZenFreeSet {
  ids: string[];
  /** True when at least one entry carried pricing metadata. */
  pricingAvailable: boolean;
  /** "cache" | "live" | "memory" — where the set came from (observability). */
  via: string;
}

function ingestKey(baseUrl: string): string {
  return ZEN_INGEST_KEY_PREFIX + "/" + encodeURIComponent(baseUrl.replace(/\/$/, "").toLowerCase());
}

function toEntries(data: any): { entries: ZenIngestedModel[]; pricing: boolean } {
  const raw: any[] = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : [];
  let pricing = false;
  const entries: ZenIngestedModel[] = raw.map((m: any) => {
    if (typeof m === "string") return { id: m };
    const id = m?.id ?? m?.name;
    const p = m?.pricing ?? m?.price ?? null;
    if (p && typeof p === "object") pricing = true;
    return { id, pricing: p && typeof p === "object" ? p : null };
  });
  return { entries, pricing };
}

/**
 * Resolve the current free-model id set for a Zen base URL.
 * Source order: shared KV (cron-warmed, cross-isolate evictions) → edge
 * Cache API → in-memory → live upstream fetch (then write-through).
 * Cached 1 hour; null when ingestion is impossible (caller keeps its
 * static behavior).
 */
export async function getZenFreeModelSet(
  baseUrl: string,
  opts?: { apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch; kv?: ZenKV | null }
): Promise<ZenFreeSet | null> {
  const base = (baseUrl || "").replace(/\/$/, "");
  if (!base) return null;

  if (opts?.kv) {
    try {
      const kvIds = await opts.kv.get(ZEN_KV_KEY, "json");
      if (Array.isArray(kvIds) && kvIds.length > 0 && kvIds.every((m: any) => typeof m === "string")) {
        return { ids: kvIds, pricingAvailable: true, via: "kv" };
      }
    } catch {
      /* fall through to the next layer */
    }
  }

  const key = ingestKey(base);

  if (ingestCacheAvailable()) {
    try {
      const hit = await (caches as any).default.match(key);
      if (hit) {
        const data = await hit.json().catch(() => null);
        if (data && Array.isArray(data.ids)) {
          return { ids: data.ids, pricingAvailable: data.pricingAvailable === true, via: "cache" };
        }
      }
    } catch {
      /* fall through to live fetch */
    }
  } else {
    const mem = memGet(key);
    if (mem) return { ids: mem.ids, pricingAvailable: mem.pricing, via: "memory" };
  }

  const f = opts?.fetchImpl ?? fetch;
  const url = base + "/models";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.apiKey) headers["Authorization"] = "Bearer " + opts.apiKey;
  let res: Response;
  try {
    res = await f(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(Math.min(Math.max(opts?.timeoutMs ?? 8000, 1000), 15000)),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;
  const built = toEntries(data);
  const ids = filterZenIngestedModels(built.entries);
  const body = { ids, pricingAvailable: built.pricing };

  if (opts?.kv && ids.length > 0) {
    try {
      await opts.kv.put(ZEN_KV_KEY, JSON.stringify(ids), { expirationTtl: ZEN_INGEST_TTL_SECONDS });
    } catch {
      /* best-effort */
    }
  }

  if (ingestCacheAvailable()) {
    try {
      await (caches as any).default.put(
        key,
        new Response(JSON.stringify(body), {
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=" + String(ZEN_INGEST_TTL_SECONDS),
          },
        })
      );
    } catch {
      /* best-effort */
    }
  } else {
    memSet(key, ids, built.pricing);
  }
  return { ids, pricingAvailable: built.pricing, via: "live" };
}

/** Test hook — clear the in-memory fallback (edge cache is per-isolate). */
export function zenIngestResetMemory(): void {
  memIngest.clear();
}

/**
 * Instant cross-edge eviction: prune one model id from the shared KV list
 * (401 retiered / 404-410 retired). Keeps the TTL active. Best-effort —
 * never throws; returns the remaining count or null when KV is unusable.
 */
export async function evictZenModelFromKV(kv: ZenKV | null | undefined, modelId: string): Promise<number | null> {
  if (!kv || typeof modelId !== "string" || modelId.trim() === "") return null;
  try {
    const current = await kv.get(ZEN_KV_KEY, "json");
    if (!Array.isArray(current)) return null;
    const m = modelId.trim().toLowerCase();
    const pruned = current.filter((id: any) => typeof id === "string" && id.toLowerCase() !== m);
    if (pruned.length === current.length) return pruned.length;
    await kv.put(ZEN_KV_KEY, JSON.stringify(pruned), { expirationTtl: ZEN_INGEST_TTL_SECONDS });
    console.warn("[KV Eviction] Evicted model: " + modelId.trim() + ". Remaining: " + String(pruned.length));
    return pruned.length;
  } catch {
    return null;
  }
}
