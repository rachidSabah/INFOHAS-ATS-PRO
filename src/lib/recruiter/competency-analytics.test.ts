// ============================================================================
// Phase 8.1.4 — Competency Analytics tests.
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildCompetencyAnalytics, benchmarkCompetency } from "./competency-analytics";
import { buildCandidateIntelligence } from "./candidate-intelligence";
import { makeMemory, makeFlightRecord } from "./fixtures";

describe("buildCompetencyAnalytics", () => {
  const ci = buildCandidateIntelligence({ memory: makeMemory(), records: [makeFlightRecord()] });
  const a = buildCompetencyAnalytics(ci);

  it("returns 12 competencies in canonical order", () => {
    expect(a.order.length).toBe(12);
    expect(a.radar.length).toBe(12);
    expect(a.heatmap.length).toBe(12);
  });

  it("score distribution has 5 buckets summing to 12", () => {
    expect(a.scoreDistribution.length).toBe(5);
    expect(a.scoreDistribution.reduce((s, n) => s + n, 0)).toBe(12);
  });

  it("identifies strongest and weakest", () => {
    expect(a.strongest.length).toBeGreaterThan(0);
    expect(a.weakest.length).toBeGreaterThan(0);
  });
});

describe("benchmarkCompetency", () => {
  it("returns percentile within pool", () => {
    expect(benchmarkCompetency(90, [50, 60, 70, 80, 90])).toBe(80);
    expect(benchmarkCompetency(10, [])).toBe(50);
  });
});
