// ============================================================================
// OptimizationWatchdog — Phase 15-24 hardening
//
// Detects pipeline hangs, deadlocks, and stalls during the optimization run.
//
// Features:
//   • 120 s hard timeout on the entire pipeline (PIPELINE_TIMEOUT_MS)
//   • Per-step stall detection (step has been "running" for > STEP_STALL_MS)
//   • Exponential-backoff retry helper (withRetry)
//   • Promise race helper (withTimeout)
//   • OptimizationProviderExhaustedError — thrown when all providers fail
// ============================================================================

"use client";

/**
 * Total pipeline hard-timeout.
 *
 * Bumped from 120s → 300s (5 min) so the 6-step pipeline has enough headroom
 * when the Resume Optimizer step legitimately needs 90–120s on slower free-tier
 * providers (e.g. OpenCode free models with an ~22k-char directive + 8k output
 * tokens). The previous 120s cap was being hit whenever ONE provider timed out
 * at 60s and the next step then re-tried the same provider, blowing the budget.
 */
export const PIPELINE_TIMEOUT_MS = 300_000;

/** Per-step stall threshold — if a step is "running" for longer than this, it's stalled. */
export const STEP_STALL_MS = 240_000;

/** Default per-AI-call timeout (60 s). */
export const AI_CALL_TIMEOUT_MS = 60_000;

/**
 * Extended per-AI-call timeout for the Resume / Aviation Optimizer call.
 *
 * The optimizer ships a ~22k-char directive + a serialized resume + JD + 8k
 * output tokens. Free-tier models (OpenCode free, Nvidia build-free, etc.)
 * routinely take 70–110s on this payload. The default 60s timeout was killing
 * legitimate in-flight requests, then the pipeline retried the same provider
 * on the next step and ran into the 120s pipeline cap.
 */
export const OPTIMIZER_CALL_TIMEOUT_MS = 120_000;

/**
 * Short cooldown applied when a provider TIMES OUT (not 429/401).
 *
 * Long enough to skip the same broken provider on subsequent pipeline steps
 * within a single optimization run, short enough that the user can retry
 * manually without waiting for a long ban to expire.
 */
export const PROVIDER_TIMEOUT_COOLDOWN_MS = 90_000; // 90 seconds

// ============================================================================
// Custom errors
// ============================================================================

export class OptimizationTimeoutError extends Error {
  constructor(message = "Optimization timed out after 300 seconds.") {
    super(message);
    this.name = "OptimizationTimeoutError";
  }
}

export class OptimizationProviderExhaustedError extends Error {
  constructor(message = "All AI providers failed or are unavailable.") {
    super(message);
    this.name = "OptimizationProviderExhaustedError";
  }
}

export class OptimizationDeadlockError extends Error {
  constructor(stepName: string, elapsedMs: number) {
    super(
      `Pipeline deadlock detected: step "${stepName}" has been running for ${Math.round(elapsedMs / 1000)}s (>${STEP_STALL_MS / 1000}s limit).`
    );
    this.name = "OptimizationDeadlockError";
  }
}

// ============================================================================
// withTimeout — wraps any Promise in a hard timeout
// ============================================================================

/**
 * Race a promise against a timeout.
 * If the promise does not resolve within `ms` milliseconds, `TimeoutError` is thrown.
 *
 * @param promise  The async operation to time-box.
 * @param ms       Maximum wait time in milliseconds.
 * @param label    Human-readable label for the timeout error message.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new OptimizationTimeoutError(
          `"${label}" timed out after ${Math.round(ms / 1000)}s. Pipeline aborted.`
        )
      );
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// ============================================================================
// withRetry — exponential-backoff retry wrapper
// ============================================================================

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3. */
  maxAttempts?: number;
  /** Initial delay in ms before the second attempt. Doubles after each failure. Default: 500. */
  initialDelayMs?: number;
  /** Maximum delay cap in ms. Default: 8000. */
  maxDelayMs?: number;
  /** Optional predicate — if it returns false for a given error, no retry is attempted. */
  retryIf?: (err: unknown) => boolean;
  /** Optional label for logging. */
  label?: string;
}

/**
 * Run `fn` with automatic exponential-backoff retries.
 *
 * @param fn      Async function to retry.
 * @param opts    Retry configuration.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    maxDelayMs = 8_000,
    retryIf = () => true,
    label = "operation",
  } = opts;

  let lastErr: unknown;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !retryIf(err)) {
        throw err;
      }
      console.warn(
        `[Watchdog] "${label}" failed (attempt ${attempt}/${maxAttempts}): ${(err as Error)?.message ?? err}. Retrying in ${delay}ms…`
      );
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  // Should never reach here, but satisfy TS
  throw lastErr;
}

// ============================================================================
// OptimizationWatchdog — singleton lifecycle manager for a single pipeline run
// ============================================================================

export interface WatchdogOptions {
  /** Called when the watchdog detects a stall. */
  onStall?: (stepName: string, elapsedMs: number) => void;
  /** Stall threshold override in ms. Default: STEP_STALL_MS */
  stallThresholdMs?: number;
}

export interface WatchdogStepHandle {
  /** Mark the step as completed — clears the stall timer. */
  complete: () => void;
  /** Mark the step as failed — clears the stall timer. */
  fail: (err?: unknown) => void;
}

/**
 * Lightweight watchdog for the optimization pipeline.
 *
 * Usage:
 *   const watchdog = new OptimizationWatchdog();
 *   const step = watchdog.startStep("Resume Optimizer");
 *   try {
 *     await doWork();
 *     step.complete();
 *   } catch(e) {
 *     step.fail(e);
 *     throw e;
 *   }
 */
export class OptimizationWatchdog {
  private _active = true;
  private _stallThresholdMs: number;
  private _onStall?: (stepName: string, elapsedMs: number) => void;
  private _activeTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  constructor(opts: WatchdogOptions = {}) {
    this._stallThresholdMs = opts.stallThresholdMs ?? STEP_STALL_MS;
    this._onStall = opts.onStall;
  }

  /**
   * Register the start of a pipeline step.
   * Returns a handle to call complete() / fail() when the step finishes.
   */
  startStep(stepName: string): WatchdogStepHandle {
    const startedAt = Date.now();
    let done = false;

    const timer = setTimeout(() => {
      if (done || !this._active) return;
      const elapsedMs = Date.now() - startedAt;
      const msg = `[Watchdog] ⚠ Stall detected: "${stepName}" has been running for ${Math.round(elapsedMs / 1000)}s`;
      console.error(msg);
      this._onStall?.(stepName, elapsedMs);
    }, this._stallThresholdMs);

    this._activeTimers.add(timer);

    const cleanup = () => {
      done = true;
      clearTimeout(timer);
      this._activeTimers.delete(timer);
    };

    return {
      complete: cleanup,
      fail: cleanup,
    };
  }

  /**
   * Stop the watchdog and clear all pending stall timers.
   * Must be called when the pipeline finishes (success or failure).
   */
  stop(): void {
    this._active = false;
    for (const t of this._activeTimers) {
      clearTimeout(t);
    }
    this._activeTimers.clear();
  }
}
