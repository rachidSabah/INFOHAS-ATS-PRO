// ResumeAI Pro — Cache Integrity Test Suite
// Validates cache key structure, prevents offline/failed optimizations from
// being cached, and ensures cache integrity across sessions.
//
// Pure functions — safe for Edge Runtime and unit tests.

import type { CacheTestResult, QATestResult } from "./types";
import { REQUIRED_CACHE_KEY_COMPONENTS } from "./types";

/**
 * Validate that a cache key includes all required components.
 * The cache key MUST include: userId, resumeHash, jobHash, provider,
 * model, industryMode, directiveHash.
 */
export function validateCacheKeyStructure(
  cacheKey: string
): { valid: boolean; missingComponents: string[] } {
  const missing: string[] = [];
  const lowerKey = cacheKey.toLowerCase();

  // Check for each required component in the key
  // Keys should be composite strings that include these identifiers
  const componentChecks: Array<{ component: string; pattern: RegExp }> = [
    { component: "userId", pattern: /user[id_]?[:\-]/i },
    { component: "resumeHash", pattern: /resume[hash_]?[:\-]/i },
    { component: "jobHash", pattern: /job[hash_]?[:\-]/i },
    { component: "provider", pattern: /provider[:\-]/i },
    { component: "model", pattern: /model[:\-]/i },
    { component: "industryMode", pattern: /industry[mode_]?[:\-]/i },
    { component: "directiveHash", pattern: /directive[hash_]?[:\-]/i },
  ];

  for (const check of componentChecks) {
    if (!check.pattern.test(lowerKey)) {
      missing.push(check.component);
    }
  }

  return {
    valid: missing.length === 0,
    missingComponents: missing,
  };
}

/**
 * Validate that offline optimizations are never cached.
 * An optimization that used the offline fallback should never be stored
 * in the cache — it's not a valid AI response.
 */
export function assertOfflineNotCached(
  cachedItems: Array<{ key: string; provider: string; status: string }>
): CacheTestResult {
  const offlineCached = cachedItems.filter(
    (item) =>
      item.provider === "Local Engine (offline mode)" ||
      item.provider.toLowerCase().includes("offline") ||
      item.provider.toLowerCase().includes("local") ||
      item.status === "failed"
  );

  return {
    cacheName: "offline_filter",
    totalEntries: cachedItems.length,
    expiredEntries: 0,
    offlineOptimizationsCached: offlineCached.length > 0,
    failedOptimizationsCached: offlineCached.some((i) => i.status === "failed"),
    keyStructureValid: true,
    missingKeyComponents: [],
    passed: offlineCached.length === 0,
    message:
      offlineCached.length === 0
        ? "No offline or failed optimizations found in cache"
        : `${offlineCached.length} offline/failed entries found in cache — MUST be purged`,
  };
}

/**
 * Validate that failed optimizations are never cached.
 */
export function assertFailedNotCached(
  cachedItems: Array<{ key: string; status: string }>
): CacheTestResult {
  const failedCached = cachedItems.filter((item) => item.status === "failed");

  return {
    cacheName: "failed_filter",
    totalEntries: cachedItems.length,
    expiredEntries: 0,
    offlineOptimizationsCached: false,
    failedOptimizationsCached: failedCached.length > 0,
    keyStructureValid: true,
    missingKeyComponents: [],
    passed: failedCached.length === 0,
    message:
      failedCached.length === 0
        ? "No failed optimizations found in cache"
        : `${failedCached.length} failed entries found in cache — MUST be purged`,
  };
}

/**
 * Validate cache stats for integrity.
 */
export function validateCacheStats(
  stats: { jobAnalysis: number; companyResearch: number; atsReport: number },
  maxEntries: number = 50
): CacheTestResult[] {
  const results: CacheTestResult[] = [];

  for (const [name, count] of Object.entries(stats)) {
    results.push({
      cacheName: name,
      totalEntries: count,
      expiredEntries: 0,
      offlineOptimizationsCached: false,
      failedOptimizationsCached: false,
      keyStructureValid: true,
      missingKeyComponents: [],
      passed: count <= maxEntries,
      message:
        count <= maxEntries
          ? `${name} cache: ${count}/${maxEntries} entries`
          : `${name} cache OVERFLOW: ${count} entries (max ${maxEntries})`,
    });
  }

  return results;
}

/**
 * Generate QA test results from cache validation.
 */
export function cacheToQATests(
  cacheResults: CacheTestResult[],
  keyStructureResults: Array<{ key: string; valid: boolean; missing: string[] }>
): QATestResult[] {
  const tests: QATestResult[] = [];
  const timestamp = new Date().toISOString();

  // Test: No offline optimizations cached
  const offlineResult = cacheResults.find((r) => r.cacheName === "offline_filter");
  if (offlineResult) {
    tests.push({
      id: `cache_offline_${Date.now()}`,
      name: "Cache: No Offline Optimizations Cached",
      category: "cache",
      severity: "critical",
      passed: offlineResult.passed,
      message: offlineResult.message,
      durationMs: 0,
      timestamp,
      suggestion: offlineResult.passed
        ? undefined
        : "Purge cache immediately — offline optimizations must never be cached",
    });
  }

  // Test: No failed optimizations cached
  const failedResult = cacheResults.find((r) => r.cacheName === "failed_filter");
  if (failedResult) {
    tests.push({
      id: `cache_failed_${Date.now()}`,
      name: "Cache: No Failed Optimizations Cached",
      category: "cache",
      severity: "critical",
      passed: failedResult.passed,
      message: failedResult.message,
      durationMs: 0,
      timestamp,
    });
  }

  // Test: Cache key structure
  const allKeysValid = keyStructureResults.every((r) => r.valid);
  const invalidKeys = keyStructureResults.filter((r) => !r.valid);
  tests.push({
    id: `cache_keys_${Date.now()}`,
    name: "Cache: Key Structure Includes All Required Components",
    category: "cache",
    severity: "high",
    passed: allKeysValid,
    message: allKeysValid
      ? `All cache keys include required components: ${REQUIRED_CACHE_KEY_COMPONENTS.join(", ")}`
      : `${invalidKeys.length} cache keys missing components: ${invalidKeys
          .map((k) => `${k.missing.join(",")}`)
          .join("; ")}`,
    durationMs: 0,
    timestamp,
    suggestion: allKeysValid
      ? undefined
      : "Update cache key generation to include all required components",
  });

  // Test: Cache size within limits
  const overflowResults = cacheResults.filter((r) => !r.passed && r.cacheName !== "offline_filter" && r.cacheName !== "failed_filter");
  tests.push({
    id: `cache_size_${Date.now()}`,
    name: "Cache: Size Within Limits",
    category: "cache",
    severity: "medium",
    passed: overflowResults.length === 0,
    message:
      overflowResults.length === 0
        ? "All caches within size limits"
        : `Overflow in: ${overflowResults.map((r) => r.cacheName).join(", ")}`,
    durationMs: 0,
    timestamp,
  });

  return tests;
}
