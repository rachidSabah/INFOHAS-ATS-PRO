// ============================================================================
// Telemetry Service — tracks agent execution, provider failures, pipeline
// health, repair history, and performance metrics.
//
// All data is stored in-memory (no D1 writes for telemetry — too high-frequency).
// The UI can read from getTelemetrySnapshot() for dashboards.
// ============================================================================

"use client";

export interface AgentExecutionRecord {
  agentName: string;
  timestamp: string;
  durationMs: number;
  success: boolean;
  retries: number;
  confidence: number;
  provider: string | null;
}

export interface ProviderFailureRecord {
  providerName: string;
  timestamp: string;
  errorType: "timeout" | "auth" | "rate_limit" | "network" | "unknown";
  errorMessage: string;
}

export interface PipelineFailureRecord {
  timestamp: string;
  stage: string;
  error: string;
  recovered: boolean;
}

export interface RepairHistoryRecord {
  timestamp: string;
  issue: string;
  rootCause: string;
  repairAction: string;
  durationMs: number;
  success: boolean;
  rollbackRequired: boolean;
}

export interface PerformanceMetrics {
  avgOptimizerDurationMs: number;
  avgQAConfidence: number;
  avgAtsScore: number;
  totalOptimizations: number;
  totalFailures: number;
  totalRepairs: number;
  repairSuccessRate: number;
}

export interface TelemetrySnapshot {
  timestamp: string;
  agentExecutions: AgentExecutionRecord[];
  providerFailures: ProviderFailureRecord[];
  pipelineFailures: PipelineFailureRecord[];
  repairHistory: RepairHistoryRecord[];
  performance: PerformanceMetrics;
}

// In-memory stores (capped to prevent memory leaks)
const MAX_RECORDS = 200;
const agentExecutions: AgentExecutionRecord[] = [];
const providerFailures: ProviderFailureRecord[] = [];
const pipelineFailures: PipelineFailureRecord[] = [];
const repairHistory: RepairHistoryRecord[] = [];

// Running totals for performance metrics
let totalOptimizerDuration = 0;
let totalOptimizerCount = 0;
let totalQAConfidence = 0;
let totalQACount = 0;
let totalAtsScore = 0;
let totalAtsCount = 0;
let totalOptimizations = 0;
let totalFailures = 0;
let totalRepairs = 0;
let successfulRepairs = 0;

/**
 * Record an agent execution.
 */
export function recordAgentExecution(record: Omit<AgentExecutionRecord, "timestamp">): void {
  const entry: AgentExecutionRecord = { ...record, timestamp: new Date().toISOString() };
  agentExecutions.push(entry);
  if (agentExecutions.length > MAX_RECORDS) agentExecutions.shift();

  // Track optimizer-specific metrics
  if (record.agentName === "optimizer") {
    totalOptimizerDuration += record.durationMs;
    totalOptimizerCount++;
  }
  if (record.agentName === "qa") {
    totalQAConfidence += record.confidence;
    totalQACount++;
  }
}

/**
 * Record a provider failure.
 */
export function recordProviderFailure(record: Omit<ProviderFailureRecord, "timestamp">): void {
  const entry: ProviderFailureRecord = { ...record, timestamp: new Date().toISOString() };
  providerFailures.push(entry);
  if (providerFailures.length > MAX_RECORDS) providerFailures.shift();
}

/**
 * Record a pipeline failure.
 */
export function recordPipelineFailure(record: Omit<PipelineFailureRecord, "timestamp">): void {
  const entry: PipelineFailureRecord = { ...record, timestamp: new Date().toISOString() };
  pipelineFailures.push(entry);
  if (pipelineFailures.length > MAX_RECORDS) pipelineFailures.shift();
  totalFailures++;
}

/**
 * Record a repair action.
 */
export function recordRepair(record: Omit<RepairHistoryRecord, "timestamp">): void {
  const entry: RepairHistoryRecord = { ...record, timestamp: new Date().toISOString() };
  repairHistory.push(entry);
  if (repairHistory.length > MAX_RECORDS) repairHistory.shift();
  totalRepairs++;
  if (record.success) successfulRepairs++;
}

/**
 * Record a successful optimization (for success rate calculation).
 */
export function recordOptimization(atsScore: number): void {
  totalOptimizations++;
  totalAtsScore += atsScore;
  totalAtsCount++;
}

/**
 * Get the current telemetry snapshot for dashboards.
 */
export function getTelemetrySnapshot(): TelemetrySnapshot {
  return {
    timestamp: new Date().toISOString(),
    agentExecutions: [...agentExecutions],
    providerFailures: [...providerFailures],
    pipelineFailures: [...pipelineFailures],
    repairHistory: [...repairHistory],
    performance: {
      avgOptimizerDurationMs: totalOptimizerCount > 0 ? Math.round(totalOptimizerDuration / totalOptimizerCount) : 0,
      avgQAConfidence: totalQACount > 0 ? Math.round(totalQAConfidence / totalQACount) : 0,
      avgAtsScore: totalAtsCount > 0 ? Math.round(totalAtsScore / totalAtsCount) : 0,
      totalOptimizations,
      totalFailures,
      totalRepairs,
      repairSuccessRate: totalRepairs > 0 ? Math.round((successfulRepairs / totalRepairs) * 100) : 0,
    },
  };
}

/**
 * Clear all telemetry data — useful for testing.
 */
export function clearTelemetry(): void {
  agentExecutions.length = 0;
  providerFailures.length = 0;
  pipelineFailures.length = 0;
  repairHistory.length = 0;
  totalOptimizerDuration = 0;
  totalOptimizerCount = 0;
  totalQAConfidence = 0;
  totalQACount = 0;
  totalAtsScore = 0;
  totalAtsCount = 0;
  totalOptimizations = 0;
  totalFailures = 0;
  totalRepairs = 0;
  successfulRepairs = 0;
}
