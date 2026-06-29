// ============================================================================
// Autonomous Repair Scheduler
//
// Schedules periodic scans and repairs:
//   every 5 minutes:  scanProviders()
//   every 10 minutes: scanPipelines()
//   every 15 minutes: scanDatabase()
//   every 30 minutes: scanMemory()
//   every hour:       fullHealthCheck()
//
// Never runs overlapping scans — uses isRunning flags.
// Integrates with circuit breakers to pause when tripped.
// ============================================================================

"use client";

import { runHealthCheck } from "./health-monitor";
import { validateProviderState, reconcileProviderState } from "./provider-sync";
import { isProviderAvailable, circuitBreakerFailure, resetCircuitBreaker } from "./circuit-breaker";

// Compatibility wrappers
const isRepairTripped = (id: string) => !isProviderAvailable(id);
const recordRepairCircuitFailure = (id: string, reason: any) => circuitBreakerFailure(id, reason || "network");
import { createIncident } from "./incident-service";
import { recordRepair } from "./telemetry";

interface ScanState {
  providers: boolean;
  pipelines: boolean;
  database: boolean;
  memory: boolean;
  fullCheck: boolean;
}

const scanState: ScanState = {
  providers: false,
  pipelines: false,
  database: false,
  memory: false,
  fullCheck: false,
};

const intervals: ReturnType<typeof setInterval>[] = [];
let isStarted = false;

/**
 * Scan providers for issues (empty keys, invalid models, drift).
 * Runs every 5 minutes. Never overlaps.
 */
export async function scanProviders(): Promise<void> {
  if (scanState.providers) return;
  if (isRepairTripped("repair")) {
    console.info("[Repair Scheduler] Skipping provider scan — repair circuit tripped");
    return;
  }

  scanState.providers = true;
  const startTime = Date.now();

  try {
    const { useApp } = await import("./store");
    const providers = useApp.getState().providers as any[];

    // Validate provider state
    const issues = validateProviderState(providers);

    if (issues.length > 0) {
      console.warn(`[Repair Scheduler] Provider scan found ${issues.length} issue(s):`, issues);

      // Attempt reconciliation
      const { providers: reconciled, fixes } = reconcileProviderState(providers);
      if (fixes.length > 0) {
        useApp.setState({ providers: reconciled });
        console.info(`[Repair Scheduler] Reconciled ${fixes.length} provider issue(s):`, fixes);

        recordRepair({
          issue: "Provider drift detected",
          rootCause: issues.join("; "),
          repairAction: fixes.join("; "),
          durationMs: Date.now() - startTime,
          success: true,
          rollbackRequired: false,
        });
      } else {
        // Could not fix — record incident
        createIncident({
          severity: "medium",
          rootCause: "Provider state issues could not be auto-repaired",
          affectedSystems: ["providers"],
          repairActions: ["validateProviderState", "reconcileProviderState"],
          duration: Date.now() - startTime,
          rollbackRequired: false,
          resolved: false,
        });
        recordRepairCircuitFailure("repair", "network");
      }
    }
  } catch (e: any) {
    console.warn("[Repair Scheduler] Provider scan failed:", e?.message);
    recordRepairCircuitFailure("repair", "network");
  } finally {
    scanState.providers = false;
  }
}

/**
 * Scan pipeline state for stuck or failed agents.
 * Runs every 10 minutes.
 */
export async function scanPipelines(): Promise<void> {
  if (scanState.pipelines) return;
  if (isRepairTripped("repair")) return;

  scanState.pipelines = true;
  const startTime = Date.now();

  try {
    // Check localStorage for stuck pipeline snapshots
    const snapshot = localStorage.getItem("resumeai-pipeline-snapshot");
    if (!snapshot) return;

    const parsed = JSON.parse(snapshot);
    const agents = parsed.state?.agents || {};
    const stuckAgents = (Object.values(agents) as any[]).filter(
      (a) => a.status === "running" && a.startedAt,
    );

    // Check if any agent has been "running" for > 5 minutes (stuck)
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const trulyStuck = stuckAgents.filter((a: any) => {
      const startedAt = new Date(a.startedAt).getTime();
      return startedAt < fiveMinAgo;
    });

    if (trulyStuck.length > 0) {
      console.warn(`[Repair Scheduler] Found ${trulyStuck.length} stuck agent(s):`,
        trulyStuck.map((a: any) => a.name).join(", "));

      // Mark stuck agents as failed (they can be retried by the user)
      for (const agent of trulyStuck) {
        (agent as any).status = "failed";
        (agent as any).error = "Agent timed out (stuck for > 5 minutes)";
        (agent as any).log = "⚠ Marked as failed by repair scheduler (stuck).";
      }

      // Save the fixed snapshot
      localStorage.setItem("resumeai-pipeline-snapshot", JSON.stringify(parsed));

      createIncident({
        severity: "high",
        rootCause: `${trulyStuck.length} stuck agent(s) detected and marked as failed`,
        affectedSystems: ["pipelines"],
        repairActions: ["Marked stuck agents as failed"],
        duration: Date.now() - startTime,
        rollbackRequired: false,
        resolved: true,
      });

      recordRepair({
        issue: "Stuck pipeline agents",
        rootCause: `${trulyStuck.length} agents stuck in running state`,
        repairAction: "Marked as failed",
        durationMs: Date.now() - startTime,
        success: true,
        rollbackRequired: false,
      });
    }
  } catch (e: any) {
    console.warn("[Repair Scheduler] Pipeline scan failed:", e?.message);
  } finally {
    scanState.pipelines = false;
  }
}

