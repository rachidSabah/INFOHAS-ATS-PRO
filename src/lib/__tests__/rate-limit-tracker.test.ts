import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimitTracker, RATE_LIMIT_BACKOFF_CAP_MS } from "../rate-limit-tracker";

describe("RateLimitTracker", () => {
  beforeEach(() => rateLimitTracker.clearAll());

  it("records 429 and marks as rate-limited", () => {
    rateLimitTracker.record429("p1", "m1");
    expect(rateLimitTracker.isRateLimited("p1", "m1")).toBe(true);
  });

  it("is not rate-limited for unknown models", () => {
    expect(rateLimitTracker.isRateLimited("unknown", "model")).toBe(false);
  });

  it("resets consecutive 429s on success", () => {
    rateLimitTracker.record429("p1", "m1");
    rateLimitTracker.record429("p1", "m1");
    expect(rateLimitTracker.isRateLimited("p1", "m1")).toBe(true);
    rateLimitTracker.recordSuccess("p1", "m1");
    // Success resets consecutive429s + bumps quota — no longer rate-limited
    expect(rateLimitTracker.isRateLimited("p1", "m1")).toBe(false);
  });

  it("finds best available model skipping rate-limited", () => {
    rateLimitTracker.record429("p1", "m1");
    const candidates = [
      { providerId: "p1", modelName: "m1", score: 90 },
      { providerId: "p1", modelName: "m2", score: 70 },
      { providerId: "p2", modelName: "m3", score: 80 },
    ];
    const best = rateLimitTracker.findBestAvailable(candidates);
    expect(best?.providerId).toBe("p2");
    expect(best?.modelName).toBe("m3");
  });

  it("returns null when all candidates are rate-limited", () => {
    rateLimitTracker.record429("p1", "m1");
    rateLimitTracker.record429("p1", "m2");
    const result = rateLimitTracker.findBestAvailable([
      { providerId: "p1", modelName: "m1" },
      { providerId: "p1", modelName: "m2" },
    ]);
    expect(result).toBeNull();
  });

  it("checks provider-level rate limit when no model specified", () => {
    rateLimitTracker.record429("p1", "m1");
    expect(rateLimitTracker.isRateLimited("p1")).toBe(true);
    expect(rateLimitTracker.isRateLimited("p2")).toBe(false);
  });

  it("updates quota from response headers", () => {
    rateLimitTracker.updateQuota("p1", "m1", 50, Date.now() + 60000);
    expect(rateLimitTracker.isRateLimited("p1", "m1")).toBe(false); // has quota
  });

  it("provides stats", () => {
    rateLimitTracker.record429("p1", "m1");
    rateLimitTracker.record429("p1", "m2");
    rateLimitTracker.recordSuccess("p2", "m3");
    rateLimitTracker.updateQuota("p2", "m3", 100);
    const stats = rateLimitTracker.getStats();
    expect(stats.totalTracked).toBe(3);
    expect(stats.rateLimited).toBe(2);
  });
});

// ============================================================================
// P3 — BOUNDED EXPONENTIAL BACKOFF. The tracker previously opened a flat
// 3-minute window and, after 3 consecutive 429s, blocked the provider with
// NO time bound ("sticky") — an in-memory block that only a page reload (or
// a success that could never be routed) could lift. Now every 429 opens a
// window that doubles with each consecutive failure (60s → 2m → 4m → …),
// capped at RATE_LIMIT_BACKOFF_CAP_MS (30 min, aligned with the quota-class
// sessionStorage cooldown), and ALWAYS expires.
// ============================================================================
describe("RateLimitTracker — bounded exponential backoff (P3)", () => {
  beforeEach(() => {
    rateLimitTracker.clearAll();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("first 429 opens a ~60s window (not the old flat 3-minute one)", () => {
    rateLimitTracker.record429("pb", "m");
    expect(rateLimitTracker.isRateLimited("pb", "m")).toBe(true);
    const remaining = rateLimitTracker.getCooldownRemainingMs("pb", "m");
    expect(remaining).toBeGreaterThan(55_000);
    expect(remaining).toBeLessThanOrEqual(61_000);
  });

  it("repeated 429s escalate: 2nd → ~2min, 3rd → ~4min", () => {
    rateLimitTracker.record429("pc", "m"); // consecutive 1 → 60s
    vi.advanceTimersByTime(61_000); // let the first window expire
    rateLimitTracker.record429("pc", "m"); // consecutive 2 → 120s
    let remaining = rateLimitTracker.getCooldownRemainingMs("pc", "m");
    expect(remaining).toBeGreaterThan(115_000);
    expect(remaining).toBeLessThanOrEqual(121_000);

    vi.advanceTimersByTime(121_000); // let the second window expire
    rateLimitTracker.record429("pc", "m"); // consecutive 3 → 240s
    remaining = rateLimitTracker.getCooldownRemainingMs("pc", "m");
    expect(remaining).toBeGreaterThan(235_000);
    expect(remaining).toBeLessThanOrEqual(241_000);
  });

  it("backoff is capped at RATE_LIMIT_BACKOFF_CAP_MS (30 min)", () => {
    for (let i = 0; i < 8; i++) {
      if (i > 0) vi.advanceTimersByTime(61_000); // always past the previous window
      rateLimitTracker.record429("pd", "m");
    }
    const remaining = rateLimitTracker.getCooldownRemainingMs("pd", "m");
    expect(remaining).toBeGreaterThan(RATE_LIMIT_BACKOFF_CAP_MS - 10_000);
    expect(remaining).toBeLessThanOrEqual(RATE_LIMIT_BACKOFF_CAP_MS + 1_000);
  });

  it("never sticks forever — even 8 consecutive 429s expire", () => {
    for (let i = 0; i < 8; i++) {
      if (i > 0) vi.advanceTimersByTime(61_000);
      rateLimitTracker.record429("pe", "m");
    }
    vi.advanceTimersByTime(RATE_LIMIT_BACKOFF_CAP_MS + 2_000);
    expect(rateLimitTracker.isRateLimited("pe", "m")).toBe(false);
  });

  it("no sticky-forever after 3 consecutive 429s (old trap)", () => {
    rateLimitTracker.record429("pf", "m");
    rateLimitTracker.record429("pf", "m");
    rateLimitTracker.record429("pf", "m");
    vi.advanceTimersByTime(RATE_LIMIT_BACKOFF_CAP_MS + 2_000);
    expect(rateLimitTracker.isRateLimited("pf", "m")).toBe(false);
  });

  it("success resets the escalation — the next 429 starts back at the base window", () => {
    rateLimitTracker.record429("pg", "m");
    rateLimitTracker.record429("pg", "m");
    rateLimitTracker.recordSuccess("pg", "m");
    expect(rateLimitTracker.isRateLimited("pg", "m")).toBe(false);
    rateLimitTracker.record429("pg", "m");
    const remaining = rateLimitTracker.getCooldownRemainingMs("pg", "m");
    expect(remaining).toBeGreaterThan(55_000);
    expect(remaining).toBeLessThanOrEqual(61_000);
  });
});
