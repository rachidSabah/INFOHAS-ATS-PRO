// Regression test: the locked pipeline's degraded return must propagate as a
// DEGRADED pipeline result — not a false-green "completed" success.
//
// Production evidence: a run with all AI providers down returned the source
// resume with local page-fill expansion (provider="degraded-optimization",
// isDegraded=true), but the orchestrator ignored the flag — afterATS was
// computed (+4 pts from junk keyword injection), the supervisor cached it and
// reported "0 failed", and the user saw a success toast for an optimization
// that never happened.

import { describe, it, expect, vi } from "vitest";
import type { ResumeData, JobDescription } from "../types";

// Mock the AI layer — with the locked pipeline mocked out below, the only
// remaining callAI consumers are the job-intelligence/company/skill-gap steps,
// which tolerate a generic JSON payload.
vi.mock("../ai", () => ({
  callAI: vi.fn(() =>
    Promise.resolve({
      text: JSON.stringify({
        industry: "technology",
        businessFunction: "engineering",
        recruiterIntent: "hire an experienced engineer",
        priorityKeywords: ["react", "typescript"],
        requiredSkills: ["react", "typescript"],
        requiredCompetencies: ["teamwork"],
        atsKeywords: ["react", "typescript"],
        companyPriorities: ["engineering excellence"],
        valuedCompetencies: ["attention to detail"],
        positioningDirective: "emphasize frontend expertise",
        keywordsToAvoid: [],
      }),
      provider: "test-provider",
      usage: { promptTokens: 10, completionTokens: 10 },
    }),
  ),
  getOptimizerDirective: vi.fn(() => "Rewrite the resume for the target job."),
  extractJSON: vi.fn(async () => ({})),
}));

// Mock the locked pipeline to return the DEGRADED shape exactly as
// src/lib/locked-pipeline.ts does when all AI providers fail.
vi.mock("../locked-pipeline", () => ({
  runLockedPipeline: vi.fn(() =>
    Promise.resolve({
      resume: {
        id: "r-degraded",
        name: "Test User",
        headline: "Software Engineer",
        summary: "Software engineer with 10 years of experience building scalable web applications and leading teams.",
        experience: [
          {
            id: "e1",
            title: "Engineer",
            company: "Tech Corp",
            location: "SF",
            startDate: "2020-01",
            endDate: "Present",
            bullets: [
              "Led migration to microservices architecture, reducing deployment time by 65%.",
              "Mentored 5 junior engineers, with 3 receiving promotions within 18 months.",
            ],
          },
        ],
        education: [{ id: "ed1", institution: "UC Berkeley", degree: "B.S.", field: "CS", startDate: "2012", endDate: "2016" }],
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
      } as unknown as ResumeData,
      provider: "degraded-optimization",
      charCount: 1200,
      keywordsAdded: 0,
      warnings: ["AI optimization unavailable — applied local page-fill expansion."],
      errors: ["All AI providers failed."],
      guardianScore: 0,
      guardianStatus: "REQUIRES_MANUAL_REVIEW",
      fingerprintValid: true,
      blueprintValid: true,
      templateBlueprintValid: true,
      guardianVerdict: undefined,
      retryCount: 1,
      isDegraded: true,
      assemblerStats: { matchedById: 0, matchedByFingerprint: 0, matchedByTitleCompany: 0, matchedByIndex: 0, unmatched: 0 },
      blueprint: undefined,
      assembler: undefined,
    }),
  ),
}));

import { runOptimizationPipeline } from "./orchestrator";

function makeTestResume(): ResumeData {
  return {
    id: "r-test-degraded",
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
        ],
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
    id: "jd-test-degraded",
    title: "Senior Software Engineer",
    company: "Tech Corp",
    location: "San Francisco, CA",
    employmentType: "Full-time",
    salary: "",
    responsibilities: ["Build scalable web applications"],
    requiredSkills: ["React", "TypeScript"],
    preferredSkills: [],
    technologies: ["React"],
    experienceYears: "5+",
    education: "Bachelor's degree",
    keywords: ["React", "TypeScript", "Node.js"],
    rawText: "We are looking for a Senior Software Engineer with React and TypeScript experience.",
    source: "text",
    createdAt: "2025-01-01T00:00:00Z",
  };
}

describe("Orchestrator — locked pipeline degraded propagation (false-green fix)", () => {
  it("marks the run degraded when the locked pipeline returns isDegraded", async () => {
    const result = await runOptimizationPipeline({
      resume: makeTestResume(),
      jd: makeTestJD(),
      enableReflection: false,
      checkExport: false,
    });

    expect(result.provider).toBe("degraded-optimization");
    expect(result.status).toBe("degraded");
    // Optimizer step must be degraded (not overwritten back to completed).
    const optimizerStep = result.steps.find((s) => s.name === "Resume Optimizer");
    expect(optimizerStep?.status).toBe("degraded");
    // P0: no after-ATS is computed for degraded runs (no fake BEFORE≠AFTER).
    expect(result.afterATS).toBeNull();
    // A usable resume is still returned (source + local expansion).
    expect(result.optimizedResume).toBeTruthy();
  });
});
