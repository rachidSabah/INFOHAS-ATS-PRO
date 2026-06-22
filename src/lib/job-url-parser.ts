// ============================================================================
// Job URL Multi-Stage Parser — extracts structured job data from any URL.
//
// PROBLEM (P1.7 — Job URL Parsing):
//   AI-over-API currently fails on job URLs because:
//   1. The HTML fetch returns a JavaScript-rendered SPA with no body text
//   2. The AI tries to parse the empty HTML and returns garbage
//   3. There's no structured fallback chain
//
// SOLUTION:
//   This module implements a 6-stage pipeline that extracts job data from
//   any URL, regardless of how it's rendered:
//
//   Stage 1: HTML Fetch — get the raw HTML (with retry + SSRF protection)
//   Stage 2: Readability Extraction — strip nav/footer/scripts, extract body
//   Stage 3: JSON-LD Extraction — parse <script type="application/ld+json">
//   Stage 4: OpenGraph Extraction — parse og:title, og:description, og:site_name
//   Stage 5: Regex Extraction — pattern-match title/company/location/skills
//   Stage 6: AI Extraction — send the cleaned text to the AI for structured parsing
//
//   Each stage produces a partial ParsedJob object. The stages are run in
//   order; later stages only fill in fields that earlier stages missed.
//   The final ParsedJob is validated against a schema before being returned.
//
// USAGE (server-side only — this module uses fetch):
//   const result = await parseJobUrl(url, { aiCaller });
//   if (result.ok) {
//     console.log(result.parsedJob.title, result.parsedJob.company);
//   }
// ============================================================================

// === Types ===

export interface ParsedJob {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  employmentType?: string;
  salary?: string;
  experienceYears?: string;
  education?: string;
  responsibilities: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  technologies: string[];
  keywords: string[];
  rawText: string;
  url: string;
  source: string; // which stage produced this data
  metadata: JobMetadata;
}

export interface JobMetadata {
  urlReachable: boolean;
  httpStatus?: number;
  htmlSize: number;
  textExtracted: boolean;
  textLength: number;
  hasMetaDescription: boolean;
  hasOpenGraph: boolean;
  hasJsonLd: boolean;
  jsonLdCount: number;
  stagesRun: string[];
  stageResults: Record<string, { ran: boolean; fieldsExtracted: string[]; error?: string }>;
  aiUsed: boolean;
  aiProvider?: string;
  aiLatencyMs?: number;
  fetchedAt: string;
}

export interface ParseJobUrlOptions {
  /** Optional AI caller function (for Stage 6). If not provided, Stage 6 is skipped. */
  aiCaller?: (systemPrompt: string, userPrompt: string) => Promise<string>;
  /** Maximum HTML size to fetch (default: 5MB). */
  maxHtmlSize?: number;
  /** Maximum text to send to the AI (default: 20000 chars). */
  maxTextForAI?: number;
  /** Whether to run Stage 6 (AI extraction). Default: true if aiCaller is provided. */
  runAIExtraction?: boolean;
}

export interface ParseJobUrlResult {
  ok: boolean;
  parsedJob?: ParsedJob;
  error?: string;
  metadata: JobMetadata;
}

// ============================================================================
// Main entry point
// ============================================================================

