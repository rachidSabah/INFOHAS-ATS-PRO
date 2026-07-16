// ============================================================================
// Enterprise Decision Engine — Phase 8.1.3.6
//
// ONE reusable Decision Engine for the Enterprise AI Core. The Decision Engine
// is the FINAL middleware stage: it consumes the upstream Reflection, QA, and
// Validation verdicts (plus execution context, feature config, and flight
// history) and returns a deterministic DecisionResult.
//
// MANDATE (per the phase spec):
//   - Decision is DETERMINISTIC. No AI call, no second pipeline, no middleware
//     of its own. It is invoked from inside `recordAI` (after Validation) and
//     ALSO directly usable as a pure function by any caller (e.g. the Retry
//     Engine in 8.1.3.7, or synchronous feature checks).
//   - It consumes: the Reflection result, the QA result, the Validation result,
//     and the execution context (scope). It NEVER mutates the response.
//   - It reuses the existing middleware hook system (OnDecision) and the Flight
//     Recorder (decision block) — no duplicated recording.
//   - It reuses the existing Decision Profiles (below) — no duplicated logic.
//     Each profile is a deterministic rule set.
//   - The engine produces ONLY a structured DecisionResult. It does NOT retry,
//     regenerate, or modify the response. RETRY is an EMIT-ONLY outcome this
//     phase: the engine may return status "retry", but re-execution belongs to
//     Phase 8.1.3.7.
//
// KEY DIFFERENCE from Reflection/QA: those are AI passes (they call recordAI).
// Validation + Decision are PURE + DETERMINISTIC — they never call recordAI,
// never execute a provider, never generate. That is why they need no recursion
// guard and no async AI dependency in the hot path.
// ============================================================================

import type { FlightScope } from "./flight-recorder";
import type { FlightReflection } from "./flight-recorder";
import type { FlightQA } from "./flight-recorder";
import type { FlightValidation } from "./flight-recorder";

// Re-export the consumed result types so callers/tests import them from one place.
export type { FlightReflection, FlightQA, FlightValidation };

export const DECISION_VERSION = "8.1.3.6";

// ----------------------------------------------------------------------------
// Decision status
// ----------------------------------------------------------------------------

export type DecisionStatus =
  | "accept"
  | "retry"
  | "reject"
  | "escalate"
  | "human_review"
  | "continue"
  | "stop";

// ----------------------------------------------------------------------------
// Rule outcome
// ----------------------------------------------------------------------------

export interface DecisionRuleResult {
  ruleId: string;
  profile: DecisionProfileId;
  status: DecisionStatus;
  /** 0-1 confidence the rule's verdict is correct. */
  confidence: number;
  reason: string;
  /** Human-readable evidence the rule inspected (never secrets/payloads). */
  evidence: string;
  /** Whether this rule fired (its condition matched). */
  triggered: boolean;
}

// ----------------------------------------------------------------------------
// Profiles
// ----------------------------------------------------------------------------

export type DecisionProfileId =
  | "resume-builder"
  | "resume-optimizer"
  | "ats"
  | "interview"
  | "copilot"
  | "company-intelligence"
  | "translation"
  | "ocr"
  | "default";

/**
 * A scope value accepted by `decide()` / `profileForScope()`. It is the union
 * of canonical `FlightScope`s plus the literal `"default"` (an explicit alias
 * that resolves to the default decision profile — useful for tests and direct
 * pure-function callers that don't carry a feature scope).
 */
export type DecisionScope = FlightScope | "default";

/**
 * A Decision Profile is a deterministic rule set for one feature scope. Each
 * rule is a pure function of the same inputs. There is exactly ONE rule
 * implementation per concern — profiles only SELECT which rules apply and with
 * what classification. No duplicated logic.
 */
export interface DecisionProfile {
  id: DecisionProfileId;
  /** Rules evaluated in priority order; first triggered rule wins. */
  rules: DecisionRule[];
  /** Strict mode: downgrade ACCEPT→HUMAN_REVIEW when any upstream is non-ok. */
  strict: boolean;
}

/** A single deterministic decision rule. Pure: same inputs -> same result. */
export type DecisionRule = (ctx: DecisionInput) => DecisionRuleResult;

