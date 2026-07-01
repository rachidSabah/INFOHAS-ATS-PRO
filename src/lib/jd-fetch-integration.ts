// ============================================================================
// JD Fetch Integration — Coordinator for Live JD Fetch + Eligibility + Guardian
//
// This module coordinates the three Phase 11 features WITHOUT modifying
// any existing pipeline code:
//
//   1. fetchLiveJD()     → enriches JobDescription with live data
//   2. checkEligibility() → surfaces hard requirements gaps
//   3. runGuardianStrict() → traces every metric to source
//
// USAGE (additive — call BEFORE runLockedPipeline):
//
//   const { enrichedJD, eligibility } = await prepareLiveJD(jd);
//   const result = await runLockedPipeline(resume, enrichedJD, ctx);
//   const strictReport = runGuardianStrict(resume, result.resume);
//
// DESIGN PRINCIPLES:
//   - ZERO changes to locked-pipeline.ts, job-intelligence.ts, types.ts
//   - All three checks are OPTIONAL — pipeline works without them
//   - Never throws, never blocks the pipeline
//   - Returns diagnostic data alongside unchanged data on failure
// ============================================================================

import type { ResumeData, JobDescription } from "./types";
import { fetchLiveJD } from "./jd-fetch-engine";
import { checkEligibility } from "./eligibility-checker";
import { runGuardianStrict, type GuardianStrictReport } from "./guardian-strict";

export interface LiveJDResult {
  /** The enriched JobDescription (or original if fetch failed) */
  jd: JobDescription;
  /** Whether a live fetch was attempted and succeeded */
  liveFetchAttempted: boolean;
  /** Whether the JD was enriched with live data */
  liveFetchSucceeded: boolean;
  /** The fetched URL (if any) */
  fetchedUrl?: string;
  /** Eligibility report (if check was run) */
  eligibility?: ReturnType<typeof checkEligibility>;
  /** Errors encountered (non-fatal) */
  errors: string[];
  /** Warnings */
  warnings: string[];
}

export interface PostOptimizationReport {
  /** Guardian Strict report (anti-fabrication check) */
  guardianStrict: GuardianStrictReport;
  /** Whether the optimized resume passed all checks */
  passed: boolean;
}

// ============================================================================
// Phase 1: Pre-Optimization — JD Fetch + Eligibility
// ============================================================================

/**
 * Prepare a live JD and check eligibility before running the pipeline.
 *
 * Call this BEFORE runLockedPipeline() to enrich the JD.
 *
 * @param jd - The input JobDescription (may be partial, e.g. just title+company)
 * @returns LiveJDResult with enriched JD + eligibility data
 */
export async function prepareLiveJD(
  jd: JobDescription,
): Promise<LiveJDResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Step 1: Fetch live JD (search + parse)
  const fetchResult = await fetchLiveJD(jd);

  if (fetchResult.errors.length > 0) {
    errors.push(...fetchResult.errors);
  }
  if (fetchResult.warnings.length > 0) {
    warnings.push(...fetchResult.warnings);
  }

  const enrichedJD = fetchResult.jd;

  return {
    jd: enrichedJD,
    liveFetchAttempted: fetchResult.metadata.searchAttempted || fetchResult.metadata.fetchAttempted,
    liveFetchSucceeded: fetchResult.source === "search-fetch" || fetchResult.source === "cache",
    fetchedUrl: fetchResult.fetchedUrl,
    errors,
    warnings,
  };
}

/**
 * Check eligibility against a live JD (call after prepareLiveJD).
 *
 * @param resume - The candidate's parsed resume
 * @param jd - The enriched JobDescription
 * @returns Eligibility report
 */
export function checkCandidateEligibility(
  resume: ResumeData,
  jd: JobDescription,
): ReturnType<typeof checkEligibility> {
  return checkEligibility(resume, jd);
}

// ============================================================================
// Phase 2: Post-Optimization — Guardian Strict
// ============================================================================

/**
 * Run Guardian Strict on the optimization output.
 *
 * Call this AFTER runLockedPipeline() to detect fabrication.
 *
 * @param sourceResume - The original parsed resume (ground truth)
 * @param optimizedResume - The optimizer's output
 * @returns PostOptimizationReport
 */
export function verifyOptimizationHonesty(
  sourceResume: ResumeData,
  optimizedResume: ResumeData,
): PostOptimizationReport {
  const guardianStrict = runGuardianStrict(sourceResume, optimizedResume);
  return {
    guardianStrict,
    passed: guardianStrict.verdict === "CLEAN",
  };
}
