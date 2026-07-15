// ============================================================================
// Phase 8.1.3.3 — Enterprise Reflection Metrics tests.
//
// Verifies the pure, read-side aggregation over FlightRecords: pass/retry
// rates, average score/time, hallucination + compliance proxies, confidence
// distribution, and that records without reflection are ignored.
// ============================================================================

import { describe, it, expect } from "vitest";
import { computeReflectionMetrics } from "./reflection-metrics";
import type { FlightRecord } from "./flight-recorder";

function rec(over: Partial<NonNullable<FlightRecord["reflection"]>> & { enabled?: boolean }): FlightRecord {
  const { enabled, ...reflOver } = over;
  const isEnabled = enabled ?? true;
  const reflection = isEnabled
    ? {
        reflectionId: "r1",
        enabled: true,
        score: 0,
        confidence: 0,
        outcome: "ok" as const,
        summary: "",
        strengths: [],
        weaknesses: [],
        missingInformation: [],
        instructionViolations: [],
        formatViolations: [],
        reasoningIssues: [],
        hallucinationRisk: 0,
        determinismRisk: 0,
        suggestedActions: [],
        retryRecommended: false,
        retryReason: "",
        promptVersion: "8.1.3.3",
        errors: [],
        ...reflOver,
      }
    : undefined;
  return {
    executionId: "fx",
    timestamp: new Date().toISOString(),
    provider: "p",
    model: "m",
    temperature: 0.5,
    maxTokens: 100,
    streaming: false,
    promptVersion: "8.1.3.3",
    promptHash: "abc",
    contextHash: "def",
    durationMs: 10,
    latencyMs: 10,
    tokenUsage: 5,
    retryCount: 0,
    reflectionEnabled: enabled,
    qaEnabled: false,
    status: "completed",
    warnings: [],
    errors: [],
    prompt: { userPrompt: "x" },
    parameters: {},
    timeline: [],
    performance: { totalMs: 10 },
    cost: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, estimatedCost: 0, provider: "p", model: "m" },
    scope: "other",
    reflection,
  } as FlightRecord;
}

describe("computeReflectionMetrics", () => {
  it("returns zeros when no reflection was run", () => {
    const m = computeReflectionMetrics([rec({ enabled: false })]);
    expect(m.totalReflections).toBe(0);
    expect(m.averageReflectionScore).toBe(0);
    expect(m.reflectionPassRate).toBe(0);
  });

  it("computes pass/retry rates, averages, and compliance proxies", () => {
    const m = computeReflectionMetrics([
      rec({ score: 90, confidence: 95, outcome: "ok", hallucinationRisk: 0.1, instructionViolations: [], formatViolations: [], durationMs: 100, cost: 0.01, tokens: 30 }),
      rec({ score: 40, confidence: 50, outcome: "retry", retryRecommended: true, hallucinationRisk: 0.8, instructionViolations: ["missed instruction"], formatViolations: ["bad json"], durationMs: 200, cost: 0.02, tokens: 40 }),
    ]);
    expect(m.totalReflections).toBe(2);
    expect(m.averageReflectionScore).toBe(65);
    expect(m.averageReflectionTime).toBe(150);
    expect(m.reflectionPassRate).toBeCloseTo(0.5);
    expect(m.reflectionRetryRate).toBeCloseTo(0.5);
    expect(m.averageHallucinationRisk).toBeCloseTo(0.45);
    expect(m.instructionComplianceRate).toBeCloseTo(0.5);
    expect(m.formattingComplianceRate).toBeCloseTo(0.5);
    expect(m.averageConfidence).toBe(72.5);
    expect(m.reflectionCost).toBeCloseTo(0.03);
    expect(m.reflectionTokenUsage).toBe(70);
    expect(m.confidenceDistribution.reduce((a, b) => a + b, 0)).toBe(2);
  });
});
