// ============================================================================
// AI Health Manager tests (directives #9, #10, #28)
// - explicit health states are preserved (never collapsed to "provider failed")
// - 200/400/401/403/404/429/5xx/timeout/quota/unsupported classification
// - success/failure transitions, cooldowns, availability, redaction
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AIHealthManagerImpl,
  classifyProviderFailure,
  redactSecrets,
} from "./ai-health-manager";

function fresh(): AIHealthManagerImpl {
  const m = new AIHealthManagerImpl();
  m.reset();
  return m;
}

describe("classifyProviderFailure — explicit health states (directive #10)", () => {
  it("200-class success is healthy", () => {
    expect(classifyProviderFailure({ httpStatus: 200 })).toEqual({ category: "none", state: "healthy" });
  });

  it("400 invalid request → unavailable (not auth)", () => {
    const r = classifyProviderFailure({ httpStatus: 400, errorMessage: "bad parameter" });
    expect(r.category).toBe("invalid_request");
    expect(r.state).toBe("unavailable");
  });

  it("401 → authentication_required", () => {
    const r = classifyProviderFailure({ httpStatus: 401, errorMessage: "Unauthorized" });
    expect(r.category).toBe("authentication");
    expect(r.state).toBe("authentication_required");
  });

  it("403 → authentication_required", () => {
    const r = classifyProviderFailure({ httpStatus: 403, errorMessage: "forbidden" });
    expect(r.state).toBe("authentication_required");
  });

  it("404 endpoint → endpoint_error", () => {
    const r = classifyProviderFailure({ httpStatus: 404, errorMessage: "not found" });
    expect(r.category).toBe("not_found");
    expect(r.state).toBe("endpoint_error");
  });

  it("429 burst → rate_limited", () => {
    const r = classifyProviderFailure({ httpStatus: 429, errorMessage: "too many requests" });
    expect(r.category).toBe("rate_limit");
    expect(r.state).toBe("rate_limited");
  });

  it("monthly usage limit → quota_exhausted (NOT generic rate limit)", () => {
    const r = classifyProviderFailure({ httpStatus: 429, errorMessage: "Monthly usage limit reached" });
    expect(r.category).toBe("quota_exhausted");
    expect(r.state).toBe("quota_exhausted");
  });

  it("5xx → degraded server_error", () => {
    const r = classifyProviderFailure({ httpStatus: 503, errorMessage: "service unavailable" });
    expect(r.category).toBe("server_error");
    expect(r.state).toBe("degraded");
  });

  it("timeout message → timeout (not generic provider failure)", () => {
    const r = classifyProviderFailure({ errorMessage: "generate timed out after 15s" });
    expect(r.category).toBe("timeout");
    expect(r.state).toBe("timeout");
  });

  it("model not supported → unsupported_model", () => {
    const r = classifyProviderFailure({ httpStatus: 401, errorMessage: "Model not supported by provider" });
    expect(r.category).toBe("unsupported_model");
    expect(r.state).toBe("unsupported_model");
  });

  it("empty → unknown", () => {
    expect(classifyProviderFailure({}).state).toBe("unknown");
  });
});

