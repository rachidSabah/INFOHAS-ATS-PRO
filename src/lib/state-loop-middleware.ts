// ============================================================================
// State Loop Detection Middleware for Zustand
//
// Tracks state updates and aborts if the same action fires more than 20 times
// in 2 seconds — prevents infinite render loops.
//
// Usage:
//   import { withLoopGuard } from "./state-loop-middleware";
//   // Wrap store actions:
//   addProvider: withLoopGuard("addProvider", (p) => { ... })
// ============================================================================

"use client";

interface ActionRecord {
  action: string;
  timestamp: number;
}

const actionLog: ActionRecord[] = [];
const WINDOW_MS = 2000;
const MAX_ACTIONS = 20;
const actionCounts = new Map<string, number>();
let lastWarned = 0;

/**
 * Track a state action. If the same action fires > MAX_ACTIONS times
 * within WINDOW_MS, return true (indicating the action should be aborted).
 */
export function detectLoop(action: string): boolean {
  const now = Date.now();
  actionLog.push({ action, timestamp: now });

  // Prune old entries
  while (actionLog.length > 0 && now - actionLog[0].timestamp > WINDOW_MS) {
    actionLog.shift();
  }

  // Count occurrences of this action in the window
  const count = actionLog.filter((r) => r.action === action).length;

  if (count > MAX_ACTIONS) {
    if (now - lastWarned > 1000) {
      lastWarned = now;
      console.error(
        `[STATE LOOP] "${action}" fired ${count} times in ${WINDOW_MS}ms. ` +
        `Aborting — this indicates an infinite loop.`
      );
    }
    return true; // Abort
  }

  return false; // OK
}

/**
 * Wrap a Zustand setter with loop detection.
 * If the same setter fires > 20 times in 2 seconds, subsequent calls are silently dropped.
 */
export function withLoopGuard<T extends (...args: any[]) => any>(
  actionName: string,
  fn: T,
): T {
  return ((...args: Parameters<T>) => {
    if (detectLoop(actionName)) {
      return; // Abort — loop detected
    }
    return fn(...args);
  }) as T;
}

/**
 * Clear the action log — useful for testing or manual reset.
 */
export function clearLoopLog(): void {
  actionLog.length = 0;
  actionCounts.clear();
}

/**
 * Get loop detection statistics for monitoring.
 */
export function getLoopStats(): {
  totalActions: number;
  uniqueActions: number;
  topActions: { action: string; count: number }[];
} {
  const counts = new Map<string, number>();
  for (const record of actionLog) {
    counts.set(record.action, (counts.get(record.action) || 0) + 1);
  }

  const topActions = Array.from(counts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalActions: actionLog.length,
    uniqueActions: counts.size,
    topActions,
  };
}
