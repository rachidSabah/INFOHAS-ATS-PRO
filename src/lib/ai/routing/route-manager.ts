// ============================================================================
// Route Manager — the ONLY component authorized to change the AI execution
// route (directives #12, #13, #15, #16, #17).
//
// Simplified architecture (directive #17):
//   Provider Registry → AI Health Manager → Route Manager → Job AI Lock
//   → Pipeline Context → Supervisor → Agents → QA/Reflection/Recovery
//
// Candidate admission pipeline (directive #12) — replaces blind rotation:
//   discovery → compatibility validation → authentication validation
//   → availability validation → health validation → ranking → execution
// Only validated candidates may enter rotation.
//
// The Supervisor keeps ORCHESTRATION; this module keeps ROUTING. Agents never
// contain provider-specific logic and never select providers themselves.
// ============================================================================

import { aiHealthManager, type AIHealthRecord, type ModelAvailabilityState } from "../health/ai-health-manager";
import { checkModelCompatibility, type ProviderLike } from "./model-compatibility";
import { getJobAILock, getActiveJobModel, setJobAILock, activateFallback, type JobAILock, type LockedModelRef } from "../readiness/config-lock";
import { useApp } from "../../store";

// ----------------------------------------------------------------------------
// Types (directive #13 — HealthyExecutionRoute contract)
// ----------------------------------------------------------------------------

export interface HealthyExecutionRoute {
  providerId: string;
  providerName: string;
  canonicalModelId: string;
  capabilities: string[];
  healthStatus: AIHealthRecord["state"];
  availability: ModelAvailabilityState;
  latencyMs?: number;
  quotaStatus: AIHealthRecord["quotaState"];
  rateLimitState: AIHealthRecord["rateLimitState"];
  /** "free" | "paid" | "unknown" — never inferred from a $0 price (dir. #33). */
  pricing: "free" | "paid" | "unknown";
  /** Configuration id that produced this route (agent config / lock id). */
  configurationId: string;
  readinessScore?: number;
  resolvedAt: string;
}

export type FailoverReason =
  | "capability_mismatch"
  | "health_degradation"
  | "rate_limit"
  | "quota_exhausted"
  | "authentication_required"
  | "timeout"
  | "endpoint_error"
  | "unsupported_model"
  | "supervisor_failover";

export interface FailoverEvent {
  reason: FailoverReason;
  from: { providerId: string; canonicalModelId: string } | null;
  to: { providerId: string; canonicalModelId: string };
  timestamp: string;
  agent?: string;
  jobId?: string;
  note?: string;
}

export interface RouteCandidate {
  provider: ProviderLike;
  canonicalModelId: string;
  pricing?: "free" | "paid" | "unknown";
  capabilities?: string[];
  configurationId?: string;
}

export interface RouteResolution {
  route: HealthyExecutionRoute | null;
  /** Why resolution failed — surfaced verbatim to the UI/supervisor. */
  failureReason?: string;
  /** Per-candidate diagnostics in admission-pipeline order. */
  diagnostics: { providerId: string; model: string; stage: string; ok: boolean; reason?: string }[];
}

// ----------------------------------------------------------------------------
// Capabilities
// ----------------------------------------------------------------------------

export type AgentCapability =
  | "structured_output"
  | "streaming"
  | "reasoning"
  | "json_mode"
  | "vision"
  | "function_calling";

/**
 * Capability check — an agent genuinely requiring a capability unavailable on
 * the locked model triggers CONTROLLED failover (directive #15), never a
 * silent switch. Capability knowledge is derived from provider type + model
 * family, both of which are real, declared properties.
 */
export function modelSupportsCapability(provider: ProviderLike, canonicalModelId: string, capability: AgentCapability): boolean {
  const type = (provider.type || "").toLowerCase();
  const m = (canonicalModelId || "").toLowerCase();

  switch (capability) {
    case "streaming":
      // Browser-auth providers and OpenAI-compatible APIs support streaming.
      return !["image", "ocr"].includes(type);
    case "reasoning":
      return /(^|[-_/])(o1|o3|o4|r1|reasoner|thinking|deepseek-reasoner|qwq)/.test(m) || type === "antigravity";
    case "structured_output":
    case "json_mode":
      // JSON mode is broadly supported by OpenAI-compatible + major APIs.
      return !/^(puter$)/.test(type) || /gpt|claude|gemini/.test(m);
    case "vision":
      return /vision|vl|4o|gemini|claude-3|claude-4|pixtral|llava/.test(m);
    case "function_calling":
      return /gpt|claude|gemini|mistral|qwen|function/.test(m);
    default:
      return true;
  }
}

