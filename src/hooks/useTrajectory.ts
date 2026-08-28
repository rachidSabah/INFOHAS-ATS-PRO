"use client";

// ============================================================================
// useTrajectory — React binding for the agent event bus (item #10).
//
// The globalEventBus has been emit-only since introduction; this hook is its
// FIRST UI consumer: it subscribes via useSyncExternalStore and returns the
// (capped) event history + live stats so observability panels re-render on
// every pipeline node/agent event.
// ============================================================================

import { useSyncExternalStore, useCallback } from "react";
import { globalEventBus, type AgentEvent, type EventBusStats } from "@/lib/agent-event-bus";

function snapshot(): AgentEvent[] {
  return globalEventBus.getHistory();
}

function subscribe(onChange: () => void): () => void {
  // The bus emits per event; React batches the re-renders.
  return globalEventBus.subscribe(onChange);
}

/**
 * Live trajectory of agent/pipeline events (newest first for display).
 * `limit` bounds the returned slice (default 80).
 */
export function useTrajectory(limit = 80): {
  events: AgentEvent[];
  eventsNewestFirst: AgentEvent[];
  stats: EventBusStats;
} {
  const events = useSyncExternalStore(subscribe, snapshot, snapshot);
  const stats = globalEventBus.getStats();
  const eventsNewestFirst = events.slice(-limit).reverse();

  return { events, eventsNewestFirst, stats };
}

/** Clear the bus history (also clears the panel). */
export function useClearTrajectory(): () => void {
  return useCallback(() => globalEventBus.clearHistory(), []);
}
