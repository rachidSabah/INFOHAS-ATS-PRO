// ============================================================================
// Pipeline Orchestration Modules
//
// Additive modules for the enhanced Supervisor Agent:
//   - ConfidenceScoring: structured execution metadata
//   - HybridMatching: strict → hybrid → fuzzy matching
//   - QualityGates: weighted validation
//   - TargetedRegeneration: section-level retry
//
// All modules are additive — they don't replace any existing logic.
// ============================================================================

"use client";

import type {
  ConfidenceResult,
  ConfidenceFactor,
  MatchingResult,
  MatchingAttempt,
  QualityGate,
  QualityGateResult,
  QualityGateEvaluation,
  RegenerationRequest,
  RegenerationResult,
  RegenerationTarget,
  SupervisorMemory,
} from "./pipeline-orchestration-types";
import type { ResumeData } from "./types";
import { computeExperienceFingerprint } from "./experience-fingerprint";

// ============================================================================
// 1. CONFIDENCE SCORING
// ============================================================================

/**
 * Compute a confidence score for an agent's output.
 *
 * Factors:
 *   - Provider reliability (is it a real provider vs local engine?)
 *   - Response length (too short = low confidence)
 *   - Parse success (did JSON parse correctly?)
 *   - Factual consistency (for resume outputs)
 *   - Grammar score (no double periods, filler phrases)
 */
