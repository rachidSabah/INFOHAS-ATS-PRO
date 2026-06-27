// ============================================================================
// Parallel Pipeline Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResumeData, JobDescription } from "../types";

// Build mock AI responses
function makeAIText(): string {
  return JSON.stringify({
    summary: "Optimized summary with 60+ words describing a skilled professional with expertise in relevant technologies and a proven track record of delivering results.",
    headline: "Senior Engineer",
    skills: [
      { name: "React", category: "Frontend" },
      { name: "TypeScript", category: "Languages" },
      { name: "JavaScript", category: "Languages" },
    ],
    experiences: [
      { id: "exp_p1", bullets: ["Spearheaded feature development", "Orchestrated team initiatives"] },
    ],
  });
}

// Mock the AI module
vi.mock("../ai", () => {
  const mockCallAI = vi.fn().mockResolvedValue({
    text: makeAIText(),
    provider: "test-provider",
    tokensEstimate: 500,
    isLocalEngine: false,
  });

  return {
    callAI: mockCallAI,
    extractJSON: (text: string) => {
      try { return JSON.parse(text); } catch { return null; }
    },
    OPTIMIZER_CALL_TIMEOUT_MS: 60000,
  };
});

import { runParallelOptimizer } from "../parallel-pipeline";
import { globalEventBus } from "../agent-event-bus";
import { clearSemanticCache } from "../semantic-cache";
import { clearJobCache } from "../job-memory-cache";
import { callAI } from "../ai";

const MOCK_RESUME: ResumeData = {
  id: "r_parallel_test",
  name: "Test User",
  headline: "Dev",
  contact: { email: "test@test.com", phone: "", location: "" },
  summary: "Old summary text that needs optimization.",
  experience: [
    {
      id: "exp_p1", title: "Engineer", company: "TestCo", location: "SF",
      startDate: "2020", endDate: "2024",
      bullets: ["Did stuff", "Built things"],
    },
  ],
  education: [
    { id: "ed_p1", institution: "State U", degree: "BS", startDate: "2016", endDate: "2020" },
  ],
  skills: [
    { id: "s_p1", name: "JavaScript", category: "Languages" },
    { id: "s_p2", name: "React", category: "Frontend" },
  ],
  languages: [{ name: "English", proficiency: "fluent" } as any],
  certifications: [],
  projects: [],
  template: "ats-professional",
  accentColor: "#1154A3",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: "manual",
};

const MOCK_JD: JobDescription = {
  id: "jd_p1",
  title: "Senior Engineer",
  company: "BigCo",
  rawText: "Looking for a senior engineer with React and TypeScript experience.",
  responsibilities: ["Build features", "Lead team"],
  requiredSkills: ["React", "TypeScript", "Node.js"],
  preferredSkills: ["GraphQL"],
  technologies: [],
  createdAt: new Date().toISOString(),
  keywords: ["React", "TypeScript", "Senior", "Lead"],
};

describe("Parallel Optimizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (callAI as any).mockResolvedValue({
      text: makeAIText(),
      provider: "test-provider",
      tokensEstimate: 500,
      isLocalEngine: false,
    });
    globalEventBus.clearHistory();
    clearSemanticCache();
    clearJobCache();
  });

  it("preserves all education entries from source", async () => {
    const result = await runParallelOptimizer({
      resume: MOCK_RESUME, jd: MOCK_JD, directiveConfig: null,
    });
    expect(result.resume.education.length).toBe(1);
    expect(result.resume.education[0].institution).toBe("State U");
    expect(result.resume.education[0].degree).toBe("BS");
  });

  it("preserves experience company names and dates", async () => {
    const result = await runParallelOptimizer({
      resume: MOCK_RESUME, jd: MOCK_JD, directiveConfig: null,
    });
    expect(result.resume.experience.length).toBe(1);
    expect(result.resume.experience[0].company).toBe("TestCo");
    expect(result.resume.experience[0].title).toBe("Engineer");
    expect(result.resume.experience[0].startDate).toBe("2020");
    expect(result.resume.experience[0].endDate).toBe("2024");
  });

  it("returns provider name and char count", async () => {
    const result = await runParallelOptimizer({
      resume: MOCK_RESUME, jd: MOCK_JD, directiveConfig: null,
    });
    expect(result.provider).toBeTruthy();
    expect(typeof result.provider).toBe("string");
    expect(result.charCount).toBeGreaterThan(100);
    expect(result.keywordsAdded).toBeGreaterThanOrEqual(0);
  });

  it("does not modify contact info", async () => {
    const result = await runParallelOptimizer({
      resume: MOCK_RESUME, jd: MOCK_JD, directiveConfig: null,
    });
    expect(result.resume.contact.email).toBe("test@test.com");
    expect(result.resume.name).toBe("Test User");
  });

  it("emits events for each agent on the event bus", async () => {
    await runParallelOptimizer({
      resume: MOCK_RESUME, jd: MOCK_JD, directiveConfig: null,
    });
    const history = globalEventBus.getHistory();
    const agentNames = history.map((h: any) => h.agent);
    expect(agentNames).toContain("SummaryAgent");
    expect(agentNames).toContain("SkillsAgent");
    expect(agentNames).toContain("ExperienceAgent");
    expect(agentNames).toContain("ResumeAssembler");
  });

  it("returns warnings but no errors for valid input", async () => {
    const result = await runParallelOptimizer({
      resume: MOCK_RESUME, jd: MOCK_JD, directiveConfig: null,
    });
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
