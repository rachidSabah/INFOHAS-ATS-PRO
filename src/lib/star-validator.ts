// ============================================================================
// STAR Validator — Programmatic Bullet Quality Enforcement
//
// This module provides deterministic (non-AI) validation of resume bullet
// points after the AI has returned its output. It enforces:
//
//   1. ACTIVE VERB requirement  — every bullet must begin with a strong,
//      non-passive action verb.
//   2. METRIC requirement       — every bullet must contain at least one
//      quantifiable metric (%, $, number, time, scale).
//   3. ENTITY PROTECTION        — employer names, job titles, dates of
//      employment, university names, and certifications must NOT have been
//      altered vs. the source resume.
//   4. PASSIVE VERB GUARD       — bullets starting with passive/weak phrases
//      are flagged and scored down.
//
// The validator returns:
//   - Per-bullet results with pass/fail + reasons
//   - An aggregate STARValidationResult suitable for wiring into the QA agent
//
// Auto-correction guidance is also returned so the caller can decide whether
// to trigger a retry or surface issues to the user.
// ============================================================================

import type { ResumeData } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * High-impact active verbs that are APPROVED as bullet starters.
 * Grouped for readability. The set is intentionally broad so legitimate
 * good bullets are never false-positived.
 */
export const APPROVED_ACTIVE_VERBS = new Set([
  // Leadership / Strategy
  "spearheaded", "orchestrated", "pioneered", "championed", "led", "directed",
  "headed", "drove", "steered", "guided", "initiated", "launched", "established",
  "founded", "created", "built", "architected", "designed", "formulated",

  // Execution / Delivery
  "delivered", "executed", "implemented", "deployed", "shipped", "completed",
  "achieved", "accomplished", "attained", "secured", "finalized", "resolved",
  "fixed", "closed", "fulfilled",

  // Improvement / Optimization
  "optimized", "improved", "enhanced", "streamlined", "accelerated", "boosted",
  "increased", "grew", "expanded", "scaled", "reduced", "decreased", "cut",
  "minimized", "eliminated", "consolidated", "simplified", "automated",
  "modernized", "upgraded", "revamped", "transformed", "restructured",

  // Collaboration / Communication
  "coordinated", "collaborated", "partnered", "facilitated", "aligned",
  "liaised", "negotiated", "influenced", "mentored", "coached", "trained",
  "onboarded", "developed", "upskilled", "supported", "advised", "consulted",

  // Analysis / Research
  "analyzed", "assessed", "evaluated", "identified", "diagnosed", "audited",
  "researched", "investigated", "modeled", "forecasted", "measured", "tracked",
  "monitored", "reported", "documented", "captured",

  // Management / Oversight
  "managed", "administered", "oversaw", "supervised", "controlled", "regulated",
  "owned", "maintained", "ensured", "enforced", "standardized", "governed",

  // Technical / Engineering
  "engineered", "programmed", "coded", "developed", "integrated", "migrated",
  "configured", "customized", "tested", "validated", "debugged", "refactored",

  // Sales / Service / Operations
  "generated", "sourced", "acquired", "converted", "retained", "served",
  "exceeded", "surpassed", "outperformed", "processed", "handled", "resolved",
  "responded", "escalated", "recovered",
]);

/**
 * Passive / weak phrases that MUST NOT start a bullet.
 * Checked case-insensitively as a prefix match.
 */
export const PASSIVE_VERB_PREFIXES = [
  "responsible for",
  "assisted with",
  "assisted in",
  "helped with",
  "helped to",
  "worked on",
  "worked with",
  "involved in",
  "was involved",
  "tasked with",
  "duties included",
  "duties include",
  "duties:",
  "in charge of",
  "part of",
  "participated in",
  "participated with",
  "handled",          // too vague, flagged as passive
  "contributed to",
  "provided support",
  "provided assistance",
  "supported the",
  "acted as",
  "served as a",      // e.g. "served as a liaison" — flagged; "served 300 guests" is fine
];

