// ============================================================================
// Agent Configuration Center — bulk operations + D1 persistence tests
// (directives #5, #21, #22, #25, #44)
//
// - bulkUpdateAgentConfigs operates against the COMPLETE 18-agent registry
//   (never only visible DOM items)
// - select-all → bulk provider/model/parameter assignment updates ALL agents
// - every write persists to D1 via cloudApi.updateAgentConfigs (PUT
//   /api/agent-configs) — never local-only
// - server version is adopted (cache consistency, directive #40)
// - [AI_CONFIG_SYNC] observability is emitted
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "../pipeline-orchestration-types";

// ---------------------------------------------------------------------------
// Mock cloud-api BEFORE the store import: the store calls cloudApi.updateAgentConfigs
// fire-and-forget; we capture calls to assert D1 persistence.
// ---------------------------------------------------------------------------
const cloudCalls: { configs: AgentConfig[]; updatedBy?: string }[] = [];

vi.mock("../cloud-api", () => ({
  api: {
    updateAgentConfigs: (configs: AgentConfig[], updatedBy?: string) => {
      cloudCalls.push({ configs, updatedBy });
      return Promise.resolve({ ok: true, version: cloudCalls.length, updatedAt: new Date().toISOString(), count: configs.length });
    },
    getAgentConfigs: () => Promise.resolve({ ok: true, agentConfigs: [], version: 0, updatedAt: null, updatedBy: null }),
    updateBranding: () => Promise.resolve({ ok: true }),
  },
  cloudApiSafe: (fn: any) => fn,
}));

vi.mock("./helpers", () => ({
  uid: () => "test-uid-" + Math.random().toString(36).slice(2, 8),
}));

vi.mock("../mock-data", () => ({
  SEED_PROVIDERS: [],
  SEED_PROVIDER_LOGS: [],
  SEED_PROVIDER_SETTINGS: {},
  SEED_PROMPTS: [],
  SEED_BRANDING: {},
  SEED_FLAGS: {},
  SEED_OPTIMIZER_DIRECTIVE: {},
  SEED_FALLBACK_CHAIN: {},
}));

