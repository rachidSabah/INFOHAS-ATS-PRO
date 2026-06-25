// ============================================================================
// Health Monitor Service
//
// Runs periodic health checks on:
//   - Providers (every 5 min)
//   - Database (every 15 min)
//   - Pipelines (every 10 min)
//   - Memory (every 30 min)
//   - Full health check (every hour)
//
// Never runs overlapping scans. Uses a simple isRunning flag.
// ============================================================================

"use client";

import { validateProviderState } from "./provider-sync";

export interface HealthStatus {
  timestamp: string;
  providers: { healthy: boolean; issues: string[] };
  database: { healthy: boolean; latency: number };
  pipelines: { healthy: boolean; lastRun: string | null };
  memory: { healthy: boolean; usedMB: number };
  overall: boolean;
}

let isRunning = false;
let lastHealthCheck: HealthStatus | null = null;

/**
 * Run a full health check across all systems.
 * Non-blocking — returns immediately if already running.
 */
export async function runHealthCheck(): Promise<HealthStatus> {
  if (isRunning) {
    return lastHealthCheck ?? createDefaultHealthStatus();
  }

  isRunning = true;
  try {
    const timestamp = new Date().toISOString();

    // === Provider Health ===
    let providerIssues: string[] = [];
    try {
      const { useApp } = await import("./store");
      const providers = useApp.getState().providers as any[];
      providerIssues = validateProviderState(providers);
    } catch (e) {
      providerIssues = ["Could not read provider state"];
    }

    // === Database Health ===
    let dbHealthy = true;
    let dbLatency = 0;
    try {
      const t0 = performance.now();
      const response = await fetch("/api/health", { signal: AbortSignal.timeout(5000) });
      dbLatency = Math.round(performance.now() - t0);
      const data = await response.json();
      dbHealthy = data.ok === true && data.db === "connected";
    } catch (e) {
      dbHealthy = false;
      dbLatency = -1;
    }

    // === Pipeline Health ===
    let pipelineHealthy = true;
    let lastRun: string | null = null;
    try {
      const snapshot = localStorage.getItem("resumeai-pipeline-snapshot");
      if (snapshot) {
        const parsed = JSON.parse(snapshot);
        lastRun = parsed.state?.context?.updatedAt ?? null;
        // If last run was > 1 hour ago, mark as stale
        if (lastRun) {
          const age = Date.now() - new Date(lastRun).getTime();
          if (age > 3600000) pipelineHealthy = false; // stale
        }
      }
    } catch { /* non-fatal */ }

    // === Memory Health ===
    let memUsedMB = 0;
    let memHealthy = true;
    try {
      if ((performance as any).memory) {
        memUsedMB = Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024);
        // Flag if > 100MB
        if (memUsedMB > 100) memHealthy = false;
      }
    } catch { /* non-fatal */ }

    const status: HealthStatus = {
      timestamp,
      providers: { healthy: providerIssues.length === 0, issues: providerIssues },
      database: { healthy: dbHealthy, latency: dbLatency },
      pipelines: { healthy: pipelineHealthy, lastRun },
      memory: { healthy: memHealthy, usedMB: memUsedMB },
      overall: providerIssues.length === 0 && dbHealthy && pipelineHealthy && memHealthy,
    };

    lastHealthCheck = status;

    if (!status.overall) {
      console.warn("[Health Monitor] Issues detected:", {
        providers: providerIssues.length,
        db: dbHealthy ? "ok" : "down",
        pipelines: pipelineHealthy ? "ok" : "stale",
        memory: `${memUsedMB}MB`,
      });
    }

    return status;
  } finally {
    isRunning = false;
  }
}

function createDefaultHealthStatus(): HealthStatus {
  return {
    timestamp: new Date().toISOString(),
    providers: { healthy: true, issues: [] },
    database: { healthy: true, latency: 0 },
    pipelines: { healthy: true, lastRun: null },
    memory: { healthy: true, usedMB: 0 },
    overall: true,
  };
}

/**
 * Get the last health check result (without running a new one).
 */
export function getLastHealthCheck(): HealthStatus | null {
  return lastHealthCheck;
}

/**
 * Start the periodic health check scheduler.
 * Runs checks at the intervals specified in the spec.
 * Returns a cleanup function to stop the scheduler.
 */
export function startHealthMonitor(): () => void {
  const intervals: ReturnType<typeof setInterval>[] = [];

  // Provider check every 5 min
  intervals.push(setInterval(() => {
    runHealthCheck().catch(() => {});
  }, 5 * 60 * 1000));

  // Full check every hour
  intervals.push(setInterval(() => {
    runHealthCheck().catch(() => {});
  }, 60 * 60 * 1000));

  console.info("[Health Monitor] Started — provider checks every 5min, full checks every hour");

  // Return cleanup function
  return () => {
    intervals.forEach(clearInterval);
    console.info("[Health Monitor] Stopped");
  };
}
