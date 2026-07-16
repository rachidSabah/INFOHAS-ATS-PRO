// ============================================================================
// Phase 8.1.4 — Explainability tests.
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildExplainability } from "./explainability";
import { buildCandidateIntelligence } from "./candidate-intelligence";
import { makeMemory, makeFlightRecord, makeATSReport, makeReviewReport } from "./fixtures";

describe("buildExplainability", () => {
  const ci = buildCandidateIntelligence({
    memory: makeMemory(),
    records: [makeFlightRecord("accept")],
    atsReport: makeATSReport(),
    reviewReport: makeReviewReport(),
  });
  const root = buildExplainability(ci);

  it("root is the recommendation node with child branches", () => {
    expect(root.kind).toBe("recommendation");
    expect(root.expandable).toBe(true);
    expect(root.children.length).toBeGreaterThan(0);
  });

  it("includes competency evidence children", () => {
    const comps = root.children.find((c) => c.id === "competencies");
    expect(comps).toBeDefined();
    expect(comps!.children.length).toBe(12);
    expect(comps!.children[0].children.length).toBeGreaterThanOrEqual(0);
  });

  it("includes resume / ats / company / decision / flight branches", () => {
    const ids = root.children.map((c) => c.id);
    expect(ids).toContain("resume");
    expect(ids).toContain("ats");
    expect(ids).toContain("company");
    expect(ids).toContain("decision");
    expect(ids).toContain("flight");
  });

  it("is deterministic", () => {
    const a = buildExplainability(ci);
    const b = buildExplainability(ci);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