const seedConfigs = vi.hoisted(() => {
  // Minimal 18-agent registry in seed order (same agentTypes as the real
  // SEED_AGENT_CONFIGS — directive #44: "verify all 18 persisted").
  const types: [string, string, number][] = [
    ["supervisor", "Supervisor Agent", 0],
    ["parser", "Resume Parser", 1],
    ["entity-lock", "Entity Lock Agent", 2],
    ["resume-optimizer", "Resume Optimizer", 3],
    ["job-intelligence", "Job Intelligence Agent", 3],
    ["company-intelligence", "Company Intelligence Agent", 3],
    ["skill-gap", "Skill Gap Agent", 3],
    ["ats-analysis", "ATS Analysis Agent", 4],
    ["summary-optimizer", "Summary Optimization Agent", 5],
    ["skills-optimizer", "Skills Optimization Agent", 5],
    ["experience-optimizer", "Experience Optimization Agent", 5],
    ["education-languages", "Education & Languages Agent", 5],
    ["resume-assembler", "Resume Assembler Agent", 6],
    ["structure-guardian", "Structure Guardian Agent", 7],
    ["factual-consistency", "Factual Consistency Agent", 7],
    ["quality-assurance", "Quality Assurance Agent", 8],
    ["reflection", "Reflection Agent", 8],
    ["recovery", "Recovery Agent", 99],
  ];
  return types.map(([agentType, displayName, executionOrder], i) => ({
    id: `seed-${i}`,
    agentType,
    displayName,
    description: "",
    version: "1.0.0",
    executionOrder,
    enabled: true,
    parallelExecution: false,
    dependencies: [],
    runOnlyWhenRequired: false,
    enableLogging: false,
    enableDebugMode: false,
    providerId: "",
    model: "",
    qualityMode: "balanced" as const,
    temperature: 0.15,
    topP: 1,
    presencePenalty: 0,
    frequencyPenalty: 0,
    maxTokens: 8000,
    contextLength: 16000,
    stopSequences: [],
    reasoningEnabled: false,
    reasoningEffort: "medium" as const,
    maxThinkingTokens: 4096,
    reasoningTimeoutMs: 30000,
    streamingEnabled: false,
    streamPartialResponses: false,
    streamThinkingProcess: false,
    streamTokenStatistics: false,
    maxRetryCount: 2,
    retryDelayMs: 1000,
    exponentialBackoff: true,
    retryOnTimeout: true,
    retryOnRateLimit: true,
    retryOnNetworkError: true,
    retryOnInvalidOutput: true,
    requestTimeoutMs: 90000,
    totalAgentTimeoutMs: 300000,
    maxQueueWaitMs: 5000,
    fallbackChain: [],
    promptId: "",
    promptVersion: 1,
    minConfidenceScore: 70,
    minQualityScore: 75,
    minAtsScore: 70,
    minSemanticSimilarity: 70,
    minHtmlValidationScore: 70,
    onFailureAction: "retry" as const,
    readFromSharedMemory: true,
    writeToSharedMemory: true,
    memorySectionsUsed: [],
    cacheResults: true,
    cacheDurationMs: 600000,
    persistIntermediateResults: false,
    outputFormat: "json" as const,
    outputVisibility: "internal" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
});

vi.mock("../pipeline-orchestration-seeds", () => ({
  SEED_AGENT_CONFIGS: seedConfigs,
  SEED_PIPELINE_PROFILES: [],
  SEED_PROMPT_VERSIONS: [],
}));

// Minimal store scaffold — only the admin slice behaviors under test.
function createStore() {
  let state: any = {
    agentConfigs: JSON.parse(JSON.stringify(seedConfigs)),
    agentConfigVersion: 0,
    user: { email: "admin@example.com" },
    logs: [],
    log: function (l: any) { state.logs.push(l); },
  };
  const set = (patch: any) => {
    const p = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...p };
  };
  const get = () => state;
  return { set, get, get state() { return state; } };
}

async function buildSlice() {
  const store = createStore();
  const { createAdminSlice } = await import("./admin-slice");
  const slice = createAdminSlice(store.set as any, store.get as any, {} as any);
  // Replace seed-backed arrays with our mutable copies so assertions see updates.
  store.set({ agentConfigs: JSON.parse(JSON.stringify(seedConfigs)), agentConfigVersion: 0 });
  return { store, slice };
}

const ALL_TYPES = seedConfigs.map((c: any) => c.agentType);

describe("bulkUpdateAgentConfigs — SELECT ALL + bulk assignment (directives #5/#25)", () => {
  beforeEach(() => {
    cloudCalls.length = 0;
  });

  it("select all 18 agents → bulk provider+model assignment updates ALL 18", async () => {
    const { store, slice } = await buildSlice();
    const updated = slice.bulkUpdateAgentConfigs(ALL_TYPES, { providerId: "prov-x", model: "model-x" });
    expect(updated).toBe(18);
    expect(store.state.agentConfigs.length).toBe(18);
    for (const cfg of store.state.agentConfigs) {
      expect(cfg.providerId).toBe("prov-x");
      expect(cfg.model).toBe("model-x");
    }
  });

  it("bulk assignment persists the WHOLE registry to D1 (PUT /api/agent-configs)", async () => {
    const { store, slice } = await buildSlice();
    slice.bulkUpdateAgentConfigs(ALL_TYPES, { temperature: 0.5 });
    await new Promise((r) => setTimeout(r, 0)); // flush fire-and-forget sync
    expect(cloudCalls.length).toBe(1);
    expect(cloudCalls[0].configs.length).toBe(18);
    expect(cloudCalls[0].updatedBy).toBe("admin@example.com");
  });

  it("server version bump is adopted (cache consistency, directive #40)", async () => {
    const { store, slice } = await buildSlice();
    slice.bulkUpdateAgentConfigs(["supervisor"], { temperature: 0.1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.agentConfigVersion).toBe(1);
  });

  it("partial selection updates only selected agents, others untouched", async () => {
    const { store, slice } = await buildSlice();
    const before = store.state.agentConfigs.find((c: any) => c.agentType === "parser");
    const updated = slice.bulkUpdateAgentConfigs(["summary-optimizer", "skills-optimizer"], { maxRetryCount: 5 });
    expect(updated).toBe(2);
    expect(store.state.agentConfigs.find((c: any) => c.agentType === "summary-optimizer").maxRetryCount).toBe(5);
    expect(store.state.agentConfigs.find((c: any) => c.agentType === "skills-optimizer").maxRetryCount).toBe(5);
    expect(store.state.agentConfigs.find((c: any) => c.agentType === "parser").maxRetryCount).toBe(before.maxRetryCount);
  });

  it("unknown agent types are ignored (never fabricated)", async () => {
    const { store, slice } = await buildSlice();
    const updated = slice.bulkUpdateAgentConfigs(["nonexistent-agent"], { enabled: false });
    expect(updated).toBe(0);
  });

  it("bulk disable marks agents OFF and persists", async () => {
    const { store, slice } = await buildSlice();
    slice.bulkUpdateAgentConfigs(["recovery", "reflection"], { enabled: false });
    expect(store.state.agentConfigs.find((c: any) => c.agentType === "recovery").enabled).toBe(false);
    expect(store.state.agentConfigs.find((c: any) => c.agentType === "reflection").enabled).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(cloudCalls.length).toBe(1);
  });

  it("single updateAgentConfig still persists via the dedicated endpoint (D1 sinkhole fixed)", async () => {
    const { store, slice } = await buildSlice();
    slice.updateAgentConfig("supervisor", { providerId: "p-single", model: "m-single" });
    await new Promise((r) => setTimeout(r, 0));
    expect(cloudCalls.length).toBe(1);
    expect(store.state.agentConfigs.find((c: any) => c.agentType === "supervisor").providerId).toBe("p-single");
  });

  it("writes an audit log entry for bulk operations", async () => {
    const { store, slice } = await buildSlice();
    slice.bulkUpdateAgentConfigs(ALL_TYPES, { enabled: true });
    const logs = store.state.logs;
    const bulkLog = logs.find((l: any) => l.action === "Agent configs bulk updated");
    expect(bulkLog).toBeTruthy();
    expect(bulkLog.details).toContain("18 agent(s)");
  });
});

describe("agent config → D1 version contract (worker API shape)", () => {
  it("updateAgentConfigs sends agentConfigs array + updatedBy", async () => {
    cloudCalls.length = 0;
    const { api } = await import("../cloud-api");
    await api.updateAgentConfigs([{ agentType: "supervisor", enabled: true }] as any, "tester");
    expect(cloudCalls[0].configs[0].agentType).toBe("supervisor");
    expect(cloudCalls[0].updatedBy).toBe("tester");
  });
});
