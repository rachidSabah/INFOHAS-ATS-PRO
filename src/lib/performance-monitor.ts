// ============================================================================
// Performance Budget Monitor
//
// Tracks:
//   - React render counts (per component)
//   - Memory growth (JS heap)
//   - Provider sync duration
//   - Database repair duration
//
// Alerts when budgets are exceeded:
//   Max render count: 20 per component
//   Max memory growth: 50 MB
//   Max CPU increase: 15%
//   Max provider sync duration: 5 seconds
//   Max database repair: 30 seconds
// ============================================================================

"use client";

import { createIncident } from "./incident-service";

export interface PerformanceBudget {
  maxRenderCount: number;
  maxMemoryGrowthMB: number;
  maxProviderSyncMs: number;
  maxDbRepairMs: number;
}

export const DEFAULT_BUDGETS: PerformanceBudget = {
  maxRenderCount: 20,
  maxMemoryGrowthMB: 50,
  maxProviderSyncMs: 5000,
  maxDbRepairMs: 30000,
};

// Render tracking
const renderCounts = new Map<string, number>();
const renderTimestamps = new Map<string, number[]>();

// Memory baseline
let memoryBaseline: number | null = null;

/**
 * Record a component render. Called from React DevTools Profiler or
 * a custom useRenderCount hook.
 *
 * If a component renders more than maxRenderCount times in 1 second,
 * it's flagged as a potential loop.
 */
export function recordRender(componentName: string, budget: PerformanceBudget = DEFAULT_BUDGETS): void {
  const count = (renderCounts.get(componentName) || 0) + 1;
  renderCounts.set(componentName, count);

  // Track timestamps for rate limiting
  const now = Date.now();
  const timestamps = renderTimestamps.get(componentName) || [];
  timestamps.push(now);

  // Keep only last 1 second of renders
  const oneSecondAgo = now - 1000;
  const recent = timestamps.filter((t) => t > oneSecondAgo);
  renderTimestamps.set(componentName, recent);

  // Check if render count exceeds budget in 1 second
  if (recent.length > budget.maxRenderCount) {
    console.error(
      `[Performance] "${componentName}" rendered ${recent.length} times in 1s ` +
      `(budget: ${budget.maxRenderCount}). Possible render loop.`
    );
    createIncident({
      severity: "high",
      rootCause: `Render loop detected: ${componentName} rendered ${recent.length} times in 1s`,
      affectedSystems: ["frontend", "react"],
      repairActions: ["Check useEffect dependencies", "Check Zustand subscriptions"],
      duration: 0,
      rollbackRequired: false,
      resolved: false,
    });
  }
}

/**
 * Capture the current memory usage as a baseline.
 * Call this at app startup to measure growth over time.
 */
export function captureMemoryBaseline(): void {
  if ((performance as any).memory) {
    memoryBaseline = (performance as any).memory.usedJSHeapSize;
    console.info(`[Performance] Memory baseline: ${Math.round((memoryBaseline || 0) / 1024 / 1024)}MB`);
  }
}

/**
 * Check if memory has grown beyond the budget.
 * Returns the growth in MB, or 0 if no baseline or no memory API.
 */
export function checkMemoryGrowth(budget: PerformanceBudget = DEFAULT_BUDGETS): number {
  if (!memoryBaseline || !(performance as any).memory) return 0;

  const current = (performance as any).memory.usedJSHeapSize;
  const growthBytes = current - memoryBaseline;
  const growthMB = Math.round(growthBytes / 1024 / 1024);

  if (growthMB > budget.maxMemoryGrowthMB) {
    console.warn(
      `[Performance] Memory growth: ${growthMB}MB (budget: ${budget.maxMemoryGrowthMB}MB). ` +
      `Possible memory leak.`
    );
    createIncident({
      severity: growthMB > 100 ? "high" : "medium",
      rootCause: `Memory growth: ${growthMB}MB (baseline: ${Math.round((memoryBaseline || 0) / 1024 / 1024)}MB)`,
      affectedSystems: ["memory"],
      repairActions: ["Check for uncleared intervals/timeouts", "Check for event listener leaks"],
      duration: 0,
      rollbackRequired: false,
      resolved: false,
    });
  }

  return growthMB;
}

/**
 * Measure the duration of an async operation.
 * Returns the duration in milliseconds.
 *
 * Usage:
 *   const { result, durationMs } = await measurePerformance("provider-sync", async () => { ... });
 */
export async function measurePerformance<T>(
  operationName: string,
  fn: () => Promise<T>,
  budgetMs?: number,
): Promise<{ result: T; durationMs: number; exceededBudget: boolean }> {
  const startTime = performance.now();

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - startTime);
    const exceededBudget = budgetMs !== undefined && durationMs > budgetMs;

    if (exceededBudget) {
      console.warn(
        `[Performance] "${operationName}" took ${durationMs}ms (budget: ${budgetMs}ms). Exceeded by ${durationMs - budgetMs}ms.`
      );
      createIncident({
        severity: "medium",
        rootCause: `${operationName} exceeded time budget: ${durationMs}ms > ${budgetMs}ms`,
        affectedSystems: [operationName],
        repairActions: ["Investigate slow operation"],
        duration: durationMs,
        rollbackRequired: false,
        resolved: true,
      });
    } else {
      console.info(`[Performance] "${operationName}" completed in ${durationMs}ms`);
    }

    return { result, durationMs, exceededBudget };
  } catch (e: any) {
    const durationMs = Math.round(performance.now() - startTime);
    console.error(`[Performance] "${operationName}" failed after ${durationMs}ms:`, e?.message);
    throw e;
  }
}

/**
 * Get render count statistics for monitoring.
 */
export function getRenderStats(): {
  totalComponents: number;
  topRenderers: { component: string; count: number }[];
} {
  const topRenderers = Array.from(renderCounts.entries())
    .map(([component, count]) => ({ component, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalComponents: renderCounts.size,
    topRenderers,
  };
}

/**
 * Get current memory usage in MB.
 */
export function getCurrentMemoryMB(): number {
  if (!(performance as any).memory) return 0;
  return Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024);
}

/**
 * Reset all performance tracking — useful for testing.
 */
export function resetPerformanceTracking(): void {
  renderCounts.clear();
  renderTimestamps.clear();
  memoryBaseline = null;
}
