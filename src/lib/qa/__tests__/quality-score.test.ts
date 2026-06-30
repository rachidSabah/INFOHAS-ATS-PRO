import { describe, it, expect } from "vitest";
import { calculateQualityScore, evaluateDeployment, QUALITY_THRESHOLD } from "../quality-score";
import type { QARunReport, QATestResult } from "../types";

describe("QualityScore", () => {
  const passingReport: QARunReport = {
    status: "passed",
    fatal: false,
    timestamp: "2026-01-01T00:00:00.000Z",
    totalTests: 100,
    passedTests: 100,
    failedTests: 0,
    totalDurationMs: 1000,
    suites: [],
    allResults: [],
    criticalFailures: [],
    suggestions: [],
    coverage: {
      pipeline: { total: 10, passed: 10, failed: 0 },
      provider: { total: 10, passed: 10, failed: 0 },
      export: { total: 10, passed: 10, failed: 0 },
      cache: { total: 10, passed: 10, failed: 0 },
      ats: { total: 10, passed: 10, failed: 0 },
      regression: { total: 10, passed: 10, failed: 0 },
      performance: { total: 10, passed: 10, failed: 0 },
      browser: { total: 0, passed: 0, failed: 0 },
      api: { total: 0, passed: 0, failed: 0 },
      persistence: { total: 0, passed: 0, failed: 0 },
    },
  };

  const passingDims: Record<string, { passed: boolean; tests: QATestResult[] }> = {};
  const dimensions = ["Lint", "Build", "Unit Tests", "Pipeline Validation",
    "ATS Validation", "Provider Coverage", "Performance", "Security", "Export"];
  dimensions.forEach((d) => {
    passingDims[d] = {
      passed: true,
      tests: [
        { id: `${d}-1`, name: d, category: "regression", severity: "high", passed: true,
          message: "ok", durationMs: 10, timestamp: "2026-01-01T00:00:00.000Z" },
      ],
    };
  });

  it("should calculate 100 score when all pass", () => {
    const result = calculateQualityScore(passingReport, passingDims);
    expect(result.overallScore).toBeGreaterThanOrEqual(95);
    expect(result.overallPassed).toBe(true);
  });

  it("should approve deployment when quality ≥ threshold", () => {
    const result = calculateQualityScore(passingReport, passingDims);
    const decision = evaluateDeployment(result);
    expect(decision.approved).toBe(true);
    expect(decision.qualityScore).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
  });

  it("should reject deployment with fatal errors", () => {
    const fatalReport = { ...passingReport, fatal: true, status: "failed" as const };
    const emptyDims: Record<string, { passed: boolean; tests: QATestResult[] }> = {};
    dimensions.forEach((d) => {
      emptyDims[d] = { passed: false, tests: [] };
    });
    const result = calculateQualityScore(fatalReport, emptyDims);
    const decision = evaluateDeployment(result);
    expect(decision.approved).toBe(false);
  });

  it("should create QualityReport with expected shape", () => {
    const result = calculateQualityScore(passingReport, passingDims);
    expect(result.dimensions.length).toBe(9);
    expect(result.overallScore).toBeDefined();
    expect(result.summary.totalTests).toBe(100);
    expect(result.timestamp).toBeTruthy();
  });
});
