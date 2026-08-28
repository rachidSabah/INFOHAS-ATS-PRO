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
import { getVisibleCharCount } from "./layout-validator";
import { extractBlueprint, type ResumeBlueprint } from "./resume-blueprint-agent";
import { extractTemplateBlueprint, type ResumeTemplateBlueprint, validateTemplatePreserved } from "./resume-template-blueprint-agent";
import { runGuardianValidation, type GuardianVerdict } from "./resume-guardian-agent";
import { createRetryEngine } from "./retry-engine";
import { createSnapshot, compareSnapshots } from "./resume-snapshot-engine";
import { globalEventBus } from "./agent-event-bus";
import { getCachedOptimization, setCachedOptimization } from "./semantic-cache";
import { recordProviderSuccess, recordProviderFailure } from "./provider-health-monitor";
import { runDynamicSectionPipeline } from "./dynamic-section-engine";
import { reportDegradedOptimization } from "./degradation";
import { selectProviderForAgent, getOrderedFallbackProviders } from "./ai";
import { useApp } from "./store";

export interface LockedPipelineResult {
  resume: ResumeData;
  provider: string;
  charCount: number;
  keywordsAdded: number;
  warnings: string[];
  errors: string[];
  guardianScore: number;
  guardianStatus: "PASS" | "REQUIRES_MANUAL_REVIEW";
  isDegraded: boolean;
  fingerprintValid: boolean;
  blueprintValid: boolean;
  rationales?: Array<{
    section: string;
    original: string;
    edited: string;
    reason: string;
  }>;
  layoutDiagnostics?: {
    totalHeightPt: number;
    overflows: boolean;
    scaleFactor: number;
    recommendation: string;
  };
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
  feedback?: string,
  baselineResume?: ResumeData, // Added for Localized Diff-Only Processing
  onChunk?: (chunk: string) => void,
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
  // CRITICAL: Deep clone the id-ready resume for the degraded fallback path.
  // During optimization, the optimizer and assembler receive shallow references and
  // may mutate fields in place. If all attempts fail, we must return the ORIGINAL
  // data — not a partially-mutated version.
  const fallbackResume: ResumeData = JSON.parse(JSON.stringify(idReadyResume));
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
      isDegraded: false,
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
      isDegraded: false,
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
      const optimizerInput = buildOptimizerInput(idReadyResume, jd, intelligenceContext, directiveConfig, optimizationPolicy, feedback);
      let optimizerResult;
      const flags = (useApp.getState() as any).flags || {};
      const primaryProvider = await selectProviderForAgent("optimizer", excludeProviderIds);
      const fallbackChain = getOrderedFallbackProviders([primaryProvider.id, ...excludeProviderIds]);

      if (flags.enableModelArena && fallbackChain.length > 0) {
        const secondaryProvider = fallbackChain[0].provider;
        const secondaryProviderId = secondaryProvider.id || secondaryProvider.name || secondaryProvider.type;
        console.info(`[Model Arena] Running Primary (${primaryProvider.id}) and Secondary (${secondaryProviderId}) in parallel...`);
        const [pRes, sRes] = await Promise.all([
          runBulletOnlyOptimizer(idReadyResume, jd, intelligenceContext, directiveConfig, excludeProviderIds, optimizationPolicy, feedback, baselineResume, onChunk).catch(e => {
            console.warn("[Model Arena] Primary failed:", e);
            return null;
          }),
          runBulletOnlyOptimizer(idReadyResume, jd, intelligenceContext, directiveConfig, [primaryProvider.id, ...excludeProviderIds], optimizationPolicy, feedback, baselineResume).catch(e => {
            console.warn("[Model Arena] Secondary failed:", e);
            return null;
          })
        ]);
        if (pRes && sRes) {
          const { scoreATS } = await import("./ats");
          // Assemble temporary resumes to check ATS scores
          const pResume = assembleResume(idReadyResume, pRes.output).resume;
          const sResume = assembleResume(idReadyResume, sRes.output).resume;
          const pScore = scoreATS(pResume, jd).scores.ats;
          const sScore = scoreATS(sResume, jd).scores.ats;
          console.info(`[Model Arena] Primary ATS score: ${pScore}/100. Secondary ATS score: ${sScore}/100.`);
          if (sScore > pScore) {
            console.info(`[Model Arena] Winner: Secondary (${sRes.provider})!`);
            optimizerResult = sRes;
          } else {
            console.info(`[Model Arena] Winner: Primary (${pRes.provider})!`);
            optimizerResult = pRes;
          }
        } else {
          optimizerResult = pRes || sRes;
        }
      } else {
        optimizerResult = await runBulletOnlyOptimizer(idReadyResume, jd, intelligenceContext, directiveConfig, excludeProviderIds, optimizationPolicy, feedback, baselineResume, onChunk);
      }

