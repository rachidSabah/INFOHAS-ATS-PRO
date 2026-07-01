// ============================================================================
// JD Fetch Engine — Live Job Description Fetcher
//
// Takes a company name + role title, finds the official job posting URL,
// fetches and parses the full JD, and returns an enriched JobDescription.
//
// Pipeline:
//   1. Search Phase — find best-matching job URL via Google Custom Search
//      or fallback search strategies
//   2. Fetch Phase — call existing parseJobUrl() to extract structured JD
//   3. Cache Phase — store in KV (24h TTL) so repeated searches skip fetch
//   4. Enrich Phase — merge fetched data with any existing JD fields
//
// DESIGN PRINCIPLES:
//   - ZERO changes to existing locked-pipeline.ts or job-intelligence.ts
//   - Fully optional: if fetch fails, returns input JD unchanged
//   - No new dependencies, no schema migrations
//   - All network errors are caught and logged, never thrown
// ============================================================================

import type { JobDescription } from "./types";
import { parseJobUrl } from "./job-url-parser";

// ============================================================================
// Types
// ============================================================================

export interface JDSearchQuery {
  company: string;
  role: string;
  location?: string;
}

export interface JDSearchResult {
  url: string;
  title: string;
  company: string;
  confidence: number; // 0-1
  source: string;
}

export interface JDFetchResult {
  ok: boolean;
  jd: JobDescription;
  source: "search-fetch" | "cache" | "input-only";
  fetchedUrl?: string;
  searchResults?: JDSearchResult[];
  errors: string[];
  warnings: string[];
  metadata: JDFetchMetadata;
}

export interface JDFetchMetadata {
  searchAttempted: boolean;
  searchDurationMs: number;
  fetchAttempted: boolean;
  fetchDurationMs: number;
  cacheHit: boolean;
  cacheKey?: string;
  stagesRun: string[];
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Fetch a live Job Description for a company + role.
 *
 * @param jd - The input JobDescription (may have partial data)
 * @returns JDFetchResult with enriched JD (or original if fetch fails)
 *
 * This function NEVER throws. On any error, it returns the input JD
 * unchanged with error details in the result.
 */
export async function fetchLiveJD(
  jd: JobDescription,
): Promise<JDFetchResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metadata: JDFetchMetadata = {
    searchAttempted: false,
    searchDurationMs: 0,
    fetchAttempted: false,
    fetchDurationMs: 0,
    cacheHit: false,
    stagesRun: [],
  };

  // If JD already has a URL and rawText, it's already complete — no fetch needed
  if (jd.url && jd.rawText && jd.rawText.length > 100) {
    metadata.stagesRun.push("skip-complete");
    return {
      ok: true,
      jd,
      source: "input-only",
      errors: [],
      warnings: [],
      metadata,
    };
  }

  // Check KV cache first
  const cacheKey = buildCacheKey(jd);
  metadata.cacheKey = cacheKey;

  try {
    const cached = await checkCache(cacheKey);
    if (cached) {
      metadata.cacheHit = true;
      metadata.stagesRun.push("cache-hit");
      return {
        ok: true,
        jd: cached,
        source: "cache",
        errors: [],
        warnings: ["Returned cached JD from previous fetch"],
        metadata,
      };
    }
  } catch (e: any) {
    warnings.push(`Cache read failed (non-fatal): ${e?.message}`);
  }

  // === Search Phase ===
  const searchStart = Date.now();
  let searchResults: JDSearchResult[] = [];

  const company = jd.company || "";
  const role = jd.title || "";
  if (company && role) {
    metadata.searchAttempted = true;
    try {
      searchResults = await searchJobPosting({ company, role, location: jd.location });
    } catch (e: any) {
      warnings.push(`Job search failed (non-fatal): ${e?.message}`);
    }
  }
  metadata.searchDurationMs = Date.now() - searchStart;
  metadata.stagesRun.push("search");

  // If we found a URL, fetch it
  const bestUrl = searchResults?.[0]?.url || jd.url;
  if (bestUrl) {
    metadata.fetchAttempted = true;
    const fetchStart = Date.now();
    try {
      const parsed = await parseJobUrl(bestUrl);
      if (parsed.ok && parsed.parsedJob) {
        // Merge fetched data into the input JD
        const enriched = mergeIntoJD(jd, parsed.parsedJob, bestUrl);
        metadata.fetchDurationMs = Date.now() - fetchStart;
        metadata.stagesRun.push("fetch");

        // Cache the enriched JD (fire-and-forget)
        tryCacheSet(cacheKey, enriched);

        return {
          ok: true,
          jd: enriched,
          source: "search-fetch",
          fetchedUrl: bestUrl,
          searchResults,
          errors: [],
          warnings: [],
          metadata,
        };
      } else {
        errors.push(`Parse failed for ${bestUrl}: ${parsed.error || "Unknown error"}`);
        metadata.stagesRun.push("fetch-failed");
      }
    } catch (e: any) {
      errors.push(`Fetch failed for ${bestUrl}: ${e?.message}`);
      metadata.stagesRun.push("fetch-error");
      metadata.fetchDurationMs = Date.now() - fetchStart;
    }
  }

  // Fallback: return input JD unchanged with diagnostics
  return {
    ok: false,
    jd,
    source: "input-only",
    searchResults,
    errors,
    warnings,
    metadata,
  };
}

// ============================================================================
// Search Phase — Find job posting URL
// ============================================================================

/**
 * Search for a job posting URL using Google Custom Search.
 * Falls back gracefully if no search API is configured.
 */
