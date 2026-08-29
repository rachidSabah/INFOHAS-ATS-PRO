// ============================================================================
// Task 19 — S3 polish: USER-CONFIGURABLE per-provider concurrency cap
//
// Task 18 (S3) shipped a per-provider semaphore with a GLOBAL cap (default 2)
// shared by every provider. Free tiers want it tight (1–2); beefier or paid
// endpoints want headroom (4–6). This pins the per-PROVIDER override:
//
//   - acquireProviderSlot(id, { cap }) — effective cap = clamp(provider cap)
//     falling back to the global default when the provider has none
//   - clamp 1..6 (floor 1: cap 0 would deadlock traffic; ceiling 6: beyond
//     that parallel agents self-inflict 429s again)
//   - overrides are per provider — A's cap never constrains B
//   - withProviderSlot forwards the cap
//   - getEffectiveProviderCap — introspection used by the router's busy
//     event metadata and the settings UI
//
// Router integration: the limiter reads the cap from the ROUTED provider
// object (AIProvider.concurrencyCap), so raising a paid provider's cap above
// the global default lets parallel agents actually run concurrently on it.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  acquireProviderSlot,
  releaseProviderSlot,
  getProviderInFlight,
  setProviderConcurrencyOpts,
  getEffectiveProviderCap,
  clampProviderConcurrencyCap,
  withProviderSlot,
  DEFAULT_PROVIDER_CONCURRENCY,
  MIN_PROVIDER_CONCURRENCY_CAP,
  MAX_PROVIDER_CONCURRENCY_CAP,
} from "../provider-concurrency";

beforeEach(() => {
  setProviderConcurrencyOpts({ cap: DEFAULT_PROVIDER_CONCURRENCY, maxWaitMs: 10_000 });
});

describe("clampProviderConcurrencyCap", () => {
  it("passes through in-range integers", () => {
    expect(clampProviderConcurrencyCap(1)).toBe(1);
    expect(clampProviderConcurrencyCap(3)).toBe(3);
    expect(clampProviderConcurrencyCap(6)).toBe(6);
  });

  it("floors at 1 — cap 0 would deadlock all traffic", () => {
    expect(clampProviderConcurrencyCap(0)).toBe(MIN_PROVIDER_CONCURRENCY_CAP);
    expect(clampProviderConcurrencyCap(-5)).toBe(MIN_PROVIDER_CONCURRENCY_CAP);
  });

  it("ceilings at 6 — beyond that parallel agents self-inflict 429s", () => {
    expect(clampProviderConcurrencyCap(99)).toBe(MAX_PROVIDER_CONCURRENCY_CAP);
  });

  it("floors fractional input (a cap is a count, not a rate)", () => {
    expect(clampProviderConcurrencyCap(2.9)).toBe(2);
  });

  it("non-numeric garbage falls back to the global default", () => {
    expect(clampProviderConcurrencyCap("abc")).toBe(DEFAULT_PROVIDER_CONCURRENCY);
    expect(clampProviderConcurrencyCap(NaN)).toBe(DEFAULT_PROVIDER_CONCURRENCY);
    expect(clampProviderConcurrencyCap(undefined)).toBe(DEFAULT_PROVIDER_CONCURRENCY);
  });
});

describe("getEffectiveProviderCap", () => {
  it("no per-provider cap → global default", () => {
    expect(getEffectiveProviderCap("p1", undefined)).toBe(DEFAULT_PROVIDER_CONCURRENCY);
  });

  it("per-provider cap wins over the global default", () => {
    expect(getEffectiveProviderCap("p1", 4)).toBe(4);
  });

  it("per-provider cap is clamped", () => {
    expect(getEffectiveProviderCap("p1", 0)).toBe(1);
    expect(getEffectiveProviderCap("p1", 50)).toBe(6);
  });
});

describe("acquireProviderSlot with per-provider cap", () => {
  it("tightens: cap 1 → second traffic acquire is busy (global stays 2)", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    expect(await acquireProviderSlot("cap1", { cap: 1 })).toBe(true);
    expect(await acquireProviderSlot("cap1", { cap: 1 })).toBe(false);
    expect(getProviderInFlight("cap1")).toBe(1);
    releaseProviderSlot("cap1");
  });

  it("raises: cap 4 admits 4 in-flight while the global default is 2", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    expect(await acquireProviderSlot("cap4", { cap: 4 })).toBe(true);
    expect(await acquireProviderSlot("cap4", { cap: 4 })).toBe(true);
    expect(await acquireProviderSlot("cap4", { cap: 4 })).toBe(true);
    expect(await acquireProviderSlot("cap4", { cap: 4 })).toBe(true);
    expect(getProviderInFlight("cap4")).toBe(4);
    expect(await acquireProviderSlot("cap4", { cap: 4 })).toBe(false);
  });

  it("without an override the global default still applies", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    expect(await acquireProviderSlot("plain")).toBe(true);
    expect(await acquireProviderSlot("plain")).toBe(true);
    expect(await acquireProviderSlot("plain")).toBe(false);
  });

  it("overrides are per provider — A's cap never constrains B", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    expect(await acquireProviderSlot("iso-a", { cap: 1 })).toBe(true);
    expect(await acquireProviderSlot("iso-a", { cap: 1 })).toBe(false);
    expect(await acquireProviderSlot("iso-b", { cap: 3 })).toBe(true);
    expect(await acquireProviderSlot("iso-b", { cap: 3 })).toBe(true);
    expect(await acquireProviderSlot("iso-b", { cap: 3 })).toBe(true);
  });

  it("an out-of-range override is clamped at acquire time (0 → 1)", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    expect(await acquireProviderSlot("clamped", { cap: 0 })).toBe(true);
    expect(await acquireProviderSlot("clamped", { cap: 0 })).toBe(false);
  });

  it("probes bypass regardless of a tight cap", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    expect(await acquireProviderSlot("probe-cap", { cap: 1 })).toBe(true);
    expect(await acquireProviderSlot("probe-cap", { probe: true, cap: 1 })).toBe(true);
    expect(getProviderInFlight("probe-cap")).toBe(1); // probe never counted
    releaseProviderSlot("probe-cap");
  });
});

describe("withProviderSlot forwards the cap", () => {
  it("busy sentinel when a cap-1 provider is saturated", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 30 });
    expect(await acquireProviderSlot("wps", { cap: 1 })).toBe(true);
    const ran = vi.fn();
    const out = await withProviderSlot("wps", ran, { cap: 1, busyValue: "BUSY" });
    expect(out).toBe("BUSY");
    expect(ran).not.toHaveBeenCalled();
    releaseProviderSlot("wps");
  });

  it("runs fn when the raised cap admits the call", async () => {
    setProviderConcurrencyOpts({ cap: 1, maxWaitMs: 30 });
    const out = await withProviderSlot("wps2", async () => "OK", { cap: 3, busyValue: "BUSY" });
    expect(out).toBe("OK");
    expect(getProviderInFlight("wps2")).toBe(0); // released
  });
});
