// ============================================================================
// Cache Invalidation Service
// ============================================================================
// Explicit invalidation is REQUIRED because KV is eventually consistent.
// We never use "write-through and trust it's fresh" — every upstream mutation
// MUST call invalidate() on the affected keys.
//
// Invalidation strategies:
//   1. Direct: invalidate a specific key (after single-entity update)
//   2. Prefix: invalidate all keys matching a prefix (after bulk update)
//   3. Stale-while-revalidate: return stale data but trigger async refresh
//   4. Webhook: external invalidation endpoint (for admin panel)
// ============================================================================

import type { KVCacheClient } from './kv-cache';

// ============================================================================
// Types
// ============================================================================

export type InvalidationStrategy = 'direct' | 'prefix' | 'swr' | 'webhook';

export interface InvalidationEvent {
  strategy: InvalidationStrategy;
  key: string;
  prefix?: string;
  reason: string;
  timestamp: number;
  source: string;
}

export interface InvalidationRule {
  /** When a D1 table changes, which cache prefixes should be invalidated */
  tableToCachePrefix: Record<string, string[]>;
  /** Direct key mapping (entityId -> cacheKey) */
  entityToCacheKey: (entityType: string, entityId: string) => string[];
}

// ============================================================================
// CacheInvalidationService
// ============================================================================

export class CacheInvalidationService {
  private cache: KVCacheClient;
  private rules: InvalidationRule;
  private invalidationLog: InvalidationEvent[] = [];
  private maxLogSize = 100;

  constructor(cache: KVCacheClient, rules: InvalidationRule) {
    this.cache = cache;
    this.rules = rules;
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Invalidate a specific cache key.
   * Use when a single entity was updated (e.g., a resume was edited).
   */
  async invalidateKey(key: string, reason: string, source = 'unknown'): Promise<void> {
    await this.cache.invalidate(key);
    this.log({ strategy: 'direct', key, reason, timestamp: Date.now(), source });
  }

  /**
   * Invalidate all keys sharing a prefix.
   * Use when a batch of related entities was updated.
   */
  async invalidatePrefix(prefix: string, reason: string, source = 'unknown'): Promise<void> {
    const count = await this.cache.invalidateByPrefix(prefix);
    this.log({ strategy: 'prefix', key: prefix, prefix, reason, timestamp: Date.now(), source });
  }

  /**
   * Invalidate all cache entries related to a D1 table change.
   * Uses the rule set to map table -> cache prefixes.
   */
  async onTableChange(table: string, entityId?: string, source = 'unknown'): Promise<void> {
    const prefixes = this.rules.tableToCachePrefix[table];
    if (!prefixes || prefixes.length === 0) return;

    for (const prefix of prefixes) {
      if (entityId) {
        // Direct invalidation for known entity
        const cacheKeys = this.rules.entityToCacheKey(table, entityId);
        for (const key of cacheKeys) {
          await this.invalidateKey(key, `Table ${table} changed for ${entityId}`, source);
        }
      } else {
        // Prefix invalidation for unknown scope
        await this.invalidatePrefix(prefix, `Table ${table} changed (no entity id)`, source);
      }
    }
  }

  /**
   * Invalidate ALL caches by flushing every key with the configured prefix.
   * WARNING: expensive — use sparingly.
   */
  async invalidateAll(source = 'unknown'): Promise<number> {
    const count = await this.cache.invalidateByPrefix('');
    this.log({ strategy: 'prefix', key: '*', reason: 'Full cache flush', timestamp: Date.now(), source });
    return count;
  }

  // ── Query ───────────────────────────────────────────────────────────

  /**
   * Get recent invalidation events (for debugging).
   */
  getRecentInvalidations(limit = 20): InvalidationEvent[] {
    return this.invalidationLog.slice(-limit).reverse();
  }

  /**
   * Get the configured invalidation rules.
   */
  getRules(): InvalidationRule {
    return this.rules;
  }

  // ── Private ─────────────────────────────────────────────────────────

  private log(event: InvalidationEvent): void {
    this.invalidationLog.push(event);
    if (this.invalidationLog.length > this.maxLogSize) {
      this.invalidationLog = this.invalidationLog.slice(-this.maxLogSize);
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create default invalidation rules for ResumeAI Pro's entity types.
 */
export function createDefaultInvalidationRules(): InvalidationRule {
  return {
    tableToCachePrefix: {
      resumes: ['resume:', 'optimization:', 'export:'],
      resume_blueprint: ['blueprint:', 'resume:'],
      optimizations: ['optimization:', 'export:'],
      providers: ['provider:'],
      provider_models: ['provider:'],
      sessions: ['session:'],
      users: ['user:', 'auth:'],
      directives: ['directive:'],
    },
    entityToCacheKey: (entityType: string, entityId: string): string[] => {
      const mapping: Record<string, (id: string) => string[]> = {
        resumes: (id) => [`resume:${id}`, `optimization:${id}`, `export:${id}`],
        resume_blueprint: (id) => [`blueprint:${id}`, `resume:${id}`],
        optimizations: (id) => [`optimization:${id}`],
        providers: (id) => [`provider:${id}`],
      };
      return mapping[entityType]?.(entityId) ?? [`${entityType}:${entityId}`];
    },
  };
}
