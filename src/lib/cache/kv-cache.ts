// ============================================================================
// KV Cache — Cache-Aside Pattern
// ============================================================================
// Cloudflare KV is eventually consistent globally. This layer implements
// cache-aside with explicit invalidation to guarantee freshness:
//
//   READ path:  Check KV → miss → read D1 → write to KV with TTL → return
//   WRITE path: Write to D1 → delete KV key → (next read refills from cache-aside)
//   INVALIDATE: Delete KV key explicitly after any upstream mutation
//
// Phase 7 constraint: caching must NEVER cause export to run against stale
// ResumeData. validateExportCompleteness() runs synchronously before any file
// is produced regardless of cache path.
//
// Phase 8 constraint: everything goes through PluginManager/ServiceContainer
// — cache wrappers implement the same interface they wrap, they don't bypass it.
// ============================================================================

import type { KVNamespace, D1Database } from './cloudflare-types';

// ============================================================================
// Types
// ============================================================================

export interface CacheEntry<T> {
  value: T;
  cachedAt: number;              // epoch ms
  ttl: number;                   // seconds
  sourceVersion?: string;        // data version tag for staleness checks
}

export interface CacheConfig {
  /** Default TTL in seconds (default: 300 = 5 min) */
  defaultTtl: number;
  /** Prefix for all KV keys to avoid collisions */
  keyPrefix: string;
  /** Whether to log cache operations */
  verbose: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  defaultTtl: 300,
  keyPrefix: 'cache:',
  verbose: false,
};

// ============================================================================
// KVCacheClient
// ============================================================================

export class KVCacheClient {
  private kv: KVNamespace;
  private config: CacheConfig;
  private stats: CacheStats = { hits: 0, misses: 0, sets: 0, deletes: 0, hitRate: 0 };

  constructor(kv: KVNamespace, config?: Partial<CacheConfig>) {
    this.kv = kv;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Cache-aside read: checks KV first, falls back to D1 on miss.
   * The `loader` function is ONLY called on cache miss.
   * Returns the (possibly cached) value, or null if neither cache nor loader produces it.
   */
  async getOrFetch<T>(
    key: string,
    loader: () => Promise<T | null>,
    ttl?: number,
  ): Promise<T | null> {
    const cacheKey = this.buildKey(key);

    // 1. Check KV
    const cached = await this.readFromCache<T>(cacheKey);
    if (cached !== null) {
      this.stats.hits++;
      this.updateHitRate();
      return cached;
    }

    // 2. Cache miss — load from source
    this.stats.misses++;
    this.updateHitRate();
    if (this.config.verbose) {
      console.log(`[KVCache] MISS ${key} — loading from source`);
    }

    const value = await loader();
    if (value === null) return null;

    // 3. Write to cache
    await this.writeToCache(cacheKey, value, ttl ?? this.config.defaultTtl);
    return value;
  }

  /**
   * Explicit set (for pre-warming or write-through scenarios).
   * Prefer getOrFetch for standard cache-aside.
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const cacheKey = this.buildKey(key);
    await this.writeToCache(cacheKey, value, ttl ?? this.config.defaultTtl);
  }

  /**
   * Explicit invalidation — delete the KV key.
   * Called after any upstream mutation (D1 write, directive update, etc.).
   * The next read will miss and refill from the loader.
   */
  async invalidate(key: string): Promise<void> {
    const cacheKey = this.buildKey(key);
    try {
      await this.kv.delete(cacheKey);
      this.stats.deletes++;
      if (this.config.verbose) {
        console.log(`[KVCache] INVALIDATE ${key}`);
      }
    } catch (err) {
      console.error(`[KVCache] Invalidation error for ${key}:`, err);
    }
  }

  /**
   * Invalidate all keys matching a prefix.
   * Used for bulk invalidation (e.g., all caches for a resume).
   */
  async invalidateByPrefix(prefix: string): Promise<number> {
    const cachePrefix = this.buildKey(prefix);
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const result = await this.kv.list({ prefix: cachePrefix, cursor });
      for (const key of result.keys) {
        await this.kv.delete(key.name);
        deleted++;
      }
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    this.stats.deletes += deleted;
    if (this.config.verbose) {
      console.log(`[KVCache] Bulk invalidated ${deleted} keys with prefix "${prefix}"`);
    }
    return deleted;
  }

  /**
   * Check if a key exists in cache.
   */
  async exists(key: string): Promise<boolean> {
    const cacheKey = this.buildKey(key);
    const value = await this.kv.get(cacheKey);
    return value !== null;
  }

  /**
   * Get cache stats.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset stats counters.
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0, hitRate: 0 };
  }

  // ── Private ─────────────────────────────────────────────────────────

  private buildKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  private async readFromCache<T>(cacheKey: string): Promise<T | null> {
    try {
      const raw = await this.kv.get(cacheKey, { type: 'text' }) as string | null;
      if (raw === null) return null;

      const entry: CacheEntry<T> = JSON.parse(raw);

      // Check TTL expiry (belt-and-suspenders with KV's own TTL)
      const age = (Date.now() - entry.cachedAt) / 1000;
      if (age > entry.ttl) {
        // Expired — delete and treat as miss
        await this.kv.delete(cacheKey).catch(() => {});
        if (this.config.verbose) {
          console.log(`[KVCache] EXPIRED ${cacheKey} (age ${age.toFixed(0)}s > ttl ${entry.ttl}s)`);
        }
        return null;
      }

      return entry.value;
    } catch (err) {
      // If deserialization fails, treat as miss
      if (this.config.verbose) {
        console.error(`[KVCache] Read error for ${cacheKey}:`, err);
      }
      return null;
    }
  }

  private async writeToCache<T>(cacheKey: string, value: T, ttl: number): Promise<void> {
    const entry: CacheEntry<T> = {
      value,
      cachedAt: Date.now(),
      ttl,
    };

    try {
      await this.kv.put(cacheKey, JSON.stringify(entry), {
        expirationTtl: ttl,
      });
      this.stats.sets++;
      if (this.config.verbose) {
        console.log(`[KVCache] SET ${cacheKey} (ttl=${ttl}s)`);
      }
    } catch (err) {
      console.error(`[KVCache] Write error for ${cacheKey}:`, err);
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}

// ============================================================================
// Typed Cache Helpers
// ============================================================================

/**
 * Create a typed cache for a specific entity type.
 * Provides key-scoped getOrFetch/invalidate/set methods.
 */
export function createTypedCache<T>(
  client: KVCacheClient,
  entityPrefix: string,
  ttl?: number,
) {
  const keyFor = (entityId: string) => `${entityPrefix}:${entityId}`;

  return {
    get: (entityId: string, loader: () => Promise<T | null>) =>
      client.getOrFetch(keyFor(entityId), loader, ttl),

    set: (entityId: string, value: T, customTtl?: number) =>
      client.set(keyFor(entityId), value, customTtl ?? ttl),

    invalidate: (entityId: string) =>
      client.invalidate(keyFor(entityId)),

    invalidateAll: () =>
      client.invalidateByPrefix(`${entityPrefix}:`),
  };
}
