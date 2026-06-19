// ResumeAI Pro — Aviation-focused ATS directives & helpers
//
// This module contains:
//   1. CABIN_CREW_KEYWORDS  — aviation/cabin-crew keyword bank for ATS matching
//   2. AVIATION_KEYWORDS    — broader aviation keyword bank
//   3. AIRLINE_ATS_PROFILES — per-airline ATS system configs (Emirates, Qatar, Etihad, …)
//   4. AppSettings          — tone / format / strictness settings for the optimizer
//   5. analyzeWithGemini()  — AI function that produces a scored, optimized HTML resume
//   6. getDocxHtml()        — strict A4 one-page HTML wrapper for .doc/.docx export
//
// analyzeWithGemini() routes through our existing callAI() gateway (Puter → server → local),
// so it inherits the full failover chain. The "Gemini" name is preserved for compatibility
// with the original spec — in practice any provider can serve it.

import { callAI, extractJSON } from "./ai";
import type { ResumeData } from "./types";

// ============================================================================
// 1. KEYWORD BANKS
// ============================================================================

export const CABIN_CREW_KEYWORDS = `
  Technical: Cabin Crew Attestation (CCA), CPR/AED Certified, Aviation First Aid, SEP (Safety and Emergency Procedures), Aircraft Type Qualifications (e.g., A380, B787), Cabin Crew Medical.
  Safety: Emergency Evacuation, Dangerous Goods Regulations (DGR), In-flight Firefighting, Ditching Procedures, Pre-flight Safety Checks, Aviation Security (AVSEC).
  Operational: CRM (Crew Resource Management), In-flight Service Delivery, Galley Management, Passenger Announcements (PA), Turnaround Operations, Special Handling (UMNR, PRM).
  Soft Skills: Customer Service Excellence, Conflict Resolution, Cultural Awareness, De-escalation, Decision Making Under Pressure, Situational Awareness.
`;

export const AVIATION_KEYWORDS = `
  Technical: Cabin Crew Attestation (CCA), ATP Certificate, Type Ratings (A320, B737, B777, B787, A350, A380), CRM Certification, Aviation First Aid, CPR/AED, SEP (Safety and Emergency Procedures), Aircraft Type Qualifications, Cabin Crew Medical, ICAO Language Proficiency (Level 4+).
  Safety: Emergency Evacuation, Dangerous Goods Regulations (DGR), In-flight Firefighting, Ditching Procedures, Pre-flight Safety Checks, Aviation Security (AVSEC), Smoke Removal, Rapid Decompression, Cabin Pressurization.
  Operational: Crew Resource Management (CRM), In-flight Service Delivery, Galley Management, Passenger Announcements (PA), Turnaround Operations, Special Handling (UMNR, PRM, CIP), Duty-Free Sales, Cash & Card Handling, Passenger Boarding, Disembarkation Procedures.
  Service: Customer Service Excellence, Conflict Resolution, Cultural Awareness, De-escalation, Decision Making Under Pressure, Situational Awareness, Multicultural Team Collaboration, Premium Cabin Service, Fine Dining Service, Beverage Service.
  Regulatory: EASA Part-CC, FAA Part 121/135, CAA CAP 789, ICAO Annex 6, IATA DGR, Aviation Audits (IOSA), Safety Management Systems (SMS).
  Languages: English (ICAO Level 4+), Arabic, French, German, Spanish, Mandarin, Hindi, Urdu — cross-cultural communication.
`;

// ============================================================================
// 2. AIRLINE ATS PROFILES
// ============================================================================

export interface AirlineAtsProfile {
  system: string;
  focus: string;
  // Keywords the airline's ATS specifically weights
  priorityKeywords?: string[];
  // Tone preference
  tone?: "Formal" | "Balanced" | "Warm" | "Premium";
}

