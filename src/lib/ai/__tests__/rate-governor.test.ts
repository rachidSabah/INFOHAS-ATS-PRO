// ============================================================================
// Rate Governor — unit tests (Option 1: proactive pacing).
// Uses fake timers to verify bucket refill, AIMD reshaping, Retry-After
// parking, FIFO ticketing order, and the hard-wait ceiling.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateGovernor, DEFAULT_RPM, MAX_BURST, MAX_WAIT_MS } from "../rate-governor";

describe("RateGovernor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquire resolves immediately while burst capacity is available", async () => {
    const g = new RateGovernor();
    const t0 = Date.now();
    await g.acquire("prov", "model-x");
    await g.acquire("prov", "model-x");
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("paces calls once the burst is exhausted (token refill at RPM)", async () => {
    const g = new RateGovernor();
    // Drain the initial burst.
    for (let i = 0; i < MAX_BURST; i++) await g.acquire("p", "m");
    // The next call must wait for a refill (DEFAULT_RPM → 1 token / 6s).
    const p = g.acquire("p", "m");
    let resolved = false;
    p.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(resolved).toBe(false); // only half a token yet
    await vi.advanceTimersByTimeAsync(3_500);
    expect(resolved).toBe(true); // refilled past 1 token
    await p;
  });

  it("a rate-limit failure halves the burst and parks the provider", async () => {
    const g = new RateGovernor();
    const before = g.burstOf("p", "m");
    g.reportFailure("p", "m", { statusCode: 429, message: "Too many requests" });
    expect(g.burstOf("p", "m")).toBe(Math.max(1, Math.floor(before / 2)));
    // First 429 of a streak → 60s bounded backoff (same curve as the tracker).
    expect(g.parkedFor("p", "m")).toBeGreaterThan(55_000);
    expect(g.parkedFor("p", "m")).toBeLessThanOrEqual(60_000);
  });

  it("honors an explicit Retry-After surfaced by the adapter", async () => {
    const g = new RateGovernor();
    g.reportFailure("p", "m", { statusCode: 429, retryAfterSeconds: 7 });
    expect(g.parkedFor("p", "m")).toBeGreaterThan(6_000);
    expect(g.parkedFor("p", "m")).toBeLessThanOrEqual(7_000);
  });

  it("ignores non-rate-limit errors (no quota signal)", async () => {
    const g = new RateGovernor();
    g.reportFailure("p", "m", new Error("validation failed: too short"));
    expect(g.parkedFor("p", "m")).toBe(0);
    expect(g.burstOf("p", "m")).toBe(MAX_BURST);
  });

  it("success recovers burst capacity (additive increase) and clears the streak", async () => {
    const g = new RateGovernor();
    g.reportFailure("p", "m", { statusCode: 429 });
    const halved = g.burstOf("p", "m");
    g.reportSuccess("p", "m");
    g.reportSuccess("p", "m");
    expect(g.burstOf("p", "m")).toBeGreaterThan(halved);
  });

  it("is disabled cleanly (no pacing, no parking effect on acquire)", async () => {
    const g = new RateGovernor({ enabled: false });
    g.reportFailure("p", "m", { statusCode: 429 });
    const t0 = Date.now();
    await g.acquire("p", "m");
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("serves FIFO waiters in ticket order when capacity frees", async () => {
    const g = new RateGovernor({ enabled: true });
    for (let i = 0; i < MAX_BURST; i++) await g.acquire("p", "m"); // drain burst
    const order: number[] = [];
    const w1 = g.acquire("p", "m").then(() => { order.push(1); });
    const w2 = g.acquire("p", "m").then(() => { order.push(2); });
    // Refill exactly one token → only w1 (head of the FIFO) may proceed.
    await vi.advanceTimersByTimeAsync(6_500);
    await w1;
    expect(order).toEqual([1]);
    // Second token → w2 proceeds.
    await vi.advanceTimersByTimeAsync(6_500);
    await w2;
    expect(order).toEqual([1, 2]);
  });

  it("never waits longer than MAX_WAIT_MS even when parked (best-effort proceed)", async () => {
    const g = new RateGovernor();
    g.reportFailure("p", "m", { statusCode: 429, retryAfterSeconds: 3600 }); // 1h park
    const p = g.acquire("p", "m");
    let resolved = false;
    p.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS + 1_000);
    expect(resolved).toBe(true); // gave up waiting, proceeded best-effort
    await p;
  });

  it("resolveRpm prefers the configured cap, else the conservative default", () => {
    const g = new RateGovernor();
    expect(g.resolveRpm("p", 42)).toBe(42);
    expect(g.resolveRpm("p", undefined)).toBe(DEFAULT_RPM);
    expect(g.resolveRpm("p", 0)).toBe(DEFAULT_RPM);
  });
});
