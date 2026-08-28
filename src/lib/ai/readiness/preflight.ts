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
    if (!p.isActive || p.type === "puter") return false;
    if (opts.providerIds) return opts.providerIds.includes(p.id);
    return isSuperAdmin || p.allowedForRegularUsers === true;
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
    if (providerInCooldown(provider)) {
      candidates.push({
        providerId: provider.id, providerName: provider.name, model, modelSource: source,
        ok: false, latencyMs: 0, readinessScore: 0,
        classification: classifyProviderFailure("rate limit cooldown 429", { providerType: provider.type }),
        error: `In cooldown — ${Math.ceil((provider.health?.rateLimitedUntil ? new Date(provider.health.rateLimitedUntil).getTime() - Date.now() : 60000) / 1000)}s remaining`,
      });
      continue;
    }

    const ping = await pingCandidate(provider, model, opts.timeoutMs ?? Math.min(15000, provider.timeout || 15000), opts.deps);
    const cls = ping.ok ? undefined : classifyProviderFailure(ping.error ?? "", { providerType: provider.type });
    const { score, breakdown } = computeReadinessScore(provider, ping.ok, ping.latencyMs, cls);
    candidates.push({
      providerId: provider.id, providerName: provider.name, model, modelSource: source,
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
 * SUPERVISOR FAILOVER PROTOCOL (directive #35): if the active model fails
 * mid-job, the supervisor activates the highest-ranked PRE-VALIDATED fallback
 * (never an unvalidated one — directive #36). Returns the new active ref.
 */
export async function supervisorFailover(reason: string, deps?: HealerDeps): Promise<LockedModelRef | null> {
  const lock = getJobAILock();
  if (!lock) return null;
  // Try the next pre-validated fallback.
  const nextIndex = lock.activeIndex; // fallbacks[nextIndex-1+1] → fallbacks[nextIndex]
  if (nextIndex < lock.fallbacks.length) {
    const candidate = lock.fallbacks[nextIndex];
    // Verify current health before switching (no unvalidated fallbacks).
    const provider = useApp.getState().providers.find((p) => p.id === candidate.providerId);
    if (provider && !providerInCooldown(provider)) {
      const ping = await pingCandidate(provider, candidate.model, 15000, deps);
      if (ping.ok) {
        activateFallback(nextIndex, `Failover: ${reason}`);
        return getActiveJobModel();
      }
    }
    // That fallback failed validation — recurse once down the chain.
    activateFallback(nextIndex, `Fallback ${candidate.providerName} failed validation — continuing down the chain: ${reason}`);
    return supervisorFailover(reason, deps);
  }
  return null;
}
