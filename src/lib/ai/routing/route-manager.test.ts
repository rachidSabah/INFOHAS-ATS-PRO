// ============================================================================
// Route Manager tests (directives #12, #13, #15, #16)
// - candidate admission pipeline: compatibility → auth → availability → health
// - HealthyExecutionRoute contract fields
// - job route locking (readiness gate authority)
// - capability-mismatch failover records a FailoverEvent, never silent
// - fail-clean when no healthy candidate exists
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveHealthyRoute,
  lockRouteToJob,
  getLockedRoute,
  requestCapabilityFailover,
  recordFailoverEvent,
  getFailoverEvents,
  clearFailoverEvents,
  modelSupportsCapability,
  type RouteCandidate,
} from "./route-manager";
import { aiHealthManager } from "../health/ai-health-manager";
import { getJobAILock, clearJobAILock } from "../readiness/config-lock";

function prov(overrides: Partial<any> = {}): any {
  return {
    id: "prov-a",
    name: "Provider A",
    type: "openai",
    modelName: "model-a",
    enabledModels: ["model-a", "model-b"],
    status: "healthy",
    isActive: true,
    ...overrides,
  };
}

function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    provider: prov(),
    canonicalModelId: "model-a",
    pricing: "free",
    configurationId: "test-config",
    ...overrides,
  };
}

describe("resolveHealthyRoute — admission pipeline (directive #12)", () => {
  beforeEach(() => {
    aiHealthManager.reset();
    clearJobAILock();
    clearFailoverEvents();
  });

  it("resolves a validated healthy candidate with the full route contract (directive #13)", () => {
    aiHealthManager.recordSuccess({ providerId: "prov-a", providerName: "Provider A", canonicalModelId: "model-a", ok: true, latencyMs: 150 });
    const res = resolveHealthyRoute([candidate()], "job-1");
    expect(res.route).not.toBeNull();
    const r = res.route!;
    expect(r.providerId).toBe("prov-a");
    expect(r.providerName).toBe("Provider A");
    expect(r.canonicalModelId).toBe("model-a");
    expect(r.healthStatus).toBe("healthy");
    expect(r.latencyMs).toBe(150);
    expect(r.pricing).toBe("free");
    expect(r.configurationId).toBe("test-config");
    expect(r.resolvedAt).toBeTruthy();
    expect(Array.isArray(r.capabilities)).toBe(true);
  });

  it("rejects incompatible provider/model pairs (never sends Y to X)", () => {
    const bad = candidate({ provider: prov({ enabledModels: ["model-a"] }), canonicalModelId: "model-z" });
    const res = resolveHealthyRoute([bad]);
    expect(res.route).toBeNull();
    expect(res.diagnostics[0].stage).toBe("compatibility");
    expect(res.diagnostics[0].ok).toBe(false);
  });

  it("rejects quota-exhausted candidates at the availability stage", () => {
    aiHealthManager.recordFailure({ providerId: "prov-a", canonicalModelId: "model-a", ok: false, errorMessage: "Monthly usage limit reached" });
    const res = resolveHealthyRoute([candidate()]);
    expect(res.route).toBeNull();
    const stages = res.diagnostics.filter((d) => d.providerId === "prov-a").map((d) => d.stage);
    expect(stages).toContain("availability");
  });

  it("fails cleanly with a reason when nothing validates (directive #29)", () => {
    const res = resolveHealthyRoute([candidate({ canonicalModelId: "bogus" })]);
    expect(res.route).toBeNull();
    expect(res.failureReason).toContain("No validated");
  });

  it("ranks the healthier candidate first", () => {
    const a = candidate({ provider: prov({ id: "prov-a", name: "A", enabledModels: ["model-a"] }), canonicalModelId: "model-a" });
    const b = candidate({ provider: prov({ id: "prov-b", name: "B", enabledModels: ["model-b"] }), canonicalModelId: "model-b", pricing: "paid" });
    aiHealthManager.recordSuccess({ providerId: "prov-a", canonicalModelId: "model-a", ok: true, latencyMs: 100 });
    aiHealthManager.recordFailure({ providerId: "prov-b", canonicalModelId: "model-b", ok: false, httpStatus: 503, errorMessage: "service unavailable" });
    aiHealthManager.recordSuccess({ providerId: "prov-b", canonicalModelId: "model-b", ok: true, latencyMs: 900 });
    const res = resolveHealthyRoute([b, a]);
    expect(res.route?.providerId).toBe("prov-a");
  });
});

