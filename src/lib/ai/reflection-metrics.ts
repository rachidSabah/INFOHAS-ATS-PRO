// ============================================================================
// Enterprise Reflection Metrics — Phase 8.1.3.3
//
// Reusable infrastructure that aggregates reflection telemetry from persisted
// FlightRecords (which already capture reflection metadata — see
// flight-recorder.ts). This module does NOT execute AI and does NOT own a
// configuration system; it is a pure, read-side aggregation layer that later
// phases (QA / Validation / Decision Engine) can reuse.
//
// Input: an array of FlightRecord (e.g. filtered by scope/time via
// matchesFlightFilter). Output: a single ReflectionMetrics snapshot.
// ============================================================================

import type { FlightRecord } from "./flight-recorder";

export interface ReflectionMetrics {
  /** Number of executions that had reflection enabled. */
  totalReflections: number;
  /** Average overallScore across reflected executions (0 if none). */
  averageReflectionScore: number;
  /** Average reflection duration in ms (0 if none). */
  averageReflectionTime: number;
  /** Fraction (0-1) of reflections with status "ok" (no retry). */
  reflectionPassRate: number;
  /** Fraction (0-1) of reflections that recommended a retry. */
  reflectionRetryRate: number;
  /** Average hallucinationRisk (0-1) across reflections. */
  averageHallucinationRisk: number;
  /** Average instruction-compliance proxy: 1 - (violations>0 ? 1 : 0). */
  instructionComplianceRate: number;
  /** Average format-compliance proxy: 1 - (formatViolations>0 ? 1 : 0). */
  formattingComplianceRate: number;
  /** Mean confidence across reflections (0-100). */
  averageConfidence: number;
  /** Confidence histogram buckets 0-20,20-40,...80-100. */
  confidenceDistribution: number[];
  /** Total estimated reflection cost (USD). */
  reflectionCost: number;
  /** Total estimated reflection tokens. */
  reflectionTokenUsage: number;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Aggregate reflection metrics from a set of FlightRecords. Records without
 * reflection metadata are ignored (they didn't run reflection). Pure + safe.
 */
export function computeReflectionMetrics(records: FlightRecord[]): ReflectionMetrics {
  const reflected = records.filter((r) => r.reflection && r.reflection.enabled);

  const scores = reflected.map((r) => r.reflection!.score ?? 0);
  const times = reflected.map((r) => r.reflection?.durationMs ?? 0);
  const confs = reflected.map((r) => r.reflection?.confidence ?? 0);
  const halls = reflected.map((r) => Math.min(1, Math.max(0, r.reflection?.hallucinationRisk ?? 0)));

  const okCount = reflected.filter((r) => r.reflection?.outcome === "ok").length;
  const retryCount = reflected.filter((r) => r.reflection?.outcome === "retry" || r.reflection?.retryRecommended).length;
  const instOk = reflected.filter((r) => (r.reflection?.instructionViolations?.length ?? 0) === 0).length;
  const fmtOk = reflected.filter((r) => (r.reflection?.formatViolations?.length ?? 0) === 0).length;

  const confidenceDistribution = [0, 0, 0, 0, 0];
  for (const c of confs) {
    const idx = Math.min(4, Math.floor(Math.min(100, Math.max(0, c)) / 20));
    confidenceDistribution[idx]++;
  }

  const total = reflected.length;

  return {
    totalReflections: total,
    averageReflectionScore: avg(scores),
    averageReflectionTime: avg(times),
    reflectionPassRate: total ? okCount / total : 0,
    reflectionRetryRate: total ? retryCount / total : 0,
    averageHallucinationRisk: avg(halls),
    instructionComplianceRate: total ? instOk / total : 0,
    formattingComplianceRate: total ? fmtOk / total : 0,
    averageConfidence: avg(confs),
    confidenceDistribution,
    reflectionCost: reflected.reduce((a, r) => a + (r.reflection?.cost ?? 0), 0),
    reflectionTokenUsage: reflected.reduce((a, r) => a + (r.reflection?.tokens ?? 0), 0),
  };
}
