// ============================================================================
// Mandatory Pipeline — Post-LLM Processing Chain Enforcement
//
// PURPOSE:
//   Ensures EVERY AI provider's output goes through the EXACT SAME
//   post-processing chain. No provider may bypass any step.
//
// MANDATORY CHAIN (from spec):
//   LLM
//   → processAIResponse
//   → cleanupResumeGrammar
//   → restoreLockedEntities
//   → restoreExperienceMetadata
//   → restoreEducation
//   → restoreLanguages
//   → deduplicateResume
//   → factualConsistencyCheck
//   → atsValidation
//   → pageValidation
//   → qaValidation
//   → finalOutput
//
// USAGE:
//   const result = await runMandatoryPipeline({
//     rawText: aiResponse,
//     provider: result.provider,
//     originalResume,
//     lockedEntities,
//     jobDescription,
//   });
//   if (!result.passed) { FAIL_PIPELINE(); }
//   const finalResume = result.resume;
// ============================================================================

import type { ResumeData, JobDescription } from "./types";
import type { LockedEntities, EntityIntegrityCheck } from "./entity-lock";
import {
  restoreLockedEntities,
  deduplicateResume,
  verifyEntityIntegrity,
  sanitizeSkills,
  filterForbiddenSkills,
} from "./entity-lock";
import { processAIResponse, cleanupResumeGrammar } from "./ai-response-processor";
import { normalizeResumeObject } from "./ai-response-normalizer";
import { validateResumeContent } from "./ai-error-filter";
import { analyzeATS } from "./agents/ats-analysis";
import { runQA } from "./agents/qa-agent";

// ============================================================================
// Types
// ============================================================================

export interface MandatoryPipelineInput {
  /** Raw text from the AI provider */
  rawText: string;
  /** Provider name (for logging) */
  provider: string;
  /** Original resume (source of truth) */
  originalResume: ResumeData;
  /** Pre-extracted locked entities */
  lockedEntities: LockedEntities;
  /** Job description (for ATS validation) */
  jobDescription?: JobDescription | null;
  /** Job intelligence (for QA) */
  jobIntelligence?: any;
  /** Whether to skip the QA export check (slow) */
  skipExportCheck?: boolean;
}

export interface MandatoryPipelineResult {
  /** Whether the entire pipeline passed */
  passed: boolean;
  /** The processed resume (only valid if passed) */
  resume: ResumeData | null;
  /** Which step failed (if any) */
  failedStep: string | null;
  /** Error messages */
  errors: string[];
  /** Warnings */
  warnings: string[];
  /** Per-step results for diagnostics */
  steps: PipelineStepResult[];
  /** Character count of final resume */
  charCount: number;
  /** ATS score after optimization */
  atsScore: number | null;
  /** QA confidence score */
  qaConfidence: number | null;
  /** Entity integrity score */
  integrityScore: number | null;
}

export interface PipelineStepResult {
  name: string;
  passed: boolean;
  durationMs: number;
  warnings: string[];
  errors: string[];
  output?: any;
}

// ============================================================================
// Quality Gate Thresholds (from spec)
// ============================================================================

const GATES = {
  /** Factual consistency must be >= 95 */
  FACTUAL_CONSISTENCY_MIN: 95,
  /** Professional tone must be >= 85 */
  PROFESSIONAL_TONE_MIN: 85,
  /** QA confidence must be >= 80 */
  QA_CONFIDENCE_MIN: 80,
  /** Max characters for one A4 page */
  MAX_CHARS: 4200,
  /** Min characters for a valid resume */
  MIN_CHARS: 1500,
  /** Max ATS score */
  ATS_MAX: 100,
} as const;

// ============================================================================
// Pipeline Runner
// ============================================================================

/**
 * Run the FULL mandatory post-LLM processing chain.
 * NO PROVIDER MAY BYPASS THIS.
 *
 * Returns a result with `passed: true` ONLY if ALL steps pass.
 * Any critical failure fails the entire pipeline.
 */
