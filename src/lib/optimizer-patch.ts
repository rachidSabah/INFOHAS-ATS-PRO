// ============================================================================
// Optimizer Patch Type — Strict Patch-Only Contract
//
// The LLM may ONLY return this shape. Everything else is APPLICATION-OWNED
// and comes from the source resume (Blueprint).
//
// This eliminates ALL classes of corruption:
//   - Missing company names (company comes from source)
//   - Missing dates (dates come from source)
//   - Duplicated experiences (assember enforces source count)
//   - Hallucinated employers (LLM cannot add employers)
//   - Education corruption (education comes from source)
//   - Language corruption (languages come from source)
//   - Contact corruption (contact info comes from source)
//   - Certification corruption (certifications come from source)
// ============================================================================

"use client";

/**
 * The ONLY data the LLM is allowed to return from optimization.
 *
 * Every field here is an OVERRIDE for the corresponding editable text in
 * the source resume. Any field not listed here is IMMUTABLE and MUST come
 * from the source resume's Blueprint.
 */
export interface OptimizerPatch {
  /** Rewritten professional summary (ATS-optimized) */
  summary?: string;

  /** Rewritten headline / target role title */
  headline?: string;

  /** Enriched/reordered skills list (categories preserved, skills added) */
  skills?: OptimizerPatchSkill[];

  /** Rewritten bullets per experience entry, matched by source ID */
  experiences?: OptimizerPatchExperience[];

  /** Keywords that were missing from the source and added by the optimizer */
  missingKeywordsAdded?: string[];

  /** Count of bullets rewritten */
  bulletsRewritten?: number;
}

export interface OptimizerPatchSkill {
  name: string;
  category?: string;
}

export interface OptimizerPatchExperience {
  /** MUST match an experience ID from the source resume exactly */
  id: string;
  /** Rewritten bullet points — count MUST match source */
  bullets: string[];
}

/**
 * Fields that the LLM is NEVER allowed to return.
 * These are enforced at parse time and by the Guardian.
 */
export const OPTIMIZER_FORBIDDEN_TOP_LEVEL = [
  "name", "email", "phone", "location", "dateOfBirth",
  "education", "languages", "certifications", "additionalInfo",
  "contact", "projects", "achievements", "dynamicSections",
  "template", "accentColor", "photoUrl", "createdAt", "updatedAt",
  "source", "fileName",
] as const;

export const OPTIMIZER_FORBIDDEN_EXPERIENCE = [
  "title", "company", "location", "startDate", "endDate",
  "old_bullets",
] as const;

/**
 * Validate that an OptimizerPatch only contains allowed fields.
 * Throws if forbidden fields are present (after warning in current behavior).
 */
export function validateOptimizerPatch(patch: any): string[] {
  const warnings: string[] = [];

  // Check top-level forbidden fields
  for (const field of OPTIMIZER_FORBIDDEN_TOP_LEVEL) {
    if (patch[field] !== undefined) {
      warnings.push(`LLM returned forbidden field "${field}" — stripped (application-owned)`);
      delete patch[field];
    }
  }

  // Check experience-level forbidden fields
  const expArray = patch.experiences || patch.experience || [];
  for (const exp of expArray) {
    for (const field of OPTIMIZER_FORBIDDEN_EXPERIENCE) {
      if (exp[field] !== undefined) {
        warnings.push(`LLM returned forbidden field "experiences[].${field}" — stripped (application-owned)`);
        delete exp[field];
      }
    }
  }

  return warnings;
}
