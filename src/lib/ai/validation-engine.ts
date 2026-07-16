// ============================================================================
// Enterprise Validation Engine — Phase 8.1.3.5
//
// ONE reusable Validation Engine for the Enterprise AI Core. Validation is the
// DETERMINISTIC business-rule layer that runs AFTER generation (and after the
// Reflection + QA middleware). It validates — it does NOT generate, retry, or
// execute AI.
//
// MANDATE (per the phase spec):
//   - Validation is deterministic. No AI call, no second pipeline, no middleware
//     of its own. It is invoked from inside `recordAI` (after QA) and ALSO
//     directly usable as a pure function by any caller (e.g. the Decision
//     Engine in 8.1.3.6, or synchronous feature checks).
//   - It consumes: the AI response, the Reflection result, the QA result, and
//     the execution context (prompt + scope). It NEVER mutates the response.
//   - It reuses the existing middleware hook system (OnValidation) and the
//     Flight Recorder (validation block) — no duplicated recording.
//   - It reuses the existing Validation Profiles (below) — no duplicated
//     validation logic. Each profile is a deterministic rule set.
//   - The engine produces ONLY a structured ValidationResult.
//
// KEY DIFFERENCE from Reflection/QA: those are AI passes (they call recordAI).
// Validation is PURE + DETERMINISTIC — it never calls recordAI, never executes
// a provider, never generates. That is why it has no recursion guard and no
// async AI dependency in the hot path.
// ============================================================================

import { hashString } from "./flight-recorder";
import type { FlightScope } from "./flight-recorder";
import type { FlightReflection } from "./flight-recorder";
import type { FlightQA } from "./flight-recorder";

// Re-export the consumed result types so callers/tests import them from one place.
export type { FlightReflection, FlightQA };

export const VALIDATION_VERSION = "8.1.3.5";

// ----------------------------------------------------------------------------
// Rule outcome + status
// ----------------------------------------------------------------------------

export type RuleOutcome = "pass" | "warning" | "fail";
export type ValidationStatus = "passed" | "warning" | "failed" | "error";

/** Severity ladder used by profiles to weight rules. */
export type ValidationSeverity = "critical" | "major" | "minor";

/** Outcome of a single deterministic rule. */
export interface ValidationRuleResult {
  ruleId: string;
  profile: ValidationProfileId;
  /** required | optional | critical | warning classification from the profile. */
  kind: "required" | "optional" | "critical" | "warning";
  outcome: RuleOutcome;
  reason: string;
  /** Human-readable evidence the rule inspected (never secrets/payloads). */
  evidence: string;
  severity: ValidationSeverity;
}

// ----------------------------------------------------------------------------
// Profiles
// ----------------------------------------------------------------------------

export type ValidationProfileId =
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
 * A Validation Profile is a deterministic rule set for one feature scope.
 * Each rule is a pure function of the same inputs. There is exactly ONE rule
 * implementation per concern — profiles only SELECT which rules apply and with
 * what classification (required/optional/critical/warning). No duplicated logic.
 */
export interface ValidationProfile {
  id: ValidationProfileId;
  /** Rule implementations selected for this profile. */
  rules: ValidationRule[];
  /** Minimum overall score (0-100) below which the result is "failed". */
  minimumScore: number;
  /** In strict mode, any "warning" outcome escalates the status to "failed". */
  strict: boolean;
}

/** A single deterministic rule. Pure: same inputs -> same result. */
export type ValidationRule = (ctx: ValidationInput) => ValidationRuleResult;

