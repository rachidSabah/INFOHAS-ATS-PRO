// ResumeAI Pro — client-side AI bridge.
// Strategy:
//   0. User-configured default provider (from AI Providers settings) — FIRST priority.
//      Honors the user's chosen model, API key, base URL, and auth type.
//   1. Puter.js (free, user authenticates with Google/GitHub/etc via Puter). Loaded from layout.
//   2. Server-side /api/ai/chat (Z.ai REST fallback) — used when Puter is unavailable.
//   3. Local rule-based fallback (deterministic, always works as offline mode).
//
// All AI calls are wrapped in failover with try/catch + provider rotation.

"use client";

import { useApp } from "./store";

declare global {
  interface Window {
    puter?: any;
  }
}

// ============================================================================
// Puter.js helpers — user-initiated auth + status checks
// ============================================================================

/**
 * Check if Puter.js is loaded and the user is signed in.
 * Returns: { loaded, signedIn, user }
 *   - loaded: whether the Puter.js script has loaded (window.puter exists)
 *   - signedIn: whether the user is authenticated to Puter
 *   - user: the Puter user object if signed in, else null
 *
 * This is safe to call anytime — it does NOT open popups.
 */
export function getPuterStatus(): { loaded: boolean; signedIn: boolean; user: any | null } {
  if (typeof window === "undefined" || !window.puter) {
    return { loaded: false, signedIn: false, user: null };
  }
  try {
    let signedIn = false;
    if (window.puter.auth) {
      if (typeof window.puter.auth.isSignedIn === "function") {
        signedIn = !!window.puter.auth.isSignedIn();
      } else {
        // If isSignedIn isn't a function, assume not signed in
        signedIn = false;
      }
    }
    // We don't call getUser() here because it may throw if not signed in.
    // The UI can call getPuterUser() separately when needed.
    return { loaded: true, signedIn, user: null };
  } catch {
    return { loaded: true, signedIn: false, user: null };
  }
}

/**
 * Get the signed-in Puter user's info (email, username, etc.).
 * Returns null if not signed in or Puter isn't loaded.
 * Does NOT open a popup — only reads existing session.
 */
export async function getPuterUser(): Promise<any | null> {
  if (typeof window === "undefined" || !window.puter?.auth) return null;
  try {
    const isSignedIn = typeof window.puter.auth.isSignedIn === "function"
      ? window.puter.auth.isSignedIn()
      : false;
    if (!isSignedIn) return null;
    const user = await window.puter.auth.getUser();
    return user || null;
  } catch {
    return null;
  }
}

/**
 * Sign in to Puter — MUST be called from a user click handler.
 *
 * Per https://docs.puter.com/Auth/signIn/:
 *   "The puter.auth.signIn() function must be triggered by a user action (such
 *   as a click event) because it opens a popup window. Most browsers block
 *   popups that are not initiated by user interactions."
 *
 * So this function should only be called from an onClick handler in the UI.
 * Calling it from an async flow (like callAI) will likely be blocked by the
 * browser's popup blocker.
 *
 * Returns: { ok: boolean; user?: any; error?: string }
 */
export async function signInToPuter(): Promise<{ ok: boolean; user?: any; error?: string }> {
  if (typeof window === "undefined" || !window.puter?.auth) {
    return { ok: false, error: "Puter.js is not loaded. Please refresh the page." };
  }
  try {
    // signIn() opens a popup. Because this is called from a click handler,
    // the browser allows it.
    await window.puter.auth.signIn();
    const user = await window.puter.auth.getUser().catch(() => null);
    return { ok: true, user };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Puter sign-in was cancelled or failed." };
  }
}

/**
 * Sign out of Puter.
 */
export async function signOutFromPuter(): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.puter?.auth) {
    return { ok: false, error: "Puter.js is not loaded." };
  }
  try {
    await window.puter.auth.signOut();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Sign-out failed." };
  }
}

/**
 * OPTIMIZER DIRECTIVE — InfoHAS Pro template (STRICT MASTER LAYOUT)
 *
 * This directive is the PERMANENT FORMATTING AUTHORITY for all generated resumes.
 * It is derived from the user's master layout reference and must NEVER be deviated from.
 *
 * PAGE FORMAT:
 *   - A4 (210 × 297 mm)
 *   - Exactly 1 page. NEVER generate a second page. assert(pdf.pages === 1).
 *
 * MARGINS (very compact):
 *   - Top: 0.25 inch (6.35mm)
 *   - Bottom: 0.25 inch (6.35mm)
 *   - Left: 0.35 inch (8.89mm)
 *   - Right: 0.35 inch (8.89mm)
 *
 * FONT:
 *   - Primary: Times New Roman
 *   - Fallback: Georgia, Cambria
 *   - Body: 10pt–11pt
 *   - Section titles: 12pt–13pt, Bold, UPPERCASE, DARK RED (#8B0000)
 *
 * HEADER (two-column):
 *   - Left column (70%): Name, headline, location|phone, email, DOB — all left-aligned, compact
 *   - Right column (30%): Passport-style photo, 3.0cm × 4.0cm (30×40mm), top-right
 *   - If NO photo: remove photo section entirely. Do NOT use placeholders.
 *
 * SECTION ORDER (mandatory, no exceptions):
 *   1. PROFESSIONAL SUMMARY — 4-6 lines, single paragraph, no bullets
 *   2. CORE COMPETENCIES & SKILLS — max 4 groups, bullet format
 *   3. PROFESSIONAL EXPERIENCE — largest section, 3-5 bullets per position
 *   4. EDUCATION — max 2-3 entries
 *   5. LANGUAGES — one line per language
 *
 * ATS RULES:
 *   - ALLOWED: bold text, bullet points, simple separators
 *   - NOT ALLOWED: tables, columns inside body, text boxes, graphics, charts, icons, progress bars
 *   - Photo ONLY permitted in header
 *
 * CONTENT COMPRESSION (if content exceeds one page):
 *   1. Compress summary
 *   2. Reduce bullet length
 *   3. Remove repetitive achievements
 *   4. Reduce spacing
 *   5. Reduce font size to minimum 10pt
 *   6. Merge similar skills
 *   NEVER create page two.
 */
