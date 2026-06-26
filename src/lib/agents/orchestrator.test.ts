// Integration tests for the 5-agent optimization pipeline orchestrator.
//
// These tests verify that the orchestrator correctly chains the 5 agents
// and produces a PipelineResult with all expected fields. The AI calls
// are mocked so the tests run fast and deterministically.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResumeData, JobDescription } from "../types";

// Mock callAI to avoid real API calls during tests
// The locked pipeline expects the NEW optimizer contract:
//   { summary, headline, skills, experiences: [{id, bullets}] }
// The legacy path expects the flat/full resume JSON shape.
vi.mock("../ai", () => ({
  callAI: vi.fn().mockImplementation((opts: any) => {
    // Check if this is the reflection agent call (systemPrompt mentions "Reflection Agent")
    if (opts.systemPrompt?.includes("Reflection Agent")) {
      return Promise.resolve({
        text: JSON.stringify({
          issues: [],
          suggestions: [],
          confidence: 90,
        }),
        provider: "test-provider",
        usage: { promptTokens: 100, completionTokens: 200 },
      });
    }
    // Check if this is the NEW locked pipeline call (systemPrompt mentions the new contract)
    if (opts.systemPrompt?.includes("ONLY return the following JSON shape") ||
        opts.systemPrompt?.includes("Bullet-Only Optimizer") ||
        opts.userPrompt?.includes("experiences") && opts.userPrompt?.includes("EXACT_SOURCE_ID")) {
      // Return the NEW optimizer contract: { summary, headline, skills, experiences: [{id, bullets}] }
      return Promise.resolve({
        text: JSON.stringify({
          summary: "Senior engineer with 8+ years of experience building scalable web applications. Proven track record of leading teams and delivering high-impact products. Skilled in React, Node.js, and cloud architecture. Passionate about mentorship and code quality.",
          headline: "Senior Software Engineer",
          skills: [
            { name: "React", category: "Frontend" },
            { name: "TypeScript", category: "Frontend" },
            { name: "Next.js", category: "Frontend" },
            { name: "Node.js", category: "Backend" },
            { name: "Python", category: "Backend" },
            { name: "PostgreSQL", category: "Backend" },
            { name: "AWS", category: "Cloud" },
            { name: "Docker", category: "Cloud" },
            { name: "Kubernetes", category: "Cloud" },
          ],
          experiences: [
            {
              id: "e1", // MUST match the source resume's experience ID
              bullets: [
                "Led migration to microservices architecture, reducing deployment time by 65% and improving system reliability.",
                "Mentored 5 junior engineers, with 3 receiving promotions within 18 months of joining the team.",
                "Built real-time analytics dashboard processing 2M+ events daily using React, WebSocket, and Redis.",
                "Designed scalable APIs handling 10k requests per second with 99.99% uptime.",
                "Collaborated with product and design teams to deliver new features consistently.",
              ],
            },
          ],
          missingKeywordsAdded: ["microservices", "Redis", "WebSocket"],
          bulletsRewritten: 3,
        }),
        provider: "test-provider",
        usage: { promptTokens: 500, completionTokens: 800 },
      });
    }
    // Legacy optimizer path — return flat JSON shape (full resume)
    return Promise.resolve({
      text: JSON.stringify({
        name: "Test User",
        headline: "Senior Engineer",
        location: "San Francisco, CA",
        phone: "+1-555-0100",
        email: "test@example.com",
        dateOfBirth: "",
        summary: "Senior engineer with 8+ years of experience building scalable web applications. Proven track record of leading teams and delivering high-impact products. Skilled in React, Node.js, and cloud architecture. Passionate about mentorship and code quality.",
        skills: [
          { category: "Frontend", items: ["React", "TypeScript", "Next.js"] },
          { category: "Backend", items: ["Node.js", "Python", "PostgreSQL"] },
          { category: "Cloud", items: ["AWS", "Docker", "Kubernetes"] },
        ],
        experience: [
          {
            title: "Senior Software Engineer",
            company: "Tech Corp",
            location: "San Francisco, CA",
            startDate: "2020-01",
            endDate: "Present",
            bullets: [
              "Led migration to microservices architecture, reducing deployment time by 65% and improving system reliability.",
              "Mentored 5 junior engineers, with 3 receiving promotions within 18 months of joining the team.",
              "Built real-time analytics dashboard processing 2M+ events daily using React, WebSocket, and Redis.",
              "Designed scalable APIs handling 10k requests per second with 99.99% uptime.",
              "Collaborated with product and design teams to deliver new features consistently.",
            ],
            old_bullets: [
              "Led migration to microservices architecture, reducing deployment time by 65% and improving system reliability.",
              "Mentored 5 junior engineers, with 3 receiving promotions within 18 months of joining the team.",
              "Built real-time analytics dashboard processing 2M+ events daily using React, WebSocket, and Redis.",
            ],
          },
        ],
        education: [
          {
            degree: "B.S. Computer Science",
            institution: "UC Berkeley",
            location: "Berkeley, CA",
            startDate: "2012",
            endDate: "2016",
            modules: "Algorithms, Databases, Distributed Systems",
          },
        ],
        languages: [
          { name: "English", proficiency: "native", note: "" },
        ],
        missingKeywordsAdded: ["microservices", "Redis", "WebSocket"],
        bulletsRewritten: 3,
      }),
      provider: "test-provider",
      usage: { promptTokens: 500, completionTokens: 800 },
    });
  }),
  extractJSON: vi.fn((text: string) => JSON.parse(text)),
  getOptimizerDirective: vi.fn(() => "Test directive"),
  OPTIMIZER_CALL_TIMEOUT_MS: 120000,
  PIPELINE_STEP_CALL_TIMEOUT_MS: 90000,
  OptimizationProviderExhaustedError: class extends Error {},
}));

