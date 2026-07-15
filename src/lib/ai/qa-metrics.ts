// ============================================================================
// Enterprise QA Metrics — Phase 8.1.3.4
//
// Reusable infrastructure that aggregates QA telemetry from persisted
// FlightRecords (which already capture QA metadata — see flight-recorder.ts).
// This module does NOT execute AI and does NOT own a configuration system; it is
// a pure, read-side aggregation layer that later phases (Validation / Decision
// Engine) can reuse.
//
// Input: an array of FlightRecord (e.g. filtered by scope/time via
// matchesFlightFilter). Output: a single QAMetrics snapshot.
// ============================================================================

import type { FlightRecord } from "./flight-recorder";

export interface QAMetrics {
  /** Number of executions that had QA enabled. */
  totalQA: number;
  /** Average overallScore across QA-ed executions (0 if none). */
  averageQAScore: number;
  /** Average QA duration in ms (0 if none). */
  averageQATime: number;
  /** Fraction (0-1) of QA runs that PASSED. */
  passRate: number;
  /** Fraction (0-1) of QA runs that recommended a fail/rework. */
  failRate: number;
  /** Average hallucinationRisk (0-1) across QA runs. */
  averageHallucinationRisk: number;
  /** Average policyRisk (0-1) across QA runs. */
  averagePolicyRisk: number;
  /** Average incompletenessRisk (0-1) across QA runs. */
  averageIncompletenessRisk: number;
  /** Average confidence (0-100). */
  averageConfidence: number;
  /** Count of findings grouped by category across all QA runs. */
  findingsByCategory: Record<string, number>;
  /** Count of findings grouped by severity across all QA runs. */
  findingsBySeverity: { critical: number; major: number; minor: number };
  /** Confidence histogram buckets 0-20,20-40,...80-100. */
  confidenceDistribution: number[];
  /** Total estimated QA cost (USD). */
  qaCost: number;
  /** Total estimated QA tokens. */
  qaTokenUsage: number;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Aggregate QA metrics from a set of FlightRecords. Records without
 * QA metadata are ignored (they didn't run QA). Pure + safe.
 */
export function computeQAMetrics(records: FlightRecord[]): QAMetrics {
  const qaed = records.filter((r) => r.qa && r.qa.enabled);

  const scores = qaed.map((r) => r.qa!.score ?? 0);
  const times = qaed.map((r) => r.qa?.durationMs ?? 0);
  const confs = qaed.map((r) => r.qa?.confidence ?? 0);
  const halls = qaed.map((r) => Math.min(1, Math.max(0, r.qa?.hallucinationRisk ?? 0)));
  const pols = qaed.map((r) => Math.min(1, Math.max(0, r.qa?.policyRisk ?? 0)));
  const incs = qaed.map((r) => Math.min(1, Math.max(0, r.qa?.incompletenessRisk ?? 0)));

  const passedCount = qaed.filter((r) => r.qa?.outcome === "passed").length;
  const failedCount = qaed.filter((r) => r.qa?.outcome === "failed" || r.qa?.failRecommended).length;

  const findingsByCategory: Record<string, number> = {};
  const findingsBySeverity = { critical: 0, major: 0, minor: 0 };
  for (const r of qaed) {
    for (const f of r.qa?.findings ?? []) {
      findingsByCategory[f.category] = (findingsByCategory[f.category] ?? 0) + 1;
      if (f.severity === "critical") findingsBySeverity.critical++;
      else if (f.severity === "major") findingsBySeverity.major++;
      else findingsBySeverity.minor++;
    }
  }

  const confidenceDistribution = [0, 0, 0, 0, 0];
  for (const c of confs) {
    const idx = Math.min(4, Math.floor(Math.min(100, Math.max(0, c)) / 20));
    confidenceDistribution[idx]++;
  }

  const total = qaed.length;

  return {
    totalQA: total,
    averageQAScore: avg(scores),
    averageQATime: avg(times),
    passRate: total ? passedCount / total : 0,
    failRate: total ? failedCount / total : 0,
    averageHallucinationRisk: avg(halls),
    averagePolicyRisk: avg(pols),
    averageIncompletenessRisk: avg(incs),
    averageConfidence: avg(confs),
    findingsByCategory,
    findingsBySeverity,
    confidenceDistribution,
    qaCost: qaed.reduce((a, r) => a + (r.qa?.cost ?? 0), 0),
    qaTokenUsage: qaed.reduce((a, r) => a + (r.qa?.tokens ?? 0), 0),
  };
}
