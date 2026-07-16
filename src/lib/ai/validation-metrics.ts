// ============================================================================
// Enterprise Validation Metrics — Phase 8.1.3.5
//
// Reusable infrastructure that aggregates Validation telemetry from persisted
// FlightRecords (which already capture validation metadata — see
// flight-recorder.ts). This module does NOT execute AI and does NOT own a
// configuration system; it is a pure, read-side aggregation layer that the
// Decision Engine (8.1.3.6) and dashboards can reuse.
//
// Input: an array of FlightRecord (e.g. filtered by scope/time via
// matchesFlightFilter). Output: a single ValidationMetrics snapshot.
// ============================================================================

import type { FlightRecord } from "./flight-recorder";

export interface ValidationMetrics {
  /** Number of executions that had Validation enabled. */
  totalValidations: number;
  /** Average overall validation score (0 if none). */
  averageValidationScore: number;
  /** Average validation duration in ms (0 if none). */
  averageValidationTime: number;
  /** Fraction (0-1) with status "passed". */
  passRate: number;
  /** Fraction (0-1) with status "failed". */
  failureRate: number;
  /** Fraction (0-1) with status "warning". */
  warningRate: number;
  /** Fraction (0-1) of validations with >=1 critical failure. */
  criticalFailureRate: number;
  /** Rule-level failure rate across all evaluated rules. */
  ruleFailureRate: number;
  /** Per-profile pass rate. */
  featureValidationRate: Record<string, number>;
  /** Per-provider pass rate. */
  providerValidationRate: Record<string, number>;
  /** Per-model pass rate. */
  modelValidationRate: Record<string, number>;
  /** 0-100 enterprise validation health (passRate * 100, weighted by score). */
  enterpriseValidationHealth: number;
  /** Total rule evaluations aggregated. */
  totalRuleEvaluations: number;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function rateByKey(records: FlightRecord[], keyFn: (r: FlightRecord) => string | undefined): Record<string, number> {
  const groups: Record<string, { pass: number; total: number }> = {};
  for (const r of records) {
    const k = keyFn(r);
    if (!k) continue;
    if (!groups[k]) groups[k] = { pass: 0, total: 0 };
    groups[k].total++;
    if (r.validation?.outcome === "passed") groups[k].pass++;
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(groups)) {
    out[k] = groups[k].total ? groups[k].pass / groups[k].total : 0;
  }
  return out;
}

/**
 * Aggregate Validation metrics from a set of FlightRecords. Records without
 * validation metadata are ignored. Pure + safe.
 */
export function computeValidationMetrics(records: FlightRecord[]): ValidationMetrics {
  const validated = records.filter((r) => r.validation && r.validation.enabled);

  const scores = validated.map((r) => r.validation!.score ?? 0);
  const times = validated.map((r) => r.validation?.durationMs ?? 0);

  const passed = validated.filter((r) => r.validation?.outcome === "passed").length;
  const failed = validated.filter((r) => r.validation?.outcome === "failed").length;
  const warned = validated.filter((r) => r.validation?.outcome === "warning").length;
  const critical = validated.filter((r) => (r.validation?.criticalFailures ?? 0) > 0).length;

  let totalRuleEvals = 0;
  let failedRuleEvals = 0;
  for (const r of validated) {
    for (const rule of r.validation?.rules ?? []) {
      totalRuleEvals++;
      if (rule.outcome === "fail") failedRuleEvals++;
    }
  }

  const total = validated.length;

  return {
    totalValidations: total,
    averageValidationScore: avg(scores),
    averageValidationTime: avg(times),
    passRate: total ? passed / total : 0,
    failureRate: total ? failed / total : 0,
    warningRate: total ? warned / total : 0,
    criticalFailureRate: total ? critical / total : 0,
    ruleFailureRate: totalRuleEvals ? failedRuleEvals / totalRuleEvals : 0,
    featureValidationRate: rateByKey(validated, (r) => r.validation?.profile),
    providerValidationRate: rateByKey(validated, (r) => r.provider),
    modelValidationRate: rateByKey(validated, (r) => r.model),
    enterpriseValidationHealth: total ? Math.round((passed / total) * avg(scores)) : 0,
    totalRuleEvaluations: totalRuleEvals,
  };
}
