// ============================================================================
// Pipeline Coordinator — declarative step-based orchestration engine.
//
// Formalizes the pipeline as a DAG of steps with dependency resolution,
// retry, timeout, fallback, and progress emission.
//
// Design:
//   - Steps are defined declaratively (id, deps, execute, fallback, timeout)
//   - The coordinator topologically sorts them and runs in dependency order
//   - Each step gets its own timeout + retry count
//   - Failed steps can be skipped (marking dependents invalid) or re-routed
//     via fallback
//   - Progress is emitted as typed events (compatible with PipelineProgress)
//   - Integrates with GlobalPipelineContext for shared state
// ============================================================================

import type { PipelineProgress } from "./orchestrator";
import { createSnapshot, type GlobalPipelineContext } from "./pipeline-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineStep<TInput = unknown, TOutput = unknown> {
  /** Unique step identifier (e.g. "job-intelligence", "ats-analysis") */
  id: string;
  /** Human-readable label (shown in progress UI) */
  label: string;
  /** IDs of steps that must complete before this step runs */
  dependencies: string[];
  /** The actual execution function. Receives the current context + outputs
   *  from completed dependency steps. */
  execute: (ctx: StepExecutionContext) => Promise<TOutput>;
  /** Optional fallback — called when execute() throws. Receives the error
   *  and should return a degraded result or rethrow. */
  fallback?: (ctx: StepExecutionContext, error: Error) => Promise<TOutput>;
  /** Per-step timeout in ms (default: 30000) */
  timeout?: number;
  /** Max retries on transient failure (default: 0) */
  retries?: number;
  /** Optional validator — if it returns false, the step is treated as failed
   *  and either retried or fallback is invoked. */
  validate?: (output: TOutput) => { valid: boolean; error?: string };
  /** Type guard / label for downstream consumers (purely informational) */
  tags?: string[];
}

export interface StepExecutionContext {
  /** The shared pipeline context (GlobalPipelineContext) */
  context: GlobalPipelineContext;
  /** Results from all previously completed steps, keyed by step id */
  stepResults: Map<string, unknown>;
  /** Abort signal — step should stop early if aborted */
  signal: AbortSignal;
  /** Current attempt number (1-based) */
  attempt: number;
}

export interface StepOutcome {
  stepId: string;
  status: "completed" | "fallback" | "failed" | "skipped";
  durationMs: number;
  output?: unknown;
  error?: string;
  cached?: boolean;
}

export interface PipelineDefinition {
  id: string;
  steps: PipelineStep[];
}

export interface CoordinatorResult {
  pipelineId: string;
  status: "completed" | "failed" | "aborted";
  outcomes: StepOutcome[];
  durationMs: number;
  /** Final context after the last completed step */
  context: GlobalPipelineContext;
}

// ---------------------------------------------------------------------------
// Topological sort — ensures steps run in dependency order
// ---------------------------------------------------------------------------

interface SortedStep {
  step: PipelineStep;
  /** 0-based layer / level in the DAG (higher = more dependents) */
  level: number;
}