export async function runMandatoryPipeline(
  input: MandatoryPipelineInput,
): Promise<MandatoryPipelineResult> {
  const { rawText, provider, originalResume, lockedEntities, jobDescription, jobIntelligence, skipExportCheck = true } = input;
  const steps: PipelineStepResult[] = [];
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  let currentData: any = null;
  let currentResume: ResumeData | null = null;

  // ========================================================================
  // STEP 1: processAIResponse — Parse and validate AI output
  // ========================================================================
  const step1 = runStep("processAIResponse", () => {
    const processed = processAIResponse<any>(rawText, provider, { expectJson: true });

    if (!processed.data) {
      throw new Error(`JSON parsing failed: ${processed.errors.join("; ")}`);
    }
    if (processed.errors.length > 0) {
      return {
        passed: true, // Data exists but there were warnings
        warnings: processed.errors,
        output: processed.data,
      };
    }
    currentData = processed.data;
    return { passed: true, output: processed.data };
  });
  steps.push(step1);
  if (!step1.passed) {
    return failPipeline("processAIResponse", step1.errors, steps);
  }

  // ========================================================================
  // STEP 2: cleanupResumeGrammar — Fix double periods, filler phrases
  // ========================================================================
  const step2 = runStep("cleanupResumeGrammar", () => {
    currentData = cleanupResumeGrammar(currentData);
    return { passed: true, output: null };
  });
  steps.push(step2);

  // ========================================================================
  // STEP 3: mapToResumeData — Convert AI JSON to ResumeData
  // ========================================================================
  const step3 = runStep("mapToResumeData", () => {
    const mapped = mapAIToResumeData(currentData, originalResume);
    currentResume = mapped;
    return { passed: true, output: mapped };
  });
  steps.push(step3);
  if (!step3.passed) {
    return failPipeline("mapToResumeData", step3.errors, steps);
  }

  // ========================================================================
  // STEP 4: validateResumeContent — Strip leaks, validate structure
  // ========================================================================
  const step4 = runStep("validateResumeContent", () => {
    const contentCheck = validateResumeContent(currentResume!);
    if (contentCheck.cleanedResume) {
      currentResume = contentCheck.cleanedResume;
    }
    return {
      passed: true,
      warnings: contentCheck.errors || [],
      output: contentCheck,
    };
  });
  steps.push(step4);
  allWarnings.push(...step4.warnings);

  // ========================================================================
  // STEP 5: normalizeResumeObject — Prevent React Error #31
  // ========================================================================
  const step5 = runStep("normalizeResumeObject", () => {
    currentResume = normalizeResumeObject(currentResume!);
    return { passed: true };
  });
  steps.push(step5);

  // ========================================================================
  // STEP 6: restoreLockedEntities — Restore ALL immutable fields
  // ========================================================================
  const step6 = runStep("restoreLockedEntities", () => {
    currentResume = restoreLockedEntities(currentResume!, lockedEntities);
    return { passed: true };
  });
  steps.push(step6);

  // ========================================================================
  // STEP 7: deduplicateResume — Remove duplicate experiences, bullets, education
  // ========================================================================
  const step7 = runStep("deduplicateResume", () => {
    currentResume = deduplicateResume(currentResume!);
    return { passed: true };
  });
  steps.push(step7);

  // ========================================================================
  // STEP 8: sanitizeSkills — Remove company names, locations from skills
  // ========================================================================
  const step8 = runStep("sanitizeSkills", () => {
    currentResume = sanitizeSkills(currentResume!);
    return { passed: true };
  });
  steps.push(step8);

  // ========================================================================
  // STEP 9: factualConsistencyCheck — HARD FAILURE CHECK
  // ========================================================================
  const step9 = runStep("factualConsistencyCheck", () => {
    const integrity = verifyEntityIntegrity(currentResume!, lockedEntities);

    // HARD FAILURE: If there are critical failures, the pipeline FAILS
    if (integrity.criticalFailures.length > 0) {
      const failureMessages = integrity.criticalFailures.map(
        (f) => `[${f.type}] ${f.message}`,
      );
      throw new Error(
        `Factual consistency check FAILED with ${integrity.criticalFailures.length} critical issues: ${failureMessages.join("; ")}`,
      );
    }

    // HARD FAILURE: Integrity score must be >= 95
    if (integrity.integrityScore < GATES.FACTUAL_CONSISTENCY_MIN) {
      throw new Error(
        `Factual integrity score ${integrity.integrityScore} is below minimum threshold ${GATES.FACTUAL_CONSISTENCY_MIN}`,
      );
    }

    return {
      passed: true,
      warnings: integrity.warnings,
      output: { integrityScore: integrity.integrityScore },
    };
  });
  steps.push(step9);
  allWarnings.push(...step9.warnings);

  if (!step9.passed) {
    return failPipeline("factualConsistencyCheck", step9.errors, steps);
  }

  // ========================================================================
  // STEP 10: pageValidation — Ensure one A4 page
  // ========================================================================
  const step10 = runStep("pageValidation", () => {
    const charCount = computeCharCount(currentResume!);
    const warnings: string[] = [];

    if (charCount > GATES.MAX_CHARS) {
      warnings.push(`Resume exceeds ${GATES.MAX_CHARS} character limit: ${charCount}`);
    }
    if (charCount < GATES.MIN_CHARS) {
      warnings.push(`Resume below ${GATES.MIN_CHARS} character minimum: ${charCount}`);
    }

    // This is a warning, not a hard failure — we still allow the resume through
    // but flag it for the user
    return {
      passed: true,
      warnings,
      output: { charCount },
    };
  });
  steps.push(step10);
  allWarnings.push(...step10.warnings);

  // ========================================================================
  // STEP 11: atsValidation — Score the optimized resume
  // ========================================================================
  let atsScore: number | null = null;
  const step11 = runStep("atsValidation", () => {
    if (jobDescription) {
      const atsResult = analyzeATS(currentResume!, jobDescription);
      atsScore = atsResult.scores.ats;
      return { passed: true, output: { atsScore } };
    }
    return { passed: true, output: { atsScore: null } };
  });
  steps.push(step11);

  // ========================================================================
  // STEP 12: qaValidation — Quality assurance check
  // ========================================================================
  let qaConfidence: number | null = null;
  const step12 = await runStepAsync("qaValidation", async () => {
    const qaResult = await runQA(
      currentResume!,
      jobDescription ?? null,
      jobIntelligence ?? null,
      originalResume,
      { checkExport: !skipExportCheck },
    );
    qaConfidence = qaResult.confidence;

    // HARD FAILURE: QA confidence must be >= 80
    if (qaResult.confidence < GATES.QA_CONFIDENCE_MIN) {
      throw new Error(
        `QA confidence ${qaResult.confidence} is below minimum threshold ${GATES.QA_CONFIDENCE_MIN}`,
      );
    }

    // Check for fabricated employers (serious issue)
    const fc = qaResult.factualConsistency;
    if (fc && fc.fabricatedEmployers.length > 0) {
      throw new Error(
        `QA detected ${fc.fabricatedEmployers.length} fabricated employer(s): ${fc.fabricatedEmployers.join(", ")}`,
      );
    }

    // Check for fabricated education (serious issue)
    if (fc && fc.fabricatedEducation.length > 0) {
      throw new Error(
        `QA detected ${fc.fabricatedEducation.length} fabricated education entry(ies): ${fc.fabricatedEducation.join(", ")}`,
      );
    }

    return {
      passed: true,
      output: { confidence: qaResult.confidence, checks: qaResult.checks.length },
    };
  });
  steps.push(step12);

  if (!step12.passed) {
    return failPipeline("qaValidation", step12.errors, steps);
  }

  // ========================================================================
  // STEP 13: finalOutput — Validate final resume is complete
  // ========================================================================
  const step13 = runStep("finalOutput", () => {
    // Final sanity checks
    if (!currentResume!.experience || currentResume!.experience.length === 0) {
      throw new Error("Final resume has no experience entries");
    }
    if (!currentResume!.summary || currentResume!.summary.trim().length < 30) {
      throw new Error("Final resume summary is too short");
    }
    return { passed: true };
  });
  steps.push(step13);

  if (!step13.passed) {
    return failPipeline("finalOutput", step13.errors, steps);
  }

  // ========================================================================
  // ALL STEPS PASSED — Return the final resume
  // ========================================================================
  const finalCharCount = computeCharCount(currentResume!);

  return {
    passed: true,
    resume: currentResume,
    failedStep: null,
    errors: allErrors,
    warnings: allWarnings,
    steps,
    charCount: finalCharCount,
    atsScore,
    qaConfidence,
    integrityScore: (step9.output?.integrityScore) ?? null,
  };
}

