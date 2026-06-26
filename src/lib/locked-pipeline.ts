// ============================================================================
// Locked Pipeline
//
// The new mandatory pipeline that ALL providers must use.
//
// Pipeline:
//   1. Parse Resume (already done by parser)
//   2. Lock Entities (compute fingerprints, build ID map)
//   3. Run Bullet-Only Optimizer (LLM returns ONLY summary, skills, bullets)
//   4. Assemble Resume (application-owned — merges source + optimizer output)
//   5. Validate Fingerprints (ensure no experience entries were dropped/added)
//   6. Structure Guardian (detect corruption, malformed fragments)
//   7. Final Output
//
// No provider may bypass this chain.
//
// This replaces the old architecture where the LLM was allowed to generate
// an entire resume and the application tried to restore locked entities
// after the fact (which was unreliable and caused all the corruption).
// ============================================================================

"use client";

import type { ResumeData, JobDescription, AgentDirectives, OptimizerDirectiveConfig } from "./types";
import { runBulletOnlyOptimizer, buildOptimizerInput } from "./bullet-only-optimizer";
import { assembleResume } from "./resume-assembler";
import { runStructureGuardian } from "./structure-guardian";
import { validateExperienceFingerprints } from "./experience-fingerprint";
import { createDebugArtifacts, persistDebugArtifacts } from "./debug-persistence";
import { expandResume, compressResume, validatePageFill } from "./agents/page-balancer";

export interface LockedPipelineResult {
  resume: ResumeData;
  provider: string;
  charCount: number;
  keywordsAdded: number;
  warnings: string[];
  errors: string[];
  guardianScore: number;
  guardianStatus: "PASS" | "REQUIRES_MANUAL_REVIEW";
  fingerprintValid: boolean;
  assemblerStats: {
    matchedById: number;
    matchedByFingerprint: number;
    matchedByTitleCompany: number;
    matchedByIndex: number;
    unmatched: number;
  };
}

export class LockedPipelineError extends Error {
  constructor(message: string, public readonly status: "REQUIRES_MANUAL_REVIEW", public readonly issues: string[]) {
    super(message);
    this.name = "LockedPipelineError";
  }
}

/**
 * Run the locked pipeline.
 *
 * This is the SINGLE entry point for the new architecture.
 * Both aviation and standard paths should use this.
 *
 * @param sourceResume - The parsed resume (source of truth)
 * @param jd - The job description
 * @param intelligenceContext - Multi-source intelligence context string
 * @returns LockedPipelineResult with the final resume + diagnostics
 */