function topoSort(steps: PipelineStep[]): { sorted: SortedStep[]; error?: string } {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const order: SortedStep[] = [];
  const level = new Map<string, number>();
  let error: string | undefined;

  function dfs(id: string, depth: number): boolean {
    if (inStack.has(id)) {
      error = `Circular dependency detected: step "${id}" is part of a cycle`;
      return false;
    }
    if (visited.has(id)) return true;

    inStack.add(id);
    visited.add(id);

    const step = byId.get(id);
    if (!step) {
      error = `Step "${id}" not found in definitions`;
      return false;
    }

    let maxDepLevel = -1;
    for (const dep of step.dependencies) {
      if (!dfs(dep, depth + 1)) return false;
      maxDepLevel = Math.max(maxDepLevel, level.get(dep) ?? -1);
    }

    level.set(id, maxDepLevel + 1);
    order.push({ step: byId.get(id)!, level: maxDepLevel + 1 });
    inStack.delete(id);
    return true;
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      if (!dfs(step.id, 0)) break;
    }
  }

  // Sort by level so we get a stable execution order
  order.sort((a, b) => a.level - b.level);

  return { sorted: order, error };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validatePipelineDefinition(definition: PipelineDefinition): string[] {
  const errors: string[] = [];
  const ids = new Set(definition.steps.map((s) => s.id));

  // Duplicate IDs
  if (ids.size !== definition.steps.length) {
    errors.push("Duplicate step IDs detected");
  }

  // Missing dependencies
  for (const step of definition.steps) {
    for (const dep of step.dependencies) {
      if (!ids.has(dep)) {
        errors.push(`Step "${step.id}" depends on unknown step "${dep}"`);
      }
    }
  }

  // Circular dependencies
  const { error } = topoSort(definition.steps);
  if (error) errors.push(error);

  // No steps
  if (definition.steps.length === 0) {
    errors.push("Pipeline has no steps");
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Run a coordinated pipeline — executes steps in dependency order with
 * retry, timeout, fallback, and progress emission.
 */
export async function runCoordinatedPipeline(
  definition: PipelineDefinition,
  context: GlobalPipelineContext,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: PipelineProgress) => void;
  },
): Promise<CoordinatorResult> {
  const pipelineId = definition.id;
  const startTime = Date.now();
  const outcomes: StepOutcome[] = [];
  const stepResults = new Map<string, unknown>();
  const totalSteps = definition.steps.length;

  // Validate before running
  const validationErrors = validatePipelineDefinition(definition);
  if (validationErrors.length > 0) {
    return {
      pipelineId,
      status: "failed",
      outcomes: [],
      durationMs: Date.now() - startTime,
      context,
      error: `Pipeline validation failed: ${validationErrors.join("; ")}`,
    } as any;
  }

  // Sort steps
  const { sorted } = topoSort(definition.steps);
  if (!sorted) {
    return {
      pipelineId,
      status: "failed",
      outcomes: [],
      durationMs: Date.now() - startTime,
      context,
    } as any;
  }

  // Determine which steps to run based on available results from dependencies
  const completedIds = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const { step } = sorted[i];

    // Check abort
    if (options?.signal?.aborted) {
      break;
    }

    // Check all dependencies completed
    const missingDeps = step.dependencies.filter((d) => !completedIds.has(d));
    if (missingDeps.length > 0) {
      // A dependency was skipped or failed — skip this step too
      outcomes.push({
        stepId: step.id,
        status: "skipped",
        durationMs: 0,
        error: `Skipped — dependency step(s) "${missingDeps.join('", "')}" did not complete`,
      });
      continue;
    }

    // Emit progress before step
    const stepOutcome = await executeStep(step, stepResults, context, {
      signal: options?.signal ?? new AbortController().signal,
      stepIndex: i,
      totalSteps,
      onProgress: options?.onProgress,
    });

    outcomes.push(stepOutcome);
    if (stepOutcome.status === "completed" || stepOutcome.status === "fallback") {
      completedIds.add(step.id);
      if (stepOutcome.output !== undefined) {
        stepResults.set(step.id, stepOutcome.output);
      }
    }

    // Emit progress after step
    const elapsed = Date.now() - startTime;
    const logMsg = stepOutcome.status === "completed"
      ? `${step.label} completed in ${stepOutcome.durationMs}ms`
      : stepOutcome.status === "fallback"
        ? `${step.label} completed (fallback) in ${stepOutcome.durationMs}ms`
        : stepOutcome.status === "skipped"
          ? `${step.label} skipped`
          : `${step.label} failed: ${stepOutcome.error ?? "Unknown error"}`;
    options?.onProgress?.(mkProgress(i, totalSteps, step.label, logMsg, elapsed));
  }

  // Determine overall status
  const anyFailed = outcomes.some((o) => o.status === "failed");
  const anySkipped = outcomes.some((o) => o.status === "skipped");
  const allCompleted = outcomes.every(
    (o) => o.status === "completed" || o.status === "fallback",
  );

  let status: CoordinatorResult["status"] = "completed";
  if (options?.signal?.aborted) {
    status = "aborted";
  } else if (anyFailed) {
    status = "failed";
  } else if (!allCompleted && anySkipped) {
    // Some steps were skipped due to upstream failures — still a "failed" pipeline
    status = "failed";
  }

  return {
    pipelineId,
    status,
    outcomes,
    durationMs: Date.now() - startTime,
    context,
  };
}