export function computeConfidence(params: {
  provider: string;
  model: string;
  responseLength: number;
  parseSuccess: boolean;
  factualConsistencyScore?: number;
  grammarScore?: number;
  tokenUsage: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  fallbackUsed: boolean;
  retryCount: number;
}): ConfidenceResult {
  const factors: ConfidenceFactor[] = [];

  // Factor 1: Provider reliability
  const isLocalEngine = /local|offline/i.test(params.provider);
  const providerScore = isLocalEngine ? 30 : 90;
  factors.push({
    name: "Provider Reliability",
    score: providerScore,
    weight: 0.15,
    details: isLocalEngine ? "Local engine (degraded)" : "Real AI provider",
  });

  // Factor 2: Response length
  const lengthScore = params.responseLength < 100 ? 20
    : params.responseLength < 500 ? 60
    : params.responseLength < 2000 ? 90
    : 100;
  factors.push({
    name: "Response Length",
    score: lengthScore,
    weight: 0.10,
    details: `${params.responseLength} chars`,
  });

  // Factor 3: Parse success
  factors.push({
    name: "Parse Success",
    score: params.parseSuccess ? 100 : 0,
    weight: 0.20,
    details: params.parseSuccess ? "JSON parsed successfully" : "JSON parse failed",
  });

  // Factor 4: Factual consistency (if provided)
  if (params.factualConsistencyScore !== undefined) {
    factors.push({
      name: "Factual Consistency",
      score: params.factualConsistencyScore,
      weight: 0.30,
      details: `${params.factualConsistencyScore}/100`,
    });
  }

  // Factor 5: Grammar score (if provided)
  if (params.grammarScore !== undefined) {
    factors.push({
      name: "Grammar",
      score: params.grammarScore,
      weight: 0.15,
      details: `${params.grammarScore}/100`,
    });
  }

  // Factor 6: Retry penalty
  const retryScore = Math.max(0, 100 - (params.retryCount * 20));
  factors.push({
    name: "Retry Resilience",
    score: retryScore,
    weight: 0.05,
    details: `${params.retryCount} retries`,
  });

  // Factor 7: Latency (faster = higher confidence, but not heavily weighted)
  const latencyScore = params.latencyMs < 5000 ? 100
    : params.latencyMs < 15000 ? 80
    : params.latencyMs < 30000 ? 60
    : 40;
  factors.push({
    name: "Latency",
    score: latencyScore,
    weight: 0.05,
    details: `${(params.latencyMs / 1000).toFixed(1)}s`,
  });

  // Compute weighted average
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const confidence = Math.round(
    factors.reduce((sum, f) => sum + (f.score * f.weight), 0) / totalWeight,
  );

  // Quality score (slightly different weighting — emphasizes factual + grammar)
  const qualityScore = Math.round(
    (confidence * 0.5) +
    ((params.factualConsistencyScore ?? 80) * 0.3) +
    ((params.grammarScore ?? 80) * 0.2),
  );

  return {
    confidence: Math.min(100, Math.max(0, confidence)),
    qualityScore: Math.min(100, Math.max(0, qualityScore)),
    latency: params.latencyMs / 1000,
    tokenUsage: params.tokenUsage,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    provider: params.provider,
    model: params.model,
    fallbackUsed: params.fallbackUsed,
    retryCount: params.retryCount,
    factors,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// 2. HYBRID MATCHING
// ============================================================================

/**
 * Match an optimized experience entry to a source entry using the
 * configured matching strategy.
 *
 * Strategies:
 *   - strict: ID match only (100% confidence or fail)
 *   - hybrid: ID → fingerprint → title/company (fall back through strategies)
 *   - fuzzy: ID → fingerprint → title/company → index (last resort)
 *
 * The threshold determines when hybrid falls back to the next strategy.
 */
export function matchExperienceEntry(
  optimized: { id?: string; title?: string; company?: string; location?: string; startDate?: string; endDate?: string },
  sourceResume: ResumeData,
  strategy: "strict" | "hybrid" | "fuzzy",
  threshold: number = 75,
  index?: number,
): MatchingResult {
  const attempts: MatchingAttempt[] = [];
  const warnings: string[] = [];

  // === Strategy 1: STRICT (ID match only) ===
  if (optimized.id) {
    const byId = sourceResume.experience.find((e) => e.id === optimized.id);
    if (byId) {
      attempts.push({
        strategy: "strict",
        method: "id",
        confidence: 100,
        matched: true,
        details: `ID match: "${optimized.id}"`,
      });
      return {
        strategy,
        matched: true,
        confidence: 100,
        matchedEntry: byId,
        method: "id",
        warnings,
        attempts,
      };
    }
    attempts.push({
      strategy: "strict",
      method: "id",
      confidence: 0,
      matched: false,
      details: `ID "${optimized.id}" not found in source`,
    });
  }

  // If strict strategy, fail here
  if (strategy === "strict") {
    warnings.push(`Strict strategy: ID "${optimized.id}" not found — no fallback allowed`);
    return {
      strategy,
      matched: false,
      confidence: 0,
      method: "none",
      warnings,
      attempts,
    };
  }

  // === Strategy 2: HYBRID (fingerprint match) ===
  const optFp = computeExperienceFingerprint(optimized);
  const sourceFpMap = new Map(
    sourceResume.experience.map((e) => [computeExperienceFingerprint(e), e]),
  );
  const byFp = sourceFpMap.get(optFp);
  if (byFp) {
    const confidence = 90; // fingerprint match = high confidence
    attempts.push({
      strategy: "hybrid",
      method: "fingerprint",
      confidence,
      matched: true,
      details: `Fingerprint match: ${optFp}`,
    });
    if (confidence >= threshold) {
      return {
        strategy,
        matched: true,
        confidence,
        matchedEntry: byFp,
        method: "fingerprint",
        warnings,
        attempts,
      };
    }
    warnings.push(`Fingerprint match found but confidence ${confidence} < threshold ${threshold}`);
  } else {
    attempts.push({
      strategy: "hybrid",
      method: "fingerprint",
      confidence: 0,
      matched: false,
      details: `Fingerprint ${optFp} not found in source`,
    });
  }

  // === Strategy 3: FUZZY (title/company match) ===
  const optTitleLower = (optimized.title || "").toLowerCase().trim();
  const optCompanyLower = (optimized.company || "").toLowerCase().trim();
  if (optTitleLower || optCompanyLower) {
    const byTitleCompany = sourceResume.experience.find((e) => {
      const eTitleLower = (e.title || "").toLowerCase().trim();
      const eCompanyLower = (e.company || "").toLowerCase().trim();
      return (optTitleLower && eTitleLower === optTitleLower) ||
             (optCompanyLower && eCompanyLower === optCompanyLower) ||
             (optCompanyLower && eCompanyLower &&
              (eCompanyLower.includes(optCompanyLower) || optCompanyLower.includes(eCompanyLower)));
    });
    if (byTitleCompany) {
      const confidence = 70;
      attempts.push({
        strategy: "fuzzy",
        method: "title-company",
        confidence,
        matched: true,
        details: `Title/company match: "${optTitleLower}" / "${optCompanyLower}"`,
      });
      if (confidence >= threshold || strategy === "fuzzy") {
        return {
          strategy,
          matched: true,
          confidence,
          matchedEntry: byTitleCompany,
          method: "title-company",
          warnings: [...warnings, `Matched by title/company (fuzzy) — confidence ${confidence}`],
          attempts,
        };
      }
    } else {
      attempts.push({
        strategy: "fuzzy",
        method: "title-company",
        confidence: 0,
        matched: false,
        details: `Title/company "${optTitleLower}"/"${optCompanyLower}" not found`,
      });
    }
  }

  // === Last resort: index match (fuzzy only) ===
  if (strategy === "fuzzy" && index !== undefined && index < sourceResume.experience.length) {
    const byIndex = sourceResume.experience[index];
    attempts.push({
      strategy: "fuzzy",
      method: "index",
      confidence: 50,
      matched: true,
      details: `Index fallback: ${index}`,
    });
    warnings.push(`Matched by index fallback (${index}) — low confidence. The LLM may have significantly modified the entry.`);
    return {
      strategy,
      matched: true,
      confidence: 50,
      matchedEntry: byIndex,
      method: "index",
      warnings,
      attempts,
    };
  }

  warnings.push("No match found with any strategy");
  return {
    strategy,
    matched: false,
    confidence: 0,
    method: "none",
    warnings,
    attempts,
  };
}

// ============================================================================
// 3. QUALITY GATES
// ============================================================================

/**
 * Evaluate quality gates against a resume.
 *
 * Each gate produces a score (0-100). If the score is below the threshold,
 * the gate fails. The overall score is a weighted average of all gate scores.
 */
export function evaluateQualityGates(
  resume: ResumeData,
  sourceResume: ResumeData,
  gates: QualityGate[],
  params: {
    atsScore?: number;
    factualConsistencyScore?: number;
    keywordCoverage?: number;
    htmlValidationScore?: number;
    grammarScore?: number;
    recruiterReadabilityScore?: number;
    onePageValid?: boolean;
    semanticSimilarity?: number;
    confidenceScore?: number;
    qualityScore?: number;
  },
): QualityGateEvaluation {
  const results: QualityGateResult[] = [];

  for (const gate of gates) {
    if (!gate.enabled) continue;

    let score = 0;
    let details = "";
    let regenerationNeeded: RegenerationTarget | undefined;

    switch (gate.type) {
      case "ats-score":
        score = params.atsScore ?? 0;
        details = `ATS score: ${score}/100`;
        regenerationNeeded = "skills";
        break;
      case "factual-consistency":
        score = params.factualConsistencyScore ?? 0;
        details = `Factual consistency: ${score}/100`;
        break;
      case "keyword-coverage":
        score = params.keywordCoverage ?? 0;
        details = `Keyword coverage: ${score}/100`;
        regenerationNeeded = "skills";
        break;
      case "html-validation":
        score = params.htmlValidationScore ?? 0;
        details = `HTML validation: ${score}/100`;
        regenerationNeeded = "formatting";
        break;
      case "grammar":
        score = params.grammarScore ?? 0;
        details = `Grammar: ${score}/100`;
        regenerationNeeded = "summary";
        break;
      case "recruiter-readability":
        score = params.recruiterReadabilityScore ?? 0;
        details = `Recruiter readability: ${score}/100`;
        break;
      case "one-page":
        score = params.onePageValid ? 100 : 0;
        details = params.onePageValid ? "Fits on one page" : "Exceeds one page";
        regenerationNeeded = "formatting";
        break;
      case "semantic-similarity":
        score = params.semanticSimilarity ?? 0;
        details = `Semantic similarity: ${score}/100`;
        regenerationNeeded = "summary";
        break;
      case "confidence-score":
        score = params.confidenceScore ?? 0;
        details = `Confidence: ${score}/100`;
        break;
      case "quality-score":
        score = params.qualityScore ?? 0;
        details = `Quality: ${score}/100`;
        break;
    }

    const passed = score >= gate.threshold;
    results.push({
      gate,
      score,
      passed,
      details,
      regenerationNeeded: passed ? undefined : regenerationNeeded,
    });
  }

  // Compute weighted overall score
  const totalWeight = results.reduce((sum, r) => sum + r.gate.weight, 0);
  const overallScore = totalWeight > 0
    ? Math.round(results.reduce((sum, r) => sum + (r.score * r.gate.weight), 0) / totalWeight)
    : 0;

  const failedGates = results.filter((r) => !r.passed);
  const passed = failedGates.length === 0;

  return {
    results,
    overallScore,
    passed,
    failedGates,
  };
}

// ============================================================================
// 4. TARGETED REGENERATION
// ============================================================================

/**
 * Create a regeneration request for a specific section.
 *
 * The Supervisor uses this when a quality gate fails — instead of regenerating
 * the entire resume, only the failed section is re-run.
 */
export function createRegenerationRequest(params: {
  target: RegenerationTarget;
  reason: string;
  failedGate?: string;
  experienceIndex?: number;
  approvedSections: string[];
  maxAttempts?: number;
}): RegenerationRequest {
  return {
    id: `regen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    target: params.target,
    experienceIndex: params.experienceIndex,
    reason: params.reason,
    failedGate: params.failedGate,
    attempt: 1,
    maxAttempts: params.maxAttempts ?? 3,
    approvedSections: params.approvedSections,
  };
}

/**
 * Record the result of a targeted regeneration.
 */
export function createRegenerationResult(
  request: RegenerationRequest,
  status: "success" | "failed" | "skipped",
  regeneratedSection: string,
  beforePreview: string,
  afterPreview: string,
  confidenceScore?: number,
  qualityScore?: number,
  error?: string,
): RegenerationResult {
  return {
    request,
    status,
    regeneratedSection,
    beforePreview: beforePreview.slice(0, 200),
    afterPreview: afterPreview.slice(0, 200),
    confidenceScore,
    qualityScore,
    error,
  };
}

/**
 * Increment the attempt counter on a regeneration request.
 */
export function incrementRegenerationAttempt(request: RegenerationRequest): RegenerationRequest {
  return {
    ...request,
    attempt: request.attempt + 1,
  };
}

/**
 * Check if a regeneration request has exhausted its attempts.
 */
export function isRegenerationExhausted(request: RegenerationRequest): boolean {
  return request.attempt >= request.maxAttempts;
}

/**
 * Get the sections that need regeneration based on failed quality gates.
 */
export function getRegenerationTargetsFromFailures(
  failedGates: QualityGateResult[],
): RegenerationTarget[] {
  const targets = new Set<RegenerationTarget>();
  for (const gate of failedGates) {
    if (gate.regenerationNeeded) {
      targets.add(gate.regenerationNeeded);
    }
  }
  return Array.from(targets);
}
