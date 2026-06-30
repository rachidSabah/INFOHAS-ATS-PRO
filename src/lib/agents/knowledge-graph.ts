// ============================================================================
// Knowledge Graph — cross-session knowledge for the pipeline.
//
// Lightweight key-value store with TTL, scoped by industry and session.
// Provides the pipeline with:
//   - Industry-specific optimization patterns (keywords, structures)
//   - Provider performance metrics (latency, success rate per task)
//   - Cached ATS gap analysis results
//   - Learning from previous optimizations
//
// Backed by in-memory Map (ephemeral, session-only). Extendable to
// localStorage or IndexedDB for cross-session persistence.
// ============================================================================

// ---------------------------------------------------------------------------
// Storage Backend
// ---------------------------------------------------------------------------

interface StoredValue<T> {
  value: T;
  /** Unix ms when this value expires. 0 = no expiry. */
  expiresAt: number;
  /** When this value was stored */
  createdAt: number;
  /** How many times this value was read */
  accessCount: number;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A piece of knowledge in the graph */
export interface KnowledgeEntry<T = unknown> {
  key: string;
  value: T;
  /**
   * Scope helps organize related knowledge:
   * "global" — applies everywhere (e.g., provider performance)
   * "industry:<id>" — scoped to a specific industry
   * "job:<id>" — scoped to a specific job
   * "session:<id>" — scoped to a specific optimization session
   */
  scope: string;
  /** TTL in seconds. 0 = no expiry. */
  ttl: number;
  /** When this entry was created */
  createdAt: number;
  /** Number of times accessed */
  accessCount: number;
}

export interface KnowledgeStats {
  totalEntries: number;
  expiredEntries: number;
  activeEntries: number;
  byScope: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Knowledge Graph
// ---------------------------------------------------------------------------

export class KnowledgeGraph {
  private store = new Map<string, StoredValue<unknown>>();
  private scopeIndex = new Map<string, Set<string>>();

  // -----------------------------------------------------------------------
  // Core CRUD
  // -----------------------------------------------------------------------

  /**
   * Store a value with optional TTL.
   * @param scope - Partition key ("global", "industry:aviation", "job:xxx")
   * @param key - Unique key within the scope
   * @param value - The value to store
   * @param ttlSeconds - Time-to-live in seconds (0 = no expiry)
   */
  set<T>(scope: string, key: string, value: T, ttlSeconds: number = 0): void {
    const fullKey = `${scope}::${key}`;
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;

    this.store.set(fullKey, {
      value,
      expiresAt,
      createdAt: Date.now(),
      accessCount: 0,
    });

    // Index by scope
    if (!this.scopeIndex.has(scope)) {
      this.scopeIndex.set(scope, new Set());
    }
    this.scopeIndex.get(scope)!.add(key);
  }

  /**
   * Retrieve a value by scope and key.
   * Returns undefined if not found or expired.
   */
  get<T>(scope: string, key: string): T | undefined {
    const fullKey = `${scope}::${key}`;
    const stored = this.store.get(fullKey);

    if (!stored) return undefined;

    // Check expiry
    if (stored.expiresAt > 0 && Date.now() > stored.expiresAt) {
      this.store.delete(fullKey);
      this.scopeIndex.get(scope)?.delete(key);
      return undefined;
    }

    stored.accessCount++;
    return stored.value as T;
  }

