// ============================================================================
// PipelineContext execution ledger tests (directive #18, #19, #44)
//
// - the shared context carries the FULL execution ledger contract:
//   executionRoute, routeLock, agentResults, agentDiagnostics, tokenUsage,
//   timings, warnings, errors, retryState, failoverEvents, cancellationState
// - route-lock stamping + failover recording + agent-result recording behave
// - ONE job → ONE route → ONE context invariant is representable
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  createEmptyContext,
  setContextExecutionRoute,
  recordContextFailover,
  recordContextAgentResult,
  type ExecutionRouteRecord,
} from "./pipeline-context";

function route(): ExecutionRouteRecord {
  return {
    providerId: "prov-a",
    providerName: "Provider A",
    canonicalModelId: "model-a",
    healthStatus: "healthy",
    latencyMs: 120,
    readinessScore: 88,
    configurationId: "job-lock:job-1",
    resolvedAt: new Date().toISOString(),
    authority: "readiness_gate",
  };
}

describe("GlobalPipelineContext execution ledger (directive #18)", () => {
  it("createEmptyContext initializes the full ledger", () => {
    const ctx = createEmptyContext();
    expect(ctx.executionRoute).toBeNull();
    expect(ctx.routeLock).toBeNull();
    expect(ctx.agentResults).toEqual({});
    expect(ctx.agentDiagnostics).toEqual({});
    expect(ctx.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0 });
    expect(ctx.timings).toEqual({});
    expect(ctx.warnings).toEqual([]);
    expect(ctx.errors).toEqual([]);
    expect(ctx.retryState).toEqual({ totalRetries: 0, perAgent: {} });
    expect(ctx.failoverEvents).toEqual([]);
    expect(ctx.cancellationState).toEqual({ cancelled: false });
  });

  it("setContextExecutionRoute stamps route + lock (authority=readiness_gate)", () => {
    const ctx = createEmptyContext();
    ctx.optimizationId = "opt-1";
    setContextExecutionRoute(ctx, route(), { jobId: "job-1", lockedAt: new Date().toISOString(), failoverCount: 0 });
    expect(ctx.executionRoute?.providerId).toBe("prov-a");
    expect(ctx.executionRoute?.authority).toBe("readiness_gate");
    expect(ctx.routeLock?.locked).toBe(true);
    expect(ctx.routeLock?.jobId).toBe("job-1");
    expect(ctx.missionId).toBe("opt-1");
  });

  it("recordContextFailover appends events and increments the lock counter", () => {
    const ctx = createEmptyContext();
    setContextExecutionRoute(ctx, route(), { jobId: "job-1" });
    recordContextFailover(ctx, {
      reason: "capability_mismatch",
      from: { providerId: "prov-a", canonicalModelId: "model-a" },
      to: { providerId: "prov-b", canonicalModelId: "model-b" },
      timestamp: new Date().toISOString(),
      agent: "ats-analysis",
    });
    expect(ctx.failoverEvents).toHaveLength(1);
    expect(ctx.failoverEvents![0].reason).toBe("capability_mismatch");
    expect(ctx.routeLock?.failoverCount).toBe(1);
  });

  it("recordContextAgentResult writes the standardized result envelope (directive #19)", () => {
    const ctx = createEmptyContext();
    recordContextAgentResult(ctx, {
      agentId: "job-intelligence",
      success: true,
      durationMs: 800,
      warnings: ["low confidence keywords"],
      tokens: { inputTokens: 500, outputTokens: 300 },
    });
    recordContextAgentResult(ctx, {
      agentId: "ats-analysis",
      success: false,
      durationMs: 200,
      errors: ["invalid JSON output"],
    });

    const r1 = ctx.agentResults!["job-intelligence"];
    expect(r1.success).toBe(true);
    expect(r1.outputVersion).toMatch(/^v1:/);
    expect(ctx.agentDiagnostics!["job-intelligence"].warnings).toContain("low confidence keywords");
    expect(ctx.agentDiagnostics!["ats-analysis"].state).toBe("failed");
    expect(ctx.errors).toContain("invalid JSON output");
    expect(ctx.warnings).toContain("low confidence keywords");
    expect(ctx.timings!["job-intelligence"]).toBe(800);
    expect(ctx.timings!.totalMs).toBe(1000);
    expect(ctx.tokenUsage).toEqual({ inputTokens: 500, outputTokens: 300, calls: 1 });
  });

  it("ONE job → ONE route → ONE context: multiple agents share the same route record", () => {
    const ctx = createEmptyContext();
    setContextExecutionRoute(ctx, route(), { jobId: "job-1" });
    for (const agent of ["parser", "job-intelligence", "ats-analysis", "summary-optimizer"]) {
      recordContextAgentResult(ctx, { agentId: agent, success: true, durationMs: 100 });
    }
    // All agents executed under the SAME execution route (pipeline cohesion,
    // directive #14): the context has exactly one route, not per-agent routes.
    expect(Object.keys(ctx.agentResults!).length).toBe(4);
    expect(ctx.executionRoute!.configurationId).toBe("job-lock:job-1");
  });
});
