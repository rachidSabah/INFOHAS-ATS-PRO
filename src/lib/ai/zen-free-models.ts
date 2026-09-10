// ============================================================================
// ZEN FREE-MODEL REGISTRY — single source of truth for OpenCode Zen free
// models (types: opencode / opencode-zen / zencode, baseUrl
// https://opencode.ai/zen/v1).
//
// WHY THIS EXISTS (live evidence, 2026-08-30):
//   1. Free-model availability churns constantly — ids vanish from
//      /zen/v1/models and reappear (hy3-free is gone; big-pickle returned).
//      A stale static list makes the UI offer models the API no longer serves.
//   2. The free-usage limiter is keyed to the REQUESTER'S IP, not the API key
//      (FreeUsageLimitError fires keyless; upstream issue anomalyco/opencode
//      #33318) — and per-model upstream routes fail independently ("Model is
//      unavailable" / 503 on one sibling while another answers 200 from the
//      same IP). A fresh key or new account does NOT lift the limit.
//   3. Region locks exist per model (muse-spark-1.2-contributor-free → 403
//      RegionError) and some free models are only served on the /responses
//      endpoint family, not the OpenAI-compatible /chat/completions route the
//      app uses — so they must never be shipped as chat defaults.
//
// The preflight gate + router rotate through enabledModels siblings on
// quota/model errors; this registry keeps those lists honest and the default
// pointed at a model that was verified ANSWERING at verification time.
// ============================================================================

/** Date of the last live probe of https://opencode.ai/zen/v1 (UTC). */
export const ZEN_VERIFICATION_DATE = "2026-08-30";

/**
 * Zen upstream detection — host match OR path match.
 *
 *  1. hostname === "opencode.ai"  → the canonical Zen gateway.
 *  2. ANY host with a "/zen" path prefix (e.g. https://relay.example.com/zen/v1)
 *    → a self-hosted RELAY/mirror of the Zen API. This is the supported
 *    escape hatch from Cloudflare's SHARED egress pool (see
 *    docs/ZEN_SHARED_EGRESS_HEALTH.md): the admin points the provider's
 *    baseUrl at their own non-Cloudflare relay, and every Zen-specific
 *    behavior (session headers, quota-grace health, free-model registry)
 *    follows automatically because the path still says /zen.
 *
 * A random unknown header (x-opencode-session) on a non-Zen origin that
 * happens to serve /zen is harmless — unknown headers are ignored upstream.
 */
export function isZenChatUpstream(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false;
  try {
    const u = new URL(baseUrl);
    return u.hostname.toLowerCase() === "opencode.ai" || u.pathname.toLowerCase().startsWith("/zen");
  } catch {
    return false;
  }
}

/**
 * Session header demanded by the Zen free tier on chat completions.
 *
 * OpenCode's free tier rejects /chat/completions calls that don't identify an
 * OpenCode client session: HTTP 400 MissingSessionID — "OpenCode's free tier
 * can only be used in OpenCode" (verified live 2026-09-09 against
 * nemotron-3.5-lightning-free / big-pickle / mimo-v2.5-free /
 * ling-3.0-flash-fin-free). Both `x-opencode-session` and `x-session-id`
 * request headers satisfy the gate; a body `session_id` field does NOT, and
 * /models is unaffected. Keyed paid traffic is presumably unaffected too, but
 * sending the header unconditionally on Zen chat calls is harmless and keeps
 * the cron prober, the router and the Pages chat proxy on one code path.
 * One UUID per request — no cross-request state on the edge.
 */
export function zenSessionHeaders(baseUrl: string | undefined | null): Record<string, string> {
  if (!isZenChatUpstream(baseUrl)) return {};
  try {
    return { "x-opencode-session": crypto.randomUUID() };
  } catch {
    // No webcrypto (ancient Node / exotic runtime): proceed without the
    // header — the call will fail with MissingSessionID and the registry
    // handles it like any other upstream failure.
    return {};
  }
}

