// ============================================================================
// Self-Learning Engine
//
// Persists root cause + repair strategy + success/failure for each repair.
// Uses historical repairs to improve future repair decisions.
//
// Stored in localStorage (persists across sessions).
// ============================================================================

"use client";

export interface RepairLearning {
  id: string;
  timestamp: string;
  issueSignature: string; // normalized issue description for matching
  rootCause: string;
  repairStrategy: string;
  repairDuration: number; // ms
  success: boolean;
  rollbackRequired: boolean;
  occurrenceCount: number; // how many times this issue has occurred
  lastOccurrence: string;
}

const STORAGE_KEY = "resumeai-repair-learnings";
const MAX_LEARNINGS = 100;

/**
 * Load all stored repair learnings from localStorage.
 */
export function loadLearnings(): RepairLearning[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Save repair learnings to localStorage.
 */
function saveLearnings(learnings: RepairLearning[]): void {
  try {
    // Cap at MAX_LEARNINGS (keep newest)
    if (learnings.length > MAX_LEARNINGS) {
      learnings = learnings.slice(-MAX_LEARNINGS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(learnings));
  } catch {
    // localStorage might be full or unavailable — non-fatal
  }
}

/**
 * Normalize an issue description into a signature for matching.
 * Removes timestamps, IDs, and variable data.
 */
function normalizeIssue(issue: string): string {
  return issue
    .toLowerCase()
    .replace(/id[:\s]+[a-z0-9_]+/gi, "") // remove IDs
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/gi, "") // remove timestamps
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200); // cap length
}

/**
 * Record a repair attempt in the learning database.
 * If the same issue has occurred before, increments occurrenceCount.
 */
export function recordRepairLearning(opts: {
  issue: string;
  rootCause: string;
  repairStrategy: string;
  repairDuration: number;
  success: boolean;
  rollbackRequired: boolean;
}): void {
  const learnings = loadLearnings();
  const signature = normalizeIssue(opts.issue);

  // Check if we've seen this issue before
  const existing = learnings.find((l) => l.issueSignature === signature);

  if (existing) {
    // Update existing record
    existing.occurrenceCount++;
    existing.lastOccurrence = new Date().toISOString();
    existing.success = opts.success;
    existing.repairStrategy = opts.repairStrategy;
    existing.repairDuration = opts.repairDuration;
    existing.rollbackRequired = opts.rollbackRequired;
    console.info(`[Self-Learning] Updated learning for "${signature}" — occurred ${existing.occurrenceCount} times`);
  } else {
    // Create new record
    const learning: RepairLearning = {
      id: `learn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      issueSignature: signature,
      rootCause: opts.rootCause,
      repairStrategy: opts.repairStrategy,
      repairDuration: opts.repairDuration,
      success: opts.success,
      rollbackRequired: opts.rollbackRequired,
      occurrenceCount: 1,
      lastOccurrence: new Date().toISOString(),
    };
    learnings.push(learning);
    console.info(`[Self-Learning] New learning recorded for "${signature}"`);
  }

  saveLearnings(learnings);
}

/**
 * Look up a historical repair for a given issue.
 * Returns the most successful repair strategy if found.
 */
export function lookupRepair(issue: string): RepairLearning | null {
  const learnings = loadLearnings();
  const signature = normalizeIssue(issue);

  // Find matching learnings, prefer successful ones
  const matches = learnings.filter((l) => l.issueSignature === signature);
  if (matches.length === 0) return null;

  // Prefer successful repairs, then most recent
  const successful = matches.filter((l) => l.success);
  if (successful.length > 0) {
    return successful[successful.length - 1];
  }

  return matches[matches.length - 1];
}

/**
 * Get repair statistics for dashboards.
 */
export function getLearningStats(): {
  totalLearnings: number;
  successfulRepairs: number;
  failedRepairs: number;
  recurringIssues: number;
  avgRepairDuration: number;
} {
  const learnings = loadLearnings();
  const successful = learnings.filter((l) => l.success);
  const failed = learnings.filter((l) => !l.success);
  const recurring = learnings.filter((l) => l.occurrenceCount > 1);
  const totalDuration = learnings.reduce((sum, l) => sum + l.repairDuration, 0);

  return {
    totalLearnings: learnings.length,
    successfulRepairs: successful.length,
    failedRepairs: failed.length,
    recurringIssues: recurring.length,
    avgRepairDuration: learnings.length > 0 ? Math.round(totalDuration / learnings.length) : 0,
  };
}

/**
 * Get all learnings (for UI display).
 */
export function getAllLearnings(): RepairLearning[] {
  return loadLearnings();
}

/**
 * Clear all learnings — useful for testing.
 */
export function clearLearnings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* non-fatal */ }
}
