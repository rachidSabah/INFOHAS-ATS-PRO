// ============================================================================
// Task 21 — ADAPTIVE CAP OBSERVABILITY (snapshot + manual reset)
//
// Task 20 gave the router a self-tuning cap (halve on 429, +1 per 5 clean
// successes, ceiling-bound). But the state lives in a module-private map:
// the Providers page — the exact surface where the user CONFIGURES the
// ceiling — shows nothing about what the adaptive layer is actually
// enforcing right now. An operator watching 429-driven busy skips in the
// trajectory panel has no way to answer "what cap is in effect for this
// provider, and why?"
//
// This adds a read-only snapshot API + a surgical reset, pure logic first
// (the UI column is thin wiring over these calls):
//
//   getAdaptiveCapState(id)            → { current, ceiling, consecutiveSuccesses } | null
//   getProviderConcurrencySnapshot(id, perProviderCap?) → the full picture:
//     configuredCap (user ceiling, clamped) / adaptiveCap (null = never
//     tightened) / effectiveCap (what acquire enforces NOW) / inFlight /
//     tightened (effective < configured — the user-visible truth) /
//     consecutiveSuccesses (recovery progress toward the next +1 step)
//   resetProviderAdaptiveCap(id)       → manual escape hatch; returns whether
//     state existed. Clears ONE provider only — never touches others.
//
// "tightened" is derived from EFFECTIVE vs CONFIGURED (not from state
// existence): a fully-recovered provider (current == ceiling) and a provider
// whose adaptive current is masked by a lowered user ceiling both report
// tightened:false — nothing is being gated below the user's setting.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireProviderSlot,
  releaseProviderSlot,
  setProviderConcurrencyOpts,
  getAdaptiveCapState,
  getProviderConcurrencySnapshot,
  resetProviderAdaptiveCap,
  recordProviderRateLimitHit,
  recordProviderTrafficSuccess,
  __resetProviderConcurrencyForTests,
  DEFAULT_PROVIDER_CONCURRENCY,
  ADAPTIVE_CAP_RECOVER_THRESHOLD,
} from "../provider-concurrency";

beforeEach(() => {
  __resetProviderConcurrencyForTests();
  setProviderConcurrencyOpts({ cap: DEFAULT_PROVIDER_CONCURRENCY, maxWaitMs: 10_000 });
});

describe("getAdaptiveCapState — raw adaptive introspection", () => {
  it("returns null for a provider with no adaptive evidence", () => {
    expect(getAdaptiveCapState("p")).toBeNull();
  });

  it("returns current/ceiling after a 429 hit", () => {
    recordProviderRateLimitHit("p", 4); // 4 → 2
    expect(getAdaptiveCapState("p")).toEqual({
      current: 2,
      ceiling: 4,
      consecutiveSuccesses: 0,
    });
  });

  it("tracks the consecutive-success counter between recovery steps", () => {
    recordProviderRateLimitHit("p", 4); // 4 → 2
    recordProviderTrafficSuccess("p", 4);
    recordProviderTrafficSuccess("p", 4);
    expect(getAdaptiveCapState("p")?.consecutiveSuccesses).toBe(2);
    expect(getAdaptiveCapState("p")?.current).toBe(2);
  });

  it("returns null after resetProviderAdaptiveCap", () => {
    recordProviderRateLimitHit("p", 4);
    expect(getAdaptiveCapState("p")).not.toBeNull();
    resetProviderAdaptiveCap("p");
    expect(getAdaptiveCapState("p")).toBeNull();
  });
});

