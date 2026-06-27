import { describe, it, expect, beforeEach } from "vitest";
import { modelRegistry, ModelEntry, AGENT_CAPABILITY_WEIGHTS } from "../model-registry";

function makeModel(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: overrides.id || "test:model-1",
    providerId: overrides.providerId || "test-provider",
    providerName: overrides.providerName || "Test Provider",
    modelName: overrides.modelName || "test-model",
    contextWindow: overrides.contextWindow || 8192,
    supportsJSON: overrides.supportsJSON ?? true,
    supportsStreaming: overrides.supportsStreaming ?? true,
    capabilities: overrides.capabilities || {
      reasoningScore: 80, writingScore: 80, atsScore: 80,
      jsonScore: 80, speedScore: 80, codingScore: 80,
      contextScore: 80, healthScore: 80,
    },
    health: overrides.health || {
      successRate: 1.0, avgLatencyMs: 200, errorRate: 0,
      rateLimitCount: 0, quotaRemaining: 1.0, lastUsed: 0, healthScore: 80,
    },
    metadata: overrides.metadata || {},
  };
}

describe("ModelRegistry", () => {
  beforeEach(() => modelRegistry.clear());

  it("registers and retrieves models", () => {
    const m = makeModel();
    modelRegistry.register(m);
    expect(modelRegistry.get("test:model-1")).toBeDefined();
    expect(modelRegistry.size()).toBe(1);
  });

  it("finds models by provider", () => {
    modelRegistry.register(makeModel({ id: "p1:m1", providerId: "p1" }));
    modelRegistry.register(makeModel({ id: "p1:m2", providerId: "p1" }));
    modelRegistry.register(makeModel({ id: "p2:m1", providerId: "p2" }));
    expect(modelRegistry.findByProvider("p1").length).toBe(2);
    expect(modelRegistry.findByProvider("p2").length).toBe(1);
  });

  it("ranks models for tasks using capability weights", () => {
    modelRegistry.register(makeModel({
      id: "fast:groq", providerId: "groq",
      modelName: "llama-3.3-70b",
      capabilities: { reasoningScore: 65, writingScore: 65, atsScore: 60, jsonScore: 70, speedScore: 95, codingScore: 60, contextScore: 55, healthScore: 80 },
    }));
    modelRegistry.register(makeModel({
      id: "smart:claude", providerId: "anthropic",
      modelName: "claude-opus-4",
      capabilities: { reasoningScore: 92, writingScore: 88, atsScore: 80, jsonScore: 85, speedScore: 40, codingScore: 90, contextScore: 95, healthScore: 85 },
    }));
    const ranked = modelRegistry.rankForTask("router");
    expect(ranked.length).toBe(2);
    // Groq should rank higher for router (speed-focused)
    expect(ranked[0].id).toBe("fast:groq");
  });

  it("prefers reasoning models for guardian tasks", () => {
    modelRegistry.register(makeModel({
      id: "smart:claude", providerId: "anthropic",
      modelName: "claude-opus-4",
      capabilities: { reasoningScore: 92, writingScore: 88, atsScore: 80, jsonScore: 85, speedScore: 40, codingScore: 90, contextScore: 95, healthScore: 85 },
    }));
    modelRegistry.register(makeModel({
      id: "fast:groq", providerId: "groq",
      modelName: "llama-3.3-70b",
      capabilities: { reasoningScore: 65, writingScore: 65, atsScore: 60, jsonScore: 70, speedScore: 95, codingScore: 60, contextScore: 55, healthScore: 80 },
    }));
    const best = modelRegistry.getBestForTask("guardian");
    // Guardian prioritizes reasoning — Claude should win
    expect(best?.id).toBe("smart:claude");
  });

  it("updates health metrics and recomputes healthScore", () => {
    modelRegistry.register(makeModel());
    modelRegistry.updateHealth("test:model-1", {
      successRate: 0.5, errorRate: 0.3, rateLimitCount: 5,
    });
    const m = modelRegistry.get("test:model-1");
    expect(m?.health.successRate).toBe(0.5);
    expect(m?.health.healthScore).toBeLessThan(80); // should drop
  });

  it("filters out unhealthy models in rankForTask", () => {
    modelRegistry.register(makeModel({
      id: "healthy", health: { successRate: 1, avgLatencyMs: 50, errorRate: 0, rateLimitCount: 0, quotaRemaining: 1, lastUsed: 0, healthScore: 90 },
    }));
    modelRegistry.register(makeModel({
      id: "sick", health: { successRate: 0.3, avgLatencyMs: 5000, errorRate: 0.5, rateLimitCount: 10, quotaRemaining: 0.1, lastUsed: 0, healthScore: 20 },
    }));
    const ranked = modelRegistry.rankForTask("summary", 50);
    expect(ranked.length).toBe(1);
    expect(ranked[0].id).toBe("healthy");
  });

  it("imports models from provider with default capabilities", () => {
    const n = modelRegistry.importFromProvider("p1", "Provider 1", ["gemini-3-flash", "deepseek-v4-pro", "unknown-model"]);
    expect(n).toBe(3);
    expect(modelRegistry.size()).toBe(3);
  });

  it("AGENT_CAPABILITY_WEIGHTS exists for all known agents", () => {
    const agents = ["summary", "skills", "experience", "education", "languages", "guardian", "reflection", "memory", "router"];
    for (const a of agents) {
      expect(AGENT_CAPABILITY_WEIGHTS[a]).toBeDefined();
    }
  });
});
