// ============================================================================
// Optimizer Directive Engine — Single Source of Truth for ALL Prompts
//
// This is the ONE entry point for ALL directive generation in ResumeAI Pro.
// Every agent, every pipeline, every mode, every optimizer gets its directive
// through this engine. No inline prompts, no duplicated logic.
//
// Architecture:
//   DirectiveEngine.getDirective(type, config, context) → string
//     ├── "standard"   → Full optimizer directive (replaces getOptimizerDirective)
//     ├── "aviation"   → Aviation-optimized directive (replaces getAviationOptimizerDirective)
//     ├── "guardian"   → Guardian/validation directive
//     ├── "compression"→ Compression-only directive
//     ├── "bullet"     → Bullet rewrite directive (replaces bullet-only-optimizer prompt)
//     └── "policy"     → Policy context block only
//
// Every builder composes:
//   1. SYSTEM POLICY BLOCK (from directive-policy.ts) — immutable rules
//   2. INDUSTRY / MODE-SPECIFIC AUGMENTATION (if applicable)
//   3. OUTPUT FORMAT DIRECTIVES — JSON shape constraints
//
// ============================================================================

import type { OptimizerDirectiveConfig, ResumeData } from "./types";
import { buildOptimizationPolicy, formatPolicyForPrompt, type OptimizationPolicy } from "./directive-policy";
import { INDUSTRY_PROFILES } from "./industry-ats";

// ============================================================================
// TYPES
// ============================================================================

export type DirectiveType =
  | "standard"
  | "aviation"
  | "guardian"
  | "compression"
  | "bullet"
  | "policy"
  | "professional-writing"
  | "ats";