      if (!optimizerResult) {
        throw new Error("Optimizer failed to return a result.");
      }
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

      // === Fix 7: Bullet immutability — check that no bullets were dropped ===
      for (let i = 0; i < sourceResume.experience.length; i++) {
        const srcExp = sourceResume.experience[i];
        if (!srcExp.bullets || srcExp.bullets.length === 0) continue;
        // Find matching assembled experience by ID
        const assembledExp = assembleResult.resume.experience.find((e: any) => e.id === srcExp.id);
        if (!assembledExp) {
          contentViolations.push(`Experience "${srcExp.title || srcExp.id}" missing from assembled result`);
          continue;
        }
        // If bullet rewriting is enabled, we check that the count did not decrease (prevent dropping accomplishments).
        // If bullet rewriting is not enabled, we check exact matches.
        const rewriteEnabled = agentDirectives?.experience?.rewriteBulletsOnly ?? true;
        if (rewriteEnabled) {
          if ((assembledExp.bullets || []).length < srcExp.bullets.length) {
            contentViolations.push(
              `Experience "${srcExp.title}" had ${srcExp.bullets.length} bullets, but optimized has only ${(assembledExp.bullets || []).length} bullets.`
            );
          }
        } else {
          for (let b = 0; b < srcExp.bullets.length; b++) {
            const srcBulletText = srcExp.bullets[b];
            const bulletFound = (assembledExp.bullets || []).some(
              (ab: string) => ab === srcBulletText
            );
            if (!bulletFound) {
              contentViolations.push(
                `Bullet "${srcBulletText.substring(0, 50)}..." from "${srcExp.title}" was removed`
              );
            }
          }
        }
      }

      // === Fix 8: Skills/Languages structural immutability ===
      // Normalize a skill/language name by stripping a leading "Category: "
      // prefix that some AI providers leak into the `name` field (e.g.
      // "General: Active Listening" should match source "Active Listening").
      // Without this, the immutability check spuriously reports the skill as
      // "removed" and forces 3 doomed retries → degraded-optimization return.
      const normalizeName = (n: string): string =>
        n.replace(/^\s*[^:]{1,30}:\s*/, "").trim().toLowerCase();

      const srcSkills = sourceResume.skills || [];
      const assembledSkills = assembleResult.resume.skills || [];
      for (const srcSkill of srcSkills) {
        const skillName = typeof srcSkill === "string" ? srcSkill : (srcSkill as any).name;
        if (!skillName) continue;
        const srcNorm = normalizeName(skillName);
        const found = assembledSkills.some((as: any) => {
          const asName = typeof as === "string" ? as : as.name;
          if (!asName) return false;
          const asNorm = normalizeName(asName);
          return asName.toLowerCase() === skillName.toLowerCase() || asNorm === srcNorm;
        });
        if (!found) {
          contentViolations.push(`Skill "${skillName}" was removed from assembled resume`);
        }
      }

      const srcLangs = sourceResume.languages || [];
      const assembledLangs = assembleResult.resume.languages || [];
      for (const srcLang of srcLangs) {
        const langName = typeof srcLang === "string" ? srcLang : (srcLang as any).name;
        if (!langName) continue;
        const srcNorm = normalizeName(langName);
        const found = assembledLangs.some((al: any) => {
          const alName = typeof al === "string" ? al : al.name;
          if (!alName) return false;
          const alNorm = normalizeName(alName);
          return alName.toLowerCase() === langName.toLowerCase() || alNorm === srcNorm;
        });
        if (!found) {
          contentViolations.push(`Language "${langName}" was removed from assembled resume`);
        }
      }

