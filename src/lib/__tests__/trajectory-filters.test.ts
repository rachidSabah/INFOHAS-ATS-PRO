// ============================================================================
// Task 19 — S2 polish: skip-event surface in the trajectory panel
//
// Task 18 (S2) made the router emit structured skip_provider events
// { reason: "cooldown" | "provider_busy", layer, class, remainingMs,
//   inFlight, waitedMs } on the global event bus. This module is the pure
// filtering/summarizing layer the panel renders:
//   - isSkipEvent / isFailureEvent: skip events are NOT failures (they carry
//     success: false but mean "routed elsewhere", not "work failed")
//   - filterTrajectory: all / skips / failures views
//   - summarizeSkips: reason breakdown for the filter header
//   - describeSkipReason: one-line human explanation per skip event
// ============================================================================

import { describe, it, expect } from "vitest";
import type { AgentEvent } from "../agent-event-bus";
import {
  isSkipEvent,
  isCapEvent,
  isFailureEvent,
  filterTrajectory,
  summarizeSkips,
  describeSkipReason,
} from "../trajectory-filters";

const skipCooldown: AgentEvent = {
  agent: "ProviderRouter",
  action: "skip_provider",
  resumeId: "OpenCode Zen",
  provider: "OpenCode Zen",
  success: false,
  metadata: {
    reason: "cooldown",
    layer: "session",
    class: "quota",
    remainingMs: 1_795_000,
    requestType: "chat",
  },
};

const skipBusy: AgentEvent = {
  agent: "ProviderRouter",
  action: "skip_provider",
  resumeId: "ZenCode hy3",
  provider: "ZenCode hy3",
  success: false,
  metadata: {
    reason: "provider_busy",
    inFlight: 4,
    cap: 2,
    waitedMs: 10_000,
    requestType: "chat",
  },
};

const failure: AgentEvent = {
  agent: "SummaryOptimizer",
  action: "optimize_summary",
  resumeId: "r1",
  success: false,
  metadata: { reason: "model error" },
};

const ok: AgentEvent = {
  agent: "ResumeAssembler",
  action: "assemble",
  resumeId: "r1",
  success: true,
};

describe("isSkipEvent / isFailureEvent", () => {
  it("skip_provider events are skips", () => {
    expect(isSkipEvent(skipCooldown)).toBe(true);
    expect(isSkipEvent(skipBusy)).toBe(true);
  });

  it("skip events are skips even without metadata", () => {
    const bare: AgentEvent = { agent: "ProviderRouter", action: "skip_provider", resumeId: "x" };
    expect(isSkipEvent(bare)).toBe(true);
  });

  it("regular events are not skips", () => {
    expect(isSkipEvent(failure)).toBe(false);
    expect(isSkipEvent(ok)).toBe(false);
  });

  it("skip events are NOT failures (routed elsewhere ≠ work failed)", () => {
    expect(isFailureEvent(skipCooldown)).toBe(false);
    expect(isFailureEvent(skipBusy)).toBe(false);
  });

  it("failed agent events are failures; successful ones are not", () => {
    expect(isFailureEvent(failure)).toBe(true);
    expect(isFailureEvent(ok)).toBe(false);
  });
});

describe("isCapEvent — adaptive-cap lifecycle events (Task 20)", () => {
  const capTighten: AgentEvent = {
    agent: "ProviderRouter",
    action: "cap_tighten",
    resumeId: "OpenCode Zen",
    provider: "OpenCode Zen",
    success: true,
    metadata: { from: 2, to: 1, ceiling: 2, cause: "429" },
  };

  const capRecover: AgentEvent = {
    agent: "ProviderRouter",
    action: "cap_recover",
    resumeId: "OpenCode Zen",
    provider: "OpenCode Zen",
    success: true,
    metadata: { from: 1, to: 2, ceiling: 2, consecutiveSuccesses: 5 },
  };

  it("cap_* events are CAP events", () => {
    expect(isCapEvent(capTighten)).toBe(true);
    expect(isCapEvent(capRecover)).toBe(true);
  });

  it("CAP events are neither skips nor failures (informational)", () => {
    expect(isSkipEvent(capTighten)).toBe(false);
    expect(isFailureEvent(capTighten)).toBe(false);
    expect(isFailureEvent(capRecover)).toBe(false);
  });

  it("regular events are not CAP events", () => {
    expect(isCapEvent(skipCooldown)).toBe(false);
    expect(isCapEvent(failure)).toBe(false);
    expect(isCapEvent(ok)).toBe(false);
  });

  it("CAP events flow through the 'all' view, not the skips/failures views", () => {
    const events = [ok, capTighten, failure, capRecover, skipCooldown];
    expect(filterTrajectory(events, "all")).toEqual(events);
    expect(filterTrajectory(events, "skips")).toEqual([skipCooldown]);
    expect(filterTrajectory(events, "failures")).toEqual([failure]);
  });
});

