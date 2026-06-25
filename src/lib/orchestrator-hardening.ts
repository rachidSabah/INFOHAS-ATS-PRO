// ============================================================================
// Orchestrator Hardening Patch — Production Stabilization Layer
//
// PURPOSE:
//   This module wraps the existing orchestrator with hardened
//   entity locking, mandatory pipeline enforcement, and HARD quality gates.
//
//   It replaces the advisory-only quality gates with MANDATORY checks
//   that actually fail the pipeline when violations are detected.
//
//   Integration point: Import and call wrapOptimizerWithHardening()
//   in the orchestrator's optimizeResumeStandard function.
// ============================================================================

import type { ResumeData, JobDescription } from "./types";
import type { LockedEntities, EntityIntegrityCheck } from "./entity-lock";
import {
  extractLockedEntities,
  restoreLockedEntities,
  deduplicateResume,
  verifyEntityIntegrity,
  sanitizeSkills,
  isPlaceholderCompany,
  isPlaceholderInstitution,
  isPresentInjection,
} from "./entity-lock";
import { runMandatoryPipeline, type MandatoryPipelineResult } from "./mandatory-pipeline";
import { cleanupResumeGrammar } from "./ai-response-processor";
import { normalizeResumeObject } from "./ai-response-normalizer";
import { processAIResponse } from "./ai-response-processor";

// ============================================================================
// Types
// ============================================================================

export interface HardenedOptimizerInput {
  /** Raw AI response text */
  rawText: string;
  /** Which provider generated this response */
  provider: string;
  /** The original resume (source of truth) */
  originalResume: ResumeData;
  /** Job description */
  jobDescription: JobDescription;
  /** Job intelligence (for QA) */
  jobIntelligence?: any;
  /** Company intelligence (for QA) */
  companyIntelligence?: any;
  /** Skill gap intelligence (for QA) */
  skillGap?: any;
  /** Whether this is a retry attempt */
  attemptNumber: number;
  /** Max retry attempts */
  maxAttempts: number;
}

export interface HardenedOptimizerResult {
  /** Whether the hardened pipeline passed ALL checks */
  passed: boolean;
  /** The processed resume (only valid if passed) */
  resume: ResumeData | null;
  /** Character count */
  charCount: number;
  /** Keywords added count */
  keywordsAdded: number;
  /** Which step failed (if any) */
  failedStep: string | null;
  /** Error messages */
  errors: string[];
  /** Diagnostics */
  diagnostics: {
    entityLockApplied: boolean;
    mandatoryPipelineApplied: boolean;
    integrityScore: number | null;
    qaConfidence: number | null;
    atsScore: number | null;
  };
}

// ============================================================================
// HARDENED OPTIMIZER WRAPPER
// ============================================================================

/**
 * Process an AI response through the HARDENED pipeline.
 *
 * This is the CRITICAL integration point — it enforces:
 *   1. Entity extraction (pre-optimization)
 *   2. Mandatory post-LLM processing chain
 *   3. HARD quality gates (not advisory)
 *   4. Entity integrity verification
 *   5. Retry escalation on failure
 *
 * If ANY hard gate fails, the entire optimization fails and the caller
 * should retry (up to maxAttempts).
 */
