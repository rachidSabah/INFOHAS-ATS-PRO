// ============================================================================
// Pipeline Adapter Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { makePipelineSteps, buildPipelineDefinition } from "./pipeline-adapter";
import { createPlan } from "./pipeline-planner";
import { validatePipelineDefinition } from "./pipeline-coordinator";
import type { JobDescription } from "../types";
import type { ResumeData } from "../types";

function makeJD(): JobDescription {
  return {
    id: "jd-test",
    title: "Software Engineer",
    company: "Tech Corp",
    keywords: ["TypeScript", "React"],
    rawText: "We need a software engineer with TypeScript and React experience.",
    responsibilities: ["Build apps"],
    requiredSkills: ["TypeScript"],
    preferredSkills: ["React"],
    technologies: ["TypeScript", "React"],
    createdAt: new Date().toISOString(),
  };
}

function makeResume(): ResumeData {
  return {
    id: "r-test",
    name: "Jane Doe",
    headline: "Software Engineer",
    summary: "Experienced engineer.",
    contact: { email: "jane@test.com", phone: "+15551234567", location: "US", linkedin: "", website: "" },
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    languages: [],
    template: "ats-professional",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("makePipelineSteps", () => {
  it("produces all steps for a full plan", async () => {
    const jd = makeJD();
    const resume = makeResume();
    const plan = await createPlan({ resumeText: "Jane Doe", jd });

    const steps = makePipelineSteps(plan, resume, jd);

    // Should include all enabled steps
    expect(steps.length).toBeGreaterThanOrEqual(3); // ats-before + optimizer + qa minimum
    expect(steps.some((s) => s.id === "ats-before")).toBe(true);
    expect(steps.some((s) => s.id === "optimizer")).toBe(true);
    expect(steps.some((s) => s.id === "qa")).toBe(true);
  });

  it("includes company intel when enabled", async () => {
    const jd = makeJD();
    const resume = makeResume();
    const plan = await createPlan({
      resumeText: "Jane Doe",
      jd,
      employer: "Tech Corp",
    });

    const steps = makePipelineSteps({ ...plan, enableCompanyIntelligence: true }, resume, jd);
    expect(steps.some((s) => s.id === "company-intel")).toBe(true);
  });

  it("includes skill gap when enabled", async () => {
    const jd = makeJD();
    const resume = makeResume();
    const plan = await createPlan({ resumeText: "Jane Doe", jd });
    const steps = makePipelineSteps({ ...plan, enableSkillGap: true }, resume, jd);
    expect(steps.some((s) => s.id === "skill-gap")).toBe(true);
  });

  it("includes reflection when enabled", async () => {
    const jd = makeJD();
    const resume = makeResume();
    const plan = await createPlan({ resumeText: "Jane Doe", jd });
    const steps = makePipelineSteps({ ...plan, enableReflection: true }, resume, jd);
    expect(steps.some((s) => s.id === "reflection")).toBe(true);
  });

  it("sets correct dependencies between steps", async () => {
    const jd = makeJD();
    const resume = makeResume();
    const plan = await createPlan({ resumeText: "Jane Doe", jd });

    const steps = makePipelineSteps({ ...plan, enableCompanyIntelligence: true }, resume, jd);

    // Check optimizer depends on ats-before
    const optimizer = steps.find((s) => s.id === "optimizer");
    expect(optimizer).toBeDefined();
    expect(optimizer!.dependencies).toContain("ats-before");

    // Check QA depends on optimizer
    const qa = steps.find((s) => s.id === "qa");
    expect(qa).toBeDefined();
    expect(qa!.dependencies).toContain("optimizer");
  });

  it("each step has all required PipelineStep fields", async () => {
    const jd = makeJD();
    const resume = makeResume();
    const plan = await createPlan({ resumeText: "Jane Doe", jd });
    const steps = makePipelineSteps(plan, resume, jd);

    for (const step of steps) {
      expect(step.id).toBeDefined();
      expect(typeof step.id).toBe("string");
      expect(step.label).toBeDefined();
      expect(typeof step.label).toBe("string");
      expect(Array.isArray(step.dependencies)).toBe(true);
      expect(typeof step.execute).toBe("function");
      if (step.timeout) expect(step.timeout).toBeGreaterThan(0);
    }
  });
});

describe("buildPipelineDefinition", () => {
  it("returns a valid pipeline definition", async () => {
    const jd = makeJD();
    const resume = makeResume();
    const plan = await createPlan({ resumeText: "Jane Doe", jd });

    const def = await buildPipelineDefinition(plan, resume, jd);

    expect(def.id).toBeDefined();
    expect(def.steps.length).toBeGreaterThan(0);
    expect(def.id).toContain("pipeline-");
  });

  it("passes coordinator validation", async () => {
    const jd = makeJD();
    const resume = makeResume();
    const plan = await createPlan({ resumeText: "Jane Doe", jd });
    const def = { id: "test", steps: makePipelineSteps(plan, resume, jd) };

    const errors = validatePipelineDefinition(def);
    expect(errors).toEqual([]);
  });
});