describe("filterTrajectory", () => {
  const events = [ok, skipCooldown, failure, skipBusy];

  it("all returns every event in order", () => {
    expect(filterTrajectory(events, "all")).toEqual(events);
  });

  it("skips returns only skip events (both reasons)", () => {
    expect(filterTrajectory(events, "skips")).toEqual([skipCooldown, skipBusy]);
  });

  it("failures excludes skip events", () => {
    expect(filterTrajectory(events, "failures")).toEqual([failure]);
  });

  it("empty input yields empty output for every filter", () => {
    expect(filterTrajectory([], "all")).toEqual([]);
    expect(filterTrajectory([], "skips")).toEqual([]);
    expect(filterTrajectory([], "failures")).toEqual([]);
  });
});

describe("summarizeSkips", () => {
  it("counts skips per reason and ignores non-skip events", () => {
    const events = [ok, skipCooldown, failure, skipCooldown, skipBusy];
    const s = summarizeSkips(events);
    expect(s.total).toBe(3);
    expect(s.byReason["cooldown"]).toBe(2);
    expect(s.byReason["provider_busy"]).toBe(1);
  });

  it("skip events without a recognized reason land in 'other'", () => {
    const bare: AgentEvent = { agent: "ProviderRouter", action: "skip_provider", resumeId: "x" };
    const s = summarizeSkips([bare, bare]);
    expect(s.total).toBe(2);
    expect(s.byReason["other"]).toBe(2);
  });

  it("no skip events → zero summary", () => {
    const s = summarizeSkips([ok, failure]);
    expect(s.total).toBe(0);
    expect(Object.keys(s.byReason)).toHaveLength(0);
  });
});

describe("describeSkipReason", () => {
  it("cooldown: class, layer and REAL remaining seconds", () => {
    const d = describeSkipReason(skipCooldown);
    expect(d).toContain("cooldown");
    expect(d).toContain("quota");
    expect(d).toContain("session");
    expect(d).toContain("1795s remaining"); // ceil(1795000/1000)
  });

  it("provider_busy: in-flight count, cap and wait time", () => {
    const d = describeSkipReason(skipBusy);
    expect(d).toContain("provider busy");
    expect(d).toContain("4 in-flight");
    expect(d).toContain("cap 2");
    expect(d).toContain("10.0s");
  });

  it("upstream_quota_divert: upstream domain, blocked sibling and remaining window", () => {
    const d = describeSkipReason({
      agent: "ProviderRouter",
      action: "skip_provider",
      resumeId: "ZenCode",
      provider: "ZenCode",
      success: false,
      metadata: {
        reason: "upstream_quota_divert",
        class: "429",
        layer: "upstream",
        domain: "opencode.ai",
        blockedBy: "p_opencode",
        remainingMs: 1_500_000,
        requestType: "chat",
      },
    } as AgentEvent);
    expect(d).toContain("upstream 429 — diverted");
    expect(d).toContain("opencode.ai");
    expect(d).toContain("sibling p_opencode");
    expect(d).toContain("1500s remaining");
  });

  it("upstream_quota_divert with minimal metadata degrades gracefully", () => {
    const d = describeSkipReason({
      agent: "ProviderRouter",
      action: "skip_provider",
      resumeId: "x",
      success: false,
      metadata: { reason: "upstream_quota_divert" },
    } as AgentEvent);
    expect(d).toBe("upstream 429 — diverted");
  });

  it("cooldown with minimal metadata degrades gracefully", () => {
    const d = describeSkipReason({
      agent: "ProviderRouter",
      action: "skip_provider",
      resumeId: "x",
      success: false,
      metadata: { reason: "cooldown" },
    });
    expect(d).toContain("cooldown");
    expect(d).not.toBe("");
  });

  it("unknown reasons fall back to the generic form", () => {
    const d = describeSkipReason({
      agent: "ProviderRouter",
      action: "skip_provider",
      resumeId: "x",
      success: false,
      metadata: { reason: "budget" },
    });
    expect(d).toBe("skipped (budget)");
  });

  it("missing metadata still produces a human line", () => {
    expect(describeSkipReason({
      agent: "ProviderRouter",
      action: "skip_provider",
      resumeId: "x",
      success: false,
    })).toBe("skipped");
  });
});
