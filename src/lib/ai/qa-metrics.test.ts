// ============================================================================
// Phase 8.1.3.4 — QA Metrics tests.
//
// Verifies computeQAMetrics aggregates QA telemetry from FlightRecords
// correctly: pass/fail rates, average score/confidence/risks, findings by
// category + severity, and cost/token totals. Records without QA metadata are
// ignored. Mirrors the Reflection Metrics test layout.
// ============================================================================

import { describe, it, expect } from "vitest";
import type { FlightRecord } from "./flight-recorder";
import { computeQAMetrics } from "./qa-metrics";

function makeRecord(over: Partial<NonNullable<FlightRecord["qa"]>>): FlightRecord {
  return {
    executionId: "fx",
    timestamp: new Date(0).toISOString(),
    provider: "OpenAI",
    model: "gpt-4",
    streaming: false,
    promptVersion: "8.1.3.4",
    promptHash: "abc",
    contextHash: "def",
    durationMs: 100,
    latencyMs: 90,
    tokenUsage: 10,
    retryCount: 0,
    reflectionEnabled: false,
    qaEnabled: true,
    status: "completed",
    warnings: [],
    errors: [],
    prompt: { userPrompt: "x" },
    parameters: {},
    timeline: [],
    performance: { totalMs: 100 },
    cost: { inputTokens: 5, outputTokens: 5, cachedTokens: 0, estimatedCost: 0.001, provider: "OpenAI", model: "gpt-4" },
    scope: "resume-optimizer",
    qa: {
      qaId: "q",
      enabled: true,
      score: 80,
      confidence: 90,
      outcome: "passed",
      summary: "ok",
      findings: [],
      hallucinationRisk: 0.1,
      policyRisk: 0.0,
      incompletenessRisk: 0.1,
      passed: true,
      failRecommended: false,
      failReason: "",
      promptVersion: "8.1.3.4",
      ...over,
    },
  } as FlightRecord;
}

describe("computeQAMetrics", () => {
  it("returns zeroed metrics for an empty / non-QA set", () => {
    const m = computeQAMetrics([]);
    expect(m.totalQA).toBe(0);
    expect(m.averageQAScore).toBe(0);
    expect(m.passRate).toBe(0);
    expect(m.failRate).toBe(0);

    const noQa = computeQAMetrics([{ ...makeRecord({}), qa: undefined, qaEnabled: false } as FlightRecord]);
    expect(noQa.totalQA).toBe(0);
  });

  it("aggregates pass rate, score, confidence, and risks", () => {
    const records = [
      makeRecord({ score: 90, confidence: 95, outcome: "passed", hallucinationRisk: 0.1, policyRisk: 0.0, incompletenessRisk: 0.1 }),
      makeRecord({ score: 50, confidence: 60, outcome: "failed", failRecommended: true, hallucinationRisk: 0.4, policyRisk: 0.2, incompletenessRisk: 0.5 }),
    ];
    const m = computeQAMetrics(records);
    expect(m.totalQA).toBe(2);
    expect(m.averageQAScore).toBe(70);
    expect(m.averageConfidence).toBe(77.5);
    expect(m.passRate).toBe(0.5);
    expect(m.failRate).toBe(0.5);
    expect(m.averageHallucinationRisk).toBe(0.25);
    expect(m.averagePolicyRisk).toBe(0.1);
    expect(m.averageIncompletenessRisk).toBe(0.3);
  });

  it("groups findings by category and severity", () => {
    const records = [
      makeRecord({
        findings: [
          { category: "factual", description: "a", severity: "critical" },
          { category: "format", description: "b", severity: "minor" },
        ],
      }),
      makeRecord({
        findings: [{ category: "factual", description: "c", severity: "major" }],
      }),
    ];
    const m = computeQAMetrics(records);
    expect(m.findingsByCategory.factual).toBe(2);
    expect(m.findingsByCategory.format).toBe(1);
    expect(m.findingsBySeverity.critical).toBe(1);
    expect(m.findingsBySeverity.major).toBe(1);
    expect(m.findingsBySeverity.minor).toBe(1);
  });

  it("sums cost and tokens", () => {
    const records = [
      makeRecord({ cost: 0.01, tokens: 100 }),
      makeRecord({ cost: 0.02, tokens: 200 }),
    ];
    const m = computeQAMetrics(records);
    expect(m.qaCost).toBeCloseTo(0.03, 5);
    expect(m.qaTokenUsage).toBe(300);
  });
});
