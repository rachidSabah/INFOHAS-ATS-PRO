// ============================================================================
// Phase 8.1.4 — Benchmark tests.
// ============================================================================

import { describe, it, expect } from "vitest";
import { benchmarkCandidates } from "./benchmark";
import { buildCandidateIntelligence } from "./candidate-intelligence";
import { makeMemory, makeFlightRecord } from "./fixtures";

function candidate(resumeId: string, override: Partial<ReturnType<typeof makeMemory>> = {}) {
  const mem = makeMemory();
  mem.resume = { ...mem.resume, id: resumeId };
  return buildCandidateIntelligence({ memory: { ...mem, ...override }, records: [makeFlightRecord()] });
}

describe("benchmarkCandidates", () => {
  const c1 = candidate("r1");
  const c2 = candidate("r2");
  // Make c2High score higher by bumping every competency answer.
  const mem2 = makeMemory();
  mem2.resume = { ...mem2.resume, id: "r3" };
  mem2.answered = mem2.answered.map((a) => ({
    ...a,
    competencies: Object.fromEntries(
      Object.entries(a.competencies).map(([k, v]) => [k, v ? { ...v, score: (v.score ?? 0) + 10 } : v])
    ),
  }));
  const c2High = buildCandidateIntelligence({ memory: mem2, records: [makeFlightRecord()] });

  const result = benchmarkCandidates([c1, c2, c2High], "company");

  it("ranks candidates by interview score descending", () => {
    expect(result.ranking[0].interviewScore).toBeGreaterThanOrEqual(result.ranking[1].interviewScore);
  });

  it("computes percentiles per candidate", () => {
    expect(Object.keys(result.percentiles).length).toBe(3);
    // c2High has the highest interview score → top percentile of the 3-candidate
    // pool (percentileRank = share of pool strictly below = 2/3 → 67).
    const c2HighPct = result.percentiles[c2High.candidate.resumeId ?? ""];
    expect(c2HighPct).toBe(67);
    // Its percentile must be the highest in the cohort.
    expect(Math.max(...Object.values(result.percentiles))).toBe(c2HighPct);
  });

  it("computes cohort average", () => {
    expect(result.cohortAverage.interviewScore).toBeGreaterThanOrEqual(0);
    expect(result.entries.length).toBe(3);
  });

  it("groups by company", () => {
    expect(result.groupBy).toBe("company");
    expect(result.entries.every((e) => e.group === "Luxury Suites Group")).toBe(true);
  });
});
