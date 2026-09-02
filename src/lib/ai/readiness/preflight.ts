// ============================================================================
// AI Readiness Gate (directives #24–#29, #36, #46)
//
// BEFORE the Resume Optimizer starts, this gate performs a REAL preflight:
// every candidate provider/model combination gets an actual lightweight API
// request (single-provider pinned). A provider is READY only if the model
// answers — never merely because a key/endpoint/enabled flag exists.
//
// After the preflight: weighted READINESS SCORE per candidate → ranked →
// best model selected → validated fallback chain built → configuration
// LOCKED for the job (config-lock.ts).
//
// FAIL → CLASSIFY → TEMPORARY? → controlled backoff (router)
//                → MODEL/CONFIG ERROR? → AUTO-HEAL → VALIDATE → ONE repaired
//                  retry → SUCCESS = RECOVERED / FAIL = MANUAL HEAL
// (No infinite loops: the gate heals once and re-runs the preflight once.)
// ============================================================================

import { useApp } from "../../store";
import type { AIProvider } from "../../types";
import { ProviderRouter } from "../services/router";
import { classifyProviderFailure, type FailureClassification } from "../healing/error-classifier";
import { ProviderHealer, providerInCooldown, type HealerDeps } from "../healing/provider-healer";
import { resolveProviderBenchmarkModel } from "../healing/benchmark";
import { modelRegistry } from "../../model-registry";
import { setJobAILock, getJobAILock, activateFallback, getActiveJobModel, type JobAILock, type LockedModelRef } from "./config-lock";

export interface PreflightCandidate {
  providerId: string;
  providerName: string;
  model: string;
  modelSource: string;
  ok: boolean;
  latencyMs: number;
  readinessScore: number;
  scoreBreakdown?: { validity: number; reliability: number; latency: number; stability: number; capability: number };
  classification?: FailureClassification;
  reply?: string;
  error?: string;
}

export interface PreflightResult {
  at: string;
  candidates: PreflightCandidate[];
  passed: PreflightCandidate[];       // ranked best → worst
  selected: PreflightCandidate | null;
  fallbackChain: PreflightCandidate[];
  /** Every eligible provider id considered (pre-cap) — feeds the job lock. */
  eligibleIds: string[];
  totalMs: number;
}

export interface ReadinessGateResult {
  preflight: PreflightResult;
  preflightAfterHeal?: PreflightResult;
  healed: boolean;
  healReports: import("../healing/provider-healer").HealReportEntry[];
  lock: JobAILock | null;
  /** Human summary for the UI ("AI engine ready" / gate failure diagnostics). */
  summary: string;
}

const GATE_SYSTEM = "Respond in exactly one word: 'READY'. Do not write anything else.";
const GATE_USER = "status check";

// ---------------------------------------------------------------------------
// PREFLIGHT MODEL ROTATION (Zen free-model regression, 2026-08-30).
//
// Live evidence: the Zen free-usage limiter is keyed to the REQUESTER'S IP,
// not the API key — FreeUsageLimitError fires even with a brand-new key, and
// per-model upstream routes churn independently (one sibling 429s while
// another answers 200 from the same IP). The gate previously gave up on a
// provider whose CONFIGURED model was quota-limited, blocking the optimizer
// even though sibling free models answered fine.
//
// Fix: when the configured model's ping fails with a quota/model-class error,
// retry the ping through the provider's enabledModels siblings (bounded, same
// semantics as the router's model rotation) and report the WORKING model as
// candidate.model — so the job lock pins the model that actually answers.
// Auth errors NEVER rotate (another model on the same dead credential cannot
// help — router parity).
// ---------------------------------------------------------------------------

/** Max sibling-model pings after the configured model fails (router parity). */
export const PREFLIGHT_MODEL_ROTATION_CAP = 3;

