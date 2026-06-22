// ============================================================================
// PipelineEvent — the discriminated union of events that the Durable Object
// broadcasts to subscribed WebSocket clients.
//
// Design principles:
//   - Every event is JSON-serializable (no Date objects, no Maps, no undefined).
//   - Every event is idempotent (receiving the same event twice is safe).
//   - Every event includes a monotonic sequence number so clients can detect
//     gaps and request a full state snapshot to catch up.
//   - Every event includes a timestamp (ISO 8601) for client-side ordering.
//
// This file is imported by:
//   - The Durable Object (workers/pipeline-do/index.ts) — produces events.
//   - The client hook (src/hooks/usePipelineWebSocket.ts) — consumes events.
//   - The supervisor (src/lib/agents/supervisor.ts) — produces agent_status
//     events via the DO's REST API.
//
// CRITICAL: This file must be importable from both the worker (Cloudflare
// runtime) and the client (browser). It must NOT import any browser-only or
// worker-only modules.
// ============================================================================

export type PipelineWebSocketEvent =
  | AgentStatusEvent
  | ProgressEvent
  | AgentResultEvent
  | PipelineCompleteEvent
  | PipelineErrorEvent
  | SnapshotEvent
  | HeartbeatEvent;

export interface AgentStatusEvent {
  type: "agent_status";
  /** Monotonic sequence number — clients use this to detect gaps. */
  seq: number;
  timestamp: string;
  agentId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "cached";
  log?: string;
  /** Present when status transitions to "failed". */
  error?: string;
  /** Present when status transitions to "completed" or "cached". */
  resultSummary?: string;
  /** Optional metrics (latencyMs, tokensUsed, etc.). */
  metrics?: Record<string, number>;
}

export interface ProgressEvent {
  type: "progress";
  seq: number;
  timestamp: string;
  stepIndex: number;
  totalSteps: number;
  percent: number;
  etaSeconds: number;
  stepName: string;
}

export interface AgentResultEvent {
  type: "agent_result";
  seq: number;
  timestamp: string;
  agentId: string;
  /** The full result payload. Clients should treat this as opaque JSON. */
  result: unknown;
}

export interface PipelineCompleteEvent {
  type: "pipeline_complete";
  seq: number;
  timestamp: string;
  finalStatus: "completed" | "failed";
  summary: string;
  /** Total pipeline duration in milliseconds. */
  durationMs: number;
  /** Counts of agents in each terminal state. */
  counts: {
    completed: number;
    failed: number;
    skipped: number;
    cached: number;
  };
}

export interface PipelineErrorEvent {
  type: "error";
  seq: number;
  timestamp: string;
  agentId?: string;
  message: string;
  recoverable: boolean;
}

/**
 * Snapshot event — sent to a client immediately after it connects, so the
 * client can hydrate its local state without waiting for individual events.
 * Also sent on demand when a client detects a gap in the sequence numbers.
 */
export interface SnapshotEvent {
  type: "snapshot";
  seq: number;
  timestamp: string;
  /** The full current pipeline state. Clients should REPLACE their state. */
  state: PipelineSnapshot;
}

export interface HeartbeatEvent {
  type: "heartbeat";
  seq: number;
  timestamp: string;
}

// ============================================================================
// PipelineSnapshot — the full state of a pipeline run at a point in time.
// ============================================================================

export interface PipelineSnapshot {
  pipelineId: string;
  optimizationId: string | null;
  resumeId: string | null;
  jobId: string | null;
  companyName: string | null;
  jobTitle: string | null;
  isRunning: boolean;
  startedAt: string;
  /** Present when the pipeline has reached a terminal state. */
  completedAt?: string;
  /** The current status of every agent. */
  agents: Array<{
    id: string;
    name: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped" | "cached";
    log?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }>;
  /** The latest progress event (or null if none has been emitted yet). */
  progress: {
    stepIndex: number;
    totalSteps: number;
    percent: number;
    etaSeconds: number;
    stepName: string;
  } | null;
  /** The highest sequence number the server has emitted. */
  lastSeq: number;
}

// ============================================================================
// Client → Server messages
// ============================================================================

/**
 * Messages the client can send to the Durable Object over the WebSocket.
 * The DO responds to these via events (not direct acks).
 */
export type ClientToServerMessage =
  | { type: "request_snapshot" }
  | { type: "subscribe"; pipelineId: string }
  | { type: "ping" };

// ============================================================================
// Helpers
// ============================================================================

/** Returns true if the event is one that should trigger a UI update. */
export function isStateChangingEvent(event: PipelineWebSocketEvent): boolean {
  return (
    event.type === "agent_status" ||
    event.type === "progress" ||
    event.type === "pipeline_complete" ||
    event.type === "snapshot" ||
    event.type === "error"
  );
}

/** Returns true if the event is a heartbeat / keepalive (no state change). */
export function isHeartbeatEvent(event: PipelineWebSocketEvent): boolean {
  return event.type === "heartbeat";
}
