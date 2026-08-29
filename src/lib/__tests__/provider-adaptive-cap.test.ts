// ============================================================================
// Task 20 — ADAPTIVE per-provider concurrency cap (AIMD)
//
// Task 19 made the cap user-configurable per provider. This closes the loop:
// the cap now tunes ITSELF from live traffic evidence.
//
//   on 429 (real traffic only): multiplicative DECREASE — current = floor(current/2),
//     floored at 1. A provider that rate-limits us gets hit more gently.
//   on success: additive INCREASE — after ADAPTIVE_CAP_RECOVER_THRESHOLD
//     consecutive successes, current += 1, never above the CONFIGURED ceiling
//     (per-provider cap ?? global default). The user's setting is always the
//     ceiling; the adaptive layer only tightens BELOW it.
//
// Why AIMD: multiplicative decrease reacts fast to congestion (the same
// reasoning as TCP); additive increase probes back slowly so a flapping
// free tier is not re-pounded at full parallelism after one lucky success.
//
// Probe/cooldown separation (Task 15/16) is preserved: the router only
// records rate-limit hits where it arms traffic cooldowns — probe evidence
// (requestType "test") never tightens the cap.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireProviderSlot,
  releaseProviderSlot,
  getProviderInFlight,
  setProviderConcurrencyOpts,
  getEffectiveProviderCap,
  getConfiguredProviderCap,
  getAdaptiveProviderCap,
  recordProviderRateLimitHit,
  recordProviderTrafficSuccess,
  clampProviderConcurrencyCap,
  __resetProviderConcurrencyForTests,
  DEFAULT_PROVIDER_CONCURRENCY,
  ADAPTIVE_CAP_RECOVER_THRESHOLD,
} from "../provider-concurrency";

beforeEach(() => {
  __resetProviderConcurrencyForTests();
  setProviderConcurrencyOpts({ cap: DEFAULT_PROVIDER_CONCURRENCY, maxWaitMs: 10_000 });
});

describe("getConfiguredProviderCap — the user's setting (unchanged semantics)", () => {
  it("no per-provider cap → global default", () => {
    expect(getConfiguredProviderCap("p", undefined)).toBe(DEFAULT_PROVIDER_CONCURRENCY);
  });

  it("per-provider cap wins and is clamped to 1..6", () => {
    expect(getConfiguredProviderCap("p", 4)).toBe(4);
    expect(getConfiguredProviderCap("p", 0)).toBe(1);
    expect(getConfiguredProviderCap("p", 99)).toBe(6);
    expect(getConfiguredProviderCap("p", "abc")).toBe(DEFAULT_PROVIDER_CONCURRENCY);
  });
});

describe("recordProviderRateLimitHit — multiplicative decrease on 429 evidence", () => {
  it("first hit tightens 4 → 2", () => {
    const ch = recordProviderRateLimitHit("p", 4);
    expect(ch.changed).toBe(true);
    expect(ch.from).toBe(4);
    expect(ch.to).toBe(2);
    expect(getAdaptiveProviderCap("p")).toBe(2);
  });

  it("second hit tightens 2 → 1", () => {
    recordProviderRateLimitHit("p", 4);
    const ch = recordProviderRateLimitHit("p", 4);
    expect(ch.from).toBe(2);
    expect(ch.to).toBe(1);
  });

  it("floors at 1 — further hits report changed:false", () => {
    recordProviderRateLimitHit("p", 4);
    recordProviderRateLimitHit("p", 4);
    const ch = recordProviderRateLimitHit("p", 4);
    expect(ch.changed).toBe(false);
    expect(ch.to).toBe(1);
    expect(getAdaptiveProviderCap("p")).toBe(1);
  });

  it("odd values halve with floor: 3 → 1", () => {
    const ch = recordProviderRateLimitHit("p", 3);
    expect(ch.from).toBe(3);
    expect(ch.to).toBe(1);
  });

  it("a hit resets the consecutive-success counter", () => {
    const ceiling = 4;
    recordProviderRateLimitHit("p", ceiling);        // 4 → 2
    for (let i = 0; i < ADAPTIVE_CAP_RECOVER_THRESHOLD - 1; i++) {
      recordProviderTrafficSuccess("p", ceiling);    // counter → 4, no change yet
    }
    recordProviderRateLimitHit("p", ceiling);        // 2 → 1, counter reset
    const ch = recordProviderTrafficSuccess("p", ceiling);
    expect(ch.changed).toBe(false);                  // first success after the hit
  });

  it("out-of-range ceiling is clamped", () => {
    const ch = recordProviderRateLimitHit("p", 99);
    expect(ch.ceiling).toBe(clampProviderConcurrencyCap(99));
  });
});

