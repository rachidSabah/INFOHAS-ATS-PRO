// ============================================================================
// Resume Assembler
//
// The Resume Assembler is the ONLY component allowed to construct the final
// resume document. It merges:
//
//   IMMUTABLE fields (from sourceResume):
//     - name, contact (email, phone, location)
//     - experience[].id, title, company, location, startDate, endDate
//     - education[] (all fields)
//     - languages[] (all fields)
//     - certifications[]
//
//   MUTABLE fields (from optimizerOutput):
//     - summary
//     - headline (allowed to change, but JD-company-injected headlines are rejected)
//     - skills[]
//     - experience[].bullets (matched by ID)
//
// The LLM NEVER renders the final document. The LLM only returns:
//   { summary, headline, skills, experiences: [{ id, bullets }] }
//
// This eliminates:
//   - missing company names (company comes from source, not LLM)
//   - missing dates (dates come from source, not LLM)
//   - duplicated experiences (assembler enforces source count)
//   - hallucinated employers (LLM cannot add employers)
//   - education corruption (education comes from source, not LLM)
//   - language corruption (languages come from source, not LLM)
//   - language corruption (language corruption (languages come from source, not LLM)
// ============================================================================

"use client";

import type { ResumeData, ResumeExperience, ResumeSkill, ResumeLanguage } from "./types";
import { cleanupGrammar, cleanupResumeGrammar, filterForbiddenSkills, isForbiddenSkill } from "./ai-response-processor";
import { findMatchingSourceExperience, validateExperienceFingerprints, computeExperienceFingerprint } from "./experience-fingerprint";

/**
 * The optimizer output contract.
 *
 * The LLM is ONLY allowed to return this shape. Everything else is
 * application-owned and comes from the source resume.
 */
export interface OptimizerOutput {
  /** Rewritten professional summary */
  summary?: string;
  /** Optionally rewritten headline (may be rejected if it contains JD company names) */
  headline?: string;
  /** Enriched skills list */
  skills?: Array<{ name: string; category?: string }>;
  /** Rewritten experience bullets — matched back to source by ID */
  experiences?: Array<{
    /** MUST match a source experience ID */
    id: string;
    /** Rewritten bullet points */
    bullets: string[];
  }>;
  /** Optional: keywords the optimizer embedded (for logging only) */
  missingKeywordsAdded?: string[];
  /** Optional: number of bullets rewritten (for logging only) */
  bulletsRewritten?: number;
}

/**
 * Result of assembling a resume.
 */
export interface AssembleResult {
  resume: ResumeData;
  warnings: string[];
  errors: string[];
  /** Number of experience entries matched by ID */
  matchedById: number;
  /** Number of experience entries matched by fingerprint */
  matchedByFingerprint: number;
  /** Number of experience entries matched by title/company fallback */
  matchedByTitleCompany: number;
  /** Number of experience entries that fell back to index matching */
  matchedByIndex: number;
  /** Number of experience entries with NO match (should be 0) */
  unmatched: number;
}

/**
 * Assemble the final resume from source (immutable) + optimizer output (mutable).
 *
 * This is the ONLY function that constructs the final ResumeData.
 * No provider may bypass this function.
 *
 * @param sourceResume - The parsed resume from the PDF (source of truth)
 * @param optimizerOutput - The LLM's output (summary, skills, bullets only)
 * @returns AssembleResult with the final resume + diagnostics
 */
