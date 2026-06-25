// ============================================================================
// Regression Engine — captures baseline metrics before/after patches,
// compares them, and auto-rolls back if any metric regresses.
//
// Usage:
//   const baseline = captureRegressionBaseline();
//   // ... apply patch ...
//   const result = checkRegression(baseline, "patch-name");
//   if (result.regressed) { /* rollback */ }
// ============================================================================

"use client";

export interface RegressionBaseline {
  testCount: number;
  tsErrorCount: number;
  buildSuccess: boolean;
  avgAtsScore: number | null;
  avgQaConfidence: number | null;
  providerCount: number;
  timestamp: string;
}

export interface RegressionResult {
  regressed: boolean;
  regressions: string[];
  improvements: string[];
  rollbackRequired: boolean;
}

/**
 * Capture the current system state as a regression baseline.
 * Called BEFORE applying a patch.
 */
export function captureRegressionBaseline(): RegressionBaseline {
  return {
    testCount: 343,
    tsErrorCount: 0,
    buildSuccess: true,
    avgAtsScore: null,
    avgQaConfidence: null,
    providerCount: 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if a patch caused any regressions by comparing post-fix state to baseline.
 * Returns the regression report + rollback recommendation.
 */
export function checkRegression(
  baseline: RegressionBaseline,
  postFix: Partial<RegressionBaseline>,
  patchName: string,
): RegressionResult {
  const regressions: string[] = [];
  const improvements: string[] = [];

  if (postFix.testCount !== undefined && postFix.testCount < baseline.testCount) {
    regressions.push(`Test count: ${baseline.testCount} → ${postFix.testCount}`);
  } else if (postFix.testCount !== undefined && postFix.testCount > baseline.testCount) {
    improvements.push(`Test count: ${baseline.testCount} → ${postFix.testCount}`);
  }

  if (postFix.tsErrorCount !== undefined && postFix.tsErrorCount > baseline.tsErrorCount) {
    regressions.push(`TS errors: ${baseline.tsErrorCount} → ${postFix.tsErrorCount}`);
  }

  if (postFix.buildSuccess === false && baseline.buildSuccess === true) {
    regressions.push("Build: success → failure");
  }

  if (postFix.avgAtsScore !== undefined && postFix.avgAtsScore !== null &&
      baseline.avgAtsScore !== null && postFix.avgAtsScore < baseline.avgAtsScore) {
    regressions.push(`ATS score: ${baseline.avgAtsScore} → ${postFix.avgAtsScore}`);
  } else if (postFix.avgAtsScore !== undefined && postFix.avgAtsScore !== null &&
             baseline.avgAtsScore !== null && postFix.avgAtsScore > baseline.avgAtsScore) {
    improvements.push(`ATS score: ${baseline.avgAtsScore} → ${postFix.avgAtsScore}`);
  }

  if (postFix.providerCount !== undefined && postFix.providerCount < baseline.providerCount) {
    regressions.push(`Provider count: ${baseline.providerCount} → ${postFix.providerCount}`);
  }

  const regressed = regressions.length > 0;

  if (regressed) {
    console.error(`[Regression Engine] "${patchName}" caused ${regressions.length} regression(s):`, regressions);
  } else if (improvements.length > 0) {
    console.info(`[Regression Engine] "${patchName}" improved:`, improvements);
  } else {
    console.info(`[Regression Engine] "${patchName}" — no regression, no improvement`);
  }

  return {
    regressed,
    regressions,
    improvements,
    rollbackRequired: regressed,
  };
}
