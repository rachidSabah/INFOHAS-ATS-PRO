// ============================================================================
// Phase 8.1.4 — Decision Analytics tests.
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildDecisionAnalytics } from "./decision-analytics";
import { buildCandidateIntelligence } from "./candidate-intelligence";
import { makeMemory, makeFlightRecord, makeDecision } from "./fixtures";

describe("buildDecisionAnalytics", () => {
  it("consumes decision block from a FlightRecord", () => {
    const rec = makeFlightRecord("reject");
    const da = buildDecisionAnalytics({ record: rec });
    expect(da.present).toBe(true);
    expect(da.status).toBe("reject");
    expect(da.trace.length).toBeGreaterThan(0);
    expect(da.rules.length).toBeGreaterThan(0);
  });

  it("accepts a bare decision object", () => {
    const d = makeDecision("accept");
    const da = buildDecisionAnalytics({ decision: d });
    expect(da.status).toBe("accept");
    expect(da.supportingCompetencies).toEqual([]);
  });

  it("attaches supporting competencies from CandidateIntelligence", () => {
    const ci = buildCandidateIntelligence({ memory: makeMemory(), records: [makeFlightRecord()] });
    const da = buildDecisionAnalytics({ record: makeFlightRecord(), ci });
    expect(da.supportingCompetencies.length).toBeGreaterThan(0);
    expect(da.supportingResume).toContain("Resume");
  });

  it("returns present:false when no decision", () => {
    const da = buildDecisionAnalytics({});
    expect(da.present).toBe(false);
    expect(da.trace).toEqual([]);
  });
});
