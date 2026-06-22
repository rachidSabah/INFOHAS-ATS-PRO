"use client";

// ============================================================================
// usePipelineWebSocket — DEPRECATED.
//
// This hook previously used WebSocket + Durable Objects for real-time pipeline
// updates. That required the Cloudflare Workers Paid plan.
//
// The platform now runs entirely on the Cloudflare Free plan using:
//   D1 + Polling (every 2 seconds)
//
// This hook is kept for backward compatibility but now uses polling internally.
// New code should use useTaskPolling() directly.
//
// See: src/hooks/useTaskPolling.ts
// ============================================================================

import { useTaskPolling, createTask, updateTaskProgress, type TaskState } from "./useTaskPolling";

export type { TaskState };
export type PipelineWebSocketState = {
  snapshot: TaskState | null;
  isConnected: boolean;
  reconnectAttempts: number;
  isPolling: boolean;
  error: string | null;
};

/**
 * @deprecated Use useTaskPolling() directly.
 *
 * This hook now uses D1 polling internally (no WebSockets, no Durable Objects).
 */
export function usePipelineWebSocket(
  pipelineId: string | null,
  options?: { enabled?: boolean },
): PipelineWebSocketState & {
  requestSnapshot: () => void;
} {
  const { task, isLoading, error, isTerminal, refetch } = useTaskPolling(pipelineId);

  return {
    snapshot: task,
    isConnected: !isLoading && !!task,
    reconnectAttempts: 0,
    isPolling: !isTerminal && !!pipelineId,
    error,
    requestSnapshot: refetch,
  };
}

export { createTask, updateTaskProgress };
