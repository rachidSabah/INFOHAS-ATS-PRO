// ============================================================================
// Phase 8.1.3.5 — Validation Metrics tests.
//
// Verifies computeValidationMetrics aggregates Validation telemetry from
// FlightRecords correctly: pass/fail/warning rates, average score/time,
// critical-failure rate, rule-failure rate, per-feature/provider/model rates,
// and enterprise health. Records without validation metadata are ignored.
// ============================================================================

import { describe, it, expect } from "vitest";
import type { FlightRecord } from "./flight-recorder";
import { computeValidationMetrics } from "./validation-metrics";

function makeRecord(over: Partial<NonNullable<FlightRecord["validation"]>>): FlightRecord {
  return {
    executionId: "fx",
    timestamp: new Date(0).toISOString(),
    provider: "OpenAI",
    model: "gpt-4",
    streaming: false,
    promptVersion: "8.1.3.5",
    promptHash: "abc",
    contextHash: "def",
    durationMs: 100,
    latencyMs: 90,
    tokenUsage: 10,
    retryCount: 0,
    reflectionEnabled: false,
    qaEnabled: false,
    validationEnabled: true,
    status: "completed",
    warnings: [],
    errors: [],
    prompt: { userPrompt: "x" },
    parameters: {},
    timeline: [],
    performance: { totalMs: 100 },
    cost: { inputTokens: 5, outputTokens: 5, cachedTokens: 0, estimatedCost: 0.001, provider: "OpenAI", model: "gpt-4" },
    scope: "resume-builder",
    validation: {
      validationId: "v",
      enabled: true,
      score: 80,
      outcome: "passed",
      profile: "resume-builder",
      rules: [],
      warnings: [],
      failures: [],
      reasons: [],
      criticalFailures: 0,
      passed: true,
      failRecommended: false,
      deterministic: true,
      version: "8.1.3.5",
      durationMs: 5,
      errors: [],
      ...over,
    },
  } as FlightRecord;
}

describe("computeValidationMetrics", () => {
  it("returns zeroed metrics for an empty / non-validation set", () => {
    const m = computeValidationMetrics([]);
    expect(m.totalValidations).toBe(0);
    expect(m.passRate).toBe(0);
    expect(m.enterpriseValidationHealth).toBe(0);

    const noVal = computeValidationMetrics([{ ...makeRecord({}), validation: undefined, validationEnabled: false } as FlightRecord]);
    expect(noVal.totalValidations).toBe(0);
  });

  it("aggregates pass/fail/warning rates, score, and critical failures", () => {
    const records = [
      makeRecord({ score: 90, outcome: "passed", criticalFailures: 0 }),
      makeRecord({ score: 40, outcome: "failed", criticalFailures: 1, rules: [
        { ruleId: "x", profile: "resume-builder", kind: "critical", outcome: "fail", reason: "r", evidence: "e", severity: "critical" },
        { ruleId: "y", profile: "resume-builder", kind: "required", outcome: "pass", reason: "ok", evidence: "e", severity: "minor" },
      ] }),
    ];
    const m = computeValidationMetrics(records);
    expect(m.totalValidations).toBe(2);
    expect(m.averageValidationScore).toBe(65);
    expect(m.passRate).toBe(0.5);
    expect(m.failureRate).toBe(0.5);
    expect(m.criticalFailureRate).toBe(0.5);
    expect(m.ruleFailureRate).toBe(0.5);
  });

  it("computes per-feature, per-provider, per-model pass rates", () => {
    const records = [
      makeRecord({ profile: "resume-builder", outcome: "passed" }),
      makeRecord({ profile: "ats", outcome: "failed" }),
    ];
    const m = computeValidationMetrics(records);
    expect(m.featureValidationRate["resume-builder"]).toBe(1);
    expect(m.featureValidationRate["ats"]).toBe(0);
    expect(m.providerValidationRate["OpenAI"]).toBe(0.5);
    expect(m.modelValidationRate["gpt-4"]).toBe(0.5);
  });

  it("computes enterprise validation health as passRate * avgScore", () => {
    const records = [makeRecord({ score: 100, outcome: "passed" })];
    const m = computeValidationMetrics(records);
    expect(m.enterpriseValidationHealth).toBe(100);
  });
});