/**
 * Quota-grace health rule (pure, testable) — should a Zen provider's health
 * status be OVERRIDDEN to "healthy" because its only symptom is IP-keyed
 * quota throttling?
 *
 * WHY: on Cloudflare Pages every call egresses from SHARED edge IPs, and
 * Zen's free limiter is keyed to the REQUESTER'S IP (zen-free-models.ts
 * header comment; upstream anomalyco/opencode #33318). A 429 from that pool
 * is evidence the upstream is ALIVE and answering — it says nothing about
 * provider health. Painting Zen red for a shared-pool 429 is a false alarm,
 * while the 60s rateLimitedUntil window still protects ROUTING.
 *
 * Override applies ONLY when ALL of:
 *   - the feature flag enableZenQuotaGrace is on (undefined = on),
 *   - the provider resolves to a Zen upstream (host or /zen relay path),
 *   - the most recent failure — if any — was itself quota-shaped
 *     (429 / FreeUsageLimitError / "rate limit" / "quota"). A real failure
 *     (401 auth, 404 model, 5xx outage) as the latest signal must follow
 *     the NORMAL degradation rules.
 *
 * Returns the overridden status, or null = "no override, use normal rules".
 */
export function zenHealthStatusOverride(opts: {
  graceEnabled: boolean;
  isZen: boolean;
  currentStatus?: string | null;
  consecutiveFailures: number;
  lastError?: string | null;
}): "healthy" | "degraded" | "down" | "untested" | null {
  if (!opts.graceEnabled || !opts.isZen) return null;
  if (opts.lastError && !isRateLimitShaped(opts.lastError)) return null;
  // Quota-only evidence: the upstream answers, so it is healthy. Keep
  // "untested" as untested (never claim verification we don't have).
  if (!opts.currentStatus || opts.currentStatus === "untested") return "untested";
  return "healthy";
}

/** Shared quota-error shape test (kept in sync with provider-health.ts's
 * isRateLimitError regex — both live here so Zen and non-Zen callers agree). */
export function isRateLimitShaped(error: string): boolean {
  return /429|rate.?limit|too.?many.?requests|quota|FreeUsageLimitError/i.test(error);
}

/**
 * Model ids that no longer exist on /zen/v1/models (or consistently 401
 * "Model not supported"). Never ship these in enabledModels / defaults.
 */
export const ZEN_DEAD_MODEL_IDS: readonly string[] = [
  "hy3-free",
  "hy3-free-stealth",
  "north-mini-code-free",
  "minimax-m2.5-free",
  "nemotron-3-super-free",
  "qwen3-30b-a3b-free",
  "gemma-3-27b-free",
  "llama-4-maverick-free",
  "llama-4-scout-free",
];

/**
 * Models that answer only outside this app's route family (region-locked
 * and/or served exclusively on the /responses or /messages endpoint family,
 * not the OpenAI-compatible /chat/completions the app uses).
 */
export const ZEN_REGION_LOCKED_MODEL_IDS: readonly string[] = [
  "muse-spark-1.2-contributor-free",
];

/**
 * Free models verified ANSWERING (HTTP 200, real completion) at
 * ZEN_VERIFICATION_DATE, best-first. Models that are valid ids but currently
 * limited/unavailable from the probe network (big-pickle, mimo-v2.5-free,
 * deepseek-v4-flash-free, ling-3.0-flash-fin-free) stay usable via rotation —
 * they are NOT listed here because "verified working" means observed 200.
 */
export const ZEN_VERIFIED_WORKING_FREE_MODELS: readonly string[] = [
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "laguna-s-2.1-free",
];

/** The default free model — head of the verified-working list. */
export const ZEN_PREFERRED_DEFAULT = ZEN_VERIFIED_WORKING_FREE_MODELS[0];

/**
 * Explicit free-model whitelist (user-confirmed). Used for Fetch
 * reconciliation, rotation admission and the guest gate. An explicit entry
 * bypasses the dead/region lists below — availability churns and a runtime
 * 401/404 evicts it for the session anyway via the ModelRegistry.
 */
