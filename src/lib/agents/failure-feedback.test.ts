// ============================================================================
// Structured failure feedback tests (item #3) — canonical retry-observation
// block shared by every retry channel. Pure functions.
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildStructuredFailureFeedback } from "./failure-feedback";

describe("buildStructuredFailureFeedback", () => {
  it("builds the canonical block with all failure categories", () => {
    const fb = buildStructuredFailureFeedback({
      stage: "optimizer attempt 2",
      violations: ["experience rewrite count < source count"],
      keywordCoverage: { integrated: 4, total: 12 },
      missingKeywords: ["sql", "dashboards", "aviation"],
      failedChecks: ["STAR method: 2/5 bullets failed"],
      factualIssues: ["Fabricated Employer detected: ACME"],
      layoutIssues: ["Current ATS score 61/100 (formatting 70, keywords 55, content 60)."],
    });

    expect(fb).toMatch(/FAILED STAGE: optimizer attempt 2/);
    expect(fb).toMatch(/CONTRACT VIOLATIONS:/);
    expect(fb).toMatch(/KEYWORD COVERAGE: 4\/12/);
    expect(fb).toMatch(/MISSING KEYWORDS/);
    expect(fb).toMatch(/- sql/);
    expect(fb).toMatch(/FAILED QA CHECKS:/);
    expect(fb).toMatch(/FACTUAL CONSISTENCY ISSUES/);
    expect(fb).toMatch(/LAYOUT ISSUES:/);
    expect(fb).toMatch(/Fix EVERY listed issue/);
  });

  it("returns empty string when there is nothing actionable", () => {
    expect(buildStructuredFailureFeedback({ stage: "x" })).toBe("");
  });

  it("caps the missing-keyword list at 8 entries", () => {
    const fb = buildStructuredFailureFeedback({
      stage: "s",
      missingKeywords: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    });
    expect(fb).toMatch(/- h/);
    expect(fb).not.toMatch(/- i\n/);
  });
});
