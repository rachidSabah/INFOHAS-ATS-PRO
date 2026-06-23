// ResumeAI Pro — Performance Monitor
// Measures API latency, pipeline duration, export duration, and render duration.
// Alerts when optimization completes too fast (< 1 second with non-cache provider).
//
// Pure functions — safe for Edge Runtime.

import type { PerformanceMetric, PerformanceReport, QATestResult } from "./types";

/**
 * Record a performance metric and check against threshold.
 */
export function recordMetric(
  name: string,
  valueMs: number,
  thresholdMs: number
): PerformanceMetric {
  return {
    name,
    valueMs,
    thresholdMs,
    passed: valueMs <= thresholdMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a performance report from collected metrics.
 */
export function createPerformanceReport(
  apiMetrics: PerformanceMetric[],
  pipelineMetrics: PerformanceMetric[],
  exportMetrics: PerformanceMetric[],
  renderMetrics: PerformanceMetric[]
): PerformanceReport {
  const allMetrics = [...apiMetrics, ...pipelineMetrics, ...exportMetrics, ...renderMetrics];
  const allPassed = allMetrics.every((m) => m.passed);
  const alertReasons: string[] = [];

  // Alert on suspiciously fast optimizations
  for (const m of pipelineMetrics) {
    if (m.name.includes("optimization") && m.valueMs < 1000) {
      alertReasons.push(
        `Optimization completed in ${m.valueMs}ms (< 1 second) — possible cache hit or fake result`
      );
    }
  }

  // Alert on slow operations
  for (const m of allMetrics) {
    if (!m.passed) {
      alertReasons.push(`${m.name}: ${m.valueMs}ms exceeds threshold ${m.thresholdMs}ms`);
    }
  }

  return {
    apiLatency: apiMetrics,
    pipelineDuration: pipelineMetrics,
    exportDuration: exportMetrics,
    renderDuration: renderMetrics,
    allPassed: allPassed && alertReasons.length === 0,
    alertReasons,
  };
}

/**
 * Check if an optimization is suspiciously fast.
 * Optimization < 1 second AND provider != cache → REJECT.
 */
export function isOptimizationSuspiciouslyFast(
  durationMs: number,
  providerName: string
): { suspicious: boolean; reason: string } {
  const isCacheProvider = /cache|local|offline/i.test(providerName);

  if (durationMs < 1000 && !isCacheProvider) {
    return {
      suspicious: true,
      reason: `Optimization completed in ${durationMs}ms (< 1 second) from ${providerName} — possible fake or cached result without proper cache key`,
    };
  }

  return { suspicious: false, reason: "" };
}

/**
 * Generate QA test results from performance report.
 */
export function performanceToQATests(report: PerformanceReport): QATestResult[] {
  const tests: QATestResult[] = [];
  const timestamp = new Date().toISOString();

  // Test: API latency within thresholds
  const apiFailed = report.apiLatency.filter((m) => !m.passed);
  tests.push({
    id: `perf_api_${Date.now()}`,
    name: "Performance: API Latency Within Thresholds",
    category: "performance",
    severity: "high",
    passed: apiFailed.length === 0,
    message:
      apiFailed.length === 0
        ? `All ${report.apiLatency.length} API calls within latency thresholds`
        : `${apiFailed.length}/${report.apiLatency.length} API calls exceeded latency thresholds`,
    durationMs: report.apiLatency.reduce((s, m) => s + m.valueMs, 0),
    timestamp,
    details: {
      averageMs: report.apiLatency.length > 0
        ? Math.round(report.apiLatency.reduce((s, m) => s + m.valueMs, 0) / report.apiLatency.length)
        : 0,
      maxMs: Math.max(0, ...report.apiLatency.map((m) => m.valueMs)),
    },
  });

  // Test: Pipeline duration within thresholds
  tests.push({
    id: `perf_pipeline_${Date.now()}`,
    name: "Performance: Pipeline Duration Within Thresholds",
    category: "performance",
    severity: "medium",
    passed: report.pipelineDuration.every((m) => m.passed),
    message:
      report.pipelineDuration.every((m) => m.passed)
        ? "Pipeline stages complete within expected durations"
        : "Some pipeline stages exceed expected duration",
    durationMs: report.pipelineDuration.reduce((s, m) => s + m.valueMs, 0),
    timestamp,
  });

  // Test: No suspiciously fast optimizations
  const fastAlerts = report.alertReasons.filter((r) => r.includes("< 1 second"));
  tests.push({
    id: `perf_suspicious_${Date.now()}`,
    name: "Performance: No Suspiciously Fast Optimizations",
    category: "performance",
    severity: "critical",
    passed: fastAlerts.length === 0,
    message:
      fastAlerts.length === 0
        ? "No suspiciously fast optimizations detected"
        : `${fastAlerts.length} suspiciously fast optimization(s) — possible fake results`,
    durationMs: 0,
    timestamp,
    suggestion: fastAlerts.length > 0 ? "Verify optimization results are genuine AI outputs, not cached or local fallbacks" : undefined,
  });

  // Test: Export duration
  tests.push({
    id: `perf_export_${Date.now()}`,
    name: "Performance: Export Duration Within Thresholds",
    category: "performance",
    severity: "low",
    passed: report.exportDuration.every((m) => m.passed),
    message:
      report.exportDuration.every((m) => m.passed)
        ? "All exports complete within expected duration"
        : "Some exports exceed expected duration",
    durationMs: report.exportDuration.reduce((s, m) => s + m.valueMs, 0),
    timestamp,
  });

  return tests;
}

/**
 * Standard performance thresholds.
 */
export const PERFORMANCE_THRESHOLDS = {
  API_CALL_MS: 10000,        // 10 seconds max for API calls
  PIPELINE_TOTAL_MS: 120000, // 2 minutes max for full pipeline
  PIPELINE_STAGE_MS: 30000,  // 30 seconds max per pipeline stage
  EXPORT_MS: 5000,           // 5 seconds max for export generation
  RENDER_MS: 3000,           // 3 seconds max for page render
  OPTIMIZATION_MIN_MS: 1000, // Minimum 1 second for real AI optimization
} as const;