/**
 * Regex patterns that indicate a quantifiable metric is present.
 * Ordered from most-specific to least-specific.
 */
export const METRIC_PATTERNS: RegExp[] = [
  /\d+\s*%/,                         // percentages: 40%, 3.5%
  /\$[\d,]+(?:\.\d+)?[KMBkmb]?/,    // dollar amounts: $50K, $1.2M
  /£[\d,]+(?:\.\d+)?[KMBkmb]?/,     // GBP amounts
  /€[\d,]+(?:\.\d+)?[KMBkmb]?/,     // EUR amounts
  /\b\d+[KMBkmb]\+?\s*(revenue|budget|savings|pipeline|ARR|MRR)/i,
  /\b\d[\d,]*\+?\s*(users?|customers?|clients?|accounts?|stores?|team\s+members?|engineers?|employees?|passengers?|guests?|orders?|tickets?|requests?|calls?|projects?|campaigns?|vendors?|suppliers?|enterprise\s+\w+)\b/i,
  /\b\d+\+\s*\w/i,  // generic "500+ anything"
  /\b(increased|decreased|reduced|improved|grew|cut|saved|generated|drove|boosted|accelerated)\s+(?:by\s+)?\d/i,
  /\b\d+\s*(?:x|times|fold)\b/i,    // 3x, 5 times, 10-fold
  /\bx\d+\b/i,                       // x3 improvement
  /\b(?:daily|weekly|monthly|quarterly|annual(?:ly)?)\b.*\b\d/i, // frequency + number
  /\b\d+\s*(?:hours?|days?|weeks?|months?|years?)\b/i,  // time savings
  /\bup\s+to\s+\d/i,                 // "up to 40%"
  /\bover\s+\d/i,                    // "over 200 clients"
  /\bmore\s+than\s+\d/i,             // "more than 50 accounts"
  /\bwithin\s+\d/i,                  // "within 3 days"
  /\bacross\s+\d+\s*\w+/i,           // "across 5 markets"
  /\b\d+\s*(?:countries|markets|regions|sites|locations|branches|offices)\b/i,
  /\b[1-9]\d*\/\d+\b/,              // ratios: 3/5, 9/10
  /\btop\s+\d+%/i,                  // "top 5%"
  /\brank(?:ed|ing)?\s+#?\d+\b/i,   // "ranked #1", "ranking 2nd"
  /\b(?:zero|0)\s+(?:incidents?|defects?|errors?|downtime|complaints?)\b/i,
  /\b99\.?\d*%\s*uptime\b/i,        // "99.9% uptime"
  /\bsla\s+compliance\s+of\s+\d/i,  // "SLA compliance of 98%"
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BulletSTARResult {
  bullet: string;
  experienceId: string;
  bulletIndex: number;
  passesActiveVerb: boolean;
  passesMetric: boolean;
  passesNonPassive: boolean;
  /** true only when all three checks pass */
  passes: boolean;
  /** human-readable reasons for failures */
  failures: string[];
  /** the first word/phrase detected */
  detectedOpeningVerb: string;
  /** auto-correction hint for UI or retry */
  hint: string;
}

export interface EntityProtectionViolation {
  field: "employer" | "jobTitle" | "startDate" | "endDate" | "institution" | "degree" | "certification";
  experienceIndex?: number;
  educationIndex?: number;
  certificationIndex?: number;
  originalValue: string;
  optimizedValue: string;
}

export interface STARValidationResult {
  /** Overall pass: all bullets pass STAR AND no entity violations */
  passed: boolean;
  /** Score 0–100 */
  score: number;
  /** Per-bullet results */
  bulletResults: BulletSTARResult[];
  /** Entity protection violations */
  entityViolations: EntityProtectionViolation[];
  /** Count of bullets that failed active-verb check */
  passiveVerbCount: number;
  /** Count of bullets that failed metric check */
  noMetricCount: number;
  /** Count of entity violations */
  entityViolationCount: number;
  /** Total bullets evaluated */
  totalBullets: number;
  /** Bullets that fully pass STAR */
  passingBullets: number;
  /** Explanation for UI / Reflection Agent */
  explanation: string;
  /** Structured list of all issues for the QA check errors array */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Core checking functions
// ---------------------------------------------------------------------------

/**
 * Extract the opening verb or phrase from a bullet string.
 * Strips leading punctuation/whitespace, returns lowercase first word.
 */
function extractOpeningVerb(bullet: string): string {
  const cleaned = bullet.trim().replace(/^[-•·▸▪*]+\s*/, "").trim();
  // Take first two words for passive phrase detection
  return cleaned.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
}

/**
 * Check whether a bullet starts with an approved active verb.
 */
function checkActiveVerb(bullet: string): { passes: boolean; verb: string } {
  const cleaned = bullet.trim().replace(/^[-•·▸▪*]+\s*/, "").trim();
  const firstWord = cleaned.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  return {
    passes: APPROVED_ACTIVE_VERBS.has(firstWord),
    verb: firstWord,
  };
}

/**
 * Check whether a bullet starts with a passive/weak phrase.
 */
function checkNonPassive(bullet: string): { passes: boolean; matchedPhrase: string } {
  const lower = bullet.trim().toLowerCase();
  for (const phrase of PASSIVE_VERB_PREFIXES) {
    if (lower.startsWith(phrase)) {
      return { passes: false, matchedPhrase: phrase };
    }
  }
  return { passes: true, matchedPhrase: "" };
}

/**
 * Check whether a bullet contains at least one quantifiable metric.
 */
function checkMetric(bullet: string): boolean {
  for (const pattern of METRIC_PATTERNS) {
    if (pattern.test(bullet)) return true;
  }
  return false;
}

/**
 * Generate a corrective hint for a failing bullet.
 */
function buildHint(result: Omit<BulletSTARResult, "hint">): string {
  const hints: string[] = [];
  if (!result.passesNonPassive) {
    hints.push(`Replace passive opening "${result.detectedOpeningVerb}" with an active verb (e.g., Spearheaded, Orchestrated, Delivered).`);
  } else if (!result.passesActiveVerb) {
    hints.push(`Opening word "${result.detectedOpeningVerb}" is not a recognized high-impact verb. Try: Streamlined, Implemented, Optimized, Drove.`);
  }
  if (!result.passesMetric) {
    hints.push("Add a quantifiable metric: percentage (%), dollar amount ($), count, or time saved.");
  }
  return hints.join(" | ");
}

// ---------------------------------------------------------------------------
// Main export: validateSTAR
// ---------------------------------------------------------------------------

/**
 * Validate all experience bullets in an optimized resume against the STAR method.
 *
 * @param optimized  The AI-optimized resume to validate
 * @param original   The original source resume (used for entity protection checks)
 * @returns STARValidationResult
 */
export function validateSTAR(optimized: ResumeData, original?: ResumeData | null): STARValidationResult {
  const bulletResults: BulletSTARResult[] = [];
  const entityViolations: EntityProtectionViolation[] = [];

  // ── 1. Per-bullet STAR checks ─────────────────────────────────────────────
  for (const exp of optimized.experience) {
    for (let bi = 0; bi < exp.bullets.length; bi++) {
      const bullet = exp.bullets[bi];
      const failures: string[] = [];

      const activeVerbResult = checkActiveVerb(bullet);
      const passiveResult = checkNonPassive(bullet);
      const hasMetric = checkMetric(bullet);
      const openingPhrase = extractOpeningVerb(bullet);

      const passesNonPassive = passiveResult.passes;
      const passesActiveVerb = activeVerbResult.passes;
      const passesMetric = hasMetric;

      if (!passesNonPassive) {
        failures.push(`Starts with passive phrase: "${passiveResult.matchedPhrase}"`);
      } else if (!passesActiveVerb) {
        failures.push(`Opening word "${activeVerbResult.verb}" is not a recognized active verb`);
      }

      if (!passesMetric) {
        failures.push("No quantifiable metric detected (%, $, count, time)");
      }

      const passes = passesNonPassive && passesActiveVerb && passesMetric;

      const partial: Omit<BulletSTARResult, "hint"> = {
        bullet,
        experienceId: exp.id,
        bulletIndex: bi,
        passesActiveVerb,
        passesMetric,
        passesNonPassive,
        passes,
        failures,
        detectedOpeningVerb: openingPhrase,
      };

      bulletResults.push({ ...partial, hint: buildHint(partial) });
    }
  }

  // ── 2. Entity protection checks ───────────────────────────────────────────
  if (original) {
    // Employer names & job titles
    for (let i = 0; i < original.experience.length; i++) {
      const origExp = original.experience[i];
      const optExp = optimized.experience.find((e) => e.id === origExp.id) ?? optimized.experience[i];
      if (!optExp) continue;

      if (origExp.company && optExp.company &&
          origExp.company.trim().toLowerCase() !== optExp.company.trim().toLowerCase()) {
        entityViolations.push({
          field: "employer",
          experienceIndex: i,
          originalValue: origExp.company,
          optimizedValue: optExp.company,
        });
      }
      if (origExp.title && optExp.title &&
          origExp.title.trim().toLowerCase() !== optExp.title.trim().toLowerCase()) {
        entityViolations.push({
          field: "jobTitle",
          experienceIndex: i,
          originalValue: origExp.title,
          optimizedValue: optExp.title,
        });
      }
      if (origExp.startDate && optExp.startDate &&
          origExp.startDate.trim() !== optExp.startDate.trim()) {
        entityViolations.push({
          field: "startDate",
          experienceIndex: i,
          originalValue: origExp.startDate,
          optimizedValue: optExp.startDate,
        });
      }
      if (origExp.endDate && optExp.endDate &&
          origExp.endDate.trim() !== optExp.endDate.trim()) {
        entityViolations.push({
          field: "endDate",
          experienceIndex: i,
          originalValue: origExp.endDate,
          optimizedValue: optExp.endDate,
        });
      }
    }

    // University / institution names
    for (let i = 0; i < original.education.length; i++) {
      const origEd = original.education[i];
      const optEd = optimized.education[i];
      if (!optEd) continue;

      if (origEd.institution && optEd.institution &&
          origEd.institution.trim().toLowerCase() !== optEd.institution.trim().toLowerCase()) {
        entityViolations.push({
          field: "institution",
          educationIndex: i,
          originalValue: origEd.institution,
          optimizedValue: optEd.institution,
        });
      }
      if (origEd.degree && optEd.degree &&
          origEd.degree.trim().toLowerCase() !== optEd.degree.trim().toLowerCase()) {
        entityViolations.push({
          field: "degree",
          educationIndex: i,
          originalValue: origEd.degree,
          optimizedValue: optEd.degree,
        });
      }
    }

    // Certification names
    for (let i = 0; i < original.certifications.length; i++) {
      const origCert = original.certifications[i];
      const optCert = optimized.certifications[i];
      if (!optCert) continue;

      if (origCert.name && optCert.name &&
          origCert.name.trim().toLowerCase() !== optCert.name.trim().toLowerCase()) {
        entityViolations.push({
          field: "certification",
          certificationIndex: i,
          originalValue: origCert.name,
          optimizedValue: optCert.name,
        });
      }
    }
  }

  // ── 3. Aggregate metrics ──────────────────────────────────────────────────
  const totalBullets = bulletResults.length;
  const passingBullets = bulletResults.filter((r) => r.passes).length;
  const passiveVerbCount = bulletResults.filter((r) => !r.passesNonPassive).length;
  const noMetricCount = bulletResults.filter((r) => !r.passesMetric).length;
  const entityViolationCount = entityViolations.length;

  // Score: (passing bullets / total) × 80 + entity deductions
  const bulletScore = totalBullets > 0 ? (passingBullets / totalBullets) * 80 : 80;
  const entityPenalty = Math.min(20, entityViolationCount * 10);
  const score = Math.max(0, Math.round(bulletScore + (totalBullets > 0 ? 20 : 0) - entityPenalty));

  // Build errors array for QA integration
  const errors: string[] = [];
  for (const r of bulletResults) {
    if (!r.passes) {
      errors.push(
        `[Exp ${r.experienceId} · bullet ${r.bulletIndex + 1}] ${r.failures.join("; ")} → ${r.hint}`
      );
    }
  }
  for (const v of entityViolations) {
    errors.push(
      `[Entity violation · ${v.field}] "${v.originalValue}" changed to "${v.optimizedValue}"`
    );
  }

  const passed = passingBullets === totalBullets && entityViolationCount === 0;

  let explanation: string;
  if (passed) {
    explanation = `All ${totalBullets} bullet(s) follow the STAR method and no entity violations detected.`;
  } else {
    const parts: string[] = [];
    if (passiveVerbCount > 0) parts.push(`${passiveVerbCount} passive-verb bullet(s)`);
    if (noMetricCount > 0) parts.push(`${noMetricCount} bullet(s) missing metrics`);
    if (entityViolationCount > 0) parts.push(`${entityViolationCount} entity protection violation(s)`);
    explanation = `STAR validation failed: ${parts.join(", ")}. Score: ${score}/100.`;
  }

  return {
    passed,
    score,
    bulletResults,
    entityViolations,
    passiveVerbCount,
    noMetricCount,
    entityViolationCount,
    totalBullets,
    passingBullets,
    explanation,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Auto-correction helper
// ---------------------------------------------------------------------------

/**
 * Restore original entity values (employer, title, dates, institution, cert)
 * on the optimized resume if entity protection violations are detected.
 *
 * This is a SAFE programmatic correction — it only touches fields
 * that differ from the source. Bullets are NOT modified here.
 *
 * @returns A copy of the optimized resume with violated entities restored.
 */
export function restoreViolatedEntities(
  optimized: ResumeData,
  original: ResumeData,
  violations: EntityProtectionViolation[]
): ResumeData {
  if (violations.length === 0) return optimized;

  // Deep-clone to avoid mutating the original object
  const fixed: ResumeData = JSON.parse(JSON.stringify(optimized));

  for (const v of violations) {
    if (v.field === "employer" && v.experienceIndex !== undefined) {
      const origExp = original.experience[v.experienceIndex];
      const fixExp = fixed.experience.find((e) => e.id === origExp?.id) ?? fixed.experience[v.experienceIndex];
      if (fixExp) fixExp.company = v.originalValue;
    }
    if (v.field === "jobTitle" && v.experienceIndex !== undefined) {
      const origExp = original.experience[v.experienceIndex];
      const fixExp = fixed.experience.find((e) => e.id === origExp?.id) ?? fixed.experience[v.experienceIndex];
      if (fixExp) fixExp.title = v.originalValue;
    }
    if (v.field === "startDate" && v.experienceIndex !== undefined) {
      const origExp = original.experience[v.experienceIndex];
      const fixExp = fixed.experience.find((e) => e.id === origExp?.id) ?? fixed.experience[v.experienceIndex];
      if (fixExp) fixExp.startDate = v.originalValue;
    }
    if (v.field === "endDate" && v.experienceIndex !== undefined) {
      const origExp = original.experience[v.experienceIndex];
      const fixExp = fixed.experience.find((e) => e.id === origExp?.id) ?? fixed.experience[v.experienceIndex];
      if (fixExp) fixExp.endDate = v.originalValue;
    }
    if (v.field === "institution" && v.educationIndex !== undefined) {
      if (fixed.education[v.educationIndex]) {
        fixed.education[v.educationIndex].institution = v.originalValue;
      }
    }
    if (v.field === "degree" && v.educationIndex !== undefined) {
      if (fixed.education[v.educationIndex]) {
        fixed.education[v.educationIndex].degree = v.originalValue;
      }
    }
    if (v.field === "certification" && v.certificationIndex !== undefined) {
      if (fixed.certifications[v.certificationIndex]) {
        fixed.certifications[v.certificationIndex].name = v.originalValue;
      }
    }
  }

  return fixed;
}
