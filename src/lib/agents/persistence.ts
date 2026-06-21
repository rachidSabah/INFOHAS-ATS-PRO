// ============================================================================
// Pipeline Persistence + Recovery + Timeline + Metrics
//
// Persists the Supervisor's state (context + agent states + events + metrics)
// to localStorage so pipelines survive browser refresh, logout/login, network
// interruption, and browser crash. On load, the Supervisor calls loadSnapshot()
// to restore the exact state where it stopped.
//
// Cloudflare D1/KV sync is a future enhancement — for the Free tier, localStorage
// is sufficient and avoids the complexity of server-side state management.
// ============================================================================

import type { SupervisorState } from "./supervisor";
import type { AgentState, AgentId, PipelineEvent } from "./pipeline-context";

const SNAPSHOT_KEY = "resumeai-pipeline-snapshot";
const METRICS_KEY = "resumeai-pipeline-metrics";

// ============================================================================
// Snapshot persistence
// ============================================================================

export interface PipelineSnapshot {
  pipelineId: string;
  userId: string | null;
  resumeId: string | null;
  jobId: string | null;
  /** ISO timestamp when this snapshot was created */
  timestamp: string;
  /** The full Supervisor state (context + agents + events + isRunning) */
  state: {
    context: SupervisorState["context"];
    agents: Record<string, AgentState>;
    events: PipelineEvent[];
    isRunning: boolean;
  };
}

/**
 * Save the current Supervisor state as a snapshot to localStorage.
 * Called after every agent status change + every context update.
 */
export function saveSnapshot(state: SupervisorState): void {
  if (typeof localStorage === "undefined") return;
  try {
    const snapshot: PipelineSnapshot = {
      pipelineId: state.context.optimizationId ?? `${state.context.resumeId ?? "none"}-${state.context.jobId ?? "none"}`,
      userId: state.context.userId,
      resumeId: state.context.resumeId,
      jobId: state.context.jobId,
      timestamp: new Date().toISOString(),
      state: {
        context: state.context,
        agents: state.agents,
        events: state.events,
        isRunning: state.isRunning,
      },
    };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (e) {
    // localStorage may be full or unavailable — non-fatal
    console.warn("[persistence] Failed to save snapshot:", e);
  }
}

/**
 * Load the most recent snapshot from localStorage.
 * Called on app load (in rehydrateSession or a dedicated useEffect).
 * Returns null if no snapshot exists.
 */
export function loadSnapshot(): PipelineSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as PipelineSnapshot;
    // Basic shape validation
    if (!snapshot.state || !snapshot.state.agents || !snapshot.state.context) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Clear the snapshot (e.g. on sign-out or after a completed pipeline).
 */
export function clearSnapshot(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {}
}

// ============================================================================
// Agent metrics (aggregate stats across all pipeline runs)
// ============================================================================

export interface AgentMetrics {
  /** Total number of times this agent has been invoked */
  totalRuns: number;
  /** Number of successful completions */
  successes: number;
  /** Number of failures */
  failures: number;
  /** Number of retries */
  retries: number;
  /** Total execution time in ms (across all runs) */
  totalDurationMs: number;
  /** Last execution timestamp */
  lastRunAt: string | null;
}

export type MetricsMap = Record<string, AgentMetrics>;

/**
 * Load the aggregate metrics map from localStorage.
 */
export function loadMetrics(): MetricsMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(METRICS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as MetricsMap;
  } catch {
    return {};
  }
}

/**
 * Save the aggregate metrics map to localStorage.
 */
export function saveMetrics(metrics: MetricsMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
  } catch (e) {
    console.warn("[persistence] Failed to save metrics:", e);
  }
}

/**
 * Record a metric event for an agent. Updates the aggregate metrics map
 * and persists it. Called after every agent status transition to a
 * terminal state (Completed, Failed, Skipped).
 */
export function recordAgentMetric(
  agentId: string,
  event: "success" | "failure" | "retry",
  durationMs?: number,
): void {
  const metrics = loadMetrics();
  if (!metrics[agentId]) {
    metrics[agentId] = {
      totalRuns: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      totalDurationMs: 0,
      lastRunAt: null,
    };
  }
  const m = metrics[agentId];
  if (event === "success") {
    m.totalRuns++;
    m.successes++;
    if (durationMs) m.totalDurationMs += durationMs;
    m.lastRunAt = new Date().toISOString();
  } else if (event === "failure") {
    m.totalRuns++;
    m.failures++;
    if (durationMs) m.totalDurationMs += durationMs;
    m.lastRunAt = new Date().toISOString();
  } else if (event === "retry") {
    m.retries++;
  }
  saveMetrics(metrics);
}

/**
 * Get aggregate pipeline success rate from the metrics map.
 */
export function getPipelineSuccessRate(metrics: MetricsMap): number {
  const supervisor = metrics["supervisor"];
  if (!supervisor || supervisor.totalRuns === 0) return 0;
  return Math.round((supervisor.successes / supervisor.totalRuns) * 100);
}

/**
 * Get average pipeline duration from the metrics map.
 */
export function getAveragePipelineDuration(metrics: MetricsMap): number {
  const supervisor = metrics["supervisor"];
  if (!supervisor || supervisor.totalRuns === 0) return 0;
  return Math.round(supervisor.totalDurationMs / supervisor.totalRuns);
}

// ============================================================================
// Execution timeline
// ============================================================================

export interface TimelineEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Agent ID */
  agentId: string;
  /** Agent name (human-readable) */
  agentName: string;
  /** Event type */
  event: "start" | "complete" | "retry" | "fail" | "recover" | "cache-hit";
  /** Duration in ms (for complete/fail events) */
  durationMs?: number;
  /** Error message (for fail events) */
  error?: string;
  /** Log message */
  message: string;
}

const TIMELINE_KEY = "resumeai-pipeline-timeline";
const MAX_TIMELINE_ENTRIES = 200;

/**
 * Load the execution timeline from localStorage.
 */
export function loadTimeline(): TimelineEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(TIMELINE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TimelineEntry[];
  } catch {
    return [];
  }
}

/**
 * Append a timeline entry and persist. Keeps the last MAX_TIMELINE_ENTRIES.
 */
export function appendTimelineEntry(entry: TimelineEntry): void {
  if (typeof localStorage === "undefined") return;
  try {
    const timeline = loadTimeline();
    timeline.push(entry);
    // Keep only the most recent entries
    const trimmed = timeline.slice(-MAX_TIMELINE_ENTRIES);
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("[persistence] Failed to append timeline entry:", e);
  }
}

/**
 * Clear the timeline (e.g. on sign-out).
 */
export function clearTimeline(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(TIMELINE_KEY);
  } catch {}
}

// ============================================================================
// Full reset — clear all persisted pipeline state
// ============================================================================

export function clearAllPipelineState(): void {
  clearSnapshot();
  // Don't clear metrics — they're aggregate stats useful across sessions.
  // Don't clear timeline — it's useful for debugging across sessions.
  // But DO clear them on explicit sign-out (called by resetSupervisor).
}

export function clearAllPipelineStateIncludingMetrics(): void {
  clearSnapshot();
  clearTimeline();
  if (typeof localStorage !== "undefined") {
    try { localStorage.removeItem(METRICS_KEY); } catch {}
  }
}
