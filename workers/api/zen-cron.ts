// Zen proactive health check — Workers API side (Hono env adapter).
// The testable ingest/probe orchestration lives in
// src/lib/ai/zen-cron-probe.ts; this module only binds it to the Worker's
// KV + secrets and exposes the scheduled handler. Reuses the existing CACHE
// KV binding under the shared ZEN_KV_KEY so Pages edge routes and the cron
// read/write the same list — no new namespace required.

import { refreshZenVerifiedModels } from "../../src/lib/ai/zen-cron-probe";
import { ZEN_KV_KEY, ZEN_INGEST_TTL_SECONDS } from "../../src/lib/ai/providers/zen-ingest";

export const ZEN_CRON_TTL_SECONDS = 3900;
const ZEN_BASE_DEFAULT = "https://opencode.ai/zen/v1";

export interface ZenCronEnv {
  CACHE?: KVNamespace | null;
  OPENCODE_API_KEY?: string;
  OPENCODE_API_BASE?: string;
}

/**
 * Hourly pass: ingest → 1-token probe each free candidate → KV write.
 * Never wipes known-good state: zero verified ids retains the old cache.
 * Returns the outcome for logs/tests (scheduled handler discards it).
 */
export async function handleZenScheduled(
  env: ZenCronEnv
): Promise<{ ok: boolean; ids?: string[]; reason?: string }> {
  const kv = env?.CACHE;
  if (!kv) return { ok: false, reason: "CACHE binding missing" };
  const base = (env?.OPENCODE_API_BASE || ZEN_BASE_DEFAULT).replace(/\/$/, "");
  const key = env?.OPENCODE_API_KEY || "";
  let verified: { ids: string[]; pricingAvailable: boolean } | null = null;
  try {
    verified = await refreshZenVerifiedModels(base, key);
  } catch (e: any) {
    console.error("[Cron] Zen refresh threw:", String(e?.message ?? e).slice(0, 200));
    return { ok: false, reason: "refresh threw" };
  }
  if (!verified || verified.ids.length === 0) {
    console.warn("[Cron] No healthy Zen models verified in this run. Retaining existing cache.");
    return { ok: false, reason: "zero healthy — cache retained" };
  }
  try {
    await kv.put(ZEN_KV_KEY, JSON.stringify(verified.ids), { expirationTtl: ZEN_CRON_TTL_SECONDS });
  } catch (e: any) {
    console.error("[Cron] KV write failed:", String(e?.message ?? e).slice(0, 200));
    return { ok: false, reason: "kv write failed" };
  }
  console.log("[Cron] Zen cache updated. Healthy verified models:", verified.ids.join(", "));
  return { ok: true, ids: verified.ids };
}
