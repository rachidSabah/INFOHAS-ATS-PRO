// ============================================================================
// Worker CPU Time Optimization — Section 10
// ============================================================================
// Workers are billed and limited on CPU time, not wall-clock time.
// This module provides utilities to:
//   1. Track CPU time per request using CF trace headers / performance.now()
//   2. Alert when a single request approaches the plan's CPU limit
//   3. Batch writes to D1 to minimize round-trips
//   4. Stream large responses to reduce peak memory
//   5. Parallelize independent operations (D1 read + KV read + R2 check)
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface CpuTimeBudget {
  totalBudgetMs: number;       // CF plan CPU limit (e.g., 30s for Workers Paid)
  warningThresholdMs: number;  // Alert when CPU time exceeds this (e.g., 80% of limit)
  currentMs: number;           // Accumulated CPU time tracker
}

export interface CpuTimeReport {
  requestId: string;
  totalCpuMs: number;
  budgetUsedPercent: number;
  phases: Array<{ name: string; durationMs: number }>;
  warnings: string[];
  budgetExceeded: boolean;
}

export interface BatchOperation<T> {
  items: T[];
  /** Max items per batch (D1 batch limit: 100 statements) */
  batchSize: number;
}

// ============================================================================
// CpuTimeTracker
// ============================================================================

export class CpuTimeTracker {
  private budget: CpuTimeBudget;
  private phases: Map<string, { start: number; total: number }> = new Map();
  private currentPhase: string | null = null;
  private phaseStart: number = 0;
  private requestId: string;
  private totalMs: number = 0;
  private overheadCompensation: number = 0;

  constructor(requestId: string, options?: { totalBudgetMs?: number; warningThreshold?: number }) {
    this.requestId = requestId;
    this.budget = {
      totalBudgetMs: options?.totalBudgetMs ?? 30_000,  // Workers Paid default
      warningThresholdMs: options?.warningThreshold ?? 24_000,  // 80% of 30s
      currentMs: 0,
    };
  }

  /**
   * Start timing a named phase.
   * Stops the previous phase if one was running.
   */
  startPhase(name: string): void {
    this.stopCurrentPhase();
    this.currentPhase = name;
    this.phaseStart = performance.now();
  }

  /**
   * Stop the current phase and record its duration.
   */
  stopCurrentPhase(): void {
    if (this.currentPhase !== null) {
      const elapsed = performance.now() - this.phaseStart;
      const existing = this.phases.get(this.currentPhase)?.total ?? 0;
      this.phases.set(this.currentPhase, { start: this.phaseStart, total: existing + elapsed });
      this.totalMs += elapsed;
      this.currentPhase = null;
    }
  }

  /**
   * Add overhead compensation (for async boundaries where CPU ticks aren't tracked).
   */
  addOverhead(ms: number): void {
    this.overheadCompensation += ms;
    this.totalMs += ms;
  }

  /**
   * Check if the request is approaching the CPU limit.
   */
  getWarnings(): string[] {
    const warnings: string[] = [];

    if (this.totalMs >= this.budget.warningThresholdMs) {
      warnings.push(
        `CPU time ${this.totalMs.toFixed(1)}ms exceeds warning threshold ${this.budget.warningThresholdMs}ms`,
      );
    }

    Array.from(this.phases.entries()).forEach(([name, phase]) => {
      if (phase.total > this.budget.totalBudgetMs * 0.3) {
        warnings.push(`Phase "${name}" used ${phase.total.toFixed(1)}ms (>30% of budget)`);
      }
    });

    return warnings;
  }

  /**
   * Generate the final CPU time report.
   */
  report(): CpuTimeReport {
    this.stopCurrentPhase();
    const warnings = this.getWarnings();
    const budgetExceeded = this.totalMs >= this.budget.totalBudgetMs;

    return {
      requestId: this.requestId,
      totalCpuMs: this.totalMs,
      budgetUsedPercent: Math.round((this.totalMs / this.budget.totalBudgetMs) * 100),
      phases: Array.from(this.phases.entries()).map(([name, data]) => ({
        name,
        durationMs: Math.round(data.total * 100) / 100,
      })),
      warnings,
      budgetExceeded,
    };
  }

  /**
   * Check if we're over budget.
   */
  get isOverBudget(): boolean {
    return this.totalMs >= this.budget.totalBudgetMs;
  }

  /**
   * Get current accumulated CPU time.
   */
  get currentCpuMs(): number {
    return this.totalMs;
  }
}

// ============================================================================
// Batch Processor
// ============================================================================

/**
 * Split items into batches of `batchSize` and process each batch sequentially.
 * Reports progress after each batch.
 */
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[], batchIndex: number) => Promise<R[]>,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = [];
  let completed = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch, Math.floor(i / batchSize));
    results.push(...(Array.isArray(batchResults) ? batchResults : [batchResults]));
    completed += batch.length;
    onProgress?.(completed, items.length);
  }

  return results;
}

/**
 * Execute independent async operations in parallel with a concurrency limit.
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  const executeNext = async (): Promise<void> => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => executeNext());
  await Promise.all(workers);
  return results;
}