      // === Fix 9: Header integrity — preserve headline and contact.location ===
      if (sourceResume.headline && !assembleResult.resume.headline) {
        // If the headline was intentionally cleared by the assembler because it contained
        // duplicate contact info (email, phone, or location), we don't treat it as a violation.
        const hl = sourceResume.headline.toLowerCase();
        const srcContact = sourceResume.contact || {} as any;
        let isDuplicateContact = false;
        if (srcContact.email && hl.includes(srcContact.email.toLowerCase())) {
          isDuplicateContact = true;
        }
        if (!isDuplicateContact && srcContact.phone) {
          const phoneDigits = srcContact.phone.replace(/\D/g, "");
          if (phoneDigits.length >= 5 && hl.includes(phoneDigits)) {
            isDuplicateContact = true;
          }
        }
        if (!isDuplicateContact && srcContact.location) {
          const locLower = srcContact.location.toLowerCase();
          if (hl === locLower || hl.includes(locLower)) {
            isDuplicateContact = true;
          }
        }
        if (!isDuplicateContact) {
          contentViolations.push("Headline was dropped from assembled resume");
        }
      }
      if (sourceResume.contact?.location && !assembleResult.resume.contact?.location) {
        contentViolations.push("Location was dropped from assembled resume");
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
      const guardianResult = runStructureGuardian(assembleResult.resume, sourceResume, jd.rawText);
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

      let layoutDiagnostics;
      try {
        const { simulateLayoutHeight } = await import("./layout-simulator");
        layoutDiagnostics = simulateLayoutHeight(assembleResult.resume);
      } catch (simErr) {
        console.warn("[Layout Simulator] Failed to run layout height simulation:", simErr);
      }

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
        isDegraded: false,
        rationales: optimizerResult.output.rationales,
        layoutDiagnostics,
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
        // Exceeded max attempts — let the post-loop degraded fallback run
        console.warn(`[Locked Pipeline] All ${maxAttempts} attempt(s) exhausted. Falling through to degraded return.`);
      }
    }
  }

  // After all retries exhausted, fall back to returning the source resume
  // with a degraded-optimization status instead of hard-failing.
  // This allows the user to still export their original resume while being
  // notified that AI optimization was unavailable.
  //
  // CRITICAL FIX: even in the degraded path we still run the page-balancer
  // expansion so the exported DOCX fills the page (≈98% A4). Previously the
  // degraded fallback returned the raw thin source resume (~55% fill), which
  // produced a half-empty page. We expand using only the candidate's own
  // content + JD keywords — no fabrication.
  console.warn(`[Locked Pipeline] All ${attempts} attempts failed. Returning expanded source resume with degraded-optimization status.`);
  reportDegradedOptimization("All AI providers failed or returned degraded results. Returning resume with local page-fill expansion.");
  warnings.push("AI optimization unavailable — applied local page-fill expansion to keep the resume full.");
  errors.push("All AI providers failed. Optimization unavailable (local fill applied).");

  let degradedResume = fallbackResume;
  let degradedCharCount = getVisibleCharCount(fallbackResume);
  try {
    const pageFill = validatePageFill(fallbackResume, directiveConfig);
    if (pageFill.action === "expand") {
      const jdKeywords = (jd?.keywords ?? []);
      const resumeText = JSON.stringify(fallbackResume).toLowerCase();
      const missingKeywords = jdKeywords.filter((k: string) => !resumeText.includes(k.toLowerCase()));
      degradedResume = expandResume(fallbackResume, {
        originalResume: fallbackResume,
        jd: jd ?? { title: "", company: "", description: "", responsibilities: [], keywords: [], rawText: "" },
        targetChars: pageFill.targetChars,
        currentChars: pageFill.charCount,
        missingKeywords,
        directiveConfig,
      });
      degradedCharCount = getVisibleCharCount(degradedResume);
    }
  } catch (pbErr: any) {
    console.warn("[Locked Pipeline Degraded Page Balancer] Failed (non-fatal):", pbErr?.message);
  }

  const fallbackCharCount = degradedCharCount;
  return {
    resume: degradedResume,
    provider: "degraded-optimization",
    charCount: fallbackCharCount,
    keywordsAdded: 0,
    warnings,
    errors,
    guardianScore: 0,
    guardianStatus: "REQUIRES_MANUAL_REVIEW",
    fingerprintValid: true,
    blueprintValid: true,
    templateBlueprintValid: true,
    guardianVerdict: undefined,
    retryCount: attempts,
    isDegraded: true,
    assemblerStats: {
      matchedById: 0, matchedByFingerprint: 0, matchedByTitleCompany: 0,
      matchedByIndex: 0, unmatched: 0,
    },
  };
}
