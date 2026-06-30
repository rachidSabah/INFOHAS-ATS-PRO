// ============================================================================
// Pipeline Executor — resilient agent execution engine.
//
// Executes an agent function with:
//   - Circuit-breaker integration (skip unhealthy providers)
//   - Retry with exponential backoff + jitter (transient errors only)
//   - Timeout enforcement
//   - Transient error detection (429, timeout, network, 5xx)
//   - Per-call metrics (duration, attempts, bytes)
//   - Progress/event emission for the pipeline dashboard
//
// The Executor sits BELOW the Coordinator (pipeline-coordinator.ts).
// Coordinator runs steps; Executor runs each step's agent call.
// ============================================================================

import { isProviderAvailable, circuitBreakerSuccess, circuitBreakerFailure } from "../circuit-breaker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for a single execution attempt */
export interface ExecutionConfig {
  /** Provider ID (e.g. "openai", "anthropic") */
  providerId: string;
  /** Human-readable label for logging */
  label: string;
  /** Maximum time per attempt (ms) */
  timeoutMs?: number;
  /** Max retries for transient errors (default 2) */
  maxRetries?: number;
  /** Max total time across all retries (ms). Default: 120_000 */
  totalTimeoutMs?: number;
  /** Abort signal to cancel mid-execution */
  abortSignal?: AbortSignal;
  /** Called after each attempt (including failures) */
  onAttempt?: (attempt: ExecutionAttempt) => void;
}

/** The function that does the actual work */
export type ExecutorFn = (signal: AbortSignal) => Promise<string>;

/** A single execution attempt result */
export interface ExecutionAttempt {
  attempt: number;
  startedAt: number;
  durationMs: number;
  status: "running" | "success" | "retryable" | "failed" | "timeout" | "aborted" | "circuit_broken";
  error?: string;
  bytes?: number;
}

/** Final execution result */
export interface ExecutionResult {
  /** The output text (null if all attempts failed) */
  output: string | null;
  /** Status after all retries */
  status: "success" | "failed" | "aborted" | "circuit_broken";
  /** All attempts */
  attempts: ExecutionAttempt[];
  /** Total time across all attempts */
  totalDurationMs: number;
  /** The specific error from the last attempt */
  error?: string;
  /** Total input+output bytes */
  totalBytes: number;
}

// ---------------------------------------------------------------------------
// Transient Error Detection
// ---------------------------------------------------------------------------

const TRANSIENT_PATTERNS = [
  "timeout",
  "timed out",
  "rate limit",
  "429",
  "too many requests",
  "service unavailable",
  "503",
  "502",
  "bad gateway",
  "internal server error",
  "500",
  "network error",
  "econnrefused",
  "econnreset",
  "eaddrinfo",
  "socket hang up",
  "socket closed",
  "reset by peer",
  "unexpected server response",
  "abort",
  "gateway timeout",
  "504",
  "upstream",
  "temporarily unavailable",
];