// ---------------------------------------------------------------------------
// Step execution (single step with retry + timeout + fallback)
// ---------------------------------------------------------------------------

async function executeStep(
  step: PipelineStep,
  stepResults: Map<string, unknown>,
  context: GlobalPipelineContext,
  opts: {
    signal: AbortSignal;
    stepIndex: number;
    totalSteps: number;
    onProgress?: (progress: PipelineProgress) => void;
  },
): Promise<StepOutcome> {
  const startTime = Date.now();
  const maxAttempts = (step.retries ?? 0) + 1;
  const stepTimeout = step.timeout ?? 30_000;

  // Snapshot before step
  createSnapshot(context, step.id, `before-${step.id}`);

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal.aborted) {
      return {
        stepId: step.id,
        status: "failed",
        durationMs: Date.now() - startTime,
        error: "Aborted",
      };
    }

    try {
      // Emit progress at the start
      opts.onProgress?.(mkProgress(
        opts.stepIndex,
        opts.totalSteps,
        step.label,
        `Running ${step.label}${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}…`,
        Date.now() - startTime,
      ));

      const ctx: StepExecutionContext = {
        context,
        stepResults,
        signal: opts.signal,
        attempt,
      };

      // Execute with timeout
      const output = await withTimeout(step.execute(ctx), stepTimeout);

      // Validate output
      if (step.validate) {
        const validation = step.validate(output);
        if (!validation.valid) {
          throw new Error(validation.error ?? `Validation failed for step "${step.id}"`);
        }
      }

      // Snapshot after step
      createSnapshot(context, step.id, `after-${step.id}`);

      return {
        stepId: step.id,
        status: "completed",
        durationMs: Date.now() - startTime,
        output,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTransient = isTransientError(lastError);

      // Retry only for transient errors
      if (attempt < maxAttempts && isTransient) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
        await sleep(delay);
        continue;
      }

      // Try fallback
      if (step.fallback) {
        const ctx: StepExecutionContext = {
          context,
          stepResults,
          signal: opts.signal,
          attempt,
        };

        try {
          const fallbackOutput = await step.fallback(ctx, lastError);
          return {
            stepId: step.id,
            status: "fallback",
            durationMs: Date.now() - startTime,
            output: fallbackOutput,
            error: lastError.message,
          };
        } catch (fallbackErr) {
          lastError = fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
        }
      }

      // No more retries and no fallback (or fallback also failed)
      break;
    }
  }

  return {
    stepId: step.id,
    status: "failed",
    durationMs: Date.now() - startTime,
    error: lastError?.message ?? "Unknown error",
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function mkProgress(
  stepIndex: number,
  totalSteps: number,
  stepName: string,
  log: string,
  elapsedMs?: number,
): PipelineProgress {
  const etaSeconds = elapsedMs != null && stepIndex > 0
    ? Math.round((elapsedMs / stepIndex) * (totalSteps - stepIndex) / 1000)
    : 0;
  return {
    stepIndex,
    totalSteps,
    stepNumber: stepIndex + 1,
    stepName,
    percent: totalSteps > 0 ? Math.round(((stepIndex + 1) / totalSteps) * 100) : 100,
    etaSeconds,
    log,
  };
}

function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("rate limit") ||
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("5") ||
    msg.includes("too many requests") ||
    msg.includes("retry")
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms`));
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
