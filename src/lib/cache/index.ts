// ============================================================================
// Cache Module — Barrel Exports
// ============================================================================

export { KVCacheClient, createTypedCache } from './kv-cache';
export type { CacheEntry, CacheConfig, CacheStats } from './kv-cache';

export { RequestDeduplicator } from './request-dedup';
export type { DedupeOptions, DedupeStats } from './request-dedup';

export { CacheInvalidationService, createDefaultInvalidationRules } from './cache-invalidation';
export type { InvalidationEvent, InvalidationStrategy, InvalidationRule } from './cache-invalidation';

export type {
  KVNamespace, D1Database, D1PreparedStatement, D1Result,
  R2Bucket, R2Object, R2ObjectBody, R2PutOptions, R2GetOptions,
  Queue, DurableObjectNamespace, DurableObjectStub,
  CloudflareBindings,
} from './cloudflare-types';