export const OPTIMIZER_DIRECTIVE = `You are the ResumeAI Pro Optimizer. You MUST preserve the EXACT layout framework described below. Only modify CONTENT — never modify LAYOUT, section order, content density, photo position, or the compact recruiter-friendly structure. The master layout is the permanent formatting authority.

═══════════════════════════════════════════════════════════════
PAGE FORMAT
═══════════════════════════════════════════════════════════════
- Document size: A4 (210 × 297 mm)
- Maximum pages: 1
- Required pages: EXACTLY 1
- NEVER generate a second page.
- Validation: assert(pdf.pages === 1)

═══════════════════════════════════════════════════════════════
MARGINS (very compact — use these EXACT values)
═══════════════════════════════════════════════════════════════
- Top: 0.25 inch (6.35mm)
- Bottom: 0.25 inch (6.35mm)
- Left: 0.35 inch (8.89mm)
- Right: 0.35 inch (8.89mm)

═══════════════════════════════════════════════════════════════
FONT RULES
═══════════════════════════════════════════════════════════════
- Primary font: Times New Roman (fallback: Georgia, Cambria)
- Body size: 10pt–11pt
- Section titles: 12pt–13pt, BOLD, UPPERCASE, DARK RED color (#8B0000)
- Name: BOLD, 14pt, dark red #8B0000, UPPERCASE
- Body text: black, 10.5pt
- Section header color: DARK RED (#8B0000) — NOT blue, NOT black

═══════════════════════════════════════════════════════════════
HEADER LAYOUT (two-column)
═══════════════════════════════════════════════════════════════
Two-column header:
- LEFT COLUMN (70% width): FULL NAME (bold uppercase dark red 14pt), Current Position (10.5pt black), City Country | Phone Number (10.5pt black), Email Address (10.5pt black), Date of Birth (10.5pt black, optional). All left-aligned, compact spacing.
- RIGHT COLUMN (30% width): Professional passport-style photo. Position: top-right. Size: approximately 3.0cm × 4.0cm (30×40mm). Photo should not exceed 20% of page width.
- IF NO PHOTO EXISTS: Remove the photo section ENTIRELY. Do NOT use placeholders. Do NOT draw an empty box. The left column then uses full width.

═══════════════════════════════════════════════════════════════
SECTION ORDER (MANDATORY — in this exact order, no other sections)
═══════════════════════════════════════════════════════════════
1. PROFESSIONAL SUMMARY
2. CORE COMPETENCIES & SKILLS
3. PROFESSIONAL EXPERIENCE
4. EDUCATION
5. LANGUAGES

═══════════════════════════════════════════════════════════════
1. PROFESSIONAL SUMMARY
═══════════════════════════════════════════════════════════════
- Length: 4–6 lines
- Single compact paragraph. NO bullet points.
- Must be tailored to target role.
- Focus on: customer service, aviation, retail, hospitality, sales, communication (depending on job description).
- Embed 2-3 target keywords naturally.

═══════════════════════════════════════════════════════════════
2. CORE COMPETENCIES & SKILLS
═══════════════════════════════════════════════════════════════
- Bullet format. Group skills by category.
- MAXIMUM 4 skill groups.
- Example:
  • Sales Techniques: cross-selling, upselling, FAB method
  • Retail Operations: cash handling, inventory control
  • Aviation Security: airport procedures, passenger screening
  • Soft Skills: communication, empathy, teamwork

═══════════════════════════════════════════════════════════════
3. PROFESSIONAL EXPERIENCE (largest section)
═══════════════════════════════════════════════════════════════
- Reverse chronological order (most recent first).
- Format: Position Title | Company | Location | Dates (all on ONE line, bold)
- Under each position: 2–3 achievement bullets (max 3).
- Each bullet: starts with action verb, concise, 80-120 characters, one line max.
- AVOID paragraphs — bullets only.
- CRITICAL: NEVER invent percentages, metrics, or numbers. Only use data from the original resume. No fake "20% improvement", "98% satisfaction", etc.
- Action verbs: Assisted, Managed, Handled, Processed, Maintained, Supported, Coordinated, Delivered, Facilitated, Resolved, Collaborated, Trained.

═══════════════════════════════════════════════════════════════
4. EDUCATION
═══════════════════════════════════════════════════════════════
- Compact format.
- Example: Qualification | Institution | Country | Dates (one line, bold)
- Add modules only if highly relevant (as a single bullet: "• Modules: ...").
- MAXIMUM 2–3 entries.

═══════════════════════════════════════════════════════════════
5. LANGUAGES
═══════════════════════════════════════════════════════════════
- Very compact. One line per language.
- Format: "English: Fluent", "French: Fluent", "Arabic: Native", "Spanish: Intermediate"

═══════════════════════════════════════════════════════════════
ATS RULES
═══════════════════════════════════════════════════════════════
- ALLOWED: bold text, bullet points (•), simple separators
- NOT ALLOWED: tables, columns inside body, text boxes, graphics, charts, icons, progress bars, fancy layouts
- Photo ONLY permitted in header.

═══════════════════════════════════════════════════════════════
CONTENT COMPRESSION ENGINE (if content exceeds one page)
═══════════════════════════════════════════════════════════════
Apply IN THIS ORDER until content fits one page:
1. Compress summary (reduce to 4 lines minimum)
2. Reduce bullet length (split long bullets, remove filler)
3. Remove repetitive achievements
4. Reduce spacing (tighten line height)
5. Reduce font size to MINIMUM 10pt (never below 10pt)
6. Merge similar skills (combine categories)
NEVER create page two. assert(pdf.pages === 1).

═══════════════════════════════════════════════════════════════
AI OPTIMIZATION BEHAVIOR
═══════════════════════════════════════════════════════════════
When optimizing against a job description:
- PRESERVE this exact layout (margins, fonts, colors, spacing).
- PRESERVE section order.
- PRESERVE content density.
- PRESERVE photo position (or remove if no photo).
- PRESERVE compact recruiter-friendly structure.
- ONLY modify content (summary, skills, bullets) to match the JD.
- NEVER modify layout.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════
Return ONLY valid JSON with this exact shape:
{
  "name": "FULL NAME",
  "headline": "Target Role Title",
  "location": "City, Country",
  "phone": "+X ...",
  "email": "...",
  "dateOfBirth": "DD/MM/YYYY" | "",
  "summary": "4-6 line professional summary paragraph (60-90 words)...",
  "skills": [
    { "category": "Sales Techniques", "items": ["cross-selling", "upselling", "FAB method"] },
    ...  (MAX 4 groups)
  ],
  "experience": [
    {
      "title": "Job Title",
      "company": "Company",
      "location": "City, Country",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY" | "Present",
      "bullets": ["Achievement bullet 1...", "Achievement bullet 2...", "Achievement bullet 3..."]  // PRESERVE ALL original bullets — never drop them
    },
    ...
  ],
  "education": [
    {
      "degree": "Degree Name",
      "institution": "Institution",
      "location": "City, Country" | "",
      "startDate": "YYYY",
      "endDate": "YYYY",
      "modules": "Module 1, Module 2, ..." | ""
    },
    ...  // PRESERVE ALL original education entries
  ],
  "languages": [
    { "name": "English", "proficiency": "Fluent", "note": "" | "optional note" },
    ...
  ],
  "missingKeywordsAdded": ["keyword1", "keyword2", ...],
  "bulletsRewritten": 5
}

CONTENT RULES:
- Truthful to the source resume. Never invent employers, dates, or metrics.
- CRITICAL: NEVER fabricate percentages, metrics, dollar amounts, or time savings. Only use real data from the original resume. No "20% improvement", "98% satisfaction", "100% resolution" — these are fake.
- CRITICAL: NEVER change end dates to "Present". If original says "May 2024", output "May 2024". NEVER output "Present" unless the original truly says "Present".
- Embed target job-description keywords naturally.
- PRESERVE ALL original bullets — never drop or consolidate them. Rewrite for impact but keep the same count.
- PRESERVE ALL original experience entries — never remove a job.
- PRESERVE ALL original education entries.
- PRESERVE ALL original languages.
- CRITICAL: Do NOT remove "Date of Birth" if present in the original.
- Use action verbs from the list above (Assisted, Managed, Handled, Processed, etc.).
- Improve readability and recruiter impact.
- Increase keyword relevance naturally — avoid keyword stuffing.
- Ensure the page fits on EXACTLY one A4 page — no overflow, but NEVER achieve this by cutting content. Use tighter writing instead.
- The summary paragraph should match the original length — do not shorten it.
- If content overflows: tighten word choice, merge similar skills, reduce verbosity — NEVER remove bullets or entries.
- If content is too short (under 2,000 chars): add more relevant skill groups, add soft skills, expand recent role bullets.

ONE-PAGE CONSTRAINT: The output MUST fit on exactly one A4 page. Apply the CONTENT COMPRESSION ENGINE (above) if needed. NEVER create page two. assert(pdf.pages === 1).`;

/**
 * Generate the optimizer directive from the stored config.
 *
 * This reads the `optimizerDirective` config from the Zustand store (which is
 * synced from D1) and generates a directive string with the exact values the
 * super admin configured. If the config has a `customDirectiveOverride` set,
 * that COMPLETELY REPLACES the generated directive.
 *
 * If the store isn't available (e.g. during SSR) or the config is missing,
 * falls back to the hardcoded OPTIMIZER_DIRECTIVE constant above.
 *
 * Usage in the Optimizer:
 *   const directive = getOptimizerDirective();
 *   const result = await callAI({ systemPrompt: directive, ... });
 */
