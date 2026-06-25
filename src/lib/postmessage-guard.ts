// ============================================================================
// PostMessage Loop Protection
//
// Maintains a set of processed message IDs to ignore duplicate messages.
// Provides cleanup helpers for removing event listeners on unmount.
//
// Usage:
//   const { addListener, cleanup } = createPostMessageGuard();
//   addListener("message", handler);
//   // On unmount: cleanup();
// ============================================================================

"use client";

const processedMessageIds = new Set<string>();
const MAX_PROCESSED = 500; // prevent memory leaks
const listeners: { event: string; handler: (event: MessageEvent) => void }[] = [];

/**
 * Check if a message has already been processed.
 * If not, mark it as processed.
 */
export function isMessageProcessed(messageId: string): boolean {
  if (processedMessageIds.has(messageId)) {
    return true; // Already processed — ignore
  }

  // Add to processed set
  processedMessageIds.add(messageId);

  // Prune if too many
  if (processedMessageIds.size > MAX_PROCESSED) {
    const first = processedMessageIds.values().next().value;
    if (first) processedMessageIds.delete(first);
  }

  return false; // Not processed yet — proceed
}

/**
 * Generate a unique ID for a postMessage event.
 * Uses type + data hash to deduplicate identical messages.
 */
export function getMessageId(event: MessageEvent): string {
  try {
    const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
    const source = event.origin || "unknown";
    return `${source}:${data.slice(0, 200)}`;
  } catch {
    return `${event.origin || "unknown"}:${Date.now()}:${Math.random()}`;
  }
}

/**
 * Add a guarded message listener that ignores duplicate messages.
 * Returns a cleanup function to remove the listener.
 */
export function addGuardedMessageListener(
  handler: (event: MessageEvent) => void,
): () => void {
  const guardedHandler = (event: MessageEvent) => {
    const messageId = getMessageId(event);
    if (isMessageProcessed(messageId)) {
      return; // Duplicate — ignore
    }
    handler(event);
  };

  window.addEventListener("message", guardedHandler as EventListener);
  listeners.push({ event: "message", handler: guardedHandler });

  // Return cleanup function
  return () => {
    window.removeEventListener("message", guardedHandler as EventListener);
    const idx = listeners.findIndex((l) => l.handler === guardedHandler);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Remove ALL guarded message listeners.
 * Call this on component unmount to prevent memory leaks.
 */
export function cleanupAllMessageListeners(): void {
  for (const { handler } of listeners) {
    window.removeEventListener("message", handler as EventListener);
  }
  listeners.length = 0;
  console.info("[PostMessage Guard] Cleaned up all message listeners");
}

/**
 * Get statistics for monitoring.
 */
export function getMessageGuardStats(): {
  processedCount: number;
  activeListeners: number;
} {
  return {
    processedCount: processedMessageIds.size,
    activeListeners: listeners.length,
  };
}

/**
 * Clear all processed message IDs — useful for testing.
 */
export function clearProcessedMessages(): void {
  processedMessageIds.clear();
}
