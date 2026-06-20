// Server-side job-description scraper — Edge Runtime compatible for Cloudflare Pages
// Features:
//   - Retry mechanism (2 retries with exponential backoff for transient failures)
//   - In-memory cache (5-minute TTL — avoids re-fetching the same URL on rapid retries)
//   - Graceful failure handling (never blocks optimization — returns clear error messages)
//   - JSON-LD / OpenGraph / meta description fallbacks for JS-rendered pages
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// === In-memory cache (per-worker, 5-minute TTL) ===
// Note: Edge workers are stateless across requests, but this cache helps when
// the same worker handles rapid retries (e.g. user clicks "scrape" twice).
interface CacheEntry {
  data: any;
  expiresAt: number;
}
const scrapeCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(url: string): any | null {
  const entry = scrapeCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    scrapeCache.delete(url);
    return null;
  }
  return entry.data;
}

function setCached(url: string, data: any): void {
  // Prevent unbounded cache growth
  if (scrapeCache.size > 50) {
    const oldestKey = scrapeCache.keys().next().value;
    if (oldestKey) scrapeCache.delete(oldestKey);
  }
  scrapeCache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Fetch with retry — tries up to 3 times (initial + 2 retries) with
 * exponential backoff (1s, 2s). Only retries on network errors and 5xx
 * responses (4xx errors are not retried — they're the client's fault).
 */
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });

      // Retry on 5xx server errors (transient)
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (err: any) {
      lastError = err;
      // Retry on network errors (timeout, DNS, connection reset)
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("fetchWithRetry exhausted retries");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    let parsedBody: any;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { url } = parsedBody;
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return NextResponse.json({ error: "Only http/https URLs are supported" }, { status: 400 });
    }

    // === Check cache first ===
    const cached = getCached(url);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    // === Fetch with retry ===
    let res: Response;
    try {
      res = await fetchWithRetry(url, 2);
    } catch (fetchErr: any) {
      // Graceful failure — return a clear error so the UI can fall back to manual input
      return NextResponse.json(
        {
          error: `Could not fetch the URL after 3 attempts: ${fetchErr?.message ?? "network error"}. The site may be blocking automated requests, or it may be temporarily unavailable. You can still paste the job description manually.`,
          url,
          diagnostics: { fetchError: fetchErr?.message },
        },
        { status: 502 }
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `The URL returned HTTP ${res.status} ${res.statusText}. The site may be blocking automated requests.` },
        { status: 502 }
      );
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text") && !ct.includes("html") && !ct.includes("xml")) {
      return NextResponse.json(
        { error: `URL returned content type "${ct}" which is not parseable as text.` },
        { status: 415 }
      );
    }

    const html = await res.text();

    if (!html || html.trim().length < 50) {
      return NextResponse.json(
        { error: "The page returned empty content. The site may require JavaScript rendering. Please paste the job description text manually." },
        { status: 502 }
      );
    }

    const text = htmlToText(html);

    // Extract structured data as fallbacks for JS-rendered pages
    const metaDesc = extractMetaDescription(html);
    const ogDesc = extractMetaProperty(html, "og:description");
    const ogTitle = extractMetaProperty(html, "og:title");
    const ogSiteName = extractMetaProperty(html, "og:site_name");
    const jsonLdData = extractJsonLd(html);
    const pageTitle = extractTitle(html);

    // Diagnostics — returned to the frontend for the diagnostics panel
    const diagnostics = {
      urlReachable: true,
      httpStatus: res.status,
      htmlRetrieved: html.length > 0,
      htmlSize: html.length,
      contentExtracted: text.trim().length > 30,
      contentLength: text.trim().length,
      hasMetaDescription: !!metaDesc,
      hasOpenGraph: !!ogDesc || !!ogTitle,
      hasJsonLd: jsonLdData.length > 0,
      jsonLdCount: jsonLdData.length,
      title: pageTitle || ogTitle || "",
      metaDescription: metaDesc || "",
      ogTitle: ogTitle || "",
      ogDescription: ogDesc || "",
      ogSiteName: ogSiteName || "",
      jsonLd: jsonLdData.slice(0, 3), // first 3 JSON-LD blocks
    };

    let fullText = text;

    // If body text is too short, use structured data fallbacks
    if (fullText.trim().length < 100) {
      const parts: string[] = [];
      if (jsonLdData.length > 0) {
        // Try to extract job posting data from JSON-LD
        for (const ld of jsonLdData) {
          if (ld.title) parts.push(`Title: ${ld.title}`);
          if (ld.description) parts.push(`Description: ${ld.description}`);
          if (ld.hiringOrganization?.name) parts.push(`Company: ${ld.hiringOrganization.name}`);
          if (ld.jobLocation?.address?.addressLocality) parts.push(`Location: ${ld.jobLocation.address.addressLocality}`);
          if (ld.employmentType) parts.push(`Employment Type: ${Array.isArray(ld.employmentType) ? ld.employmentType.join(", ") : ld.employmentType}`);
          if (ld.skills) parts.push(`Skills: ${Array.isArray(ld.skills) ? ld.skills.join(", ") : ld.skills}`);
          if (ld.qualifications) parts.push(`Qualifications: ${Array.isArray(ld.qualifications) ? ld.qualifications.join(", ") : ld.qualifications}`);
          if (ld.responsibilities) parts.push(`Responsibilities: ${Array.isArray(ld.responsibilities) ? ld.responsibilities.join(", ") : ld.responsibilities}`);
        }
      }
      if (ogTitle) parts.push(`Title: ${ogTitle}`);
      if (ogDesc) parts.push(`Description: ${ogDesc}`);
      if (metaDesc && !ogDesc) parts.push(`Description: ${metaDesc}`);
      if (ogSiteName) parts.push(`Company: ${ogSiteName}`);

      if (parts.length > 0) {
        fullText = parts.join("\n\n") + "\n\nNote: This page uses JavaScript rendering. Extracted data from structured metadata (JSON-LD, OpenGraph, meta tags). For full extraction, paste the JD text manually.";
      }
    }

    if (fullText.trim().length < 30) {
      return NextResponse.json(
        {
          error: "The page was fetched but no readable text was found. The site uses JavaScript rendering (e.g., React/Angular SPA). Please copy the job description text from your browser and paste it manually — the AI extraction works the same.",
          diagnostics,
        },
        { status: 502 }
      );
    }

    const responseData = {
      url,
      title: pageTitle || ogTitle || metaDesc?.slice(0, 60),
      text: fullText.slice(0, 20000),
      diagnostics,
    };

    // Cache the successful result for 5 minutes
    setCached(url, responseData);

    return NextResponse.json(responseData);
  } catch (e: any) {
    const msg = e?.message || "Unknown error";
    // Provide user-friendly error messages
    if (msg.includes("fetch failed") || msg.includes("network")) {
      return NextResponse.json(
        { error: "Network error — the site may be blocking our request or is unreachable. Please paste the JD text manually." },
        { status: 502 }
      );
    }
    if (msg.includes("timeout") || msg.includes("abort")) {
      return NextResponse.json(
        { error: "Request timed out — the site took too long to respond. Please paste the JD text manually." },
        { status: 504 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>(?!\s*$)/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|tr|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim();
}

function extractMetaDescription(html: string): string | undefined {
  const m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  return m?.[1]?.trim();
}

function extractMetaProperty(html: string, property: string): string | undefined {
  // Try property="..." format
  const re1 = new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']+)["']`, "i");
  const m1 = html.match(re1);
  if (m1) return m1[1].trim();
  // Try content="..." property="..." format (reversed order)
  const re2 = new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+property=["']${property}["']`, "i");
  const m2 = html.match(re2);
  if (m2) return m2[1].trim();
  return undefined;
}

/**
 * Extract JSON-LD structured data from HTML.
 * Returns an array of parsed JSON-LD objects (JobPosting, Organization, etc.)
 */
function extractJsonLd(html: string): any[] {
  const results: any[] = [];
  // Match all <script type="application/ld+json"> blocks
  const regex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1].trim());
      if (Array.isArray(json)) {
        results.push(...json);
      } else if (json["@graph"] && Array.isArray(json["@graph"])) {
        results.push(...json["@graph"]);
      } else {
        results.push(json);
      }
    } catch {
      // JSON-LD is malformed — skip
    }
  }
  return results;
}