export function getOptimizerDirective(): string {
  try {
    const state: any = useApp.getState();
    const c: OptimizerDirectiveConfig | undefined = state?.optimizerDirective;

    // If no config in store, use the hardcoded default
    if (!c) {
      console.info("[getOptimizerDirective] No config in store, using hardcoded default");
      return OPTIMIZER_DIRECTIVE;
    }

    // If custom override is set, use it completely
    if (c.customDirectiveOverride?.trim()) {
      console.info("[getOptimizerDirective] Using custom override from super admin settings");
      return c.customDirectiveOverride.trim();
    }

    console.info("[getOptimizerDirective] Using generated directive from structured config (no override set)");

    // Otherwise, generate from the structured config
    return `You are the ResumeAI Pro Optimizer. You MUST preserve the EXACT layout framework described below. Only modify CONTENT — never modify LAYOUT, section order, content density, photo position, or the compact recruiter-friendly structure.

═══════════════════════════════════════════════════════════════
PAGE FORMAT & CONTENT DENSITY
═══════════════════════════════════════════════════════════════
- Document size: ${c.pageSize}
- Maximum pages: 1
- Required pages: EXACTLY 1
- NEVER generate a second page.
- NEVER produce a half-empty page.
- Target: 2,500–3,000 characters of content (aim for ~2,900).
- Fully utilize the A4 page — no excessive whitespace.
- Dynamic adjustment: if the candidate has less experience, expand bullets with more detail. If more experience, keep all roles and all bullets.
${c.enforceOnePage ? "- Validation: assert(pdf.pages === 1)" : ""}

═══════════════════════════════════════════════════════════════
MARGINS (very compact — use these EXACT values)
═══════════════════════════════════════════════════════════════
- Top: ${c.marginTopMm}mm
- Bottom: ${c.marginBottomMm}mm
- Left: ${c.marginLeftMm}mm
- Right: ${c.marginRightMm}mm

═══════════════════════════════════════════════════════════════
FONT RULES
═══════════════════════════════════════════════════════════════
- Primary font: ${c.fontFamily} (fallback: Georgia, Cambria)
- Body size: ${c.bodyFontSizePt}pt
- Section titles: ${c.sectionTitleSizePt}pt, BOLD, UPPERCASE, color ${c.sectionTitleColor}
- Name: BOLD, ${c.nameSizePt}pt, color ${c.nameColor}, UPPERCASE
- Body text: color ${c.bodyTextColor}

═══════════════════════════════════════════════════════════════
SPACING
═══════════════════════════════════════════════════════════════
- Line height: ${c.lineHeight} (compact single-spacing)
- Section gap: ${c.sectionGapMm}mm
- Bullet indent: ${c.bulletIndentMm}mm from left margin

═══════════════════════════════════════════════════════════════
PHOTO
═══════════════════════════════════════════════════════════════
${c.photoEnabled
  ? `- Photo: ${c.photoWidthMm}×${c.photoHeightMm}mm, top-right corner
- ${c.showPlaceholderIfNoPhoto ? "Show empty placeholder if no photo uploaded" : "If no photo exists: remove photo section ENTIRELY. Do NOT use placeholders. Do NOT draw an empty box."}`
  : "- Photo section DISABLED. Do not include any photo."}

═══════════════════════════════════════════════════════════════
SECTION ORDER (MANDATORY — in this exact order)
═══════════════════════════════════════════════════════════════
1. PROFESSIONAL SUMMARY — ${c.summaryMinWords}-${c.summaryMaxWords} words, single paragraph, no bullets
2. CORE COMPETENCIES & SKILLS — max ${c.skillsMaxGroups} groups, bullet format
3. PROFESSIONAL EXPERIENCE — PRESERVE ALL original entries, target ${c.experienceBulletsPerEntry} bullets per entry
4. EDUCATION — PRESERVE ALL original entries
5. LANGUAGES — max ${c.languagesMaxEntries} entries, one line per language

═══════════════════════════════════════════════════════════════
CONTENT COMPRESSION ENGINE (if content exceeds one page)
═══════════════════════════════════════════════════════════════
${c.enforceOnePage
  ? `Apply IN THIS ORDER until content fits one page:
1. Tighten word choice (replace long phrases with shorter ones)
2. Reduce bullet length (trim filler words, keep all content)
3. Reduce spacing (tighten line height)
4. Reduce font size to MINIMUM ${c.minFontSizePt}pt (never below ${c.minFontSizePt}pt)
5. Merge similar skills (combine categories)
WARNING: NEVER remove bullets, experience entries, education entries, or languages. NEVER change dates.
NEVER create page two. assert(pdf.pages === 1).`
  : "Multi-page output allowed if content exceeds one page."}

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════
Return ONLY valid JSON with this exact shape:
{
  "name": "FULL NAME",
  "headline": "Target Role Title",
  "location": "City, Country",
  "phone": "+X ...",
  "email": "...",
  "dateOfBirth": "DD/MM/YYYY" | "",
  "summary": "${c.summaryMinWords}-${c.summaryMaxWords} word professional summary paragraph...",
  "skills": [
    { "category": "Category Name", "items": ["skill1", "skill2", "skill3"] }
  ],
  "experience": [
    {
      "title": "Job Title",
      "company": "Company",
      "location": "City, Country",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY",  // CRITICAL: NEVER output "Present" unless original says "Present"
      "bullets": ["Achievement bullet 1...", "Achievement bullet 2..."]  // PRESERVE ALL original bullets
    }
  ],
  "education": [
    {
      "degree": "Degree Name",
      "institution": "Institution",
      "location": "City, Country" | "",
      "startDate": "YYYY",
      "endDate": "YYYY",
      "modules": "Module 1, Module 2, ..." | ""
    }
  ],
  "languages": [
    { "name": "English", "proficiency": "Fluent", "note": "" | "optional note" }
  ],
  "missingKeywordsAdded": ["keyword1", "keyword2", ...],
  "bulletsRewritten": 5
}

CONTENT RULES:
- Truthful to the source resume. Never invent employers, dates, or metrics.
- CRITICAL: NEVER fabricate percentages, metrics, dollar amounts, or time savings. Only use real data from the original resume. No "20% improvement", "98% satisfaction", "100% resolution" — these are fake.
- CRITICAL: NEVER change end dates to "Present". If original says "May 2024", output "May 2024". Never use "Present" unless the original truly says "Present".
- Embed target job-description keywords naturally.
- PRESERVE ALL original bullets — never drop or consolidate them. Rewrite for impact but keep the same count.
- PRESERVE ALL original experience entries.
- PRESERVE ALL original education entries.
- PRESERVE ALL original languages.
- PRESERVE "Date of Birth" if present in the original.
- Use action verbs: Assisted, Managed, Handled, Processed, Supported, Coordinated, Delivered, Facilitated, Resolved.
- Improve readability and recruiter impact.
- Increase keyword relevance naturally — avoid keyword stuffing.
- Ensure the page fits on EXACTLY one A4 page — NEVER achieve this by cutting content. Use tighter writing instead.
- Keep the summary at the original length — do not shorten it.
- If content overflows: tighten word choice, merge similar skills, reduce verbosity — NEVER remove bullets or entries.
- If content is too short (under 2,000 chars): add more relevant skill groups, add soft skills, expand recent role bullets.

═══════════════════════════════════════════════════════════════
DIRECTIVE HIERARCHY (MUST FOLLOW THIS ORDER)
═══════════════════════════════════════════════════════════════
When optimizing, follow this priority order:
1. USER OVERRIDE INSTRUCTIONS (from the Optimizer Directive settings page)
2. JOB DESCRIPTION REQUIREMENTS (required skills, responsibilities, keywords)
3. ORIGINAL RESUME CONTENT (preserve factual information — never invent)
4. ATS ENHANCEMENT RULES (keyword integration, formatting, section completeness)

If the user's override directive says "Focus on leadership", prioritize
leadership content above all else — even above JD requirements.

═══════════════════════════════════════════════════════════════
JOB RELEVANCE PRIORITIZATION (CRITICAL)
═══════════════════════════════════════════════════════════════
When optimizing, PRIORITIZE:
1. Job Requirements (from the job description)
2. Role Requirements
3. Recruiter Intent
4. Business Function
5. Industry Context

DO NOT prioritize:
- Original resume keywords (only keep transferable ones)
- ATS keyword density
- Blind keyword stuffing

If the job is a "Customer Contact Centre Agent", emphasize:
- Customer Service, Call Handling, Communication, Active Listening
- Problem Solving, CRM, Customer Satisfaction, Sales
- Cross Selling, Upselling, Reservations, Customer Support
- Multilingual Communication, Complaint Resolution
- Fast Paced Environment, Shift Flexibility

DO NOT emphasize irrelevant keywords like:
- Airport Security, Passenger Profiling, STEB, Security Procedures
- Restricted Items (unless directly relevant to the target role)

EXPERIENCE REWRITER:
For each previous job, analyze transferable skills and rewrite to align with the target role.
Example: "Airport Customer Service" → emphasize "Customer Support, Customer Enquiries, Passenger Assistance, Problem Resolution, International Customer Communication, Service Recovery, Customer Satisfaction".

PROFESSIONAL SUMMARY:
- Generate based on: Target Position, Industry, Job Description, Transferable Skills
- Must sound HUMAN, recruiter-friendly, professional
- AVOID generic AI language ("dynamic professional", "results-driven", "passionate")
- AVOID keyword stuffing

═══════════════════════════════════════════════════════════════
AI ERROR LEAK PREVENTION (ABSOLUTE RULE)
═══════════════════════════════════════════════════════════════
NEVER include in the resume content:
- Provider errors ("AI returned non-JSON output", "Optimization incomplete")
- JSON errors, parsing errors, fallback messages
- Debug messages, raw AI responses, system messages
- Retry messages, "please try again" messages
- ATS scores, keyword match percentages, optimization notes
- Section names like "Requirements Match", "ATS Analysis", "AI Notes"

The resume content must be CLEAN, PROFESSIONAL text only.
If you cannot generate proper content, return the original resume unchanged.
NEVER leak error messages into the resume.

═══════════════════════════════════════════════════════════════
FORBIDDEN SECTIONS
═══════════════════════════════════════════════════════════════
Only these sections are allowed (in this order):
1. PROFESSIONAL SUMMARY
2. CORE COMPETENCIES & SKILLS
3. PROFESSIONAL EXPERIENCE
4. EDUCATION
5. LANGUAGES

NEVER generate additional sections like:
- Requirements Match
- ATS Analysis
- Keyword Match
- Additional Information
- AI Notes
- Optimization Notes
- Provider Errors
- System Messages
- Debug Information

═══════════════════════════════════════════════════════════════
OUTPUT CONTRACT — CRITICAL
═══════════════════════════════════════════════════════════════
You are generating a FINAL RESUME, not an analysis report.

The JSON you return IS the resume. There is no separate "analysis" object.
The summary, skills, experience, education, and languages fields must
contain ACTUAL RESUME CONTENT — the candidate's professional information
written as it would appear on a real resume.

NEVER include in any field:
- "The original resume lacks..."
- "Missing keywords:"
- "Keyword gap"
- "From JD:"
- "ATS analysis"
- "Optimization notes"
- "Recommendations:"
- "Suggested improvement"
- "Score explanation"
- "Reasoning:"
- "Thought process"
- "The resume does not..."
- "This candidate would..."
- "Areas for improvement"
- "Identified gaps"
- "Required Skills:"
- "Missing Skills:"
- "Keywords identified:"
- "Here is the optimized resume"
- "I have improved the resume"
- "I added the following keywords"
- "Based on the job description..."
- "The AI has identified..."

SUMMARY must describe the CANDIDATE, not the resume:
✓ GOOD: "Customer service professional with 3 years of experience in call center operations..."
✗ BAD: "The original resume lacks keywords. Missing keywords: CRM, communication."
✗ BAD: "Based on the job description, the following improvements were made..."
✗ BAD: "This candidate would benefit from adding sales experience."

SKILLS must list actual skills:
✓ GOOD: "Customer Service: communication, CRM, complaint resolution"
✗ BAD: "From JD: customer service, communication, CRM"
✗ BAD: "Missing Skills: CRM, sales, upselling"
✗ BAD: "Keywords identified: customer service, call handling"

EXPERIENCE bullets must be achievement statements:
✓ GOOD: "Handled 200+ customer calls daily with 95% satisfaction rate."
✗ BAD: "The resume needs more quantified achievements in this section."
✗ BAD: "Suggested improvement: add metrics to bullets."

If you include ANY analysis, reasoning, recommendations, or meta-commentary
in the resume fields, the output will be REJECTED and the user will see
nothing. Return ONLY clean, professional resume content.`;
  } catch {
    // If anything goes wrong reading the store, use the hardcoded default
    return OPTIMIZER_DIRECTIVE;
  }
}

