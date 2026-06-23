// ResumeAI Pro — Optimization Quality Gates
// Validates that optimization results meet all quality criteria:
// - Response length >= 2200 chars
// - Not identical to original resume
// - Contains experience, education, skills
// - Character count >= 2400
// - Page count === 1
// - Factual consistency > 80%
// - No hallucinations
//
// Pure functions — safe for Edge Runtime.

import type { OptimizationQualityGate, QATestResult } from "./types";
import { QUALITY_THRESHOLDS } from "./types";

/**
 * Run all quality gates on an optimization result.
 * Returns per-gate pass/fail and overall result.
 */
export function runQualityGates(opts: {
  optimizedCharCount: number;
  originalCharCount?: number;
  hasExperience: boolean;
  hasEducation: boolean;
  hasSkills: boolean;
  sectionsCount: number;
  originalSectionsCount?: number;
  pageCount: number;
  factualConsistencyPercent: number;
  isIdenticalToOriginal: boolean;
  keywordEmbeddings: number;
  pageUsagePercent: number;
  providerSucceeded: boolean;
  optimizationDurationMs: number;
  providerName: string;
}): { passed: boolean; gates: OptimizationQualityGate[] } {
  const gates: OptimizationQualityGate[] = [];

  // Gate 1: Provider succeeded (not offline/fallback)
  gates.push({
    name: "providerSucceeded",
    passed: opts.providerSucceeded,
    value: opts.providerName,
    message: opts.providerSucceeded
      ? `Provider: ${opts.providerName}`
      : `Provider failed or used offline fallback: ${opts.providerName}`,
  });

  // Gate 2: Response length >= 2200
  gates.push({
    name: "responseLength",
    passed: opts.optimizedCharCount >= QUALITY_THRESHOLDS.MIN_RESPONSE_LENGTH,
    value: opts.optimizedCharCount,
    threshold: QUALITY_THRESHOLDS.MIN_RESPONSE_LENGTH,
    message: opts.optimizedCharCount >= QUALITY_THRESHOLDS.MIN_RESPONSE_LENGTH
      ? `Response length: ${opts.optimizedCharCount} chars (>= ${QUALITY_THRESHOLDS.MIN_RESPONSE_LENGTH})`
      : `Response too short: ${opts.optimizedCharCount} chars (min ${QUALITY_THRESHOLDS.MIN_RESPONSE_LENGTH})`,
  });

  // Gate 3: Not identical to original
  gates.push({
    name: "notIdenticalToOriginal",
    passed: !opts.isIdenticalToOriginal,
    value: opts.isIdenticalToOriginal,
    message: opts.isIdenticalToOriginal
      ? "Optimized resume is IDENTICAL to original — no changes made"
      : "Optimized resume differs from original",
  });

  // Gate 4: Has experience
  gates.push({
    name: "hasExperience",
    passed: opts.hasExperience,
    value: opts.hasExperience,
    message: opts.hasExperience ? "Experience section present" : "Missing experience section",
  });

  // Gate 5: Has education
  gates.push({
    name: "hasEducation",
    passed: opts.hasEducation,
    value: opts.hasEducation,
    message: opts.hasEducation ? "Education section present" : "Missing education section",
  });

  // Gate 6: Has skills
  gates.push({
    name: "hasSkills",
    passed: opts.hasSkills,
    value: opts.hasSkills,
    message: opts.hasSkills ? "Skills section present" : "Missing skills section",
  });

  // Gate 7: Character count >= 2400
  gates.push({
    name: "characterCount",
    passed: opts.optimizedCharCount >= QUALITY_THRESHOLDS.MIN_CHARACTER_COUNT,
    value: opts.optimizedCharCount,
    threshold: QUALITY_THRESHOLDS.MIN_CHARACTER_COUNT,
    message: opts.optimizedCharCount >= QUALITY_THRESHOLDS.MIN_CHARACTER_COUNT
      ? `Character count: ${opts.optimizedCharCount} (>= ${QUALITY_THRESHOLDS.MIN_CHARACTER_COUNT})`
      : `Character count too low: ${opts.optimizedCharCount} (min ${QUALITY_THRESHOLDS.MIN_CHARACTER_COUNT})`,
  });

  // Gate 8: Sections >= original
  gates.push({
    name: "sectionsNotReduced",
    passed: !opts.originalSectionsCount || opts.sectionsCount >= opts.originalSectionsCount,
    value: opts.sectionsCount,
    threshold: opts.originalSectionsCount,
    message: opts.originalSectionsCount && opts.sectionsCount < opts.originalSectionsCount
      ? `Sections reduced: ${opts.sectionsCount} < ${opts.originalSectionsCount}`
      : `Sections OK: ${opts.sectionsCount}`,
  });

  // Gate 9: Page count === 1
  gates.push({
    name: "singlePage",
    passed: opts.pageCount === 1,
    value: opts.pageCount,
    threshold: 1,
    message: opts.pageCount === 1
      ? "Resume fits on one page"
      : `Resume spans ${opts.pageCount} pages (expected 1)`,
  });

  // Gate 10: Factual consistency > 80%
  gates.push({
    name: "factualConsistency",
    passed: opts.factualConsistencyPercent >= QUALITY_THRESHOLDS.MIN_FACTUAL_CONSISTENCY,
    value: opts.factualConsistencyPercent,
    threshold: QUALITY_THRESHOLDS.MIN_FACTUAL_CONSISTENCY,
    message: opts.factualConsistencyPercent >= QUALITY_THRESHOLDS.MIN_FACTUAL_CONSISTENCY
      ? `Factual consistency: ${opts.factualConsistencyPercent}% (>= ${QUALITY_THRESHOLDS.MIN_FACTUAL_CONSISTENCY}%)`
      : `Factual consistency too low: ${opts.factualConsistencyPercent}% (min ${QUALITY_THRESHOLDS.MIN_FACTUAL_CONSISTENCY}%)`,
  });

  // Gate 11: Keyword embeddings > 0
  gates.push({
    name: "keywordEmbeddings",
    passed: opts.keywordEmbeddings > 0,
    value: opts.keywordEmbeddings,
    threshold: 0,
    message: opts.keywordEmbeddings > 0
      ? `Keyword embeddings: ${opts.keywordEmbeddings}`
      : "No keyword embeddings — optimization may not be ATS-friendly",
  });

  // Gate 12: Page usage >= 85%
  gates.push({
    name: "pageUsage",
    passed: opts.pageUsagePercent >= QUALITY_THRESHOLDS.MIN_PAGE_USAGE_PERCENT,
    value: opts.pageUsagePercent,
    threshold: QUALITY_THRESHOLDS.MIN_PAGE_USAGE_PERCENT,
    message: opts.pageUsagePercent >= QUALITY_THRESHOLDS.MIN_PAGE_USAGE_PERCENT
      ? `Page usage: ${opts.pageUsagePercent}% (>= ${QUALITY_THRESHOLDS.MIN_PAGE_USAGE_PERCENT}%)`
      : `Page usage too low: ${opts.pageUsagePercent}% (min ${QUALITY_THRESHOLDS.MIN_PAGE_USAGE_PERCENT}%)`,
  });

  // Gate 13: Optimization duration >= 1 second (if not from cache)
  const isCacheProvider = /cache|local|offline/i.test(opts.providerName);
  gates.push({
    name: "optimizationDuration",
    passed: isCacheProvider || opts.optimizationDurationMs >= QUALITY_THRESHOLDS.MIN_OPTIMIZATION_DURATION_MS,
    value: opts.optimizationDurationMs,
    threshold: QUALITY_THRESHOLDS.MIN_OPTIMIZATION_DURATION_MS,
    message: !isCacheProvider && opts.optimizationDurationMs < QUALITY_THRESHOLDS.MIN_OPTIMIZATION_DURATION_MS
      ? `Optimization too fast: ${opts.optimizationDurationMs}ms (< ${QUALITY_THRESHOLDS.MIN_OPTIMIZATION_DURATION_MS}ms) — possible fake`
      : `Duration OK: ${opts.optimizationDurationMs}ms`,
  });

  return {
    passed: gates.every((g) => g.passed),
    gates,
  };
}

