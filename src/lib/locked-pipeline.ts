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

import type { ResumeData, JobDescription, AgentDirectives } from "./types";
import { runBulletOnlyOptimizer, buildOptimizerInput } from "./bullet-only-optimizer";
import { assembleResume } from "./resume-assembler";
import { runStructureGuardian } from "./structure-guardian";
import { validateExperienceFingerprints } from "./experience-fingerprint";
import { createDebugArtifacts, persistDebugArtifacts } from "./debug-persistence";

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
  agentDirectives?: AgentDirectives,
): Promise<LockedPipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // ========================================================================
  // Step 1: Lock Entities (compute fingerprints — implicit in assembler)
  // ========================================================================
  // Fingerprints are computed on-demand by the assembler, so no explicit
  // step needed here. But we log the source experience count for verification.
  console.info(`[Locked Pipeline] Source resume: ${sourceResume.experience.length} experience entries, ${sourceResume.education.length} education entries, ${sourceResume.languages.length} languages`);
  if (agentDirectives) {
    console.info(`[Locked Pipeline] Agent directives: supervisor.strictMode=${agentDirectives.supervisor.strictMode}, summary.atsAggressiveness=${agentDirectives.summary.atsAggressiveness}, experience.rewriteBulletsOnly=${agentDirectives.experience.rewriteBulletsOnly}`);
  }

  // GUARD: If source resume has NO experience entries, the locked pipeline
  // cannot function (it requires experience IDs to match). In this case,
  // return the source resume as-is with a warning. The orchestrator should
  // fall back to the legacy path, but if it doesn't, this guard prevents
  // the pipeline from producing a completely empty resume.
  if (sourceResume.experience.length === 0 && sourceResume.education.length === 0 && sourceResume.languages.length === 0) {
    console.warn(`[Locked Pipeline] Source resume is EMPTY (0 experience, 0 education, 0 languages). Returning source as-is — the parser may have failed to extract the PDF content.`);
    warnings.push("Source resume is empty — the parser may have failed to extract the PDF content. Returning source resume without optimization.");
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

  // ========================================================================
  // Step 2: Run Bullet-Only Optimizer
  // ========================================================================
  const optimizerInput = buildOptimizerInput(sourceResume, jd, intelligenceContext, agentDirectives);
  const optimizerResult = await runBulletOnlyOptimizer(sourceResume, jd, intelligenceContext, agentDirectives);
  warnings.push(...optimizerResult.warnings);

  console.info(`[Locked Pipeline] Optimizer returned: ${optimizerResult.output.experiences?.length ?? 0} experiences, ${optimizerResult.output.skills?.length ?? 0} skills`);

  // ========================================================================
  // Step 3: Assemble Resume (application-owned)
  // ========================================================================
  const assembleResult = assembleResume(sourceResume, optimizerResult.output);
  warnings.push(...assembleResult.warnings);
  errors.push(...assembleResult.errors);

  console.info(`[Locked Pipeline] Assembler: ${assembleResult.matchedById} by ID, ${assembleResult.matchedByFingerprint} by fingerprint, ${assembleResult.matchedByTitleCompany} by title/company, ${assembleResult.matchedByIndex} by index, ${assembleResult.unmatched} unmatched`);

  // ========================================================================
  // Step 4: Validate Fingerprints
  // ========================================================================
  const fpValidation = validateExperienceFingerprints(assembleResult.resume, sourceResume);
  if (!fpValidation.valid) {
    warnings.push(...fpValidation.violations);
    console.warn(`[Locked Pipeline] Fingerprint validation: ${fpValidation.violations.length} violation(s)`);
  } else {
    console.info(`[Locked Pipeline] Fingerprint validation: PASS (${fpValidation.matched} matched)`);
  }

  // ========================================================================
  // Step 5: Structure Guardian
  // ========================================================================
  const guardianResult = runStructureGuardian(assembleResult.resume, sourceResume);
  warnings.push(...guardianResult.warnings);
  if (guardianResult.criticalIssues.length > 0) {
    errors.push(...guardianResult.criticalIssues);
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
    assembleResult.resume, // final = assembled (guardian doesn't modify)
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
}