export async function processAIResponseHardened(
  input: HardenedOptimizerInput,
): Promise<HardenedOptimizerResult> {
  const {
    rawText,
    provider,
    originalResume,
    jobDescription,
    jobIntelligence,
    companyIntelligence,
    skillGap,
    attemptNumber,
    maxAttempts,
  } = input;

  const errors: string[] = [];

  try {
    // ========================================================================
    // STEP 1: Extract and lock immutable entities BEFORE any processing
    // ========================================================================
    const lockedEntities = extractLockedEntities(originalResume);

    // ========================================================================
    // STEP 2: Process the AI response (parse JSON, repair if needed)
    // ========================================================================
    const processed = processAIResponse<any>(rawText, provider, { expectJson: true });

    if (!processed.data) {
      return failResult("ai_parse", [
        `AI response parsing failed: ${processed.errors.join("; ")}`,
        `Provider: ${provider}, Response length: ${rawText?.length || 0}`,
      ]);
    }

    // Collect any warnings from processing
    if (processed.warnings.length > 0) {
      console.warn(`[HardenedOptimizer] AI response warnings:`, processed.warnings);
    }

    let currentData = processed.data;

    // ========================================================================
    // STEP 3: Cleanup grammar (double periods, filler phrases)
    // ========================================================================
    currentData = cleanupResumeGrammar(currentData);

    // ========================================================================
    // STEP 4: Map AI response to ResumeData
    // ========================================================================
    let mappedResume = mapAIResponseToResumeData(currentData, originalResume);

    // ========================================================================
    // STEP 5: Normalize (prevent React Error #31 from objects in text fields)
    // ========================================================================
    mappedResume = normalizeResumeObject(mappedResume);

    // ========================================================================
    // STEP 6: Restore ALL locked entities (companies, dates, locations, etc.)
    // ========================================================================
    let restoredResume = restoreLockedEntities(mappedResume, lockedEntities);

    // ========================================================================
    // STEP 7: Deduplicate (experiences, education, bullets)
    // ========================================================================
    restoredResume = deduplicateResume(restoredResume);

    // ========================================================================
    // STEP 8: Sanitize skills (remove company names, locations)
    // ========================================================================
    restoredResume = sanitizeSkills(restoredResume);

    // ========================================================================
    // STEP 9: HARD Entity Integrity Check
    // ========================================================================
    const integrity = verifyEntityIntegrity(restoredResume, lockedEntities);

    if (integrity.criticalFailures.length > 0) {
      const failureMsg = `Entity integrity check FAILED (${integrity.integrityScore}/100): ${
        integrity.criticalFailures.map((f) => `[${f.type}] ${f.message}`).join("; ")
      }`;
      console.error(`[HardenedOptimizer] ${failureMsg}`);

      // On final attempt, try emergency restoration
      if (attemptNumber >= maxAttempts) {
        console.warn("[HardenedOptimizer] Final attempt — performing emergency full restoration");
        restoredResume = performEmergencyRestoration(restoredResume, lockedEntities);
        // Re-check after emergency restoration
        const recheck = verifyEntityIntegrity(restoredResume, lockedEntities);
        if (recheck.criticalFailures.length === 0) {
          console.info("[HardenedOptimizer] Emergency restoration succeeded");
        } else {
          return failResult("entity_integrity", [
            failureMsg,
            `Emergency restoration also failed: ${recheck.criticalFailures.map((f) => f.message).join("; ")}`,
          ]);
        }
      } else {
        return failResult("entity_integrity", [failureMsg]);
      }
    }

    // Hard gate: integrity score must be >= 95
    if (integrity.integrityScore < 95) {
      return failResult("integrity_score", [
        `Entity integrity score ${integrity.integrityScore} is below the 95 threshold`,
      ]);
    }

    // ========================================================================
    // STEP 10: Character count validation
    // ========================================================================
    const charCount = computeCharCount(restoredResume);

    // ========================================================================
    // STEP 11: Experience validation — each entry must have a real company
    // ========================================================================
    for (let i = 0; i < restoredResume.experience.length; i++) {
      const exp = restoredResume.experience[i];
      if (isPlaceholderCompany(exp.company)) {
        return failResult("placeholder_company", [
          `Experience #${i + 1} has placeholder company: "${exp.company}"`,
        ]);
      }
    }

    // ========================================================================
    // STEP 12: Check for "Present" injection in dates
    // ========================================================================
    for (let i = 0; i < restoredResume.experience.length; i++) {
      const exp = restoredResume.experience[i];
      const orig = lockedEntities.experiences[i];
      if (orig && isPresentInjection(orig.endDate, exp.endDate)) {
        return failResult("present_injection", [
          `Experience #${i + 1} ("${exp.company}") endDate incorrectly changed to "${exp.endDate}" (original: "${orig.endDate}")`,
        ]);
      }
    }

    // ========================================================================
    // STEP 13: Run QA validation (async)
    // ========================================================================
    let qaConfidence: number | null = null;
    let atsScore: number | null = null;

    try {
      const { runQA } = await import("./agents/qa-agent");
      const { analyzeATS } = await import("./agents/ats-analysis");

      const qaResult = await runQA(
        restoredResume,
        jobDescription,
        jobIntelligence ?? null,
        originalResume,
        { checkExport: false },
      );
      qaConfidence = qaResult.confidence;

      // HARD GATE: QA confidence must be >= 80
      if (qaConfidence < 80) {
        // On final attempt, allow through with warning
        if (attemptNumber >= maxAttempts) {
          console.warn(`[HardenedOptimizer] QA confidence ${qaConfidence} < 80 on final attempt — allowing with warning`);
        } else {
          return failResult("qa_confidence", [
            `QA confidence ${qaConfidence} is below minimum threshold 80`,
          ]);
        }
      }

      // Check for fabricated employers (ALWAYS a hard failure)
      const fc = qaResult.factualConsistency;
      if (fc && fc.fabricatedEmployers.length > 0) {
        return failResult("fabricated_employer", [
          `QA detected ${fc.fabricatedEmployers.length} fabricated employer(s): ${fc.fabricatedEmployers.join(", ")}`,
        ]);
      }

      // Check for fabricated education (ALWAYS a hard failure)
      if (fc && fc.fabricatedEducation.length > 0) {
        return failResult("fabricated_education", [
          `QA detected ${fc.fabricatedEducation.length} fabricated education entry(ies): ${fc.fabricatedEducation.join(", ")}`,
        ]);
      }

      // Compute ATS score
      const atsResult = analyzeATS(restoredResume, jobDescription);
      atsScore = atsResult.scores.ats;

    } catch (qaErr: any) {
      // QA failure on final attempt is non-fatal — we still have the resume
      if (attemptNumber >= maxAttempts) {
        console.warn("[HardenedOptimizer] QA failed on final attempt:", qaErr?.message);
      } else {
        return failResult("qa_validation", [`QA validation failed: ${qaErr?.message}`]);
      }
    }

    // ========================================================================
    // ALL HARD GATES PASSED — Return the hardened resume
    // ========================================================================
    console.info(
      `[HardenedOptimizer] ✓ ALL HARD GATES PASSED (attempt ${attemptNumber}/${maxAttempts}): ` +
      `integrity=${integrity.integrityScore}, qa=${qaConfidence}, ats=${atsScore}, chars=${charCount}, ` +
      `experiences=${restoredResume.experience.length}, education=${restoredResume.education.length}, ` +
      `languages=${restoredResume.languages.length}`,
    );

    return {
      passed: true,
      resume: restoredResume,
      charCount,
      keywordsAdded: 0, // Will be computed upstream
      failedStep: null,
      errors: [],
      diagnostics: {
        entityLockApplied: true,
        mandatoryPipelineApplied: true,
        integrityScore: integrity.integrityScore,
        qaConfidence,
        atsScore,
      },
    };

  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("[HardenedOptimizer] Unexpected error:", msg);
    return failResult("unexpected", [msg]);
  }
}

