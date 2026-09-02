// ============================================================================
// OptimizerOutputValidator — directive §11 (keyword accountability) + §24/§25
// (no bad output propagation).
//
// Validates the Bullet-Only Optimizer's raw output BEFORE assembly and BEFORE
// any downstream agent (Resume Repair, QA, Reflection, Assembler) may consume
// it. A result that integrates zero JD keywords while the job description has
// actionable missing keywords is OPTIMIZATION INCOMPLETE — never a success.
//
// The validator is intentionally conservative: it never mutates the output,
// it only reports violations + a keyword coverage report the Supervisor uses
// to drive targeted recovery (retry with corrective feedback).
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import { JD_COMPANY_NAMES } from "../structure-guardian";

export interface KeywordCoverageReport {
  /** Priority/missing keywords evaluated for integration. */
  total: number;
  /** Keywords already present in the source resume before optimization. */
  alreadyPresent: number;
  /** Keywords newly integrated by the optimizer output. */
  integrated: number;
  /** Keywords still missing after optimization. */
  stillMissing: string[];
  /** (alreadyPresent + integrated) / total, 0-100. */
  coveragePct: number;
}

export interface OutputValidationResult {
  valid: boolean;
  violations: string[];
  keywordCoverage: KeywordCoverageReport;
}

/** Tokens that are never meaningful integration targets (mirrors orchestrator filter). */
function isJunkKeyword(k: string): boolean {
  const t = k.trim().toLowerCase();
  if (t.length < 3) return true;
  return ["go", "basic", "job", "company", "the", "and", "with", "for", "using", "strong", "plus", "etc", "years", "year", "work", "team", "role", "candidate", "experience", "skills", "requirements", "responsibilities", "preferred", "qualifications", "opportunity", "benefits", "salary"].includes(t);
}

/**
 * Entity-alignment filter (DEADLOCK FIX, production trace 0256e12b):
 * The Structure Guardian vetoes any SKILL whose name matches a JD
 * company/location entity ("Qatar Airways", "Doha"...). Previously the
 * OptimizerOutputValidator still counted those same tokens as actionable
 * keywords the optimizer MUST integrate — with a skills-less resume the only
 * way to satisfy the keyword floor was to add them as skills, which the
 * Guardian then vetoed. The two gates ping-ponged and every attempt failed
 * ("Keyword integration floor not met: 0 of 10..." → "Skill 'Qatar Airways'
 * is a JD company name/location..."), exhausting all retries.
 *
 * Tokens matching a Guardian-protected entity are excluded from the
 * actionable set — they can (and should) still appear naturally in bullets
 * and summaries, but they can never be REQUIRED. The validator and the
 * Guardian now enforce a satisfiable contract.
 */
function isGuardianProtectedEntity(k: string): boolean {
  const t = k.trim().toLowerCase();
  if (!t) return true;
  return JD_COMPANY_NAMES.some(
    (name) => t === name || t.includes(name) || name.includes(t)
  );
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+/ .:-]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Evaluate keyword coverage: of the JD's actionable keywords, how many were
 * already present in the source, and how many did the optimizer integrate?
 */
export function computeKeywordCoverage(
  sourceResume: ResumeData,
  optimizerOutput: unknown,
  jd: JobDescription,
): KeywordCoverageReport {
  // DEADLOCK FIX: exclude both junk tokens AND Guardian-protected JD entities
  // ("Qatar Airways", "Doha"...) — the Guardian vetoes those as skills, so the
  // validator must never require them. Both filters apply before the 20-cap so
  // protected entities don't consume coverage slots.
  const jdKeywords = (jd.keywords ?? [])
    .filter((k) => typeof k === "string" && !isJunkKeyword(k) && !isGuardianProtectedEntity(k))
    .slice(0, 20);
  const sourceText = normalizeText(JSON.stringify(sourceResume));
  const outputText = normalizeText(JSON.stringify(optimizerOutput ?? {}));

  // Actionable = JD keyword that the SOURCE does not already contain.
  const actionable = jdKeywords.filter((k) => !sourceText.includes(normalizeText(k)));
  let integrated = 0;
  const stillMissing: string[] = [];
  for (const k of actionable) {
    if (outputText.includes(normalizeText(k))) integrated++;
    else stillMissing.push(k);
  }

  const alreadyPresent = jdKeywords.length - actionable.length;
  const total = jdKeywords.length;
  const coveragePct = total === 0 ? 100 : Math.round(((alreadyPresent + integrated) / total) * 100);

  return { total, alreadyPresent, integrated, stillMissing, coveragePct };
}

