// ============================================================================
// Plugin SDK — Event Bus
// ============================================================================
// Lightweight typed event emitter for pipeline observability.
// Events persisted to D1 (pipeline_events table) for dashboard visibility.
// Part of Phase 8: Plugin SDK & Modularization.
// ============================================================================

import type { PipelineEvent } from './types';

export type EventHandler<T extends PipelineEvent['type']> = (
  event: Extract<PipelineEvent, { type: T }>,
) => void | Promise<void>;

// ============================================================================
// EventBus
// ============================================================================

export class EventBus {
  private handlers = new Map<string, Array<(...args: unknown[]) => void | Promise<void>>>();
  private history: PipelineEvent[] = [];
  private readonly maxHistory = 1000;

  /**
   * Register a handler for a specific event type.
   */
  on<T extends PipelineEvent['type']>(
    type: T,
    handler: EventHandler<T>,
  ): void {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler as (...args: unknown[]) => void | Promise<void>);
    this.handlers.set(type, handlers);
  }

  /**
   * Remove a previously registered handler.
   */
  off<T extends PipelineEvent['type']>(
    type: T,
    handler: EventHandler<T>,
  ): void {
    const handlers = this.handlers.get(type);
    if (!handlers) return;
    const idx = handlers.indexOf(handler as (...args: unknown[]) => void | Promise<void>);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  /**
   * Emit an event to all registered handlers.
   * Handlers are called synchronously in registration order.
   * The event is also stored in the in-memory history buffer.
   */
  emit(event: PipelineEvent): void {
    // Store in history
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Call handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          void Promise.resolve(handler(event));
        } catch (err) {
          console.error(`[EventBus] Handler error for ${event.type}:`, err);
        }
      }
    }
  }

  /**
   * Get the event history (for dashboard / observability).
   */
  getHistory(): PipelineEvent[] {
    return [...this.history];
  }

  /**
   * Clear the event history buffer.
   */
  clearHistory(): void {
    this.history = [];
  }
}