describe("recordProviderTrafficSuccess — additive increase, ceiling respected", () => {
  it("success on a never-tightened provider creates NO adaptive state", () => {
    const ch = recordProviderTrafficSuccess("healthy-provider", 2);
    expect(ch.changed).toBe(false);
    expect(getAdaptiveProviderCap("healthy-provider")).toBeNull(); // nothing to recover
  });

  it(`recovers +1 only after ${ADAPTIVE_CAP_RECOVER_THRESHOLD} consecutive successes`, () => {
    recordProviderRateLimitHit("p", 4); // 4 → 2
    for (let i = 0; i < ADAPTIVE_CAP_RECOVER_THRESHOLD - 1; i++) {
      const ch = recordProviderTrafficSuccess("p", 4);
      expect(ch.changed).toBe(false);
    }
    const ch = recordProviderTrafficSuccess("p", 4); // threshold reached
    expect(ch.changed).toBe(true);
    expect(ch.from).toBe(2);
    expect(ch.to).toBe(3);
    expect(getAdaptiveProviderCap("p")).toBe(3);
  });

  it("never recovers above the configured ceiling", () => {
    recordProviderRateLimitHit("p", 2); // 2 → 1
    for (let i = 0; i < 10 * ADAPTIVE_CAP_RECOVER_THRESHOLD; i++) {
      recordProviderTrafficSuccess("p", 2);
    }
    expect(getAdaptiveProviderCap("p")).toBe(2); // clamped at the ceiling, not beyond
  });

  it("raises the ceiling when the user re-configures upward (recovery targets the NEW ceiling)", () => {
    recordProviderRateLimitHit("p", 2); // 2 → 1
    for (let i = 0; i < 10 * ADAPTIVE_CAP_RECOVER_THRESHOLD; i++) {
      recordProviderTrafficSuccess("p", 4); // user raised config to 4
    }
    expect(getAdaptiveProviderCap("p")).toBe(4);
  });
});

describe("getEffectiveProviderCap — adaptive-aware (min of configured and adaptive)", () => {
  it("no adaptive state → configured cap", () => {
    expect(getEffectiveProviderCap("p", 4)).toBe(4);
  });

  it("tightened state wins over a HIGHER configured cap", () => {
    recordProviderRateLimitHit("p", 4); // 4 → 2
    expect(getEffectiveProviderCap("p", 4)).toBe(2);
    recordProviderRateLimitHit("p", 4); // 2 → 1
    expect(getEffectiveProviderCap("p", 4)).toBe(1);
  });

  it("never reports above the configured cap even if state lags", () => {
    recordProviderRateLimitHit("p", 2); // current 1, ceiling 2
    expect(getEffectiveProviderCap("p", 1)).toBe(1); // configured lowered below adaptive
  });
});

describe("acquireProviderSlot gates at the ADAPTIVE cap", () => {
  it("after a hit, configured-2 traffic is gated to 1 slot", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    recordProviderRateLimitHit("p", 2); // 2 → 1
    expect(await acquireProviderSlot("p")).toBe(true);
    expect(await acquireProviderSlot("p")).toBe(false); // adaptive cap 1
    expect(getProviderInFlight("p")).toBe(1);
    releaseProviderSlot("p");
  });

  it("after recovery, the configured cap applies again", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    recordProviderRateLimitHit("p", 2); // 2 → 1
    for (let i = 0; i < ADAPTIVE_CAP_RECOVER_THRESHOLD; i++) {
      recordProviderTrafficSuccess("p", 2);
    }
    expect(getEffectiveProviderCap("p")).toBe(2);
    expect(await acquireProviderSlot("p")).toBe(true);
    expect(await acquireProviderSlot("p")).toBe(true); // back to 2 slots
    releaseProviderSlot("p");
    releaseProviderSlot("p");
  });

  it("probes still bypass an adaptively tightened provider", async () => {
    recordProviderRateLimitHit("p", 2);
    expect(await acquireProviderSlot("p", { probe: true })).toBe(true);
    expect(getProviderInFlight("p")).toBe(0);
  });
});

describe("__resetProviderConcurrencyForTests clears adaptive state", () => {
  it("adaptive state is gone after reset", () => {
    recordProviderRateLimitHit("p", 4);
    expect(getAdaptiveProviderCap("p")).not.toBeNull();
    __resetProviderConcurrencyForTests();
    expect(getAdaptiveProviderCap("p")).toBeNull();
  });
});
