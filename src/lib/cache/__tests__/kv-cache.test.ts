// ============================================================================
// Phase 9 — Cache Layer Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KVCacheClient, CacheInvalidationService, createDefaultInvalidationRules } from '../index';

// ── Mock KV Namespace ──────────────────────────────────────────────────

function createMockKV(): any {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async (opts?: { prefix?: string; cursor?: string }) => {
      const prefix = opts?.prefix ?? '';
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    }),
    getWithMetadata: vi.fn(),
  };
}

// ============================================================================
// KVCacheClient Tests
// ============================================================================

describe('KVCacheClient', () => {
  let kv: any;
  let cache: KVCacheClient;

  beforeEach(() => {
    kv = createMockKV();
    cache = new KVCacheClient(kv, { keyPrefix: 'test:', verbose: false });
  });

  it('loads from source on cache miss and caches the result', async () => {
    const loader = vi.fn().mockResolvedValue('loaded-value');
    const result = await cache.getOrFetch('test-key', loader);
    expect(result).toBe('loaded-value');
    expect(loader).toHaveBeenCalledTimes(1);
    // Subsequent call should hit cache
    const result2 = await cache.getOrFetch('test-key', loader);
    expect(result2).toBe('loaded-value');
    expect(loader).toHaveBeenCalledTimes(1); // loader not called again
  });

  it('returns null when loader returns null (miss but no source)', async () => {
    const loader = vi.fn().mockResolvedValue(null);
    const result = await cache.getOrFetch('missing-key', loader);
    expect(result).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('invalidates a key', async () => {
    const loader = vi.fn().mockResolvedValue('fresh-data');
    await cache.getOrFetch('invalidate-me', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    await cache.invalidate('invalidate-me');
    // Should reload from source
    await cache.getOrFetch('invalidate-me', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('bulk invalidates by prefix', async () => {
    await cache.getOrFetch('resume:abc', vi.fn().mockResolvedValue('v1'));
    await cache.getOrFetch('resume:def', vi.fn().mockResolvedValue('v2'));
    const count = await cache.invalidateByPrefix('resume:');
    expect(count).toBe(2);
  });

  it('tracks stats correctly', async () => {
    await cache.getOrFetch('stat-key', vi.fn().mockResolvedValue('value'));
    await cache.getOrFetch('stat-key', vi.fn().mockResolvedValue('value'));
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.sets).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  it('resetStats clears counters', () => {
    cache.resetStats();
    const stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(0);
  });
});

// ============================================================================
// CacheInvalidationService Tests
// ============================================================================

describe('CacheInvalidationService', () => {
  let kv: any;
  let cache: KVCacheClient;
  let invalidation: CacheInvalidationService;

  beforeEach(() => {
    kv = createMockKV();
    cache = new KVCacheClient(kv, { keyPrefix: 'test:', verbose: false });
    invalidation = new CacheInvalidationService(cache, createDefaultInvalidationRules());
  });

  it('invalidates a specific key', async () => {
    await cache.set('direct-test', 'value');
    expect(await cache.exists('direct-test')).toBe(true);
    await invalidation.invalidateKey('direct-test', 'test reason');
    expect(await cache.exists('direct-test')).toBe(false);
  });

  it('invalidates by prefix', async () => {
    await cache.set('resume:abc', 'v1');
    await cache.set('resume:def', 'v2');
    await invalidation.invalidatePrefix('resume:', 'bulk test');
    expect(await cache.exists('resume:abc')).toBe(false);
    expect(await cache.exists('resume:def')).toBe(false);
  });

  it('logs invalidation events', async () => {
    await invalidation.invalidateKey('log-test', 'test reason', 'test-source');
    const events = invalidation.getRecentInvalidations();
    expect(events).toHaveLength(1);
    expect(events[0].strategy).toBe('direct');
    expect(events[0].reason).toBe('test reason');
    expect(events[0].source).toBe('test-source');
  });

  it('onTableChange invalidates mapped prefixes', async () => {
    await cache.set('resume:abc', 'v1');
    await cache.set('optimization:abc', 'v2');
    await cache.set('unrelated:abc', 'v3');

    await invalidation.onTableChange('resumes', 'abc');

    expect(await cache.exists('resume:abc')).toBe(false);
    expect(await cache.exists('optimization:abc')).toBe(false);
    expect(await cache.exists('unrelated:abc')).toBe(true); // not in mapping
  });

  it('returns configured rules', () => {
    const rules = invalidation.getRules();
    expect(rules.tableToCachePrefix.resumes).toContain('resume:');
    expect(rules.tableToCachePrefix.optimizations).toContain('optimization:');
  });
});
