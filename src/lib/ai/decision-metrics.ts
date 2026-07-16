// ============================================================================
// Enterprise Decision Metrics — Phase 8.1.3.6
//
// Reusable infrastructure that aggregates Decision telemetry from persisted
// FlightRecords (which already capture decision metadata — see
// flight-recorder.ts). This module does NOT execute AI and does NOT own a
// configuration system; it is a pure, read-side aggregation layer that the
// Retry Engine (8.1.3.7) and dashboards can reuse.
//
// Input: an array of FlightRecord (e.g. filtered by scope/time via
// matchesFlightFilter). Output: a single DecisionMetrics snapshot.
// ============================================================================

import type { FlightRecord } from "./flight-recorder";

export type DecisionStatus =
  | "accept"
  | "retry"
  | "reject"
  | "escalate"
  | "human_review"
  | "continue"
  | "stop";

export interface DecisionMetrics {
  /** Number of executions that had Decision enabled. */
  totalDecisions: number;
  /** Count per decision status. */
  decisionDistribution: Record<DecisionStatus, number>;
  /** Fraction (0-1) with status "accept". */
  acceptanceRate: number;
  /** Fraction (0-1) with status "retry" (emit-only this phase). */
  retryRecommendationRate: number;
  /** Fraction (0-1) with status "human_review". */
  humanReviewRate: number;
  /** Fraction (0-1) with status "escalate". */
  escalationRate: number;
  /** Fraction (0-1) with status "reject". */
  rejectionRate: number;
  /** Fraction (0-1) with status "stop". */
  stopRate: number;
  /** Average decision confidence (0-1). */
  averageDecisionConfidence: number;
  /** Average decision duration in ms. */
  averageDecisionTime: number;
  /** Per-profile decision rate (accept / total). */
  featureDecisionRate: Record<string, number>;
  /** Per-provider decision rate. */
  providerDecisionRate: Record<string, number>;
  /** Per-model decision rate. */
  modelDecisionRate: Record<string, number>;
  /** 0-100 enterprise decision health (acceptanceRate * 100). */
  enterpriseDecisionHealth: number;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function rateByKey(
  records: FlightRecord[],
  keyFn: (r: FlightRecord) => string | undefined,
): Record<string, number> {
  const groups: Record<string, { accept: number; total: number }> = {};
  for (const r of records) {
    const k = keyFn(r);
    if (!k) continue;
    if (!groups[k]) groups[k] = { accept: 0, total: 0 };
    groups[k].total++;
    if (r.decision?.status === "accept") groups[k].accept++;
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(groups)) {
    out[k] = groups[k].total ? groups[k].accept / groups[k].total : 0;
  }
  return out;
}

function emptyDistribution(): Record<DecisionStatus, number> {
  return {
    accept: 0,
    retry: 0,
    reject: 0,
    escalate: 0,
    human_review: 0,
    continue: 0,
    stop: 0,
  };
}

/**
 * Aggregate Decision metrics from a set of FlightRecords. Records without
 * decision metadata are ignored. Pure + safe.
 */
export function computeDecisionMetrics(records: FlightRecord[]): DecisionMetrics {
  const decided = records.filter((r) => r.decision && r.decision.enabled);

  const distribution = emptyDistribution();
  for (const r of decided) {
    const st = r.decision!.status as DecisionStatus;
    if (st in distribution) distribution[st]++;
  }

  const confidences = decided.map((r) => r.decision?.confidence ?? 0);
  const times = decided.map((r) => r.decision?.durationMs ?? 0);

  const total = decided.length;
  const count = (s: DecisionStatus) => distribution[s];

  return {
    totalDecisions: total,
    decisionDistribution: distribution,
    acceptanceRate: total ? count("accept") / total : 0,
    retryRecommendationRate: total ? count("retry") / total : 0,
    humanReviewRate: total ? count("human_review") / total : 0,
    escalationRate: total ? count("escalate") / total : 0,
    rejectionRate: total ? count("reject") / total : 0,
    stopRate: total ? count("stop") / total : 0,
    averageDecisionConfidence: avg(confidences),
    averageDecisionTime: avg(times),
    featureDecisionRate: rateByKey(decided, (r) => r.decision?.rules[0]?.profile),
    providerDecisionRate: rateByKey(decided, (r) => r.provider),
    modelDecisionRate: rateByKey(decided, (r) => r.model),
    enterpriseDecisionHealth: total ? Math.round((count("accept") / total) * 100) : 0,
  };
}