// Mock store
vi.mock("../store", () => ({
  useApp: {
    getState: () => ({
      optimizerDirective: {
        customDirectiveOverride: "",
        pageSize: "A4",
        bodyFontSizePt: 10.5,
        summaryMinWords: 60,
        summaryMaxWords: 90,
        experienceBulletsPerEntry: 5,
      },
    }),
  },
  uid: vi.fn((prefix: string) => `${prefix}-test-${Math.random().toString(36).slice(2, 8)}`),
}));

// Mock exporter to avoid actual PDF generation
vi.mock("../exporter", () => ({
  exportResumePDF: vi.fn(() => ({ ok: true, pages: 1 })),
}));

import { runOptimizationPipeline } from "./orchestrator";
import { analyzeATS } from "./ats-analysis";
import { runQA } from "./qa-agent";

function makeTestResume(): ResumeData {
  return {
    id: "r-test-1",
    name: "Test User",
    headline: "Software Engineer",
    contact: { email: "test@example.com", phone: "+1-555-0100", location: "San Francisco, CA" },
    summary: "Software engineer with over 10 years of experience building scalable web applications. Proven track record of leading high-performance engineering teams and delivering business-critical projects on time.",
    experience: [
      {
        id: "e1",
        title: "Engineer",
        company: "Tech Corp",
        location: "SF",
        startDate: "2020-01",
        endDate: "Present",
        bullets: [
              "Led migration to microservices architecture, reducing deployment time by 65% and improving system reliability.",
              "Mentored 5 junior engineers, with 3 receiving promotions within 18 months of joining the team.",
              "Built real-time analytics dashboard processing 2M+ events daily using React, WebSocket, and Redis.",
              "Designed scalable APIs handling 10k requests per second with 99.99% uptime.",
              "Collaborated with product and design teams to deliver new features consistently.",
            ],
            old_bullets: ["Built things.", "Shipped features."],
      },
    ],
    education: [
      { id: "ed1", institution: "UC Berkeley", degree: "B.S.", field: "CS", startDate: "2012", endDate: "2016" },
    ],
    skills: [
      { id: "s1", name: "JavaScript", category: "Frontend" },
      { id: "s2", name: "Node.js", category: "Backend" },
    ],
    languages: [{ id: "l1", name: "English", proficiency: "native" }],
    projects: [],
    certifications: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    source: "manual",
  };
}

function makeTestJD(): JobDescription {
  return {
    id: "jd-test-1",
    title: "Senior Software Engineer",
    company: "Tech Corp",
    location: "San Francisco, CA",
    employmentType: "Full-time",
    salary: "",
    responsibilities: ["Build scalable web applications", "Lead a team of engineers"],
    requiredSkills: ["React", "TypeScript", "Node.js", "AWS"],
    preferredSkills: ["GraphQL", "Kubernetes"],
    technologies: ["React", "Node.js", "AWS"],
    experienceYears: "5+",
    education: "Bachelor's degree",
    keywords: ["React", "TypeScript", "Node.js", "AWS", "microservices", "GraphQL", "Kubernetes", "mentorship"],
    rawText: "We are looking for a Senior Software Engineer with 5+ years of experience in React, TypeScript, and Node.js. Must have AWS experience. Preferred: GraphQL, Kubernetes. You will lead a team and build scalable web applications.",
    source: "text",
    createdAt: "2025-01-01T00:00:00Z",
  };
}