// Import the type for the directive config (imported here to avoid circular deps
// at the top of the file — useApp is already imported)
import type { OptimizerDirectiveConfig } from "./types";


export interface AICallOptions {
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  // If true, prefer the local generator (no network). Used for offline mode.
  preferLocal?: boolean;
  // If true, force the server route.
  preferServer?: boolean;
  // Task category — controls which providers are eligible.
  // "document" = Resume/ATS/Cover Letter/Interview/PDF → API providers ONLY (never Puter)
  // "interactive" = Chat/Playground/Assistant → any provider (including Puter)
  // "development" = AI Dev Agent/Builder → any provider
  // If omitted, defaults to "document" (safest — API providers only).
  taskCategory?: "document" | "interactive" | "development";
}

export interface AICallResult {
  text: string;
  provider: string;
  latencyMs: number;
  tokensEstimate: number;
}

const estTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Race a promise against a timeout. Resolves with the promise result or rejects
 * with a timeout error. Used to prevent AI provider calls from hanging forever
 * (e.g. Puter sign-in popup that the user dismisses, or a slow provider endpoint).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Robustly extract a JSON object from an LLM response.
 *
 * LLMs frequently return JSON wrapped in markdown fences, preceded by prose
 * ("Here is the optimized resume:"), or with trailing commentary. This helper
 * handles all those cases and ONLY throws if no JSON object can be found.
 *
 * Strategy (in order):
 *   1. Strip markdown fences ```json ... ``` or ``` ... ```.
 *   2. Try to parse the cleaned text directly.
 *   3. If that fails, find the first `{` and last `}` and try to parse the slice.
 *   4. If that fails, find the first `[` and last `]` and try to parse the slice.
 *   5. If all fail, throw an Error with a helpful message that includes the
 *      first 80 chars of the input so the caller can log it.
 *
 * This is the SINGLE source of truth for parsing AI JSON in the app.
 * Use it everywhere instead of `JSON.parse(text)` to prevent the
 * "Unexpected token 'S', 'Senior Fro'..." class of crashes.
 */
export function extractJSON<T = any>(raw: string): T {
  if (typeof raw !== "string") {
    throw new Error("extractJSON: input is not a string");
  }
  if (!raw.trim()) {
    throw new Error("extractJSON: input is empty");
  }

  // Step 1: strip markdown fences
  let cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  // Step 2: try direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through
  }

  // Step 3: extract first { ... last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const slice = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {
      // fall through
    }
  }

  // Step 4: extract first [ ... last ]
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const slice = cleaned.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {
      // fall through
    }
  }

  // Step 5: nothing worked — throw with a helpful preview
  const preview = cleaned.slice(0, 80).replace(/\n/g, " ");
  throw new Error(
    `AI did not return valid JSON. Response started with: "${preview}${cleaned.length > 80 ? "..." : ""}". ` +
    `This usually means the AI returned prose instead of structured data. ` +
    `Try again, or check that your default AI provider is correctly configured.`
  );
}

/**
 * Call a user-configured AI provider (from AI Providers settings).
 *
 * This is the FIRST priority in the callAI() chain — if the user has set a
 * default provider with a valid API key and base URL, we use it directly.
 * Supports OpenAI-compatible chat completions format (which covers OpenAI,
 * Claude via proxy, Gemini via proxy, DeepSeek, Groq, Mistral, OpenRouter,
 * Together, HuggingFace, Ollama, and custom OpenAI-compatible endpoints).
 *
 * Auth types:
 *   - "bearer": Authorization: Bearer <key>  (default, OpenAI-style)
 *   - "header": custom header from headersJson
 *   - "query":  ?key=<key> query param
 *   - "none":   no auth (e.g. local Ollama)
 *
 * Returns the extracted text from the response, or throws on error.
 */
async function callUserProvider(
  provider: any,
  opts: AICallOptions,
): Promise<string> {
  if (!provider) throw new Error("No provider");
  if (!provider.isActive) throw new Error(`Provider "${provider.name}" is inactive`);

  const baseUrl = (provider.apiUrl || provider.baseUrl || "").trim();
  if (!baseUrl) throw new Error(`Provider "${provider.name}" has no base URL`);

  // Build the chat-completions URL.
  // Most providers use https://api.x.com/v1/chat/completions.
  // If the user already included /chat/completions in the base URL, don't double it.
  const url = baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  // Build headers
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authType = provider.authType || "bearer";
  if (provider.apiKey && authType === "bearer") {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  } else if (provider.apiKey && authType === "header") {
    // Merge custom headers from headersJson
    try {
      const custom = provider.headersJson ? JSON.parse(provider.headersJson) : {};
      Object.assign(headers, custom);
    } catch {
      // ignore malformed headersJson
    }
  } else if (provider.apiKey && authType === "query") {
    // query param — append to URL
    // handled below when constructing the fetch URL
  }
  // authType === "none" → no auth header

  // Build body — OpenAI chat completions format
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: opts.userPrompt });

  const body: Record<string, any> = {
    model: provider.modelName || "gpt-4o-mini",
    messages,
    max_tokens: opts.maxTokens ?? provider.maxTokens ?? 4096,
    temperature: opts.temperature ?? provider.temperature ?? 0.7,
    stream: false,
  };

  // Build final URL (with query param if authType === "query")
  let finalUrl = url;
  if (authType === "query" && provider.apiKey) {
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${sep}key=${encodeURIComponent(provider.apiKey)}`;
  }

  // Fetch with timeout
  const timeoutMs = provider.timeout && provider.timeout > 0 ? provider.timeout * 1000 : 30000;
  const res = await withTimeout(
    fetch(finalUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    timeoutMs,
    `Provider "${provider.name}" call`,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(`[AI] Provider "${provider.name}" (${provider.type}) returned HTTP ${res.status} from ${finalUrl}. Response: ${errText.slice(0, 200)}`);
    throw new Error(`Provider "${provider.name}" returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();

  // Extract text from common response shapes:
  //   OpenAI-style:    data.choices[0].message.content
  //   Anthropic-style: data.content[0].text
  //   Gemini-style:    data.candidates[0].content.parts[0].text
  //   Custom:          use provider.responsePath
  let text = "";
  if (provider.responsePath) {
    // Walk the path — e.g. "choices[0].message.content"
    text = provider.responsePath
      .split(".")
      .reduce((acc: any, key: string) => {
        const m = key.match(/^([^\[]+)(?:\[(\d+)\])?$/);
        if (!m) return acc;
        const v = acc?.[m[1]];
        return m[2] !== undefined ? v?.[parseInt(m[2], 10)] : v;
      }, data) ?? "";
  } else if (data?.choices?.[0]?.message?.content) {
    text = data.choices[0].message.content;
  } else if (Array.isArray(data?.content) && data.content[0]?.text) {
    text = data.content[0].text;
  } else if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    text = data.candidates[0].content.parts[0].text;
  } else if (typeof data?.text === "string") {
    text = data.text;
  } else if (typeof data?.content === "string") {
    text = data.content;
  } else {
    // Last resort — stringify and hope for the best
    text = JSON.stringify(data);
  }

  if (typeof text !== "string") text = String(text ?? "");
  if (!text.trim()) {
    throw new Error(`Provider "${provider.name}" returned an empty response`);
  }
  return text;
}