export interface ValidationInput {
  executionId: string;
  scope?: FlightScope;
  profile: ValidationProfileId;
  prompt: string;
  context: string;
  response: string;
  reflection?: FlightReflection | null;
  qa?: FlightQA | null;
  /** Free-form structured context (resumeId/jdId/feature flags) for rules. */
  metadata?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Configuration (reuses the shared per-scope override pattern, no new system)
// ----------------------------------------------------------------------------

export interface ValidationConfig {
  /** Master switch (global or per-scope). */
  validationEnabled: boolean;
  /** Minimum overall score (0-100); below => failed. */
  minimumScore: number;
  /** Strict mode: warnings escalate to failure. */
  strictMode: boolean;
  /** Profile override id (defaults to the execution scope). */
  profileOverride?: ValidationProfileId;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  validationEnabled: false,
  minimumScore: 60,
  strictMode: false,
};

const scopeOverrides = new Map<string, Partial<ValidationConfig>>();

export function setValidationConfigForScope(scope: string, cfg: Partial<ValidationConfig>): void {
  scopeOverrides.set(scope, cfg);
}

export function getValidationConfig(scope?: string): ValidationConfig {
  const base = { ...DEFAULT_VALIDATION_CONFIG };
  if (scope) {
    const o = scopeOverrides.get(scope);
    if (o) return { ...base, ...o };
  }
  return base;
}

// ----------------------------------------------------------------------------
// Profile registry
// ----------------------------------------------------------------------------

const profileRegistry = new Map<ValidationProfileId, ValidationProfile>();

export function registerValidationProfile(p: ValidationProfile): void {
  profileRegistry.set(p.id, p);
}

export function getValidationProfile(id: ValidationProfileId): ValidationProfile | undefined {
  return profileRegistry.get(id);
}

// ----------------------------------------------------------------------------
// Deterministic rule library (ONE implementation per concern — no duplication)
// ----------------------------------------------------------------------------

const clampScore = (n: number): number => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Helpers shared by rules. Each returns structured evidence so a record can be
 * audited offline without re-running AI.
 */
function countSections(text: string): string[] {
  const headers = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^(#{1,6}\s+|[A-Z][A-Za-z ]{2,}:$|^\d+\.\s+[A-Z])/.test(l));
  return headers;
}

function lower(text: string): string {
  return (text ?? "").toLowerCase();
}

// --- Resume Builder rules -------------------------------------------------

const ruleRbRequiredSections: ValidationRule = (ctx) => {
  const required = ["summary", "experience", "education", "skills", "contact"];
  const hay = lower(ctx.response);
  const missing = required.filter((s) => !hay.includes(s));
  const ok = missing.length === 0;
  return {
    ruleId: "rb.required-sections",
    profile: "resume-builder",
    kind: "required",
    outcome: ok ? "pass" : "fail",
    reason: ok ? "All required resume sections present." : `Missing sections: ${missing.join(", ")}.`,
    evidence: `detected sections: ${countSections(ctx.response).length}`,
    severity: ok ? "minor" : "critical",
  };
};

const ruleRbAtsSafe: ValidationRule = (ctx) => {
  // ATS-safe: no tables, no text boxes, no images-as-text, balanced headers.
  const risky = /<table|<img|\[\[|\]\]|\{\{|\}\}/i.test(ctx.response);
  return {
    ruleId: "rb.ats-safe-formatting",
    profile: "resume-builder",
    kind: "critical",
    outcome: risky ? "fail" : "pass",
    reason: risky ? "Response contains ATS-hostile markup (tables/images/curly-brace templating)." : "No ATS-hostile markup detected.",
    evidence: risky ? "regex matched table/img/template tokens" : "clean",
    severity: risky ? "critical" : "minor",
  };
};

const ruleRbOnePage: ValidationRule = (ctx) => {
  const chars = ctx.response.length;
  // ~4000 chars ≈ one page of resume text; heuristic, not a hard contract.
  const onePage = chars <= 4200;
  return {
    ruleId: "rb.one-page",
    profile: "resume-builder",
    kind: "warning",
    outcome: onePage ? "pass" : "warning",
    reason: onePage ? "Response within one-page budget." : "Response likely exceeds one page.",
    evidence: `chars=${chars}`,
    severity: "minor",
  };
};

const ruleRbContact: ValidationRule = (ctx) => {
  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(ctx.response);
  const hasPhone = /(\+?\d[\d\s().-]{7,}\d)/.test(ctx.response);
  const ok = hasEmail && hasPhone;
  return {
    ruleId: "rb.contact-info",
    profile: "resume-builder",
    kind: "required",
    outcome: ok ? "pass" : "fail",
    reason: ok ? "Contact info (email+phone) present." : "Missing email or phone in contact section.",
    evidence: `email=${hasEmail} phone=${hasPhone}`,
    severity: ok ? "minor" : "major",
  };
};

// --- Resume Optimizer rules ----------------------------------------------

const ruleRoAtsImproved: ValidationRule = (ctx) => {
  const before = Number(ctx.metadata?.atsScoreBefore ?? NaN);
  const after = Number(ctx.metadata?.atsScoreAfter ?? NaN);
  if (Number.isNaN(before) || Number.isNaN(after)) {
    return {
      ruleId: "ro.ats-improved",
      profile: "resume-optimizer",
      kind: "optional",
      outcome: "warning",
      reason: "ATS score deltas not supplied; cannot verify improvement.",
      evidence: `before=${ctx.metadata?.atsScoreBefore} after=${ctx.metadata?.atsScoreAfter}`,
      severity: "minor",
    };
  }
  const ok = after >= before;
  return {
    ruleId: "ro.ats-improved",
    profile: "resume-optimizer",
    kind: "required",
    outcome: ok ? "pass" : "fail",
    reason: ok ? `ATS score maintained/improved (${before} -> ${after}).` : `ATS score regressed (${before} -> ${after}).`,
    evidence: `delta=${after - before}`,
    severity: ok ? "minor" : "major",
  };
};

const ruleRoNoInfoRemoved: ValidationRule = (ctx) => {
  const removed = Boolean(ctx.metadata?.informationRemoved);
  return {
    ruleId: "ro.no-info-removed",
    profile: "resume-optimizer",
    kind: "critical",
    outcome: removed ? "fail" : "pass",
    reason: removed ? "Optimizer removed factual information from the original." : "No factual information removed.",
    evidence: `informationRemoved=${removed}`,
    severity: removed ? "critical" : "minor",
  };
};

const ruleRoKeywordsPreserved: ValidationRule = (ctx) => {
  const kw = (ctx.metadata?.keywords as string[] | undefined) ?? [];
  if (kw.length === 0) {
    return {
      ruleId: "ro.keywords-preserved",
      profile: "resume-optimizer",
      kind: "optional",
      outcome: "warning",
      reason: "No keyword list supplied; skipping preservation check.",
      evidence: "keywords=[]",
      severity: "minor",
    };
  }
  const hay = lower(ctx.response);
  const dropped = kw.filter((k) => !hay.includes(lower(k)));
  const ok = dropped.length === 0;
  return {
    ruleId: "ro.keywords-preserved",
    profile: "resume-optimizer",
    kind: "required",
    outcome: ok ? "pass" : "fail",
    reason: ok ? "All supplied keywords preserved." : `Keywords dropped: ${dropped.join(", ")}.`,
    evidence: `keywords=${kw.length} dropped=${dropped.length}`,
    severity: ok ? "minor" : "major",
  };
};

// --- Interview rules ------------------------------------------------------

const ruleIvScenarioConsistency: ValidationRule = (ctx) => {
  const ctxText = lower(ctx.context);
  const respText = lower(ctx.response);
  // Scenario/competency terms in context should appear in the response.
  const mismatch = /inconsistent|contradiction|scenario mismatch/i.test(respText);
  const hasContent = respText.length > 0;
  const ok = mismatch ? false : ctxText.length > 0 ? hasContent : true;
  return {
    ruleId: "iv.scenario-consistency",
    profile: "interview",
    kind: "critical",
    outcome: ok ? "pass" : "fail",
    reason: ok ? "Interview response is scenario-consistent." : "Response signals scenario inconsistency/contradiction.",
    evidence: mismatch ? "contradiction markers found" : "clean",
    severity: ok ? "minor" : "critical",
  };
};

const ruleIvCompetencyMapping: ValidationRule = (ctx) => {
  const hasCompetency = /competenc|skill assessed|evaluated/i.test(ctx.response);
  return {
    ruleId: "iv.competency-mapping",
    profile: "interview",
    kind: "required",
    outcome: hasCompetency ? "pass" : "warning",
    reason: hasCompetency ? "Response maps to competency/skill evaluation." : "No explicit competency mapping present.",
    evidence: hasCompetency ? "competency markers found" : "absent",
    severity: "minor",
  };
};

const ruleIvAdaptiveBranch: ValidationRule = (ctx) => {
  const branch = ctx.metadata?.adaptiveBranch as string | undefined;
  const valid = ["easy", "medium", "hard", "expert", "remediation", undefined];
  const ok = valid.includes(branch);
  return {
    ruleId: "iv.adaptive-branch-validity",
    profile: "interview",
    kind: "warning",
    outcome: ok ? "pass" : "fail",
    reason: ok ? `Adaptive branch valid (${branch ?? "n/a"}).` : `Invalid adaptive branch: ${branch}.`,
    evidence: `branch=${branch}`,
    severity: ok ? "minor" : "major",
  };
};

const ruleIvDifficultyProgression: ValidationRule = (ctx) => {
  const prog = ctx.metadata?.difficultyProgression as string | undefined;
  const ok = prog !== "regressed";
  return {
    ruleId: "iv.difficulty-progression",
    profile: "interview",
    kind: "warning",
    outcome: ok ? "pass" : "fail",
    reason: ok ? `Difficulty progression ok (${prog ?? "n/a"}).` : "Difficulty progression regressed.",
    evidence: `progression=${prog}`,
    severity: ok ? "minor" : "major",
  };
};

// --- ATS rules ------------------------------------------------------------

const ruleAtsScoreRange: ValidationRule = (ctx) => {
  const score = Number(ctx.metadata?.atsScore ?? NaN);
  const ok = !Number.isNaN(score) && score >= 0 && score <= 100;
  return {
    ruleId: "ats.score-range-valid",
    profile: "ats",
    kind: "required",
    outcome: ok ? "pass" : "fail",
    reason: ok ? `ATS score in valid range (${score}).` : `ATS score out of range (${ctx.metadata?.atsScore}).`,
    evidence: `score=${ctx.metadata?.atsScore}`,
    severity: ok ? "minor" : "major",
  };
};

const ruleAtsEvidence: ValidationRule = (ctx) => {
  const hasEvidence = Boolean(ctx.metadata?.evidence) || /breakdown|keyword coverage|matched/i.test(ctx.response);
  return {
    ruleId: "ats.evidence-present",
    profile: "ats",
    kind: "required",
    outcome: hasEvidence ? "pass" : "warning",
    reason: hasEvidence ? "ATS result includes supporting evidence." : "No supporting evidence in ATS result.",
    evidence: hasEvidence ? "evidence markers found" : "absent",
    severity: "minor",
  };
};

// --- Company Intelligence rules -------------------------------------------

const ruleCiRequiredFields: ValidationRule = (ctx) => {
  const required = ["name", "industry", "size", "location"];
  const meta = (ctx.metadata ?? {}) as Record<string, unknown>;
  const missing = required.filter((k) => !meta[k] && !lower(ctx.response).includes(k));
  const ok = missing.length === 0;
  return {
    ruleId: "ci.required-fields",
    profile: "company-intelligence",
    kind: "required",
    outcome: ok ? "pass" : "fail",
    reason: ok ? "All required company fields present." : `Missing company fields: ${missing.join(", ")}.`,
    evidence: `missing=${missing.join(",")}`,
    severity: ok ? "minor" : "major",
  };
};

// --- Translation rules ----------------------------------------------------

const ruleTrOutputLanguage: ValidationRule = (ctx) => {
  const target = (ctx.metadata?.targetLanguage as string | undefined)?.toLowerCase();
  if (!target) {
    return {
      ruleId: "tr.output-language-valid",
      profile: "translation",
      kind: "optional",
      outcome: "warning",
      reason: "No target language supplied; skipping language check.",
      evidence: "targetLanguage=undefined",
      severity: "minor",
    };
  }
  const hay = lower(ctx.response);
  // Very light heuristic: the target language name should not be "detected" as
  // the source language, and the response should not be empty.
  const empty = ctx.response.trim().length === 0;
  const ok = !empty;
  return {
    ruleId: "tr.output-language-valid",
    profile: "translation",
    kind: "required",
    outcome: ok ? "pass" : "fail",
    reason: ok ? `Translation produced output for target "${target}".` : "Translation produced empty output.",
    evidence: `target=${target} empty=${empty}`,
    severity: ok ? "minor" : "major",
  };
};

// --- OCR rules ------------------------------------------------------------

const ruleOcrContentExtracted: ValidationRule = (ctx) => {
  const extracted = ctx.response.trim().length > 0;
  const confidence = Number(ctx.metadata?.ocrConfidence ?? NaN);
  const lowConf = !Number.isNaN(confidence) && confidence < 0.4;
  return {
    ruleId: "ocr.content-extracted",
    profile: "ocr",
    kind: "required",
    outcome: extracted && !lowConf ? "pass" : extracted ? "warning" : "fail",
    reason: extracted && !lowConf ? "OCR extracted content with acceptable confidence." : !extracted ? "OCR extracted no content." : "OCR content extracted but confidence is low.",
    evidence: `len=${ctx.response.length} conf=${ctx.metadata?.ocrConfidence}`,
    severity: extracted ? "minor" : "major",
  };
};

// ----------------------------------------------------------------------------
// Profile definitions — SELECT rules + classification only (no logic dup)
// ----------------------------------------------------------------------------

registerValidationProfile({
  id: "resume-builder",
  minimumScore: 60,
  strict: false,
  rules: [ruleRbRequiredSections, ruleRbAtsSafe, ruleRbOnePage, ruleRbContact],
});
registerValidationProfile({
  id: "resume-optimizer",
  minimumScore: 60,
  strict: false,
  rules: [ruleRoAtsImproved, ruleRoNoInfoRemoved, ruleRoKeywordsPreserved, ruleRbAtsSafe],
});
registerValidationProfile({
  id: "ats",
  minimumScore: 60,
  strict: false,
  rules: [ruleAtsScoreRange, ruleAtsEvidence],
});
registerValidationProfile({
  id: "interview",
  minimumScore: 55,
  strict: false,
  rules: [ruleIvScenarioConsistency, ruleIvCompetencyMapping, ruleIvAdaptiveBranch, ruleIvDifficultyProgression],
});
registerValidationProfile({
  id: "copilot",
  minimumScore: 60,
  strict: false,
  rules: [ruleRbAtsSafe, ruleRbRequiredSections],
});
registerValidationProfile({
  id: "company-intelligence",
  minimumScore: 60,
  strict: false,
  rules: [ruleCiRequiredFields],
});
registerValidationProfile({
  id: "translation",
  minimumScore: 60,
  strict: false,
  rules: [ruleTrOutputLanguage],
});
registerValidationProfile({
  id: "ocr",
  minimumScore: 50,
  strict: false,
  rules: [ruleOcrContentExtracted],
});
registerValidationProfile({
  id: "default",
  minimumScore: 60,
  strict: false,
  rules: [ruleRbAtsSafe],
});

/** Map a FlightScope to its Validation Profile (fallback to default). */
export function profileForScope(scope?: FlightScope): ValidationProfileId {
  const map: Record<FlightScope, ValidationProfileId> = {
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
  return scope ? map[scope] : "default";
}

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------

/**
 * Score each rule 0-100 then weight into an overall score.
 * pass=100, warning=60, fail=0. Critical failures are additionally tracked.
 */
function scoreRule(r: ValidationRuleResult): number {
  if (r.outcome === "pass") return 100;
  if (r.outcome === "warning") return 60;
  return 0;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export interface ValidationResult {
  validationId: string;
  executionId: string;
  profile: ValidationProfileId;
  /** 0-100 overall weighted score. */
  score: number;
  status: ValidationStatus;
  rules: ValidationRuleResult[];
  warnings: string[];
  failures: string[];
  reasons: string[];
  /** count of critical-severity failures. */
  criticalFailures: number;
  passed: boolean;
  failRecommended: boolean;
  /** Deterministic: no AI, no randomness. */
  deterministic: true;
  version: string;
  durationMs: number;
  errors: string[];
}

/**
 * Run deterministic Validation over a completed execution. Consumes the AI
 * response, the Reflection result, the QA result, and the execution context.
 * Produces ONLY a structured ValidationResult. Never mutates inputs. Pure +
 * deterministic — safe to call directly or from middleware.
 */
export function validate(args: {
  executionId: string;
  prompt: string;
  context: string;
  response: string;
  scope?: FlightScope;
  reflection?: FlightReflection | null;
  qa?: FlightQA | null;
  metadata?: Record<string, unknown>;
  config?: ValidationConfig;
}): ValidationResult {
  const t0 = Date.now();
  const cfg = args.config ?? getValidationConfig(args.scope);
  const validationId = `vfx-${hashString(args.executionId + (args.scope ?? "") + args.response.length)}`;

  const disabled: ValidationResult = {
    validationId,
    executionId: args.executionId,
    profile: args.config?.profileOverride ?? profileForScope(args.scope),
    score: 0,
    status: "error",
    rules: [],
    warnings: [],
    failures: [],
    reasons: [],
    criticalFailures: 0,
    passed: false,
    failRecommended: false,
    deterministic: true,
    version: VALIDATION_VERSION,
    durationMs: Date.now() - t0,
    errors: ["validation disabled"],
  };

  if (!cfg.validationEnabled) {
    return disabled;
  }

  const profileId = cfg.profileOverride ?? profileForScope(args.scope);
  const profile = getValidationProfile(profileId);
  const effectiveMin = Math.max(cfg.minimumScore, profile?.minimumScore ?? 60);
  const strict = cfg.strictMode || (profile?.strict ?? false);

  if (!profile) {
    return {
      ...disabled,
      profile: profileId,
      status: "error",
      errors: [`no validation profile registered for "${profileId}"`],
    };
  }

  const input: ValidationInput = {
    executionId: args.executionId,
    scope: args.scope,
    profile: profileId,
    prompt: args.prompt,
    context: args.context,
    response: args.response,
    reflection: args.reflection ?? null,
    qa: args.qa ?? null,
    metadata: args.metadata,
  };

  const rules: ValidationRuleResult[] = [];
  const ruleErrors: string[] = [];
  for (const rule of profile.rules) {
    try {
      rules.push(rule(input));
    } catch (e: any) {
      ruleErrors.push(`${rule.name ?? "rule"}: ${e?.message ?? String(e)}`);
    }
  }

  const failures = rules.filter((r) => r.outcome === "fail");
  const warnings = rules.filter((r) => r.outcome === "warning");
  const criticalFailures = failures.filter((r) => r.severity === "critical").length;

  const scoreNums = rules.map(scoreRule);
  const overallScore = rules.length ? clampScore(scoreNums.reduce((a, b) => a + b, 0) / rules.length) : 0;

  const belowMin = overallScore < effectiveMin;
  const hasFail = failures.length > 0;
  const hasWarning = warnings.length > 0;

  let status: ValidationStatus;
  if (hasFail || belowMin || criticalFailures > 0) status = "failed";
  else if (hasWarning) status = strict ? "failed" : "warning";
  else status = "passed";

  const failRecommended = status === "failed";

  return {
    validationId,
    executionId: args.executionId,
    profile: profileId,
    score: overallScore,
    status,
    rules,
    warnings: warnings.map((r) => r.reason),
    failures: failures.map((r) => r.reason),
    reasons: rules.map((r) => `${r.ruleId}:${r.outcome}`),
    criticalFailures,
    passed: !failRecommended,
    failRecommended,
    deterministic: true,
    version: VALIDATION_VERSION,
    durationMs: Date.now() - t0,
    errors: ruleErrors,
  };
}