export const AIRLINE_ATS_PROFILES: Record<string, AirlineAtsProfile> = {
  emirates: {
    system: "Emirates Group Talent ATS (Workday)",
    focus: "Multicultural service excellence, premium cabin experience, Dubai-based global operations",
    priorityKeywords: ["Multicultural", "Premium Service", "Diversity", "Global Mindset", "Excellence", "Hospitality", "Luxury", "Etiquette"],
    tone: "Premium",
  },
  qatar: {
    system: "Qatar Airways Talent ATS (SuccessFactors)",
    focus: "Five-star service, fast-paced hub operations, Doha connectivity, award-winning cabin crew",
    priorityKeywords: ["Five-Star", "Award-Winning", "Service Excellence", "Hub Operations", "Diversity", "Premium", "Hospitality"],
    tone: "Formal",
  },
  etihad: {
    system: "Etihad Aviation Group ATS (Taleo)",
    focus: "Abu Dhabi flagship carrier, premium product, cabin crew inflight innovation",
    priorityKeywords: ["Innovation", "Premium", "Choose Well", "Hospitality", "UAE National", "Service Excellence"],
    tone: "Balanced",
  },
  lufthansa: {
    system: "Lufthansa Group ATS (SAP SuccessFactors)",
    focus: "German engineering precision, European network, Star Alliance integration, safety-first",
    priorityKeywords: ["Precision", "Safety-First", "Star Alliance", "German", "Engineering", "Reliability", "Efficiency"],
    tone: "Formal",
  },
  ryanair: {
    system: "Ryanair Careers ATS",
    focus: "Low-cost carrier efficiency, fast turnarounds, high-volume operations, punctuality",
    priorityKeywords: ["Efficiency", "Punctuality", "Fast Turnaround", "Low-Cost", "High-Volume", "On-Time Performance"],
    tone: "Balanced",
  },
  singapore: {
    system: "Singapore Airlines ATS (Workday)",
    focus: "Singapore Girl service standard, Asian hospitality, ultra-long-haul operations, premium cabins",
    priorityKeywords: ["Asian Hospitality", "Singapore Girl", "Premium", "Ultra-Long-Haul", "Service Excellence", "Refinement"],
    tone: "Premium",
  },
  airfrance: {
    system: "Air France-KLM ATS",
    focus: "French service elegance, dual-hub (CDG/AMS), SkyTeam integration, premium leisure",
    priorityKeywords: ["Elegance", "French", "SkyTeam", "Premium Leisure", "Hospitality", "Bilingual"],
    tone: "Premium",
  },
  british: {
    system: "British Airways ATS (Workday)",
    focus: "British heritage service, London hub, premium long-haul, oneworld alliance",
    priorityKeywords: ["Heritage", "British", "Premium", "Oneworld", "Long-Haul", "Service Excellence"],
    tone: "Formal",
  },
  generic: {
    system: "Generic ATS (Workday / SuccessFactors / Taleo compatible)",
    focus: "General aviation keyword matching, standard cabin crew competency framework",
    priorityKeywords: [],
    tone: "Balanced",
  },
};

export const AIRLINE_OPTIONS = [
  { id: "generic", label: "Generic / Multi-Airline", icon: "Globe" },
  { id: "emirates", label: "Emirates", icon: "Plane" },
  { id: "qatar", label: "Qatar Airways", icon: "Plane" },
  { id: "etihad", label: "Etihad Airways", icon: "Plane" },
  { id: "lufthansa", label: "Lufthansa Group", icon: "Plane" },
  { id: "ryanair", label: "Ryanair", icon: "Plane" },
  { id: "singapore", label: "Singapore Airlines", icon: "Plane" },
  { id: "airfrance", label: "Air France-KLM", icon: "Plane" },
  { id: "british", label: "British Airways", icon: "Plane" },
];

// ============================================================================
// 3. APP SETTINGS (tone / format / strictness)
// ============================================================================

export interface AppSettings {
  tone: "Formal" | "Balanced" | "Warm" | "Premium" | "Aggressive";
  format: "Chronological" | "Functional" | "Hybrid" | "Combination";
  strictness: "Conservative" | "Balanced" | "Aggressive";
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  tone: "Balanced",
  format: "Chronological",
  strictness: "Balanced",
};

