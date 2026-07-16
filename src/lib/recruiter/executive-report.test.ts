// ============================================================================
// Phase 8.1.4 — Executive Report tests.
// ============================================================================

import { describe, it, expect } from "vitest";
import { generateExecutiveReport, renderReportMarkdown } from "./executive-report";
import { buildCandidateIntelligence } from "./candidate-intelligence";
import { makeMemory, makeFlightRecord, makeATSReport, makeReviewReport } from "./fixtures";

describe("generateExecutiveReport", () => {
  const ci = buildCandidateIntelligence({
    memory: makeMemory(),
    records: [makeFlightRecord("accept")],
    atsReport: makeATSReport(),
    reviewReport: makeReviewReport(),
  });

  it("produces all required sections", () => {
    const r = generateExecutiveReport(ci);
    expect(r.executiveSummary).toBeTruthy();
    expect(r.candidateSummary).toBeTruthy();
    expect(r.competencies.length).toBe(12);
    expect(r.behaviorAnalysis.length).toBe(16);
    expect(r.strengths.length).toBeGreaterThanOrEqual(0);
    expect(r.weaknesses.length).toBeGreaterThanOrEqual(0);
    expect(r.hiringRecommendation).toBe("hire");
    expect(Array.isArray(r.followUpQuestions)).toBe(true);
    expect(Array.isArray(r.trainingPlan)).toBe(true);
    expect(Array.isArray(r.developmentAreas)).toBe(true);
  });

  it("renders valid markdown", () => {
    const md = renderReportMarkdown(generateExecutiveReport(ci));
    expect(md.startsWith("# Executive Recruiter Report")).toBe(true);
    expect(md).toContain("## Competencies");
    expect(md).toContain("## Hiring Recommendation");
  });
});