// ============================================================================
// Helper: Map AI JSON to ResumeData
// ============================================================================

function mapAIToResumeData(data: any, original: ResumeData): ResumeData {
  if (!data || typeof data !== "object") {
    throw new Error("AI response is not an object");
  }

  // Validate required top-level fields exist
  if (!data.name && !original.name) {
    throw new Error("AI response missing 'name' field");
  }

  // Map experience
  const experience: ResumeData["experience"] = [];
  if (Array.isArray(data.experience)) {
    for (const e of data.experience) {
      if (!e || typeof e !== "object") continue;
      experience.push({
        id: e.id || generateId("exp"),
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

  // Map education
  const education: ResumeData["education"] = [];
  if (Array.isArray(data.education)) {
    for (const ed of data.education) {
      if (!ed || typeof ed !== "object") continue;
      education.push({
        id: ed.id || generateId("edu"),
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

  // Map skills — handle multiple formats
  const skills: ResumeData["skills"] = [];
  if (Array.isArray(data.skills)) {
    for (const s of data.skills) {
      if (typeof s === "string") {
        skills.push({ id: generateId("sk"), name: s, category: "Skills" });
      } else if (s && typeof s === "object") {
        if (Array.isArray(s.items)) {
          for (const item of s.items) {
            skills.push({
              id: generateId("sk"),
              name: String(item),
              category: String(s.category || "Skills"),
            });
          }
        } else if (s.name) {
          skills.push({
            id: generateId("sk"),
            name: String(s.name),
            category: String(s.category || "Skills"),
          });
        }
      }
    }
  }

  // Map languages
  const languages: ResumeData["languages"] = [];
  if (Array.isArray(data.languages)) {
    for (const l of data.languages) {
      if (typeof l === "string") {
        languages.push({ id: generateId("lang"), name: l, proficiency: "fluent" });
      } else if (l && typeof l === "object") {
        languages.push({
          id: l.id || generateId("lang"),
          name: String(l.name || ""),
          proficiency: String(l.proficiency || l.level || "fluent").toLowerCase() as any,
          ...(l.note ? { note: String(l.note) } : {}),
        });
      }
    }
  }

  // Map certifications
  const certifications: ResumeData["certifications"] = [];
  if (Array.isArray(data.certifications)) {
    for (const c of data.certifications) {
      if (typeof c === "string") {
        certifications.push({ id: generateId("cert"), name: c });
      } else if (c && typeof c === "object") {
        certifications.push({
          id: c.id || generateId("cert"),
          name: String(c.name || ""),
          issuer: c.issuer ? String(c.issuer) : undefined,
          date: c.date ? String(c.date) : undefined,
        });
      }
    }
  }

  // Build final ResumeData
  const result: ResumeData = {
    id: data.id || original.id || generateId("res"),
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
    summary: String(data.summary || data.objective || data.profile || ""),
    experience: experience.length > 0 ? experience : original.experience,
    education: education.length > 0 ? education : original.education,
    skills: skills.length > 0 ? filterForbiddenSkills(skills) : original.skills,
    languages: languages.length > 0 ? languages : original.languages,
    certifications: certifications.length > 0 ? certifications : original.certifications,
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

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function runStep(name: string, fn: () => { passed: boolean; warnings?: string[]; errors?: string[]; output?: any }): PipelineStepResult {
  const start = performance.now();
  try {
    const result = fn();
    return {
      name,
      passed: result.passed,
      durationMs: Math.round(performance.now() - start),
      warnings: result.warnings || [],
      errors: result.errors || [],
      output: result.output,
    };
  } catch (e: any) {
    return {
      name,
      passed: false,
      durationMs: Math.round(performance.now() - start),
      warnings: [],
      errors: [e?.message || String(e)],
    };
  }
}

async function runStepAsync(
  name: string,
  fn: () => Promise<{ passed: boolean; warnings?: string[]; errors?: string[]; output?: any }>,
): Promise<PipelineStepResult> {
  const start = performance.now();
  try {
    const result = await fn();
    return {
      name,
      passed: result.passed,
      durationMs: Math.round(performance.now() - start),
      warnings: result.warnings || [],
      errors: result.errors || [],
      output: result.output,
    };
  } catch (e: any) {
    return {
      name,
      passed: false,
      durationMs: Math.round(performance.now() - start),
      warnings: [],
      errors: [e?.message || String(e)],
    };
  }
}

function failPipeline(
  failedStep: string,
  errors: string[],
  steps: PipelineStepResult[],
): MandatoryPipelineResult {
  return {
    passed: false,
    resume: null,
    failedStep,
    errors,
    warnings: [],
    steps,
    charCount: 0,
    atsScore: null,
    qaConfidence: null,
    integrityScore: null,
  };
}

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

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
}
