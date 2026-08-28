// Regression test — DIRECTIVE §2/§15/§48/§49: the pipeline must NEVER return
// the original uploaded resume as the "optimized" result.
//
// Historical production failure: a run with all AI providers down returned the
// source resume with local page-fill expansion (provider="degraded-optimization",
// isDegraded=true), the supervisor counted it as a degraded completion, and the
// user received their untouched resume labeled as the optimization result.
//
// NEW CONTRACT (this file):
//   1. When every validated optimizer attempt fails (OptimizerUnrecoverableError),
//      the pipeline returns status="recoverable_error" with optimizedResume=null —
//      the SOURCE snapshot is never substituted as the RESULT.
//   2. A stale/degraded locked-pipeline payload (isDegraded / "degraded-optimization")
//      is REJECTED by defense-in-depth in the orchestrator.

import { describe, it, expect, vi, beforeEach } from "vitest";
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

// Mock the locked pipeline. Default: every attempt failed → the pipeline throws
// OptimizerUnrecoverableError (the NEW post-degraded contract).
vi.mock("../locked-pipeline", () => ({
  runLockedPipeline: vi.fn(),
  OptimizerUnrecoverableError: class OptimizerUnrecoverableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "OptimizerUnrecoverableError";
    }
  },
}));

import { runOptimizationPipeline } from "./orchestrator";
import { runLockedPipeline } from "../locked-pipeline";

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

describe("Orchestrator — NO ORIGINAL-RESUME FALLBACK (directive §2/§15/§48)", () => {
  beforeEach(() => {
    vi.mocked(runLockedPipeline).mockReset();
    vi.mocked(runLockedPipeline).mockImplementation(() =>
      Promise.reject(
        Object.assign(
          new Error("Optimization could not be completed after 4 validated attempt(s). The original resume was NOT substituted as the result."),
          { name: "OptimizerUnrecoverableError" },
        ),
      ),
    );
  });

  it("returns an honest RECOVERABLE_ERROR with optimizedResume=null when all attempts fail", async () => {
    const result = await runOptimizationPipeline({
      resume: makeTestResume(),
      jd: makeTestJD(),
      enableReflection: false,
      checkExport: false,
    });

    // RESULT ≠ SOURCE: no original-resume substitution, ever.
    expect(result.optimizedResume).toBeNull();
    expect(result.status).toBe("recoverable_error");
    // The optimizer step is RECOVERABLE, not completed/degraded-success.
    const optimizerStep = result.steps.find((s) => s.name === "Resume Optimizer");
    expect(optimizerStep?.status).toBe("recoverable_error");
    // No after-ATS can exist — there is no optimized resume to score.
    expect(result.afterATS).toBeNull();
    // Completed upstream intelligence is PRESERVED for the recovery retry.
    expect(result.jobIntelligence).not.toBeNull();
    // The locked pipeline was retried by the supervisor's retry policy —
    // not silently abandoned after attempt 1.
    expect(vi.mocked(runLockedPipeline).mock.calls.length).toBeGreaterThan(1);
  });

  it("REJECTS a stale degraded-optimization payload (defense in depth)", async () => {
    // Simulate a stale code path returning the OLD degraded shape.
    vi.mocked(runLockedPipeline).mockImplementation(() =>
      Promise.resolve({
        resume: makeTestResume(),
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
      } as any),
    );

    const result = await runOptimizationPipeline({
      resume: makeTestResume(),
      jd: makeTestJD(),
      enableReflection: false,
      checkExport: false,
    });

    expect(result.optimizedResume).toBeNull();
    expect(result.status).toBe("recoverable_error");
    expect(result.provider).not.toBe("degraded-optimization");
  });
});
