// ============================================================================
// Regression Tests — Endpoint-error cooldown (production evidence 2026-09-02)
//
// Antigravity (browser) proxies every call through cloudcode-pa.googleapis.com
// which answers 404 HTML on EVERY request; the dead NVIDIA NIM function id did
// the same. recordTrafficCooldownFromError only armed 429/401/timeout windows,
// so permanently-404ing providers were NEVER skipped — every pipeline step
// re-hit the same 404 all session long (dozens of console 404s per run).
//
// NOTE: vitest runs in the node environment; provider-cooldown.ts uses
// sessionStorage when present and is a no-op without it, so these tests
// install a minimal sessionStorage stub on globalThis to exercise real logic.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  markProviderEndpointCooldown,
  isProviderInCooldown,
  getProviderCooldownRemainingMs,
  getProviderCooldownClass,
  isEndpointNotFoundError,
  recordTrafficCooldownFromError,
  clearProviderCooldownOnSuccess,
} from "../provider-cooldown";

const PID = "p_test_endpoint";

/** Minimal sessionStorage/localStorage stub on globalThis.window (node env has no window). */
function installSessionStorageStub() {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
  };
  (globalThis as any).window = { sessionStorage: store, localStorage: store };
  return map;
}

describe("endpoint-error cooldown (404-family)", () => {
  let map: Map<string, string>;

  beforeEach(() => {
    map = installSessionStorageStub();
  });

  it("isEndpointNotFoundError detects status codes and message variants", () => {
    expect(isEndpointNotFoundError(new Error("x"), 404)).toBe(true);
    expect(isEndpointNotFoundError(new Error("x"), 410)).toBe(true);
    expect(
      isEndpointNotFoundError(
        new Error('Antigravity proxy error 404: {"error":"API returned HTTP 404: <!DOCTYPE html>"}')
      )
    ).toBe(true);
    expect(isEndpointNotFoundError(new Error("Function '23d4f03a': Not found for account 'acct'"))).toBe(true);
    expect(isEndpointNotFoundError({ statusCode: 404 })).toBe(true);
    // Non-404 failures must NOT classify as endpoint errors
    expect(isEndpointNotFoundError(new Error("429 rate limit"))).toBe(false);
    expect(isEndpointNotFoundError(new Error("generate timed out after 25s"))).toBe(false);
    expect(isEndpointNotFoundError(new Error("HTTP 401: invalid key"))).toBe(false);
    expect(isEndpointNotFoundError(new Error("HTTP 500 overloaded"))).toBe(false);
  });

  it("markProviderEndpointCooldown arms a cooldown with class 'endpoint'", () => {
    expect(isProviderInCooldown(PID)).toBe(false);
    markProviderEndpointCooldown(PID);
    expect(isProviderInCooldown(PID)).toBe(true);
    expect(getProviderCooldownClass(PID)).toBe("endpoint");
    expect(getProviderCooldownRemainingMs(PID)).toBeGreaterThan(0);
    // Bounded window — 10 minutes, not an all-day block
    expect(getProviderCooldownRemainingMs(PID)).toBeLessThanOrEqual(10 * 60 * 1000);
    clearProviderCooldownOnSuccess(PID);
    expect(isProviderInCooldown(PID)).toBe(false);
  });

  it("recordTrafficCooldownFromError arms the endpoint class on REAL-traffic 404s", () => {
    const armed = recordTrafficCooldownFromError({
      cooldownId: PID,
      providerId: PID,
      error: new Error("Antigravity proxy error 404: API returned HTTP 404: <!DOCTYPE html>"),
      isTimeout: false,
      requestType: "chat",
    });
    expect(armed).toBe("endpoint");
    expect(isProviderInCooldown(PID)).toBe(true);
    expect(getProviderCooldownClass(PID)).toBe("endpoint");
    expect(map.size).toBeGreaterThan(0); // actually written to the session store
  });

  it("probes (requestType 'test') never arm the endpoint cooldown", () => {
    const armed = recordTrafficCooldownFromError({
      cooldownId: PID,
      providerId: PID,
      error: new Error("API returned HTTP 404"),
      isTimeout: false,
      requestType: "test",
    });
    expect(armed).toBeNull();
    expect(isProviderInCooldown(PID)).toBe(false);
  });

  it("does not misclassify non-404 failures as endpoint errors", () => {
    const armed = recordTrafficCooldownFromError({
      cooldownId: PID,
      providerId: PID,
      error: new Error("HTTP 500: upstream overloaded"),
      isTimeout: false,
      requestType: "chat",
    });
    expect(armed).toBeNull(); // 5xx stays evidence-only (pre-existing behavior)
    expect(isProviderInCooldown(PID)).toBe(false);
  });
});