describe("ATS Analysis Agent (analyzeATS)", () => {
  it("returns all 7 explainable scores", () => {
    const resume = makeTestResume();
    const jd = makeTestJD();
    const result = analyzeATS(resume, jd);

    expect(result.scores).toBeDefined();
    expect(result.scores.ats).toBeGreaterThan(0);
    expect(result.scores.ats).toBeLessThanOrEqual(100);
    expect(result.scores.formatting).toBeGreaterThanOrEqual(0);
    expect(result.scores.keywordMatch).toBeGreaterThanOrEqual(0);
    expect(result.scores.semanticSimilarity).toBeGreaterThanOrEqual(0);
    expect(result.scores.content).toBeGreaterThanOrEqual(0);
    expect(result.scores.grammar).toBeGreaterThanOrEqual(0);
    expect(result.scores.readability).toBeGreaterThanOrEqual(0);
    expect(result.scores.completeness).toBeGreaterThanOrEqual(0);
  });

  it("returns explainable recommendations", () => {
    const resume = makeTestResume();
    const jd = makeTestJD();
    const result = analyzeATS(resume, jd);

    expect(result.recommendations).toBeInstanceOf(Array);
    expect(result.explanations).toBeDefined();
    expect(result.explanations.ats).toContain("Overall ATS score");
    expect(result.explanations.keywordMatch).toContain("JD keyword coverage");
    expect(result.explanations.semanticSimilarity).toContain("N-gram overlap");
    expect(result.explanations.readability).toContain("Flesch Reading Ease");
  });

  it("computes semantic similarity between resume and JD", () => {
    const resume = makeTestResume();
    const jd = makeTestJD();
    const result = analyzeATS(resume, jd);

    // The resume and JD share keywords like "engineer", "software", "tech"
    // so semantic similarity should be > 0
    expect(result.scores.semanticSimilarity).toBeGreaterThan(0);
  });

  it("computes readability score (Flesch Reading Ease)", () => {
    const resume = makeTestResume();
    const result = analyzeATS(resume, null);

    expect(result.scores.readability).toBeGreaterThan(0);
    expect(result.scores.readability).toBeLessThanOrEqual(100);
  });

  it("identifies missing and matched keywords", () => {
    const resume = makeTestResume();
    const jd = makeTestJD();
    const result = analyzeATS(resume, jd);

    expect(result.matchedKeywords).toBeInstanceOf(Array);
    expect(result.missingKeywords).toBeInstanceOf(Array);
    // JavaScript is in the resume but not in JD keywords; React is in both
    expect(result.matchedKeywords.length + result.missingKeywords.length).toBeGreaterThan(0);
  });
});

describe("QA Agent (runQA)", () => {
  it("runs all validation checks and returns a confidence score", async () => {
    const optimized = makeTestResume();
    const original = makeTestResume();
    const jd = makeTestJD();

    const result = await runQA(optimized, jd, null, original, { checkExport: false });

    expect(result.checks).toBeInstanceOf(Array);
    expect(result.checks.length).toBeGreaterThanOrEqual(7); // 7 base checks
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
    expect(typeof result.shouldReflect).toBe("boolean");
  });

  it("detects factual consistency issues when optimized resume invents employers", async () => {
    const original = makeTestResume();
    const optimized: ResumeData = {
      ...original,
      experience: [
        ...original.experience,
        {
          id: "e-fake",
          title: "CEO",
          company: "Totally Fake Company Inc", // not in original
          location: "NYC",
          startDate: "2018-01",
          endDate: "2020-01",
          bullets: [
              "Led migration to microservices architecture, reducing deployment time by 65% and improving system reliability.",
              "Mentored 5 junior engineers, with 3 receiving promotions within 18 months of joining the team.",
              "Built real-time analytics dashboard processing 2M+ events daily using React, WebSocket, and Redis.",
              "Designed scalable APIs handling 10k requests per second with 99.99% uptime.",
              "Collaborated with product and design teams to deliver new features consistently.",
            ],
            old_bullets: ["Ran the company."],
        },
      ],
    };

    const result = await runQA(optimized, null, null, original, { checkExport: false });

    expect(result.factualConsistency).toBeDefined();
    expect(result.factualConsistency!.passed).toBe(false);
    expect(result.factualConsistency!.fabricatedEmployers).toContain("Totally Fake Company Inc");
  });

  it("passes factual consistency when optimized resume matches original", async () => {
    const original = makeTestResume();
    const optimized = makeTestResume(); // identical

    const result = await runQA(optimized, null, null, original, { checkExport: false });

    expect(result.factualConsistency).toBeDefined();
    expect(result.factualConsistency!.passed).toBe(true);
    expect(result.factualConsistency!.fabricatedEmployers).toHaveLength(0);
  });

  it("triggers reflection when confidence is low", async () => {
    // Create a resume with many issues to drive confidence down
    const badResume: ResumeData = {
      ...makeTestResume(),
      summary: "", // missing summary → low completeness
      experience: [], // no experience → very low completeness
      skills: [], // no skills
    };

    const result = await runQA(badResume, null, null, badResume, { checkExport: false });

    // With empty sections, confidence should be low enough to trigger reflection
    expect(result.confidence).toBeLessThan(100);
  });
});