export interface DirectiveContext {
  /** Source resume (for entity count / char target calculation) */
  sourceResume?: ResumeData;
  /** Job description text (for ATS / keyword alignment) */
  jobDescription?: string;
  /** Airline profile ID ("emirates", "qatar", "generic", etc.) */
  airlineProfile?: string;
  /** Industry profile ID */
  industryId?: string;
  /** Custom instructions from the super-admin override */
  customOverride?: string;
  /** Strictness level for keyword density / tone */
  strictness?: "Balanced" | "Aggressive" | "Conservative";
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/** When no config is available, use these sensible fallbacks */
const FALLBACK_CONFIG: Partial<OptimizerDirectiveConfig> = {
  pageSize: "A4",
  fontFamily: "Calibri",
  bodyFontSizePt: 10,
  sectionTitleSizePt: 10,
  nameSizePt: 14,
  bodyTextColor: "#000000",
  nameColor: "#000000",
  sectionTitleColor: "#000000",
  marginTopMm: 12,
  marginBottomMm: 12,
  marginLeftMm: 15,
  marginRightMm: 15,
  lineHeight: 1.15,
  sectionGapMm: 3,
  bulletIndentMm: 5,
  summaryMinWords: 60,
  summaryMaxWords: 130,
  skillsMaxGroups: 5,
  experienceMaxEntries: 8,
  experienceBulletsPerEntry: 5,
  educationMaxEntries: 4,
  languagesMaxEntries: 6,
  photoEnabled: false,
  showPlaceholderIfNoPhoto: false,
  photoWidthMm: 25,
  photoHeightMm: 30,
  enforceOnePage: true,
  minFontSizePt: 9,
};

// ============================================================================
// SECTION — BUILDERS
// ============================================================================

/**
 * Build a "Bullet Rewrite" directive for the bullet-only optimizer.
 * Replaces the ad-hoc prompt in bullet-only-optimizer.ts.
 */
export function buildBulletDirective(
  config: OptimizerDirectiveConfig | null | undefined,
  context?: DirectiveContext,
): string {
  // If custom override is set, it COMPLETELY REPLACES the generated directive
  const customOverride = context?.customOverride?.trim();
  if (customOverride) {
    return customOverride;
  }

  const policy = buildOptimizationPolicy(config);
  const policyBlock = formatPolicyForPrompt(policy);
  const c = config || FALLBACK_CONFIG;
  const minWords = c.summaryMinWords ?? 60;
  const maxWords = c.summaryMaxWords ?? 90;

  return `${policyBlock}

═══════════════════════════════════════════════════════════════
BULLET REWRITE DIRECTIVE
═══════════════════════════════════════════════════════════════

You are an expert ATS resume optimizer. You may ONLY modify summary, headline, skills, and experience bullets. Everything else is LOCKED.

CRITICAL ARCHITECTURE RULE — You are NOT allowed to generate an entire resume.
You may ONLY return this exact JSON shape:

{
  "summary": "rewritten professional summary (${minWords}-${maxWords} words, single paragraph, no bullets)",
  "headline": "rewritten headline (target role title, NO company names from the JD)",
  "skills": [
    { "name": "Skill Name", "category": "Category" }
  ],
  "experiences": [
    {
      "id": "MUST match the source experience ID exactly",
      "bullets": ["rewritten bullet 1", "rewritten bullet 2", ...]
    }
  ]
}

FORBIDDEN — you may NOT return these fields:
- name, email, phone, location, dateOfBirth (contact info is locked)
- experience[].title (locked)
- experience[].company (locked)
- experience[].location (locked)
- experience[].startDate (locked)
- experience[].endDate (locked)
- education[] (locked)
- languages[] (locked)
- certifications[] (locked)

You may ONLY modify:
- summary (rewrite for ATS + readability)
- headline (rewrite for target role — NO JD company names)
- skills (enrich with transferable skills, reorder for JD relevance)
- experience[].bullets (rewrite for impact + ATS keywords)

CRITICAL RULES:

1. EXPERIENCE IDs: You MUST echo back the exact same experience IDs from the source resume. Do NOT change them, do NOT remove them, do NOT add new ones.

2. ZERO-HALLUCINATION POLICY:
   - NEVER invent employers, job titles, schools, degrees, certifications, locations, or languages.
   - NEVER add percentages, metrics, dollar amounts, or time savings unless explicitly present in the source.
   - NEVER fabricate skills, software, or tools you are not 100% certain the candidate used.
   - If the source resume says nothing about a particular skill, DO NOT add it.

3. BULLET RULES:
   - Each bullet: 80-120 characters, one line.
   - Start every bullet with a strong action verb (past tense for past roles, present for current).
   - Preserve the EXACT number of bullets per entry.
   - Preserve all factual content — rephrase only.
   - Use industry-recognized terminology where supported by the original content.

4. SUMMARY RULES:
   - Single paragraph, no bullet points, no line breaks.
   - Integrate 2-3 keywords from the job description naturally.
   - Keep within ${minWords}-${maxWords} words.

Return ONLY valid JSON. No markdown fences, no prose, no explanation.
`;
}

/**
 * Build the STANDARD full optimizer directive.
 * Replaces getOptimizerDirective() in ai.ts.
 */
export function buildStandardDirective(
  config: OptimizerDirectiveConfig | null | undefined,
  context?: DirectiveContext,
): string {
  const policy = buildOptimizationPolicy(config);
  const policyBlock = formatPolicyForPrompt(policy);
  const c = config || FALLBACK_CONFIG;

  const sectionLimitsBlock = c.sectionLimits
    ? `- HEADER (name + contact): ${c.sectionLimits.header.min}-${c.sectionLimits.header.max} characters
- PROFESSIONAL SUMMARY: ${c.sectionLimits.summary.min}-${c.sectionLimits.summary.max} characters
- CORE COMPETENCIES & SKILLS: ${c.sectionLimits.skills.min}-${c.sectionLimits.skills.max} characters
- PROFESSIONAL EXPERIENCE: ${c.sectionLimits.experience.min}-${c.sectionLimits.experience.max} characters
- EDUCATION: ${c.sectionLimits.education.min}-${c.sectionLimits.education.max} characters
- LANGUAGES: ${c.sectionLimits.languages.min}-${c.sectionLimits.languages.max} characters`
    : "";

  return `${policyBlock}

═══════════════════════════════════════════════════════════════
OPTIMIZER DIRECTIVE
═══════════════════════════════════════════════════════════════

You are the ResumeAI Pro Optimizer. You MUST preserve the EXACT layout framework described below. Only modify CONTENT — never modify LAYOUT, section order, content density, photo position, or the compact recruiter-friendly structure.

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
3. PROFESSIONAL EXPERIENCE — PRESERVE ALL original entries, PRESERVE THE EXACT SAME NUMBER OF BULLETS as the source resume for each entry. Never drop bullets.
4. EDUCATION — PRESERVE ALL original entries
5. LANGUAGES — max ${c.languagesMaxEntries} entries, one line per language

═══════════════════════════════════════════════════════════════
SECTION CHARACTER LIMITS
═══════════════════════════════════════════════════════════════
${sectionLimitsBlock || "- Summary: " + c.summaryMinWords + "-" + c.summaryMaxWords + " words"}

═══════════════════════════════════════════════════════════════
CONTENT COMPRESSION ENGINE
═══════════════════════════════════════════════════════════════
${c.enforceOnePage
    ? `Apply IN THIS ORDER until content fits one page:
1. Tighten word choice (replace long phrases with shorter ones)
2. Reduce bullet length (trim filler words, keep all content)
3. Reduce spacing (tighten line height)
4. Reduce font size to MINIMUM ${c.minFontSizePt}pt (never below ${c.minFontSizePt}pt)
5. Merge similar skills (combine categories)
WARNING: NEVER remove bullets, experience entries, education entries, languages, or custom sections. NEVER change dates.
NEVER create page two. assert(pdf.pages === 1).`
    : "Multi-page output allowed if content exceeds one page."}

═══════════════════════════════════════════════════════════════
FACTUAL INTEGRITY
═══════════════════════════════════════════════════════════════
NEVER fabricate: experience, employers, dates, metrics, certifications, skills.
ONLY use information from the original resume.
CRITICAL: NEVER invent percentages, metrics, or numbers.

RETURN valid JSON with this shape:
{
  "resume": {
    "name": "FULL NAME",
    "headline": "Target Role",
    "location": "City, Country",
    "phone": "+X ...",
    "email": "...",
    "dateOfBirth": "DD/MM/YYYY" | "",
    "summary": "Professional summary paragraph",
    "skills": [{ "category": "string", "items": ["string"] }],
    "experience": [{
      "title": "Job Title",
      "company": "Company",
      "location": "City, Country",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY" | "Present",
      "bullets": ["string"]
    }],
    "education": [{
      "degree": "Degree",
      "institution": "Institution",
      "location": "City, Country" | "",
      "startDate": "YYYY",
      "endDate": "YYYY",
      "modules": "string" | ""
    }],
    "languages": [{ "name": "string", "proficiency": "string", "note": "" }]
  }
}
`;
}

/**
 * Build an AVIATION-OPTIMIZED directive.
 * Replaces getAviationOptimizerDirective() in ats-directives.ts.
 * Instead of duplicating the full prompt, this composes:
 *   1. Standard directive (layout + policy)
 *   2. Industry augmentation (airline profile + keyword bank)
 */
export function buildAviationDirective(
  config: OptimizerDirectiveConfig | null | undefined,
  context?: DirectiveContext,
): string {
  const policy = buildOptimizationPolicy(config);
  const policyBlock = formatPolicyForPrompt(policy);
  const profile = context?.airlineProfile || "generic";
  // Map airline-specific profiles (e.g. "emirates", "qatar") to the aviation industry
  const KNOWN_AIRLINE_KEYS = new Set(["emirates", "qatar", "etihad", "lufthansa", "ryanair", "singapore", "airfrance", "british", "generic"]);
  const industryKey = KNOWN_AIRLINE_KEYS.has(profile) ? "aviation" : (INDUSTRY_PROFILES[profile] ? profile : "aviation");
  const industryProfile = INDUSTRY_PROFILES[industryKey];
  const c = config || FALLBACK_CONFIG;

  // Airline-specific keyword banks (from ats-directives.ts — consolidated here)
  const CABIN_CREW_KEYWORDS = `
  Technical: Cabin Crew Attestation (CCA), CPR/AED Certified, Aviation First Aid, SEP (Safety and Emergency Procedures), Aircraft Type Qualifications (e.g., A380, B787), Cabin Crew Medical.
  Safety: Emergency Evacuation, Dangerous Goods Regulations (DGR), In-flight Firefighting, Ditching Procedures, Pre-flight Safety Checks, Aviation Security (AVSEC).
  Operational: CRM (Crew Resource Management), In-flight Service Delivery, Galley Management, Passenger Announcements (PA), Turnaround Operations, Special Handling (UMNR, PRM).
  Soft Skills: Customer Service Excellence, Conflict Resolution, Cultural Awareness, De-escalation, Decision Making Under Pressure, Situational Awareness.`;

  const AVIATION_KEYWORDS = `
  Technical: Cabin Crew Attestation (CCA), ATP Certificate, Type Ratings (A320, B737, B777, B787, A350, A380), CRM Certification, Aviation First Aid, CPR/AED, SEP (Safety and Emergency Procedures), Aircraft Type Qualifications, Cabin Crew Medical, ICAO Language Proficiency (Level 4+).
  Safety: Emergency Evacuation, Dangerous Goods Regulations (DGR), In-flight Firefighting, Ditching Procedures, Pre-flight Safety Checks, Aviation Security (AVSEC), Smoke Removal, Rapid Decompression, Cabin Pressurization.
  Operational: Crew Resource Management (CRM), In-flight Service Delivery, Galley Management, Passenger Announcements (PA), Turnaround Operations, Special Handling (UMNR, PRM, CIP), Duty-Free Sales, Cash & Card Handling, Passenger Boarding, Disembarkation Procedures.
  Service: Customer Service Excellence, Conflict Resolution, Cultural Awareness, De-escalation, Decision Making Under Pressure, Situational Awareness, Multicultural Team Collaboration, Premium Cabin Service, Fine Dining Service, Beverage Service.
  Regulatory: EASA Part-CC, FAA Part 121/135, CAA CAP 789, ICAO Annex 6, IATA DGR, Aviation Audits (IOSA), Safety Management Systems (SMS).
  Languages: English (ICAO Level 4+), Arabic, French, German, Spanish, Mandarin, Hindi, Urdu — cross-cultural communication.`;

  return `${policyBlock}

═══════════════════════════════════════════════════════════════
INDUSTRY MODE: AVIATION
═══════════════════════════════════════════════════════════════

OPTIMIZATION PROFILE: ${industryProfile?.label || "Generic Aviation"}
INDUSTRY: ${industryProfile?.description || "Aviation / Cabin Crew"}
${industryProfile?.priorityKeywords?.length ? `INDUSTRY PRIORITY KEYWORDS: ${industryProfile.priorityKeywords.join(", ")}` : ""}

═══════════════════════════════════════════════════════════════
INDUSTRY KEYWORD BANK
═══════════════════════════════════════════════════════════════
${industryProfile?.keywordBank || `${CABIN_CREW_KEYWORDS}\n${AVIATION_KEYWORDS}`}

${industryProfile?.writingGuidance ? `INDUSTRY WRITING GUIDANCE:\n${industryProfile.writingGuidance}` : ""}

═══════════════════════════════════════════════════════════════
AVIATION-SPECIFIC RULES
═══════════════════════════════════════════════════════════════

1. HIGHLIGHT: safety certifications, language proficiency, customer service excellence, cultural awareness.
2. PRESERVE: all ICAO language levels, type ratings, certifications, licenses.
3. USE: airline industry terminology naturally throughout summary, skills, and experience bullets.
4. FORMAT: skills into Cabin Safety, Customer Service, Operations, Languages categories.
5. NEVER: invent flight hours, aircraft types, certifications, or airline names.
6. TARGET: ~2,900 characters, one A4 page.
${context?.strictness === "Aggressive" ? `
═══════════════════════════════════════════════════════════════
STRICTNESS: AGGRESSIVE
═══════════════════════════════════════════════════════════════

- MAXIMUM keyword density: target every priority keyword appearing in summary AND skills AND experience.
- Strong bias toward ATS match score over preservation of original wording.
- Rewrite weak bullets aggressively — use industry-standard terminology.
- Prioritize keyword inclusion over natural flow.` : context?.strictness === "Conservative" ? `
═══════════════════════════════════════════════════════════════
STRICTNESS: CONSERVATIVE
═══════════════════════════════════════════════════════════════

- Conservative keyword integration — only add keywords where they fit naturally.
- Preserve original writing style and tone as much as possible.
- Minimal rewriting of experience bullets; keep original structure.
- Prioritize readability and authenticity over keyword density.` : ""}

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON
═══════════════════════════════════════════════════════════════
Return ONLY valid JSON with this exact shape (no markdown fences, no prose):
{
  "resume": {
    "name": "FULL NAME",
    "headline": "Target Role (e.g. Cabin Crew — Emirates Group)",
    "location": "City, Country",
    "phone": "+X ...",
    "email": "...",
    "dateOfBirth": "DD/MM/YYYY" | "",
    "summary": "4-6 line professional summary (~60-90 words) with 2-3 priority keywords",
    "skills": [
      { "category": "Cabin Safety & Emergency", "items": ["SEP", "Emergency Evacuation", "First Aid"] },
      { "category": "Customer Service Excellence", "items": ["Premium Service", "Conflict Resolution"] },
      { "category": "Aviation Operations", "items": ["CRM", "Galley Management"] },
      { "category": "Languages", "items": ["English (Fluent)", "Arabic (Conversational)"] }
    ],
    "experience": [{
      "title": "Job Title",
      "company": "Company",
      "location": "City, Country",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY" | "Present",
      "bullets": ["Strong action verb + achievement + priority keyword"]
    }],
    "education": [{
      "degree": "Degree Name",
      "institution": "Institution",
      "location": "City, Country" | "",
      "startDate": "YYYY",
      "endDate": "YYYY",
      "modules": "Module 1, Module 2, ..." | ""
    }],
    "languages": [
      { "name": "English", "proficiency": "Fluent", "note": "ICAO Level 5" },
      { "name": "Arabic", "proficiency": "Conversational", "note": "" }
    ]
  },
  "score": 0-100,
  "score_breakdown": { "impact": 0-100, "brevity": 0-100, "keywords": 0-100 },
  "matched_keywords": ["string"],
  "missing_keywords": ["string"],
  "summary_critique": "Brief explanation of what was optimized"
}
`;
}

/**
 * Build a GUARDIAN validation directive.
 */
export function buildGuardianDirective(
  config: OptimizerDirectiveConfig | null | undefined,
  context?: DirectiveContext,
): string {
  const policy = buildOptimizationPolicy(config);
  const policyBlock = formatPolicyForPrompt(policy);

  return `${policyBlock}

═══════════════════════════════════════════════════════════════
GUARDIAN VALIDATION DIRECTIVE
═══════════════════════════════════════════════════════════════

You are the ResumeAI Pro Guardian. Your job is to validate that the optimized resume
preserves ALL entity integrity and meets all policy requirements.

MANDATORY CHECKS (ALL MUST PASS):
1. Companies preserved — every company from source must exist in output
2. Dates preserved — start/end dates unchanged
3. Education preserved — all entries present
4. Languages preserved — all languages present
5. Contact info preserved — phone, email, location unchanged
6. Certifications preserved — all certifications present
7. Additional info preserved — all additional info sections present
8. Section order preserved — sections in correct order
9. No hallucinated facts — no invented experience, dates, metrics
10. No keyword dumping — keywords embedded naturally

Return JSON: { "passed": boolean, "checks": [{ "name": string, "passed": boolean, "detail": string }], "score": number }
`;
}

/**
 * Build a COMPRESSION-ONLY directive.
 */
export function buildCompressionDirective(
  config: OptimizerDirectiveConfig | null | undefined,
  context?: DirectiveContext,
): string {
  const policy = buildOptimizationPolicy(config);
  const policyBlock = formatPolicyForPrompt(policy);

  return `${policyBlock}

═══════════════════════════════════════════════════════════════
COMPRESSION DIRECTIVE
═══════════════════════════════════════════════════════════════

Compress the resume content to fit one A4 page while preserving ALL information.

COMPRESSION ORDER:
1. Tighten word choice (replace long phrases with concise alternatives)
2. Reduce bullet length (trim filler words, keep all content)
3. Merge similar skills (combine overlapping categories)
4. Reduce spacing (compact layout)

NEVER:
- Remove bullets, experience entries, education entries, or languages
- Change dates, company names, job titles
- Invent or remove factual content
- Change section order
`;
}

/**
 * Build a PROFESSIONAL WRITING directive.
 */
export function buildProfessionalWritingDirective(
  config: OptimizerDirectiveConfig | null | undefined,
  context?: DirectiveContext,
): string {
  const policy = buildOptimizationPolicy(config);
  const policyBlock = formatPolicyForPrompt(policy);

  return `${policyBlock}

═══════════════════════════════════════════════════════════════
PROFESSIONAL WRITING DIRECTIVE
═══════════════════════════════════════════════════════════════

Rewrite the resume as if written by a Senior Executive Recruiter.

RULES:
1. Improve grammar, clarity, impact, tone, and professionalism.
2. Use recruiter-grade wording — transform weak phrases into high-impact statements.
3. Never invent facts, remove facts, change chronology, employers, or schools.
4. Every sentence must sound authoritative and confident.
5. Use industry-recognized terminology naturally.
6. Maintain factual accuracy above all else.
`;
}

/**
 * Build an ATS-OPTIMIZED directive.
 */
export function buildAtsDirective(
  config: OptimizerDirectiveConfig | null | undefined,
  context?: DirectiveContext,
): string {
  const policy = buildOptimizationPolicy(config);
  const policyBlock = formatPolicyForPrompt(policy);

  const jdBlock = context?.jobDescription
    ? `JOB DESCRIPTION:\n${context.jobDescription}`
    : "No job description provided.";

  return `${policyBlock}

═══════════════════════════════════════════════════════════════
ATS OPTIMIZATION DIRECTIVE
═══════════════════════════════════════════════════════════════

Optimize the resume for maximum ATS compatibility.

STRATEGY:
1. Identify critical keywords (must-haves from JD).
2. Identify secondary keywords (nice-to-haves).
3. Embed ALL keywords NATURALLY — never stuff.
4. Use industry-recognized terminology.
5. Maintain factual accuracy — never invent.

${jdBlock}

OUTPUT: Return full resume JSON (same shape as standard directive) with ATS-optimized content.
`;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Get a directive by type.
 *
 * This is the SINGLE entry point for all directive generation.
 * Every part of the system that needs a directive calls this function.
 *
 * @example
 *   import { getDirective } from "./optimizer-directive-engine";
 *   const directive = getDirective("standard", config);
 *   const result = await callAI({ systemPrompt: directive, ... });
 */
export function getDirective(
  type: DirectiveType,
  config: OptimizerDirectiveConfig | null | undefined,
  context?: DirectiveContext,
): string {
  switch (type) {
    case "standard":
      return buildStandardDirective(config, context);
    case "aviation":
      return buildAviationDirective(config, context);
    case "guardian":
      return buildGuardianDirective(config, context);
    case "compression":
      return buildCompressionDirective(config, context);
    case "bullet":
      return buildBulletDirective(config, context);
    case "policy":
      return formatPolicyForPrompt(buildOptimizationPolicy(config));
    case "professional-writing":
      return buildProfessionalWritingDirective(config, context);
    case "ats":
      return buildAtsDirective(config, context);
    default:
      return buildStandardDirective(config, context);
  }
}
