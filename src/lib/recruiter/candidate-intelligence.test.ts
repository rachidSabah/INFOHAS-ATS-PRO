// ============================================================================
// Phase 8.1.4 — Candidate Intelligence tests.
// Verifies the single read-model builder: competency reuse, behavioral derivation,
// company match, decision/reflection/qa/validation surfacing, dashboard, and
// determinism. No AI — fixtures use real shapes.
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildCandidateIntelligence, buildRecruiterDashboard, percentileRank } from "./candidate-intelligence";
import { makeMemory, makeFlightRecord, makeATSReport, makeReviewReport } from "./fixtures";
import type { InterviewIntelligenceInput } from "./recruiter-types";
import type { CompetencyKey, CompetencyScore } from "@/lib/interview/adaptive";

describe("buildCandidateIntelligence", () => {
  const input: InterviewIntelligenceInput = {
    memory: makeMemory(),
    records: [makeFlightRecord("accept")],
    atsReport: makeATSReport(),
    reviewReport: makeReviewReport(),
  };

  it("produces a CandidateIntelligence with all competency keys", () => {
    const ci = buildCandidateIntelligence(input);
    const keys = Object.keys(ci.competencySummary);
    expect(keys.length).toBe(12);
    expect(ci.overall).toBeGreaterThan(0);
    expect(ci.employerPassLikelihood).toBeGreaterThan(0);
  });

  it("reuses existing competency aggregation (no regeneration)", () => {
    const ci = buildCandidateIntelligence(input);
    // leadership was set to 85 in fixture answered[0]; aggregate should reflect.
    expect(ci.competencySummary.leadership.score).toBeGreaterThan(0);
    expect(ci.competencySummary.technicalKnowledge.score).toBeGreaterThan(0);
  });

  it("derives 16 behavioral dimensions from competencies", () => {
    const ci = buildCandidateIntelligence(input);
    expect(Object.keys(ci.behavior.behaviors).length).toBe(16);
    expect(ci.behavior.overall).toBeGreaterThanOrEqual(0);
    expect(ci.behavior.overall).toBeLessThanOrEqual(100);
  });

  it("builds company match from CompanyProfile", () => {
    const ci = buildCandidateIntelligence(input);
    expect(ci.companyMatch).not.toBeNull();
    expect(ci.companyMatch!.company).toBe("Luxury Suites Group");
    expect(ci.companyMatch!.overallCompanyReadiness).toBeGreaterThanOrEqual(0);
    expect(ci.companyMatch!.overallCompanyReadiness).toBeLessThanOrEqual(100);
  });

  it("surfaces decision/reflection/qa/validation from FlightRecord (never regenerates)", () => {
    const ci = buildCandidateIntelligence(input);
    expect(ci.decision.status).toBe("accept");
    expect(ci.reflection.outcome).toBe("ok");
    expect(ci.qa.outcome).toBe("passed");
    expect(ci.validation.outcome).toBe("passed");
  });

  it("surfaces resume + ats summaries from reports", () => {
    const ci = buildCandidateIntelligence(input);
    expect(ci.resume.present).toBe(true);
    expect(ci.ats.present).toBe(true);
    expect(ci.ats.jdMatchPercent).toBe(78);
  });

  it("generates follow-up questions from weaknesses/adaptive followups", () => {
    const ci = buildCandidateIntelligence(input);
    expect(Array.isArray(ci.followUpQuestions)).toBe(true);
  });

  it("is deterministic (same input → same overall)", () => {
    const a = buildCandidateIntelligence(input);
    const b = buildCandidateIntelligence(input);
    expect(a.overall).toBe(b.overall);
    expect(a.competencySummary.leadership.score).toBe(b.competencySummary.leadership.score);
  });

  it("handles package-only input without crashing", () => {
    const ci = buildCandidateIntelligence({ package: { id: "p1", questions: [], createdAt: new Date().toISOString() } });
    expect(ci.interview.present).toBe(true);
    expect(ci.overall).toBe(0);
  });

  it("handles empty input gracefully", () => {
    const ci = buildCandidateIntelligence({});
    expect(ci.overall).toBe(0);
    expect(ci.competencySummary.leadership.score).toBe(0);
  });
});

describe("buildRecruiterDashboard", () => {
  it("derives recommendation from decision + overall", () => {
    const ci = buildCandidateIntelligence({ memory: makeMemory(), records: [makeFlightRecord("accept")] });
    const dash = buildRecruiterDashboard(ci);
    // makeMemory() alone yields overall ~47 (interview only, 50% weight) → hold.
    expect(dash.hiringRecommendation).toBe("hold");
    expect(dash.interviewScore).toBeGreaterThanOrEqual(0);
    expect(dash.overallRisk).toBeGreaterThanOrEqual(0);
    expect(dash.completionRate).toBe(1);
  });

  it("derives strong_hire when overall >= 80 (boosted interview scores)", () => {
    const mem = makeMemory();
    // Raise every answered question's competency scores so the recomputed
    // interview overall crosses the strong_hire threshold (>= 80).
    for (const a of mem.answered) {
      a.overallScore = 95;
      for (const k of Object.keys(a.competencies) as CompetencyKey[]) {
        const prev = a.competencies[k] as CompetencyScore;
        a.competencies[k] = { ...prev, score: 95 };
      }
    }
    const ci = buildCandidateIntelligence({ memory: mem, records: [makeFlightRecord("accept")], atsReport: makeATSReport(), reviewReport: makeReviewReport() });
    expect(ci.overall).toBeGreaterThanOrEqual(80);
    expect(buildRecruiterDashboard(ci).hiringRecommendation).toBe("strong_hire");
  });

  it("reject decision yields reject recommendation", () => {
    const ci = buildCandidateIntelligence({ memory: makeMemory(), records: [makeFlightRecord("reject")] });
    const dash = buildRecruiterDashboard(ci);
    expect(dash.hiringRecommendation).toBe("reject");
  });
});

describe("percentileRank", () => {
  it("computes percentile within a pool", () => {
    expect(percentileRank(50, [10, 20, 30, 40, 50])).toBe(80);
    expect(percentileRank(5, [])).toBe(50);
  });
});