/**
 * Generate QA test results from quality gates.
 */
export function qualityGatesToQATests(
  gateResult: ReturnType<typeof runQualityGates>
): QATestResult[] {
  const tests: QATestResult[] = [];
  const timestamp = new Date().toISOString();

  // Overall quality gate
  tests.push({
    id: `quality_overall_${Date.now()}`,
    name: "Quality: All Gates Passed",
    category: "pipeline",
    severity: "critical",
    passed: gateResult.passed,
    message: gateResult.passed
      ? `All ${gateResult.gates.length} quality gates passed`
      : `${gateResult.gates.filter((g) => !g.passed).length}/${gateResult.gates.length} quality gates FAILED`,
    durationMs: 0,
    timestamp,
  });

  // Individual gates
  for (const gate of gateResult.gates) {
    if (!gate.passed) {
      tests.push({
        id: `quality_${gate.name}_${Date.now()}`,
        name: `Quality Gate: ${gate.name}`,
        category: "pipeline",
        severity: gate.name === "providerSucceeded" || gate.name === "notIdenticalToOriginal" ? "critical" : "high",
        passed: false,
        message: gate.message,
        durationMs: 0,
        timestamp,
        suggestion: getGateSuggestion(gate.name),
      });
    }
  }

  return tests;
}

function getGateSuggestion(gateName: string): string {
  const suggestions: Record<string, string> = {
    providerSucceeded: "Check provider configuration and API key. Ensure at least one provider is active.",
    responseLength: "The AI response was too short. This may indicate a truncated or failed generation. Retry with a different provider.",
    notIdenticalToOriginal: "The optimizer returned the original resume unchanged. Verify the AI is processing the optimization directive.",
    hasExperience: "The optimized resume lost its experience section. This is a critical data loss issue.",
    hasEducation: "The optimized resume lost its education section.",
    hasSkills: "The optimized resume lost its skills section.",
    characterCount: "Optimized resume is too short. The AI may not have expanded enough.",
    sectionsNotReduced: "Optimized resume has fewer sections than the original — data may have been lost.",
    singlePage: "Resume exceeds one page. Page balancer should have compressed content.",
    factualConsistency: "Optimized resume may contain hallucinations. Reduce AI creativity (temperature) or use a better model.",
    keywordEmbeddings: "No keywords matched from the job description. The optimizer may not have incorporated JD keywords.",
    pageUsage: "Resume page usage is below 85%. The page balancer should have expanded content.",
    optimizationDuration: "Optimization completed too fast — may be a cached or fake result. Verify provider response.",
  };
  return suggestions[gateName] || "Review the quality gate failure and fix the root cause.";
}