// ----------------------------------------------------------------------------
// Candidate admission pipeline (directive #12)
// ----------------------------------------------------------------------------

function capabilitiesOf(provider: ProviderLike, modelId: string): string[] {
  const caps: AgentCapability[] = ["structured_output", "streaming", "reasoning", "json_mode", "vision", "function_calling"];
  return caps.filter((c) => modelSupportsCapability(provider, modelId, c));
}

function pricingOf(explicit: "free" | "paid" | "unknown" | undefined, provider: ProviderLike): "free" | "paid" | "unknown" {
  if (explicit) return explicit;
  // Do NOT infer pricing from a $0.000000 display (directive #33). Only the
  // provider catalog's explicit free-tier markers count.
  const type = (provider.type || "").toLowerCase();
  if (["puter", "zai-web", "antigravity", "opencode", "opencode-zen", "zencode"].includes(type)) return "free";
  return "unknown";
}

function toHealthyRoute(
  provider: ProviderLike,
  canonicalModelId: string,
  record: AIHealthRecord,
  configurationId: string,
  pricing?: "free" | "paid" | "unknown",
  readinessScore?: number,
): HealthyExecutionRoute {
  return {
    providerId: provider.id,
    providerName: provider.name || provider.id,
    canonicalModelId,
    capabilities: capabilitiesOf(provider, canonicalModelId),
    healthStatus: record.state,
    availability: record.availability,
    latencyMs: record.latencyMs,
    quotaStatus: record.quotaState,
    rateLimitState: record.rateLimitState,
    pricing: pricingOf(pricing, provider),
    configurationId,
    readinessScore,
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Resolve a healthy execution route from candidates.
 * Admission pipeline per candidate: compatibility → authentication →
 * availability → health → ranking. The best VALIDATED candidate wins; if none
 * validate, resolution FAILS CLEANLY (no fabricated route, directive #29).
 */
export function resolveHealthyRoute(candidates: RouteCandidate[], jobId?: string): RouteResolution {
  const diagnostics: RouteResolution["diagnostics"] = [];
  const validated: { candidate: RouteCandidate; record: AIHealthRecord }[] = [];

  for (const candidate of candidates) {
    const { provider, canonicalModelId } = candidate;
    const label = provider.name || provider.id;

    // 1. Compatibility validation (provider can actually execute the model).
    const compat = checkModelCompatibility(provider, canonicalModelId);
    diagnostics.push({ providerId: provider.id, model: canonicalModelId, stage: "compatibility", ok: compat.compatible, reason: compat.reason });
    if (!compat.compatible) continue;

    // 2. Authentication validation.
    const health = aiHealthManager.getHealth(provider.id, canonicalModelId);
    const authOk = health.authState !== "not_authenticated";
    diagnostics.push({ providerId: provider.id, model: canonicalModelId, stage: "authentication", ok: authOk, reason: authOk ? undefined : "authentication_required" });
    if (!authOk) continue;

    // 3. Availability validation (quota / rate-limit / cooldown).
    const available = aiHealthManager.isAvailableNow(provider.id, canonicalModelId);
    diagnostics.push({ providerId: provider.id, model: canonicalModelId, stage: "availability", ok: available, reason: available ? undefined : health.state });
    if (!available) continue;

    // 4. Health validation — an explicitly failed pair is not executable.
    const healthOk = !["authentication_required", "quota_exhausted", "unsupported_model", "endpoint_error"].includes(health.state);
    diagnostics.push({ providerId: provider.id, model: canonicalModelId, stage: "health", ok: healthOk, reason: healthOk ? undefined : health.state });
    if (!healthOk) continue;

    validated.push({ candidate, record: health });
  }

  if (validated.length === 0) {
    return {
      route: null,
      failureReason: "No validated provider/model candidate — all candidates failed compatibility/auth/availability/health validation",
      diagnostics,
    };
  }

  // 5. Ranking — reuse the health registry ranking.
  const ranked = validated
    .map((v) => ({ ...v, rec: aiHealthManager.getHealth(v.candidate.provider.id, v.candidate.canonicalModelId) }))
    .sort((a, b) => scoreOf(b.rec, b.candidate) - scoreOf(a.rec, a.candidate));

  const best = ranked[0];
  const route = toHealthyRoute(
    best.candidate.provider,
    best.candidate.canonicalModelId,
    best.rec,
    best.candidate.configurationId || "route-manager",
    best.candidate.pricing,
  );
  logRoute("resolved", route, jobId);
  return { route, diagnostics };
}

function scoreOf(r: AIHealthRecord, c: RouteCandidate): number {
  let s = 0;
  if (r.state === "healthy") s += 100;
  else if (r.state === "degraded") s += 40;
  if (r.latencyMs != null) s += Math.max(0, 50 - Math.min(50, r.latencyMs / 200));
  s -= Math.min(60, r.failureCount * 10);
  if ((c.pricing ?? "unknown") === "free") s += 15;
  return s;
}

// ----------------------------------------------------------------------------
// Job route lock (directive #13) — ONE healthy route per optimization job
// ----------------------------------------------------------------------------

/**
 * Lock a validated healthy route to the optimization job. The Supervisor is
 * the ONLY caller (readiness gate). The lock becomes immutable for the job
 * unless an explicit failover occurs (via requestRouteFailover below).
 */
export function lockRouteToJob(
  route: HealthyExecutionRoute,
  fallbacks: HealthyExecutionRoute[],
  jobId: string,
): JobAILock {
  const toRef = (r: HealthyExecutionRoute): LockedModelRef => ({
    providerId: r.providerId,
    providerName: r.providerName,
    model: r.canonicalModelId,
    readinessScore: r.readinessScore ?? 0,
    latencyMs: r.latencyMs,
  });
  const lock: JobAILock = {
    jobId,
    lockedAt: new Date().toISOString(),
    primary: toRef(route),
    fallbacks: fallbacks.map(toRef),
    eligibleProviderIds: [route.providerId, ...fallbacks.map((f) => f.providerId)],
    activeIndex: 0,
    failoverCount: 0,
    events: [],
  };
  setJobAILock(lock);
  aiHealthManager.markLocked(route.providerId, route.canonicalModelId);
  logRoute("locked", route, jobId, "readiness_gate");
  return lock;
}

/** The currently locked route for the active job (or null). */
export function getLockedRoute(): HealthyExecutionRoute | null {
  const lock = getJobAILock();
  const active = getActiveJobModel();
  if (!lock || !active) return null;
  return {
    providerId: active.providerId,
    providerName: active.providerName,
    canonicalModelId: active.model,
    capabilities: [],
    healthStatus: aiHealthManager.getHealth(active.providerId, active.model).state,
    availability: "LOCKED",
    latencyMs: active.latencyMs,
    quotaStatus: aiHealthManager.getHealth(active.providerId, active.model).quotaState,
    rateLimitState: aiHealthManager.getHealth(active.providerId, active.model).rateLimitState,
    pricing: "unknown",
    configurationId: `job-lock:${lock.jobId}`,
    readinessScore: active.readinessScore,
    resolvedAt: lock.lockedAt,
  };
}

// ----------------------------------------------------------------------------
// Controlled failover (directive #15) — only Route Manager changes the route
// ----------------------------------------------------------------------------

const failoverLog: FailoverEvent[] = [];

/**
 * Request a compatible alternative route when an agent genuinely requires a
 * capability unavailable on the locked model. Detects the mismatch, asks the
 * health registry for validated alternatives, records a FailoverEvent and
 * returns the new route — or null (FAIL CLEANLY, directive #29). NEVER
 * silently switches.
 */
export function requestCapabilityFailover(opts: {
  jobId?: string;
  agent: string;
  requiredCapability: AgentCapability;
  currentRoute: HealthyExecutionRoute;
  candidates: RouteCandidate[];
}): { route: HealthyExecutionRoute | null; event: FailoverEvent | null; reason?: string } {
  const { jobId, agent, requiredCapability, currentRoute, candidates } = opts;

  const mismatchReason = `Agent "${agent}" requires capability "${requiredCapability}" unavailable on ${currentRoute.providerName}/${currentRoute.canonicalModelId}`;
  logFailover({
    reason: "capability_mismatch",
    from: { providerId: currentRoute.providerId, canonicalModelId: currentRoute.canonicalModelId },
    to: null as any,
    timestamp: new Date().toISOString(),
    agent,
    jobId,
    note: mismatchReason + " — searching compatible route",
  });

  const resolution = resolveHealthyRoute(
    candidates.filter(
      (c) =>
        !(c.provider.id === currentRoute.providerId && c.canonicalModelId === currentRoute.canonicalModelId),
    ),
    jobId,
  );

  if (!resolution.route) {
    // FAIL CLEANLY — no alternative exists. The caller must not fabricate.
    logFailover({
      reason: "capability_mismatch",
      from: { providerId: currentRoute.providerId, canonicalModelId: currentRoute.canonicalModelId },
      to: null as any,
      timestamp: new Date().toISOString(),
      agent,
      jobId,
      note: "No healthy compatible route — failing cleanly",
    });
    return { route: null, event: null, reason: resolution.failureReason };
  }

  const event: FailoverEvent = {
    reason: "capability_mismatch",
    from: { providerId: currentRoute.providerId, canonicalModelId: currentRoute.canonicalModelId },
    to: { providerId: resolution.route.providerId, canonicalModelId: resolution.route.canonicalModelId },
    timestamp: new Date().toISOString(),
    agent,
    jobId,
    note: mismatchReason,
  };
  failoverLog.push(event);
  logFailover(event);

  // Activate the pre-validated fallback in the job lock (Route Manager is the
  // only authority allowed to do this).
  const lock = getJobAILock();
  if (lock) {
    const idx = lock.fallbacks.findIndex((f) => f.providerId === resolution.route!.providerId && f.model === resolution.route!.canonicalModelId);
    if (idx >= 0) {
      activateFallback(idx, `capability_mismatch: ${agent} requires ${requiredCapability}`);
    }
  }

  return { route: resolution.route, event };
}

/** Record a health-driven supervisor failover (readiness-gate controlled). */
export function recordFailoverEvent(event: FailoverEvent): void {
  failoverLog.push(event);
  logFailover(event);
}

/** Failover history for observability (bounded). */
export function getFailoverEvents(limit = 50): FailoverEvent[] {
  return failoverLog.slice(-limit);
}

export function clearFailoverEvents(): void {
  failoverLog.length = 0;
}

// ----------------------------------------------------------------------------
// Observability (directive #46)
// ----------------------------------------------------------------------------

function logRoute(status: string, route: HealthyExecutionRoute, jobId?: string, authority?: string): void {
  console.info(
    `[AI_ROUTE] job=${jobId ?? "-"} provider=${route.providerName} model=${route.canonicalModelId} status=${status}${authority ? ` authority=${authority}` : ""} health=${route.healthStatus} latency=${route.latencyMs ?? "-"}`,
  );
}

function logFailover(e: FailoverEvent): void {
  console.warn(
    `[AI_FAILOVER] job=${e.jobId ?? "-"} agent=${e.agent ?? "-"} from=${e.from ? `${e.from.providerId}/${e.from.canonicalModelId}` : "none"} to=${e.to ? `${e.to.providerId}/${e.to.canonicalModelId}` : "none"} reason=${e.reason}${e.note ? ` note=${e.note}` : ""}`,
  );
}

// ----------------------------------------------------------------------------
// Store-backed candidate discovery (bridges the provider registry)
// ----------------------------------------------------------------------------

/**
 * Build route candidates from the live provider registry (store) for the
 * given provider ids — validated pairs only. This is the bridge between the
 * Provider Registry layer and the Route Manager layer.
 */
export function candidatesFromRegistry(providerIds?: string[]): RouteCandidate[] {
  let providers: ProviderLike[] = [];
  try {
    providers = (useApp.getState()?.providers ?? []) as ProviderLike[];
  } catch {
    providers = [];
  }
  const out: RouteCandidate[] = [];
  for (const p of providers) {
    if (providerIds && !providerIds.includes(p.id)) continue;
    if (p.status === "down" || p.isActive === false) continue;
    const models = new Set<string>(
      [...(p.enabledModels ?? []).map((m) => (m ?? "").trim()), (p.modelName ?? "").trim()].filter(Boolean),
    );
    for (const m of models) {
      const verdict = checkModelCompatibility(p, m);
      if (verdict.compatible) out.push({ provider: p, canonicalModelId: m, configurationId: "registry" });
    }
  }
  return out;
}