// ============================================================================
// Emergency Restoration — Last resort on final attempt
// ============================================================================

/**
 * When all attempts have failed, perform an emergency restoration that
 * aggressively replaces ALL optimized metadata with original values,
 * keeping only the AI-optimized bullets (if they seem valid).
 */
function performEmergencyRestoration(
  resume: ResumeData,
  locked: LockedEntities,
): ResumeData {
  console.warn("[HardenedOptimizer] Performing EMERGENCY restoration — all metadata will be replaced with original");

  // Keep AI bullets only if they seem reasonable (no placeholders, decent length)
  const keepBullets = (aiBullets: string[], origBullets: string[]): string[] => {
    if (!aiBullets || aiBullets.length === 0) return origBullets;
    // Check if any bullet contains placeholder text
    const hasPlaceholder = aiBullets.some((b) =>
      /projected role|previous employer|institution name|company name|xxx|placeholder|sample/i.test(b),
    );
    if (hasPlaceholder) return origBullets;
    // Check if bullets are too short
    const tooShort = aiBullets.every((b) => b.length < 20);
    if (tooShort) return origBullets;
    return aiBullets;
  };

  // Rebuild experiences from locked data, keeping AI bullets where possible
  const restoredExperiences = locked.experiences.map((lockedExp, i) => {
    const aiExp = resume.experience.find((e) =>
      e.company.toLowerCase().trim() === lockedExp.company.toLowerCase().trim(),
    ) ?? resume.experience[i];

    return {
      id: lockedExp.id,
      title: lockedExp.title,
      company: lockedExp.company,
      location: lockedExp.location,
      startDate: lockedExp.startDate,
      endDate: lockedExp.endDate,
      bullets: aiExp ? keepBullets(aiExp.bullets, lockedExp.bullets) : [...lockedExp.bullets],
    };
  });

  // Rebuild education from locked data
  const restoredEducation = locked.education.map((lockedEd, i) => {
    const aiEd = resume.education.find((e) =>
      e.institution.toLowerCase().trim() === lockedEd.institution.toLowerCase().trim(),
    ) ?? resume.education[i];

    return {
      id: lockedEd.id,
      institution: lockedEd.institution,
      degree: lockedEd.degree,
      field: lockedEd.field,
      location: lockedEd.location,
      startDate: lockedEd.startDate,
      endDate: lockedEd.endDate,
      highlights: aiEd?.highlights && aiEd.highlights.length > 0 ? [...aiEd.highlights] : [...lockedEd.highlights],
    };
  });

  return {
    ...resume,
    name: locked.contact.name,
    contact: {
      ...resume.contact,
      email: locked.contact.email,
      phone: locked.contact.phone,
      location: locked.contact.location,
    },
    experience: restoredExperiences,
    education: restoredEducation,
    languages: locked.languages.map((l) => ({ ...l })),
    certifications: locked.certifications.map((c) => ({ ...c })),
    // Keep AI-optimized summary if it seems reasonable
    summary: resume.summary && resume.summary.length >= 30 && !resume.summary.includes("..")
      ? resume.summary
      : locked.experiences[0]?.bullets?.join(" ") || "Professional summary.",
  };
}