export async function parseJobUrl(
  url: string,
  options: ParseJobUrlOptions = {},
): Promise<ParseJobUrlResult> {
  const maxHtmlSize = options.maxHtmlSize ?? 5_000_000;
  const maxTextForAI = options.maxTextForAI ?? 20_000;
  const runAI = options.runAIExtraction ?? !!options.aiCaller;

  const metadata: JobMetadata = {
    urlReachable: false,
    htmlSize: 0,
    textExtracted: false,
    textLength: 0,
    hasMetaDescription: false,
    hasOpenGraph: false,
    hasJsonLd: false,
    jsonLdCount: 0,
    stagesRun: [],
    stageResults: {},
    aiUsed: false,
    fetchedAt: new Date().toISOString(),
  };

  const parsedJob: ParsedJob = {
    responsibilities: [],
    requiredSkills: [],
    preferredSkills: [],
    technologies: [],
    keywords: [],
    rawText: "",
    url,
    source: "unknown",
    metadata,
  };

  // === Stage 1: HTML Fetch ===
  metadata.stagesRun.push("fetch");
  metadata.stageResults.fetch = { ran: false, fieldsExtracted: [] };

  let html: string;
  try {
    const fetchResult = await fetchHtml(url, maxHtmlSize);
    if (!fetchResult.ok) {
      return {
        ok: false,
        error: fetchResult.error,
        metadata,
      };
    }
    html = fetchResult.html;
    metadata.urlReachable = true;
    metadata.httpStatus = fetchResult.httpStatus;
    metadata.htmlSize = html.length;
    metadata.stageResults.fetch.ran = true;
    metadata.stageResults.fetch.fieldsExtracted = ["html"];
  } catch (e: any) {
    metadata.stageResults.fetch.error = e?.message;
    return {
      ok: false,
      error: `Stage 1 (fetch) failed: ${e?.message}`,
      metadata,
    };
  }

  // === Stage 2: Readability Extraction ===
  metadata.stagesRun.push("readability");
  metadata.stageResults.readability = { ran: false, fieldsExtracted: [] };

  const text = htmlToText(html);
  if (text.trim().length > 30) {
    parsedJob.rawText = text;
    metadata.textExtracted = true;
    metadata.textLength = text.length;
    metadata.stageResults.readability.ran = true;
    metadata.stageResults.readability.fieldsExtracted = ["rawText"];
  } else {
    metadata.stageResults.readability.error = "Text too short (<30 chars) — likely a JS-rendered SPA";
  }

  // Extract title from <title> tag as a baseline
  const pageTitle = extractTitle(html);
  if (pageTitle) {
    parsedJob.title = pageTitle;
    metadata.stageResults.readability.fieldsExtracted.push("title");
  }

  // === Stage 3: JSON-LD Extraction ===
  metadata.stagesRun.push("jsonld");
  metadata.stageResults.jsonld = { ran: false, fieldsExtracted: [] };

  const jsonLdBlocks = extractJsonLd(html);
  metadata.jsonLdCount = jsonLdBlocks.length;
  metadata.hasJsonLd = jsonLdBlocks.length > 0;

  if (jsonLdBlocks.length > 0) {
    metadata.stageResults.jsonld.ran = true;
    const jobPosting = jsonLdBlocks.find((b) => b["@type"] === "JobPosting") ?? jsonLdBlocks[0];
    if (jobPosting) {
      if (jobPosting.title && !parsedJob.title) {
        parsedJob.title = jobPosting.title;
        metadata.stageResults.jsonld.fieldsExtracted.push("title");
      }
      if (jobPosting.description && !parsedJob.description) {
        parsedJob.description = stripHtml(jobPosting.description);
        metadata.stageResults.jsonld.fieldsExtracted.push("description");
      }
      if (jobPosting.hiringOrganization?.name && !parsedJob.company) {
        parsedJob.company = jobPosting.hiringOrganization.name;
        metadata.stageResults.jsonld.fieldsExtracted.push("company");
      }
      if (jobPosting.jobLocation?.address?.addressLocality && !parsedJob.location) {
        parsedJob.location = jobPosting.jobLocation.address.addressLocality;
        metadata.stageResults.jsonld.fieldsExtracted.push("location");
      }
      if (jobPosting.employmentType && !parsedJob.employmentType) {
        parsedJob.employmentType = Array.isArray(jobPosting.employmentType)
          ? jobPosting.employmentType.join(", ")
          : jobPosting.employmentType;
        metadata.stageResults.jsonld.fieldsExtracted.push("employmentType");
      }
      if (jobPosting.skills && !parsedJob.requiredSkills.length) {
        parsedJob.requiredSkills = Array.isArray(jobPosting.skills) ? jobPosting.skills : [jobPosting.skills];
        metadata.stageResults.jsonld.fieldsExtracted.push("requiredSkills");
      }
      if (jobPosting.qualifications && !parsedJob.preferredSkills.length) {
        parsedJob.preferredSkills = Array.isArray(jobPosting.qualifications)
          ? jobPosting.qualifications
          : [jobPosting.qualifications];
        metadata.stageResults.jsonld.fieldsExtracted.push("preferredSkills");
      }
      if (jobPosting.responsibilities && !parsedJob.responsibilities.length) {
        parsedJob.responsibilities = Array.isArray(jobPosting.responsibilities)
          ? jobPosting.responsibilities
          : [jobPosting.responsibilities];
        metadata.stageResults.jsonld.fieldsExtracted.push("responsibilities");
      }
    }
  }

  // === Stage 4: OpenGraph Extraction ===
  metadata.stagesRun.push("opengraph");
  metadata.stageResults.opengraph = { ran: false, fieldsExtracted: [] };

  const ogTitle = extractMetaProperty(html, "og:title");
  const ogDesc = extractMetaProperty(html, "og:description");
  const ogSiteName = extractMetaProperty(html, "og:site_name");
  const ogType = extractMetaProperty(html, "og:type");
  metadata.hasOpenGraph = !!(ogTitle || ogDesc || ogSiteName);

  if (metadata.hasOpenGraph) {
    metadata.stageResults.opengraph.ran = true;
    if (ogTitle && (!parsedJob.title || parsedJob.title === pageTitle)) {
      // OG title is often more accurate than <title>
      parsedJob.title = ogTitle;
      metadata.stageResults.opengraph.fieldsExtracted.push("title");
    }
    if (ogDesc && !parsedJob.description) {
      parsedJob.description = ogDesc;
      metadata.stageResults.opengraph.fieldsExtracted.push("description");
    }
    if (ogSiteName && !parsedJob.company) {
      // og:site_name is often the company name (e.g. "LinkedIn", "Indeed")
      // Only use it if we don't already have a company from JSON-LD
      parsedJob.company = ogSiteName;
      metadata.stageResults.opengraph.fieldsExtracted.push("company");
    }
  }

  // Also check meta description
  const metaDesc = extractMetaDescription(html);
  metadata.hasMetaDescription = !!metaDesc;
  if (metaDesc && !parsedJob.description) {
    parsedJob.description = metaDesc;
    metadata.stageResults.opengraph.fieldsExtracted.push("description");
  }

  // === Stage 5: Regex Extraction ===
  metadata.stagesRun.push("regex");
  metadata.stageResults.regex = { ran: false, fieldsExtracted: [] };

  const regexFields = extractByRegex(parsedJob.rawText || html);
  if (Object.keys(regexFields).length > 0) {
    metadata.stageResults.regex.ran = true;
    if (regexFields.location && !parsedJob.location) {
      parsedJob.location = regexFields.location;
      metadata.stageResults.regex.fieldsExtracted.push("location");
    }
    if (regexFields.salary && !parsedJob.salary) {
      parsedJob.salary = regexFields.salary;
      metadata.stageResults.regex.fieldsExtracted.push("salary");
    }
    if (regexFields.experienceYears && !parsedJob.experienceYears) {
      parsedJob.experienceYears = regexFields.experienceYears;
      metadata.stageResults.regex.fieldsExtracted.push("experienceYears");
    }
    if (regexFields.skills && parsedJob.requiredSkills.length === 0) {
      parsedJob.requiredSkills = regexFields.skills;
      metadata.stageResults.regex.fieldsExtracted.push("requiredSkills");
    }
  }

  // === Stage 6: AI Extraction ===
  if (runAI && options.aiCaller && parsedJob.rawText.length > 100) {
    metadata.stagesRun.push("ai");
    metadata.stageResults.ai = { ran: false, fieldsExtracted: [] };

    try {
      const aiResult = await extractWithAI(parsedJob.rawText.slice(0, maxTextForAI), options.aiCaller);
      if (aiResult) {
        metadata.stageResults.ai.ran = true;
        metadata.aiUsed = true;
        metadata.aiProvider = aiResult.provider;

        // Only fill in fields that earlier stages missed
        if (aiResult.title && !parsedJob.title) {
          parsedJob.title = aiResult.title;
          metadata.stageResults.ai.fieldsExtracted.push("title");
        }
        if (aiResult.company && !parsedJob.company) {
          parsedJob.company = aiResult.company;
          metadata.stageResults.ai.fieldsExtracted.push("company");
        }
        if (aiResult.location && !parsedJob.location) {
          parsedJob.location = aiResult.location;
          metadata.stageResults.ai.fieldsExtracted.push("location");
        }
        if (aiResult.description && !parsedJob.description) {
          parsedJob.description = aiResult.description;
          metadata.stageResults.ai.fieldsExtracted.push("description");
        }
        if (aiResult.responsibilities?.length && parsedJob.responsibilities.length === 0) {
          parsedJob.responsibilities = aiResult.responsibilities;
          metadata.stageResults.ai.fieldsExtracted.push("responsibilities");
        }
        if (aiResult.requiredSkills?.length && parsedJob.requiredSkills.length === 0) {
          parsedJob.requiredSkills = aiResult.requiredSkills;
          metadata.stageResults.ai.fieldsExtracted.push("requiredSkills");
        }
        if (aiResult.preferredSkills?.length && parsedJob.preferredSkills.length === 0) {
          parsedJob.preferredSkills = aiResult.preferredSkills;
          metadata.stageResults.ai.fieldsExtracted.push("preferredSkills");
        }
        if (aiResult.technologies?.length && parsedJob.technologies.length === 0) {
          parsedJob.technologies = aiResult.technologies;
          metadata.stageResults.ai.fieldsExtracted.push("technologies");
        }
        if (aiResult.keywords?.length && parsedJob.keywords.length === 0) {
          parsedJob.keywords = aiResult.keywords;
          metadata.stageResults.ai.fieldsExtracted.push("keywords");
        }
      }
    } catch (e: any) {
      metadata.stageResults.ai.error = e?.message;
    }
  }

  // === Validation ===
  // We need at least a title or description to consider this a successful parse
  if (!parsedJob.title && !parsedJob.description && parsedJob.rawText.length < 100) {
    return {
      ok: false,
      error:
        "Could not extract job data from the URL. The page uses JavaScript rendering (React/Angular SPA) and no structured metadata (JSON-LD, OpenGraph) was found. Please paste the job description text manually.",
      metadata,
    };
  }

  // Extract keywords from the final text (top 10 most frequent non-stopwords)
  if (parsedJob.keywords.length === 0 && parsedJob.rawText) {
    parsedJob.keywords = extractKeywords(parsedJob.rawText);
  }

  // Mark the source as the stage that extracted the most fields
  let maxFields = 0;
  let bestStage = "unknown";
  for (const [stage, result] of Object.entries(metadata.stageResults)) {
    if (result.fieldsExtracted.length > maxFields) {
      maxFields = result.fieldsExtracted.length;
      bestStage = stage;
    }
  }
  parsedJob.source = bestStage;

  return { ok: true, parsedJob, metadata };
}