export interface DecisionInput {
  executionId: string;
  scope?: DecisionScope;
  profile: DecisionProfileId;
  reflection?: FlightReflection | null;
  qa?: FlightQA | null;
  validation?: FlightValidation | null;
  /** Free-form structured context (resumeId/jdId/feature flags) for rules. */
  metadata?: Record<string, unknown>;
  /** Optional prior flight history (for STOP-on-repeat-terminal-failure). */
  history?: Array<{ status?: string; decisionStatus?: DecisionStatus }>;
  config?: DecisionConfig;
}

// ----------------------------------------------------------------------------
// Configuration (reuses the shared per-scope override pattern, no new system)
// ----------------------------------------------------------------------------

export interface DecisionConfig {
  /** Master switch (global or per-scope). */
  decisionEnabled: boolean;
  /** Strict mode: an ACCEPT becomes HUMAN_REVIEW if any upstream is non-ok. */
  strictMode: boolean;
  /** 0-1 confidence below which a low-confidence reflection → HUMAN_REVIEW. */
  confidenceThreshold: number;
  /** 0-1 QA policy risk above which → ESCALATE. */
  policyRiskThreshold: number;
  /** 0-1 reflection hallucination risk above which → ESCALATE. */
  hallucinationRiskThreshold: number;
  /** Consecutive terminal failures (reject) in history that trigger STOP. */
  stopAfterRepeatedFailures: number;
  /** Profile override id (defaults to the execution scope). */
  profileOverride?: DecisionProfileId;
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  decisionEnabled: false,
  strictMode: false,
  confidenceThreshold: 0.5,
  policyRiskThreshold: 0.6,
  hallucinationRiskThreshold: 0.6,
  stopAfterRepeatedFailures: 3,
};

const scopeOverrides = new Map<string, Partial<DecisionConfig>>();

export function setDecisionConfigForScope(scope: string, cfg: Partial<DecisionConfig>): void {
  scopeOverrides.set(scope, cfg);
}

export function getDecisionConfig(scope?: string): DecisionConfig {
  const base = { ...DEFAULT_DECISION_CONFIG };
  if (scope) {
    const o = scopeOverrides.get(scope);
    if (o) return { ...base, ...o };
  }
  return base;
}

// ----------------------------------------------------------------------------
// Profile registry
// ----------------------------------------------------------------------------

const profileRegistry = new Map<DecisionProfileId, DecisionProfile>();

export function registerDecisionProfile(p: DecisionProfile): void {
  profileRegistry.set(p.id, p);
}

export function getDecisionProfile(id: DecisionProfileId): DecisionProfile | undefined {
  return profileRegistry.get(id);
}

// ----------------------------------------------------------------------------
// Deterministic rule library (ONE implementation per concern — no duplication)
// ----------------------------------------------------------------------------

const clamp01 = (n: unknown): number => {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
};

// --- Validation-driven rules (highest precedence) -------------------------

const ruleValidationCriticalFailure: DecisionRule = (ctx) => {
  const v = ctx.validation;
  const critical = Boolean(v && v.criticalFailures > 0);
  return {
    ruleId: "dec.validation-critical-failure",
    profile: ctx.profile,
    status: "reject",
    confidence: 1,
    reason: critical ? `Validation reported ${v!.criticalFailures} critical failure(s).` : "",
    evidence: `criticalFailures=${v?.criticalFailures ?? 0}`,
    triggered: critical,
  };
};

const ruleValidationFailed: DecisionRule = (ctx) => {
  const v = ctx.validation;
  const failed = Boolean(v && (v.outcome === "failed" || v.failRecommended));
  return {
    ruleId: "dec.validation-failed",
    profile: ctx.profile,
    status: "reject",
    confidence: 1,
    reason: failed ? "Validation outcome is failed (or fail recommended)." : "",
    evidence: `outcome=${v?.outcome} failRecommended=${v?.failRecommended}`,
    triggered: failed,
  };
};

// --- QA-driven rules -------------------------------------------------------

const ruleCriticalQaFailure: DecisionRule = (ctx) => {
  const q = ctx.qa;
  const hasCritical = Boolean(q && q.findings?.some((f) => f.severity === "critical"));
  const bad = hasCritical || (Boolean(q && q.failRecommended && q.outcome === "failed"));
  return {
    ruleId: "dec.critical-qa-failure",
    profile: ctx.profile,
    status: "retry",
    confidence: clamp01(q?.confidence ? q.confidence / 100 : 0.8),
    reason: bad ? "QA reported a critical finding or failed with a critical recommendation." : "",
    evidence: `findings=${q?.findings?.length ?? 0} failRecommended=${q?.failRecommended} outcome=${q?.outcome}`,
    triggered: bad,
  };
};

