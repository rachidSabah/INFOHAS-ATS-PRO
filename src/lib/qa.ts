// ResumeAI Pro — QA Diagnostics & Self-Healing Utilities
// Pure functions — safe for Edge Runtime and unit tests.

import type { PipelineResult } from "./agents/orchestrator";
import type { ResumeData } from "./types";

export interface OptimizationQualityReport {
  passed: boolean;
  checks: QualityCheck[];
}

export interface QualityCheck {
  name: string;
  passed: boolean;
  value: number | boolean | string | null;
  threshold?: number | string;
  message: string;
}

export interface CacheIntegrityReport {
  passed: boolean;
  offlineEntries: number;
  failedEntries: number;
  shortEntries: number;
  totalEntries: number;
  checks: QualityCheck[];
}

export interface SilentFailureMatch {
  file: string;
  line: number;
  snippet: string;
}

export interface SilentFailureReport {
  passed: boolean;
  matches: SilentFailureMatch[];
}

/** Minimum content length for a real AI optimization. */
export const MIN_OPTIMIZATION_CHARS = 2200;
/** Minimum acceptable page usage in %. */
export const MIN_PAGE_USAGE = 0.85;

/**
 * Validate an optimization against the production quality gates.
 * Returns a report with every assertion; `passed` is true only if all pass.
 * @param result The pipeline result to validate.
 * @param originalResume Optional original resume to check identity.
 */
export function assertOptimizationQuality(result: PipelineResult, originalResume?: ResumeData): OptimizationQualityReport {
  const optimized = result.optimizedResume;

  const responseLength = result.charCount ?? 0;
  const pageUsageRaw = typeof optimized === "object" && optimized
    ? Math.min(1, responseLength / 2900)
    : 0;

  const checks: QualityCheck[] = [
    {
      name: "providerSucceeded",
      passed: result.provider !== "Local Engine (offline mode)" && result.status !== "failed",
      value: result.provider,
      message: result.provider === "Local Engine (offline mode)"
        ? "Optimization used offline fallback — not a successful AI optimization."
        : `Provider: ${result.provider}`,
    },
    {
      name: "responseLength",
      passed: responseLength >= MIN_OPTIMIZATION_CHARS,
      value: responseLength,
      threshold: MIN_OPTIMIZATION_CHARS,
      message: responseLength < MIN_OPTIMIZATION_CHARS
        ? `Optimization too short: ${responseLength} chars (min ${MIN_OPTIMIZATION_CHARS}).`
        : `Length OK: ${responseLength} chars.`,
    },
    {
      name: "statusNotFailed",
      passed: result.status !== "failed",
      value: result.status,
      message: result.status === "failed"
        ? `Pipeline reported failed status: ${result.error || "unknown error"}`
        : `Pipeline status: ${result.status}`,
    },
    {
      name: "hasExperience",
      passed: !!optimized?.experience && optimized.experience.length > 0,
      value: optimized?.experience?.length ?? 0,
      message: !optimized?.experience?.length
        ? "Optimized resume is missing experience."
        : `${optimized!.experience.length} experience entries.`,
    },
    {
      name: "hasEducation",
      passed: !!optimized?.education && optimized.education.length > 0,
      value: optimized?.education?.length ?? 0,
      message: !optimized?.education?.length
        ? "Optimized resume is missing education."
        : `${optimized!.education.length} education entries.`,
    },
    {
      name: "hasSkills",
      passed: !!optimized?.skills && optimized.skills.length > 0,
      value: optimized?.skills?.length ?? 0,
      message: !optimized?.skills?.length
        ? "Optimized resume is missing skills."
        : `${optimized!.skills.length} skill groups.`,
    },
    {
      name: "pageUsage",
      passed: pageUsageRaw >= MIN_PAGE_USAGE,
      value: Math.round(pageUsageRaw * 100),
      threshold: Math.round(MIN_PAGE_USAGE * 100),
      message: pageUsageRaw < MIN_PAGE_USAGE
        ? `Page usage ${Math.round(pageUsageRaw * 100)}% is below ${Math.round(MIN_PAGE_USAGE * 100)}%.`
        : `Page usage ${Math.round(pageUsageRaw * 100)}%.`,
    },
    {
      name: "notIdenticalToOriginal",
      passed: !originalResume || !optimized || JSON.stringify(originalResume) !== JSON.stringify(optimized),
      value: !!(originalResume && optimized && JSON.stringify(originalResume) === JSON.stringify(optimized)),
      message: originalResume && optimized && JSON.stringify(originalResume) === JSON.stringify(optimized)
        ? "Optimized resume is identical to original."
        : "Optimized resume differs from original.",
    },
  ];

  return { passed: checks.every((c) => c.passed), checks };
}

/**
 * Evaluate whether an optimization result is safe to cache.
 */
export function isCacheableOptimization(result: PipelineResult): boolean {
  if (result.provider === "Local Engine (offline mode)") return false;
  if (result.status === "failed") return false;
  if ((result.charCount ?? 0) < MIN_OPTIMIZATION_CHARS) return false;
  return true;
}

/**
 * Heuristic self-check: scan a code string for silent catch patterns.
 * This is intentionally simple — it flags the patterns the QA spec asks us
 * to watch for, not a full AST traversal.
 */
export function scanForSilentFailures(source: string, fileName = "inline"): SilentFailureMatch[] {
  const matches: SilentFailureMatch[] = [];
  const patterns = [
    /catch\s*\([^)]*\)\s*\{\s*\}/g,
    /catch\s*\([^)]*\)\s*\{[\s;]*\}/g,
    /catch\s*\(\s*\)\s*\{/g,
  ];

  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(source)) !== null) {
      matches.push({ file: fileName, line: lineNumber(source, m.index), snippet: m[0] });
    }
  }

  return matches;
}

export function lineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