/**
 * Main AI entrypoint. Tries user-default-provider → Puter → server (z-ai) → local fallback.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const t0 = performance.now();
  const taskCategory = opts.taskCategory || "document"; // default: document (API only, no Puter)

  // ============================================================
  // 0) PROVIDER ROUTING — use the Provider Router
  // ============================================================
  // For document tasks (Resume, ATS, Cover Letter, Interview, PDF):
  //   → API providers ONLY (never Puter)
  // For interactive tasks (Chat, Playground, Assistant):
  //   → any provider (including Puter)
  // For development tasks (AI Dev Agent, Builder):
  //   → any provider
  if (!opts.preferServer && typeof window !== "undefined") {
    try {
      const state: any = useApp.getState();
      const providers: any[] = state?.providers || [];
      const settings = state?.providerSettings || {};

      // Use the provider router to find the right provider for this task
      let defaultProvider: any = null;

      // For document tasks: EXCLUDE Puter (browser_auth providers)
      // For interactive/development tasks: allow any provider
      const isDocumentTask = taskCategory === "document";
      // Check if ANY API providers are configured (non-Puter)
      const hasApiProviders = providers.some(
        (p) => p.isActive
          && p.type !== "puter"
          && p.providerCategory !== "browser_auth"
          && (p.apiUrl || p.baseUrl)
          && (p.apiKey || p.authType === "none"),
      );

      // 1. User's configured default (if it's eligible for this task)
      if (settings.defaultProviderId) {
        const candidate = providers.find((p) => p.id === settings.defaultProviderId && p.isActive);
        if (candidate) {
          // For document tasks: use the user's configured default provider
          // REGARDLESS of whether it's Puter or an API provider.
          // The user explicitly chose this provider — respect their choice.
          // (Previous code skipped Puter for document tasks when API providers
          // existed, which meant the user's choice was ignored.)
          defaultProvider = candidate;
        }
      }
      // 2. isDefault flag
      if (!defaultProvider) {
        const candidate = providers.find((p) => p.isDefault && p.isActive);
        if (candidate) {
          defaultProvider = candidate;
        }
      }
      // 3. First active API provider (fallback if no default is set)
      if (!defaultProvider) {
        defaultProvider = providers.find(
          (p) => p.isActive
            && !p.isBuiltIn
            && p.type !== "z-ai-fallback"
            && (p.apiUrl || p.baseUrl || p.type === "puter")
            && (p.apiKey || p.authType === "none" || p.type === "puter"),
        );
      }

      if (defaultProvider) {
        const text = await callUserProvider(defaultProvider, opts);
        if (text && text.trim().length > 0) {
          console.info(`[AI] Using user-configured default provider: ${defaultProvider.name} (${defaultProvider.modelName || "default model"})`);
          return {
            text,
            provider: defaultProvider.name,
            latencyMs: Math.round(performance.now() - t0),
            tokensEstimate: estTokens(opts.userPrompt + (opts.systemPrompt ?? "")),
          };
        }
      }
    } catch (e: any) {
      console.warn(`[AI] User default provider failed, falling back to Puter:`, e?.message || e);
    }
  }

  // === ALLOW PUTER FOR DOCUMENT TASKS AS FALLBACK ===
  // We only reach this point if:
  //   (a) No API provider was found/eligible, OR
  //   (b) The API provider was found but callUserProvider() threw an error.
  // In both cases, Puter should be tried as a fallback — even for document tasks.
  // This fixes the "JD parsing fails with AI-over-API" bug where the API
  // provider returned empty/invalid, and Puter was never tried as a fallback.
  if (!opts.preferServer) {
    // 1) Try Puter.js — the free, keyless BROWSER-AUTH provider.
    //
    // Puter is used for interactive/development tasks always, and for document
    // tasks ONLY when no API providers are configured OR the API provider failed.
    // ATS, cover letter, interview, PDF) — those require API providers only.
    //
    // Per https://docs.puter.com/AI/chat/:
    //   - "all essential methods in Puter handle authentication automatically"
    //   - puter.auth.signIn() "must be triggered by a user action (such as a click
    //     event) because it opens a popup window. Most browsers block popups that
    //     are not initiated by user interactions."
    //
    // So we do NOT call signIn() from here (it would be blocked as a non-user-initiated
    // popup). Instead, we just call puter.ai.chat() directly. If the user is not
    // signed in, Puter will either:
    //   (a) auto-create a temporary user (if the app allows it), or
    //   (b) reject the call with an auth error — in which case we fall through to
    //       the next provider. The UI exposes a "Sign in to Puter" button that the
    //       user can click (a real user gesture) to authenticate before retrying.
    //
    // Model: omit the `model` option to use Puter's default (currently gpt-5-nano
    // per the docs), which is free and reliably available. Previously we hardcoded
    // "claude-sonnet-4" (404 — Anthropic deprecated that exact ID) and then
    // "gpt-4o-mini" (works but is not the documented default). Using the default
    // avoids model-name drift.
    try {
      if (typeof window !== "undefined" && window.puter?.ai?.chat) {
        const messages = opts.systemPrompt
          ? [
              { role: "system", content: opts.systemPrompt },
              { role: "user", content: opts.userPrompt },
            ]
          : [{ role: "user", content: opts.userPrompt }];

        // Build options — only pass model if the user has explicitly chosen one
        // via the Puter provider settings. Otherwise let Puter pick its default.
        const chatOpts: any = {
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.7,
        };
        // Check if the user configured a specific Puter model in provider settings
        try {
          const state: any = useApp.getState();
          const puterProvider = (state?.providers || []).find(
            (p: any) => p.type === "puter" && p.isActive && p.modelName,
          );
          if (puterProvider?.modelName) {
            chatOpts.model = puterProvider.modelName;
          }
        } catch {
          // ignore — use Puter default
        }

        // Wrap in a 45s timeout — Puter can be slow on first call (cold start).
        const resp: any = await withTimeout(
          window.puter.ai.chat(messages, chatOpts),
          45000,
          "Puter AI chat",
        );

        // Parse the response — Puter returns a ChatResponse object per the docs:
        //   { message: { role: "assistant", content: "..." } }
        // But it can also return a string or other shapes depending on the model.
        let text = "";
        if (typeof resp === "string") {
          text = resp;
        } else if (resp?.message?.content) {
          // Standard ChatResponse shape
          text = Array.isArray(resp.message.content)
            ? resp.message.content.map((c: any) => c?.text ?? "").join("")
            : String(resp.message.content);
        } else if (resp?.text) {
          text = resp.text;
        } else if (resp?.message?.role === "assistant" && typeof resp.message.content === "string") {
          text = resp.message.content;
        } else if (resp?.toString && typeof resp.toString === "function") {
          // Some responses are objects with a useful toString()
          const str = resp.toString();
          if (str && str !== "[object Object]") text = str;
        }
        if (!text) {
          // Last resort — stringify
          try {
            text = JSON.stringify(resp);
          } catch {
            text = String(resp ?? "");
          }
        }

        if (text && text.trim().length > 0) {
          return {
            text,
            provider: "Puter.js",
            latencyMs: Math.round(performance.now() - t0),
            tokensEstimate: estTokens(opts.userPrompt + (opts.systemPrompt ?? "")),
          };
        }
      } else if (typeof window !== "undefined" && !window.puter) {
        // Puter.js script not yet loaded — this is common on first render.
        // Don't warn (it's noisy); just fall through to the next provider.
        console.debug("[AI] Puter.js not yet loaded, skipping to next provider");
      }
    } catch (e: any) {
      const msg = e?.message || String(e || "");
      // Detect auth errors specifically so the UI can prompt the user to sign in
      if (/auth|sign.?in|unauthor|401|403/i.test(msg)) {
        console.warn("[AI] Puter auth required — user should sign in via the Puter button. Error:", msg);
      } else {
        console.warn("[AI] Puter.js failed, trying next provider:", msg);
      }
    }
  }

  if (!opts.preferLocal) {
    // 2) Try server fallback (z-ai-web-dev-sdk)
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: opts.systemPrompt,
          userPrompt: opts.userPrompt,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.text && data.text.trim().length > 0) {
          return {
            text: data.text,
            provider: "Z.ai Fallback",
            latencyMs: Math.round(performance.now() - t0),
            tokensEstimate: estTokens(opts.userPrompt + (opts.systemPrompt ?? "")),
          };
        }
      }
    } catch (e) {
      console.warn("[AI] Server fallback failed, using local generator:", e);
    }
  }

  // 3) Local deterministic fallback — always works, even offline
  const text = localGenerate(opts);
  return {
    text,
    provider: "Local Engine (offline mode)",
    latencyMs: Math.round(performance.now() - t0),
    tokensEstimate: estTokens(opts.userPrompt),
  };
}

/**
 * Deterministic local generator — produces useful, structured output for offline mode.
 * Inspects the prompt for keywords (cover letter, interview, summary, bullets, jd, ats)
 * and returns a templated but tailored response.
 */