const ruleQaFailed: DecisionRule = (ctx) => {
  const q = ctx.qa;
  const failed = Boolean(q && (q.failRecommended || q.outcome === "failed"));
  return {
    ruleId: "dec.qa-failed",
    profile: ctx.profile,
    status: "retry",
    confidence: clamp01(q?.confidence ? q.confidence / 100 : 0.7),
    reason: failed ? "QA recommended failure (non-critical)." : "",
    evidence: `failRecommended=${q?.failRecommended} outcome=${q?.outcome}`,
    triggered: failed,
  };
};

// --- Reflection-driven rules ----------------------------------------------

const ruleReflectionLowConfidence: DecisionRule = (ctx) => {
  const r = ctx.reflection;
  const threshold = ctx.config?.confidenceThreshold ?? 0.5;
  const low = Boolean(r && clamp01(r.confidence / 100) < threshold);
  return {
    ruleId: "dec.reflection-low-confidence",
    profile: ctx.profile,
    status: "human_review",
    confidence: 1,
    reason: low ? `Reflection confidence (${(r!.confidence / 100).toFixed(2)}) below threshold (${threshold}).` : "",
    evidence: `confidence=${r?.confidence} threshold=${threshold}`,
    triggered: low,
  };
};

const ruleReflectionRetryRecommended: DecisionRule = (ctx) => {
  const r = ctx.reflection;
  const retry = Boolean(r && r.retryRecommended);
  return {
    ruleId: "dec.reflection-retry-recommended",
    profile: ctx.profile,
    status: "retry",
    confidence: clamp01(r?.confidence ? r.confidence / 100 : 0.7),
    reason: retry ? `Reflection recommended retry: ${r!.retryReason || "(no reason given)"}` : "",
    evidence: `retryRecommended=${r?.retryRecommended} retryReason=${r?.retryReason}`,
    triggered: retry,
  };
};

// --- Cross-engine policy rules --------------------------------------------

const rulePolicyConflict: DecisionRule = (ctx) => {
  const q = ctx.qa;
  const r = ctx.reflection;
  const policyThreshold = ctx.config?.policyRiskThreshold ?? 0.6;
  const hallThreshold = ctx.config?.hallucinationRiskThreshold ?? 0.6;
  const policyHigh = Boolean(q && clamp01(q.policyRisk) >= policyThreshold);
  const hallHigh = Boolean(r && clamp01(r.hallucinationRisk) >= hallThreshold);
  const conflict = policyHigh || hallHigh;
  return {
    ruleId: "dec.policy-conflict",
    profile: ctx.profile,
    status: "escalate",
    confidence: 1,
    reason: conflict
      ? `Policy/hallucination risk elevated (policyRisk=${q?.policyRisk}, hallucinationRisk=${r?.hallucinationRisk}).`
      : "",
    evidence: `policyRisk=${q?.policyRisk} hallucinationRisk=${r?.hallucinationRisk}`,
    triggered: conflict,
  };
};

// --- History-driven STOP rule (config-gated) ------------------------------

const ruleStopOnRepeatedFailure: DecisionRule = (ctx) => {
  const limit = ctx.config?.stopAfterRepeatedFailures ?? 0;
  if (!limit || !ctx.history || ctx.history.length === 0) {
    return {
      ruleId: "dec.stop-on-repeated-failure",
      profile: ctx.profile,
      status: "stop",
      confidence: 1,
      reason: "",
      evidence: `limit=${limit} history=${ctx.history?.length ?? 0}`,
      triggered: false,
    };
  }
  const recent = ctx.history.slice(-limit);
  const allReject = recent.length >= limit && recent.every((h) => h.decisionStatus === "reject");
  return {
    ruleId: "dec.stop-on-repeated-failure",
    profile: ctx.profile,
    status: "stop",
    confidence: 1,
    reason: allReject ? `Reached ${limit} consecutive rejected decisions; halting automated attempts.` : "",
    evidence: `recent=${recent.map((h) => h.decisionStatus ?? "?").join(",")}`,
    triggered: allReject,
  };
};

// --- All-engines-pass → ACCEPT --------------------------------------------

