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

    // Build search queries — parallel for speed
    const queries: string[] = [];
    if (company) {
      queries.push(`${company} interview questions`);
      queries.push(`${company} interview process`);
      if (jobTitle) queries.push(`${company} ${jobTitle} interview`);
      queries.push(`${company} Glassdoor interview`);
      queries.push(`${company} values engineering culture`);
    }
    if (jobTitle && !company) {
      queries.push(`${jobTitle} interview questions`);
    }
    if (industry) {
      queries.push(`${industry} interview questions`);
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

    for (const query of limitedQueries) {
      try {
        // Use z-ai CLI via child_process is not available in Edge Runtime.
        // Instead, we use the Z.ai REST API directly.
        const zaiApiKey = process.env.ZAI_API_KEY || process.env.NEXT_PUBLIC_ZAI_API_KEY;
        if (!zaiApiKey) {
          // Skip web search if no API key — fall back to AI-only generation
          continue;
        }

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

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          const results = Array.isArray(searchData) ? searchData : (searchData?.output ?? []);
          for (const r of results.slice(0, 5)) {
            allResults.push({
              query,
              title: r.name || r.title || "",
              url: r.url || "",
              snippet: r.snippet || "",
              source: r.host_name || new URL(r.url || "https://unknown.com").hostname,
            });
          }
        }
      } catch {
        // Silently skip failed searches — don't block the interview prep
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