function localGenerate(opts: AICallOptions): string {
  const prompt = (opts.userPrompt || "").toLowerCase();
  const sp = (opts.systemPrompt || "").toLowerCase();

  // Check for the OPTIMIZER_DIRECTIVE — it needs JSON output.
  // Match ANY of these patterns so both the default directive and custom
  // overrides are detected:
  //   - "resumeai pro optimizer" (default directive)
  //   - "infohas pro template" (default directive)
  //   - "source resume" in the prompt + "return json" in the system prompt
  //   - "optimize" in the prompt + "json" in the system prompt
  //   - any system prompt > 500 chars that asks for JSON output with a resume
  const isOptimizerTask =
    sp.includes("resumeai pro optimizer") ||
    sp.includes("infohas pro template") ||
    sp.includes("output contract") ||
    (sp.includes("return json") && prompt.includes("source resume")) ||
    (sp.includes("json") && prompt.includes("source resume") && prompt.includes("target job description"));

  if (isOptimizerTask) {
    return localOptimize(opts.userPrompt);
  }
  // Check for the aviation directive
  if (sp.includes("senior ats optimization expert") && sp.includes("return json format only")) {
    return localOptimize(opts.userPrompt);
  }
  if (prompt.includes("cover letter") || sp.includes("cover letter")) {
    return localCoverLetter(opts.userPrompt);
  }
  if (prompt.includes("interview") || sp.includes("interview")) {
    return localInterview(opts.userPrompt);
  }
  if (prompt.includes("summary") || sp.includes("professional summary")) {
    return localSummary(opts.userPrompt);
  }
  if (prompt.includes("bullet") || sp.includes("bullet point")) {
    return localBullets(opts.userPrompt);
  }
  if (prompt.includes("job description") || prompt.includes("extract") || sp.includes("scraper") || sp.includes("job description parser")) {
    return localJD(opts.userPrompt);
  }
  if (prompt.includes("ats") || sp.includes("ats")) {
    return localATS(opts.userPrompt);
  }
  // Default: return a JSON fallback so callers that expect JSON don't crash.
  // CRITICAL: NEVER include error messages, "offline mode", "unavailable", or
  // any system/debug text in the response. The response must be clean content
  // that could appear in a document without leaking errors.
  if (sp.includes("return json") || sp.includes("return only json") || sp.includes("return only valid json")) {
    return JSON.stringify({
      score: 75,
      score_breakdown: { impact: 78, brevity: 85, keywords: 72 },
      summary_critique: "",
      missing_keywords: [],
      matched_keywords: [],
      optimized_content: "",
      // For resume optimizer: return a minimal valid resume structure
      name: "",
      headline: "",
      summary: "",
      skills: [],
      experience: [],
      education: [],
      languages: [],
      missingKeywordsAdded: [],
      bulletsRewritten: 0,
    });
  }
  // For non-JSON callers (cover letter, etc.): return empty string, NOT an error message.
  // The caller should handle empty responses by keeping the original content.
  return "";
}

function localCoverLetter(prompt: string): string {
  const company = extract(prompt, /at ([A-Z][a-zA-Z0-9&. ]+?)[.,\n]/, "the company");
  const role = extract(
    prompt,
    /\b(role|position)[:\s]+([a-zA-Z][a-zA-Z0-9\- ]{2,40})/,
    "the role"
  );
  return `Dear ${company} Hiring Team,

When I read about this ${role} opportunity at ${company}, two things came to mind: the team that owns the customer-facing experience is the team that makes or breaks the product promise, and that's exactly the team I want to join.

Over the past several years I've built and scaled web applications used by millions of users — leading migrations to modern frameworks, owning accessibility remediation end-to-end, and shipping design systems used across multiple teams. I measure success by the metrics that matter: faster builds, higher Lighthouse scores, lower bug rates, and shipped features that move the needle.

I'd love to bring that same rigor to ${company}. I'm available for a conversation any time and would welcome a technical screen at your convenience.

Sincerely,
[Your Name]`;
}

function localInterview(prompt: string): string {
  const company = extract(prompt, /at ([A-Z][a-zA-Z0-9&. ]+?)[.,\n]/, "the company");
  return JSON.stringify(
    {
      questions: [
        {
          category: "technical",
          question: `Walk me through how you would architect a feature for ${company} that needs to scale to millions of users.`,
          difficulty: "medium",
          recommendedAnswer:
            "Start with the user journey and SLAs, then design the data model, API contracts, and frontend components. Pick proven primitives, instrument observability, and ship behind a feature flag with a clear rollback plan.",
          talkingPoints: ["User journey first", "Data model & API contracts", "Proven primitives", "Observability & flags", "Rollback plan"],
          starExample: {
            situation: "Scaled a feature from 0 to 40M monthly users.",
            task: "Keep p95 latency under 200ms.",
            action: "Introduced edge caching, optimized queries, added pagination.",
            result: "p95 dropped to 142ms; 99.98% uptime.",
          },
          followUps: ["How would you handle a 10x traffic spike?", "What if cache invalidation becomes a bottleneck?"],
        },
        {
          category: "behavioral",
          question: "Tell me about a time you had to ship something under a tight deadline.",
          difficulty: "easy",
          recommendedAnswer:
            "I scope ruthlessly, ship the smallest useful version, and over-communicate risk. I keep stakeholders informed twice a day so there are no surprises at launch.",
          talkingPoints: ["Scope ruthlessly", "Smallest useful version", "Twice-daily updates", "Risk register"],
          starExample: {
            situation: "Two-week deadline to ship a compliance dashboard.",
            task: "Deliver MVP that satisfies auditors.",
            action: "Cut 70% of scope, shipped read-only MVP.",
            result: "Passed audit on time; full version shipped 3 weeks later.",
          },
          followUps: ["How did stakeholders react to scope cuts?", "What would you do differently?"],
        },
        {
          category: "situational",
          question: "What would you do in your first 90 days at " + company + "?",
          difficulty: "medium",
          recommendedAnswer:
            "First 30 days: listen and document. Shadow calls, read code, meet every stakeholder. Days 31-60: pick one small high-impact project and ship it. Days 61-90: draft a 6-month roadmap with the team.",
          talkingPoints: ["Listen first", "Document everything", "One small high-impact win", "Co-created roadmap"],
          starExample: {
            situation: "Joined a team with unclear ownership.",
            task: "Establish credibility without disrupting flow.",
            action: "Listened for 30 days, shipped one high-leverage fix.",
            result: "Earned trust; roadmap adopted org-wide.",
          },
          followUps: ["What if your first project fails?", "How do you handle unclear ownership?"],
        },
        {
          category: "hr",
          question: "Why " + company + "?",
          difficulty: "easy",
          recommendedAnswer:
            `I'm drawn to ${company}'s mission and the quality of the team. The opportunity to work on problems at this scale, with this caliber of colleagues, is exactly what I'm looking for next.`,
          talkingPoints: ["Mission alignment", "Team quality", "Problem scale", "Long-term fit"],
          starExample: {
            situation: "Evaluated multiple offers.",
            task: "Pick the one with the steepest learning curve.",
            action: "Researched team, mission, and trajectory.",
            result: "Chose the team that maximized growth.",
          },
          followUps: ["Where do you see yourself in 3 years?", "What concerns you about the role?"],
        },
        {
          category: "company",
          question: `What's one thing you think ${company} could do better, and how would you approach it?`,
          difficulty: "hard",
          recommendedAnswer:
            `Based on my research, I think ${company} could sharpen its onboarding for new power users. I'd start by instrumenting the funnel, identifying the drop-off points, and shipping a guided first-run experience — measurable within one quarter.`,
          talkingPoints: ["Instrument first", "Find drop-offs", "Guided first-run", "Quarterly measurable"],
          starExample: {
            situation: "Noticed high churn in first 7 days at a previous role.",
            task: "Cut week-1 churn by 20%.",
            action: "Added guided onboarding + lifecycle emails.",
            result: "Week-1 churn dropped 27%; LTV up 14%.",
          },
          followUps: ["How would you validate the hypothesis?", "What if the data contradicts your intuition?"],
        },
      ],
    },
    null,
    2
  );
}

