// Server-side job-description scraper — Edge Runtime compatible for Cloudflare Pages
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

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

    // Fetch with a realistic User-Agent to avoid being blocked
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
    });

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

    // Extract meta description as fallback when body text is too short (JS-rendered pages)
    let fullText = text;
    const metaDesc = extractMetaDescription(html);
    const ogDesc = extractMetaProperty(html, "og:description");

    if (fullText.trim().length < 100) {
      // Page is likely JS-rendered — use meta tags as fallback
      const metaParts = [
        metaDesc,
        ogDesc,
      ].filter(Boolean);
      if (metaParts.length > 0) {
        fullText = metaParts.join("\n\n") + "\n\nNote: This page uses JavaScript rendering. The full job description may not be available via URL scraping. Please paste the job description text manually for better extraction.";
      }
    }

    if (fullText.trim().length < 30) {
      return NextResponse.json(
        { error: "The page was fetched but no readable text was found. The site uses JavaScript rendering (e.g., React/Angular SPA). Please copy the job description text from your browser and paste it manually — the AI extraction works the same." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      url,
      title: extractTitle(html) || metaDesc?.slice(0, 60),
      text: fullText.slice(0, 20000),
    });
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
  const re = new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m?.[1]?.trim();
}