describe("lockRouteToJob / getLockedRoute — ONE route per job (directive #13)", () => {
  beforeEach(() => {
    aiHealthManager.reset();
    clearJobAILock();
    clearFailoverEvents();
  });

  it("locks the route to the job and marks the model LOCKED", () => {
    aiHealthManager.recordSuccess({ providerId: "prov-a", providerName: "A", canonicalModelId: "model-a", ok: true });
    const res = resolveHealthyRoute([candidate()]);
    const route = res.route!;
    const lock = lockRouteToJob(route, [], "job-42");
    expect(lock.jobId).toBe("job-42");
    expect(lock.primary.providerId).toBe("prov-a");
    expect(lock.primary.model).toBe("model-a");
    expect(lock.activeIndex).toBe(0);
    expect(getJobAILock()?.jobId).toBe("job-42");
    expect(aiHealthManager.getHealth("prov-a", "model-a").availability).toBe("LOCKED");

    const locked = getLockedRoute();
    expect(locked?.providerId).toBe("prov-a");
    expect(locked?.canonicalModelId).toBe("model-a");
    expect(locked?.availability).toBe("LOCKED");
    expect(locked?.configurationId).toBe("job-lock:job-42");
  });

  it("getLockedRoute is null without a lock", () => {
    expect(getLockedRoute()).toBeNull();
  });
});

describe("capability failover (directive #15) — controlled, recorded, never silent", () => {
  beforeEach(() => {
    aiHealthManager.reset();
    clearJobAILock();
    clearFailoverEvents();
  });

  it("modelSupportsCapability detects reasoning models", () => {
    expect(modelSupportsCapability(prov({ type: "openai" }), "o3-mini", "reasoning")).toBe(true);
    expect(modelSupportsCapability(prov({ type: "openai" }), "gpt-4o-mini", "reasoning")).toBe(false);
  });

  it("returns a compatible route + FailoverEvent when capability mismatch occurs", () => {
    // Current route locked on model-a. Agent requires "reasoning" — model-a lacks it.
    const current = {
      providerId: "prov-a",
      providerName: "Provider A",
      canonicalModelId: "model-a",
      capabilities: [] as string[],
      healthStatus: "healthy" as const,
      availability: "HEALTHY" as const,
      latencyMs: 100,
      quotaStatus: "unknown" as const,
      rateLimitState: "none" as const,
      pricing: "free" as const,
      configurationId: "cfg-1",
      resolvedAt: new Date().toISOString(),
    };
    // Alternative healthy provider with a reasoning-capable model.
    const alt = candidate({ provider: prov({ id: "prov-b", name: "B", enabledModels: ["o3-mini"] }), canonicalModelId: "o3-mini" });
    aiHealthManager.recordSuccess({ providerId: "prov-b", providerName: "B", canonicalModelId: "o3-mini", ok: true });

    const out = requestCapabilityFailover({
      jobId: "job-9",
      agent: "ats-analysis",
      requiredCapability: "reasoning",
      currentRoute: current,
      candidates: [alt],
    });

    expect(out.route).not.toBeNull();
    expect(out.route!.providerId).toBe("prov-b");
    expect(out.event).not.toBeNull();
    expect(out.event!.reason).toBe("capability_mismatch");
    expect(out.event!.from?.providerId).toBe("prov-a");
    expect(out.event!.to?.providerId).toBe("prov-b");
    expect(out.event!.agent).toBe("ats-analysis");
    expect(getFailoverEvents().length).toBeGreaterThan(0);
  });

  it("fails cleanly (null route, no fabricated switch) when no compatible alternative exists", () => {
    const current = {
      providerId: "prov-a",
      providerName: "Provider A",
      canonicalModelId: "model-a",
      capabilities: [],
      healthStatus: "healthy" as const,
      availability: "HEALTHY" as const,
      quotaStatus: "unknown" as const,
      rateLimitState: "none" as const,
      pricing: "free" as const,
      configurationId: "cfg-1",
      resolvedAt: new Date().toISOString(),
    };
    const out = requestCapabilityFailover({
      jobId: "job-9",
      agent: "ats-analysis",
      requiredCapability: "reasoning",
      currentRoute: current,
      candidates: [], // nothing validated anywhere
    });
    expect(out.route).toBeNull();
    expect(out.event).toBeNull();
    expect(out.reason).toContain("No validated");
  });

  it("recordFailoverEvent appends to the observable history", () => {
    recordFailoverEvent({
      reason: "rate_limit",
      from: { providerId: "x", canonicalModelId: "m" },
      to: { providerId: "y", canonicalModelId: "n" },
      timestamp: new Date().toISOString(),
      agent: "summary-optimizer",
    });
    const events = getFailoverEvents();
    expect(events.at(-1)?.reason).toBe("rate_limit");
  });
});