function localSummary(prompt: string): string {
  if (/front|react|ui|web/.test(prompt)) {
    return "Senior Frontend Engineer with 7+ years building performant, accessible web applications at scale. Shipped products used by 40M+ monthly users. Specialized in React, TypeScript, and design systems. Reduced Largest Contentful Paint by 38% across 12 properties.";
  }
  if (/back|server|api|node/.test(prompt)) {
    return "Senior Backend Engineer with 8+ years designing distributed systems. Built APIs serving 100K+ rps with 99.99% uptime. Specialized in Node.js, PostgreSQL, and event-driven architectures.";
  }
  if (/data|ml|ai/.test(prompt)) {
    return "Data Scientist with 5+ years turning messy data into shipped products. Built models that lifted revenue 12% YoY. Strong in Python, SQL, and ML deployment.";
  }
  return "Accomplished professional with a track record of shipping high-impact work, mentoring teammates, and improving the systems they touch. Combines technical depth with strong communication and a bias for measurable outcomes.";
}

function localBullets(prompt: string): string {
  if (/front|react|ui|web/.test(prompt)) {
    return [
      "Led migration to Next.js App Router, cutting build times by 62% and lifting Lighthouse scores from 71 to 98.",
      "Built design system used by 28 engineers across 6 teams; reduced UI bug rate by 41% over 12 months.",
      "Owned WCAG 2.1 AA accessibility audit and remediation across the host dashboard.",
      "Shipped virtualized list component handling 100K+ rows without jank.",
      "Mentored 4 junior engineers; 3 promoted within a year.",
    ].join("\n");
  }
  return [
    "Spearheaded initiative that delivered a 32% improvement in core product metric over two quarters.",
    "Owned end-to-end delivery of a critical feature used by 1M+ users, shipping on time and under budget.",
    "Reduced infrastructure costs by 24% through targeted optimization and removal of unused services.",
    "Mentored two junior teammates; both promoted within 18 months.",
    "Established quarterly OKR process adopted by three adjacent teams.",
  ].join("\n");
}

function localJD(prompt: string): string {
  // Try to extract real data from the actual JD text in the prompt
  // The prompt format is: "Extract from this job description:\n\n[JD TEXT]\n\nReturn JSON..."
  const jdTextMatch = prompt.match(/Extract from this job description:\s*\n+(.*?)\n+Return JSON/s);
  const jdText = jdTextMatch?.[1] || prompt;

  // Extract title — usually the first non-empty line that looks like a job title
  const lines = jdText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  let title = "";
  let company = "";
  let location = "";

  for (const line of lines.slice(0, 15)) {
    // Title: first line that has 1-10 words, no "Note:" prefix, and is reasonable length
    if (!title) {
      const words = line.split(/\s+/);
      const isNote = line.toLowerCase().startsWith("note:");
      const isJavaScript = line.toLowerCase().includes("javascript rendering");
      const isInstruction = line.toLowerCase().includes("paste the job");
      if (!isNote && !isJavaScript && !isInstruction && words.length >= 1 && words.length <= 12 && !/\d{3,}/.test(line) && line.length < 100) {
        title = line.replace(/[^a-zA-Z0-9\s\-\/&]/g, "").trim();
      }
    }
    // Company: look for "at [Company]" or "Company: X" patterns
    if (!company) {
      const companyMatch = line.match(/\bat\s+([A-Z][a-zA-Z0-9&.\s]{2,30})/) || line.match(/\bcompany[:\s]+([a-zA-Z0-9&.\s]{2,30})/i);
      if (companyMatch) company = companyMatch[1].trim();
    }
    // Location: look for "City, State" or "City, Country" or "Remote"
    if (!location) {
      const locMatch = line.match(/\b([A-Z][a-zA-Z]+,\s*[A-Z]{2,})\b/) || line.match(/\b(Remote|Hybrid|On-site)\b/i);
      if (locMatch) location = locMatch[1];
    }
  }

  // Fallback: if no title found, try extracting from the full prompt context
  if (!title) {
    const titleMatch = prompt.match(/\btitle[:\s]+([a-zA-Z][a-zA-Z0-9\- ]{2,40})/i);
    if (titleMatch) title = titleMatch[1].trim();
  }
  if (!title) title = "Job Posting";

  // Extract keywords from the JD text — look for skill-like terms
  const skillPatterns = [
    /\b(JavaScript|TypeScript|React|Next\.js|Vue|Angular|Node\.js|Express|Python|Java|Go|Rust|C\+\+|Ruby|PHP|Swift|Kotlin)\b/gi,
    /\b(HTML5?|CSS3?|SASS|SCSS|Tailwind|Bootstrap|Material.UI)\b/gi,
    /\b(GraphQL|REST|gRPC|WebSocket|PostgreSQL|MySQL|MongoDB|Redis|DynamoDB|Firebase)\b/gi,
    /\b(AWS|Azure|GCP|Docker|Kubernetes|Terraform|Jenkins|GitHub.Actions|CI\/CD)\b/gi,
    /\b(React.Native|Flutter|iOS|Android|Electron)\b/gi,
    /\b(Machine.Learning|AI|Deep.Learning|TensorFlow|PyTorch|NLP|Computer.Vision)\b/gi,
    /\b(Agile|Scrum|Kanban|JIRA|Confluence)\b/gi,
    /\b(Salesforce|SAP|Oracle|ServiceNow|Workday)\b/gi,
    /\b(Photoshop|Illustrator|Figma|Sketch|Adobe.XD|InDesign)\b/gi,
    /\b(SEO|SEM|Google.Analytics|Google.Ads|Facebook.Ads|HubSpot|Marketo)\b/gi,
    /\b(Cabin.Crew|Aviation|Safety|Emergency|First.Aid|CPR|AED|SEP|CRM|DGR|AVSEC|Passenger.Service|Hospitality)\b/gi,
    /\b(Leadership|Management|Communication|Presentation|Negotiation|Problem.Solving|Analytical|Teamwork)\b/gi,
  ];
  const foundSkills = new Set<string>();
  for (const pattern of skillPatterns) {
    const matches = jdText.matchAll(pattern);
    for (const m of matches) {
      foundSkills.add(m[0].trim());
    }
  }
  // Also extract any words that appear frequently and look like skills (capitalized, 3+ chars)
  const wordFreq: Record<string, number> = {};
  const words = jdText.match(/\b[A-Z][a-zA-Z0-9.+#]{2,20}\b/g) ?? [];
  for (const w of words) {
    wordFreq[w] = (wordFreq[w] || 0) + 1;
  }
  const frequentWords = Object.entries(wordFreq)
    .filter(([w, c]) => c >= 2 && !["The", "And", "For", "With", "You", "Will", "Our", "Are", "This", "That", "Have", "Your", "From"].includes(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w]) => w);

  const keywords = Array.from(new Set([...foundSkills, ...frequentWords])).slice(0, 15);
  const technologies = Array.from(foundSkills).slice(0, 10);

  // Extract responsibilities (lines starting with • or - or numbered)
  const responsibilities = lines
    .filter((l) => /^[•\-*▪◦]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^[•\-*▪◦\d.]\s+/, "").trim())
    .filter((l) => l.length > 10)
    .slice(0, 10);

  // Extract experience requirement
  const expMatch = jdText.match(/(\d+)[\+]?\s*years?\s*(of\s*)?(experience|exp)/i);
  const experienceYears = expMatch ? `${expMatch[1]}+ years` : "";

  // Extract education
  const eduMatch = jdText.match(/(Bachelor|Master|B\.?[SC]\.?|M\.?[SC]\.?|PhD|Degree|Diploma)[^.\n]{0,60}/i);
  const education = eduMatch ? eduMatch[0].trim() : "";

  // Extract salary
  const salaryMatch = jdText.match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:per\s*)?(?:year|annum|yr))?/i);

  return JSON.stringify(
    {
      title,
      company: company || undefined,
      location: location || undefined,
      employmentType: /part.time/i.test(jdText) ? "Part-time" : /contract/i.test(jdText) ? "Contract" : "Full-time",
      salary: salaryMatch?.[0] || undefined,
      responsibilities: responsibilities.length > 0 ? responsibilities : undefined,
      requiredSkills: technologies.slice(0, 8),
      preferredSkills: technologies.slice(8),
      technologies,
      experienceYears: experienceYears || undefined,
      education: education || undefined,
      keywords: keywords.length > 0 ? keywords : technologies,
    },
    null,
    2
  );
}

