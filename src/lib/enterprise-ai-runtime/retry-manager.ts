// ============================================================================
// RetryManager — exponential backoff, timeout config, retry orchestration
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  jitterFactor: number;  // 0-1, random jitter to avoid thundering herd
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  timeoutMs: 60_000,
  jitterFactor: 0.2,
};

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  attempts: number;
  totalDurationMs: number;
}

/**
 * RetryManager — handles retry logic with exponential backoff and jitter.
 *
 * Supports:
 * - Exponential backoff: delay = baseDelay * 2^attempt + jitter
 * - Jitter: random offset to prevent thundering herd
 * - Timeout: per-call timeout
 * - Configurable max retries
 */
export class RetryManager {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with retry logic.
   */
  async execute<T>(
    fn: () => Promise<T>,
    attempt: number = 0,
    startTime: number = Date.now(),
  ): Promise<RetryResult<T>> {
    const results: string[] = [];

    for (let i = 0; i <= this.config.maxRetries; i++) {
      try {
        // Create timeout promise
        const result = await this.withTimeout(fn(), this.config.timeoutMs);
        return {
          success: true,
          result,
          attempts: i + 1,
          totalDurationMs: Date.now() - startTime,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        results.push(`Attempt ${i + 1}: ${errMsg}`);

        const lastAttempt = i >= this.config.maxRetries;
        if (lastAttempt) {
          return {
            success: false,
            error: `All ${this.config.maxRetries + 1} retries failed. ${results.join("; ")}`,
            attempts: i + 1,
            totalDurationMs: Date.now() - startTime,
          };
        }

        // Wait with exponential backoff + jitter before next attempt
        await this.delay(i);
      }
    }

    return {
      success: false,
      error: "Unexpected retry termination",
      attempts: this.config.maxRetries + 1,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Determine if a response should be retried based on status code or error.
   */
  shouldRetry(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      // Retry on server errors, rate limits, timeouts
      if (msg.includes("429") || msg.includes("rate limit")) return true;
      if (msg.includes("500") || msg.includes("503") || msg.includes("502")) return true;
      if (msg.includes("timeout") || msg.includes("timed out")) return true;
      if (msg.includes("econnrefused") || msg.includes("econnreset")) return true;
      if (msg.includes("service unavailable")) return true;
      if (msg.includes("too many requests")) return true;
      // Don't retry auth failures
      if (msg.includes("401") || msg.includes("403")) return false;
      if (msg.includes("invalid api key")) return false;
    }
    return false;
  }

  // ── Backoff ──────────────────────────────────────────────────────────

  /**
   * Delay with exponential backoff and jitter.
   */
  private async delay(attempt: number): Promise<void> {
    const delay = this.calculateDelay(attempt);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Calculate delay for a given attempt number.
   * delay = baseDelay * 2^attempt
   * Then capped at maxDelay
   * Then jitter applied: ±jitterFactor * delay
   */
  private calculateDelay(attempt: number): number {
    const exponential = this.config.baseDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exponential, this.config.maxDelayMs);
    const jitter = capped * this.config.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + jitter));
  }

  /**
   * Wrap a promise with a timeout.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  // ── Config ───────────────────────────────────────────────────────────

  getConfig(): RetryConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the estimated max total time for all retries.
   */
  getMaxTotalTimeMs(): number {
    let total = 0;
    for (let i = 0; i <= this.config.maxRetries; i++) {
      total += this.calculateDelay(i) + this.config.timeoutMs;
    }
    return total;
  }
}
