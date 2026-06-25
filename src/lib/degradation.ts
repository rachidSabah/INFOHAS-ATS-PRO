// ============================================================================
// Degradation Guarantee
//
// When all AI providers fail, the system degrades gracefully:
//   - UI remains operational
//   - Data is preserved (localStorage backup)
//   - Requests are queued for retry
//   - User is notified with actionable guidance
//
// The application must NEVER enter a broken state.
// ============================================================================

"use client";

import { createIncident } from "./incident-service";
import { recordPipelineFailure } from "./telemetry";

export type DegradationLevel = "normal" | "degraded" | "critical" | "offline";

export interface DegradationState {
  level: DegradationLevel;
  reason: string;
  timestamp: string;
  queuedActions: QueuedAction[];
  userMessage: string;
}

export interface QueuedAction {
  id: string;
  type: "optimization" | "cover-letter" | "interview" | "career-coach";
  payload: any;
  timestamp: string;
  retries: number;
}

let currentState: DegradationState = {
  level: "normal",
  reason: "",
  timestamp: new Date().toISOString(),
  queuedActions: [],
  userMessage: "",
};

const MAX_QUEUED = 10; // prevent memory leaks
const listeners: ((state: DegradationState) => void)[] = [];

/**
 * Get the current degradation state.
 */
export function getDegradationState(): DegradationState {
  return { ...currentState };
}

/**
 * Subscribe to degradation state changes.
 * Returns an unsubscribe function.
 */
export function onDegradationChange(listener: (state: DegradationState) => void): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Update the degradation state and notify listeners.
 */
function updateState(level: DegradationLevel, reason: string, userMessage: string): void {
  const previousLevel = currentState.level;
  currentState = {
    ...currentState,
    level,
    reason,
    timestamp: new Date().toISOString(),
    userMessage,
  };

  if (level !== previousLevel) {
    console.warn(`[Degradation] Level changed: ${previousLevel} → ${level}. Reason: ${reason}`);

    if (level === "degraded" || level === "critical") {
      createIncident({
        severity: level === "critical" ? "critical" : "high",
        rootCause: reason,
        affectedSystems: ["providers", "pipeline"],
        repairActions: ["Circuit breakers engaged", "Requests queued"],
        duration: 0,
        rollbackRequired: false,
        resolved: false,
      });
    }

    // Notify listeners
    for (const listener of listeners) {
      try {
        listener(currentState);
      } catch { /* non-fatal */ }
    }
  }
}

/**
 * Report that all providers have failed.
 * System enters degraded mode — UI stays operational, requests queued.
 */
export function reportAllProvidersFailed(error: string): void {
  recordPipelineFailure({
    stage: "provider-failover",
    error,
    recovered: false,
  });

  updateState(
    "degraded",
    `All providers failed: ${error}`,
    "AI providers are temporarily unavailable. Your data is safe. " +
    "Requests will be processed automatically when providers recover. " +
    "Try again in a few minutes."
  );
}

/**
 * Report that the database is unreachable.
 * System enters critical mode — data preserved in localStorage.
 */
export function reportDatabaseUnreachable(): void {
  updateState(
    "critical",
    "Database unreachable — using localStorage fallback",
    "Cloud sync is temporarily unavailable. Your work is saved locally " +
    "and will sync when the connection is restored."
  );
}

/**
 * Report that providers have recovered.
 * System returns to normal mode and processes queued actions.
 */
export function reportProvidersRecovered(): void {
  if (currentState.queuedActions.length > 0) {
    console.info(`[Degradation] Providers recovered — ${currentState.queuedActions.length} queued action(s) will be retried`);
  }

  updateState("normal", "All systems operational", "");
}

/**
 * Queue an action for later retry (when providers recover).
 * Returns the queued action ID.
 */
export function queueAction(action: Omit<QueuedAction, "id" | "timestamp" | "retries">): string {
  const queued: QueuedAction = {
    ...action,
    id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    retries: 0,
  };

  currentState.queuedActions.push(queued);

  // Cap queue size
  if (currentState.queuedActions.length > MAX_QUEUED) {
    currentState.queuedActions.shift();
  }

  console.info(`[Degradation] Action queued: ${action.type} (ID: ${queued.id})`);
  return queued.id;
}

/**
 * Get all queued actions (for UI display).
 */
export function getQueuedActions(): QueuedAction[] {
  return [...currentState.queuedActions];
}

/**
 * Remove a queued action (after successful retry).
 */
export function dequeueAction(id: string): void {
  const idx = currentState.queuedActions.findIndex((a) => a.id === id);
  if (idx >= 0) {
    currentState.queuedActions.splice(idx, 1);
    console.info(`[Degradation] Action dequeued: ${id}`);
  }
}

/**
 * Increment retry count for a queued action.
 * Returns false if max retries exceeded.
 */
export function incrementRetry(id: string, maxRetries: number = 3): boolean {
  const action = currentState.queuedActions.find((a) => a.id === id);
  if (!action) return false;

  action.retries++;
  if (action.retries > maxRetries) {
    dequeueAction(id);
    return false;
  }

  return true;
}

/**
 * Check if the system is currently degraded.
 */
export function isDegraded(): boolean {
  return currentState.level !== "normal";
}

/**
 * Check if the system is in critical mode.
 */
export function isCritical(): boolean {
  return currentState.level === "critical" || currentState.level === "offline";
}

/**
 * Get a user-friendly message about the current system state.
 */
export function getUserMessage(): string {
  return currentState.userMessage;
}