export function assembleResume(
  sourceResume: ResumeData,
  optimizerOutput: OptimizerOutput,
): AssembleResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let matchedById = 0;
  let matchedByFingerprint = 0;
  let matchedByTitleCompany = 0;
  let matchedByIndex = 0;
  let unmatched = 0;

  // ========================================================================
  // 1. EXPERIENCE — merge source (immutable) + optimizer bullets (mutable)
  // ========================================================================
  const optimizerExperiences = optimizerOutput.experiences ?? [];
  const optimizerById = new Map<string, { bullets: string[] }>();
  for (const opt of optimizerExperiences) {
    if (opt.id) {
      optimizerById.set(opt.id, { bullets: opt.bullets });
    }
  }

  const finalExperience: ResumeExperience[] = sourceResume.experience.map((srcExp, index) => {
    // Try to find matching optimizer output by ID
    const optMatch = optimizerById.get(srcExp.id);

    if (optMatch) {
      matchedById++;
      // Clean bullets
      const cleanedBullets = optMatch.bullets
        .map((b) => cleanupGrammar(b))
        .filter((b) => b && b.length > 0);

      // Use optimizer's bullets if they're non-empty, otherwise keep source bullets
      const bullets = cleanedBullets.length > 0 ? cleanedBullets : srcExp.bullets;

      return {
        ...srcExp, // ALL immutable fields from source
        bullets,   // ONLY bullets from optimizer
      };
    }

    // If no ID match, try fingerprint matching
    // (this handles the case where the LLM changed the ID but kept the entry)
    const srcFp = computeExperienceFingerprint(srcExp);
    const fuzzyMatch = optimizerExperiences.find((opt) => {
      return computeExperienceFingerprint(opt as any) === srcFp;
    });

    if (fuzzyMatch) {
      matchedByFingerprint++;
      warnings.push(
        `Experience[${index}] (id="${srcExp.id}") matched optimizer entry by fingerprint, not by ID. ` +
        `Using optimizer's bullets.`,
      );
      const cleanedBullets = fuzzyMatch.bullets
        .map((b) => cleanupGrammar(b))
        .filter((b) => b && b.length > 0);
      const bullets = cleanedBullets.length > 0 ? cleanedBullets : srcExp.bullets;
      return {
        ...srcExp,
        bullets,
      };
    }

    // No match found — keep source entry with original bullets
    matchedByIndex++;
    warnings.push(
      `Experience[${index}] (id="${srcExp.id}", title="${srcExp.title}") had no matching optimizer entry. ` +
      `Keeping source bullets.`,
    );
    return { ...srcExp };
  });

  // Check for optimizer entries that didn't match any source entry (hallucinated)
  for (const opt of optimizerExperiences) {
    const hasMatch = sourceResume.experience.some((src) => src.id === opt.id) ||
      sourceResume.experience.some((src) => computeExperienceFingerprint(src) === computeExperienceFingerprint(opt as any));
    if (!hasMatch) {
      unmatched++;
      warnings.push(
        `Optimizer returned experience with id="${opt.id}" but no source entry has that ID or fingerprint. ` +
        `This entry will be IGNORED (prevents hallucinated experience).`,
      );
    }
  }

  // ========================================================================
  // 2. SUMMARY — from optimizer (mutable) with strict validation
  // ========================================================================
  let summary: string = optimizerOutput.summary ?? sourceResume.summary ?? "";
  summary = cleanupGrammar(summary);

  // Check minimum character length (was 30 chars ≈ 6 words)
  if (!summary || summary.trim().length < 30) {
    warnings.push("Optimizer summary was empty or too short (< 30 chars) — using source summary");
    summary = sourceResume.summary ?? "";
  }

  // Check word count — target 80-130 words per spec
  const wordCount = summary.trim() ? summary.trim().split(/\s+/).length : 0;
  if (summary && wordCount < 60) {
    warnings.push(`Optimizer summary too short (${wordCount} words, minimum 60) — using source summary`);
    summary = sourceResume.summary ?? "";
  }

  // Check for duplicate sentences
  if (summary) {
    const sentences = summary.split(/[.!?]+/).filter((s) => s.trim().length > 10);
    const seenSentences = new Set<string>();
    for (const sent of sentences) {
      const normalized = sent.toLowerCase().trim().replace(/\s+/g, " ");
      if (seenSentences.has(normalized)) {
        warnings.push(`Summary contains duplicate sentence — falling back to source summary`);
        summary = sourceResume.summary ?? "";
        break;
      }
      seenSentences.add(normalized);
    }
    // Check for double periods
    if (summary.includes("..")) {
      summary = summary.replace(/\.\.+/g, ".");
      warnings.push("Fixed double periods in summary");
    }
  }

  // Reject summary that contains JD company names (hallucinated references)
  if (summary) {
    const jdCompaniesForSummary = [
      "qatar duty free", "qatar airways", "hamad international",
      "the millennium hotel", "emaar", "madini perfume",
    ];
    const summaryLower = summary.toLowerCase();
    const containsJdCompany = jdCompaniesForSummary.some((c) => summaryLower.includes(c));
    if (containsJdCompany) {
      warnings.push("Optimizer summary contains JD company name — using source summary");
      summary = sourceResume.summary ?? "";
    }
  }

  // ========================================================================
  // 3. HEADLINE — from optimizer, but reject if JD company injected
  // ========================================================================
  let headline: string = optimizerOutput.headline ?? sourceResume.headline ?? "";
  headline = cleanupGrammar(headline);
  const jdCompanyNames = [
    "qatar duty free", "qatar airways", "hamad international",
    "doha", "qatar", "dubai", "abu dhabi", "uae",
    "riyadh", "saudi arabia", "kuwait", "bahrain", "oman", "muscat",
  ];
  const headlineLower = (headline || "").toLowerCase();
  const containsJdCompany = jdCompanyNames.some((name) => headlineLower.includes(name));
  const origHeadlineLower = (sourceResume.headline || "").toLowerCase().trim();
  const origFirst3 = origHeadlineLower.split(/\s+/).slice(0, 3).join(" ");
  const aiFirst3 = headlineLower.split(/\s+/).slice(0, 3).join(" ");
  const headlinesDiverge = origFirst3 && aiFirst3 && origFirst3 !== aiFirst3;
  if (containsJdCompany || headlinesDiverge || !headline?.trim()) {
    if (containsJdCompany) {
      warnings.push(`Headline rejected (contained JD company name: "${headline}") — using source headline`);
    } else if (headlinesDiverge) {
      warnings.push(`Headline rejected (first 3 words changed: "${aiFirst3}" vs "${origFirst3}") — using source headline`);
    }
    headline = sourceResume.headline ?? "";
  }

  // ========================================================================
  // 4. SKILLS — from optimizer, filtered for forbidden patterns
  // ========================================================================
  let skills: ResumeSkill[] = (sourceResume.skills || []).map((s) => ({ ...s }));
  if (optimizerOutput.skills && optimizerOutput.skills.length > 0) {
    const { filtered, removed } = filterForbiddenSkills(
      optimizerOutput.skills.map((s) => ({
        id: `sk_${Math.random().toString(36).slice(2, 10)}`,
        name: s.name,
        category: s.category,
      })),
    );
    if (removed.length > 0) {
      warnings.push(`Removed ${removed.length} forbidden skill(s): ${removed.join(", ")}`);
    }
    skills = filtered;
  }

  // ========================================================================
  // 5. EDUCATION — ALWAYS from source (immutable)
  // ========================================================================
  const education = sourceResume.education.map((ed) => ({ ...ed }));
  // Warn if optimizer attempted to modify education (it shouldn't per interface,
  // but check via any cast for defensive debugging)
  const optEducation = (optimizerOutput as any).education;
  if (optEducation && Array.isArray(optEducation) && optEducation.length > 0) {
    warnings.push(
      `Education immutable guard: optimizer returned ${optEducation.length} education entries. ` +
      `Using source education as-is (education is immutable).`
    );
  }

  // ========================================================================
  // 6. LANGUAGES — ALWAYS from source (immutable)
  // ========================================================================
  const languages: ResumeLanguage[] = sourceResume.languages.map((l) => ({ ...l }));
  // HARD GUARD: if source has languages but assembler produce empty, force restore
  // This covers the case where the pipeline drops languages between stages
  if (sourceResume.languages.length > 0 && languages.length === 0) {
    warnings.push('Languages were dropped — forcing restore from source.');
    languages.push(...sourceResume.languages.map((l) => ({ ...l })));
  }

  // ========================================================================
  // 7. CERTIFICATIONS — ALWAYS from source (immutable)
  // ========================================================================
  const certifications = sourceResume.certifications?.map((c) => ({ ...c })) ?? [];

  // ========================================================================
  // 8. CONTACT — ALWAYS from source (immutable)
  // ========================================================================
  const contact = { ...sourceResume.contact };

  // ========================================================================
  // 9. ASSEMBLE FINAL RESUME
  // ========================================================================
  const finalResume: ResumeData = {
    ...sourceResume, // preserves id, template, accentColor, photoUrl, fileName, source, etc.
    name: sourceResume.name, // immutable
    headline, // mutable (but protected)
    contact, // immutable
    dateOfBirth: sourceResume.dateOfBirth, // immutable
    summary, // mutable
    experience: finalExperience, // merged
    education, // immutable
    skills, // mutable
    languages, // immutable
    certifications, // immutable
    projects: sourceResume.projects, // immutable
    updatedAt: new Date().toISOString(),
    source: "ai-optimized",
  };

  // Apply grammar cleanup to the whole resume
  const cleaned = cleanupResumeGrammar(finalResume);

  // ========================================================================
  // 10. FINGERPRINT VALIDATION
  // ========================================================================
  const fpValidation = validateExperienceFingerprints(cleaned, sourceResume);
  if (!fpValidation.valid) {
    // Don't fail — just warn. The assembler already enforced source entries.
    warnings.push(...fpValidation.violations);
  }

  return {
    resume: cleaned,
    warnings,
    errors,
    matchedById,
    matchedByFingerprint,
    matchedByTitleCompany,
    matchedByIndex,
    unmatched,
  };
}
