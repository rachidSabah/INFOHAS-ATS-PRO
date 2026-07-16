// ============================================================================
// Phase 8.1.4 — Timeline tests.
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildTimeline } from "./timeline";
import { makeMemory, makeFlightRecord } from "./fixtures";

describe("buildTimeline", () => {
  const input = { memory: makeMemory(), records: [makeFlightRecord("accept")] };
  const t = buildTimeline(input);

  it("merges interview questions + flight spans + final recommendation", () => {
    expect(t.events.length).toBeGreaterThan(0);
    expect(t.events.some((e) => e.kind === "question")).toBe(true);
    expect(t.events.some((e) => e.kind === "decision")).toBe(true);
    expect(t.events.some((e) => e.kind === "final_recommendation")).toBe(true);
  });

  it("is ordered by time", () => {
    for (let i = 1; i < t.events.length; i++) {
      expect(t.events[i].at).toBeGreaterThanOrEqual(t.events[i - 1].at);
    }
  });

  it("filterBy returns only matching events", () => {
    const q = t.filterBy("question");
    expect(q.events.every((e) => e.kind === "question")).toBe(true);
    expect(q.events.length).toBeGreaterThan(0);
  });

  it("zoom returns events within range", () => {
    const z = t.zoom(0, 1);
    expect(z.events.every((e) => e.at >= 0 && e.at <= 1)).toBe(true);
  });

  it("inspect returns a single event by id", () => {
    const first = t.events[0];
    expect(t.inspect(first.id)?.id).toBe(first.id);
    expect(t.inspect("nope")).toBeUndefined();
  });
});
