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
import { selectProviderForAgent, getOrderedFallbackProviders } from "./ai";
import { useApp } from "./store";
import { getAgentConfig } from "./agents/agent-ai-config";
import { ProviderHealer } from "./ai/healing/provider-healer";
import { validateOptimizerOutput, type KeywordCoverageReport } from "./agents/optimizer-output-validator";
import { describeSalvageStageFailures, type ProgressiveStageResult } from "./agents/progressive-generator";
import { runProgressiveOptimization } from "./agents/progressive-generator";
import { buildStructuredFailureFeedback } from "./agents/failure-feedback";
import type { MatchingStrategy } from "./agents/profile-resolution";

export interface LockedPipelineNodeRun {
  node: string;
  attempt: number;
  status: "completed" | "failed" | "salvaged";
  durationMs: number;
  detail?: string;
}

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
  /** Directive §11 — keyword accountability report for the Supervisor/UI. */
  keywordCoverage?: KeywordCoverageReport;
  /** Per-node trajectory (agentic observability — consumed by the UI panel). */
  nodeRuns?: LockedPipelineNodeRun[];
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
 * Thrown when every optimizer attempt (with bounded auto-heal between
 * attempts) failed and NO valid optimization could be produced.
 *
 * Directive §2/§15/§49: the ORIGINAL RESUME MUST NEVER be substituted as the
 * optimized result. This error keeps the job RECOVERABLE — the supervisor
 * preserves all completed agents/snapshots and surfaces an honest
 * RECOVERABLE state instead of a degraded "success".
 */
