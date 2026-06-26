// ============================================================================
// Production Optimization Patch v1.1 — Types
//
// Additive types for:
//   1. Separated Execution Status / Quality Status
//   2. Monotonic Quality Enforcement (no regressions)
//   3. Active Reflection Agent (structured remediation tasks)
//   4. Blocking vs Warning validation severity
//   5. Parser Integrity Validation
//   6. Rendered HTML Validation
//   7. Resume Quality Index (RQI)
//   8. Quality-Driven Iteration Loop
//   9. Downstream generation gating
//  10. Enhanced Supervisor logging
//
// All types are additive — no existing types are modified.
// ============================================================================

"use client";

import type { RegenerationTarget, QualityGateType } from "./pipeline-orchestration-types";

// ============================================================================
// 1. SEPARATED EXECUTION STATUS / QUALITY STATUS
// ============================================================================

export type ExecutionStatus =
  | "running"
  | "completed"
  | "failed";

export type QualityStatus =
  | "approved"
  | "rejected"
  | "pending-regeneration"
  | "pending";

export interface PipelineStatus {
  executionStatus: ExecutionStatus;
  qualityStatus: QualityStatus;
  /** Human-readable summary, e.g. "Execution completed, quality rejected (ATS score too low)" */
  summary: string;
  /** When the pipeline started */
  startedAt: string;
  /** When the pipeline completed (execution) */
  completedAt?: string;
  /** When quality was approved/rejected */
  qualityDecidedAt?: string;
}

// ============================================================================
// 2. MONOTONIC QUALITY ENFORCEMENT
// ============================================================================

export interface MonotonicQualityMetrics {
  atsScore: number;
  resumeQualityIndex: number;  // RQI
  factualConsistency: number;
  recruiterReadability: number;
  semanticSimilarity: number;
  htmlValidation: number;
  onePageCompliance: number;
}

export interface MonotonicQualityResult {
  approved: boolean;
  /** Metrics from the previous approved version */
  previousMetrics: MonotonicQualityMetrics | null;
  /** Metrics from the current iteration */
  currentMetrics: MonotonicQualityMetrics;
  /** Metrics that regressed (blocked approval) */
  regressedMetrics: string[];
  /** Whether regression was explicitly allowed by config */
  regressionAllowed: boolean;
  /** The restored resume if regression was blocked (previous approved version) */
  restoredResume?: any;
}

// ============================================================================
// 3. ACTIVE REFLECTION AGENT — STRUCTURED REMEDIATION TASKS
// ============================================================================

export interface RemediationTask {
  id: string;
  /** What the issue is */
  issue: string;
  /** How severe (blocking or warning) */
  severity: "blocking" | "warning";
  /** Which agent should fix this */
  responsibleAgent: string;
  /** What improvement is expected */
  expectedImprovement: string;
  /** Confidence this remediation will help (0-100) */
  confidence: number;
  /** Which section to regenerate */
  regenerationTarget: RegenerationTarget;
  /** Which quality gate this addresses */
  relatedQualityGate?: QualityGateType;
  /** Whether the Supervisor has scheduled this for regeneration */
  scheduled: boolean;
  /** Whether this remediation has been applied */
  applied: boolean;
}

export interface ActiveReflectionResult {
  /** Structured remediation tasks (not just suggestions) */
  tasks: RemediationTask[];
  /** Overall confidence in the reflection (0-100) */
  confidence: number;
  /** Summary of the reflection */
  summary: string;
  /** Whether the Supervisor should auto-schedule regeneration */
  shouldAutoSchedule: boolean;
}

// ============================================================================
// 4. BLOCKING vs WARNING VALIDATION SEVERITY
// ============================================================================

export type ValidationSeverity = "blocking" | "warning";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  /** Which quality gate or check this issue is from */
  source: string;
  /** Human-readable description */
  message: string;
  /** Which section is affected */
  section?: string;
  /** The current value */
  currentValue?: number | string;
  /** The required value (threshold) */
  requiredValue?: number | string;
  /** Whether this issue blocks approval */
  blocksApproval: boolean;
}

// ============================================================================
// 5. PARSER INTEGRITY VALIDATION
// ============================================================================

export type ParserIssueType =
  | "merged-fields"
  | "duplicated-labels"
  | "repeated-values"
  | "malformed-languages"
  | "education-corruption"
  | "experience-corruption"
  | "invalid-dates"
  | "invalid-headings"
  | "html-corruption"
  | "parser-hallucination"
  | "missing-required-section"
  | "empty-section";

export interface ParserValidationIssue {
  id: string;
  type: ParserIssueType;
  severity: ValidationSeverity;
  section: string;
  message: string;
  /** The problematic value */
  value?: string;
  /** Suggested fix */
  suggestedFix?: string;
}

export interface ParserValidationResult {
  valid: boolean;
  issues: ParserValidationIssue[];
  blockingCount: number;
  warningCount: number;
}

// ============================================================================
// 6. RENDERED HTML VALIDATION
// ============================================================================

export interface RenderedHtmlMetrics {
  /** Actual rendered height in pixels */
  renderedHeightPx: number;
  /** Target height for one A4 page (in px, depends on viewport) */
  targetHeightPx: number;
  /** Whether the resume fits on one page */
  fitsOnePage: boolean;
  /** Page utilization percentage (renderedHeight / targetHeight * 100) */
  pageUtilization: number;
  /** Whether content overflows */
  hasOverflow: boolean;
  /** Number of pages the content spans */
  pageCount: number;
  /** Whitespace at bottom of page (px) */
  bottomWhitespacePx: number;
  /** Whether margins are within tolerance */
  marginsValid: boolean;
  /** Whether typography is within tolerance */
  typographyValid: boolean;
  /** Any overflow elements detected */
  overflowElements: string[];
}