// ============================================================================
// 4. analyzeWithGemini — aviation-aware ATS optimization
// ============================================================================

export interface AviationAtsResult {
  score: number;
  score_breakdown: { impact: number; brevity: number; keywords: number };
  summary_critique: string;
  missing_keywords: string[];
  matched_keywords: string[];
  optimized_content: string; // HTML
}

/**
 * Aviation-aware ATS optimization. Uses the directive prompt with airline-specific
 * ATS profile, aviation keyword bank, tone/format/strictness settings, and strict
 * 2,800-character / one-A4-page enforcement.
 *
 * Routes through callAI() (Puter → server → local) for full failover.
 */
export async function analyzeWithGemini(
  resumeText: string,
  jobDescription: string,
  settings: AppSettings,
  airlineProfile: string
): Promise<AviationAtsResult> {
  try {
    const toneInstruction = settings?.tone || "Balanced";
    const formatInstruction = settings?.format || "Chronological";
    const strictnessInstruction = settings?.strictness === "Aggressive"
      ? "MAXIMUM keyword stuffing."
      : "Balanced optimization.";
    const atsSystem = airlineProfile ? (AIRLINE_ATS_PROFILES[airlineProfile]?.system || "Generic ATS") : "Generic ATS";
    const atsFocus = airlineProfile ? (AIRLINE_ATS_PROFILES[airlineProfile]?.focus || "General") : "General";

    const prompt = `
      ACT AS: Senior ATS Optimization Expert and Master Executive Resume Writer.

      OBJECTIVE: Optimise for maximum ATS score. Rewrite the resume to FILL EXACTLY ONE A4 PAGE (12pt font). You must strategically weave in exact keywords, hard skills, and industry terminology to guarantee a 90%+ match rate.

      CONTEXT:
      - ATS SYSTEM: ${atsSystem} (${atsFocus})
      - INDUSTRY KEYWORDS: ${AVIATION_KEYWORDS}
      - TONE: ${toneInstruction}
      - FORMAT STYLE: ${formatInstruction}
      - STRATEGY: ${strictnessInstruction}

      INPUT DATA:
      [RESUME]: ${resumeText}
      [JOB DESCRIPTION]: ${jobDescription}

      TASK 1: SCORING (Calculate ATS Score, Impact, Brevity, Keywords).
      TASK 2: REWRITE (STRICT PLAIN TEXT).

      CRITICAL LENGTH ENFORCEMENT (NON-NEGOTIABLE & STRICT):
      The generated resume MUST contain EXACTLY 2,800 characters (excluding HTML tags). Not less, not more.
      - 2,100 characters is too short and sparse. DO NOT OUTPUT SHORT TEXT.
      - 3,000+ characters will cause page overflow. DO NOT EXCEED.
      - **HOW TO HIT EXACTLY 2800 CHARACTERS INTELLIGENTLY**:
        1. If the draft is short: Expand content intelligently without filler or redundancy. Add deep technical context. Improve impact-driven bullet points. Ensure measurable achievements are prioritized (e.g., increased efficiency by X%, managed $Y budget). Use 5-7 detailed bullet points for the 2 most recent roles.
        2. If the draft is too long: Summarize older roles (older than 5 years) to a single line without bullet points. Keep the summary to exactly 3 lines.

      FORMATTING RULES (NON-NEGOTIABLE):
      1. **NO** Emojis, Icons, Graphics, Colors, Tables, Columns, or Decorative Symbols.
      2. **NO** Underlines or horizontal rules (<hr>).
      3. **FONT**: Times New Roman, Size 12.

      STRUCTURE:
      1. **HEADER**: Name (H1, Uppercase, Bold, LEFT ALIGNED), Contact Info (LEFT ALIGNED).
      2. **SECTIONS** (H3 tags): PROFESSIONAL SUMMARY, EXPERIENCE, EDUCATION, SKILLS. (Uppercase, Bold, LEFT ALIGNED, No lines).
      3. **EXPERIENCE ENTRIES**:
         - Job Title, Company, Location, Date MUST be on ONE LINE.
         - Format: <h4><strong>Job Title</strong> | <strong>Company Name</strong>, Location | <strong>YYYY to YYYY</strong></h4>
         - Do NOT use "(1 Year)". Use "Present" if applicable.
      4. **EDUCATION ENTRIES**:
         - Format: <h4><strong>Degree</strong> | <strong>School</strong> | <strong>YYYY to YYYY</strong></h4>
         - List relevant modules/subjects learned as a simple bullet list.
      5. **CONTENT**: Use <strong> tags for bolding. NO markdown asterisks (**).

      RETURN JSON FORMAT ONLY:
      {
        "score": number,
        "score_breakdown": { "impact": number, "brevity": number, "keywords": number },
        "summary_critique": "string",
        "missing_keywords": ["string", "string"],
        "matched_keywords": ["string", "string"],
        "optimized_content": "Valid HTML string..."
      }
    `;

    const result = await callAI({
      systemPrompt: "You are a Senior ATS Optimization Expert and Master Executive Resume Writer for the aviation industry. Always return ONLY valid JSON — no markdown fences, no prose.",
      userPrompt: prompt,
      maxTokens: 4000,
      temperature: 0.4,
    });

    // Robustly extract JSON — handles markdown fences, leading prose, trailing commentary.
    // Falls back to a default-scored result on parse failure instead of crashing the UI.
    let data: AviationAtsResult;
    try {
      data = extractJSON<AviationAtsResult>(result.text);
    } catch (parseErr: any) {
      console.warn("[analyzeWithGemini] JSON extraction failed, using fallback result:", parseErr?.message);
      // CRITICAL: summary_critique is an ANALYSIS field shown in the UI's analysis panel,
      // NOT in the resume. But we still must not leak provider errors here.
      data = {
        score: 0,
        score_breakdown: { impact: 0, brevity: 0, keywords: 0 },
        summary_critique: "Analysis could not be completed. Please try again with a different AI provider.",
        missing_keywords: [],
        matched_keywords: [],
        optimized_content: "",
      } as AviationAtsResult;
    }

    // Normalize markdown bold → <strong>
    if (data.optimized_content) {
      data.optimized_content = data.optimized_content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    }
    if (!data.score_breakdown) {
      data.score_breakdown = { impact: 85, brevity: 90, keywords: data.score };
    }
    return data;
  } catch (error: any) {
    console.error("[analyzeWithGemini] AI Error:", error);
    throw new Error(error.message || "Optimization failed. Please check the text and try again.");
  }
}