const ruleAllPass: DecisionRule = (ctx) => {
  const r = ctx.reflection;
  const q = ctx.qa;
  const v = ctx.validation;
  const rOk = !r || r.outcome === "ok" || r.outcome === "error" ? true : r.retryRecommended === false;
  const qOk = !q || q.outcome === "passed" || q.outcome === "error" || q.failRecommended === false;
  const vOk = !v || v.outcome === "passed" || v.outcome === "warning" || v.outcome === "error" || v.failRecommended === false;
  const allOk = rOk && qOk && vOk;
  return {
    ruleId: "dec.all-engines-pass",
    profile: ctx.profile,
    status: "accept",
    confidence: 1,
    reason: allOk ? "All upstream engines passed (or were disabled); accepting." : "",
    evidence: `reflection=${r?.outcome} qa=${q?.outcome} validation=${v?.outcome}`,
    triggered: allOk,
  };
};

// --- Default fallback → CONTINUE ------------------------------------------

const ruleDefaultContinue: DecisionRule = (ctx) => ({
  ruleId: "dec.default-continue",
  profile: ctx.profile,
  status: "continue",
  confidence: 1,
  reason: "Decision enabled but no specific rule triggered; continuing.",
  evidence: "",
  triggered: true,
});

// ----------------------------------------------------------------------------
// Profile definitions — SELECT rules + classification only (no logic dup)
// ----------------------------------------------------------------------------

// Evaluation order = precedence: validation(critical/failed) > qa(critical/failed)
// > reflection(retry/low-confidence) > policy > history-stop > all-pass > continue.
const STANDARD_RULES: DecisionRule[] = [
  ruleValidationCriticalFailure,
  ruleValidationFailed,
  ruleCriticalQaFailure,
  ruleQaFailed,
  ruleReflectionRetryRecommended,
  ruleReflectionLowConfidence,
  rulePolicyConflict,
  ruleStopOnRepeatedFailure,
  ruleAllPass,
  ruleDefaultContinue,
];

registerDecisionProfile({ id: "resume-builder", strict: false, rules: STANDARD_RULES });
registerDecisionProfile({ id: "resume-optimizer", strict: false, rules: STANDARD_RULES });
registerDecisionProfile({ id: "ats", strict: false, rules: STANDARD_RULES });
registerDecisionProfile({ id: "interview", strict: false, rules: STANDARD_RULES });
registerDecisionProfile({ id: "copilot", strict: false, rules: STANDARD_RULES });
registerDecisionProfile({ id: "company-intelligence", strict: false, rules: STANDARD_RULES });
registerDecisionProfile({ id: "translation", strict: false, rules: STANDARD_RULES });
registerDecisionProfile({ id: "ocr", strict: false, rules: STANDARD_RULES });
registerDecisionProfile({ id: "default", strict: false, rules: STANDARD_RULES });

