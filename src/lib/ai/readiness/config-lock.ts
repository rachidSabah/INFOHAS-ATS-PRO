// ============================================================================
// Job AI Configuration Lock (directives #30, #31, #38)
//
// Once the readiness preflight has selected the best validated model, the
// configuration is LOCKED for the current optimization job: every agent
// obtains its AI configuration from this lock (via the single raw call path
// in ai.ts) instead of independently selecting arbitrary models.
// ============================================================================

export interface LockedModelRef {
  providerId: string;
  providerName: string;
  model: string;
  readinessScore: number;
  latencyMs?: number;
}

export interface JobAILock {
  jobId: string;
  lockedAt: string;
  /** The validated primary. `active` follows failovers; `primary` stays the original. */
  primary: LockedModelRef;
  /** Pre-validated fallback chain (BEST next, then next, …). */
  fallbacks: LockedModelRef[];
  /** All provider ids the gate considered — used to restrict optimizer calls
   *  to ONLY the locked/validated providers (no unvalidated failovers). */
  eligibleProviderIds: string[];
  /** Which chain entry is currently active (0 = primary). */
  activeIndex: number;
  /** Number of supervisor-approved failovers in this job. */
  failoverCount: number;
  /** History of failover events for the AI Engine dashboard. */
  events: { at: string; type: "failover" | "recovered" | "healed"; from?: string; to?: string; note: string }[];
}

let currentLock: JobAILock | null = null;

export function setJobAILock(lock: JobAILock): void {
  currentLock = lock;
}

export function getJobAILock(): JobAILock | null {
  return currentLock;
}

export function clearJobAILock(): void {
  currentLock = null;
}

/** Supervisor-approved failover to a pre-validated fallback. */
export function activateFallback(index: number, note: string): JobAILock | null {
  if (!currentLock) return null;
  const target = index < currentLock.fallbacks.length ? currentLock.fallbacks[index] : null;
  if (!target) return currentLock;
  const from = currentLock.activeIndex === 0 ? currentLock.primary.providerName : currentLock.fallbacks[currentLock.activeIndex - 1]?.providerName;
  currentLock.activeIndex = index + 1; // activeIndex 0 = primary, 1.. = fallbacks[i-1]
  currentLock.failoverCount += 1;
  currentLock.events.push({ at: new Date().toISOString(), type: "failover", from, to: target.providerName, note });
  return currentLock;
}

/** Record that a recovered/healed event happened (dashboard observability). */
export function recordLockEvent(type: "recovered" | "healed", note: string): void {
  currentLock?.events.push({ at: new Date().toISOString(), type, note });
}

/** The model reference currently active for the job (primary or fallback). */
export function getActiveJobModel(): LockedModelRef | null {
  if (!currentLock) return null;
  if (currentLock.activeIndex === 0) return currentLock.primary;
  return currentLock.fallbacks[currentLock.activeIndex - 1] ?? currentLock.primary;
}
