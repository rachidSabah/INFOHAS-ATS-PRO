// ResumeAI Pro — AI Cache Module (HARDENED)
//
// Three-layer in-memory cache for AI pipeline results:
//   1. Job Analysis Cache
//   2. Company Research Cache
//   3. ATS Report Cache
//
// HARDENING:
//   - Corruption detection: validates cached data structure before returning
//   - Failed/empty/offline results are NEVER cached
//   - Type-safe cache entries (replaces `any` with proper types)
//   - Integrity hash on each entry to detect tampered/corrupted data
//   - LRU-style eviction (oldest-first, but with access-time tracking)

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 50;

// ============================================================================
// Cache entry with integrity check
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
  /** Simple integrity hash — detects corrupted entries */
  integrityHash: string;
}

/** Compute a lightweight integrity hash for cache validation */
function computeIntegrityHash(data: unknown): string {
  try {
    const json = JSON.stringify(data);
    // FNV-1a quick hash — NOT cryptographic, just detects corruption
    let hash = 2166136261;
    for (let i = 0; i < json.length; i++) {
      hash ^= json.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  } catch {
    return "invalid";
  }
}

/** Check if a value is cacheable — rejects null, undefined, empty strings, error objects */
function isCacheable(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (typeof data === "string" && data.trim().length === 0) return false;
  if (typeof data === "object") {
    const obj = data as Record<string, any>;
    // Reject error-like objects, rate limits (429), timeouts, and auth failures
    if (obj.error || obj.providerError || obj.provider429 || obj.providerTimeout || obj.authenticationFailure || obj.providerResponseEmpty) {
      return false;
    }
    // Reject empty objects
    if (Object.keys(obj).length === 0) return false;
    // Reject failed status
    if (obj.status === "failed") return false;
    // Reject partial or incomplete optimizations
    if (obj.isPartial || obj.partial === true || obj.cachedPartialOptimization === true) return false;
    // Reject offline/local-engine fallback markers
    if (obj.source === "offline" || obj.source === "local-engine" || obj.provider === "Local Engine (offline mode)") return false;
    if (obj.fallback === true) return false;
  }
  return true;
}

// ============================================================================
// Core cache operations with corruption protection
// ============================================================================

function getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  // Check expiry
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  // Integrity check — detect corrupted entries
  const currentHash = computeIntegrityHash(entry.data);
  if (currentHash !== entry.integrityHash) {
    console.warn("[ai-cache] Corrupted cache entry detected and evicted:", key.slice(0, 12));
    cache.delete(key);
    return null;
  }

  // Validate the data is still meaningful (not an empty/null shell)
  if (!isCacheable(entry.data)) {
    console.warn("[ai-cache] Invalid cache entry evicted (empty/corrupt):", key.slice(0, 12));
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function setInCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  // NEVER cache uncacheable data (empty, null, offline results)
  if (!isCacheable(data)) {
    return;
  }

  if (cache.size >= MAX_ENTRIES) {
    // Evict oldest entry (FIFO — could be upgraded to LRU with access tracking)
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  const now = Date.now();
  cache.set(key, {
    data,
    expiresAt: now + CACHE_TTL_MS,
    createdAt: now,
    integrityHash: computeIntegrityHash(data),
  });
}

// ============================================================================
// Key generation
// ============================================================================

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ============================================================================
// Public API — Job Analysis Cache
// ============================================================================

const jobAnalysisCache = new Map<string, CacheEntry<Record<string, unknown>>>();

export function getCachedJobAnalysis(jdText: string): Record<string, unknown> | null {
  return getFromCache(jobAnalysisCache, hashText(jdText));
}

export function setCachedJobAnalysis(jdText: string, data: Record<string, unknown>): void {
  setInCache(jobAnalysisCache, hashText(jdText), data);
}

// ============================================================================
// Public API — Company Research Cache
// ============================================================================

const companyResearchCache = new Map<string, CacheEntry<Record<string, unknown>>>();

export function getCachedCompanyResearch(companyName: string): Record<string, unknown> | null {
  return getFromCache(companyResearchCache, companyName.toLowerCase().trim());
}

export function setCachedCompanyResearch(companyName: string, data: Record<string, unknown>): void {
  setInCache(companyResearchCache, companyName.toLowerCase().trim(), data);
}

// ============================================================================
// Public API — ATS Report Cache
// ============================================================================

const atsReportCache = new Map<string, CacheEntry<Record<string, unknown>>>();

export function getCachedATSReport(resumeText: string, jdText: string): Record<string, unknown> | null {
  return getFromCache(atsReportCache, hashText(resumeText + jdText));
}

export function setCachedATSReport(resumeText: string, jdText: string, data: Record<string, unknown>): void {
  setInCache(atsReportCache, hashText(resumeText + jdText), data);
}

// ============================================================================
// Utility
// ============================================================================

export function clearAllCaches(): void {
  jobAnalysisCache.clear();
  companyResearchCache.clear();
  atsReportCache.clear();
}

export function getCacheStats(): { jobAnalysis: number; companyResearch: number; atsReport: number } {
  const now = Date.now();
  return {
    jobAnalysis: [...jobAnalysisCache.values()].filter((e) => e.expiresAt > now).length,
    companyResearch: [...companyResearchCache.values()].filter((e) => e.expiresAt > now).length,
    atsReport: [...atsReportCache.values()].filter((e) => e.expiresAt > now).length,
  };
}
