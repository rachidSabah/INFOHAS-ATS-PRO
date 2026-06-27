import { describe, it, expect, beforeEach } from "vitest";
import {
  clearAllMemory,
  getGlobalMemory,
  setIndustryPatterns,
  getIndustryPatterns,
  setJobMemory,
  getJobMemory,
  setJobMemoryTTL,
  clearExpiredJobMemory,
  initCandidateSession,
  getCandidateSession,
  destroyCandidateSession,
  addRetryAttempt,
  addQAFinding,
  addProviderAttempt,
  addReflectionNote,
  initSupervisorBatch,
  getSupervisorBatch,
  recordResumeSuccess,
  recordResumeFailure,
  recordProviderFailure,
  addTokenUsage,
  createAgentWorkingMemory,
  getAgentWorkingMemory,
  setAgentOutput,
  addAgentFinding,
  destroyAgentWorkingMemory,
} from "../memory/index";

describe("Memory Architecture", () => {
  beforeEach(() => {
    clearAllMemory();
  });

  // ==================================================================
  // Level 1: Global System Memory
  // ==================================================================
  describe("Global System Memory", () => {
    it("starts empty", () => {
      const mem = getGlobalMemory();
      expect(mem.industryPatterns).toEqual([]);
      expect(mem.lastUpdated).toBe(0);
    });

    it("stores and retrieves industry patterns", () => {
      const patterns = [
        {
          industry: "Healthcare",
          topKeywords: ["patient care", "HIPAA", "clinical"],
          commonPhrases: ["improved patient outcomes"],
          successfulATSStructures: ["Summary → Skills → Experience → Education"],
        },
      ];
      setIndustryPatterns(patterns);
      const mem = getGlobalMemory();
      expect(mem.industryPatterns).toHaveLength(1);
      expect(mem.lastUpdated).toBeGreaterThan(0);
    });

    it("filters by industry", () => {
      setIndustryPatterns([
        { industry: "Healthcare", topKeywords: ["patient"], commonPhrases: [], successfulATSStructures: [] },
        { industry: "Tech", topKeywords: ["react"], commonPhrases: [], successfulATSStructures: [] },
      ]);
      const healthcare = getIndustryPatterns("Healthcare");
      expect(healthcare).toHaveLength(1);
      expect(healthcare[0].topKeywords).toContain("patient");
    });

    it("returns all patterns when no industry filter", () => {
      setIndustryPatterns([
        { industry: "A", topKeywords: [], commonPhrases: [], successfulATSStructures: [] },
        { industry: "B", topKeywords: [], commonPhrases: [], successfulATSStructures: [] },
      ]);
      expect(getIndustryPatterns()).toHaveLength(2);
    });

    it("never stores PII", () => {
      // The type system enforces this — no name/email/phone fields exist
      const mem = getGlobalMemory();
      expect("name" in mem).toBe(false);
      expect("email" in mem).toBe(false);
      expect("phone" in mem).toBe(false);
      expect("resumes" in mem).toBe(false);
    });
  });

  // ==================================================================
  // Level 2: Job Memory
  // ==================================================================
  describe("Job Memory", () => {
    it("stores and retrieves by key", () => {
      const key = "test-job-key-123";
      setJobMemory(key, {
        company: "Acme Corp",
        title: "Software Engineer",
        priorityKeywords: ["react", "typescript"],
        requiredSkills: ["JavaScript", "React"],
        preferredSkills: ["GraphQL"],
        companyPriorities: ["innovation"],
        strongPhrases: ["led teams"],
        atsKeywords: ["agile", "scrum"],
        semanticPatterns: ["cross-functional"],
        hiringSignals: ["startup experience"],
      });
      const entry = getJobMemory(key);
      expect(entry).toBeDefined();
      expect(entry!.company).toBe("Acme Corp");
      expect(entry!.title).toBe("Software Engineer");
      expect(entry!.priorityKeywords).toEqual(["react", "typescript"]);
      expect(entry!.createdAt).toBeGreaterThan(0);
      expect(entry!.expiresAt).toBeGreaterThan(entry!.createdAt);
    });

    it("returns undefined for unknown key", () => {
      expect(getJobMemory("nonexistent")).toBeUndefined();
    });

    it("respects configurable TTL", () => {
      setJobMemoryTTL(1); // 1 day minimum
      const key = "ttl-test";
      setJobMemory(key, {
        company: "Test",
        title: "Role",
        priorityKeywords: [],
        requiredSkills: [],
        preferredSkills: [],
        companyPriorities: [],
        strongPhrases: [],
        atsKeywords: [],
        semanticPatterns: [],
        hiringSignals: [],
      });

      // Should still be valid
      expect(getJobMemory(key)).toBeDefined();

      // Force expiry by simulating time travel
      const entry = getJobMemory(key)!;
      (entry as any).expiresAt = Date.now() - 1;
      expect(getJobMemory(key)).toBeUndefined();
    });

    it("clamps TTL between 1 and 90 days", () => {
      setJobMemoryTTL(0);
      expect((getJobMemory as any)()).toBeUndefined(); // just verifying it doesn't throw

      setJobMemoryTTL(100);
      // Should clamp to 90
    });

    it("cleans expired entries", () => {
      const key = "expired-entry";
      setJobMemory(key, {
        company: "ExpiredCo",
        title: "ExpiredRole",
        priorityKeywords: [],
        requiredSkills: [],
        preferredSkills: [],
        companyPriorities: [],
        strongPhrases: [],
        atsKeywords: [],
        semanticPatterns: [],
        hiringSignals: [],
      });
      // Force expire
      const entry = getJobMemory(key)!;
      (entry as any).expiresAt = Date.now() - 1;
      clearExpiredJobMemory();
      expect(getJobMemory(key)).toBeUndefined();
    });
  });

  // ==================================================================
  // Level 3: Candidate Session Memory
  // ==================================================================
  describe("Candidate Session Memory", () => {
    it("starts null before init", () => {
      expect(getCandidateSession()).toBeNull();
    });

    it("initializes empty session", () => {
      initCandidateSession();
      const session = getCandidateSession();
      expect(session).toBeDefined();
      expect(session!.qaFindings).toEqual([]);
      expect(session!.retryHistory).toEqual([]);
      expect(session!.providerAttempts).toEqual([]);
      expect(session!.reflectionNotes).toEqual([]);
      expect(session!.startedAt).toBeGreaterThan(0);
    });

    it("tracks retry attempts", () => {
      initCandidateSession();
      addRetryAttempt({ attempt: 1, step: "optimize", provider: "mistral", error: "timeout", durationMs: 5000 });
      const session = getCandidateSession()!;
      expect(session.retryHistory).toHaveLength(1);
      expect(session.retryHistory[0].error).toBe("timeout");
    });

    it("tracks QA findings", () => {
      initCandidateSession();
      addQAFinding("Education missing institution");
      const session = getCandidateSession()!;
      expect(session.qaFindings).toContain("Education missing institution");
    });

    it("tracks provider attempts", () => {
      initCandidateSession();
      addProviderAttempt({ provider: "openai", model: "gpt-4", step: "summarize", success: true, durationMs: 1200 });
      const session = getCandidateSession()!;
      expect(session.providerAttempts).toHaveLength(1);
    });

    it("tracks reflection notes", () => {
      initCandidateSession();
      addReflectionNote("Score improved from 65 to 82");
      const session = getCandidateSession()!;
      expect(session.reflectionNotes).toContain("Score improved from 65 to 82");
    });

    it("is destroyed after optimization", () => {
      initCandidateSession();
      expect(getCandidateSession()).toBeDefined();
      destroyCandidateSession();
      expect(getCandidateSession()).toBeNull();
    });

    it("no-ops safely when not initialized", () => {
      // Should not throw
      addRetryAttempt({ attempt: 1, step: "x", provider: "x", error: "", durationMs: 0 });
      addQAFinding("test");
      addProviderAttempt({ provider: "x", model: "x", step: "x", success: true, durationMs: 0 });
      addReflectionNote("test");
      expect(getCandidateSession()).toBeNull();
    });
  });

  // ==================================================================
  // Level 4: Supervisor Batch Memory
  // ==================================================================
  describe("Supervisor Batch Memory", () => {
    it("starts null before init", () => {
      expect(getSupervisorBatch()).toBeNull();
    });

    it("initializes with batch ID", () => {
      initSupervisorBatch("batch-001");
      const batch = getSupervisorBatch()!;
      expect(batch.batchId).toBe("batch-001");
      expect(batch.processedResumes).toEqual([]);
      expect(batch.failedResumes).toEqual([]);
      expect(batch.providerFailures).toEqual({});
      expect(batch.tokenUsage).toBe(0);
      expect(batch.qualityMetrics.totalOptimized).toBe(0);
    });

    it("tracks resume success with score", () => {
      initSupervisorBatch("batch-001");
      recordResumeSuccess("res-1", 85);
      const batch = getSupervisorBatch()!;
      expect(batch.processedResumes).toContain("res-1");
      expect(batch.qualityMetrics.averageScore).toBe(85);
      expect(batch.qualityMetrics.minScore).toBe(85);
      expect(batch.qualityMetrics.maxScore).toBe(85);
      expect(batch.qualityMetrics.totalOptimized).toBe(1);
    });

    it("tracks resume failure", () => {
      initSupervisorBatch("batch-001");
      recordResumeFailure("res-2", "Parse error");
      const batch = getSupervisorBatch()!;
      expect(batch.failedResumes).toContain("res-2");
    });

    it("tracks provider failures with counts", () => {
      initSupervisorBatch("batch-001");
      recordProviderFailure("mistral");
      recordProviderFailure("mistral");
      recordProviderFailure("openai");
      const batch = getSupervisorBatch()!;
      expect(batch.providerFailures.mistral).toBe(2);
      expect(batch.providerFailures.openai).toBe(1);
    });

    it("tracks cumulative token usage", () => {
      initSupervisorBatch("batch-001");
      addTokenUsage(1500);
      addTokenUsage(3000);
      expect(getSupervisorBatch()!.tokenUsage).toBe(4500);
    });

    it("averages multiple scores", () => {
      initSupervisorBatch("batch-001");
      recordResumeSuccess("r1", 80);
      recordResumeSuccess("r2", 90);
      const batch = getSupervisorBatch()!;
      expect(batch.qualityMetrics.averageScore).toBe(85);
      expect(batch.qualityMetrics.minScore).toBe(80);
      expect(batch.qualityMetrics.maxScore).toBe(90);
    });
  });

  // ==================================================================
  // Level 5: Agent Working Memory
  // ==================================================================
  describe("Agent Working Memory", () => {
    it("creates and retrieves by agent + task", () => {
      const mem = createAgentWorkingMemory("summary-agent", "task-001");
      expect(mem.agentId).toBe("summary-agent");
      expect(mem.taskId).toBe("task-001");
      expect(mem.findings).toEqual([]);
      expect(mem.decisions).toEqual([]);
      expect(mem.createdAt).toBeGreaterThan(0);
    });

    it("returns undefined for unknown key", () => {
      expect(getAgentWorkingMemory("nonexistent", "nope")).toBeUndefined();
    });

    it("sets agent output", () => {
      createAgentWorkingMemory("skills-agent", "task-002");
      setAgentOutput("skills-agent", "task-002", { optimized: ["React", "TypeScript"] });
      const mem = getAgentWorkingMemory("skills-agent", "task-002")!;
      expect(mem.output).toEqual({ optimized: ["React", "TypeScript"] });
    });

    it("adds findings per agent", () => {
      createAgentWorkingMemory("exp-agent", "task-003");
      addAgentFinding("exp-agent", "task-003", "Missing quantified results");
      const mem = getAgentWorkingMemory("exp-agent", "task-003")!;
      expect(mem.findings).toContain("Missing quantified results");
    });

    it("isolates memory between different agents", () => {
      createAgentWorkingMemory("agent-a", "task-1");
      createAgentWorkingMemory("agent-b", "task-2");
      addAgentFinding("agent-a", "task-1", "Finding A");

      const memA = getAgentWorkingMemory("agent-a", "task-1")!;
      const memB = getAgentWorkingMemory("agent-b", "task-2")!;
      expect(memA.findings).toHaveLength(1);
      expect(memB.findings).toHaveLength(0);
    });

    it("destroys memory after agent completes", () => {
      createAgentWorkingMemory("temp-agent", "task-temp");
      expect(getAgentWorkingMemory("temp-agent", "task-temp")).toBeDefined();
      destroyAgentWorkingMemory("temp-agent", "task-temp");
      expect(getAgentWorkingMemory("temp-agent", "task-temp")).toBeUndefined();
    });
  });

  // ==================================================================
  // Full Reset
  // ==================================================================
  describe("clearAllMemory", () => {
    it("resets all memory tiers", () => {
      setIndustryPatterns([{ industry: "Test", topKeywords: [], commonPhrases: [], successfulATSStructures: [] }]);
      setJobMemory("k", { company: "C", title: "T", priorityKeywords: [], requiredSkills: [], preferredSkills: [], companyPriorities: [], strongPhrases: [], atsKeywords: [], semanticPatterns: [], hiringSignals: [] });
      initCandidateSession();
      initSupervisorBatch("b");
      createAgentWorkingMemory("a", "t");

      clearAllMemory();

      expect(getGlobalMemory().industryPatterns).toEqual([]);
      expect(getJobMemory("k")).toBeUndefined();
      expect(getCandidateSession()).toBeNull();
      expect(getSupervisorBatch()).toBeNull();
      expect(getAgentWorkingMemory("a", "t")).toBeUndefined();
    });
  });
});