function isTransient(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * Execute an agent function with retry, timeout, and circuit-breaker protection.
 *
 * @param fn - The agent function (receives an AbortSignal for cancellation)
 * @param config - Execution configuration
 * @returns ExecutionResult with full attempt history
 */
export async function execute(
  fn: ExecutorFn,
  config: ExecutionConfig,
): Promise<ExecutionResult> {
  const {
    providerId,
    label,
    timeoutMs = 60_000,
    maxRetries = 2,
    totalTimeoutMs = 120_000,
    abortSignal,
    onAttempt,
  } = config;

  const startTime = Date.now();
  const attempts: ExecutionAttempt[] = [];
  let totalBytes = 0;

  // === Circuit breaker check ===
  if (!isProviderAvailable(providerId)) {
    const attempt: ExecutionAttempt = {
      attempt: 0,
      startedAt: startTime,
      durationMs: 0,
      status: "circuit_broken",
      error: `Provider "${providerId}" is unavailable (circuit breaker open)`,
    };
    return {
      output: null,
      status: "circuit_broken",
      attempts: [attempt],
      totalDurationMs: 0,
      totalBytes: 0,
      error: attempt.error,
    };
  }

  // === Check abort signal before starting ===
  if (abortSignal?.aborted) {
    const attempt: ExecutionAttempt = {
      attempt: 0,
      startedAt: startTime,
      durationMs: 0,
      status: "aborted",
      error: "Execution cancelled before start",
    };
    return {
      output: null,
      status: "aborted",
      attempts: [attempt],
      totalDurationMs: 0,
      totalBytes: 0,
      error: attempt.error,
    };
  }

  // === Execute with retry ===
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // Check total timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= totalTimeoutMs) {
      break;
    }

    // Check abort signal
    if (abortSignal?.aborted) {
      attempts.push({
        attempt,
        startedAt: Date.now(),
        durationMs: 0,
        status: "aborted",
        error: "Execution cancelled mid-retry",
      });
      break;
    }

    const attemptStart = Date.now();
    const attemptRec: ExecutionAttempt = {
      attempt,
      startedAt: attemptStart,
      durationMs: 0,
      status: "running",
    };
    attempts.push(attemptRec);

    try {
      // Local abort timeout per attempt
      const remainingTime = totalTimeoutMs - (Date.now() - startTime);
      const attemptTimeout = Math.min(timeoutMs, remainingTime);

      let localAbort: AbortController | undefined;
      let combinedSignal: AbortSignal = abortSignal ?? new AbortController().signal;

      // Only race with timeout if there's a non-zero timeout
      if (attemptTimeout > 0) {
        localAbort = new AbortController();
        const timer = setTimeout(() => localAbort!.abort(), attemptTimeout);

        // Combine abort signals
        const parentSignal = abortSignal;
        const onParentAbort = () => localAbort!.abort();
        parentSignal?.addEventListener("abort", onParentAbort, { once: true });

        try {
          const result = await fn(localAbort.signal);
          clearTimeout(timer);
          parentSignal?.removeEventListener("abort", onParentAbort);

          // Success
          const durationMs = Date.now() - attemptStart;
          const bytes = result.length;
          totalBytes += bytes;
          attemptRec.durationMs = durationMs;
          attemptRec.status = "success";
          attemptRec.bytes = bytes;

          circuitBreakerSuccess(providerId);
          onAttempt?.(attemptRec);

          return {
            output: result,
            status: "success",
            attempts,
            totalDurationMs: Date.now() - startTime,
            totalBytes,
          };
        } finally {
          clearTimeout(timer);
          parentSignal?.removeEventListener("abort", onParentAbort);
          localAbort = undefined;
        }
      } else {
        const result = await fn(combinedSignal);
        const durationMs = Date.now() - attemptStart;
        const bytes = result.length;
        totalBytes += bytes;
        attemptRec.durationMs = durationMs;
        attemptRec.status = "success";
        attemptRec.bytes = bytes;

        circuitBreakerSuccess(providerId);
        onAttempt?.(attemptRec);

        return {
          output: result,
          status: "success",
          attempts,
          totalDurationMs: Date.now() - startTime,
          totalBytes,
        };
      }
    } catch (err) {
      const durationMs = Date.now() - attemptStart;
      attemptRec.durationMs = durationMs;

      const errorMsg = err instanceof Error ? err.message : String(err);
      lastError = errorMsg;

      // Check if aborted
      if (abortSignal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        attemptRec.status = "aborted";
        attemptRec.error = "Aborted";
        onAttempt?.(attemptRec);
        break;
      }

      // Check if timeout
      if (err instanceof Error && err.message.includes("timed out")) {
        attemptRec.status = "timeout";
        attemptRec.error = errorMsg;
        // Timeouts are retryable
        circuitBreakerFailure(providerId, "timeout");
        onAttempt?.(attemptRec);

        // Exponential backoff + jitter
        if (attempt <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 10_000);
          await new Promise((r) => setTimeout(r, delay));
        }
        continue;
      }

      // Check transient
      if (isTransient(err)) {
        attemptRec.status = "retryable";
        attemptRec.error = errorMsg;
        circuitBreakerFailure(providerId, "network");
        onAttempt?.(attemptRec);

        // Exponential backoff + jitter
        if (attempt <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 10_000);
          await new Promise((r) => setTimeout(r, delay));
        }
        continue;
      }

      // Non-transient error — fail immediately
      attemptRec.status = "failed";
      attemptRec.error = errorMsg;
      circuitBreakerFailure(providerId, "network");
      onAttempt?.(attemptRec);
      break;
    }
  }

  // All retries exhausted
  return {
    output: null,
    status: "failed",
    attempts,
    totalDurationMs: Date.now() - startTime,
    totalBytes,
    error: lastError,
  };
}