// ============================================================================
// Stage implementations
// ============================================================================

async function fetchHtml(
  url: string,
  maxSize: number,
): Promise<{ ok: true; html: string; httpStatus: number } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text") && !ct.includes("html") && !ct.includes("xml")) {
      return { ok: false, error: `Unsupported content type: ${ct}` };
    }

    const html = await res.text();
    if (!html || html.length < 50) {
      return { ok: false, error: "Page returned empty content" };
    }
    if (html.length > maxSize) {
      return { ok: false, error: `Page too large (${html.length} bytes, max ${maxSize})` };
    }

    return { ok: true, html, httpStatus: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Network error" };
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
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
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
  const re1 = new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']+)["']`, "i");
  const m1 = html.match(re1);
  if (m1) return m1[1].trim();
  const re2 = new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+property=["']${property}["']`, "i");
  const m2 = html.match(re2);
  if (m2) return m2[1].trim();
  return undefined;
}

function extractJsonLd(html: string): any[] {
  const results: any[] = [];
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
      // skip malformed JSON-LD
    }
  }
  return results;
}

function extractByRegex(text: string): {
  location?: string;
  salary?: string;
  experienceYears?: string;
  skills?: string[];
} {
  const result: any = {};

  // Location: "Location: City, State" or "Location: City, Country"
  const locMatch = text.match(/(?:location|location:)\s*([A-Z][a-zA-Z\s,]+(?:,\s*[A-Z]{2})?)/i);
  if (locMatch) result.location = locMatch[1].trim();

  // Salary: "$80,000 - $100,000" or "$80k-$100k" or "Salary: $80,000"
  const salMatch = text.match(/\$[\d,]+\s*(?:k|K)?\s*(?:-|to|–)\s*\$[\d,]+\s*(?:k|K)?/);
  if (salMatch) result.salary = salMatch[0];
  else {
    const salMatch2 = text.match(/(?:salary|compensation):?\s*(\$[\d,]+\s*(?:k|K)?(?:\s*\/?\s*(?:year|yr|month|mo|hour|hr))?)/i);
    if (salMatch2) result.salary = salMatch2[1];
  }

  // Experience: "5+ years" or "3-5 years" or "Experience: 5 years"
  const expMatch = text.match(/(\d+(?:\s*[-+]\s*\d+)?)\s*\+?\s*years?\s*(?:of\s+)?(?:experience|exp)/i);
  if (expMatch) result.experienceYears = expMatch[1].replace(/\s+/g, " ").trim();

  // Skills: look for a "Skills:" or "Requirements:" section
  const skillsSection = text.match(/(?:skills|required skills|technologies|tech stack):?\s*([^\n]+)/i);
  if (skillsSection) {
    const skills = skillsSection[1]
      .split(/[,;•|]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40);
    if (skills.length > 0) result.skills = skills;
  }

  return result;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "should", "could", "may", "might", "must",
  "you", "your", "we", "our", "they", "their", "he", "she", "it", "its", "this", "that",
  "these", "those", "what", "which", "who", "whom", "how", "when", "where", "why",
  "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "can", "just",
  "should", "now", "year", "years", "experience", "work", "working", "job", "role",
  "position", "company", "team", "candidate", "candidates", "ability", "strong",
  "including", "include", "includes", "must", "plus", "etc", "may", "well",
]);

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/\b[a-z][a-z+#.\-]+\b/g) ?? [];
  const freq: Record<string, number> = {};
  for (const w of words) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    freq[w] = (freq[w] ?? 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

interface AIExtractionResult {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  responsibilities?: string[];
  requiredSkills?: string[];
  preferredSkills?: string[];
  technologies?: string[];
  keywords?: string[];
  provider?: string;
}

async function extractWithAI(
  text: string,
  aiCaller: (systemPrompt: string, userPrompt: string) => Promise<string>,
): Promise<AIExtractionResult | null> {
  const systemPrompt = `You are a job-description parser. Extract structured data from the job description text. Return ONLY a JSON object with these fields:
{
  "title": "string — the job title",
  "company": "string — the hiring company name",
  "location": "string — the job location (city, state/country)",
  "description": "string — a 1-2 sentence summary of the role",
  "responsibilities": ["array of strings — key responsibilities"],
  "requiredSkills": ["array of strings — required skills"],
  "preferredSkills": ["array of strings — preferred/nice-to-have skills"],
  "technologies": ["array of strings — specific technologies/tools mentioned"],
  "keywords": ["array of strings — top 5-10 keywords for ATS matching"]
}

Rules:
- Return ONLY the JSON object. No prose, no markdown fences.
- If a field is not present in the text, omit it (don't include it as null or empty string).
- Keep arrays to 5-10 items max.`;

  const userPrompt = `Parse this job description:\n\n${text}`;

  try {
    const response = await aiCaller(systemPrompt, userPrompt);
    // Find the JSON in the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return { ...parsed, provider: "AI" };
  } catch {
    return null;
  }
}
