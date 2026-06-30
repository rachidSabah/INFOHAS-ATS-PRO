// ============================================================================
// Request Deduplication & Debouncing — Section 9
// ============================================================================
// Prevents duplicate work when the same request arrives multiple times
// within a short window (e.g., rapid editor keystrokes triggering
// re-optimization, double-click on export button).
//
// Strategy:
//   - Dedupe by request signature (hash of method + URL + body)
//   - In-flight check: if same request is already pending, return the
//     existing promise instead of starting a new one
//   - Debounce: coalesce rapid identical requests into a single call
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface DedupeOptions {
  /** Time window in ms during which identical requests are coalesced (default: 2000) */
  windowMs: number;
  /** Include body content in dedup signature (default: true) */
  includeBody: boolean;
  /** Maximum number of concurrent in-flight requests tracked (safety limit) */
  maxInFlight: number;
}

export interface DedupeStats {
  totalRequests: number;
  deduplicated: number;
  inFlightCurrent: number;
  windowHits: number;
}

const DEFAULT_OPTIONS: DedupeOptions = {
  windowMs: 2_000,
  includeBody: true,
  maxInFlight: 100,
};

// ============================================================================
// RequestDeduplicator
// ============================================================================

export class RequestDeduplicator {
  private options: DedupeOptions;
  private inflight = new Map<string, Promise<unknown>>();
  private completed = new Map<string, { result: unknown; timestamp: number }>();
  private stats: DedupeStats = {
    totalRequests: 0,
    deduplicated: 0,
    inFlightCurrent: 0,
    windowHits: 0,
  };

  constructor(options?: Partial<DedupeOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a request with deduplication and debouncing.
   * If an identical request is already in-flight, returns the existing promise.
   * If an identical request completed within the window, returns the cached result.
   */
  async execute<T>(
    signature: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.stats.totalRequests++;

    // 1. Check window cache (completed within windowMs)
    const cached = this.completed.get(signature);
    if (cached && (Date.now() - cached.timestamp) < this.options.windowMs) {
      this.stats.windowHits++;
      return cached.result as T;
    }

    // 2. Check in-flight
    const existing = this.inflight.get(signature);
    if (existing) {
      this.stats.deduplicated++;
      return existing as Promise<T>;
    }

    // 3. Prune stale entries if we're at capacity
    if (this.inflight.size >= this.options.maxInFlight) {
      this.pruneOldest();
    }

    // 4. Execute
    const promise = fn()
      .then((result) => {
        this.inflight.delete(signature);
        this.completed.set(signature, { result, timestamp: Date.now() });
        this.cleanCompleted();
        return result;
      })
      .catch((err) => {
        this.inflight.delete(signature);
        throw err;
      });

    this.inflight.set(signature, promise);
    this.stats.inFlightCurrent = this.inflight.size;
    return promise as Promise<T>;
  }

  /**
   * Create a request signature from method, URL, and optional body.
   */
  static createSignature(
    method: string,
    url: string,
    body?: unknown,
    includeBody = true,
  ): string {
    const base = `${method}:${url}`;
    if (!includeBody || body === undefined) return base;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    // Simple hash for dedup key (not cryptographic)
    let hash = 0;
    for (let i = 0; i < bodyStr.length; i++) {
      const char = bodyStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return `${base}#${hash}`;
  }

  /**
   * Clear all deduplication state.
   */
  clear(): void {
    this.inflight.clear();
    this.completed.clear();
    this.stats = { totalRequests: 0, deduplicated: 0, inFlightCurrent: 0, windowHits: 0 };
  }

  /**
   * Get current deduplication stats.
   */
  getStats(): DedupeStats {
    return { ...this.stats, inFlightCurrent: this.inflight.size };
  }

  // ── Private ─────────────────────────────────────────────────────────

  private cleanCompleted(): void {
    const cutoff = Date.now() - this.options.windowMs * 2;
    Array.from(this.completed.entries()).forEach(([key, entry]) => {
      if (entry.timestamp < cutoff) {
        this.completed.delete(key);
      }
    });
  }

  private pruneOldest(): void {
    let oldestKey: string | undefined;
    Array.from(this.inflight.keys()).some((key) => {
      oldestKey = key;
      return true; // take first
    });
    if (oldestKey) {
      this.inflight.delete(oldestKey);
    }
  }
}
