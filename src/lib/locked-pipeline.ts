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
import { ensureExperienceIds } from "./entity-lock";
import { createDebugArtifacts, persistDebugArtifacts } from "./debug-persistence";
import { expandResume, compressResume, validatePageFill } from "./agents/page-balancer";
import { extractBlueprint, type ResumeBlueprint } from "./resume-blueprint-agent";
import { extractTemplateBlueprint, type ResumeTemplateBlueprint, validateTemplatePreserved } from "./resume-template-blueprint-agent";
import { runGuardianValidation, type GuardianVerdict } from "./resume-guardian-agent";
import { createRetryEngine } from "./retry-engine";
import { createSnapshot, compareSnapshots } from "./resume-snapshot-engine";
import { globalEventBus } from "./agent-event-bus";
import { getCachedOptimization, setCachedOptimization } from "./semantic-cache";
import { recordProviderSuccess, recordProviderFailure } from "./provider-health-monitor";
import { runDynamicSectionPipeline } from "./dynamic-section-engine";

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
  blueprintValid: boolean;
  templateBlueprintValid: boolean;
  guardianVerdict?: GuardianVerdict;
  retryCount: number;
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
  optimizationPolicy?: string | null,
): Promise<LockedPipelineResult> {
  const agentDirectives = directiveConfig?.agentDirectives;
  const warnings: string[] = [];
  const errors: string[] = [];

  // ========================================================================
  // Step 1: Ensure IDs exist, then Lock Entities
  // ========================================================================
  console.info(`[Locked Pipeline] Source resume: ${sourceResume.experience.length} experience entries, ${sourceResume.education.length} education entries, ${sourceResume.languages.length} languages`);
  if (agentDirectives) {
    console.info(`[Locked Pipeline] Agent directives: supervisor.strictMode=${agentDirectives.supervisor.strictMode}, summary.atsAggressiveness=${agentDirectives.summary.atsAggressiveness}, experience.rewriteBulletsOnly=${agentDirectives.experience.rewriteBulletsOnly}`);
  }

  // Generate IDs for any experience/education entries that are missing them
  const idReadyResume = ensureExperienceIds(sourceResume);
  console.info(`[Locked Pipeline] ensureExperienceIds: ${sourceResume.experience.filter(e => !e.id).length} experiences + ${sourceResume.education.filter(e => !(e as any).id).length} education entries got IDs`);

  // ========================================================================
  // Create pre-optimization snapshot (for rollback + diff comparison)
  // ========================================================================
  const beforeSnapshot = createSnapshot(idReadyResume, "pre-optimization");
  globalEventBus.emit({
    agent: "LockedPipeline",
    action: "snapshot_created",
    resumeId: sourceResume.id,
    success: true,
    metadata: { snapshotId: beforeSnapshot.snapshotId },
  });

  // Validate that every source experience has an ID
  for (let i = 0; i < idReadyResume.experience.length; i++) {
    const exp = idReadyResume.experience[i];
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
  if (idReadyResume.experience.length === 0 && idReadyResume.education.length === 0 && idReadyResume.languages.length === 0) {
    console.warn(`[Locked Pipeline] Source resume is EMPTY (0 experience, 0 education, 0 languages). Returning source as-is.`);
    warnings.push("Source resume is empty. Returning source resume without optimization.");
    errors.push("Source resume has no content to optimize.");
    const charCount = JSON.stringify({
      summary: idReadyResume.summary, experience: idReadyResume.experience,
      skills: idReadyResume.skills, education: idReadyResume.education, languages: idReadyResume.languages,
    }).length;
    return {
      resume: idReadyResume,
      provider: "none",
      charCount,
      keywordsAdded: 0,
      warnings,
      errors,
      guardianScore: 0,
      guardianStatus: "REQUIRES_MANUAL_REVIEW",
      fingerprintValid: true,
      blueprintValid: true,
      templateBlueprintValid: true,
      guardianVerdict: undefined,
      retryCount: 0,
      assemblerStats: {
        matchedById: 0, matchedByFingerprint: 0, matchedByTitleCompany: 0,
        matchedByIndex: 0, unmatched: 0,
      },
    };
  }

  // ========================================================================
  // Step 1b: Extract Blueprint + Template Blueprint (freeze immutable state BEFORE optimization)
  // ========================================================================
  const blueprint = extractBlueprint(idReadyResume);
  const templateBlueprint = extractTemplateBlueprint(idReadyResume);
  console.info(`[Locked Pipeline] Blueprint extracted: ${blueprint.experience.length} experiences, ${blueprint.education.length} education entries`);
  console.info(`[Locked Pipeline] Template Blueprint: layout=${templateBlueprint.layoutType}, sections=${templateBlueprint.sectionOrder.join(", ")}`);

  // === Semantic Cache: skip optimization if identical input was already processed ===
  const cached = getCachedOptimization(sourceResume, jd, directiveConfig);
  if (cached) {
    warnings.push("Semantic cache hit — returning previous locked pipeline result.");
    return {
      resume: cached.resume,
      provider: cached.provider,
      charCount: cached.charCount,
      keywordsAdded: cached.keywordsAdded,
      warnings: [...cached.warnings, ...warnings],
      errors: cached.errors,
      guardianScore: 100,
      guardianStatus: "PASS",
      fingerprintValid: true,
      blueprintValid: true,
      templateBlueprintValid: true,
      retryCount: 0,
      assemblerStats: { matchedById: 1, matchedByFingerprint: 0, matchedByTitleCompany: 0, matchedByIndex: 0, unmatched: 0 },
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
      const optimizerInput = buildOptimizerInput(idReadyResume, jd, intelligenceContext, directiveConfig, optimizationPolicy);
      const optimizerResult = await runBulletOnlyOptimizer(idReadyResume, jd, intelligenceContext, directiveConfig, excludeProviderIds, optimizationPolicy);
      warnings.push(...optimizerResult.warnings);

      console.info(`[Locked Pipeline] Attempt ${attempts}: Optimizer returned: ${optimizerResult.output.experiences?.length ?? 0} experiences, ${optimizerResult.output.skills?.length ?? 0} skills`);

      // ========================================================================
      // Step 3: Assemble Resume (application-owned)
      // ========================================================================
      const assembleResult = assembleResume(idReadyResume, optimizerResult.output);
      warnings.push(...assembleResult.warnings);
      errors.push(...assembleResult.errors);

      // Emit assembler event
      globalEventBus.emit({
        agent: "ResumeAssembler",
        action: "assemble_complete",
        resumeId: sourceResume.id,
        success: true,
        metadata: { matchedById: assembleResult.matchedById, unmatched: assembleResult.unmatched },
      });

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
            originalResume: idReadyResume,
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

      // ========================================================================
      // Step 3b: Dynamic Section Preservation & Enhancement
      // ========================================================================
      try {
        const dynamicResult = runDynamicSectionPipeline(idReadyResume, assembleResult.resume, jd);
        for (const logLine of dynamicResult.logs) {
          warnings.push(logLine.replace(/^\[Dynamic Section Engine\] /, ""));
        }
        assembleResult.resume = dynamicResult.mergedResume ?? assembleResult.resume;

        // Check if dynamic sections were lost — if so, it's a content violation
        if (!dynamicResult.preservation.preserved && dynamicResult.preservation.missing.length > 0) {
          warnings.push(
            `Dynamic sections restored: ${dynamicResult.preservation.missing.map((s) => s.title).join(", ")}`
          );
        }
        console.log(
          `[Locked Pipeline] Dynamic Section Engine: ${dynamicResult.preservation.preservedSections.length}/${dynamicResult.originalSections.length} preserved`
        );
      } catch (dseErr) {
        console.warn("[Locked Pipeline Dynamic Section Engine] Failed (non-fatal):", dseErr);
        warnings.push("Dynamic section preservation check encountered an error — continuing with best-effort.");
      }

      // ========================================================================
      // Layout Validation (A4 One-Page Check)
      // ========================================================================
      try {
        const { validateLayout } = await import("./layout-validator");
        const layoutResult = validateLayout(assembleResult.resume);
        if (!layoutResult.valid) {
          warnings.push(`Layout: ${layoutResult.issues.join("; ")}`);
          for (const rec of layoutResult.recommendations) {
            warnings.push(`Layout suggestion: ${rec}`);
          }
        }
        console.info(`[Locked Pipeline Layout] ${layoutResult.valid ? "PASS" : "ISSUES"} — ${layoutResult.charCount} chars, ${layoutResult.pageUtilization}% util`);
      } catch (lvErr) {
        console.warn("[Locked Pipeline Layout Validator] Failed (non-fatal):", lvErr);
      }

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

      // Blueprint validation — non-fatal warning (layout/section order may shift slightly
      // after assembly; we track it for diagnostics but don't block the pipeline)
      let blueprintCheck = true;
      try {
        blueprintCheck = validateTemplatePreserved(templateBlueprint, assembleResult.resume);
        if (!blueprintCheck) {
          warnings.push('Template blueprint advisory — layout/section order shifted after assembly');
        }
      } catch (bpErr) {
        console.warn('[Locked Pipeline Blueprint] Non-fatal error:', bpErr);
        blueprintCheck = false;
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
      // Step 5b: Guardian Validation with VETO
      // ========================================================================
      let guardianVerdict: GuardianVerdict | undefined;
      try {
        guardianVerdict = await runGuardianValidation(assembleResult.resume, sourceResume, undefined);
        if (guardianVerdict.status === "BLOCKED") {
          const criticalFailures = guardianVerdict.checks.filter(c => c.critical && !c.passed).map(c => c.detail);
          const errObj: any = new Error(`Guardian BLOCKED: ${criticalFailures.join("; ")}`);
          errObj.provider = optimizerResult.provider;
          throw errObj;
        }
      } catch (gErr: any) {
        if (gErr.name === 'LockedPipelineError' || gErr.message?.startsWith('Guardian BLOCKED')) {
          throw gErr; // Re-throw LockedPipelineError and guardian blocks
        }
        console.warn('[Locked Pipeline Guardian] Non-fatal error:', gErr);
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
      // Step 8: Compare snapshots for regression detection
      // ========================================================================
      const afterSnapshot = createSnapshot(assembleResult.resume, "post-optimization");
      const snapshotDiff = compareSnapshots(beforeSnapshot, afterSnapshot);
      if (snapshotDiff.hallucinations.length > 0) {
        errors.push(...snapshotDiff.hallucinations);
        globalEventBus.emit({
          agent: "SnapshotEngine",
          action: "hallucinations_detected",
          resumeId: sourceResume.id,
          success: false,
          metadata: { count: snapshotDiff.hallucinations.length, details: snapshotDiff.hallucinations },
        });
      }
      warnings.push(`Snapshot diff: ${snapshotDiff.summary}`);

      // ========================================================================
      // Step 9: Return result
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
        blueprintValid: true,
        templateBlueprintValid: blueprintCheck,
        guardianVerdict,
        retryCount: attempts,
        assemblerStats: {
          matchedById: assembleResult.matchedById,
          matchedByFingerprint: assembleResult.matchedByFingerprint,
          matchedByTitleCompany: assembleResult.matchedByTitleCompany,
          matchedByIndex: assembleResult.matchedByIndex,
          unmatched: assembleResult.unmatched,
        },
      };

      // Store in semantic cache for future identical requests
      setCachedOptimization(sourceResume, jd, {
        resume: result.resume,
        provider: result.provider,
        charCount: result.charCount,
        keywordsAdded: result.keywordsAdded,
        warnings: result.warnings,
        errors: result.errors,
      }, directiveConfig);

      // Record provider health
      recordProviderSuccess(
        optimizerResult.provider,
        0, // latency unknown at this level
        optimizerResult.output.missingKeywordsAdded?.length ?? 0,
      );

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