/**
 * Validate the optimizer output against the minimum optimization contract
 * (directive §24). Called inside the locked pipeline attempt loop; a failed
 * validation aborts the attempt and feeds corrective feedback into the retry.
 */
export function validateOptimizerOutput(
  sourceResume: ResumeData,
  optimizerOutput: unknown,
  jd: JobDescription,
): OutputValidationResult {
  const violations: string[] = [];
  const output = (optimizerOutput ?? {}) as {
    summary?: string;
    headline?: string;
    skills?: unknown[];
    experiences?: Array<{ id?: string; bullets?: string[] }>;
  };

  // 1. Non-empty output (directive §24: "non-empty").
  const hasExperiences = Array.isArray(output.experiences) && output.experiences.length > 0;
  const hasSummary = typeof output.summary === "string" && output.summary.trim().length > 0;
  const hasSkills = Array.isArray(output.skills) && output.skills.length > 0;
  if (!hasExperiences && !hasSummary && !hasSkills) {
    violations.push("Optimizer output is empty (no summary, skills, or experience rewrites).");
  }

  // 2. Experience coverage — if the source has experience, the optimizer must
  //    return rewrites for the same number of entries (assembler matches by ID).
  const srcExpCount = sourceResume.experience?.length ?? 0;
  if (srcExpCount > 0 && (!Array.isArray(output.experiences) || output.experiences.length < srcExpCount)) {
    violations.push(
      `Optimizer returned ${output.experiences?.length ?? 0} experience rewrites for ${srcExpCount} source entries — incomplete coverage.`
    );
  }

  // 3. Material difference (directive §24: "materially different where expected").
  //    If the optimizer echoes the source verbatim, no optimization occurred.
  const srcSummary = typeof sourceResume.summary === "string" ? sourceResume.summary : "";
  const srcBullets = (sourceResume.experience ?? []).flatMap((e) => e.bullets ?? []).join(" ");
  const outSummary = typeof output.summary === "string" ? output.summary : "";
  const outBullets = (output.experiences ?? []).flatMap((e) => e.bullets ?? []).join(" ");
  const srcNorm = normalizeText(`${srcSummary} ${srcBullets}`);
  const outNorm = normalizeText(`${outSummary} ${outBullets}`);
  if (srcNorm.length > 0 && outNorm.length > 0 && srcNorm === outNorm) {
    violations.push("Optimizer output is identical to the source resume — no meaningful optimization occurred.");
  }

  // 4. Keyword accountability (directive §11): if the JD has actionable missing
  //    keywords, the optimizer must integrate at least one — zero integration
  //    across ≥3 actionable keywords means the optimization is INCOMPLETE.
  const coverage = computeKeywordCoverage(sourceResume, output, jd);
  const actionable = coverage.total - coverage.alreadyPresent;
  if (actionable >= 3 && coverage.integrated === 0) {
    violations.push(
      `Keyword integration floor not met: 0 of ${actionable} actionable JD keywords integrated (${coverage.stillMissing.slice(0, 5).join(", ")}…). Optimization is INCOMPLETE, not successful.`
    );
  }

  return { valid: violations.length === 0, violations, keywordCoverage: coverage };
}
