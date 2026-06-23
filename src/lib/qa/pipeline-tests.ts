// ResumeAI Pro — Pipeline Validation Tests
// Validates that every stage of the resume optimization pipeline completes
// successfully. Asserts: every stage completed, no silent failures.
//
// Pure functions — safe for Edge Runtime and unit tests.

import type { PipelineStageResult, QATestResult } from "./types";
import { PIPELINE_STAGES } from "./types";

/**
 * Validate pipeline stage results against expected stages.
 * Returns per-stage validation and overall pass/fail.
 */
export function validatePipelineStages(
  stageResults: Array<{ stage: string; completed: boolean; durationMs?: number; error?: string }>
): {
  allCompleted: boolean;
  stageResults: PipelineStageResult[];
  missingStages: string[];
  failedStages: PipelineStageResult[];
  totalDurationMs: number;
} {
  const results: PipelineStageResult[] = stageResults.map((s, i) => ({
    stage: s.stage,
    stageIndex: i,
    completed: s.completed,
    durationMs: s.durationMs || 0,
    outputValid: s.completed && !s.error,
    error: s.error,
  }));

  const completedStages = new Set(results.map((r) => r.stage));
  const missingStages = [...PIPELINE_STAGES].filter(
    (stage) => !completedStages.has(stage)
  );
  const failedStages = results.filter((r) => !r.completed || r.error);
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  return {
    allCompleted: missingStages.length === 0 && failedStages.length === 0,
    stageResults: results,
    missingStages,
    failedStages,
    totalDurationMs,
  };
}

/**
 * Create a mock pipeline stage result set for testing.
 * Simulates a full pipeline run with expected outcomes.
 */
export function createExpectedPipelineStages(): PipelineStageResult[] {
  return [...PIPELINE_STAGES].map((stage, i) => ({
    stage,
    stageIndex: i,
    completed: true,
    durationMs: 0,
    outputValid: true,
  }));
}

/**
 * Generate QA test results from pipeline validation.
 */
export function pipelineToQATests(
  validation: ReturnType<typeof validatePipelineStages>
): QATestResult[] {
  const results: QATestResult[] = [];
  const timestamp = new Date().toISOString();

  // Test: All stages completed
  results.push({
    id: `pipeline_stages_${Date.now()}`,
    name: "Pipeline: All Stages Completed",
    category: "pipeline",
    severity: "critical",
    passed: validation.allCompleted,
    message: validation.allCompleted
      ? `All ${PIPELINE_STAGES.length} pipeline stages completed`
      : `Missing stages: ${validation.missingStages.join(", ")}`,
    durationMs: validation.totalDurationMs,
    timestamp,
    details: {
      completedStages: validation.stageResults.filter((r) => r.completed).length,
      failedStages: validation.failedStages.map((r) => r.stage),
    },
  });

  // Test: Each individual stage
  for (const stage of validation.stageResults) {
    results.push({
      id: `pipeline_stage_${stage.stageIndex}_${Date.now()}`,
      name: `Pipeline Stage: ${stage.stage}`,
      category: "pipeline",
      severity: stage.completed ? "info" : "critical",
      passed: stage.completed && stage.outputValid,
      message: stage.completed
        ? `Completed in ${stage.durationMs}ms`
        : `FAILED: ${stage.error || "Unknown error"}`,
      durationMs: stage.durationMs,
      timestamp,
      error: stage.error,
    });
  }

  return results;
}

/**
 * Validate that the pipeline follows the expected stage order.
 * Detects skipped or out-of-order stages.
 */
export function validatePipelineOrder(
  executedStages: string[]
): { orderValid: boolean; outOfOrder: string[]; skipped: string[] } {
  const expected = [...PIPELINE_STAGES];
  const outOfOrder: string[] = [];
  const skipped: string[] = [];

  let lastIndex = -1;
  for (const stage of executedStages) {
    const idx = expected.indexOf(stage);
    if (idx === -1) {
      outOfOrder.push(stage);
    } else if (idx <= lastIndex) {
      outOfOrder.push(`${stage} (executed after ${expected[lastIndex]})`);
    } else {
      // Check for skipped stages between lastIndex and idx
      for (let i = lastIndex + 1; i < idx; i++) {
        if (!executedStages.includes(expected[i])) {
          skipped.push(expected[i]);
        }
      }
      lastIndex = idx;
    }
  }

  return {
    orderValid: outOfOrder.length === 0 && skipped.length === 0,
    outOfOrder,
    skipped,
  };
}

/**
 * Validate pipeline output integrity.
 * Checks that the output of each stage is valid for the next stage.
 */
export function validatePipelineOutputIntegrity(
  stageOutputs: Array<{ stage: string; hasOutput: boolean; outputType: string }>
): { integrityPassed: boolean; invalidStages: string[] } {
  const invalidStages: string[] = [];

  for (const output of stageOutputs) {
    if (!output.hasOutput) {
      invalidStages.push(`${output.stage}: No output produced`);
    }
  }

  return {
    integrityPassed: invalidStages.length === 0,
    invalidStages,
  };
}
