// ============================================================================
// Heal History — lightweight persisted record of every auto/manual heal event.
// Directive #19: timestamp, provider, failure, diagnosis, action, model
// transitions, result, latency, auto/manual. Max 100 entries, localStorage
// persisted (client-side), survives page reloads, never holds API keys.
// ============================================================================

export interface HealEvent {
  id: string;
  at: string;               // ISO timestamp
  providerId: string;
  providerName: string;
  /** Failure kind from the classifier (model_error, endpoint_error, …). */
  failureKind: string;
  /** Human-readable diagnosis. */
  diagnosis: string;
  /** What the healer did (or why it declined). */
  action: string;
  previousModel?: string;
  newModel?: string;
  previousEndpoint?: string;
  newEndpoint?: string;
  /** recovered | cooldown | manual_required | failed | skipped */
  result: "recovered" | "cooldown" | "manual_required" | "failed" | "skipped";
  latencyMs?: number;
  mode: "auto" | "manual";
  /** Raw technical error preserved for the Technical Details section. */
  technical?: string;
}

const KEY = "ats-pro-heal-history-v1";
const MAX_ENTRIES = 100;
const mem: HealEvent[] = [];
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) mem.push(...parsed.slice(0, MAX_ENTRIES));
      }
    }
  } catch {
    // corrupted storage — start fresh, never throw from a diagnostics module
  }
}

function persist(): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(KEY, JSON.stringify(mem.slice(0, MAX_ENTRIES)));
    }
  } catch {
    // storage full/blocked — in-memory history still works for the session
  }
}

export function recordHealEvent(e: Omit<HealEvent, "id" | "at"> & { at?: string }): HealEvent {
  load();
  const event: HealEvent = {
    ...e,
    id: `heal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: e.at ?? new Date().toISOString(),
  };
  mem.unshift(event);
  if (mem.length > MAX_ENTRIES) mem.length = MAX_ENTRIES;
  persist();
  return event;
}

export function getHealHistory(): HealEvent[] {
  load();
  return [...mem];
}

export function clearHealHistory(): void {
  mem.length = 0;
  persist();
}

/** Count heal events by result — consumed by the AI Models health panel. */
export function healStats(): { total: number; recovered: number; failed: number; manualRequired: number } {
  load();
  return {
    total: mem.length,
    recovered: mem.filter((e) => e.result === "recovered").length,
    failed: mem.filter((e) => e.result === "failed").length,
    manualRequired: mem.filter((e) => e.result === "manual_required").length,
  };
}
