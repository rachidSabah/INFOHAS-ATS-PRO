const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 50;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const jobAnalysisCache = new Map<string, CacheEntry<any>>();
const companyResearchCache = new Map<string, CacheEntry<any>>();
const atsReportCache = new Map<string, CacheEntry<any>>();

function getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getCachedJobAnalysis(jdText: string): any | null {
  return getFromCache(jobAnalysisCache, hashText(jdText));
}

export function setCachedJobAnalysis(jdText: string, data: any): void {
  setInCache(jobAnalysisCache, hashText(jdText), data);
}

export function getCachedCompanyResearch(companyName: string): any | null {
  return getFromCache(companyResearchCache, companyName.toLowerCase().trim());
}

export function setCachedCompanyResearch(companyName: string, data: any): void {
  setInCache(companyResearchCache, companyName.toLowerCase().trim(), data);
}

export function getCachedATSReport(resumeText: string, jdText: string): any | null {
  return getFromCache(atsReportCache, hashText(resumeText + jdText));
}

export function setCachedATSReport(resumeText: string, jdText: string, data: any): void {
  setInCache(atsReportCache, hashText(resumeText + jdText), data);
}

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
