// ============================================================================
// Phase8.1.3.6 — Decision Metrics tests.
//
// Verifies computeDecisionMetrics aggregation over a FlightRecord[] (only records
// with a populated `decision` block count). Pure, no network.
// ============================================================================

import { describe, it, expect } from "vitest";
import { computeDecisionMetrics } from "./decision-metrics";
import type { FlightRecord } from "./flight-recorder";

function rec(status: string, profile = "default", provider = "p", model = "m"): FlightRecord {
  return {
    executionId: "fx-" + status + "-" + Math.floor(performance.now() * 1000), // unique-ish
    timestamp: new Date().toISOString(),
    provider, model, streaming: false, promptVersion: "x", promptHash: "h", contextHash: "c",
    durationMs: 1, latencyMs: 1, tokenUsage: 1, retryCount: 0,
    reflectionEnabled: false, qaEnabled: false, validationEnabled: false,
    status: "success" as any, warnings: [], errors: [], scope: "other",
    prompt: { userPrompt: "" }, parameters: {}, timeline: [], performance: { totalMs: 1 }, cost: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, provider, model },
    decision: {
      decisionId: "dcx", enabled: true, status: status as any, reason: "", confidence: 0.9,
      evidence: "", trace: [], rules: [{ ruleId: "dec.test", profile, status: "accept", confidence: 1, reason: "", evidence: "", triggered: true }], deterministic: true, version: "8.1.3.6", durationMs: 1, errors: [],
    },
  } as unknown as FlightRecord;
}

describe("decision-metrics", () => {
  it("aggregates distribution + rates", () => {
    const records = [rec("accept"), rec("accept"), rec("reject"), rec("retry")];
    const m = computeDecisionMetrics(records);
    expect(m.totalDecisions).toBe(4);
    expect(m.decisionDistribution.accept).toBe(2);
    expect(m.decisionDistribution.reject).toBe(1);
    expect(m.decisionDistribution.retry).toBe(1);
    expect(m.acceptanceRate).toBeCloseTo(0.5);
    expect(m.rejectionRate).toBeCloseTo(0.25);
    expect(m.retryRecommendationRate).toBeCloseTo(0.25);
    expect(m.enterpriseDecisionHealth).toBe(50);
  });

  it("ignores records without a decision block", () => {
    const withDecision = rec("accept");
    const without = { ...withDecision, decision: undefined } as unknown as FlightRecord;
    const m = computeDecisionMetrics([withDecision, without]);
    expect(m.totalDecisions).toBe(1);
  });

  it("per-profile / provider / model decision rate", () => {
    const records = [rec("accept", "ats", "p1", "m1"), rec("reject", "ats", "p1", "m1")];
    const m = computeDecisionMetrics(records);
    expect(m.featureDecisionRate["ats"]).toBeCloseTo(0.5);
    expect(m.providerDecisionRate["p1"]).toBeCloseTo(0.5);
    expect(m.modelDecisionRate["m1"]).toBeCloseTo(0.5);
  });

  it("returns zeros for empty input", () => {
    const m = computeDecisionMetrics([]);
    expect(m.totalDecisions).toBe(0);
    expect(m.acceptanceRate).toBe(0);
    expect(m.enterpriseDecisionHealth).toBe(0);
  });
});
