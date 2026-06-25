// ============================================================================
// Metrics Service — unified dashboard data aggregator
//
// Combines data from:
//   - Telemetry Service (agent executions, provider failures, repairs)
//   - Health Monitor (provider/DB/pipeline/memory health)
//   - Incident Service (incident reports + stats)
//   - Self-Learning Engine (repair history + success rate)
//   - Circuit Breaker Service (tripped providers)
//   - Provider Cache (cache stats)
//
// Returns a single snapshot for UI dashboards.
// ============================================================================

"use client";

import { getTelemetrySnapshot } from "./telemetry";
import { getLastHealthCheck } from "./health-monitor";
import { getIncidentStats, getRecentIncidents } from "./incident-service";
import { getLearningStats } from "./self-learning";
import { getTrippedProviders } from "./circuit-breaker";
import { getCacheStats } from "./provider-cache";

export interface MetricsSnapshot {
  timestamp: string;

  // Pipeline metrics
  pipeline: {
    totalOptimizations: number;
    totalFailures: number;
    avgOptimizerDurationMs: number;
    avgQAConfidence: number;
    avgAtsScore: number;
  };

  // Provider metrics
  providers: {
    trippedCount: number;
    trippedNames: string[];
    cacheStats: { providers: number; models: number; tokens: number };
    providerFailures: number;
  };

  // Repair metrics
  repairs: {
    totalRepairs: number;
    repairSuccessRate: number;
    totalLearnings: number;
    recurringIssues: number;
  };

  // Incident metrics
  incidents: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    rollbackRate: number;
    recentCount: number;
  };

  // Health metrics
  health: {
    overall: boolean;
    providersHealthy: boolean;
    databaseHealthy: boolean;
    pipelinesHealthy: boolean;
    memoryHealthy: boolean;
    memoryUsedMB: number;
  };
}

/**
 * Get a unified metrics snapshot for dashboards.
 * Aggregates from all monitoring services.
 */
export function getMetricsSnapshot(): MetricsSnapshot {
  const telemetry = getTelemetrySnapshot();
  const health = getLastHealthCheck();
  const incidentStats = getIncidentStats();
  const learningStats = getLearningStats();
  const trippedProviders = getTrippedProviders();
  const cacheStats = getCacheStats();
  const recentIncidents = getRecentIncidents(5);

  return {
    timestamp: new Date().toISOString(),

    pipeline: {
      totalOptimizations: telemetry.performance.totalOptimizations,
      totalFailures: telemetry.performance.totalFailures,
      avgOptimizerDurationMs: telemetry.performance.avgOptimizerDurationMs,
      avgQAConfidence: telemetry.performance.avgQAConfidence,
      avgAtsScore: telemetry.performance.avgAtsScore,
    },

    providers: {
      trippedCount: trippedProviders.length,
      trippedNames: trippedProviders,
      cacheStats,
      providerFailures: telemetry.providerFailures.length,
    },

    repairs: {
      totalRepairs: telemetry.performance.totalRepairs,
      repairSuccessRate: telemetry.performance.repairSuccessRate,
      totalLearnings: learningStats.totalLearnings,
      recurringIssues: learningStats.recurringIssues,
    },

    incidents: {
      total: incidentStats.total,
      critical: incidentStats.critical,
      high: incidentStats.high,
      medium: incidentStats.medium,
      low: incidentStats.low,
      rollbackRate: incidentStats.rollbackRate,
      recentCount: recentIncidents.length,
    },

    health: {
      overall: health?.overall ?? true,
      providersHealthy: health?.providers.healthy ?? true,
      databaseHealthy: health?.database.healthy ?? true,
      pipelinesHealthy: health?.pipelines.healthy ?? true,
      memoryHealthy: health?.memory.healthy ?? true,
      memoryUsedMB: health?.memory.usedMB ?? 0,
    },
  };
}

/**
 * Get a summary string for console logging.
 */
export function getMetricsSummary(): string {
  const m = getMetricsSnapshot();
  return (
    `[Metrics] Pipeline: ${m.pipeline.totalOptimizations} opts, ${m.pipeline.totalFailures} fails, ` +
    `ATS avg ${m.pipeline.avgAtsScore} | ` +
    `Providers: ${m.providers.trippedCount} tripped, ${m.providers.providerFailures} fails | ` +
    `Repairs: ${m.repairs.totalRepairs} (${m.repairs.repairSuccessRate}% success) | ` +
    `Incidents: ${m.incidents.total} (${m.incidents.critical} critical) | ` +
    `Health: ${m.health.overall ? "OK" : "ISSUES"} ${m.health.memoryUsedMB}MB`
  );
}
