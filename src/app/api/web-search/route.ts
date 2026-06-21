// Web Search API — performs live web research for company interview questions.
// Edge Runtime compatible for Cloudflare Pages.
//
// Uses z-ai-web-dev-sdk (server-side only) to search for:
//   - "<Company> interview questions"
//   - "<Company> interview process"
//   - "<Job Title> interview questions"
//   - "<Industry> interview questions"
//
// Returns aggregated search results that the Interview Prep Suite uses as
// reference material for generating tailored interview questions.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// In-memory cache (5-minute TTL — same as JD scraper)
interface CacheEntry {
  data: any;
  expiresAt: number;
}
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company, jobTitle, industry } = body;

    if (!company && !jobTitle) {
      return NextResponse.json({ error: "company or jobTitle is required" }, { status: 400 });
    }

    // === INPUT SANITIZATION ===
    // Trim, cap length, and strip control characters from each input so a
    // malicious or accidental long string can't slow/break the Z.ai call.
    const sanitize = (v: any): string => {
      if (typeof v !== "string") return "";
      return v
        .replace(/[\x00-\x1F\x7F]/g, "") // control chars
        .trim()
        .slice(0, 200);
    };
    const safeCompany = sanitize(company);
    const safeJobTitle = sanitize(jobTitle);
    const safeIndustry = sanitize(industry);

    // Build search queries — parallel for speed
    const queries: string[] = [];
    if (safeCompany) {
      queries.push(`${safeCompany} interview questions`);
      queries.push(`${safeCompany} interview process`);
      if (safeJobTitle) queries.push(`${safeCompany} ${safeJobTitle} interview`);
      queries.push(`${safeCompany} Glassdoor interview`);
      queries.push(`${safeCompany} values engineering culture`);
    }
    if (safeJobTitle && !safeCompany) {
      queries.push(`${safeJobTitle} interview questions`);
    }
    if (safeIndustry) {
      queries.push(`${safeIndustry} interview questions`);
    }

    // Limit to 5 queries to avoid excessive API calls
    const limitedQueries = queries.slice(0, 5);

    // Check cache
    const cacheKey = limitedQueries.join("|");
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json({ ...cached.data, cached: true });
    }

    // Perform web searches using z-ai CLI (Edge Runtime compatible via fetch)
    // We use the z-ai API directly since the SDK requires Node.js
    const allResults: Array<{
      query: string;
      title: string;
      url: string;
      snippet: string;
      source: string;
    }> = [];

    // === PARALLEL SEARCH ===
    // Run all queries in parallel via Promise.all to avoid the sequential
    // 5×10s=50s worst-case. Each query is wrapped in its own try/catch so
    // one failure doesn't discard the others.
    const zaiApiKey = process.env.ZAI_API_KEY || process.env.NEXT_PUBLIC_ZAI_API_KEY;
    if (zaiApiKey) {
      const searchOne = async (query: string) => {
        try {
          const searchResponse = await fetch("https://api.z.ai/api/paas/v4/functions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${zaiApiKey}`,
            },
            body: JSON.stringify({
              name: "web_search",
              arguments: { query, num: 5 },
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!searchResponse.ok) return [];
          const searchData = await searchResponse.json();
          const results = Array.isArray(searchData) ? searchData : (searchData?.output ?? []);
          return results.slice(0, 5).map((r: any) => {
            // Defensive: r.url may be missing or relative — wrap separately so
            // one bad result doesn't discard the entire query's results.
            let source = "unknown";
            try {
              if (r.url) source = new URL(r.url).hostname;
              else if (r.host_name) source = r.host_name;
            } catch {
              source = r.host_name || "unknown";
            }
            return {
              query,
              title: r.name || r.title || "",
              url: r.url || "",
              snippet: r.snippet || "",
              source,
            };
          });
        } catch {
          return [];
        }
      };
      const parallelResults = await Promise.all(limitedQueries.map(searchOne));
      for (const batch of parallelResults) {
        allResults.push(...batch);
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const deduped = allResults.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    const responseData = {
      results: deduped.slice(0, 25),
      queries: limitedQueries,
      totalFound: deduped.length,
    };

    // Cache for 5 minutes
    if (searchCache.size > 20) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey) searchCache.delete(oldestKey);
    }
    searchCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json(responseData);
  } catch (e: any) {
    // Graceful failure — never block interview prep
    return NextResponse.json(
      { results: [], queries: [], totalFound: 0, error: "Web search unavailable — proceeding with AI-only generation." },
      { status: 200 }
    );
  }
}