export interface RenderedHtmlValidationResult {
  valid: boolean;
  metrics: RenderedHtmlMetrics;
  /** Target utilization (default 95-98%) */
  targetUtilization: { min: number; max: number };
  /** Whether the resume meets one-page compliance */
  onePageCompliant: boolean;
  issues: string[];
}

// ============================================================================
// 7. RESUME QUALITY INDEX (RQI)
// ============================================================================

export interface RQIWeights {
  atsScore: number;          // default 0.20
  keywordCoverage: number;   // default 0.10
  factualConsistency: number;// default 0.20
  grammar: number;           // default 0.10
  readability: number;       // default 0.10
  semanticSimilarity: number;// default 0.10
  htmlValidation: number;    // default 0.05
  structure: number;         // default 0.05
  onePageValidation: number; // default 0.05
  exportValidation: number;  // default 0.05
}

export interface RQIResult {
  /** Overall RQI score (0-100) */
  score: number;
  /** Weighted breakdown of each metric */
  breakdown: Array<{
    metric: string;
    score: number;
    weight: number;
    contribution: number;
  }>;
  /** The weights used */
  weights: RQIWeights;
  /** Whether RQI meets the threshold */
  meetsThreshold: boolean;
  /** The threshold (default 80) */
  threshold: number;
  /** Letter grade (A+, A, B, C, D, F) */
  grade: string;
}

// ============================================================================
// 8. QUALITY-DRIVEN ITERATION LOOP
// ============================================================================

export interface IterationRecord {
  iterationNumber: number;
  /** What sections were regenerated in this iteration */
  regeneratedSections: RegenerationTarget[];
  /** Quality metrics before this iteration */
  metricsBefore?: MonotonicQualityMetrics;
  /** Quality metrics after this iteration */
  metricsAfter: MonotonicQualityMetrics;
  /** RQI before this iteration */
  rqiBefore?: number;
  /** RQI after this iteration */
  rqiAfter: number;
  /** Whether this iteration was approved */
  approved: boolean;
  /** Why it was rejected (if applicable) */
  rejectionReason?: string;
  /** Remediation tasks applied in this iteration */
  remediationTasksApplied: string[];
  /** Time spent on this iteration (ms) */
  durationMs: number;
}

export interface IterationLoopResult {
  /** All iterations (1 = first attempt, 2 = first regeneration, etc.) */
  iterations: IterationRecord[];
  /** Final status */
  finalStatus: ExecutionStatus;
  finalQualityStatus: QualityStatus;
  /** Final approved resume (if approved) */
  approvedResume?: any;
  /** Total iterations run */
  totalIterations: number;
  /** Whether the loop hit max iterations */
  hitMaxIterations: boolean;
  /** Whether the loop hit the timeout */
  hitTimeout: boolean;
  /** Total time spent in the loop (ms) */
  totalDurationMs: number;
}

// ============================================================================
// 9. DOWNSTREAM GENERATION GATING
// ============================================================================

export type DownstreamAgentType =
  | "cover-letter"
  | "interview-prep"
  | "career-coach"
  | "salary-insights"
  | "job-search-recommendations";

export interface DownstreamGatingStatus {
  /** Whether downstream agents are allowed to run */
  allowed: boolean;
  /** Why they're blocked (if applicable) */
  blockReason?: string;
  /** The quality status that must be met before downstream runs */
  requiredQualityStatus: QualityStatus;
  /** Current quality status */
  currentQualityStatus: QualityStatus;
}

// ============================================================================
// 10. ENHANCED SUPERVISOR LOGGING
// ============================================================================

export interface SupervisorLogEntry {
  id: string;
  timestamp: string;
  iterationNumber: number;
  /** What event this log entry records */
  event: SupervisorLogEvent;
  /** Provider used */
  provider?: string;
  /** Model used */
  model?: string;
  /** Prompt version used */
  promptVersion?: number;
  /** Whether fallback was used */
  fallbackUsed?: boolean;
  /** Retry count */
  retryCount?: number;
  /** Latency in ms */
  latencyMs?: number;
  /** Prompt tokens */
  promptTokens?: number;
  /** Completion tokens */
  completionTokens?: number;
  /** Total tokens */
  totalTokens?: number;
  /** ATS score before this iteration */
  atsBefore?: number;
  /** ATS score after this iteration */
  atsAfter?: number;
  /** RQI before this iteration */
  rqiBefore?: number;
  /** RQI after this iteration */
  rqiAfter?: number;
  /** Confidence score */
  confidence?: number;
  /** Quality gate results (summary) */
  qualityGateResults?: Array<{ gate: string; score: number; passed: boolean; severity: ValidationSeverity }>;
  /** Approval decision */
  approvalDecision?: "approved" | "rejected" | "pending-regeneration";
  /** Rejection reason (if rejected) */
  rejectionReason?: string;
  /** Targeted regeneration history for this iteration */
  regenerationHistory?: Array<{ target: string; status: string }>;
  /** Additional context */
  details?: string;
}

export type SupervisorLogEvent =
  | "pipeline-started"
  | "agent-started"
  | "agent-completed"
  | "agent-failed"
  | "iteration-started"
  | "iteration-completed"
  | "quality-gate-evaluated"
  | "quality-approved"
  | "quality-rejected"
  | "regeneration-scheduled"
  | "regeneration-completed"
  | "reflection-completed"
  | "fallback-used"
  | "provider-switched"
  | "monotonic-quality-check"
  | "downstream-gated"
  | "pipeline-completed"
  | "pipeline-failed";