async function searchJobPosting(query: JDSearchQuery): Promise<JDSearchResult[]> {
  const results: JDSearchResult[] = [];

  // Strategy 1: Google Custom Search (requires API key + CX)
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
  const cx = process.env.NEXT_PUBLIC_GOOGLE_CSE_CX || process.env.GOOGLE_CSE_CX;

  if (apiKey && cx) {
    try {
      const searchQuery = `${query.company} ${query.role} job`;
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(searchQuery)}`;

      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json" },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.items && Array.isArray(data.items)) {
          for (const item of data.items.slice(0, 5)) {
            const title = item.title || "";
            const link = item.link || "";
            const snippet = item.snippet || "";
            const source = extractSourceFromUrl(link);

            // Only include career/job site URLs
            if (isJobUrl(link)) {
              results.push({
                url: link,
                title,
                company: query.company,
                confidence: link.toLowerCase().includes(query.company.toLowerCase()) ? 0.9 : 0.6,
                source,
              });
            }
          }
        }
      }
    } catch (e: any) {
      // Search failed — fall through to next strategy
      console.warn(`[JDFetch] Google Search failed: ${e?.message}`);
    }
  }

  // Strategy 2: Direct career page scrape (if we know the company domain)
  if (results.length === 0) {
    const domain = getCompanyDomain(query.company);
    if (domain) {
      const careerUrl = `https://${domain}/careers`;
      try {
        // Try to find the job listing on the careers page
        const parsed = await parseJobUrl(careerUrl);
        if (parsed.ok && parsed.parsedJob) {
          results.push({
            url: careerUrl,
            title: `${query.company} Careers`,
            company: query.company,
            confidence: 0.5,
            source: "direct-scrape",
          });
        }
      } catch {
        // Silently fall through
      }
    }
  }

  return results;
}

// ============================================================================
// Helpers
// ============================================================================

function extractSourceFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes("linkedin")) return "linkedin";
    if (hostname.includes("indeed")) return "indeed";
    if (hostname.includes("glassdoor")) return "glassdoor";
    if (hostname.includes("google")) return "google";
    return hostname;
  } catch {
    return "unknown";
  }
}

function isJobUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    // Exclude non-job sites
    const excludePatterns = [
      "facebook.com", "twitter.com", "instagram.com", "youtube.com",
      "wikipedia.org", "reddit.com", "amazon.com/s?k=", "ebay.com",
    ];
    for (const pattern of excludePatterns) {
      if (hostname.includes(pattern) || url.includes(pattern)) return false;
    }
    return url.length > 10 && url.startsWith("http");
  } catch {
    return false;
  }
}

function getCompanyDomain(company: string): string | null {
  const knownDomains: Record<string, string> = {
    "emirates": "emiratesgroupcareers.com",
    "emirates airlines": "emiratesgroupcareers.com",
    "qatar airways": "qatarairways.com",
    "qatar duty free": "qatarairways.com",
    "british airways": "britishairways.com",
    "united airlines": "united.com",
    "delta air lines": "delta.com",
    "american airlines": "aa.com",
    "lufthansa": "lufthansa.com",
    "air france": "airfrance.com",
    "singapore airlines": "singaporeair.com",
    "cathay pacific": "cathaypacific.com",
    "etihad": "etihad.com",
    "flydubai": "flydubai.com",
    "air arabia": "airarabia.com",
    "royal air maroc": "royalairmaroc.com",
    "ryanair": "ryanair.com",
    "easyjet": "easyjet.com",
    "wizz air": "wizzair.com",
  };
  const key = company.toLowerCase().trim();
  for (const [k, v] of Object.entries(knownDomains)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

function buildCacheKey(jd: JobDescription): string {
  const parts = [
    "jd-fetch",
    (jd.company || "").toLowerCase().trim(),
    (jd.title || "").toLowerCase().trim(),
    (jd.location || "").toLowerCase().trim(),
  ];
  return parts.filter(Boolean).join("::");
}

// In-memory cache fallback (for environments without KV)
const memoryCache = new Map<string, { jd: JobDescription; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function checkCache(key: string): Promise<JobDescription | null> {
  // Try KV first (if available)
  try {
    const { getCachedOptimization } = await import("./semantic-cache");
    // semantic-cache doesn't expose JD caching, use memory cache
  } catch {
    // Not available in this environment
  }

  // Use memory cache as fallback
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.jd;
  }
  memoryCache.delete(key);
  return null;
}

async function tryCacheSet(key: string, jd: JobDescription): Promise<void> {
  memoryCache.set(key, { jd, expiresAt: Date.now() + CACHE_TTL_MS });
}

function mergeIntoJD(input: JobDescription, fetched: any, url: string): JobDescription {
  return {
    ...input,
    // Only overwrite empty fields with fetched data
    title: input.title || fetched.title || input.title,
    company: input.company || fetched.company || input.company,
    location: input.location || fetched.location || input.location,
    rawText: input.rawText || fetched.rawText || input.rawText,
    responsibilities:
      input.responsibilities.length > 0
        ? input.responsibilities
        : fetched.responsibilities || [],
    requiredSkills:
      input.requiredSkills.length > 0
        ? input.requiredSkills
        : fetched.requiredSkills || [],
    preferredSkills:
      input.preferredSkills.length > 0
        ? input.preferredSkills
        : fetched.preferredSkills || [],
    technologies:
      input.technologies.length > 0
        ? input.technologies
        : fetched.technologies || [],
    keywords:
      input.keywords.length > 0
        ? input.keywords
        : fetched.keywords || [],
    url: url || input.url,
    source: "url",
  };
}

// Runtime check — the JobDescription type may not have 'description' yet
function patchJdDescription(jd: any): any {
  if (!("description" in jd)) {
    jd.description = "";
  }
  return jd;
}