/**
 * Scan database health (via /api/health endpoint).
 * Runs every 15 minutes.
 */
export async function scanDatabase(): Promise<void> {
  if (scanState.database) return;

  scanState.database = true;
  const startTime = Date.now();

  try {
    const response = await fetch("/api/health", { signal: AbortSignal.timeout(5000) });
    const data = await response.json();

    if (!data.ok || data.db !== "connected") {
      console.warn("[Repair Scheduler] Database health check failed:", data);
      createIncident({
        severity: "high",
        rootCause: "Database health check failed",
        affectedSystems: ["database"],
        repairActions: ["No automatic repair available — manual intervention required"],
        duration: Date.now() - startTime,
        rollbackRequired: false,
        resolved: false,
      });
    }
  } catch (e: any) {
    console.warn("[Repair Scheduler] Database scan failed:", e?.message);
  } finally {
    scanState.database = false;
  }
}

/**
 * Scan memory usage for leaks.
 * Runs every 30 minutes.
 */
export async function scanMemory(): Promise<void> {
  if (scanState.memory) return;

  scanState.memory = true;

  try {
    if ((performance as any).memory) {
      const usedMB = Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024);
      const limitMB = Math.round((performance as any).memory.jsHeapSizeLimit / 1024 / 1024);

      if (usedMB > 100) {
        console.warn(`[Repair Scheduler] High memory usage: ${usedMB}MB / ${limitMB}MB`);
        createIncident({
          severity: usedMB > 200 ? "high" : "medium",
          rootCause: `High memory usage: ${usedMB}MB`,
          affectedSystems: ["memory"],
          repairActions: ["No automatic repair — consider page refresh"],
          duration: 0,
          rollbackRequired: false,
          resolved: false,
        });
      }
    }
  } catch (e: any) {
    console.warn("[Repair Scheduler] Memory scan failed:", e?.message);
  } finally {
    scanState.memory = false;
  }
}

/**
 * Full health check — runs all scans + health monitor.
 * Runs every hour.
 */
export async function fullHealthCheck(): Promise<void> {
  if (scanState.fullCheck) return;

  scanState.fullCheck = true;

  try {
    await runHealthCheck();
    await scanProviders();
    await scanPipelines();
    await scanDatabase();
    await scanMemory();
    console.info("[Repair Scheduler] Full health check complete");
  } catch (e: any) {
    console.warn("[Repair Scheduler] Full health check failed:", e?.message);
  } finally {
    scanState.fullCheck = false;
  }
}

/**
 * Start the autonomous repair scheduler.
 * Returns a cleanup function to stop all intervals.
 */
export function startRepairScheduler(): () => void {
  if (isStarted) {
    console.warn("[Repair Scheduler] Already started — ignoring duplicate call");
    return () => {};
  }
  isStarted = true;

  // Provider scan every 5 min
  intervals.push(setInterval(() => { scanProviders().catch(() => {}); }, 5 * 60 * 1000));

  // Pipeline scan every 10 min
  intervals.push(setInterval(() => { scanPipelines().catch(() => {}); }, 10 * 60 * 1000));

  // Database scan every 15 min
  intervals.push(setInterval(() => { scanDatabase().catch(() => {}); }, 15 * 60 * 1000));

  // Memory scan every 30 min
  intervals.push(setInterval(() => { scanMemory().catch(() => {}); }, 30 * 60 * 1000));

  // Full health check every hour
  intervals.push(setInterval(() => { fullHealthCheck().catch(() => {}); }, 60 * 60 * 1000));

  console.info("[Repair Scheduler] Started — providers(5m), pipelines(10m), database(15m), memory(30m), full(1h)");

  return () => {
    intervals.forEach(clearInterval);
    intervals.length = 0;
    isStarted = false;
    console.info("[Repair Scheduler] Stopped");
  };
}

/**
 * Run all scans immediately (manual trigger).
 */
export async function runAllScansNow(): Promise<void> {
  await fullHealthCheck();
}