describe("AIHealthManager state transitions", () => {
  let mgr: AIHealthManagerImpl;
  beforeEach(() => {
    mgr = fresh();
  });

  it("unknown pair starts as DISCOVERED/unknown", () => {
    const r = mgr.getHealth("p1", "model-a");
    expect(r.state).toBe("unknown");
    expect(r.availability).toBe("DISCOVERED");
  });

  it("recordSuccess flips to healthy + HEALTHY availability and resets failures", () => {
    mgr.recordFailure({ providerId: "p1", canonicalModelId: "m1", ok: false, httpStatus: 429, errorMessage: "429" });
    mgr.recordFailure({ providerId: "p1", canonicalModelId: "m1", ok: false, httpStatus: 429, errorMessage: "429" });
    const afterFail = mgr.getHealth("p1", "m1");
    expect(afterFail.failureCount).toBe(2);
    expect(afterFail.state).toBe("rate_limited");

    const afterOk = mgr.recordSuccess({ providerId: "p1", providerName: "P1", canonicalModelId: "m1", ok: true, latencyMs: 120 });
    expect(afterOk.state).toBe("healthy");
    expect(afterOk.failureCount).toBe(0);
    expect(afterOk.availability).toBe("HEALTHY");
    expect(afterOk.latencyMs).toBe(120);
    expect(afterOk.cooldownUntil).toBe(0);
  });

  it("quota exhaustion sets quotaState + long cooldown and blocks availability", () => {
    mgr.recordFailure({ providerId: "p2", canonicalModelId: "m2", ok: false, httpStatus: 429, errorMessage: "Monthly usage limit reached" });
    const r = mgr.getHealth("p2", "m2");
    expect(r.quotaState).toBe("exhausted");
    expect(r.state).toBe("quota_exhausted");
    expect(mgr.isAvailableNow("p2", "m2")).toBe(false);
  });

  it("authentication failure sets authState and blocks availability", () => {
    mgr.recordFailure({ providerId: "p3", canonicalModelId: "m3", ok: false, httpStatus: 401, errorMessage: "invalid api key" });
    const r = mgr.getHealth("p3", "m3");
    expect(r.authState).toBe("not_authenticated");
    expect(mgr.isAvailableNow("p3", "m3")).toBe(false);
  });

  it("unsupported model marks capability incompatible and demotes availability", () => {
    mgr.recordSuccess({ providerId: "p4", canonicalModelId: "m4", ok: true });
    expect(mgr.getHealth("p4", "m4").availability).toBe("HEALTHY");
    mgr.recordFailure({ providerId: "p4", canonicalModelId: "m4", ok: false, errorMessage: "Model not supported by provider" });
    const r = mgr.getHealth("p4", "m4");
    expect(r.capabilityCompatible).toBe(false);
    expect(r.availability).toBe("DISCOVERED");
    expect(r.state).toBe("unsupported_model");
  });

  it("cooldown expiry restores availability", () => {
    // Real-world order: the pair was validated once, then rate-limited.
    mgr.recordSuccess({ providerId: "p5", canonicalModelId: "m5", ok: true });
    mgr.recordFailure({ providerId: "p5", canonicalModelId: "m5", ok: false, httpStatus: 429, errorMessage: "429" });
    expect(mgr.isAvailableNow("p5", "m5")).toBe(false);
    // Simulate cooldown expiry.
    const future = Date.now() + 10 * 60_000;
    expect(mgr.isAvailableNow("p5", "m5", future)).toBe(true);
  });

  it("registerDiscovered never downgrades HEALTHY", () => {
    mgr.recordSuccess({ providerId: "p6", canonicalModelId: "m6", ok: true });
    mgr.registerDiscovered("p6", "P6", ["m6", "m7"]);
    expect(mgr.getHealth("p6", "m6").availability).toBe("HEALTHY");
    expect(mgr.getHealth("p6", "m7").availability).toBe("DISCOVERED");
  });

  it("markLocked / clearLocks lifecycle", () => {
    mgr.markLocked("p7", "m7");
    expect(mgr.getHealth("p7", "m7").availability).toBe("LOCKED");
    mgr.clearLocks();
    expect(mgr.getHealth("p7", "m7").availability).toBe("SUPPORTED");
  });

  it("rankedAvailable ranks healthy + available and excludes cooling pairs", () => {
    mgr.recordSuccess({ providerId: "pa", providerName: "A", canonicalModelId: "ma", ok: true, latencyMs: 100 });
    mgr.recordSuccess({ providerId: "pb", providerName: "B", canonicalModelId: "mb", ok: true, latencyMs: 500 });
    mgr.recordFailure({ providerId: "pc", providerName: "C", canonicalModelId: "mc", ok: false, httpStatus: 429, errorMessage: "429" });
    const ranked = mgr.rankedAvailable();
    expect(ranked.map((r) => r.providerId)).toEqual(["pa", "pb"]);
  });

  it("subscribe receives snapshot updates and secrets are redacted", () => {
    const seen: number[] = [];
    const unsub = mgr.subscribe(() => seen.push(1));
    mgr.recordFailure({ providerId: "px", canonicalModelId: "mx", ok: false, httpStatus: 401, errorMessage: "bad key sk-abcdefghijklmnop1234" });
    expect(seen.length).toBeGreaterThan(0);
    unsub();
    expect(mgr.getHealth("px", "mx").lastErrorMessage).toContain("[redacted]");
    expect(mgr.getHealth("px", "mx").lastErrorMessage).not.toContain("sk-abcdefghijklmnop1234");
  });

  it("sessionStorage mirror persists across instances", () => {
    // Node test env: install a minimal sessionStorage fake so the mirror works.
    const backing = new Map<string, string>();
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const a = new AIHealthManagerImpl();
    a.reset();
    a.recordSuccess({ providerId: "pz", canonicalModelId: "mz", ok: true });
    const b = new AIHealthManagerImpl();
    expect(b.getHealth("pz", "mz").state).toBe("healthy");
    b.reset();
    delete (globalThis as any).sessionStorage;
  });
});

describe("redactSecrets", () => {
  it("masks common token shapes", () => {
    expect(redactSecrets("Authorization: Bearer abc123def456ghi789")).toBe("Authorization: Bearer [redacted]");
    expect(redactSecrets("key=sk-proj-abcdefgh12345678")).toBe("key=[redacted]");
    expect(redactSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456")).toBe("token: [redacted]");
  });
  it("leaves normal error text intact", () => {
    expect(redactSecrets("Monthly usage limit reached for model x")).toBe("Monthly usage limit reached for model x");
  });
});