/** Map a FlightScope to its Decision Profile (fallback to default). */
export function profileForScope(scope?: DecisionScope): DecisionProfileId {
  const map: Record<FlightScope, DecisionProfileId> = {
    "resume-builder": "resume-builder",
    "resume-optimizer": "resume-optimizer",
    "ats-analysis": "ats",
    interview: "interview",
    "adaptive-interview": "interview",
    "resume-copilot": "copilot",
    "company-intelligence": "company-intelligence",
    translation: "translation",
    "resume-parser": "ocr",
    ocr: "ocr",
    "cover-letter": "default",
    "job-intelligence": "default",
    evaluation: "interview",
    "future-mcp": "default",
    "future-hermes": "default",
    "future-agents": "default",
    other: "default",
  };
  if (!scope || scope === "default") return "default";
  return map[scope];
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export interface DecisionResult {
  decisionId: string;
  executionId: string;
  profile: DecisionProfileId;
  status: DecisionStatus;
  reason: string;
  /** 0-1 overall confidence in the decision. */
  confidence: number;
  evidence: string;
  /** Ordered list of rule ids evaluated + whether each triggered. */
  trace: { ruleId: string; triggered: boolean; status: DecisionStatus }[];
  /** The rules that fired (triggered=true), with full detail. */
  rules: DecisionRuleResult[];
  supportingReflection?: string;
  supportingQA?: string;
  supportingValidation?: string;
  /** Deterministic: no AI, no randomness. */
  deterministic: true;
  version: string;
  durationMs: number;
  errors: string[];
}

/**
 * Make a deterministic execution decision over a completed execution. Consumes
 * the Reflection, QA, and Validation results plus the execution context.
 * Produces ONLY a structured DecisionResult. Never mutates inputs. Pure +
 * deterministic — safe to call directly or from middleware.
 *
 * IMPORTANT: a "retry" decision is EMIT-ONLY in this phase. The engine records
 * and flags it; re-execution is the mandate of Phase 8.1.3.7 (Retry Engine).
 */
export function decide(args: {
  executionId: string;
  scope?: DecisionScope;
  reflection?: FlightReflection | null;
  qa?: FlightQA | null;
  validation?: FlightValidation | null;
  metadata?: Record<string, unknown>;
  history?: Array<{ status?: string; decisionStatus?: DecisionStatus }>;
  config?: DecisionConfig;
}): DecisionResult {
  const t0 = Date.now();
  const cfg = args.config ?? getDecisionConfig(args.scope);
  const profileId = cfg.profileOverride ?? profileForScope(args.scope);
  const decisionId = `dcx-${hashDecision(args.executionId, args.scope, profileId)}`;

  const disabled: DecisionResult = {
    decisionId,
    executionId: args.executionId,
    profile: profileId,
    status: "continue",
    reason: "decision disabled",
    confidence: 1,
    evidence: "",
    trace: [],
    rules: [],
    deterministic: true,
    version: DECISION_VERSION,
    durationMs: Date.now() - t0,
    errors: [],
  };

  if (!cfg.decisionEnabled) {
    return disabled;
  }

  const profile = getDecisionProfile(profileId);
  if (!profile) {
    return {
      ...disabled,
      status: "continue",
      reason: `no decision profile registered for "${profileId}"`,
      errors: [`no decision profile registered for "${profileId}"`],
    };
  }

  const input: DecisionInput = {
    executionId: args.executionId,
    scope: args.scope,
    profile: profileId,
    reflection: args.reflection ?? null,
    qa: args.qa ?? null,
    validation: args.validation ?? null,
    metadata: args.metadata,
    history: args.history,
    config: cfg,
  };

  const trace: DecisionResult["trace"] = [];
  const triggered: DecisionRuleResult[] = [];
  let chosen: DecisionRuleResult | null = null;
  const ruleErrors: string[] = [];

  for (const rule of profile.rules) {
    let res: DecisionRuleResult;
    try {
      res = rule(input);
    } catch (e: any) {
      ruleErrors.push(`${rule.name ?? "rule"}: ${e?.message ?? String(e)}`);
      continue;
    }
    trace.push({ ruleId: res.ruleId, triggered: res.triggered, status: res.status });
    if (res.triggered) {
      triggered.push(res);
      if (!chosen) chosen = res; // first triggered rule wins (priority order)
    }
  }

  // If nothing triggered (shouldn't happen — default-continue always does),
  // fall back to continue.
  const finalRule = chosen ?? ruleDefaultContinue(input);
  if (!triggered.length) {
    trace.push({ ruleId: finalRule.ruleId, triggered: true, status: finalRule.status });
    triggered.push(finalRule);
  }

  // Strict mode: downgrade ACCEPT to HUMAN_REVIEW when any upstream is non-ok.
  let status = finalRule.status;
  if (cfg.strictMode && status === "accept") {
    const r = args.reflection;
    const q = args.qa;
    const v = args.validation;
    const nonOk =
      (r && r.outcome === "retry") ||
      (q && (q.outcome === "failed" || q.failRecommended)) ||
      (v && (v.outcome === "failed" || v.failRecommended));
    if (nonOk) {
      status = "human_review";
    }
  }

  return {
    decisionId,
    executionId: args.executionId,
    profile: profileId,
    status,
    reason: finalRule.reason || `Decision: ${status}.`,
    confidence: finalRule.confidence,
    evidence: finalRule.evidence,
    trace,
    rules: triggered,
    supportingReflection: args.reflection ? `${args.reflection.outcome} (score ${args.reflection.score})` : undefined,
    supportingQA: args.qa ? `${args.qa.outcome} (score ${args.qa.score})` : undefined,
    supportingValidation: args.validation ? `${args.validation.outcome} (score ${args.validation.score})` : undefined,
    deterministic: true,
    version: DECISION_VERSION,
    durationMs: Date.now() - t0,
    errors: ruleErrors,
  };
}

// Lightweight deterministic id (FNV-1a style, no external dep, no randomness).
function hashDecision(executionId: string, scope: DecisionScope | undefined, profile: string): string {
  const key = `${executionId}|${scope ?? ""}|${profile}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
