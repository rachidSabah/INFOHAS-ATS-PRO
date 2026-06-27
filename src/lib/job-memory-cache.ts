// ============================================================================
// Job Memory Cache — avoid re-extracting JD intelligence for the same job
//
// Before optimization, JD intelligence (keywords, competencies, phrases, verbs,
// company priorities) are extracted via analyzeJobIntelligence(). For batch
// optimization of multiple resumes against the same JD, this cache avoids
// redundant extraction — saving LLM calls and reducing latency by 5-10x.
//
// Cache key: `${jd.title}:${jd.company}` (normalized lowercase)
// Cache lifetime: session only (cleared on page close/refresh)
// ============================================================================

import type { JobIntelligence } from "./job-intelligence";

interface CacheEntry {
  intelligence: JobIntelligence;
  cachedAt: string;
  hitCount: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Build a cache key from a JD title and company.
 */
export function buildJobCacheKey(title: string, company: string): string {
  return `${title.trim().toLowerCase()}:${company.trim().toLowerCase()}`;
}

/**
 * Try to get cached JD intelligence. Returns null if not found.
 */
export function getCachedJobIntelligence(title: string, company: string): JobIntelligence | null {
  const key = buildJobCacheKey(title, company);
  const entry = cache.get(key);
  if (entry) {
    entry.hitCount++;
    console.info(`[JobMemoryCache] HIT (${entry.hitCount}x): ${key}`);
    return entry.intelligence;
  }
  console.info(`[JobMemoryCache] MISS: ${key}`);
  return null;
}

/**
 * Store JD intelligence in the cache.
 */
export function setCachedJobIntelligence(
  title: string,
  company: string,
  intelligence: JobIntelligence,
): void {
  const key = buildJobCacheKey(title, company);
  cache.set(key, {
    intelligence,
    cachedAt: new Date().toISOString(),
    hitCount: 0,
  });
  console.info(`[JobMemoryCache] STORED: ${key}`);
}

/**
 * Get cache statistics.
 */
export function getJobCacheStats(): { size: number; keys: string[]; totalHits: number } {
  let totalHits = 0;
  cache.forEach((entry) => { totalHits += entry.hitCount; });
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
    totalHits,
  };
}

/**
 * Clear the entire cache (e.g., on session reset).
 */
export function clearJobCache(): void {
  cache.clear();
}

/**
 * Invalidate a specific job entry.
 */
export function invalidateJobCache(title: string, company: string): void {
  const key = buildJobCacheKey(title, company);
  cache.delete(key);
}
