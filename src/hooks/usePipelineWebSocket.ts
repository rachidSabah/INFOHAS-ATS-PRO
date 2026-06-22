"use client";

// ============================================================================
// usePipelineWebSocket — a React hook that subscribes to real-time pipeline
// updates via a WebSocket connection to the PipelineDurableObject.
//
// Architecture (P3 — Real-time Pipeline Updates):
//   - On mount, opens a WebSocket to wss://.../api/pipeline/:pipelineId/ws
//   - On connect, the server sends a snapshot event → hydrate local state
//   - Subsequent events (agent_status, progress, etc.) update local state
//   - On disconnect, exponential backoff reconnect (250ms → 500ms → 1s → 2s → 5s)
//   - On reconnect, request a fresh snapshot to catch up on missed events
//   - If WebSocket fails to connect after 3 attempts, fall back to polling
//     (every 2s) — ensures the dashboard still works in restricted networks.
//
// Feature flag: pipeline_websocket_enabled (in the Zustand store's flags).
// If false, skip WebSocket entirely and use polling from the start.
// ============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { useApp } from "@/lib/store";
import type {
  PipelineWebSocketEvent,
  PipelineSnapshot,
  SnapshotEvent,
  AgentStatusEvent,
  ProgressEvent,
  PipelineCompleteEvent,
  PipelineErrorEvent,
  HeartbeatEvent,
  ClientToServerMessage,
} from "@/lib/agents/pipeline-events";

// ============================================================================
// Config
// ============================================================================

const WS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "ws://localhost:8787" // local wrangler dev
    : "wss://resumeai-pro-pipeline.rachidelsabah.workers.dev";

const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 5000]; // exponential backoff, cap 5s
const MAX_RECONNECT_ATTEMPTS = 3; // then fall back to polling
const POLL_INTERVAL_MS = 2000; // polling fallback
const SNAPSHOT_REQUEST_TIMEOUT_MS = 5000; // if no snapshot after connect, request one

// ============================================================================
// State
// ============================================================================

export interface PipelineWebSocketState {
  /** The current snapshot of the pipeline state (or null if not yet received). */
  snapshot: PipelineSnapshot | null;
  /** Whether the WebSocket is currently connected. */
  isConnected: boolean;
  /** Number of reconnect attempts since the last successful connection. */
  reconnectAttempts: number;
  /** Whether the hook has fallen back to polling. */
  isPolling: boolean;
  /** The last error received (or null). */
  error: string | null;
}

// ============================================================================
// Hook
// ============================================================================

