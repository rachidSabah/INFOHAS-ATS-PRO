import { describe, it, expect, beforeEach } from "vitest";
import { createEventBus, type AgentEvent, type EventBus } from "../agent-event-bus";

describe("Agent Event Bus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = createEventBus();
  });

  it("emits an event and subscribers receive it", () => {
    const received: AgentEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({
      agent: "ExperienceAgent",
      action: "modifyBullet",
      resumeId: "r_123",
      success: true,
    });

    expect(received.length).toBe(1);
    expect(received[0].agent).toBe("ExperienceAgent");
    expect(received[0].action).toBe("modifyBullet");
    expect(received[0].timestamp).toBeTruthy();
  });

  it("auto-fills timestamp and defaults", () => {
    const received: AgentEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({ agent: "GuardianAgent", action: "validate", resumeId: "r_1" });

    expect(received[0].timestamp).toBeTruthy();
    expect(received[0].duration).toBe(0);
    expect(received[0].tokens).toBe(0);
  });

  it("supports unsubscribe", () => {
    const received: AgentEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));

    bus.emit({ agent: "A", action: "x", resumeId: "r" });
    expect(received.length).toBe(1);

    unsub();
    bus.emit({ agent: "B", action: "y", resumeId: "r" });
    expect(received.length).toBe(1);
  });

  it("stores event history", () => {
    bus.emit({ agent: "A", action: "a1", resumeId: "r1" });
    bus.emit({ agent: "B", action: "a2", resumeId: "r2", tokens: 450, duration: 1200 });

    const history = bus.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].agent).toBe("A");
    expect(history[1].agent).toBe("B");
    expect(history[1].tokens).toBe(450);
    expect(history[1].duration).toBe(1200);
  });

  it("limits history to 1000 entries", () => {
    for (let i = 0; i < 1100; i++) {
      bus.emit({ agent: "Test", action: `action_${i}`, resumeId: "r" });
    }
    expect(bus.getHistory().length).toBe(1000);
  });

  it("clearHistory empties the history", () => {
    bus.emit({ agent: "A", action: "x", resumeId: "r" });
    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);
  });

  it("getStats returns current stats", () => {
    bus.emit({ agent: "A", action: "x", resumeId: "r", success: true, tokens: 100, duration: 500 });
    bus.emit({ agent: "B", action: "y", resumeId: "r", success: false, tokens: 200, duration: 300 });

    const stats = bus.getStats();
    expect(stats.totalEvents).toBe(2);
    expect(stats.successfulEvents).toBe(1);
    expect(stats.failedEvents).toBe(1);
    expect(stats.totalTokens).toBe(300);
    expect(stats.totalDuration).toBe(800);
  });

  it("multiple buses are isolated", () => {
    const bus1 = createEventBus();
    const bus2 = createEventBus();

    const r1: AgentEvent[] = [];
    const r2: AgentEvent[] = [];
    bus1.subscribe((e) => r1.push(e));
    bus2.subscribe((e) => r2.push(e));

    bus1.emit({ agent: "One", action: "x", resumeId: "r" });
    expect(r1.length).toBe(1);
    expect(r2.length).toBe(0);
  });

  it("metadata field is preserved in events", () => {
    const received: AgentEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({
      agent: "TestAgent",
      action: "test",
      resumeId: "r",
      metadata: { snapshotId: "snap_123", count: 5 },
    });

    expect(received[0].metadata).toEqual({ snapshotId: "snap_123", count: 5 });
  });
});
