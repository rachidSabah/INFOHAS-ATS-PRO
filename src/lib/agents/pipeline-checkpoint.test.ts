// ============================================================================
// S4 — Pipeline checkpoint & resume (Task 18)
//
// When the optimizer exhausts all validated attempts, the pipeline ends in
// an honest RECOVERABLE_ERROR state with every completed intelligence
// artifact preserved (directive §15/§29/§48). But the RETRY re-ran ALL
// agents — including the (AI-costly) Job Intelligence, Company Intelligence
// and Skill Gap calls that had already succeeded.
//
// Contract under test:
//   - buildCheckpointFromResult extracts the preserved AI artifacts (only)
//     — ATS analysis is local/deterministic and is NOT checkpointed
//   - isCheckpointUsable binds the checkpoint to the same JD (title/company
//     fingerprint) and a freshness window (default 24h)
//   - a null/empty result or empty checkpoint yields null / unusable
//
// Orchestrator integration:
//   - with a usable checkpoint, the intelligence agent functions are NOT
//     called; the preserved artifacts appear in the result by identity
//   - without a checkpoint (or with a stale/foreign one), agents run as before
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildCheckpointFromResult,
  isCheckpointUsable,
  type PipelineCheckpoint,
} from "./pipeline-checkpoint";

const JD = { title: "Senior Frontend Engineer", company: "Tech Corp", description: "Build things." } as any;

// Full JobIntelligence shape — downstream optimizer code reads every field.
const JI_FIXTURE = {
  requiredSkills: ["react", "typescript"],
  preferredSkills: ["next.js"],
  requiredExperienceYears: 5,
  requiredRoles: ["frontend engineer"],
  requiredLanguages: ["english"],
  requiredCompetencies: ["ownership"],
  requiredTechnicalSkills: ["react", "typescript"],
  requiredSoftSkills: ["communication"],
  requiredIndustryKnowledge: ["web"],
  preferredQualifications: ["bs cs"],
  technologies: ["react", "typescript"],
  requiredCertifications: [],
  atsKeywords: ["react", "typescript", "microservices"],
  industryTerminology: ["spa"],
  industry: "Technology",
  businessFunction: "Engineering",
  recruiterIntent: "Ship features fast with high quality.",
  roleTitle: "Senior Frontend Engineer",
  company: "Tech Corp",
  priorityKeywords: ["react", "typescript", "microservices", "redis"],
  avoidKeywords: [],
};

const RESULT_WITH_ARTIFACTS = {
  jobIntelligence: JI_FIXTURE,
  companyIntelligence: {
    companyName: "Tech Corp",
    culture: "Ship fast, own outcomes.",
    values: ["ownership", "craft"],
    leadershipPrinciples: ["bias for action"],
    hiringPriorities: ["strong TypeScript"],
    valuedCompetencies: ["ownership"],
    companySpecificPriorities: ["product quality"],
    positioningAdvice: "Emphasize measurable impact.",
    likelyAtsSystem: "Workday",
  },
  skillGap: {
    overallMatch: 72,
    missingSkills: { critical: [], important: [] },
    transferableSkills: [
      { candidateSkill: "JavaScript", equivalentTo: "TypeScript", rationale: "Superset with types." },
    ],
    bridgingStrategy: "Frame JS depth as TS readiness.",
  },
  beforeATS: { scores: { ats: 61 } },
} as any;

beforeEach(() => {
  vi.useRealTimers();
});

describe("S4 — buildCheckpointFromResult", () => {
  it("extracts the three AI artifacts, not the local ATS analysis", () => {
    const cp = buildCheckpointFromResult(RESULT_WITH_ARTIFACTS, JD);
    expect(cp).not.toBeNull();
    expect(cp!.jobIntelligence).toBe(RESULT_WITH_ARTIFACTS.jobIntelligence);
    expect(cp!.companyIntelligence).toBe(RESULT_WITH_ARTIFACTS.companyIntelligence);
    expect(cp!.skillGap).toBe(RESULT_WITH_ARTIFACTS.skillGap);
    expect((cp as any).beforeATS).toBeUndefined();
    expect(typeof cp!.savedAt).toBe("string");
    expect(cp!.jdFingerprint.length).toBeGreaterThan(0);
  });

  it("returns null when nothing usable was preserved", () => {
    expect(buildCheckpointFromResult({}, JD)).toBeNull();
    expect(buildCheckpointFromResult(null as any, JD)).toBeNull();
  });

  it("partial artifacts are checkpointed (only what exists)", () => {
    const cp = buildCheckpointFromResult({ jobIntelligence: RESULT_WITH_ARTIFACTS.jobIntelligence }, JD);
    expect(cp?.jobIntelligence).toBeDefined();
    expect(cp?.companyIntelligence).toBeUndefined();
    expect(cp?.skillGap).toBeUndefined();
  });
});

