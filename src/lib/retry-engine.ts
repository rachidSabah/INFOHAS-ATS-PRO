// ============================================================================
// Targeted Self-Healing Retry Engine
//
// Never retry the entire pipeline. Retry the FAILED AGENT only.
// Max 3 retries per agent.
//
// Pipeline workflow:
//   Failed Agent → Corrective Feedback → Retry → Assembler → Guardian
//
// Usage:
//   const engine = createRetryEngine({ maxRetries: 3 });
//   const result = await engine.run('experience-agent', () => optimizeExperience(source));
//   if (!result.success) { /* restore previous valid section */ }
// ============================================================================

"use client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryState {
  agentId: string;
  attempt: number;
  maxRetries: number;
  lastError: string | null;
  errors: string[];
  status: "idle" | "running" | "success" | "failed" | "exhausted";
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export interface RetryResult<T> {
  success: boolean;
  value: T | null;
  attempt: number;
  attempts: number;
  errors: string[];
  exhausted: boolean;
  fallbackUsed: boolean;
}

export interface RetryEngine {
  /**
   * Execute a function with retry logic.
   *
   * @param agentId - Unique identifier for the agent being retried
   * @param fn - Async function to execute (the agent's work)
   * @param fallback - Optional fallback value to return when retries exhausted
   * @param shouldRetry - Optional predicate; if not provided, retry on ANY error
   * @returns RetryResult with the outcome
   */
  run<T>(
    agentId: string,
    fn: () => Promise<T>,
    fallback?: T | null,
    shouldRetry?: (err: unknown) => boolean,
  ): Promise<RetryResult<T>>;

  /**
   * Reset retry state for a specific agent (clears attempt count & errors).
   */
  reset(agentId: string): void;

  /**
   * Get the current retry state for an agent.
   */
  getState(agentId: string): RetryState;

  /**
   * Get retry states for all tracked agents.
   */
  getAllStates(): Record<string, RetryState>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a targeted self-healing retry engine instance.
 *
 * @param config - Partial config to override defaults
 * @returns A RetryEngine instance
 *
 * @example
 * ```ts
 * const engine = createRetryEngine({ maxRetries: 3, baseDelayMs: 500 });
 *
 * // Run an agent with retry
 * const result = await engine.run('experience-agent', () =>
 *   optimizeExperience(source)
 * );
 *
 * // With fallback value
 * const result2 = await engine.run('summary-agent', () =>
 *   optimizeSummary(source),
 *   source.summary // fallback to original if all retries fail
 * );
 *
 * // With custom shouldRetry predicate
 * const result3 = await engine.run('skills-agent', () =>
 *   optimizeSkills(source),
 *   null,
 *   (err) => err instanceof NetworkError === false // don't retry network errors
 * );
 *
 * // Inspect state
 * console.log(engine.getState('experience-agent'));
 * console.log(engine.getAllStates());
 *
 * // Reset for a fresh attempt
 * engine.reset('experience-agent');
 * ```
 */
export function createRetryEngine(config?: Partial<RetryConfig>): RetryEngine {
  const cfg: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const states = new Map<string, RetryState>();

  /**
   * Calculate exponential backoff delay.
   * delay = min(baseDelay * backoffFactor^attempt, maxDelay)
   */
  function getDelay(attempt: number): number {
    const delay = cfg.baseDelayMs * Math.pow(cfg.backoffFactor, attempt);
    return Math.min(delay, cfg.maxDelayMs);
  }

  /**
   * Sleep for the given number of milliseconds.
   */
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Initialize or get the state for an agent.
   */
  function getOrInitState(agentId: string): RetryState {
    let state = states.get(agentId);
    if (!state) {
      state = {
        agentId,
        attempt: 0,
        maxRetries: cfg.maxRetries,
        lastError: null,
        errors: [],
        status: "idle",
      };
      states.set(agentId, state);
    }
    return state;
  }

  // -----------------------------------------------------------------------
  // Engine implementation
  // -----------------------------------------------------------------------

  const engine: RetryEngine = {
    async run<T>(
      agentId: string,
      fn: () => Promise<T>,
      fallback?: T | null,
      shouldRetry?: (err: unknown) => boolean,
    ): Promise<RetryResult<T>> {
      const state = getOrInitState(agentId);
      state.status = "running";
      state.lastError = null;
      state.attempt = 0;

      const errors: string[] = [];

      // Default: retry on any error
      const shouldRetryFn: (err: unknown) => boolean =
        shouldRetry ?? (() => true);

      for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
        state.attempt = attempt;

        try {
          const value = await fn();
          state.status = "success";
          state.lastError = null;

          return {
            success: true,
            value,
            attempt,
            attempts: attempt,
            errors,
            exhausted: false,
            fallbackUsed: false,
          };
        } catch (err: unknown) {
          const errMsg =
            err instanceof Error ? err.message : String(err);
          state.lastError = errMsg;
          state.errors.push(errMsg);
          errors.push(errMsg);

          // Check if we should retry this error
          if (!shouldRetryFn(err)) {
            // Non-retryable error — stop immediately
            state.status = "failed";

            return {
              success: false,
              value: null,
              attempt,
              attempts: attempt,
              errors,
              exhausted: false,
              fallbackUsed: false,
            };
          }

          // If we have more retries, wait and continue
          if (attempt < cfg.maxRetries) {
            const delay = getDelay(attempt - 1); // 0-indexed delay formula
            console.info(
              `[RetryEngine] Agent "${agentId}" failed (attempt ${attempt}/${cfg.maxRetries}): ${errMsg}. Retrying in ${delay}ms...`,
            );
            await sleep(delay);
          }
        }
      }

      // All retries exhausted
      state.status = "exhausted";

      const fallbackValue = fallback !== undefined ? fallback : null;
      const fallbackUsed = fallback !== undefined;

      if (fallbackUsed) {
        console.info(
          `[RetryEngine] Agent "${agentId}" exhausted ${cfg.maxRetries} retries. Using fallback value.`,
        );
      } else {
        console.warn(
          `[RetryEngine] Agent "${agentId}" exhausted ${cfg.maxRetries} retries. No fallback provided.`,
        );
      }

      return {
        success: false,
        value: fallbackValue as T | null,
        attempt: cfg.maxRetries,
        attempts: cfg.maxRetries,
        errors,
        exhausted: true,
        fallbackUsed,
      };
    },

    reset(agentId: string): void {
      const state = states.get(agentId);
      if (state) {
        state.attempt = 0;
        state.lastError = null;
        state.errors = [];
        state.status = "idle";
      }
    },

    getState(agentId: string): RetryState {
      return { ...getOrInitState(agentId) };
    },

    getAllStates(): Record<string, RetryState> {
      const all: Record<string, RetryState> = {};
      states.forEach((state, id) => {
        all[id] = { ...state };
      });
      return all;
    },
  };

  return engine;
}