export function usePipelineWebSocket(
  pipelineId: string | null,
  options?: { enabled?: boolean },
): PipelineWebSocketState & {
  requestSnapshot: () => void;
} {
  const enabled = options?.enabled ?? true;
  const featureFlagEnabled = useApp((s) => s.flags?.pipeline_websocket_enabled ?? false);
  const [state, setState] = useState<PipelineWebSocketState>({
    snapshot: null,
    isConnected: false,
    reconnectAttempts: 0,
    isPolling: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastSeqRef = useRef<number>(0);
  const pipelineIdRef = useRef<string | null>(pipelineId);

  // === Apply a snapshot to local state ===
  const applySnapshot = useCallback((snapshot: PipelineSnapshot) => {
    lastSeqRef.current = snapshot.lastSeq;
    setState((prev) => ({ ...prev, snapshot, error: null }));
  }, []);

  // === Apply an incremental event to local state ===
  const applyEvent = useCallback((event: PipelineWebSocketEvent) => {
    // Track sequence number for gap detection
    if (event.seq > lastSeqRef.current + 1 && lastSeqRef.current > 0) {
      // Gap detected — request a fresh snapshot
      console.warn(
        `[usePipelineWebSocket] Gap detected: lastSeq=${lastSeqRef.current}, event.seq=${event.seq}. Requesting snapshot.`,
      );
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const msg: ClientToServerMessage = { type: "request_snapshot" };
        ws.send(JSON.stringify(msg));
      }
    }
    lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);

    setState((prev) => {
      if (!prev.snapshot) return prev;
      const snapshot = { ...prev.snapshot };

      switch (event.type) {
        case "agent_status": {
          const ae = event as AgentStatusEvent;
          snapshot.agents = snapshot.agents.map((a) =>
            a.id === ae.agentId
              ? {
                  ...a,
                  status: ae.status,
                  log: ae.log ?? a.log,
                  error: ae.error ?? a.error,
                  completedAt: ["completed", "failed", "skipped", "cached"].includes(ae.status)
                    ? ae.timestamp
                    : a.completedAt,
                  startedAt: ae.status === "running" && a.status === "pending"
                    ? ae.timestamp
                    : a.startedAt,
                }
              : a,
          );
          break;
        }
        case "progress": {
          const pe = event as ProgressEvent;
          snapshot.progress = {
            stepIndex: pe.stepIndex,
            totalSteps: pe.totalSteps,
            percent: pe.percent,
            etaSeconds: pe.etaSeconds,
            stepName: pe.stepName,
          };
          break;
        }
        case "pipeline_complete": {
          const pc = event as PipelineCompleteEvent;
          snapshot.isRunning = false;
          snapshot.completedAt = event.timestamp;
          break;
        }
        case "error": {
          const ee = event as PipelineErrorEvent;
          return { ...prev, error: ee.message };
        }
        case "snapshot": {
          // Full snapshot — replace local state entirely
          const se = event as SnapshotEvent;
          return { ...prev, snapshot: se.state, error: null };
        }
        case "heartbeat": {
          // No state change — just a keepalive
          return prev;
        }
      }
      return { ...prev, snapshot, error: null };
    });
  }, []);

  // === Connect to the WebSocket ===
  const connect = useCallback(() => {
    if (!pipelineIdRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = `${WS_BASE_URL}/api/pipeline/${pipelineIdRef.current}/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e: any) {
      console.warn("[usePipelineWebSocket] WebSocket construction failed:", e?.message);
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      console.info("[usePipelineWebSocket] Connected");
      reconnectAttemptsRef.current = 0;
      setState((prev) => ({
        ...prev,
        isConnected: true,
        reconnectAttempts: 0,
        isPolling: false,
        error: null,
      }));

      // Set a timeout — if no snapshot arrives within 5s, explicitly request one
      snapshotTimerRef.current = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const msg: ClientToServerMessage = { type: "request_snapshot" };
          ws.send(JSON.stringify(msg));
        }
      }, SNAPSHOT_REQUEST_TIMEOUT_MS);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as PipelineWebSocketEvent;
        // Clear the snapshot-request timeout if we receive any event
        if (snapshotTimerRef.current) {
          clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = null;
        }
        applyEvent(data);
      } catch (e) {
        console.warn("[usePipelineWebSocket] Failed to parse message:", e);
      }
    };

    ws.onerror = (event) => {
      console.warn("[usePipelineWebSocket] WebSocket error");
      setState((prev) => ({ ...prev, error: "WebSocket error" }));
    };

    ws.onclose = () => {
      console.info("[usePipelineWebSocket] Disconnected");
      wsRef.current = null;
      setState((prev) => ({ ...prev, isConnected: false }));

      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }

      scheduleReconnect();
    };
  }, [applyEvent]);

  // === Schedule a reconnect with exponential backoff ===
  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[usePipelineWebSocket] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Falling back to polling.`,
      );
      startPolling();
      return;
    }

    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttemptsRef.current, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttemptsRef.current += 1;
    setState((prev) => ({ ...prev, reconnectAttempts: reconnectAttemptsRef.current }));

    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  // === Polling fallback ===
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return; // already polling
    setState((prev) => ({ ...prev, isPolling: true }));

    const poll = async () => {
      if (!pipelineIdRef.current) return;
      try {
        const res = await fetch(`${WS_BASE_URL}/api/pipeline/${pipelineIdRef.current}/snapshot`);
        if (res.ok) {
          const snapshot = await res.json() as PipelineSnapshot;
          applySnapshot(snapshot);
        }
      } catch (e) {
        // ignore — try again next interval
      }
    };

    poll(); // immediate poll
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [applySnapshot]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setState((prev) => ({ ...prev, isPolling: false }));
  }, []);

  // === Manual snapshot request ===
  const requestSnapshot = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientToServerMessage = { type: "request_snapshot" };
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // === Effect: connect on mount, disconnect on unmount ===
  useEffect(() => {
    pipelineIdRef.current = pipelineId;
    if (!enabled || !pipelineId) return;

    // If feature flag is off, go straight to polling
    if (!featureFlagEnabled) {
      startPolling();
      return () => {
        stopPolling();
      };
    }

    // Feature flag is on — try WebSocket first
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
      stopPolling();
    };
  }, [pipelineId, enabled, featureFlagEnabled, connect, startPolling, stopPolling]);

  return {
    ...state,
    requestSnapshot,
  };
}
