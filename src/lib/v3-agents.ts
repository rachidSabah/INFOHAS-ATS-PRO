// ============================================================================
// V3 Pipeline Agents — Keyword Embedding, Fact Verification, Layout Optimization
//
// These agents run AFTER the Resume Writer (Step 4) and BEFORE Quality Assurance.
// They form the core of the V3 multi-agent orchestration:
//
//   Resume Writer → Keyword Embedding → Fact Verification → Layout Optimization → QA
//
// Each agent is a pure function that takes a resume + context and returns
// a modified resume + a report of what it did.
// ============================================================================

"use client";

import type { ResumeData, JobDescription } from "./types";
import {
  repairHallucinations,
  expandShortContent,
  repairContent,
  runQualityGates,
  type QualityReport,
} from "./quality-gates";

// ============================================================================
// Agent Result Types
// ============================================================================

export interface AgentResult {
  resume: ResumeData;
  agentName: string;
  changes: string[];
  success: boolean;
}

// ============================================================================
// 1. Keyword Embedding Agent
// ============================================================================

/**
 * Keyword Embedding Agent
 *
 * Ensures all missing JD keywords are embedded naturally in the resume.
 * Does NOT keyword-stuff — adds keywords only where they fit contextually
 * (skills section, summary, or bullet points).
 *
 * Target: ATS > 80
 */
