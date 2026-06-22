"use client";

// ============================================================================
// useTaskPolling — a React hook that polls D1 for task status updates.
//
// Replaces the WebSocket-based usePipelineWebSocket hook. Works entirely on
// the Cloudflare Free plan — no Durable Objects, no WebSockets required.
//
// Architecture:
//   1. Frontend creates a task: POST /api/tasks/create → { task: { id } }
//   2. Frontend polls: GET /api/tasks/:id/status every 2 seconds
//   3. Polling auto-stops when status ∈ {completed, failed, cancelled}
//   4. (Optional) SSE: GET /api/tasks/:id/events — if available, replaces polling
//
// Usage:
//   const { task, isLoading, error, cancel } = useTaskPolling(taskId);
//
// Or create + track in one call:
//   const { task, createTask } = useTaskPolling();
//   await createTask({ type: "optimization", message: "Optimizing resume..." });
// ============================================================================

import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = "https://resumeai-pro-api.rachidelsabah.workers.dev";
const POLL_INTERVAL_MS = 2000;

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TaskState {
  id: string;
  status: TaskStatus;
  progress: number;
  message: string | null;
  error: string | null;
  updated_at: number;
}

export interface UseTaskPollingResult {
  /** The current task state (null if not yet created or not found). */
  task: TaskState | null;
  /** True while the initial fetch is in progress. */
  isLoading: boolean;
  /** Error message if the fetch failed (null otherwise). */
  error: string | null;
  /** Whether the task is in a terminal state (completed/failed/cancelled). */
  isTerminal: boolean;
  /** Cancel the task (POST /api/tasks/:id/cancel). */
  cancel: () => Promise<boolean>;
  /** Manually refetch the task status. */
  refetch: () => void;
}

/**
 * Check if a status is terminal (polling should stop).
 */
function isTerminalStatus(status: TaskStatus | undefined | null): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * Hook that polls a task's status every 2 seconds.
 * Auto-stops when the task reaches a terminal status.
 */
export function useTaskPolling(taskId: string | null): UseTaskPollingResult {
  const [task, setTask] = useState<TaskState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!taskId) return;

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/status`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Task not found");
          setTask(null);
        } else {
          setError(`HTTP ${res.status}`);
        }
        return;
      }

      const data = await res.json();
      if (data.ok) {
        setTask({
          id: data.id,
          status: data.status,
          progress: data.progress,
          message: data.message,
          error: data.error,
          updated_at: data.updated_at,
        });
        setError(null);
      } else {
        setError(data.error || "Failed to fetch task status");
      }
    } catch (e: any) {
      // Don't set error on network failures — just keep polling.
      // The next poll will likely succeed.
      console.warn("[useTaskPolling] Fetch failed (will retry):", e?.message);
    }
  }, [taskId]);

  // Start polling when taskId is set
  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    fetchStatus().finally(() => setIsLoading(false));

    // Set up the 2s polling interval
    intervalRef.current = setInterval(() => {
      // Check if the task is terminal BEFORE fetching
      setTask((currentTask) => {
        if (isTerminalStatus(currentTask?.status)) {
          // Stop polling
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return currentTask;
        }
        // Continue polling
        fetchStatus();
        return currentTask;
      });
    }, POLL_INTERVAL_MS);

    // Cleanup on unmount or taskId change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [taskId, fetchStatus]);

  // Stop polling when task reaches terminal status
  useEffect(() => {
    if (isTerminalStatus(task?.status) && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [task?.status]);

  const cancel = useCallback(async (): Promise<boolean> => {
    if (!taskId) return false;
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, { method: "POST" });
      if (res.ok) {
        // Immediately update local state
        setTask((prev) => prev ? { ...prev, status: "cancelled", message: "Cancelled by user" } : prev);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [taskId]);

  const refetch = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    task,
    isLoading,
    error,
    isTerminal: isTerminalStatus(task?.status),
    cancel,
    refetch,
  };
}

// ============================================================================
// Task creation helper
// ============================================================================

export interface CreateTaskInput {
  type: string;
  message?: string;
}

export interface CreateTaskResult {
  ok: boolean;
  task?: { id: string; type: string; status: string; progress: number; message: string };
  error?: string;
}

/**
 * Create a new task in D1. Returns the task ID for polling.
 */
export async function createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (data.ok) {
      return { ok: true, task: data.task };
    }
    return { ok: false, error: data.error || "Failed to create task" };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

/**
 * Update a task's progress (called from the client-side worker that runs the task).
 * In a typical flow, the client creates the task, then runs the work locally,
 * updating progress via this function.
 */
export async function updateTaskProgress(
  taskId: string,
  update: {
    status?: TaskStatus;
    progress?: number;
    message?: string;
    result?: any;
    error?: string;
  },
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get the full task record (including result_json) — call this when the task
 * is completed to fetch the result.
 */
export async function getTaskResult(taskId: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.task) {
      return data.task.result;
    }
    return null;
  } catch {
    return null;
  }
}