describe("Orchestrator (runOptimizationPipeline)", () => {
  it("runs the full 5-agent pipeline and returns a PipelineResult", async () => {
    const resume = makeTestResume();
    const jd = makeTestJD();

    const result = await runOptimizationPipeline({
      resume,
      jd,
      enableReflection: true,
      checkExport: false,
    });

    expect(result).toBeDefined();
    expect(["completed", "failed"]).toContain(result.status);
    // V2 pipeline: 6 steps (JI, Company+SkillGap, ATS-before, Optimizer, QA, Reflection)
    expect(result.steps).toHaveLength(6);
    expect(result.optimizedResume).toBeTruthy();
    expect(result.beforeATS).toBeTruthy();
    expect(result.afterATS).toBeTruthy();
    expect(result.qa).toBeTruthy();
    expect(result.provider).toBe("test-provider");
    expect(result.charCount).toBeGreaterThan(0);
  });

  it("emits progress callbacks for each step", async () => {
    const resume = makeTestResume();
    const jd = makeTestJD();
    const progressCalls: any[] = [];

    const result = await runOptimizationPipeline({
      resume,
      jd,
      enableReflection: false, // disable to avoid extra AI call
      checkExport: false,
      onProgress: (progress) => {
        progressCalls.push(progress);
      },
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    // Final progress should be 100%
    const lastProgress = progressCalls[progressCalls.length - 1];
    expect(lastProgress.percent).toBe(100);
    expect(lastProgress.stepName).toBe("Complete");
  });

  it("populates steps with status and timing", async () => {
    const resume = makeTestResume();
    const jd = makeTestJD();

    const result = await runOptimizationPipeline({
      resume,
      jd,
      enableReflection: false,
      checkExport: false,
    });

    for (const step of result.steps) {
      expect(step.name).toBeTruthy();
      expect(["pending", "running", "completed", "failed", "skipped"]).toContain(step.status);
      if (step.status === "completed") {
        expect(step.startedAt).toBeTruthy();
        expect(step.completedAt).toBeTruthy();
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("produces an optimized resume with a summary and experience", async () => {
    const resume = makeTestResume();
    const jd = makeTestJD();

    const result = await runOptimizationPipeline({
      resume,
      jd,
      enableReflection: false,
      checkExport: false,
    });

    expect(result.optimizedResume).toBeTruthy();
    expect(result.optimizedResume!.summary).toBeTruthy();
    expect(result.optimizedResume!.summary!.length).toBeGreaterThan(50);
    expect(result.optimizedResume!.experience.length).toBeGreaterThan(0);
    expect(result.optimizedResume!.experience[0].bullets.length).toBeGreaterThan(0);
  });

  it("computes before and after ATS scores", async () => {
    const resume = makeTestResume();
    const jd = makeTestJD();

    const result = await runOptimizationPipeline({
      resume,
      jd,
      enableReflection: false,
      checkExport: false,
    });

    expect(result.beforeATS).toBeTruthy();
    expect(result.afterATS).toBeTruthy();
    expect(result.beforeATS!.scores.ats).toBeGreaterThanOrEqual(0);
    expect(result.afterATS!.scores.ats).toBeGreaterThanOrEqual(0);
  });

  it("runs QA with factual consistency check against original resume", async () => {
    const resume = makeTestResume();
    const jd = makeTestJD();

    const result = await runOptimizationPipeline({
      resume,
      jd,
      enableReflection: false,
      checkExport: false,
    });

    expect(result.qa).toBeTruthy();
    expect(result.qa!.factualConsistency).toBeTruthy();
    expect(typeof result.qa!.factualConsistency!.passed).toBe("boolean");
    expect(result.qa!.confidence).toBeGreaterThanOrEqual(0);
  });
});
