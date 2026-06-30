// ============================================================================
// Pipeline Planner Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { createPlan, type PipelinePlan } from "./pipeline-planner";
import type { JobDescription } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jd(overrides?: Partial<JobDescription>): JobDescription {
  return {
    id: "jd-1",
    title: "Software Engineer",
    company: "Acme Corp",
    rawText: "We are hiring a software engineer. JavaScript React Node.js TypeScript",
    keywords: ["software", "engineer", "react", "typescript"],
    responsibilities: [],
    requiredSkills: [],
    preferredSkills: [],
    technologies: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createPlan
// ---------------------------------------------------------------------------

describe("createPlan", () => {
  it("detects non-aviation industry", async () => {
    const plan = await createPlan({
      resumeText: "John Doe — Senior Developer",
      jd: jd(),
    });
    expect(plan.industryId).not.toBe("");
    expect(plan.isAviation).toBe(false);
    expect(plan.aviationMode).toBeUndefined();
  });

  it("detects aviation industry when JD contains aviation keywords", async () => {
    const plan = await createPlan({
      resumeText: "Jane Smith — Cabin Crew",
      jd: jd({
        rawText: "Hiring experienced cabin crew for international flights. Customer service, safety procedures, first aid.",
        keywords: ["cabin crew", "flight attendant", "aviation"],
      }),
    });
    expect(plan.isAviation).toBe(true);
    expect(plan.aviationMode).toBeDefined();
    expect(plan.aviationMode!.airlineProfile).toBeDefined();
  });

  it("always enables reflection", async () => {
    const plan = await createPlan({
      resumeText: "John Doe — Developer",
      jd: jd(),
    });
    expect(plan.enableReflection).toBe(true);
  });

  it("always enables company intelligence", async () => {
    const plan = await createPlan({
      resumeText: "John Doe — Developer",
      jd: jd(),
    });
    expect(plan.enableCompanyIntelligence).toBe(true);
  });

  it("always enables skill gap", async () => {
    const plan = await createPlan({
      resumeText: "John Doe — Developer",
      jd: jd(),
    });
    expect(plan.enableSkillGap).toBe(true);
  });

  it("produces a summary string", async () => {
    const plan = await createPlan({
      resumeText: "John Doe — Developer",
      jd: jd(),
    });
    expect(plan.summary).toContain("Industry:");
    expect(plan.summary).toContain("Aviation mode:");
  });

  it("sets a reasonable timeout", async () => {
    const plan = await createPlan({
      resumeText: "John Doe — Developer",
      jd: jd(),
    });
    expect(plan.timeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(plan.timeoutMs).toBeLessThanOrEqual(300_000);
  });

  it("handles empty resume text gracefully", async () => {
    const plan = await createPlan({
      resumeText: "",
      jd: jd(),
    });
    expect(plan.industryId).toBeDefined();
  });

  it("handles empty JD text gracefully", async () => {
    const plan = await createPlan({
      resumeText: "John Doe — Developer",
      jd: jd({ rawText: "", keywords: [] }),
    });
    expect(plan.industryId).toBeDefined();
  });
});
