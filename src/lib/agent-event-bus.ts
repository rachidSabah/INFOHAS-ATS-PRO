// ============================================================================
// Agent Event Bus — lightweight pub/sub for agent lifecycle monitoring
//
// Every agent in the pipeline emits events through this bus:
//   - Performance monitoring (duration, tokens, provider)
//   - Debugging (which agent failed, on what action)
//   - Analytics (success rate, total tokens, average duration)
//   - Cost tracking (tokens per provider per agent)
//
// Bus instances are isolated — createEventBus() for scoped buses,
// globalEventBus singleton for app-wide monitoring.
// ============================================================================

export interface AgentEvent {
  /** Agent name (e.g., "ExperienceAgent", "GuardianAgent", "SummaryAgent") */
  agent: string;
  /** Action performed (e.g., "modifyBullet", "validate", "assemble", "optimize_skills") */
  action: string;
  /** Resume ID being operated on */
  resumeId: string;
  /** ISO 8601 timestamp — auto-filled if omitted */
  timestamp?: string;
  /** Duration in milliseconds */
  duration?: number;
  /** Tokens consumed (estimated) */
  tokens?: number;
  /** AI provider used */
  provider?: string;
  /** Whether the action succeeded */
  success?: boolean;
  /** Arbitrary metadata (snapshot IDs, counts, details) */
  metadata?: Record<string, unknown>;
}

export interface EventBusStats {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  totalTokens: number;
  totalDuration: number;
}

export interface EventBus {
  emit: (event: Omit<AgentEvent, "timestamp"> & { timestamp?: string }) => void;
  subscribe: (handler: (event: AgentEvent) => void) => () => void;
  getHistory: () => AgentEvent[];
  clearHistory: () => void;
  getStats: () => EventBusStats;
}

const MAX_HISTORY = 1000;
type Subscriber = (event: AgentEvent) => void;

/**
 * Create a new event bus instance.
 * Each bus is isolated — events emitted on one do not reach subscribers of another.
 */
export function createEventBus(): EventBus {
  const subscribers = new Set<Subscriber>();
  const history: AgentEvent[] = [];

  const emit = (event: Omit<AgentEvent, "timestamp"> & { timestamp?: string }) => {
    const fullEvent: AgentEvent = {
      timestamp: new Date().toISOString(),
      duration: 0,
      tokens: 0,
      success: true,
      ...event,
    };

    // Add to history with cap
    history.push(fullEvent);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    // Notify all subscribers
    subscribers.forEach((sub) => {
      try {
        sub(fullEvent);
      } catch (err) {
        console.warn("[EventBus] Subscriber error:", err);
      }
    });
  };

  const subscribe = (handler: Subscriber): (() => void) => {
    subscribers.add(handler);
    return () => { subscribers.delete(handler); };
  };

  const getHistory = (): AgentEvent[] => [...history];

  const clearHistory = (): void => {
    history.length = 0;
  };

  const getStats = (): EventBusStats => {
    let successfulEvents = 0;
    let failedEvents = 0;
    let totalTokens = 0;
    let totalDuration = 0;

    history.forEach((ev) => {
      if (ev.success) successfulEvents++;
      else failedEvents++;
      totalTokens += ev.tokens ?? 0;
      totalDuration += ev.duration ?? 0;
    });

    return {
      totalEvents: history.length,
      successfulEvents,
      failedEvents,
      totalTokens,
      totalDuration,
    };
  };

  return { emit, subscribe, getHistory, clearHistory, getStats };
}

/** Global singleton bus for app-wide monitoring. Use createEventBus() for scoped instances. */
export const globalEventBus = createEventBus();