  /**
   * Delete a value.
   */
  delete(scope: string, key: string): boolean {
    const fullKey = `${scope}::${key}`;
    const existed = this.store.delete(fullKey);
    this.scopeIndex.get(scope)?.delete(key);
    return existed;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.store.clear();
    this.scopeIndex.clear();
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(scope: string, key: string): boolean {
    return this.get(scope, key) !== undefined;
  }

  // -----------------------------------------------------------------------
  // Scope Operations
  // -----------------------------------------------------------------------

  /**
   * Get all non-expired keys in a scope.
   */
  keys(scope: string): string[] {
    this.evictExpired(scope);
    return Array.from(this.scopeIndex.get(scope) ?? []);
  }

  /**
   * Get all non-expired entries in a scope.
   */
  entries<T>(scope: string): KnowledgeEntry<T>[] {
    this.evictExpired(scope);
    const scopeKeys = this.scopeIndex.get(scope);
    if (!scopeKeys) return [];

    const results: KnowledgeEntry<T>[] = [];
    for (const key of scopeKeys) {
      const fullKey = `${scope}::${key}`;
      const stored = this.store.get(fullKey);
      if (stored) {
        results.push({
          key,
          value: stored.value as T,
          scope,
          ttl: stored.expiresAt > 0 ? Math.round((stored.expiresAt - Date.now()) / 1000) : 0,
          createdAt: stored.createdAt,
          accessCount: stored.accessCount,
        });
      }
    }
    return results;
  }

  /**
   * Remove all entries in a scope.
   */
  clearScope(scope: string): void {
    const keys = this.scopeIndex.get(scope);
    if (keys) {
      for (const key of keys) {
        this.store.delete(`${scope}::${key}`);
      }
      this.scopeIndex.delete(scope);
    }
  }

  // -----------------------------------------------------------------------
  // Convenience: Industry-specific helpers
  // -----------------------------------------------------------------------

  /**
   * Store knowledge scoped to an industry.
   */
  setIndustryPattern<T>(industryId: string, key: string, value: T, ttlSeconds: number = 86400): void {
    this.set(`industry:${industryId}`, key, value, ttlSeconds);
  }

  /**
   * Retrieve knowledge scoped to an industry.
   */
  getIndustryPattern<T>(industryId: string, key: string): T | undefined {
    return this.get(`industry:${industryId}`, key);
  }

  /**
   * Store provider performance metric.
   */
  setProviderMetric<T>(providerId: string, metric: string, value: T): void {
    this.set("global", `provider:${providerId}:${metric}`, value, 86400 * 7); // 7 days
  }

  /**
   * Retrieve provider performance metric.
   */
  getProviderMetric<T>(providerId: string, metric: string): T | undefined {
    return this.get("global", `provider:${providerId}:${metric}`);
  }

  /**
   * Store a cache of an ATS analysis result.
   */
  setATSCache<T>(jobId: string, result: T, ttlSeconds: number = 3600): void {
    this.set(`job:${jobId}`, "ats-analysis", result, ttlSeconds);
  }

  /**
   * Retrieve cached ATS analysis.
   */
  getATSCache<T>(jobId: string): T | undefined {
    return this.get(`job:${jobId}`, "ats-analysis");
  }

  // -----------------------------------------------------------------------
  // Maintenance
  // -----------------------------------------------------------------------

  /**
   * Remove all expired entries.
   */
  evictExpired(scope?: string): number {
    let count = 0;
    const now = Date.now();

    if (scope) {
      // Evict within a specific scope
      const keys = this.scopeIndex.get(scope);
      if (!keys) return 0;
      for (const key of keys) {
        const fullKey = `${scope}::${key}`;
        const stored = this.store.get(fullKey);
        if (stored && stored.expiresAt > 0 && now > stored.expiresAt) {
          this.store.delete(fullKey);
          keys.delete(key);
          count++;
        }
      }
      if (keys.size === 0) this.scopeIndex.delete(scope);
    } else {
      // Global eviction
      for (const [fullKey, stored] of this.store) {
        if (stored.expiresAt > 0 && now > stored.expiresAt) {
          this.store.delete(fullKey);
          count++;
        }
      }
      // Rebuild scope index
      this.scopeIndex.clear();
      for (const [fullKey] of this.store) {
        const sep = fullKey.indexOf("::");
        if (sep > 0) {
          const s = fullKey.slice(0, sep);
          const k = fullKey.slice(sep + 2);
          if (!this.scopeIndex.has(s)) this.scopeIndex.set(s, new Set());
          this.scopeIndex.get(s)!.add(k);
        }
      }
    }

    return count;
  }

  /**
   * Get statistics about the knowledge graph.
   */
  stats(): KnowledgeStats {
    this.evictExpired();
    const totalEntries = this.store.size;
    const byScope: Record<string, number> = {};

    for (const [fullKey] of this.store) {
      const sep = fullKey.indexOf("::");
      const scope = sep > 0 ? fullKey.slice(0, sep) : "unknown";
      byScope[scope] = (byScope[scope] ?? 0) + 1;
    }

    return {
      totalEntries,
      expiredEntries: 0, // already evicted
      activeEntries: totalEntries,
      byScope,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton for the pipeline
// ---------------------------------------------------------------------------

/**
 * Global knowledge graph instance shared across the pipeline.
 */
export const pipelineKnowledge = new KnowledgeGraph();