describe("S4 — isCheckpointUsable", () => {
  it("fresh checkpoint for the same JD is usable", () => {
    const cp = buildCheckpointFromResult(RESULT_WITH_ARTIFACTS, JD)!;
    expect(isCheckpointUsable(cp, JD)).toBe(true);
  });

  it("a different JD (title or company) invalidates the checkpoint", () => {
    const cp = buildCheckpointFromResult(RESULT_WITH_ARTIFACTS, JD)!;
    expect(isCheckpointUsable(cp, { ...JD, title: "Backend Engineer" })).toBe(false);
    expect(isCheckpointUsable(cp, { ...JD, company: "Other Corp" })).toBe(false);
  });

  it("a stale checkpoint (>24h) is unusable", () => {
    const cp = buildCheckpointFromResult(RESULT_WITH_ARTIFACTS, JD)!;
    const in25h = Date.now() + 25 * 60 * 60 * 1000;
    expect(isCheckpointUsable(cp, JD, in25h)).toBe(false);
  });

  it("null checkpoint is unusable (never throws)", () => {
    expect(isCheckpointUsable(null, JD)).toBe(false);
  });
});

// ============================================================================
// Orchestrator integration — checkpointed retry skips the intelligence calls
// ============================================================================

const analyzeJobIntelligenceMock = vi.hoisted(() => vi.fn());
const analyzeCompanyIntelligenceMock = vi.hoisted(() => vi.fn());
const analyzeSkillGapMock = vi.hoisted(() => vi.fn());

vi.mock("../job-intelligence", async (importOriginal) => {
  const mod = await importOriginal<any>();
  return { ...mod, analyzeJobIntelligence: analyzeJobIntelligenceMock };
});

vi.mock("./company-skill-agents", async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    analyzeCompanyIntelligence: analyzeCompanyIntelligenceMock,
    analyzeSkillGap: analyzeSkillGapMock,
  };
});

vi.mock("../ai", () => {
  const optimizerPayload = {
    summary: "Senior engineer with 8+ years of experience building scalable web applications. Proven track record of leading teams and delivering high-impact products. Skilled in React, Node.js, and cloud architecture. Passionate about mentorship and code quality.",
    headline: "Senior Software Engineer",
    skills: [
      { name: "React", category: "Frontend" },
      { name: "TypeScript", category: "Frontend" },
      { name: "Node.js", category: "Backend" },
    ],
    experiences: [
      {
        id: "e1",
        bullets: [
          "Led migration to microservices architecture, reducing deployment time by 65% and improving system reliability.",
          "Mentored 5 junior engineers, 3 of whom received promotions within 18 months.",
          "Built a real-time analytics dashboard processing 2M+ events daily.",
          "Designed scalable APIs handling 10k requests per second.",
          "Collaborated with product and design teams to deliver new features consistently.",
        ],
      },
    ],
    missingKeywordsAdded: ["microservices"],
    bulletsRewritten: 3,
  };
  const mockCallAIImpl = (opts: any) => {
    if (opts.systemPrompt?.includes("Reflection Agent")) {
      return Promise.resolve({
        text: JSON.stringify({ issues: [], suggestions: [], confidence: 90 }),
        provider: "test-provider",
        usage: { promptTokens: 100, completionTokens: 200 },
      });
    }
    return Promise.resolve({
      text: JSON.stringify(optimizerPayload),
      provider: "test-provider",
      usage: { promptTokens: 500, completionTokens: 800 },
    });
  };
  return {
    callAI: vi.fn().mockImplementation((opts: any) => mockCallAIImpl(opts)),
    callAIStreamed: vi.fn().mockImplementation(async (opts: any, onChunk: any) => {
      const res = await mockCallAIImpl(opts);
      if (onChunk && res?.text) {
        onChunk(res.text);
      }
      return res;
    }),
    extractJSON: vi.fn((text: string) => JSON.parse(text)),
    getOptimizerDirective: vi.fn(() => "Test directive"),
    selectProviderForAgent: vi.fn().mockResolvedValue({
      id: "test-provider", name: "test-provider", type: "mock", isActive: true,
    }),
    getOrderedFallbackProviders: vi.fn(() => []),
    clearAllProviderCooldowns: vi.fn(),
    OPTIMIZER_CALL_TIMEOUT_MS: 120000,
    PIPELINE_STEP_CALL_TIMEOUT_MS: 90000,
    OptimizationProviderExhaustedError: class extends Error {},
  };
});

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