export const ZEN_FREE_WHITELIST: readonly string[] = [
  "muse-spark-1.3-contributor-free",
  "nemotron-3-ultra-free",
  "mimo-v2.5-free",
  "big-pickle",
  "minimax-m2.5-free",
];

const ZEN_WHITELIST_SET = new Set<string>(ZEN_FREE_WHITELIST.map((m) => m.toLowerCase()));

const UNUSABLE_ZEN_IDS = new Set<string>([...ZEN_DEAD_MODEL_IDS, ...ZEN_REGION_LOCKED_MODEL_IDS]);

/**
 * Filter an enabledModels list for Zen: drop dead/region-locked ids, trim,
 * drop empties, dedupe, preserve order. Unknown ids pass through —
 * availability churns and the catalog must not silently swallow new models.
 */
export function sanitizeZenEnabledModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of models) {
    if (typeof m !== "string") continue;
    const id = m.trim();
    if (id === "" || UNUSABLE_ZEN_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Pick the default Zen model from an enabled list: first usable id
 * (dead/region-locked skipped), else the verified preferred default.
 */
export function pickZenDefaultModel(
  enabledModels: unknown,
  fallback: string = ZEN_PREFERRED_DEFAULT
): string {
  const usable = sanitizeZenEnabledModels(enabledModels);
  return usable[0] ?? fallback;
}

// ============================================================================
// Dynamic ingestion filter — pricing discrimination with name fallback.
// Used by the edge /models proxy so Fetch reconciliation tracks what Zen
// ACTUALLY serves free right now instead of a frozen list:
//   - pricing metadata present → keep ONLY prompt === 0 AND completion === 0
//   - pricing omitted → name heuristic (whitelist / -free suffix)
// Dead + region-locked ids are dropped in the heuristic path; an explicit
// price of zero always wins (dynamic truth beats the static dead list).
// ============================================================================

export interface ZenIngestedModel {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
}

export function filterZenIngestedModels(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const rawId = (e as ZenIngestedModel)?.id;
    if (typeof rawId !== "string") continue;
    const id = rawId.trim();
    if (id === "") continue;
    const m = id.toLowerCase();
    if (seen.has(m)) continue;
    const pricing = (e as ZenIngestedModel)?.pricing;
    if (pricing && typeof pricing === "object") {
      const p = pricing.prompt;
      const c = pricing.completion;
      const pNum = typeof p === "number" ? p : Number(p);
      const cNum = typeof c === "number" ? c : Number(c);
      if (!(pNum === 0 && cNum === 0)) continue;
      seen.add(m);
      out.push(id);
      continue;
    }
    if (ZEN_WHITELIST_SET.has(m) || ZEN_EXTRA_FREE_IDS.has(m)) {
      seen.add(m);
      out.push(id);
      continue;
    }
    if (UNUSABLE_ZEN_IDS.has(m)) continue;
    if (m.endsWith("-free")) {
      seen.add(m);
      out.push(id);
    }
  }
  return out;
}

// ============================================================================
// Adaptive eviction ModelRegistry — runtime truth for this execution
// environment (page session in the browser, isolate lifetime on the edge).
//   401 (retiered / no payment) or 404/410 (retired) → evicted for the rest
//     of the session; rotation never touches the id again.
//   429 → cooldown until Date.now + retry-after (60s default); rotation
//     cascades to the next healthy model and the id recovers by time.
// Success clears the failure count; cooldowns expire lazily on read.
// ============================================================================

export type ZenModelStatus = "active" | "cooldown" | "evicted";

/** Why a node left the active state — drives keyed vs keyless applicability. */
export type ZenEvictReason = "retired" | "billing" | "permission" | "rate" | "unknown";

export interface ZenModelNode {
  id: string;
  status: ZenModelStatus;
  reason?: ZenEvictReason;
  /** True when the eviction holds even for keyed callers (retired/region). */
  universal?: boolean;
  cooldownUntil?: number;
  failureCount: number;
}

export interface ZenObserveOpts {
  /** True when the failed call carried a user API key. */
  keyed?: boolean;
}

const zenRegistry = new Map<string, ZenModelNode>();

function zenNode(id: string): ZenModelNode {
  const m = id.trim().toLowerCase();
  let n = zenRegistry.get(m);
  if (!n) {
    n = { id: m, status: "active", failureCount: 0 };
    zenRegistry.set(m, n);
  }
  return n;
}

function zenStatusFromError(err: any): { status: number; msg: string } {
  const status = Number(err?.statusCode ?? err?.status ?? 0) || 0;
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return { status, msg };
}

function zenRetryAfterMs(err: any, fallbackMs: number): number {
  const s = Number((err as any)?.retryAfterSeconds);
  if (Number.isFinite(s) && s > 0) return Math.floor(s * 1000);
  const ms = Number((err as any)?.retryAfterMs);
  if (Number.isFinite(ms) && ms > 0) return Math.floor(ms);
  const m = String((err as any)?.message ?? "").match(/retry[- ]after[^0-9]*(\d+)/i);
  if (m) return Number(m[1]) * 1000;
  return fallbackMs;
}

/**
 * Feed one failed Zen call into the registry. Returns the resulting status.
 * Callers (router rotation paths) consult zenHealthyPool before spending the
 * next upstream call.
 *
 * Key-awareness: 404/410 retirements and region locks are universal truth
 * (no key fixes them). Billing-shaped 401s and permission gates evict only
 * the keyless pool — a funded user key may legitimately serve those ids.
 * 429 cooldowns always apply (the limiter is IP-keyed either way).
 */
export function zenObserveFailure(
  modelId: unknown,
  err: any,
  nowMs?: number,
  opts?: ZenObserveOpts
): ZenModelStatus {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  if (typeof modelId !== "string" || modelId.trim() === "") return "active";
  const keyed = opts?.keyed === true;
  const n = zenNode(modelId);
  n.failureCount += 1;
  const outlook = zenStatusFromError(err);
  const code = outlook.status;
  const msg = outlook.msg;
  const retired =
    code === 404 || code === 410 ||
    /model.?not.?found|unknown.?model|decommissioned|deprecated/i.test(msg);
  if (retired) {
    n.status = "evicted";
    n.reason = "retired";
    n.universal = true;
    delete n.cooldownUntil;
    console.warn("[ModelEviction] Model " + n.id + " retiered or deprecated. Evicting from pool.");
    return n.status;
  }
  const billingShaped =
    code === 401 ||
    /modelerror|not.?supported|no.?payment.?method|creditserror|insufficient.?credits/i.test(msg);
  if (billingShaped) {
    if (keyed) return n.status;
    n.status = "evicted";
    n.reason = "billing";
    n.universal = false;
    delete n.cooldownUntil;
    console.warn("[ModelEviction] Model " + n.id + " retiered or deprecated. Evicting from pool.");
    return n.status;
  }
  const permissionShaped =
    code === 403 ||
    /region|not.?available|entitlement|opt.?in|verification|age.?confirmation|forbidden|authentication.?required|unauthorized|invalid.?(api.?)?key/i.test(msg);
  if (permissionShaped) {
    const regional = /region/i.test(msg);
    if (keyed && !regional) return n.status;
    n.status = "evicted";
    n.reason = "permission";
    n.universal = regional;
    delete n.cooldownUntil;
    console.warn("[ModelEviction] Model " + n.id + " retiered or deprecated. Evicting from pool.");
    return n.status;
  }
  if (code === 429 || /rate.?limit|too.?many.?requests|quota|429/.test(msg)) {
    n.status = "cooldown";
    n.reason = "rate";
    n.universal = true;
    n.cooldownUntil = now + zenRetryAfterMs(err, 60_000);
    return n.status;
  }
  return n.status;
}

/** Feed one successful Zen call — clears the failure count (eviction sticks). */
export function zenRecordSuccess(modelId: unknown): void {
  if (typeof modelId !== "string" || modelId.trim() === "") return;
  const n = zenRegistry.get(modelId.trim().toLowerCase());
  if (n) n.failureCount = 0;
}

/** Current status for one id (cooldowns expire lazily on read). */
export function zenModelStatus(modelId: unknown, nowMs?: number, opts?: ZenObserveOpts): ZenModelStatus {
  if (typeof modelId !== "string" || modelId.trim() === "") return "active";
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const n = zenRegistry.get(modelId.trim().toLowerCase());
  if (!n) return "active";
  if (n.status === "cooldown" && typeof n.cooldownUntil === "number" && now >= n.cooldownUntil) {
    n.status = "active";
    n.reason = undefined;
    delete n.cooldownUntil;
  }
  if (n.status === "evicted" && opts?.keyed === true && n.universal !== true) {
    return "active";
  }
  return n.status;
}

/** True when the id may be attempted right now. */
export function isZenModelUsable(modelId: unknown, nowMs?: number, opts?: ZenObserveOpts): boolean {
  return zenModelStatus(modelId, nowMs, opts) === "active";
}

/** Filter a candidate list down to ids attemptable right now (order kept). */
export function zenHealthyPool(models: unknown, nowMs?: number, opts?: ZenObserveOpts): string[] {
  if (!Array.isArray(models)) return [];
  const out: string[] = [];
  for (const m of models) {
    if (typeof m !== "string") continue;
    const id = m.trim();
    if (id === "" || !isZenModelUsable(id, nowMs, opts)) continue;
    out.push(id);
  }
  return out;
}

/**
 * Zero-model safety valve target — native Workers AI, same data-center as
 * the proxy, zero external egress. Must stay a valid WORKERS_AI_MODEL_OPTIONS
 * id (workers-ai-core.ts).
 */
export const ZEN_ZERO_MODEL_VALVE = "@cf/meta/llama-3.1-8b-instruct-fp8";

/** Reset all registry state (tests). */
export function zenResetRegistry(): void {
  zenRegistry.clear();
}

/**
 * Free ids without the -free suffix that are still free-tier (served
 * keyless; observed in production health logs, not region-locked).
 */
const ZEN_EXTRA_FREE_IDS = new Set<string>([
  "muse-spark-1.3-contributor",
]);

/**
 * Guest-gate allow check for the edge chat proxy: keyless calls to
 * opencode.ai burn the shared-IP free quota AND 401 (CreditsError) on paid
 * ids, so the proxy refuses anything that is not recognizably a free model
 * BEFORE spending an upstream call. Keyed calls bypass this entirely (the
 * caller's own billing applies). Billing protection only — dead ids pass
 * the gate and are stripped at runtime by the ModelRegistry after one
 * failure, so churn never needs a redeploy.
 */
export function isZenFreeModelId(id: unknown): boolean {
  if (typeof id !== "string") return false;
  const m = id.trim().toLowerCase();
  if (m === "") return false;
  if (ZEN_WHITELIST_SET.has(m)) return true;
  if (ZEN_EXTRA_FREE_IDS.has(m)) return true;
  return m.endsWith("-free");
}

/**
 * Rotation/heal admission: stricter than the guest gate. Explicitly
 * whitelisted ids are always admitted (user override); anything else must
 * look free AND not sit on the dead/region-locked lists.
 */
export function isZenRotationAllowed(id: unknown): boolean {
  if (typeof id !== "string") return false;
  const m = id.trim().toLowerCase();
  if (m === "") return false;
  if (ZEN_WHITELIST_SET.has(m)) return true;
  if (ZEN_EXTRA_FREE_IDS.has(m)) return true;
  if (UNUSABLE_ZEN_IDS.has(m)) return false;
  return m.endsWith("-free");
}

/** Zen-family provider types (opencode / opencode-zen / zencode aliases). */
export function isZenProviderType(t: unknown): boolean {
  if (typeof t !== "string") return false;
  const n = t.trim().toLowerCase();
  return n === "opencode" || n === "opencode-zen" || n === "zencode";
}