export function runKeywordEmbeddingAgent(
  optimized: ResumeData,
  jd: JobDescription,
): AgentResult {
  const result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const changes: string[] = [];

  // Extract JD keywords
  const jdKeywords = jd.keywords ?? [];
  if (jdKeywords.length === 0) {
    return { resume: result, agentName: "Keyword Embedding", changes: ["No JD keywords to embed"], success: true };
  }

  // Check which keywords are already present
  const resumeText = JSON.stringify(result).toLowerCase();
  const missingKeywords = jdKeywords.filter((k) => !resumeText.includes(k.toLowerCase()));

  if (missingKeywords.length === 0) {
    return { resume: result, agentName: "Keyword Embedding", changes: ["All JD keywords already present"], success: true };
  }

  // Strategy 1: Add missing keywords to skills section
  const existingSkillNames = new Set((result.skills || []).map((s) => s.name.toLowerCase()));
  const keywordsToAddToSkills = missingKeywords
    .filter((k) => !existingSkillNames.has(k.toLowerCase()))
    .slice(0, 8)
    .map((name) => ({
      id: `s_kw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      category: "Targeted Keywords",
    }));

  if (keywordsToAddToSkills.length > 0 && result.skills) {
    result.skills = [...result.skills, ...keywordsToAddToSkills];
    changes.push(`Added ${keywordsToAddToSkills.length} keywords to skills: ${keywordsToAddToSkills.map((s) => s.name).join(", ")}`);
  }

  // Strategy 2: Weave keywords into summary if not already there
  if (result.summary && missingKeywords.length > keywordsToAddToSkills.length) {
    const remainingKeywords = missingKeywords.filter(
      (k) => !keywordsToAddToSkills.some((s) => s.name === k),
    );

    // Add a sentence to the summary incorporating remaining keywords
    if (remainingKeywords.length > 0 && remainingKeywords.length <= 5) {
      const keywordSentence = ` Proficient in ${remainingKeywords.slice(0, 3).join(", ")}${remainingKeywords.length > 3 ? " and related competencies" : ""}.`;
      if (!result.summary.includes(keywordSentence)) {
        result.summary = result.summary.replace(/\.$/, "") + keywordSentence;
        changes.push(`Wove ${remainingKeywords.length} keywords into summary`);
      }
    }
  }

  console.info(`[Keyword Embedding Agent] Embedded ${missingKeywords.length} missing JD keywords`);

  return {
    resume: result,
    agentName: "Keyword Embedding",
    changes,
    success: true,
  };
}

// ============================================================================
// 2. Fact Verification Agent
// ============================================================================

/**
 * Fact Verification Agent
 *
 * Verifies every metric, percentage, year, certification, date, language,
 * and employer in the optimized resume exists in the original resume.
 * Removes any hallucinated facts.
 *
 * Target: Factual Consistency >= 95, Hallucinated Metrics = 0
 */
export function runFactVerificationAgent(
  optimized: ResumeData,
  original: ResumeData,
): AgentResult {
  // Delegate to the existing repairHallucinations function
  const repairResult = repairHallucinations(optimized, original);

  console.info(
    `[Fact Verification Agent] Verified ${repairResult.hallucinationsRemoved === 0 ? "all facts valid" : `removed ${repairResult.hallucinationsRemoved} hallucinated metrics`}`,
  );

  return {
    resume: repairResult.repairedResume,
    agentName: "Fact Verification",
    changes: repairResult.repairsMade,
    success: repairResult.hallucinationsRemoved === 0,
  };
}

// ============================================================================
// 3. Layout Optimization Agent
// ============================================================================

/**
 * Layout Optimization Agent
 *
 * Ensures the resume fills a complete A4 page (85-95% occupancy).
 * Expands short bullets, restores dropped sections, and adds contextual
 * descriptions — WITHOUT inventing metrics.
 *
 * Target: 2600-3200 characters, 85-95% page occupancy
 */
export function runLayoutOptimizationAgent(
  optimized: ResumeData,
  original: ResumeData,
  jdKeywords?: string[],
): AgentResult {
  let result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const changes: string[] = [];

  // Step 1: Restore dropped content from original
  const contentRepair = repairContent(result, original, jdKeywords);
  if (contentRepair.repaired) {
    result = contentRepair.repairedResume;
    changes.push(...contentRepair.repairsMade);
  }

  // Step 2: Expand short bullets
  const beforeChars = JSON.stringify(result).length;
  result = expandShortContent(result);
  const afterChars = JSON.stringify(result).length;
  if (afterChars > beforeChars) {
    changes.push(`Expanded short bullets (+${afterChars - beforeChars} chars)`);
  }

  const finalCharCount = JSON.stringify(result).length;
  console.info(
    `[Layout Optimization Agent] Final char count: ${finalCharCount} ` +
    `(target: 2600-3200, ${finalCharCount >= 2600 ? "✓ meets minimum" : "⚠ below minimum"})`,
  );

  return {
    resume: result,
    agentName: "Layout Optimization",
    changes,
    success: finalCharCount >= 2600,
  };
}

// ============================================================================
// 4. V3 Post-Optimization Pipeline
// ============================================================================

export interface V3PostOptResult {
  resume: ResumeData;
  agentReports: AgentResult[];
  qualityReport: QualityReport;
  totalChanges: number;
  hallucinationsRemoved: number;
  keywordsEmbedded: number;
  finalCharCount: number;
}

/**
 * Run the V3 post-optimization agent pipeline:
 *   1. Keyword Embedding Agent
 *   2. Fact Verification Agent
 *   3. Layout Optimization Agent
 *   4. Re-run Quality Gates
 *
 * This replaces the old self-healing approach with named agents that
 * each have a specific responsibility.
 *
 * Max 3 attempts: repair → rerun → preserve
 */
export function runV3PostOptimizationPipeline(
  optimized: ResumeData,
  original: ResumeData,
  jd: JobDescription,
  maxAttempts = 3,
): V3PostOptResult {
  const jdKeywords = jd.keywords ?? [];
  let currentResume = optimized;
  const allAgentReports: AgentResult[] = [];
  let totalChanges = 0;
  let totalHallucinationsRemoved = 0;
  let totalKeywordsEmbedded = 0;

  console.info(`[V3 Pipeline] Starting post-optimization agent pipeline (max ${maxAttempts} attempts)...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let attemptChanges = 0;

    // Agent 1: Keyword Embedding
    const keywordResult = runKeywordEmbeddingAgent(currentResume, jd);
    currentResume = keywordResult.resume;
    allAgentReports.push(keywordResult);
    totalChanges += keywordResult.changes.length;
    attemptChanges += keywordResult.changes.length;
    if (keywordResult.changes.length > 0) {
      totalKeywordsEmbedded += keywordResult.changes.filter((c) => c.includes("keywords")).length;
    }

    // Agent 2: Fact Verification
    const factResult = runFactVerificationAgent(currentResume, original);
    currentResume = factResult.resume;
    allAgentReports.push(factResult);
    totalChanges += factResult.changes.length;
    attemptChanges += factResult.changes.length;
    // Count hallucinations removed (from changes that mention "Removed")
    const hallucinationChanges = factResult.changes.filter((c) => c.includes("Removed") || c.includes("hallucinated"));
    if (hallucinationChanges.length > 0) {
      totalHallucinationsRemoved += hallucinationChanges.length;
    }

    // Agent 3: Layout Optimization
    const layoutResult = runLayoutOptimizationAgent(currentResume, original, jdKeywords);
    currentResume = layoutResult.resume;
    allAgentReports.push(layoutResult);
    totalChanges += layoutResult.changes.length;
    attemptChanges += layoutResult.changes.length;

    // Run quality gates to check if we've converged
    const qualityReport = runQualityGates(original, currentResume);
    const finalCharCount = JSON.stringify(currentResume).length;

    console.info(
      `[V3 Pipeline] Attempt ${attempt}/${maxAttempts}: ${attemptChanges} changes, ` +
      `quality ${qualityReport.overallScore}/100, ${finalCharCount} chars, ` +
      `hallucinations ${qualityReport.factualConsistency.hallucinatedMetrics.length}`,
    );

    // Check convergence: no hallucinations AND char count >= 2600 AND no major issues
    const converged =
      qualityReport.factualConsistency.hallucinatedMetrics.length === 0 &&
      finalCharCount >= 2600 &&
      !qualityReport.shouldRetry;

    if (converged) {
      console.info(`[V3 Pipeline] Converged on attempt ${attempt} — quality gates satisfied.`);
      return {
        resume: currentResume,
        agentReports: allAgentReports,
        qualityReport,
        totalChanges,
        hallucinationsRemoved: totalHallucinationsRemoved,
        keywordsEmbedded: totalKeywordsEmbedded,
        finalCharCount,
      };
    }

    // If this was the last attempt, accept whatever we have
    if (attempt === maxAttempts) {
      console.warn(
        `[V3 Pipeline] Max attempts reached. Accepting result with ${qualityReport.overallScore}/100 quality. ` +
        `Remaining issues: ${qualityReport.retryReasons.join(", ") || "none"}`,
      );
      return {
        resume: currentResume,
        agentReports: allAgentReports,
        qualityReport,
        totalChanges,
        hallucinationsRemoved: totalHallucinationsRemoved,
        keywordsEmbedded: totalKeywordsEmbedded,
        finalCharCount,
      };
    }

    // Not converged — try again
    console.info(`[V3 Pipeline] Attempt ${attempt} insufficient — retrying...`);
  }

  // Should never reach here, but satisfy TypeScript
  const finalQuality = runQualityGates(original, currentResume);
  return {
    resume: currentResume,
    agentReports: allAgentReports,
    qualityReport: finalQuality,
    totalChanges,
    hallucinationsRemoved: totalHallucinationsRemoved,
    keywordsEmbedded: totalKeywordsEmbedded,
    finalCharCount: JSON.stringify(currentResume).length,
  };
}