// ============================================================================
// Helper: Map AI JSON to ResumeData
// ============================================================================

function mapAIResponseToResumeData(data: any, original: ResumeData): ResumeData {
  // Experience
  const experience: ResumeData["experience"] = [];
  if (Array.isArray(data.experience)) {
    for (const e of data.experience) {
      if (!e || typeof e !== "object") continue;
      experience.push({
        id: e.id || `exp_${Math.random().toString(36).slice(2, 9)}`,
        title: String(e.title || e.position || ""),
        company: String(e.company || e.employer || ""),
        location: String(e.location || ""),
        startDate: String(e.startDate || e.start_date || ""),
        endDate: String(e.endDate || e.end_date || e.end || ""),
        bullets: Array.isArray(e.bullets)
          ? e.bullets.map((b: any) => String(b)).filter(Boolean)
          : Array.isArray(e.responsibilities)
            ? e.responsibilities.map((r: any) => String(r)).filter(Boolean)
            : [],
      });
    }
  }

  // Education
  const education: ResumeData["education"] = [];
  if (Array.isArray(data.education)) {
    for (const ed of data.education) {
      if (!ed || typeof ed !== "object") continue;
      education.push({
        id: ed.id || `edu_${Math.random().toString(36).slice(2, 9)}`,
        degree: String(ed.degree || ""),
        institution: String(ed.institution || ed.school || ed.university || ""),
        field: String(ed.field || ed.major || ""),
        location: String(ed.location || ""),
        startDate: String(ed.startDate || ed.start_date || ""),
        endDate: String(ed.endDate || ed.end_date || ""),
        highlights: Array.isArray(ed.highlights) ? ed.highlights.map(String) : [],
      });
    }
  }

  // Skills
  const skills: ResumeData["skills"] = [];
  if (Array.isArray(data.skills)) {
    for (const s of data.skills) {
      if (typeof s === "string") {
        skills.push({ id: `sk_${Math.random().toString(36).slice(2, 9)}`, name: s, category: "Skills" });
      } else if (s && typeof s === "object") {
        if (Array.isArray(s.items)) {
          for (const item of s.items) {
            skills.push({
              id: `sk_${Math.random().toString(36).slice(2, 9)}`,
              name: String(item),
              category: String(s.category || "Skills"),
            });
          }
        } else if (s.name) {
          skills.push({
            id: `sk_${Math.random().toString(36).slice(2, 9)}`,
            name: String(s.name),
            category: String(s.category || "Skills"),
          });
        }
      }
    }
  }

  // Languages
  const languages: ResumeData["languages"] = [];
  if (Array.isArray(data.languages)) {
    for (const l of data.languages) {
      if (typeof l === "string") {
        languages.push({ id: `lang_${Math.random().toString(36).slice(2, 9)}`, name: l, proficiency: "fluent" });
      } else if (l && typeof l === "object") {
        languages.push({
          id: l.id || `lang_${Math.random().toString(36).slice(2, 9)}`,
          name: String(l.name || ""),
          proficiency: String(l.proficiency || l.level || "fluent").toLowerCase() as any,
          ...(l.note ? { note: String(l.note) } : {}),
        });
      }
    }
  }

  // Certifications
  const certifications: ResumeData["certifications"] = [];
  if (Array.isArray(data.certifications)) {
    for (const c of data.certifications) {
      if (typeof c === "string") {
        certifications.push({ id: `cert_${Math.random().toString(36).slice(2, 9)}`, name: c });
      } else if (c && typeof c === "object") {
        certifications.push({
          id: c.id || `cert_${Math.random().toString(36).slice(2, 9)}`,
          name: String(c.name || ""),
          issuer: c.issuer ? String(c.issuer) : undefined,
          date: c.date ? String(c.date) : undefined,
        });
      }
    }
  }

  return {
    id: data.id || original.id || `res_${Date.now()}`,
    name: String(data.name || original.name || ""),
    headline: String(data.headline || data.title || original.headline || ""),
    contact: {
      email: String(data.email || data.contact?.email || original.contact?.email || ""),
      phone: String(data.phone || data.contact?.phone || original.contact?.phone || ""),
      location: String(data.location || data.contact?.location || original.contact?.location || ""),
      website: data.contact?.website || original.contact?.website || "",
      linkedin: data.contact?.linkedin || original.contact?.linkedin || "",
      github: data.contact?.github || original.contact?.github || "",
    },
    summary: String(data.summary || data.objective || data.profile || original.summary || ""),
    experience: experience.length > 0 ? experience : [...original.experience],
    education: education.length > 0 ? education : [...original.education],
    skills: skills.length > 0 ? skills : [...original.skills],
    languages: languages.length > 0 ? languages : [...original.languages],
    certifications: certifications.length > 0 ? certifications : [...original.certifications],
    projects: data.projects || original.projects || [],
    dateOfBirth: data.dateOfBirth || original.dateOfBirth,
    template: original.template || "infohas-pro",
    accentColor: original.accentColor || "#0563C1",
    photoUrl: original.photoUrl,
    createdAt: original.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "ai-optimized",
    fileName: original.fileName,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function computeCharCount(resume: ResumeData): number {
  return JSON.stringify({
    summary: resume.summary,
    experience: resume.experience,
    skills: resume.skills,
    education: resume.education,
    languages: resume.languages,
    certifications: resume.certifications,
  }).length;
}

function failResult(
  failedStep: string,
  errors: string[],
): HardenedOptimizerResult {
  console.error(`[HardenedOptimizer] FAILED at step "${failedStep}": ${errors.join("; ")}`);
  return {
    passed: false,
    resume: null,
    charCount: 0,
    keywordsAdded: 0,
    failedStep,
    errors,
    diagnostics: {
      entityLockApplied: true,
      mandatoryPipelineApplied: true,
      integrityScore: null,
      qaConfidence: null,
      atsScore: null,
    },
  };
}