/**
 * Convert a ResumeData object into the plain-text input that analyzeWithGemini expects.
 */
export function resumeToPlainText(r: ResumeData): string {
  const parts: string[] = [];
  parts.push(r.name || "");
  if (r.headline) parts.push(r.headline);
  const contact = [r.contact.email, r.contact.phone, r.contact.location, r.contact.linkedin, r.contact.github, r.contact.website].filter(Boolean).join(" | ");
  if (contact) parts.push(contact);
  if (r.dateOfBirth) parts.push(`Date of Birth: ${r.dateOfBirth}`);
  if (r.summary) parts.push(`\nPROFESSIONAL SUMMARY\n${r.summary}`);
  if (r.experience.length) {
    parts.push("\nEXPERIENCE");
    for (const e of r.experience) {
      parts.push(`${e.title} | ${e.company}${e.location ? ", " + e.location : ""} | ${e.startDate} to ${e.endDate}`);
      for (const b of e.bullets) parts.push(`- ${b}`);
    }
  }
  if (r.education.length) {
    parts.push("\nEDUCATION");
    for (const ed of r.education) {
      parts.push(`${ed.degree}${ed.field ? " in " + ed.field : ""} | ${ed.institution} | ${ed.startDate} to ${ed.endDate}`);
      if (ed.highlights?.length) for (const h of ed.highlights) parts.push(`- ${h}`);
    }
  }
  if (r.skills.length) parts.push("\nSKILLS\n" + r.skills.map((s) => s.name).join(", "));
  if (r.languages.length) parts.push("\nLANGUAGES\n" + r.languages.map((l) => `${l.name}: ${l.proficiency}`).join("\n"));
  if (r.certifications.length) parts.push("\nCERTIFICATIONS\n" + r.certifications.map((c) => `${c.name}${c.issuer ? " - " + c.issuer : ""}`).join("\n"));
  return parts.join("\n");
}

