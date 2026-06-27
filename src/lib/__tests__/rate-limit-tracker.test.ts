import { describe, it, expect, beforeEach } from "vitest";
import { rateLimitTracker } from "../rate-limit-tracker";

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
