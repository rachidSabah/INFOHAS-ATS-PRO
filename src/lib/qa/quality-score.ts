// ============================================================================
// Enterprise QA Platform — Quality Score Engine
// ============================================================================
// Aggregates individual test results into a weighted Quality Score (0–100).
// Deployment is approved only when Overall Quality ≥ 95.
// ============================================================================

import type { QATestResult, QARunReport } from "./types";

// ============================================================================
// Quality Dimensions
// ============================================================================

export interface QualityDimension {
  name: string;
  weight: number; // 0.0 – 1.0, sum of all = 1.0
  score: number;  // 0–100
  passed: boolean;
  details: QATestResult[];
}

export interface QualityReport {
  overallScore: number;
  overallPassed: boolean;
  dimensions: QualityDimension[];
  timestamp: string;
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    fatal: boolean;
  };
}

const DIMENSION_WEIGHTS: Array<{ name: string; weight: number }> = [
  { name: "Lint", weight: 0.05 },
  { name: "Build", weight: 0.05 },
  { name: "Unit Tests", weight: 0.15 },
  { name: "Pipeline Validation", weight: 0.25 },
  { name: "ATS Validation", weight: 0.10 },
  { name: "Provider Coverage", weight: 0.10 },
  { name: "Performance", weight: 0.10 },
  { name: "Security", weight: 0.10 },
  { name: "Export", weight: 0.10 },
];

export const QUALITY_THRESHOLD = 95;

// ============================================================================
// Score Calculator
// ============================================================================

export function calculateQualityScore(
  report: QARunReport,
  dimensionResults: Record<string, { passed: boolean; tests: QATestResult[] }>,
): QualityReport {
  const dimensions: QualityDimension[] = DIMENSION_WEIGHTS.map((dim) => {
    const dimData = dimensionResults[dim.name] || { passed: false, tests: [] };
    const passRate =
      dimData.tests.length > 0
        ? (dimData.tests.filter((t) => t.passed).length / dimData.tests.length) * 100
        : dimData.passed ? 100 : 0;

    return {
      name: dim.name,
      weight: dim.weight,
      score: passRate,
      passed: passRate >= 80,
      details: dimData.tests,
    };
  });

  // Calculate weighted score
  const overallScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
  );

  const totalTests = report.totalTests;
  const passed = report.status === "passed" ? totalTests : totalTests - report.failedTests;
  const failed = report.failedTests;

  return {
    overallScore,
    overallPassed: overallScore >= QUALITY_THRESHOLD && !report.fatal,
    dimensions,
    timestamp: new Date().toISOString(),
    summary: {
      totalTests,
      passed,
      failed,
      fatal: report.fatal,
    },
  };
}

// ============================================================================
// Deployment Approval
// ============================================================================

export interface DeploymentDecision {
  approved: boolean;
  qualityScore: number;
  reason: string;
}

export function evaluateDeployment(
  qualityReport: QualityReport,
): DeploymentDecision {
  if (qualityReport.overallPassed) {
    return {
      approved: true,
      qualityScore: qualityReport.overallScore,
      reason: `Quality score ${qualityReport.overallScore} ≥ ${QUALITY_THRESHOLD} — deployment approved`,
    };
  }

  if (qualityReport.summary.fatal) {
    return {
      approved: false,
      qualityScore: qualityReport.overallScore,
      reason: `Fatal errors detected — deployment blocked (score: ${qualityReport.overallScore})`,
    };
  }

  return {
    approved: false,
    qualityScore: qualityReport.overallScore,
    reason: `Quality score ${qualityReport.overallScore} < ${QUALITY_THRESHOLD} — deployment rejected`,
  };
}

export default {
  calculateQualityScore,
  evaluateDeployment,
  QUALITY_THRESHOLD,
};