// ============================================================================
// 5. getDocxHtml — strict A4 one-page HTML wrapper for Word export
// ============================================================================

/**
 * Wraps resume HTML content in a strict A4 one-page Word-compatible HTML document.
 * The @page rules force A4 (21cm × 29.7cm) with 1.27cm margins in Word.
 * Saves as .doc (Word 97-2003) which Word opens natively with the CSS preserved.
 */
export function getDocxHtml(content: string, template: "professional" | "modern" | "minimal" = "professional"): string {
  let fontFamily = "'Times New Roman', serif";
  let headingColor = "#000000";
  let textColor = "#000000";

  if (template === "modern") {
    fontFamily = "'Helvetica Neue', Helvetica, Arial, sans-serif";
    headingColor = "#2c3e50";
    textColor = "#333333";
  } else if (template === "minimal") {
    fontFamily = "'Inter', 'Segoe UI', Roboto, sans-serif";
    headingColor = "#111827";
    textColor = "#4b5563";
  }

  return `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Resume Export</title>
        <style>
          /* STRICT A4 PAGE LAYOUT */
          @page {
              size: 21cm 29.7cm;
              margin: 1.27cm 1.27cm 1.27cm 1.27cm;
              mso-page-orientation: portrait;
          }
          @page WordSection1 {
              size: 21cm 29.7cm;
              margin: 1.27cm 1.27cm 1.27cm 1.27cm;
          }
          div.WordSection1 {
              page: WordSection1;
          }
          /* Global Resets - PLAIN TEXT AESTHETIC */
          body {
            font-family: ${fontFamily};
            font-size: 12.0pt;
            line-height: 1.15;
            color: ${textColor};
            background: #ffffff;
            margin: 0;
            padding: 0;
          }
          /* Force Single Column Flow */
          div, p, ul, li, h1, h2, h3, h4 {
            display: block !important;
            width: 100% !important;
            float: none !important;
            clear: both !important;
          }
          /* Header: Name - LEFT ALIGNED */
          h1 {
            font-size: 16pt;
            font-weight: bold;
            text-align: left;
            text-transform: uppercase;
            color: ${headingColor};
            margin: 0 0 4pt 0;
            padding: 0;
          }
          /* Header: Contact - LEFT ALIGNED */
          p.contact {
            text-align: left;
            font-size: 12pt;
            margin: 0 0 12pt 0;
            color: ${textColor};
          }
          /* Section Headers - LEFT ALIGNED */
          h3 {
            font-size: 12pt;
            font-weight: bold;
            text-transform: uppercase;
            text-align: left;
            border: none !important;
            text-decoration: none !important;
            margin-top: 12pt;
            margin-bottom: 6pt;
            color: ${headingColor};
          }
          /* Job Titles */
          h4 {
            font-size: 12pt;
            margin-top: 6pt;
            margin-bottom: 2pt;
            color: ${headingColor};
            font-weight: bold;
          }
          /* Body Text */
          p {
            margin: 0;
            text-align: justify;
            margin-bottom: 4pt;
          }
          /* Bullets */
          ul {
            margin-top: 0;
            margin-bottom: 8pt;
            padding-left: 18pt;
          }
          li {
            margin-bottom: 2pt;
            padding-left: 0;
          }
          /* Clean Bold */
          strong, b {
            color: ${headingColor};
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="WordSection1">
          ${content}
        </div>
      </body>
    </html>
  `;
}

