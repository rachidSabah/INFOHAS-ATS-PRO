// Tests for the PipelineEvent schema and the usePipelineWebSocket hook contract.
//
// These tests verify the discriminated union shape and the helper functions.
// The actual WebSocket logic is not tested here (it requires a real DO) —
// the hook's behavior is tested via integration tests in CI.

import { describe, it, expect } from "vitest";
import {
  isStateChangingEvent,
  isHeartbeatEvent,
  type PipelineWebSocketEvent,
} from "./pipeline-events";

describe("PipelineEvent schema", () => {
  describe("isStateChangingEvent", () => {
    it("returns true for agent_status events", () => {
      const event: PipelineWebSocketEvent = {
        type: "agent_status",
        seq: 1,
        timestamp: new Date().toISOString(),
        agentId: "supervisor",
        status: "running",
      };
      expect(isStateChangingEvent(event)).toBe(true);
    });

    it("returns true for progress events", () => {
      const event: PipelineWebSocketEvent = {
        type: "progress",
        seq: 1,
        timestamp: new Date().toISOString(),
        stepIndex: 0,
        totalSteps: 6,
        percent: 16,
        etaSeconds: 60,
        stepName: "Resume Parser",
      };
      expect(isStateChangingEvent(event)).toBe(true);
    });

    it("returns true for pipeline_complete events", () => {
      const event: PipelineWebSocketEvent = {
        type: "pipeline_complete",
        seq: 10,
        timestamp: new Date().toISOString(),
        finalStatus: "completed",
        summary: "Pipeline completed",
        durationMs: 30000,
        counts: { completed: 8, failed: 0, skipped: 3, cached: 0 },
      };
      expect(isStateChangingEvent(event)).toBe(true);
    });

    it("returns true for snapshot events", () => {
      const event: PipelineWebSocketEvent = {
        type: "snapshot",
        seq: 0,
        timestamp: new Date().toISOString(),
        state: {
          pipelineId: "p1",
          optimizationId: null,
          resumeId: null,
          jobId: null,
          companyName: null,
          jobTitle: null,
          isRunning: false,
          startedAt: new Date().toISOString(),
          agents: [],
          progress: null,
          lastSeq: 0,
        },
      };
      expect(isStateChangingEvent(event)).toBe(true);
    });

    it("returns true for error events", () => {
      const event: PipelineWebSocketEvent = {
        type: "error",
        seq: 5,
        timestamp: new Date().toISOString(),
        message: "Agent failed",
        recoverable: false,
      };
      expect(isStateChangingEvent(event)).toBe(true);
    });

    it("returns false for heartbeat events", () => {
      const event: PipelineWebSocketEvent = {
        type: "heartbeat",
        seq: 100,
        timestamp: new Date().toISOString(),
      };
      expect(isStateChangingEvent(event)).toBe(false);
    });
  });

  describe("isHeartbeatEvent", () => {
    it("returns true for heartbeat events", () => {
      const event: PipelineWebSocketEvent = {
        type: "heartbeat",
        seq: 1,
        timestamp: new Date().toISOString(),
      };
      expect(isHeartbeatEvent(event)).toBe(true);
    });

    it("returns false for non-heartbeat events", () => {
      const event: PipelineWebSocketEvent = {
        type: "agent_status",
        seq: 1,
        timestamp: new Date().toISOString(),
        agentId: "supervisor",
        status: "running",
      };
      expect(isHeartbeatEvent(event)).toBe(false);
    });
  });

  describe("Event schema invariants", () => {
    it("every event has a seq number and timestamp", () => {
      const events: PipelineWebSocketEvent[] = [
        { type: "agent_status", seq: 1, timestamp: new Date().toISOString(), agentId: "a", status: "running" },
        { type: "progress", seq: 2, timestamp: new Date().toISOString(), stepIndex: 0, totalSteps: 6, percent: 16, etaSeconds: 60, stepName: "Test" },
        { type: "pipeline_complete", seq: 3, timestamp: new Date().toISOString(), finalStatus: "completed", summary: "Done", durationMs: 1000, counts: { completed: 1, failed: 0, skipped: 0, cached: 0 } },
        { type: "error", seq: 4, timestamp: new Date().toISOString(), message: "err", recoverable: false },
        { type: "heartbeat", seq: 5, timestamp: new Date().toISOString() },
      ];
      for (const event of events) {
        expect(typeof event.seq).toBe("number");
        expect(event.seq).toBeGreaterThan(0);
        expect(typeof event.timestamp).toBe("string");
        expect(new Date(event.timestamp).toString()).not.toBe("Invalid Date");
      }
    });
  });
});