describe("getProviderConcurrencySnapshot — the full per-provider picture", () => {
  it("never-tightened provider: configured cap, no adaptive, effective = configured", () => {
    const snap = getProviderConcurrencySnapshot("p", 4);
    expect(snap).toEqual({
      providerId: "p",
      configuredCap: 4,
      adaptiveCap: null,
      effectiveCap: 4,
      inFlight: 0,
      tightened: false,
      consecutiveSuccesses: 0,
    });
  });

  it("no per-provider cap → configured falls back to the global default", () => {
    setProviderConcurrencyOpts({ cap: 3 });
    const snap = getProviderConcurrencySnapshot("p");
    expect(snap.configuredCap).toBe(3);
    expect(snap.effectiveCap).toBe(3);
    expect(snap.tightened).toBe(false);
  });

  it("clamps garbage per-provider caps (out of range → ceiling; junk → default)", () => {
    expect(getProviderConcurrencySnapshot("p", 99).configuredCap).toBe(6);
    expect(getProviderConcurrencySnapshot("p", "abc").configuredCap).toBe(DEFAULT_PROVIDER_CONCURRENCY);
  });

  it("after a 429: adaptive current visible, effective gated, tightened=true", () => {
    recordProviderRateLimitHit("p", 4); // 4 → 2
    const snap = getProviderConcurrencySnapshot("p", 4);
    expect(snap.adaptiveCap).toBe(2);
    expect(snap.effectiveCap).toBe(2);
    expect(snap.tightened).toBe(true);
    expect(snap.consecutiveSuccesses).toBe(0);
  });

  it("fully-recovered provider reports tightened=false even though state exists", () => {
    setProviderConcurrencyOpts({ cap: 2 });
    recordProviderRateLimitHit("p", 2); // 2 → 1
    for (let i = 0; i < ADAPTIVE_CAP_RECOVER_THRESHOLD; i++) {
      recordProviderTrafficSuccess("p", 2); // +1 per threshold → back to 2
    }
    const snap = getProviderConcurrencySnapshot("p", 2);
    expect(snap.effectiveCap).toBe(2);
    expect(snap.configuredCap).toBe(2);
    expect(snap.tightened).toBe(false);
  });

  it("tightened=false when the user's lowered ceiling masks the adaptive current", () => {
    recordProviderRateLimitHit("p", 4); // adaptive current 2
    const snap = getProviderConcurrencySnapshot("p", 1); // user ceiling 1 < adaptive 2
    expect(snap.effectiveCap).toBe(1);
    expect(snap.configuredCap).toBe(1);
    expect(snap.tightened).toBe(false);
  });

  it("reflects live in-flight slots and returns to zero after release", async () => {
    setProviderConcurrencyOpts({ cap: 4, maxWaitMs: 30 });
    expect(await acquireProviderSlot("p")).toBe(true);
    expect(await acquireProviderSlot("p")).toBe(true);
    const busy = getProviderConcurrencySnapshot("p", 4);
    expect(busy.inFlight).toBe(2);
    releaseProviderSlot("p");
    releaseProviderSlot("p");
    expect(getProviderConcurrencySnapshot("p", 4).inFlight).toBe(0);
  });

  it("snapshots are per-provider — one provider's state never leaks into another", () => {
    recordProviderRateLimitHit("p1", 4); // p1 tightened to 2
    const a = getProviderConcurrencySnapshot("p1", 4);
    const b = getProviderConcurrencySnapshot("p2", 4);
    expect(a.tightened).toBe(true);
    expect(b.tightened).toBe(false);
    expect(b.adaptiveCap).toBeNull();
  });
});

describe("resetProviderAdaptiveCap — manual escape hatch", () => {
  it("returns false for a provider with no adaptive state (no-op)", () => {
    expect(resetProviderAdaptiveCap("ghost")).toBe(false);
  });

  it("returns true for a tightened provider and restores the configured cap", () => {
    recordProviderRateLimitHit("p", 4); // 4 → 2
    expect(getProviderConcurrencySnapshot("p", 4).tightened).toBe(true);
    expect(resetProviderAdaptiveCap("p")).toBe(true);
    const snap = getProviderConcurrencySnapshot("p", 4);
    expect(snap.adaptiveCap).toBeNull();
    expect(snap.effectiveCap).toBe(4);
    expect(snap.tightened).toBe(false);
  });

  it("clears only the target provider — siblings keep their adaptive state", () => {
    recordProviderRateLimitHit("p1", 4);
    recordProviderRateLimitHit("p2", 4);
    resetProviderAdaptiveCap("p1");
    expect(getAdaptiveCapState("p1")).toBeNull();
    expect(getAdaptiveCapState("p2")).not.toBeNull();
  });

  it("reset also clears the recovery counter — a fresh hit starts over", () => {
    recordProviderRateLimitHit("p", 4); // 4 → 2
    recordProviderTrafficSuccess("p", 4);
    recordProviderTrafficSuccess("p", 4);
    resetProviderAdaptiveCap("p");
    recordProviderRateLimitHit("p", 4); // first evidence again: 4 → 2
    const st = getAdaptiveCapState("p");
    expect(st?.current).toBe(2);
    expect(st?.consecutiveSuccesses).toBe(0);
  });

  it("traffic acquires at the configured cap immediately after reset", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    recordProviderRateLimitHit("p", 2); // gated to 1
    expect(await acquireProviderSlot("p")).toBe(true);
    expect(await acquireProviderSlot("p")).toBe(false); // adaptive cap 1
    releaseProviderSlot("p");
    resetProviderAdaptiveCap("p");
    expect(await acquireProviderSlot("p")).toBe(true); // cap 2 again
    releaseProviderSlot("p");
    releaseProviderSlot("p");
  });
});
