/**
 * Truthful optimizer failure report — pure composition helper.
 *
 * Production trace (HEAD 0de936c): a real optimization run failed with the
 * USELESS nested message:
 *   "Optimization could not be completed after 4 validated attempts …
 *    Last error: Optimization could not be completed after 3 validated
 *    attempt(s) (bounded auto-heal ran between attempts). The original
 *    resume was NOT substituted as the result."
 *
 * Why: the locked pipeline throws OptimizerUnrecoverableError carrying
 * `attemptErrors: string[]` — one truthful diagnosis per inner attempt
 * (Guardian blocks, output-validation failures, provider classes…) — but
 * the orchestrator's catch block stored only `e.message` (the generic
 * wrapper). The per-attempt diagnoses were never surfaced, so neither the
 * UI nor the user could see WHY the run failed.
 *
 * This helper composes the final failure report from every available
 * diagnosis source, most-recent-first in relevance:
 *   1. the LAST inner attempt diagnosis (most recent, most relevant),
 *      with a count of earlier inner failures (full list goes to console),
 *   2. else the caught error message,
 *   3. else the tracked failure reason,
 *   4. else "unknown error".
 *
 * It also produces a truthful progress string — replacing the stale fixed
 * "AI providers unavailable" emit that showed for Guardian/parser failures
 * and misled users into thinking their quota was exhausted.
 */

export interface ComposeOptimizerFailureReportInput {
  /** Outer orchestrator attempt budget (from the selected Pipeline Profile). */
  maxOptimizeAttempts: number;
  /** Message of the last error caught by the outer attempt loop. */
  optimizeError: string | null;
  /** Tracked failure reason from the previous attempt (strategy feedback). */
  lastFailureReason: string | null;
  /**
   * Per-attempt diagnoses captured from OptimizerUnrecoverableError thrown
   * by the locked pipeline (one entry per inner attempt, in order).
   */
  innerAttemptErrors: string[];
}

export interface OptimizerFailureReport {
  /** The single most informative diagnosis to report as "Last error". */
  lastErr: string;
  /** Full message for the typed recoverable error (established format). */
  message: string;
  /** Truthful progress-banner text (never a fixed provider-unavailable string). */
  progress: string;
}

const PROGRESS_MAX_CHARS = 200;

export function composeOptimizerFailureReport(
  input: ComposeOptimizerFailureReportInput,
): OptimizerFailureReport {
  const inner = (input.innerAttemptErrors ?? [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);

  let lastErr: string;
  if (inner.length > 0) {
    const lastInner = inner[inner.length - 1];
    const earlierCount = inner.length - 1;
    lastErr =
      earlierCount > 0
        ? `${lastInner} (plus ${earlierCount} earlier inner attempt failure(s) — full list in console)`
        : lastInner;
  } else {
    lastErr = input.optimizeError || input.lastFailureReason || "unknown error";
  }

  const message =
    `Optimization could not be completed after ${input.maxOptimizeAttempts} validated attempts ` +
    `(auto-heal + strategy feedback between attempts). Original resume NOT substituted. ` +
    `Last error: ${lastErr}`;

  const fullProgress = `Optimization incomplete — last diagnosis: ${lastErr}`;
  const progress =
    fullProgress.length > PROGRESS_MAX_CHARS
      ? `${fullProgress.slice(0, PROGRESS_MAX_CHARS)}…`
      : fullProgress;

  return { lastErr, message, progress };
}