const PING_AUTH_ERROR = /(^|\D)(401|402|403)(\D|$)|unauthorized|forbidden|invalid.?(api.?)?key|billing|credits?/i;
const PING_MODEL_ROTATION = /429|rate.?limit|too.?many.?requests|FreeUsageLimitError|quota|usage.?limit|invalid.?model|decommissioned|model[s]?[\s`"'/.\w-]{0,60}?(?:not.?found|does.?not.?exist|is.?not.?supported|unsupported|unavailable\b)/i;

/** Quota/model-class failures warrant trying sibling models; auth never does. */
export function errorWarrantsModelRotation(error?: string): boolean {
  if (!error) return false;
  if (PING_AUTH_ERROR.test(error)) return false;
  return PING_MODEL_ROTATION.test(error);
}

/** Weighted READINESS SCORE (directive #28) — NOT a blind average. */
export function computeReadinessScore(
  provider: AIProvider,
  ok: boolean,
  latencyMs: number,
  cls?: FailureClassification
): { score: number; breakdown: PreflightCandidate["scoreBreakdown"] } {
  if (!ok) return { score: 0, breakdown: { validity: 0, reliability: 0, latency: 0, stability: 0, capability: 0 } };

  // 1. Response validity — the real request succeeded (hard gate, weight 40).
  const validity = 40;

  // 2. Reliability — recent provider health (weight 25).
  const h = provider.health;
  const usage = provider.usage;
  const histTotal = usage?.requests ?? 0;
  const histSuccess = histTotal > 0 ? ((histTotal - (usage?.errors ?? 0)) / histTotal) : 0.85;
  const consec = h?.consecutiveFailures ?? 0;
  const reliability = Math.round(25 * (0.6 * histSuccess + 0.4 * Math.max(0, 1 - consec / 3)));

  // 3. Latency performance (weight 15): ≤1s full, linear to 0 at 10s.
  const latency = Math.round(15 * Math.max(0, Math.min(1, (10000 - latencyMs) / 9000)));

  // 4. Stability — cooldown/failure state right now (weight 10).
  const stability = providerInCooldown(provider) ? 2 : (consec === 0 ? 10 : Math.max(0, 10 - consec * 3));

  // 5. Capability — registry capability for this model, family heuristic fallback (weight 10).
  const entry = modelRegistry.findByProvider(provider.id).find((m) => m.modelName === (provider.modelName ?? ""));
  const capability = entry
    ? Math.round(10 * (entry.capabilities.atsScore / 100) * 0.7 + 10 * (entry.capabilities.jsonScore / 100) * 0.3)
    : /deepseek|gpt-4|gpt-5|claude|gemini|glm/i.test(provider.modelName ?? "")
      ? 8
      : 6;

  return { score: Math.min(100, validity + reliability + latency + stability + capability), breakdown: { validity, reliability, latency, stability, capability } };
}

/** Real preflight request against ONE pinned provider+model. */
async function pingCandidate(
  provider: AIProvider,
  model: string,
  timeoutMs: number,
  deps?: HealerDeps
): Promise<{ ok: boolean; latencyMs: number; reply?: string; error?: string }> {
  const t0 = performance.now?.() ?? Date.now();
  if (deps?.ping) {
    return deps.ping(provider, model);
  }
  try {
    const res = await ProviderRouter.chat(
      { messages: [{ role: "system", content: GATE_SYSTEM }, { role: "user", content: GATE_USER }], model, maxTokens: 5 },
      { preferredProviderId: provider.id, singleProvider: true, requestType: "test", timeoutMs }
    );
    return { ok: true, latencyMs: Math.round((performance.now?.() ?? Date.now()) - t0), reply: res.text.trim().slice(0, 40) };
  } catch (e: any) {
    return { ok: false, latencyMs: Math.round((performance.now?.() ?? Date.now()) - t0), error: e?.message ?? String(e) };
  }
}

/**
 * Run the readiness preflight across eligible providers.
 * Candidates are capped (best-effort ordering: default provider first) so the
 * gate stays fast; every candidate gets a REAL validation request.
 */
export async function runReadinessPreflight(opts: {
  maxCandidates?: number;
  timeoutMs?: number;
  providerIds?: string[];
  deps?: HealerDeps;
} = {}): Promise<PreflightResult> {
  const t0 = Date.now();
  const state = useApp.getState();
  const isSuperAdmin = state.user?.role === "super_admin";

  let eligible = (state.providers || []).filter((p) => {
    if (p.type === "puter" && typeof window === "undefined" && !opts.deps?.ping) return false;
    if (opts.providerIds) return opts.providerIds.includes(p.id);
    // Super-admins may run the optimizer on any reachable provider — they own
    // the instance and explicitly activate providers in the UI. Blocking on
    // isActive here would wrongly abort when the cloud sync hasn't reflected an
    // activation, or when a provider is merely "untested".
    if (isSuperAdmin) return p.status !== "down" && p.health?.healState !== "configuration_error";
    // Regular users: the provider must be active + user-accessible.
    return p.isActive && p.allowedForRegularUsers === true;
  });

  // Order: default provider first, then by priority — cap for speed.
  const defaultId = state.providerSettings?.defaultProviderId;
  eligible = eligible.sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : a.priority - b.priority));
  const eligibleIds = eligible.map((p) => p.id);
  if (opts.maxCandidates && eligible.length > opts.maxCandidates) eligible = eligible.slice(0, opts.maxCandidates);

  const candidates: PreflightCandidate[] = [];
  for (const provider of eligible) {
    const { model, source } = resolveProviderBenchmarkModel(provider);
    if (source === "none") {
      candidates.push({
        providerId: provider.id, providerName: provider.name, model: "(none configured)", modelSource: source,
        ok: false, latencyMs: 0, readinessScore: 0,
        classification: classifyProviderFailure("no model configured for provider", { providerType: provider.type }),
        error: "No model configured for this provider",
      });
      continue;
    }
    const coolerMs = provider.health?.rateLimitedUntil
      ? new Date(provider.health.rateLimitedUntil).getTime() - Date.now()
      : 0;
    if (coolerMs > 0) {
      // Still run the REAL preflight ping below — the gate IS the validation,
      // and a cooldown is often already expired or provider-specific. A transient
      // rate-limit must never produce a false "no validated AI engine" abort;
      // the actual ping result decides readiness. (Cooldown only lowers the
      // readiness score in computeReadinessScore — no separate candidate is
      // pushed here, so the single real-ping result is what's recorded.)
      // Fall through to the real ping.
    }

    const pingTimeout = opts.timeoutMs ?? Math.min(15000, provider.timeout || 15000);
    let ping = await pingCandidate(provider, model, pingTimeout, opts.deps);
    let usedModel = model;
    if (!ping.ok && errorWarrantsModelRotation(ping.error)) {
      // Gate parity with the router's model rotation: try sibling free models
      // (bounded) before declaring the provider not-ready. The 429 free limiter
      // is per-IP/per-model — a sibling frequently answers when the configured
      // model's pool is exhausted.
      const siblings = ((provider.enabledModels as string[] | undefined) ?? [])
        .filter((m) => typeof m === "string" && m.trim() !== "" && m !== model);
      let tried = 0;
      for (const alt of siblings) {
        if (tried >= PREFLIGHT_MODEL_ROTATION_CAP) break;
        tried++;
        const altPing = await pingCandidate(provider, alt, pingTimeout, opts.deps);
        if (altPing.ok) {
          ping = altPing;
          usedModel = alt;
          break;
        }
      }
    }
    const cls = ping.ok ? undefined : classifyProviderFailure(ping.error ?? "", { providerType: provider.type });
    const { score, breakdown } = computeReadinessScore(provider, ping.ok, ping.latencyMs, cls);
    candidates.push({
      providerId: provider.id, providerName: provider.name, model: usedModel, modelSource: source,
      ok: ping.ok, latencyMs: ping.latencyMs, readinessScore: score, scoreBreakdown: breakdown,
      classification: cls, reply: ping.reply, error: ping.error,
    });
  }

  const passed = candidates
    .filter((c) => c.ok)
    .sort((a, b) => (b.readinessScore - a.readinessScore) || (a.latencyMs - b.latencyMs));

  return {
    at: new Date().toISOString(),
    candidates,
    passed,
    selected: passed[0] ?? null,
    fallbackChain: passed.slice(1, 4),
    eligibleIds,
    totalMs: Date.now() - t0,
  };
}

function toRef(c: PreflightCandidate): LockedModelRef {
  return { providerId: c.providerId, providerName: c.providerName, model: c.model, readinessScore: c.readinessScore, latencyMs: c.latencyMs };
}

/**
 * The FULL gate (directive #45): preflight → (if nothing passed) one round of
 * Auto-Heal → one preflight retry → lock or fail with per-provider diagnostics.
 * NEVER an infinite loop: at most one heal + one re-run.
 */
export async function runReadinessGate(opts: {
  jobId?: string;
  maxCandidates?: number;
  timeoutMs?: number;
  deps?: HealerDeps;
} = {}): Promise<ReadinessGateResult> {
  const preflight = await runReadinessPreflight(opts);
  let preflightAfterHeal: PreflightResult | undefined;
  let healed = false;
  const healReports: import("../healing/provider-healer").HealReportEntry[] = [];

  if (preflight.passed.length === 0) {
    // Nothing validated — attempt ONE round of safe Auto-Heal, then re-run once.
    const autoHeal = useApp.getState().providerSettings?.autoHealProviders !== false;
    if (autoHeal) {
      const reports = await ProviderHealer.healAllProviders("auto", opts.deps);
      healReports.push(...reports);
      healed = reports.length > 0;
      if (healed) {
        preflightAfterHeal = await runReadinessPreflight(opts);
      }
    }
  }

  const effective = preflightAfterHeal && preflightAfterHeal.passed.length > 0 ? preflightAfterHeal : preflight;

  if (effective.passed.length === 0) {
    // ABSOLUTE RULE (#46): no validated provider+model → optimization MUST NOT start.
    const diag = effective.candidates
      .map((c, i) => `${i + 1}. ${c.providerName} (${c.model}): ${c.classification?.humanMessage ?? c.error ?? "failed"}`)
      .join("\n");
    return {
      preflight, preflightAfterHeal, healed, healReports, lock: null,
      summary: `No AI provider passed the readiness preflight${healed ? " (Auto-Heal was attempted)" : ""}. Optimization cannot start.\n${diag}`,
    };
  }

  // === LOCK the validated configuration for this job (directive #30) ===
  const jobId = opts.jobId ?? `job_${Date.now()}`;
  const lock: JobAILock = {
    jobId,
    lockedAt: new Date().toISOString(),
    primary: toRef(effective.selected!),
    fallbacks: effective.fallbackChain.map(toRef),
    eligibleProviderIds: effective.eligibleIds,
    activeIndex: 0,
    failoverCount: 0,
    events: [{ at: new Date().toISOString(), type: "recovered", note: `AI engine ready: ${effective.selected!.providerName} — ${effective.selected!.model} (readiness ${effective.selected!.readinessScore}/100, ${effective.selected!.latencyMs}ms)` }],
  };
  setJobAILock(lock);

  return {
    preflight, preflightAfterHeal, healed, healReports, lock,
    summary: `AI engine ready — ${effective.selected!.providerName} (${effective.selected!.model}), readiness ${effective.selected!.readinessScore}/100, ${effective.selected!.latencyMs}ms. ${effective.fallbackChain.length} validated fallback${effective.fallbackChain.length === 1 ? "" : "s"} locked.`,
  };
}

/**
 * SUPERVISED RECOVERY CYCLE (directives #14, #35) — mid-job failure handling:
 *   FAIL → CLASSIFY → healable? → AUTO-HEAL → VALIDATE
 *        → recovered? → RETRY ONCE with the repaired configuration
 *        → else FAILOVER to the next PRE-VALIDATED fallback
 * Exactly ONE recovery cycle per call — never an infinite retry loop.
 */
export async function supervisedRecovery(
  err: any,
  opts?: { deps?: HealerDeps }
): Promise<{ providerId: string; model: string } | null> {
  const lock = getJobAILock();
  if (!lock) return null;
  const rawMsg = String(err?.message ?? err ?? "");
  const cls = classifyProviderFailure(rawMsg);
  const active = getActiveJobModel();

  // 1. Safe Auto-Heal of the active provider (model/endpoint repairs only).
  if (cls.healable && active) {
    const report = await ProviderHealer.healProvider(active.providerId, "auto", rawMsg, opts?.deps);
    if (report.result === "recovered") {
      const { recordLockEvent } = await import("./config-lock");
      recordLockEvent("healed", `${active.providerName}: ${report.action}`);
      return { providerId: active.providerId, model: report.newModel ?? active.model };
    }
  }

  // 2. Not recoverable → SUPERVISOR FAILOVER to a pre-validated fallback.
  const next = await supervisorFailover(rawMsg, opts?.deps);
  if (next) return { providerId: next.providerId, model: next.model };
  return null;
}

/**
 * SUPERVISOR FAILOVER PROTOCOL (directives #35, #36, #50): if the active model
 * fails mid-job, the supervisor activates the highest-ranked PRE-VALIDATED
 * fallback. Directive #36 is absolute: the ACTIVE route may never reference an
 * unvalidated provider — so a fallback that fails its validation ping is
 * SKIPPED (recorded, never activated) and the walk continues down the chain.
 * When no fallback validates, the function returns null and the lock still
 * points at the declared primary — the caller surfaces the real error and the
 * pipeline stops safely (§50 scenario 3). Fixes the earlier recursion that
 * activated a refused fallback (activeIndex landed on a just-refused provider
 * and failoverCount was inflated without any actual switch).
 */
export async function supervisorFailover(reason: string, deps?: HealerDeps): Promise<LockedModelRef | null> {
  const lock = getJobAILock();
  if (!lock) return null;
  for (let i = lock.activeIndex; i < lock.fallbacks.length; i++) {
    const candidate = lock.fallbacks[i];
    const provider = useApp.getState().providers.find((p) => p.id === candidate.providerId);
    if (provider && !providerInCooldown(provider)) {
      // Verify current health before switching (no unvalidated fallbacks).
      const ping = await pingCandidate(provider, candidate.model, 15000, deps);
      if (ping.ok) {
        activateFallback(i, `Failover: ${reason}`);
        return getActiveJobModel();
      }
    }
    // Refused (failed ping / cooldown / missing provider) — record for
    // observability, never activate. The active route stays on the last
    // VALIDATED position until a fallback actually passes validation.
    lock.events.push({
      at: new Date().toISOString(),
      type: "failover",
      note: `Fallback ${candidate.providerName} refused — continuing down the chain: ${reason}`,
    });
  }
  return null;
}
