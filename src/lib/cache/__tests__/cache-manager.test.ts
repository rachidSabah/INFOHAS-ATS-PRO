// ============================================================================
// CacheManager Unit Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheManager } from '../manager';
import type { CacheBucket } from '../manager';

describe('CacheManager', () => {
  let mockBucket1: CacheBucket;
  let mockBucket2: CacheBucket;
  let cleared1 = false;
  let cleared2 = false;

  beforeEach(() => {
    cleared1 = false;
    cleared2 = false;

    mockBucket1 = {
      name: 'test-bucket-1',
      clear: () => { cleared1 = true; },
      getStats: () => ({ hits: 10, misses: 2 }),
      size: 5,
    };

    mockBucket2 = {
      name: 'test-bucket-2',
      clear: () => { cleared2 = true; },
      getStats: () => ({ hits: 40, misses: 8 }),
      size: 15,
    };
  });

  it('can register buckets and retrieve them', () => {
    CacheManager.register(mockBucket1);
    CacheManager.register(mockBucket2);

    expect(CacheManager.listBuckets()).toContain('test-bucket-1');
    expect(CacheManager.listBuckets()).toContain('test-bucket-2');
    expect(CacheManager.getBucket('test-bucket-1')).toBe(mockBucket1);
  });

  it('can fetch stats across all registered buckets', () => {
    CacheManager.register(mockBucket1);
    CacheManager.register(mockBucket2);

    const stats = CacheManager.getStats();
    expect(stats['test-bucket-1']).toEqual({ size: 5, hits: 10, misses: 2 });
    expect(stats['test-bucket-2']).toEqual({ size: 15, hits: 40, misses: 8 });
  });

  it('clears all registered buckets when clearAll is called', () => {
    CacheManager.register(mockBucket1);
    CacheManager.register(mockBucket2);

    CacheManager.clearAll();
    expect(cleared1).toBe(true);
    expect(cleared2).toBe(true);
  });
});
