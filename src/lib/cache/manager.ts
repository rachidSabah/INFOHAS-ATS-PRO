// ============================================================================
// CacheManager — Unified Cache Facade
// ============================================================================
// A single central registry for all caches in the application (in-memory maps,
// localStorage, KV cache clients). Enables global statistics monitoring and
// bulk invalidation/clear operations.
// ============================================================================

"use client";

export interface CacheBucket {
  name: string;
  clear(): void;
  getStats(): Record<string, any>;
  size: number;
}

export class CacheManager {
  private static buckets = new Map<string, CacheBucket>();

  /**
   * Register a cache bucket under a unique name.
   */
  static register(bucket: CacheBucket): void {
    this.buckets.set(bucket.name, bucket);
    console.info(`[CacheManager] Registered cache bucket: ${bucket.name}`);
  }

  /**
   * Get a registered cache bucket.
   */
  static getBucket(name: string): CacheBucket | undefined {
    return this.buckets.get(name);
  }

  /**
   * List all registered cache bucket names.
   */
  static listBuckets(): string[] {
    return Array.from(this.buckets.keys());
  }

  /**
   * Invalidate/clear all registered cache buckets.
   */
  static clearAll(): void {
    console.info("[CacheManager] Clearing all registered cache buckets...");
    for (const bucket of this.buckets.values()) {
      try {
        bucket.clear();
      } catch (err) {
        console.warn(`[CacheManager] Failed to clear bucket "${bucket.name}":`, err);
      }
    }
  }

  /**
   * Get statistics across all registered cache buckets.
   */
  static getStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name, bucket] of this.buckets.entries()) {
      try {
        stats[name] = {
          size: bucket.size,
          ...bucket.getStats(),
        };
      } catch (err) {
        stats[name] = { error: String(err) };
      }
    }
    return stats;
  }
}