/**
 * Build the inner HTML body for a resume, following the directive's structure:
 *   <h1>NAME</h1>
 *   <p class="contact">contact info</p>
 *   <h3>PROFESSIONAL SUMMARY</h3><p>summary</p>
 *   <h3>EXPERIENCE</h3>
 *     <h4><strong>Title</strong> | <strong>Company</strong>, Location | <strong>YYYY to YYYY</strong></h4>
 *     <ul><li>bullet</li>...</ul>
 *   <h3>EDUCATION</h3>
 *     <h4><strong>Degree</strong> | <strong>School</strong> | <strong>YYYY to YYYY</strong></h4>
 *     <ul><li>modules</li></ul>
 *   <h3>SKILLS</h3><p>skill, skill, skill</p>
 */
export function resumeToDirectiveHtml(r: ResumeData): string {
  const fmtDate = (d?: string) => {
    if (!d) return "";
    if (/present/i.test(d)) return "Present";
    const m = d.match(/^(\d{4})-(\d{2})$/);
    if (m) return m[1]; // YYYY
    if (/^\d{4}$/.test(d)) return d;
    return d;
  };

  const parts: string[] = [];
  // Header
  parts.push(`<h1>${escapeHtml((r.name || "YOUR NAME").toUpperCase())}</h1>`);
  const contactBits = [r.contact.email, r.contact.phone, r.contact.location, r.contact.linkedin, r.contact.github, r.contact.website].filter((s): s is string => Boolean(s));
  if (contactBits.length) parts.push(`<p class="contact">${contactBits.map(escapeHtml).join(" | ")}</p>`);

  // Summary
  if (r.summary) {
    parts.push(`<h3>PROFESSIONAL SUMMARY</h3><p>${escapeHtml(r.summary)}</p>`);
  }

  // Experience
  if (r.experience.length) {
    parts.push(`<h3>EXPERIENCE</h3>`);
    for (const e of r.experience) {
      const dateStr = `${fmtDate(e.startDate)} to ${fmtDate(e.endDate)}`;
      parts.push(`<h4><strong>${escapeHtml(e.title)}</strong> | <strong>${escapeHtml(e.company)}</strong>${e.location ? ", " + escapeHtml(e.location) : ""} | <strong>${escapeHtml(dateStr)}</strong></h4>`);
      if (e.bullets.length) {
        parts.push(`<ul>${e.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`);
      }
    }
  }

  // Education
  if (r.education.length) {
    parts.push(`<h3>EDUCATION</h3>`);
    for (const ed of r.education) {
      const dateStr = `${fmtDate(ed.startDate)} to ${fmtDate(ed.endDate)}`;
      parts.push(`<h4><strong>${escapeHtml(ed.degree)}${ed.field ? " in " + escapeHtml(ed.field) : ""}</strong> | <strong>${escapeHtml(ed.institution)}</strong> | <strong>${escapeHtml(dateStr)}</strong></h4>`);
      if (ed.highlights?.length) {
        parts.push(`<ul>${ed.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`);
      }
    }
  }

  // Skills
  if (r.skills.length) {
    parts.push(`<h3>SKILLS</h3><p>${r.skills.map((s) => `<strong>${escapeHtml(s.name)}</strong>${s.category ? ` (${escapeHtml(s.category)})` : ""}`).join(", ")}</p>`);
  }

  // Languages
  if (r.languages.length) {
    parts.push(`<h3>LANGUAGES</h3><p>${r.languages.map((l) => `<strong>${escapeHtml(l.name)}</strong>: ${escapeHtml(l.proficiency)}`).join(", ")}</p>`);
  }

  // Certifications
  if (r.certifications.length) {
    parts.push(`<h3>CERTIFICATIONS</h3><ul>${r.certifications.map((c) => `<li><strong>${escapeHtml(c.name)}</strong>${c.issuer ? " - " + escapeHtml(c.issuer) : ""}${c.date ? ` (${escapeHtml(fmtDate(c.date))})` : ""}</li>`).join("")}</ul>`);
  }

  return parts.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