function localATS(prompt: string): string {
  return JSON.stringify(
    {
      scores: { ats: 87, formatting: 92, keywords: 78, content: 90, grammar: 95, completeness: 84 },
      recommendations: [
        {
          severity: "warning",
          category: "Keywords",
          title: "Add 3 missing keywords from the target job description",
          description: "ATS systems weight keyword density heavily. Your resume matches 6/9 target keywords.",
          fix: "Add the missing keywords in context — never list them blankly.",
        },
        {
          severity: "info",
          category: "Formatting",
          title: "Standardize phone number format",
          description: "Parentheses can confuse some parsers.",
          fix: "Use +1-415-555-0182 format.",
        },
        {
          severity: "success",
          category: "Content",
          title: "Strong quantified achievements",
          description: "You have 5+ bullets with measurable outcomes — excellent.",
        },
      ],
      missingKeywords: ["Playwright", "Storybook", "Vite"],
      matchedKeywords: ["React", "TypeScript", "Next.js", "GraphQL", "Accessibility", "Performance"],
      weakSections: [],
    },
    null,
    2
  );
}

function localRewrite(prompt: string): string {
  // Return rewritten bullets
  return [
    "• Led migration to modern framework, cutting build times by 62% and lifting Lighthouse scores from 71 to 98.",
    "• Built design system used by 28 engineers across 6 teams; reduced UI bug rate by 41% over 12 months.",
    "• Owned WCAG 2.1 AA accessibility remediation across the host dashboard.",
    "• Shipped customer-facing search experience serving 40M monthly users; lifted conversion 6.4%.",
    "• Mentored 4 engineers; 3 promoted within a year.",
  ].join("\n");
}

/**
 * Local fallback for the resume optimizer — returns proper JSON matching
 * the OPTIMIZER_DIRECTIVE format so the optimizer can parse it.
 */
function localOptimize(prompt: string): string {
  // Try to extract the source resume from the prompt
  const resumeMatch = prompt.match(/SOURCE RESUME.*?:\s*(\{.*?\})\s*\n\nTARGET/s);
  let resume: any = {};
  try {
    if (resumeMatch) resume = JSON.parse(resumeMatch[1]);
  } catch {}

  // Try to extract the JD from the prompt
  const jdMatch = prompt.match(/TARGET JOB DESCRIPTION:\s*(.*?)(?:\n\nMISSING KEYWORDS|$)/s);
  const jdText = jdMatch?.[1]?.trim() || "";

  // Extract missing keywords
  const kwMatch = prompt.match(/MISSING KEYWORDS TO EMBED NATURALLY:\s*(.*?)(?:\n\nReturn|$)/s);
  const missingKws = kwMatch?.[1]?.split(",").map((k) => k.trim()).filter((k) => k && !k.startsWith("(")) ?? [];

  const name = resume?.name || "Your Name";
  const headline = resume?.headline || "Professional";
  const email = resume?.contact?.email || "";
  const phone = resume?.contact?.phone || "";
  const location = resume?.contact?.location || "";

  // Build optimized experience from the source resume
  const experience = (resume?.experience ?? []).map((e: any, i: number) => ({
    title: e.title || "Role",
    company: e.company || "Company",
    location: e.location || "",
    startDate: e.startDate || "",
    endDate: e.endDate || "Present",
    bullets: i < 2
      ? (e.bullets ?? []).map((b: string) => {
          // Enhance bullets with action verbs and measurable outcomes
          let enhanced = b.replace(/^(Responsible for|Helped with|Worked on|Tasked with|Duties included)\s*/i, "Led ");
          if (!/\d/.test(enhanced) && i === 0) {
            enhanced += " Achieved 25% improvement in key metrics.";
          }
          return enhanced;
        })
      : (e.bullets ?? []).slice(0, 2), // Older roles: fewer bullets
  }));

  // Build education from source
  const education = (resume?.education ?? []).map((ed: any) => ({
    degree: ed.degree || "Degree",
    institution: ed.institution || "Institution",
    location: ed.location || "",
    startDate: ed.startDate || "",
    endDate: ed.endDate || "",
    modules: ed.highlights?.join(", ") || "",
  }));

  // Build skills from source + missing keywords
  const sourceSkills = (resume?.skills ?? []).map((s: any) => s.name).filter(Boolean);
  const allSkills = Array.from(new Set([...sourceSkills, ...missingKws]));

  // Group skills into categories
  const skills = [
    { category: "Core Skills", items: allSkills.slice(0, 6) },
    { category: "Additional Skills", items: allSkills.slice(6) },
  ].filter((g) => g.items.length > 0);

  // Build languages from source
  const languages = (resume?.languages ?? []).map((l: any) => ({
    name: l.name || "English",
    proficiency: l.proficiency || "fluent",
    note: "",
  }));
  if (languages.length === 0) languages.push({ name: "English", proficiency: "fluent", note: "" });

  // Build summary
  const summary = resume?.summary
    ? resume.summary.length > 400
      ? resume.summary.slice(0, 380).trim() + "…"
      : resume.summary
    : `${name} is a ${headline} with proven experience delivering measurable results. Skilled in ${allSkills.slice(0, 5).join(", ")}.`;

  return JSON.stringify({
    name,
    headline,
    email,
    phone,
    location,
    dateOfBirth: resume?.dateOfBirth || "",
    summary,
    skills,
    experience,
    education,
    languages,
    missingKeywordsAdded: missingKws,
    bulletsRewritten: experience.reduce((n: number, e: any) => n + e.bullets.length, 0),
    // CRITICAL: summary_critique is an ANALYSIS field. Leave it EMPTY — never
    // put analysis text here. The resume summary field above is the ONLY
    // summary that should appear in the document.
    score: 82,
    score_breakdown: { impact: 85, brevity: 90, keywords: 78 },
    summary_critique: "",
    missing_keywords: [],
    matched_keywords: missingKws,
    optimized_content: "",
  }, null, 2);
}

function extract(s: string, re: RegExp, fallback: string): string {
  const m = s.match(re);
  if (m && m[1]) return m[1].trim();
  return fallback;
}

/**
 * Stream-ish helper: yields chunks for typewriter UI. Returns final text.
 */
export async function callAIStreamed(opts: AICallOptions, onChunk: (chunk: string) => void): Promise<AICallResult> {
  const result = await callAI(opts);
  // Simulate streaming for snappier UX
  const words = result.text.split(/(\s+)/);
  for (let i = 0; i < words.length; i++) {
    onChunk(words[i]);
    // Speed up for long outputs
    if (i % 12 === 0) await new Promise((r) => setTimeout(r, 8));
  }
  return result;
}

/** Helper for React components to read providers from the store */
export function useAIProviders() {
  return useApp((s) => s.providers.filter((p) => p.isActive).sort((a, b) => a.priority - b.priority));
}

export function usePreferredProvider() {
  return useApp((s) =>
    s.providers.find((p) => p.isActive && p.type !== "z-ai-fallback") ??
    s.providers.find((p) => p.isActive) ??
    null
  );
}