export async function runLockedPipeline(
  sourceResume: ResumeData,
  jd: JobDescription,
  intelligenceContext: string,
  directiveConfig?: OptimizerDirectiveConfig | null,
): Promise<LockedPipelineResult> {
  const agentDirectives = directiveConfig?.agentDirectives;
  const warnings: string[] = [];
  const errors: string[] = [];

  // ========================================================================
  // Step 1: Lock Entities (verify immutable IDs exist)
  // ========================================================================
  console.info(`[Locked Pipeline] Source resume: ${sourceResume.experience.length} experience entries, ${sourceResume.education.length} education entries, ${sourceResume.languages.length} languages`);
  if (agentDirectives) {
    console.info(`[Locked Pipeline] Agent directives: supervisor.strictMode=${agentDirectives.supervisor.strictMode}, summary.atsAggressiveness=${agentDirectives.summary.atsAggressiveness}, experience.rewriteBulletsOnly=${agentDirectives.experience.rewriteBulletsOnly}`);
  }

  // Validate that every source experience has an ID
  for (let i = 0; i < sourceResume.experience.length; i++) {
    const exp = sourceResume.experience[i];
    if (!exp.id) {
      throw new LockedPipelineError(
        `Pipeline failed: Source experience at index ${i} is missing a required immutable ID.`,
        "REQUIRES_MANUAL_REVIEW",
        [`Source experience at index ${i} has no ID.`]
      );
    }
  }

  // GUARD: If source resume has NO experience entries, the locked pipeline
  // cannot function (it requires experience IDs to match). In this case,
  // return the source resume as-is with a warning.
  if (sourceResume.experience.length === 0 && sourceResume.education.length === 0 && sourceResume.languages.length === 0) {
    console.warn(`[Locked Pipeline] Source resume is EMPTY (0 experience, 0 education, 0 languages). Returning source as-is.`);
    warnings.push("Source resume is empty. Returning source resume without optimization.");
    errors.push("Source resume has no content to optimize.");
    const charCount = JSON.stringify({
      summary: sourceResume.summary, experience: sourceResume.experience,
      skills: sourceResume.skills, education: sourceResume.education, languages: sourceResume.languages,
    }).length;
    return {
      resume: sourceResume,
      provider: "none",
      charCount,
      keywordsAdded: 0,
      warnings,
      errors,
      guardianScore: 0,
      guardianStatus: "REQUIRES_MANUAL_REVIEW",
      fingerprintValid: true,
      assemblerStats: {
        matchedById: 0, matchedByFingerprint: 0, matchedByTitleCompany: 0,
        matchedByIndex: 0, unmatched: 0,
      },
    };
  }

  const excludeProviderIds: string[] = [];
  let attempts = 0;
  // If supervisor settings enable provider switch, allow up to 3 attempts, else 1
  const maxAttempts = agentDirectives?.supervisor?.enableProviderSwitch ? 3 : 1;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      // ========================================================================
      // Step 2: Run Bullet-Only Optimizer (supports excludeProviderIds)
      // ========================================================================
      const optimizerInput = buildOptimizerInput(sourceResume, jd, intelligenceContext, directiveConfig);
      const optimizerResult = await runBulletOnlyOptimizer(sourceResume, jd, intelligenceContext, directiveConfig, excludeProviderIds);
      warnings.push(...optimizerResult.warnings);

      console.info(`[Locked Pipeline] Attempt ${attempts}: Optimizer returned: ${optimizerResult.output.experiences?.length ?? 0} experiences, ${optimizerResult.output.skills?.length ?? 0} skills`);

      // ========================================================================
      // Step 3: Assemble Resume (application-owned)
      // ========================================================================
      const assembleResult = assembleResume(sourceResume, optimizerResult.output);
      warnings.push(...assembleResult.warnings);
      errors.push(...assembleResult.errors);

      // ========================================================================
      // Dynamic Page Balancing (A4 One-Page Fit)
      // ========================================================================
      let balancedResume = assembleResult.resume;
      try {
        const pageFill = validatePageFill(balancedResume, directiveConfig);
        console.info(`[Locked Pipeline Page Balancer] Action: ${pageFill.action}, Chars: ${pageFill.charCount}, Target: ${pageFill.targetChars}`);
        if (pageFill.action === "expand") {
          const jdKeywords = jd.keywords ?? [];
          const resumeText = JSON.stringify(balancedResume).toLowerCase();
          const missingKeywords = jdKeywords.filter((k) => !resumeText.includes(k.toLowerCase()));
          balancedResume = expandResume(balancedResume, {
            originalResume: sourceResume,
            jd,
            targetChars: pageFill.targetChars,
            currentChars: pageFill.charCount,
            missingKeywords,
            directiveConfig,
          });
        } else if (pageFill.action === "compress") {
          balancedResume = compressResume(balancedResume, {
            targetChars: pageFill.targetChars,
            maxChars: Math.floor(pageFill.targetChars * 1.04),
            currentChars: pageFill.charCount,
            directiveConfig,
          });
        }
      } catch (pbErr) {
        console.warn("[Locked Pipeline Page Balancer] Failed (non-fatal):", pbErr);
      }
      assembleResult.resume = balancedResume;

      console.info(`[Locked Pipeline] Assembler: ${assembleResult.matchedById} by ID, ${assembleResult.matchedByFingerprint} by fingerprint, ${assembleResult.matchedByTitleCompany} by title/company, ${assembleResult.matchedByIndex} by index, ${assembleResult.unmatched} unmatched`);

      // ========================================================================
      // Content Preservation checks:
      // "If optimized output contains: less experiences than source
      //  OR less education entries than source
      //  OR less languages than source
      //  OR missing contact information
      //  THEN: FAIL OPTIMIZATION. Retry provider."
      // ========================================================================
      const srcExpCount = sourceResume.experience?.length ?? 0;
      const srcEduCount = sourceResume.education?.length ?? 0;
      const srcLangCount = sourceResume.languages?.length ?? 0;

      const optExpCount = assembleResult.resume.experience?.length ?? 0;
      const optEduCount = assembleResult.resume.education?.length ?? 0;
      const optLangCount = assembleResult.resume.languages?.length ?? 0;

      const hasContactInfo = assembleResult.resume.contact?.email && assembleResult.resume.name;

      const contentViolations: string[] = [];
      if (optExpCount < srcExpCount) {
        contentViolations.push(`Experiences dropped: original ${srcExpCount}, optimized ${optExpCount}`);
      }
      if (optEduCount < srcEduCount) {
        contentViolations.push(`Education entries dropped: original ${srcEduCount}, optimized ${optEduCount}`);
      }
      if (optLangCount < srcLangCount) {
        contentViolations.push(`Languages dropped: original ${srcLangCount}, optimized ${optLangCount}`);
      }
      if (!hasContactInfo) {
        contentViolations.push(`Missing critical contact information (email or name).`);
      }

      // Check if ID is missing in any final experience
      for (let i = 0; i < assembleResult.resume.experience.length; i++) {
        const exp = assembleResult.resume.experience[i];
        if (!exp.id) {
          contentViolations.push(`Assembled experience at index ${i} has no ID.`);
        }
      }

      // ========================================================================
      // Step 4: Validate Fingerprints
      // ========================================================================
      const fpValidation = validateExperienceFingerprints(assembleResult.resume, sourceResume);
      if (!fpValidation.valid) {
        contentViolations.push(...fpValidation.violations);
      }

      // If there are content violations, fail this optimization attempt to trigger retry
      if (contentViolations.length > 0) {
        const errorMsg = `Pipeline content validation failed: ${contentViolations.join("; ")}`;
        const errObj: any = new Error(errorMsg);
        errObj.provider = optimizerResult.provider; // tag the provider to exclude it
        throw errObj;
      }

      // ========================================================================
      // Step 5: Structure Guardian
      // ========================================================================
      const guardianResult = runStructureGuardian(assembleResult.resume, sourceResume);
      warnings.push(...guardianResult.warnings);
      if (guardianResult.criticalIssues.length > 0) {
        errors.push(...guardianResult.criticalIssues);
      }

      // Strict Mode checking
      if (agentDirectives?.supervisor?.strictMode && guardianResult.criticalIssues.length > 0) {
        const errObj: any = new Error(`Structure Guardian critical issues: ${guardianResult.criticalIssues.join("; ")}`);
        errObj.provider = optimizerResult.provider;
        throw errObj;
      }

      // ========================================================================
      // Step 6: Compute final char count
      // ========================================================================
      const charCount = JSON.stringify({
        summary: assembleResult.resume.summary,
        experience: assembleResult.resume.experience,
        skills: assembleResult.resume.skills,
        education: assembleResult.resume.education,
        languages: assembleResult.resume.languages,
      }).length;

      // ========================================================================
      // Step 7: Persist debug artifacts
      // ========================================================================
      const debugArtifacts = createDebugArtifacts(
        sourceResume,
        optimizerInput,
        optimizerResult.rawResponse,
        optimizerResult.output,
        assembleResult.resume,
        assembleResult.resume,
      );
      persistDebugArtifacts(debugArtifacts);

      // ========================================================================
      // Step 8: Return result
      // ========================================================================
      const result: LockedPipelineResult = {
        resume: assembleResult.resume,
        provider: optimizerResult.provider,
        charCount,
        keywordsAdded: optimizerResult.output.missingKeywordsAdded?.length ?? 0,
        warnings,
        errors,
        guardianScore: guardianResult.score,
        guardianStatus: guardianResult.status,
        fingerprintValid: fpValidation.valid,
        assemblerStats: {
          matchedById: assembleResult.matchedById,
          matchedByFingerprint: assembleResult.matchedByFingerprint,
          matchedByTitleCompany: assembleResult.matchedByTitleCompany,
          matchedByIndex: assembleResult.matchedByIndex,
          unmatched: assembleResult.unmatched,
        },
      };

      console.info(
        `[Locked Pipeline] Complete — provider: ${result.provider}, ` +
        `charCount: ${result.charCount}, ` +
        `guardian: ${result.guardianStatus} (${result.guardianScore}/100), ` +
        `fingerprint: ${result.fingerprintValid ? "PASS" : "FAIL"}, ` +
        `warnings: ${warnings.length}, errors: ${errors.length}`,
      );

      return result;

    } catch (err: any) {
      console.warn(`[Locked Pipeline] Attempt ${attempts} failed: ${err.message || err}`);
      if (err.provider) {
        excludeProviderIds.push(err.provider);
      }
      if (attempts >= maxAttempts) {
        // Exceeded max attempts, bubble up the error as a LockedPipelineError
        throw new LockedPipelineError(
          `Pipeline failed after ${attempts} attempts. Last error: ${err.message || err}`,
          "REQUIRES_MANUAL_REVIEW",
          [err.message || String(err)]
        );
      }
    }
  }

  throw new LockedPipelineError(
    `Pipeline failed after execution attempts.`,
    "REQUIRES_MANUAL_REVIEW",
    ["Exhausted attempts"]
  );
}