vi.mock("../exporter", () => ({
  exportResumePDF: vi.fn(() => ({ ok: true, pages: 1 })),
}));

import { runOptimizationPipeline } from "./orchestrator";
import type { ResumeData, JobDescription } from "../types";

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
          "Mentored 5 junior engineers, 3 of whom received promotions within 18 months.",
          "Built a real-time analytics dashboard processing 2M+ events daily.",
          "Designed scalable APIs handling 10k requests per second.",
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
    source: "text",
    createdAt: "2025-01-01T00:00:00Z",
  } as any;
}

function makeTestJD(): JobDescription {
  // Mirrors the fixture used by orchestrator.test.ts — the pipeline reads
  // many JD fields (keywords, requiredSkills, rawText…) beyond the three
  // the checkpoint fingerprint needs.
  return {
    id: "jd-test-1",
    title: "Senior Frontend Engineer",
    company: "Tech Corp",
    location: "San Francisco, CA",
    employmentType: "Full-time",
    salary: "",
    responsibilities: ["Build scalable web applications"],
    requiredSkills: ["React", "TypeScript", "Node.js"],
    preferredSkills: ["GraphQL"],
    technologies: ["React", "Node.js"],
    experienceYears: "5+",
    education: "Bachelor's degree",
    keywords: ["React", "TypeScript", "Node.js", "microservices"],
    rawText: "We are looking for a Senior Frontend Engineer with 5+ years of experience in React and TypeScript.",
    source: "text",
    createdAt: "2025-01-01T00:00:00Z",
  } as any;
}

describe("S4 — orchestrator checkpoint integration", () => {
  beforeEach(() => {
    analyzeJobIntelligenceMock.mockReset();
    analyzeCompanyIntelligenceMock.mockReset();
    analyzeSkillGapMock.mockReset();
    analyzeJobIntelligenceMock.mockResolvedValue(RESULT_WITH_ARTIFACTS.jobIntelligence);
    analyzeCompanyIntelligenceMock.mockResolvedValue(RESULT_WITH_ARTIFACTS.companyIntelligence);
    analyzeSkillGapMock.mockResolvedValue(RESULT_WITH_ARTIFACTS.skillGap);
  });

  it("without a checkpoint, the intelligence agents run (baseline)", async () => {
    const result = await runOptimizationPipeline({
      resume: makeTestResume(),
      jd: makeTestJD(),
    });
    expect(analyzeJobIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(analyzeCompanyIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("completed");
  }, 30000);

  it("with a usable checkpoint, intelligence agents are NOT re-called and artifacts are restored by identity", async () => {
    const checkpoint = buildCheckpointFromResult(RESULT_WITH_ARTIFACTS, makeTestJD())!;
    const result = await runOptimizationPipeline({
      resume: makeTestResume(),
      jd: makeTestJD(),
      checkpoint,
    });
    expect(analyzeJobIntelligenceMock).not.toHaveBeenCalled();
    expect(analyzeCompanyIntelligenceMock).not.toHaveBeenCalled();
    expect(result.jobIntelligence).toBe(RESULT_WITH_ARTIFACTS.jobIntelligence);
    expect(result.companyIntelligence).toBe(RESULT_WITH_ARTIFACTS.companyIntelligence);
    expect(result.skillGap).toBe(RESULT_WITH_ARTIFACTS.skillGap);
    expect(result.status).toBe("completed");
    // The restore is visible in the pipeline log:
    const restoredLog = result.steps.some((s: any) => /checkpoint/i.test(s.log ?? ""));
    expect(restoredLog).toBe(true);
  }, 30000);

  it("a stale checkpoint is ignored — agents run normally", async () => {
    const checkpoint = buildCheckpointFromResult(RESULT_WITH_ARTIFACTS, makeTestJD())!;
    const stale: PipelineCheckpoint = { ...checkpoint, savedAt: new Date(Date.now() - 25 * 3600_000).toISOString() };
    await runOptimizationPipeline({
      resume: makeTestResume(),
      jd: makeTestJD(),
      checkpoint: stale,
    });
    expect(analyzeJobIntelligenceMock).toHaveBeenCalledTimes(1);
  }, 30000);
});