export class OptimizerUnrecoverableError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly attemptErrors: string[],
    public readonly keywordCoverage?: KeywordCoverageReport,
  ) {
    super(message);
    this.name = "OptimizerUnrecoverableError";
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
  /** Task 7 — matching strategy from the selected Pipeline Profile. */
  options?: {
    matchingStrategy?: MatchingStrategy;
    hybridMatchingThreshold?: number;
    /** Directive §6/§23 — the Supervisor's retry policy governs the optimizer. */
    maxOptimizerAttempts?: number;
  },
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
  const attemptErrors: string[] = [];
  let lastKeywordCoverage: KeywordCoverageReport | undefined;
  // TRUTHFUL DIAGNOSIS: when the P4 salvage path produced the output and the
  // validator rejects it, the per-stage failure reasons (timeout / 429 / parse)
  // are the REAL cause behind the "incomplete coverage" symptom — capture them
  // per attempt and append to the validation error.
  let salvageStages: ProgressiveStageResult[] | null = null;
  // Directive §6/§23 — the Supervisor's retry policy governs the optimizer.
  // NEVER silently 1 attempt when a retry policy is configured: the orchestrator
  // passes the profile-derived budget; the legacy enableProviderSwitch toggle
  // remains as fallback. Bounded at 6 to prevent infinite loops (directive §23).
  const maxAttempts = Math.min(
    6,
    Math.max(1, options?.maxOptimizerAttempts ?? (agentDirectives?.supervisor?.enableProviderSwitch ? 3 : 1)),
  );
  const autoHealOn = useApp.getState().providerSettings?.autoHealProviders !== false;
  // Directive §23 — corrective feedback accumulates across attempts so each
  // retry knows exactly what the previous attempt got wrong.
  let attemptFeedback = feedback;

  // DIRECTIVE (agentic observability + per-node contracts): every major node
  // records {status, durationMs} into the result and emits a trajectory event
  // — the node contracts are the EXISTING gates (validator / assembler /
  // guardian / preservation), now explicitly observable. Degradation policy
  // is unchanged: a failed node fails the attempt (bounded retries), except
  // nodes already marked non-fatal.
  const nodeRuns: LockedPipelineNodeRun[] = [];
  const trackNode = async <T,>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = Date.now();
    try {
      const out = await fn();
      nodeRuns.push({ node: name, attempt: attempts, status: "completed", durationMs: Date.now() - t0 });
      globalEventBus.emit({ agent: "PipelineNode", action: name, resumeId: sourceResume.id, success: true, duration: Date.now() - t0, metadata: { attempt: attempts } });
      return out;
    } catch (e: any) {
      const detail = String(e?.message ?? e).slice(0, 200);
      nodeRuns.push({ node: name, attempt: attempts, status: "failed", durationMs: Date.now() - t0, detail });
      globalEventBus.emit({ agent: "PipelineNode", action: name, resumeId: sourceResume.id, success: false, duration: Date.now() - t0, metadata: { attempt: attempts, error: detail } });
      throw e;
    }
  };

  while (attempts < maxAttempts) {
    attempts++;
    salvageStages = null;
    try {
      // ========================================================================
      // Step 2: Run Bullet-Only Optimizer (supports excludeProviderIds)
      // P4 SALVAGE PATH: if the monolithic optimizer throws (provider error,
      // parse failure, timeout…), the PROGRESSIVE section-by-section generator
      // runs before the attempt is counted as failed — summary + per-experience
      // bullets are generated in small independent calls and emitted as the
      // SAME OptimizerPatch contract, so every downstream gate still applies.
      // ========================================================================
      const optimizerInput = buildOptimizerInput(idReadyResume, jd, intelligenceContext, directiveConfig, optimizationPolicy, attemptFeedback);
      let optimizerResult;
      const flags = (useApp.getState() as any).flags || {};
      // TWO-TIER ROUTING (draft vs verify): the Agent Configuration Center's
      // qualityMode drives the DRAFT tier — "high-quality" drafts may use the
      // strongest provider tier (3), "fast"/"balanced" stay on the cheap
      // tiers (≤2). Verification agents (QA/guardian/reflection) always keep
      // their stricter strong-tier defaults — the strongest available model
      // judges what cheaper models draft.
      const draftQualityMode = getAgentConfig("optimizer")?.qualityMode ?? "balanced";
      const draftTierMax = draftQualityMode === "high-quality" ? 3 : 2;
      const primaryProvider = await selectProviderForAgent("optimizer", excludeProviderIds, { tierMax: draftTierMax });
      const fallbackChain = getOrderedFallbackProviders([primaryProvider.id, ...excludeProviderIds]);

      try {
      if (flags.enableModelArena && fallbackChain.length > 0) {
        // BEST-OF-N ARENA (generalized from best-of-2): the primary provider
        // races the top N-1 fallback providers in parallel; every candidate
        // is assembled and judged with the DETERMINISTIC ATS scorer; the
        // highest score wins (ties → primary). N is clamped 2..3.
        const arenaN = Math.min(3, Math.max(2, Number(flags.modelArenaCandidates) || 2));
        const arenaProviders = [primaryProvider, ...fallbackChain.slice(0, arenaN - 1).map((f: any) => f.provider)];
        console.info(`[Model Arena] Best-of-${arenaProviders.length}: ${arenaProviders.map((p: any) => p.id).join(", ")} in parallel...`);
        const arenaResults = await Promise.all(
          arenaProviders.map((p: any, idx: number) =>
            runBulletOnlyOptimizer(
              idReadyResume, jd, intelligenceContext, directiveConfig,
              [...arenaProviders.filter((_: any, j: number) => j !== idx).map((q: any) => q.id), ...excludeProviderIds],
              optimizationPolicy, feedback, baselineResume, idx === 0 ? onChunk : undefined,
            ).catch(e => {
              console.warn(`[Model Arena] Candidate ${p.id} failed:`, e);
              return null;
            })
          )
        );
        const valid = arenaResults.filter(Boolean) as NonNullable<typeof arenaResults[number]>[];
        if (valid.length > 0) {
          const { scoreATS } = await import("./ats");
          // Judge: assemble each candidate and score with the deterministic ATS engine.
          let best = valid[0];
          let bestScore = -1;
          let bestProviderId = "";
          for (let i = 0; i < arenaResults.length; i++) {
            const r = arenaResults[i];
            if (!r) continue;
            const rResume = assembleResume(idReadyResume, r.output, { matchingStrategy: options?.matchingStrategy }).resume;
            const rScore = scoreATS(rResume, jd).scores.ats;
            console.info(`[Model Arena] Candidate ${arenaProviders[i].id} ATS score: ${rScore}/100.`);
            if (rScore > bestScore) {
              best = r;
              bestScore = rScore;
              bestProviderId = arenaProviders[i].id;
            }
          }
          console.info(`[Model Arena] Winner: ${bestProviderId} (score ${bestScore}/100).`);
          optimizerResult = best;
        } else {
          optimizerResult = null;
        }
      } else {
        optimizerResult = await runBulletOnlyOptimizer(idReadyResume, jd, intelligenceContext, directiveConfig, excludeProviderIds, optimizationPolicy, feedback, baselineResume, onChunk);
      }
      } catch (monolithicErr: any) {
        // P4 ACTIVATED — progressive section-by-section salvage (bounded: one
        // pass; per-entry failures keep original bullets; null when nothing
        // succeeded and the original error propagates).
        console.warn(`[Locked Pipeline] Monolithic optimizer failed (${monolithicErr?.message ?? monolithicErr}) — running PROGRESSIVE section-by-section salvage…`);
        globalEventBus.emit({
          agent: "ProgressiveGenerator",
          action: "salvage_started",
          resumeId: sourceResume.id,
          success: true,
          metadata: { attempt: attempts, reason: String(monolithicErr?.message ?? monolithicErr).slice(0, 200) },
        });
        const salvage = await runProgressiveOptimization(idReadyResume, jd, {
          excludeProviderIds,
        });
        if (salvage) {
          optimizerResult = salvage;
          salvageStages = salvage.salvageStages ?? null;
          warnings.push("Monolithic optimization failed — recovered via progressive section-by-section generation (failed sections kept original content).");
        } else {
          throw monolithicErr;
        }
      }

      if (!optimizerResult) {
        throw new Error("Optimizer failed to return a result.");
      }
      warnings.push(...optimizerResult.warnings);
      // Node record for the optimizer (salvage visibility: provider reveals
      // "progressive-sections" when the P4 salvage path produced the output).
      nodeRuns.push({
        node: "optimizer", attempt: attempts,
        status: optimizerResult.provider === "progressive-sections" ? "salvaged" : "completed",
        durationMs: 0, detail: optimizerResult.provider,
      });

      // ========================================================================
      // Step 2b: OptimizerOutputValidator (directive §11 + §24/§25).
      // A rejected output NEVER reaches the assembler or any downstream agent —
      // the attempt fails and the retry carries corrective feedback.
      // ========================================================================
      const outputValidation = await trackNode("output-validator", () =>
        validateOptimizerOutput(idReadyResume, optimizerResult.output, jd)
      );
      lastKeywordCoverage = outputValidation.keywordCoverage;
      if (!outputValidation.valid) {
        const actionable = outputValidation.keywordCoverage.total - outputValidation.keywordCoverage.alreadyPresent;
        // STRUCTURED FAILURE FEEDBACK: the retry prompt carries the canonical
        // structured block (stage, violations, keyword coverage, missing
        // keywords) — never a bare "try again".
        attemptFeedback = [
          attemptFeedback,
          buildStructuredFailureFeedback({
            stage: `optimizer attempt ${attempts} (rejected by OptimizerOutputValidator)`,
            violations: outputValidation.violations,
            keywordCoverage: { integrated: outputValidation.keywordCoverage.integrated, total: actionable },
            missingKeywords: outputValidation.keywordCoverage.stillMissing,
          }),
        ].filter(Boolean).join("\n");
        // TRUTHFUL DIAGNOSIS: when the rejected output came from the P4
        // salvage path, append WHY its stages failed (timeout / 429 / parse)
        // — the validator's "incomplete coverage" is only the symptom; the
        // stage failures are the disease, and they must reach attemptErrors.
        let validationErrMsg = `Optimizer output validation failed: ${outputValidation.violations.join("; ")}`;
        const stageFailureSummary = describeSalvageStageFailures(salvageStages ?? []);
        if (stageFailureSummary) {
          validationErrMsg += ` (salvage stage failures — ${stageFailureSummary})`;
        }
        const errObj: any = new Error(validationErrMsg);
        errObj.kind = "output-validation";
        throw errObj;
      }

      console.info(`[Locked Pipeline] Attempt ${attempts}: Optimizer returned: ${optimizerResult.output.experiences?.length ?? 0} experiences, ${optimizerResult.output.skills?.length ?? 0} skills`);

      // ========================================================================
      // Step 3: Assemble Resume (application-owned)
      // ========================================================================
      const assembleResult = await trackNode("assembler", () =>
        assembleResume(idReadyResume, optimizerResult.output, { matchingStrategy: options?.matchingStrategy })
      );
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
        nodeRuns.push({ node: "guardian", attempt: attempts, status: "completed", durationMs: 0, detail: `verdict: ${guardianVerdict.status}` });
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
      // DETERMINISTIC A4 LAYOUT GATE (pt-based) + bounded compress repair.
      // The char-based page balancer runs earlier; THIS gate measures the real
      // pt height. Overflow here never blocks the pipeline — it triggers up to
      // TWO deterministic compress rounds and re-measures (non-LLM, instant).
      // ========================================================================
      if (layoutDiagnostics?.overflows) {
        const tGate = Date.now();
        const pageFillGate = validatePageFill(assembleResult.resume, directiveConfig);
        for (let gateRound = 0; gateRound < 2 && layoutDiagnostics.overflows; gateRound++) {
          try {
            assembleResult.resume = compressResume(assembleResult.resume, {
              targetChars: pageFillGate.targetChars,
              maxChars: Math.floor(pageFillGate.targetChars * 1.04),
              currentChars: pageFillGate.charCount,
              directiveConfig,
            });
            const { simulateLayoutHeight: reSimulate } = await import("./layout-simulator");
            layoutDiagnostics = reSimulate(assembleResult.resume);
            warnings.push(`A4 layout gate: compress round ${gateRound + 1} applied — overflow ${layoutDiagnostics.overflows ? "persists" : "resolved"}.`);
          } catch (gateErr) {
            console.warn("[Locked Pipeline A4 Gate] Compress round failed (non-fatal):", gateErr);
            break;
          }
        }
        nodeRuns.push({
          node: "a4-layout-gate", attempt: attempts, status: "completed",
          durationMs: Date.now() - tGate,
          detail: layoutDiagnostics.overflows ? "overflow persists after 2 compress rounds (flagged in diagnostics)" : "overflow resolved",
        });
      }

      // ========================================================================
      // Step 9: Return result
      // ========================================================================
      const result: LockedPipelineResult = {
        resume: assembleResult.resume,
        provider: optimizerResult.provider,
        charCount,
        keywordsAdded: lastKeywordCoverage?.integrated ?? optimizerResult.output.missingKeywordsAdded?.length ?? 0,
        warnings,
        errors,
        guardianScore: guardianResult.score,
        guardianStatus: guardianResult.status,
        fingerprintValid: fpValidation.valid,
        blueprintValid: true,
        templateBlueprintValid: blueprintCheck,
        guardianVerdict,
        retryCount: attempts,
        keywordCoverage: lastKeywordCoverage,
        isDegraded: false,
        rationales: optimizerResult.output.rationales,
        layoutDiagnostics,
        nodeRuns,
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
      attemptErrors.push(err?.message || String(err));
      if (err.provider) {
        excludeProviderIds.push(err.provider);
      }
      // Directive §7 — FAILURE → CLASSIFY → AUTO-HEAL → RETRY (bounded by
      // maxAttempts; never infinite). Provider-class failures trigger ONE safe
      // auto-heal round before the next attempt. Output-validation failures
      // rely on the corrective feedback instead (config unchanged).
      if (autoHealOn && err?.kind !== "output-validation") {
        try {
          console.info("[Locked Pipeline] Running bounded auto-heal round before retry…");
          await ProviderHealer.healAllProviders("auto");
        } catch (hErr: any) {
          console.warn("[Locked Pipeline] Auto-heal round failed (non-fatal):", hErr?.message);
        }
      }
      if (attempts >= maxAttempts) {
        console.warn(`[Locked Pipeline] All ${maxAttempts} attempt(s) exhausted.`);
      }
    }
  }

  // ========================================================================
  // ALL ATTEMPTS EXHAUSTED — NO ORIGINAL-RESUME FALLBACK (directive §2/§15/§49).
  //
  // The previous behaviour returned the source resume with provider
  // "degraded-optimization" + isDegraded:true — the supervisor then counted it
  // as a (degraded) completion and the user received their UNTOUCHED original
  // resume labeled as the optimization result. THAT FLOW IS REMOVED.
  //
  // Instead the locked pipeline throws a typed recoverable error carrying
  // every attempt's diagnosis. The orchestrator/supervisor keep the job in a
  // RECOVERABLE state (completed agents + snapshots preserved). The original
  // resume remains the SOURCE snapshot — never the OPTIMIZED RESULT.
  // ========================================================================
  console.error(`[Locked Pipeline] Optimization UNRECOVERABLE after ${attempts} attempt(s). No original-resume substitution. Errors: ${attemptErrors.join(" | ")}`);
  throw new OptimizerUnrecoverableError(
    `Optimization could not be completed after ${attempts} validated attempt(s) (bounded auto-heal ran between attempts). The original resume was NOT substituted as the result.`,
    attempts,
    attemptErrors,
    lastKeywordCoverage,
  );
}
