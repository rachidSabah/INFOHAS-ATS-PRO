// ============================================================================
// Agent AI Config tests (Task 7 — Agent Configuration Center is LIVE).
//
// Verifies the AI-config resolution order enforced by callAIRaw:
//   explicit pinning > job AI lock (readiness gate) > Agent Config Center
//   > app defaults — with directive #31 guaranteed: an active job lock
//   NEVER lets an agent contribute a provider/model (only generation
//   parameters such as temperature / maxTokens / timeout).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "../../pipeline-orchestration-types";

// Minimal in-test store — the real store pulls the whole world in.
const storeState: { agentConfigs: AgentConfig[] } = { agentConfigs: [] };

vi.mock("../store", () => ({
  useApp: {
    getState: () => storeState,
  },
}));

import { resolveAgentAIOptions, getAgentConfig, agentConfigSignature, isAgentEnabled } from "./agent-ai-config";
import { setJobAILock, clearJobAILock } from "../ai/readiness/config-lock";

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "agent-test",
    agentType: "job-intelligence",
    displayName: "Test Agent",
    description: "",
    version: "1.0.0",
    executionOrder: 1,
    enabled: true,
    parallelExecution: false,
    dependencies: [],
    runOnlyWhenRequired: false,
    enableLogging: false,
    enableDebugMode: false,
    providerId: "",
    model: "",
    qualityMode: "balanced",
    temperature: 0.2,
    topP: 1.0,
    presencePenalty: 0,
    frequencyPenalty: 0,
    maxTokens: 3000,
    contextLength: 16000,
    stopSequences: [],
    reasoningEnabled: false,
    reasoningEffort: "medium",
    maxThinkingTokens: 4096,
    reasoningTimeoutMs: 30000,
    streamingEnabled: false,
    streamPartialResponses: false,
    streamThinkingProcess: false,
    streamTokenStatistics: false,
    maxRetryCount: 2,
    retryDelayMs: 1500,
    exponentialBackoff: true,
    retryOnTimeout: true,
    retryOnRateLimit: true,
    retryOnNetworkError: true,
    retryOnInvalidOutput: true,
    requestTimeoutMs: 90000,
    totalAgentTimeoutMs: 120000,
    maxQueueWaitMs: 30000,
    fallbackChain: [],
    promptId: "prompt-test",
    promptVersion: 1,
    minConfidenceScore: 70,
    minQualityScore: 75,
    minAtsScore: 60,
    minSemanticSimilarity: 70,
    minHtmlValidationScore: 80,
    onFailureAction: "retry",
    readFromSharedMemory: true,
    writeToSharedMemory: true,
    memorySectionsUsed: [],
    cacheResults: false,
    cacheDurationMs: 300000,
    persistIntermediateResults: false,
    outputFormat: "json",
    outputVisibility: "internal",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as AgentConfig;
}

const LOCK = {
  jobId: "job_1",
  lockedAt: new Date().toISOString(),
  primary: { providerId: "p_locked", providerName: "LockedProvider", model: "locked-model", readinessScore: 92, latencyMs: 400 },
  fallbacks: [{ providerId: "p_fb", providerName: "FallbackProvider", model: "fb-model", readinessScore: 80 }],
  eligibleProviderIds: ["p_locked", "p_fb"],
  activeIndex: 0,
  failoverCount: 0,
  events: [],
};

describe("resolveAgentAIOptions — no lock", () => {
  beforeEach(() => {
    clearJobAILock();
    storeState.agentConfigs = [];
  });

  it("unknown agent → no contribution (app defaults apply)", () => {
    const r = resolveAgentAIOptions("nonexistent-agent", false, false);
    expect(r.source).toBe("none");
    expect(r.providerId).toBeUndefined();
    expect(r.model).toBeUndefined();
    expect(r.temperature).toBeUndefined();
  });

  it("configured agent contributes provider+model+generation defaults (Agent Config Center is LIVE)", () => {
    storeState.agentConfigs = [makeAgentConfig({ providerId: "p_a", model: "model-a", temperature: 0.25, maxTokens: 1500, requestTimeoutMs: 60000 })];
    const r = resolveAgentAIOptions("job-intelligence", false, false);
    expect(r.source).toBe("agent-config");
    expect(r.providerId).toBe("p_a");
    expect(r.model).toBe("model-a");
    expect(r.temperature).toBe(0.25);
    expect(r.maxTokens).toBe(1500);
    expect(r.timeoutMs).toBe(60000);
  });

  it("explicit call pinning wins over the agent config; generation defaults still flow", () => {
    storeState.agentConfigs = [makeAgentConfig({ providerId: "p_a", model: "model-a", temperature: 0.25 })];
    const r = resolveAgentAIOptions("job-intelligence", true, false);
    expect(r.source).toBe("none");
    expect(r.providerId).toBeUndefined();
    expect(r.model).toBeUndefined();
    expect(r.temperature).toBe(0.25);
  });

  it("agent config with empty provider → no provider contribution", () => {
    storeState.agentConfigs = [makeAgentConfig({ providerId: "", model: "" })];
    const r = resolveAgentAIOptions("job-intelligence", false, false);
    expect(r.source).toBe("none");
    expect(r.providerId).toBeUndefined();
  });
});

describe("resolveAgentAIOptions — job AI lock active (directive #31)", () => {
  beforeEach(() => {
    setJobAILock(LOCK as any);
    storeState.agentConfigs = [];
  });

  it("LOCK ALWAYS wins: a configured agent may NOT contribute provider/model", () => {
    storeState.agentConfigs = [makeAgentConfig({ providerId: "p_agent", model: "agent-model", temperature: 0.4, maxTokens: 900 })];
    const r = resolveAgentAIOptions("job-intelligence", false, true);
    expect(r.source).toBe("job-lock");
    expect(r.providerId).toBeUndefined();
    expect(r.model).toBeUndefined();
    // Generation parameters (quality knobs, not provider selection) still apply.
    expect(r.temperature).toBe(0.4);
    expect(r.maxTokens).toBe(900);
  });
});

describe("getAgentConfig / isAgentEnabled / agentConfigSignature", () => {
  beforeEach(() => {
    clearJobAILock();
    storeState.agentConfigs = [];
  });

  it("getAgentConfig finds the stored config by agentType", () => {
    const cfg = makeAgentConfig({ agentType: "reflection" as any });
    storeState.agentConfigs = [cfg];
    expect(getAgentConfig("reflection")).toBe(cfg);
    expect(getAgentConfig("supervisor")).toBeNull();
  });

  it("isAgentEnabled defaults to true when no config exists", () => {
    expect(isAgentEnabled("nonexistent")).toBe(true);
    storeState.agentConfigs = [makeAgentConfig({ enabled: false })];
    expect(isAgentEnabled("job-intelligence")).toBe(false);
  });

  it("agentConfigSignature is stable and changes when a config changes", () => {
    storeState.agentConfigs = [makeAgentConfig({ temperature: 0.1 })];
    const s1 = agentConfigSignature();
    const s2 = agentConfigSignature();
    expect(s1).toBe(s2);
    expect(s1).not.toBe("ac0");

    storeState.agentConfigs = [makeAgentConfig({ temperature: 0.9 })];
    expect(agentConfigSignature()).not.toBe(s1);
  });
});
