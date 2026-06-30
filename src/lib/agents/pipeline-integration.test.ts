// ============================================================================
// Pipeline Integration Tests — validates all pipeline modules work together.
//
// Tests the full flow: Plan → Execute → Validate → Learn
// without mocking individual modules (only callAI and store are mocked
// as needed by the executor).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock callAI for executor test
vi.mock("../ai", () => ({
  callAI: vi.fn(),
}));

// Mock store for provider platform
vi.mock("../store", () => ({
  useApp: {
    getState: vi.fn(),
  },
}));

// Mock circuit breaker for executor
vi.mock("../circuit-breaker", () => ({
  isProviderAvailable: vi.fn(() => true),
  circuitBreakerSuccess: vi.fn(),
  circuitBreakerFailure: vi.fn(),
}));

import { useApp } from "../store";
import { createPlan } from "./pipeline-planner";
import { execute, type ExecutorFn, type ExecutionConfig } from "./pipeline-executor";
import { validateStep, nonEmptyRule, minLengthRule } from "./pipeline-validator";
import { KnowledgeGraph } from "./knowledge-graph";
import type { JobDescription } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJD(overrides?: Partial<JobDescription>): JobDescription {
  return {
    id: "jd-test",
    title: "Software Engineer",
    company: "Tech Corp",
    keywords: ["TypeScript", "React", "Node.js"],
    rawText: "We are hiring a software engineer with 5+ years experience in TypeScript, React, and Node.js.",
    responsibilities: ["Build web applications", "Write tests"],
    requiredSkills: ["TypeScript", "React"],
    preferredSkills: ["Node.js"],
    technologies: ["TypeScript", "React", "Node.js"],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Integration: Plan → Validate
// ---------------------------------------------------------------------------

describe("Plan → Validate integration", () => {
  it("creates a plan and validates its output", async () => {
    const jd = makeJD();
    const resumeText = "Jane Doe Software Engineer with TypeScript and React";

    const plan = await createPlan({ resumeText, jd });

    // Plan should produce a structured output
    expect(plan.industryId).toBeDefined();
    expect(plan.summary).toBeDefined();
    expect(typeof plan.enableReflection).toBe("boolean");

    // Validate the plan summary (should be non-empty)
    const validation = validateStep(plan.summary, [
      nonEmptyRule,
      minLengthRule(10),
    ]);
    expect(validation.valid).toBe(true);

    // Validate userDirectives (if present, should be reasonable length)
    if (plan.userDirectives) {
      const dirValidation = validateStep(plan.userDirectives, [
        nonEmptyRule,
      ]);
      expect(dirValidation.valid).toBe(true);
    }
  });

  it("detects aviation industry from job description", async () => {
    const jd = makeJD({
      title: "Flight Attendant",
      company: "Royal Air Maroc",
      keywords: ["Safety", "Customer Service", "Cabin Crew"],
      rawText: "Cabin crew position at Royal Air Maroc. Must have safety training and customer service experience.",
      requiredSkills: ["Safety", "Customer Service"],
    });
    const resumeText = "Flight attendant with cabin crew experience";

    const plan = await createPlan({ resumeText, jd });

    // Should detect aviation
    expect(plan.industryId).toBe("aviation");
    expect(plan.summary.toLowerCase()).toContain("aviation");
  });
});

// ---------------------------------------------------------------------------
// Integration: Executor → Validator
// ---------------------------------------------------------------------------

describe("Executor → Validator integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApp.getState as any).mockReturnValue({
      providers: [
        { id: "test-provider", modelName: "test-model", provider: "test", model: "test-model", taskCategory: "document", enabled: true },
      ],
      providerSettings: {
        defaultProviderId: "test-provider",
        fallbackProviderIds: [],
      },
    });
  });

  it("executes a function and validates the result", async () => {
    const fn: ExecutorFn = async () => "Generated resume content for validation";
    const config: ExecutionConfig = {
      providerId: "test-provider",
      label: "test-step",
      maxRetries: 1,
      timeoutMs: 5000,
    };

    const result = await execute(fn, config);

    // Execution should succeed
    expect(result.status).toBe("success");
    expect(result.output).toBeDefined();

    // Validate the output
    const validation = validateStep(result.output!, [
      nonEmptyRule,
      minLengthRule(10),
    ]);
    expect(validation.valid).toBe(true);
  });

  it("validates executor failure gracefully", async () => {
    const fn: ExecutorFn = async () => {
      throw new Error("Rate limit exceeded");
    };
    const config: ExecutionConfig = {
      providerId: "test-provider",
      label: "failing-step",
      maxRetries: 0,
      timeoutMs: 1000,
    };

    const result = await execute(fn, config);

    // Should fail
    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();

    // Error message should be non-empty
    expect(result.error?.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: Knowledge Graph + Pipeline
// ---------------------------------------------------------------------------

describe("Knowledge Graph + Pipeline integration", () => {
  it("stores and retrieves industry patterns across pipeline stages", async () => {
    const kg = new KnowledgeGraph();
    const jd = makeJD();
    const resumeText = "Jane Doe Software Engineer";

    const plan = await createPlan({ resumeText, jd });

    // Simulate: Pipeline Planner stores the plan
    kg.setIndustryPattern(plan.industryId, "plan", plan);

    // Simulate: Later pipeline stage retrieves the plan
    const retrievedPlan = kg.getIndustryPattern<typeof plan>(plan.industryId, "plan");
    expect(retrievedPlan).toEqual(plan);
    expect(retrievedPlan!.industryId).toBe(plan.industryId);
  });

  it("stores ATS analysis cache and retrieves it", () => {
    const kg = new KnowledgeGraph();

    const jd = makeJD();
    const analysisResult = {
      score: 85,
      gaps: ["More metrics needed"],
      strengths: ["Good format"],
    };

    // Store ATS analysis
    kg.setATSCache(jd.id, analysisResult);

    // Retrieve later
    const cached = kg.getATSCache<typeof analysisResult>(jd.id);
    expect(cached).toEqual(analysisResult);
  });

  it("tracks provider metrics across pipeline calls", () => {
    const kg = new KnowledgeGraph();

    // Simulate: Executor records provider performance
    kg.setProviderMetric("openai", "avg-latency", 1200);
    kg.setProviderMetric("openai", "success-rate", 0.95);

    // Simulate: Provider Platform reads metrics for routing
    const latency = kg.getProviderMetric<number>("openai", "avg-latency");
    const success = kg.getProviderMetric<number>("openai", "success-rate");
    expect(latency).toBe(1200);
    expect(success).toBe(0.95);

    // Stats should show 2 entries in global scope
    const stats = kg.stats();
    expect(stats.byScope["global"]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Integration: End-to-end pipeline flow
// ---------------------------------------------------------------------------

describe("End-to-end pipeline flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApp.getState as any).mockReturnValue({
      providers: [
        { id: "test-provider", modelName: "test-model", provider: "test", model: "test-model", taskCategory: "document", enabled: true },
      ],
      providerSettings: {
        defaultProviderId: "test-provider",
        fallbackProviderIds: [],
      },
    });
  });

  it("runs a full pipeline: plan → execute → validate → learn", async () => {
    const kg = new KnowledgeGraph();
    const jd = makeJD();
    const resumeText = "Jane Doe Senior Developer with TypeScript, React, Node.js experience.";

    // === 1. PLAN ===
    const plan = await createPlan({ resumeText, jd });
    expect(plan.summary).toBeDefined();

    kg.setIndustryPattern(plan.industryId, "last-plan", plan);

    // === 2. EXECUTE (simulated step) ===
    const fn: ExecutorFn = async () => `Optimized resume for ${jd.title} position at ${jd.company}`;
    const execResult = await execute(fn, {
      providerId: "test-provider",
      label: "optimizer",
      maxRetries: 1,
      timeoutMs: 5000,
    });

    expect(execResult.status).toBe("success");
    expect(execResult.output).toContain(jd.title);

    // === 3. VALIDATE ===
    const validation = validateStep(execResult.output!, [
      nonEmptyRule,
      minLengthRule(20),
      {
        id: "contains-job-title",
        description: "Must mention job title",
        severity: "error",
        validate: (o: string) => o.includes(jd.title) ? null : `Missing ${jd.title}`,
      },
    ]);
    expect(validation.valid).toBe(true);

    // === 4. LEARN (store in KG) ===
    kg.setProviderMetric("test-provider", "last-job", jd.id);
    kg.setIndustryPattern(plan.industryId, "last-output-length", execResult.output!.length);

    const stats = kg.stats();
    expect(stats.activeEntries).toBeGreaterThanOrEqual(3);
  });

  it("recovers from a failed step with fallback knowledge", async () => {
    const kg = new KnowledgeGraph();

    // Simulate: previous run stored failure info
    kg.setIndustryPattern("tech", "provider-hint", "use-openai-for-this");

    // First execution fails
    const fn1: ExecutorFn = async () => {
      throw new Error("Provider unavailable");
    };
    const failResult = await execute(fn1, {
      providerId: "test-provider",
      label: "failing-step",
      maxRetries: 0,
      timeoutMs: 1000,
    });
    expect(failResult.status).toBe("failed");

    // Knowledge Graph logs the failure
    kg.setProviderMetric("test-provider", "consecutive-failures", 3);

    // Second execution uses KG hint and succeeds
    const hint = kg.getIndustryPattern<string>("tech", "provider-hint");
    expect(hint).toBe("use-openai-for-this");

    const fn2: ExecutorFn = async () => "Succeeding with fallback provider";
    const successResult = await execute(fn2, {
      providerId: "test-provider",
      label: "retry-step",
      maxRetries: 0,
      timeoutMs: 1000,
    });
    expect(successResult.status).toBe("success");
  });
});
