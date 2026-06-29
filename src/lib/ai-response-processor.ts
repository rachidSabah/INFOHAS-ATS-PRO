// ResumeAI Pro — AI Response Processing Layer (Hardened v2025.01.15)
// This layer sits BETWEEN the AI provider response and the resume builder.
// It detects response type, validates, normalizes, and prevents ANY error
// from leaking into the generated document.
//
// Pipeline:
//   Provider Response → Response Type Detection → Validation → Normalization → Resume Builder
//
// If JSON parsing fails:
//   JSON Repair → Retry → Fallback Provider → User Notification
//   NEVER render errors inside PDF or DOCX.

"use client";

import { extractJSON } from "./ai";
import type { ResumeData, ResumeLanguage } from "./types";

export type ResponseType = "json" | "markdown" | "plain_text" | "streaming" | "tool_call" | "error";

export interface ProcessedAIResponse<T = any> {
  success: boolean;
  type: ResponseType;
  data: T | null;
  rawText: string;
  normalizedText: string;
  errors: string[];
  warnings: string[];
  provider: string;
  // If true, the response is safe to use in a document
  safeForDocument: boolean;
  // If the response was repaired (JSON fixed, errors stripped, etc.)
  repaired: boolean;
  repairActions: string[];
}

/**
 * ERROR LEAK PATTERNS — comprehensive list of patterns that MUST NEVER
 * appear in a generated resume, cover letter, interview, or PDF.
 *
 * If ANY of these are found in the AI response, the response is either
 * repaired (stripped) or rejected entirely.
 */
const LEAK_PATTERNS: RegExp[] = [
  // === Explicit error messages ===
  /optimization incomplete/i,
  /ai did not return/i,
  /ai returned non-?json/i,
  /failed to (generate|parse|optimize|produce)/i,
  /fallback (to|result|mode)/i,
  /provider (error|failed|unavailable)/i,
  /json (error|parse error|extraction failed)/i,
  /system (error|message|response)/i,
  /debug (info|message|output)/i,
  /retry (failed|attempt|message)/i,
  /raw ai response/i,
  /raw response/i,
  /please try again/i,
  /check that your (default )?ai provider/i,
  /prose response/i,
  /non-?json output/i,
  /unexpected token/i,
  /syntaxerror/i,
  /referenceerror/i,
  /typeerror/i,

  // === HTTP error codes ===
  /\b429\b/i,
  /\b401\b/i,
  /\b403\b/i,
  /\b404\b/i,
  /\b500\b/i,
  /rate.?limit/i,
  /too.?many.?requests/i,
  /quota.?exceeded/i,
  /api.?key.?invalid/i,
  /authentication.?failed/i,
  /model.?not.?found/i,
  /not_found_error/i,
  /insufficient.?quota/i,
  /service.?unavailable/i,
  /internal.?server.?error/i,
  /connection.?(refused|timeout|failed)/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,

  // === Provider names leaking ===
  /provider:\s*local\s*engine/i,
  /provider:\s*puter/i,
  /provider:\s*deepseek/i,
  /provider:\s*opencode/i,
  /local engine/i,

  // === Code-like patterns ===
  /\bundefined\b/i,
  /\[object object\]/i,
  /```json/i,
  /```\s*$/m,

  // === ATS/optimization metadata that should never appear in a resume ===
  /\b(ats score|keyword match|requirements match|optimization notes|ai notes)\b/i,

  // === Stack traces ===
  /at\s+\w+\s+\([^)]+\):\d+:\d+/i,
  /at\s+Object\./i,
  /at\s+async/i,

  // === Forbidden section titles ===
  /\b(requirements match|ats analysis|keyword match|additional information|ai notes|optimization notes|provider errors|system messages|debug information)\b/i,

  // === ANALYSIS ARTIFACTS — the AI is outputting analysis instead of resume content ===
  // These patterns indicate the AI is describing the resume rather than writing it
  /the original resume\b/i,
  /the (candidate'?s? )?resume (lacks|is missing|could be|would benefit|needs)/i,
  /missing keywords?\s*:/i,
  /keyword gap/i,
  /from jd\s*:/i,
  /ats analysis/i,
  /optimization notes/i,
  /recommendations?\s*:/i,
  /suggested improvement/i,
  /score explanation/i,
  /reasoning\s*:/i,
  /thought process/i,
  /the resume (does not|doesn'?t|fails to|could)/i,
  /this (resume|candidate) (would|should|could|needs|lacks)/i,
  /areas? (for|of) improvement/i,
  /identified gaps/i,
  /found \d+ missing/i,
  /the following keywords?\s*(are|were) (missing|absent|not)/i,
  /to improve the (resume|ats score)/i,
  /recommended changes?\s*:/i,
  /changes? made\s*:/i,
  /what was changed\s*:/i,
  /summary of (changes|optimization|improvements)/i,
  /analysis of the (resume|job|jd)/i,
  /the ai (has|identified|found|determined)/i,
  /based on the (job description|analysis|ats)/i,
  /required skills?\s*:/i,
  /missing skills?\s*:/i,
  /keywords? identified\s*:/i,
  /keyword density/i,
  /the summary should/i,
  /the experience section/i,
  /the skills section/i,
  /the education section/i,
  /the languages section/i,
  /this section (needs|should|could|lacks)/i,
  /here (is|are) the (optimized|improved|generated)/i,
  /here (is|are) your (resume|analysis|report)/i,
  /i have (optimized|improved|updated|rewritten|generated)/i,
  /i (added|removed|included|embedded|modified|changed)/i,
  /the (above )?changes (will|should|improve)/i,
];

/**
 * FORBIDDEN SKILL PATTERNS — company names, locations, and other non-skills
 * that should NEVER appear in the skills section of a resume.
 */
const FORBIDDEN_SKILL_PATTERNS: RegExp[] = [
  // Company names (major employers that commonly leak into skills)
  /\bqatar duty free\b/i,
  /\bqatar airways\b/i,
  /\bhamad international\b/i,
  /\bqdfc\b/i,
  /\bretail company\b/i,
  /\bbeauty retailer\b/i,
  /\bduty free\b/i,
  // Locations (cities, countries, airports)
  /\bdoha\b/i,
  /\bqatar\b/i,
  /\bdubai\b/i,
  /\babu dhabi\b/i,
  /\buae\b/i,
  /\briyadh\b/i,
  /\bsaudi arabia\b/i,
  /\bkuwait\b/i,
  /\bbahrain\b/i,
  /\boman\b/i,
  /\bmuscat\b/i,
  // Generic non-skills
  /\bunknown\b/i,
  /\bn\/a\b/i,
  /\bplaceholder\b/i,
  /\bsample skill\b/i,
  /\bexample skill\b/i,
  /\bskill gap\b/i,
  /\bmissing skill\b/i,
  // Years (not skills)
  /^(19|20)\d{2}$/,
  /^\d{4}-\d{4}$/,
];

/**
 * Check if a skill name is forbidden (company name, location, etc.)
 */
export function isForbiddenSkill(skillName: string): boolean {
  if (!skillName || skillName.trim().length === 0) return true;
  const trimmed = skillName.trim();
  return FORBIDDEN_SKILL_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Filter forbidden skills from a skills list.
 * Returns the filtered list + list of removed skills for logging.
 * Generic over the skill type so it preserves the original type (ResumeSkill, etc.).
 */
export function filterForbiddenSkills<T extends { name: string; category?: string }>(skills: T[]): {
  filtered: T[];
  removed: string[];
} {
  const filtered: T[] = [];
  const removed: string[] = [];
  for (const skill of skills) {
    if (isForbiddenSkill(skill.name)) {
      removed.push(skill.name);
    } else {
      filtered.push(skill);
    }
  }
  return { filtered, removed };
}

/**
 * Detect the type of AI response.
 */
export function detectResponseType(text: string): ResponseType {
  if (!text || !text.trim()) return "error";
  const trimmed = text.trim();

  // Check for JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/```json/i.test(trimmed)) return "json";

  // Check for markdown
  if (/^#{1,6}\s/m.test(trimmed) || /\*\*[^*]+\*\*/m.test(trimmed)) return "markdown";

  // Check for tool/function call
  if (/tool_call|function_call/i.test(trimmed)) return "tool_call";

  // Check for error patterns
  if (LEAK_PATTERNS.some((p) => p.test(trimmed))) return "error";

  return "plain_text";
}

/**
 * Check if text contains any error leak patterns.
 * Returns the list of matched patterns.
 */
export function detectLeaks(text: string): string[] {
  const leaks: string[] = [];
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(text)) {
      leaks.push(pattern.source);
    }
  }
  return leaks;
}

/**
 * Strip error leak patterns from text.
 * Returns the cleaned text and the list of repairs made.
 */
export function stripLeaks(text: string): { cleaned: string; repairs: string[] } {
  const repairs: string[] = [];
  let cleaned = text;

  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, "");
      repairs.push(`Stripped pattern: ${pattern.source.slice(0, 40)}`);
    }
  }

  // Clean up extra whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").replace(/\s{2,}/g, " ").trim();

  return { cleaned, repairs };
}

/**
 * Strip pipe characters from resume text fields — pipes break ATS parsing
 * and should never appear in job titles, company names, or section headers.
 */
export function stripPipesFromResume(resume: ResumeData): ResumeData {
  const clean = (text: string | undefined | null): string => (text || "").replace(/\|/g, "·");
  return {
    ...resume,
    summary: clean(resume.summary || ""),
    headline: clean(resume.headline || ""),
    experience: resume.experience.map((e) => ({
      ...e,
      title: clean(e.title),
      company: clean(e.company),
      location: clean(e.location),
      bullets: e.bullets.map((b) => clean(b)),
    })),
    skills: resume.skills.map((s) => ({
      ...s,
      name: clean(s.name),
      category: s.category ? clean(s.category) : undefined,
    })),
    education: resume.education.map((ed) => ({
      ...ed,
      degree: clean(ed.degree),
      institution: clean(ed.institution),
      location: clean(ed.location),
      highlights: ed.highlights?.map((h) => clean(h)),
    })),
    languages: resume.languages.map((l) => ({
      ...l,
      name: clean(l.name),
      proficiency: clean(l.proficiency) as ResumeLanguage["proficiency"],
    })),
  };
}

/**
 * Attempt to repair malformed JSON.
 * Common issues: trailing commas, unquoted keys, single quotes, comments.
 */
export function repairJSON(text: string): { json: any | null; repaired: boolean; repairs: string[] } {
  const repairs: string[] = [];
  let cleaned = text.trim();

  // Strip markdown fences
  cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();

  // Try direct parse first
  try {
    return { json: JSON.parse(cleaned), repaired: false, repairs: [] };
  } catch {
    // Continue to repair
  }

  // Fix 1: Remove trailing commas
  const noTrailingCommas = cleaned.replace(/,\s*([}\]])/g, "$1");
  if (noTrailingCommas !== cleaned) {
    repairs.push("Removed trailing commas");
    cleaned = noTrailingCommas;
  }

  // Fix 2: Quote unquoted keys
  const quotedKeys = cleaned.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  if (quotedKeys !== cleaned) {
    repairs.push("Quoted unquoted keys");
    cleaned = quotedKeys;
  }

  // Fix 3: Replace single quotes with double quotes
  const doubleQuotes = cleaned.replace(/'/g, '"');
  if (doubleQuotes !== cleaned) {
    repairs.push("Replaced single quotes with double quotes");
    cleaned = doubleQuotes;
  }

  // Fix 4: Extract JSON object from prose
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch && jsonMatch[0] !== cleaned) {
    repairs.push("Extracted JSON from prose preamble");
    cleaned = jsonMatch[0];
  }

  // Try to parse the repaired JSON
  try {
    return { json: JSON.parse(cleaned), repaired: true, repairs };
  } catch {
    // Still failed — try repairMalformedJSON
    const malformed = repairMalformedJSON(cleaned);
    if (malformed.json) {
      return { json: malformed.json, repaired: true, repairs: [...repairs, ...malformed.repairs] };
    }
    return { json: null, repaired: false, repairs };
  }
}

/**
 * Strip markdown from text — removes code fences, bold/italic markers,
 * headers, and other markdown syntax that breaks JSON parsing.
 */
export function stripMarkdown(text: string): string {
  if (!text) return text;
  let result = text;
  // Remove code fences
  result = result.replace(/```[\w]*\n?/g, "").replace(/```/g, "");
  // Remove bold/italic markers
  result = result.replace(/\*\*\*(.*?)\*\*\*/g, "$1").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
  // Remove headers
  result = result.replace(/^#+\s+/gm, "");
  // Remove links [text](url) → text
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Remove horizontal rules
  result = result.replace(/^---+$/gm, "");
  // Remove blockquotes
  result = result.replace(/^>\s+/gm, "");
  return result.trim();
}

/**
 * Repair malformed/truncated JSON that standard repairJSON couldn't fix.
 * Handles: truncated JSON, broken strings, missing brackets, invalid arrays.
 */
export function repairMalformedJSON(text: string): { json: any | null; repairs: string[] } {
  const repairs: string[] = [];
  let cleaned = text.trim();

  // Strategy 1: Close unclosed brackets
  const openBraces = (cleaned.match(/\{/g) || []).length;
  const closeBraces = (cleaned.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    const missing = openBraces - closeBraces;
    cleaned += "}".repeat(missing);
    repairs.push(`Added ${missing} missing closing brace(s)`);
  }

  const openBrackets = (cleaned.match(/\[/g) || []).length;
  const closeBrackets = (cleaned.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    const missing = openBrackets - closeBrackets;
    cleaned += "]".repeat(missing);
    repairs.push(`Added ${missing} missing closing bracket(s)`);
  }

  try {
    return { json: JSON.parse(cleaned), repairs };
  } catch { /* continue */ }

  // Strategy 2: Close unclosed strings
  const doubleQuoteCount = (cleaned.match(/"/g) || []).length;
  if (doubleQuoteCount % 2 !== 0) {
    cleaned += '"';
    repairs.push("Added missing closing quote");
  }

  try {
    return { json: JSON.parse(cleaned), repairs };
  } catch { /* continue */ }

  // Strategy 3: Remove the last incomplete property (common in truncated output)
  // e.g., {"name":"John","age":30,"skills":["SQL","Python"," → remove last incomplete
  const lastComma = cleaned.lastIndexOf(",");
  if (lastComma > cleaned.lastIndexOf("}") && lastComma > cleaned.lastIndexOf("]")) {
    cleaned = cleaned.slice(0, lastComma);
    // Reclose brackets
    const ob = (cleaned.match(/\{/g) || []).length;
    const cb = (cleaned.match(/\}/g) || []).length;
    if (ob > cb) cleaned += "}".repeat(ob - cb);
    const obr = (cleaned.match(/\[/g) || []).length;
    const cbr = (cleaned.match(/\]/g) || []).length;
    if (obr > cbr) cleaned += "]".repeat(obr - cbr);
    repairs.push("Removed last incomplete property (truncated output)");
  }

  try {
    return { json: JSON.parse(cleaned), repairs };
  } catch {
    return { json: null, repairs };
  }
}

/**
 * Validate that a JSON object has the required fields and types.
 * Returns a list of validation errors (empty = valid).
 */
export function validateJSON(
  data: any,
  schema: { required?: string[]; types?: Record<string, string> },
): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return ["Data is not an object"];
  }

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (data[field] === undefined || data[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check types
  if (schema.types) {
    for (const [field, expectedType] of Object.entries(schema.types)) {
      if (data[field] !== undefined && data[field] !== null) {
        const actualType = Array.isArray(data[field]) ? "array" : typeof data[field];
        if (actualType !== expectedType) {
          errors.push(`Field "${field}" should be ${expectedType}, got ${actualType}`);
        }
      }
    }
  }

  return errors;
}

/**
 * Process an AI response through the full pipeline:
 *   1. Detect response type
 *   2. Check for error leaks
 *   3. If JSON: repair if needed
 *   4. Strip any remaining leaks
 *   5. Validate safety for document rendering
 *
 * Returns a ProcessedAIResponse that tells the caller whether the response
 * is safe to use in a document.
 */
export function processAIResponse<T = any>(
  rawText: string,
  provider: string,
  options?: { expectJson?: boolean },
): ProcessedAIResponse<T> {
  const repairActions: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Step 1: Detect response type
  const type = detectResponseType(rawText);

  // Step 2: Check for error leaks
  const leaks = detectLeaks(rawText);
  if (leaks.length > 0) {
    warnings.push(`Detected ${leaks.length} error leak pattern(s)`);
  }

  // Step 3: If JSON expected, try to parse + repair
  let data: T | null = null;
  let normalizedText = rawText;

  if (options?.expectJson || type === "json") {
    // Try extractJSON first (handles prose preambles, markdown fences)
    try {
      data = extractJSON<T>(rawText);
    } catch {
      // extractJSON failed — try repair
      const repair = repairJSON(rawText);
      if (repair.json) {
        data = repair.json as T;
        repairActions.push(...repair.repairs);
        repairActions.push("JSON repaired successfully");
      } else {
        errors.push("JSON parsing failed even after repair");
      }
    }
  }

  // Step 4: Strip leaks from the text
  if (leaks.length > 0) {
    const stripped = stripLeaks(rawText);
    normalizedText = stripped.cleaned;
    repairActions.push(...stripped.repairs);
  }

  // Step 4.5: Grammar cleanup — fix double periods, remove filler phrases
  normalizedText = cleanupGrammar(normalizedText);

  // Also clean up grammar in parsed data (resume fields)
  if (data && typeof data === "object") {
    data = cleanupResumeGrammar(data) as T;
  }

  // Step 5: Validate safety for document rendering
  const remainingLeaks = detectLeaks(normalizedText);
  const safeForDocument = remainingLeaks.length === 0 && type !== "error";

  if (remainingLeaks.length > 0) {
    errors.push(`${remainingLeaks.length} error leak(s) could not be stripped — response is NOT safe for documents`);
  }

  return {
    success: data !== null || (type !== "error" && safeForDocument),
    type,
    data,
    rawText,
    normalizedText,
    errors,
    warnings,
    provider,
    safeForDocument,
    repaired: repairActions.length > 0,
    repairActions,
  };
}

/**
 * Validate a resume for document safety.
 * This is the FINAL check before rendering to PDF/DOCX.
 * If this returns false, the resume MUST NOT be rendered.
 */
export function validateResumeForExport(resume: ResumeData): {
  valid: boolean;
  errors: string[];
  cleanedResume: ResumeData | null;
} {
  const errors: string[] = [];
  const allText = [
    resume.name,
    resume.headline,
    resume.summary,
    ...resume.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...resume.skills.map((s) => s.name),
    ...resume.education.flatMap((ed) => [ed.degree, ed.institution, ...(ed.highlights || [])]),
    ...resume.languages.map((l) => `${l.name} ${l.proficiency}`),
    resume.additionalInfo,
    ...(resume.dynamicSections || []).flatMap((ds) => [ds.title, ds.content, ...(ds.bullets || [])]),
  ].filter(Boolean).join(" ");

  const leaks = detectLeaks(allText);
  if (leaks.length > 0) {
    errors.push(`Found ${leaks.length} error leak(s) in resume content`);
  }

  if (errors.length > 0) {
    // Try to clean the resume
    const cleaned = stripLeaksFromResume(resume);
    // Also strip pipe characters
    if (cleaned) {
      const pipesCleaned = stripPipesFromResume(cleaned);
      return { valid: false, errors, cleanedResume: pipesCleaned };
    }
    return { valid: false, errors, cleanedResume: null };
  }

  // Always strip pipe characters before export
  const cleanedResume = stripPipesFromResume(resume);
  return { valid: true, errors: [], cleanedResume };
}

/**
 * Strip error leaks from all text fields in a resume.
 * Returns null if the resume is unsalvageable (too many leaks).
 */
function stripLeaksFromResume(resume: ResumeData): ResumeData | null {
  const clean = (text: string): string => {
    let cleaned = text;
    for (const pattern of LEAK_PATTERNS) {
      cleaned = cleaned.replace(pattern, "");
    }
    return cleaned.replace(/\s+/g, " ").trim();
  };

  const cleaned: ResumeData = {
    ...resume,
    summary: clean(resume.summary || ""),
    experience: resume.experience.map((e) => ({
      ...e,
      title: clean(e.title),
      company: clean(e.company),
      bullets: e.bullets.map(clean).filter((b) => b.length > 0),
    })),
    skills: resume.skills.filter((s) => detectLeaks(s.name).length === 0),
    education: resume.education.map((ed) => ({
      ...ed,
      degree: clean(ed.degree),
      institution: clean(ed.institution),
      highlights: ed.highlights?.map(clean).filter((h) => h.length > 0),
    })),
    languages: resume.languages.filter((l) => detectLeaks(`${l.name} ${l.proficiency}`).length === 0),
    additionalInfo: resume.additionalInfo ? clean(resume.additionalInfo) : undefined,
    dynamicSections: (resume.dynamicSections || []).map((ds) => ({
      ...ds,
      title: clean(ds.title),
      content: ds.content ? clean(ds.content) : "",
      bullets: ds.bullets ? ds.bullets.map(clean).filter((b) => b.length > 0) : [],
    })).filter((ds) => ds.title.length > 0 && (ds.content || ds.bullets.length > 0)),
  };

  // If summary is too short after cleaning, the resume is unsalvageable
  if (!cleaned.summary || cleaned.summary.length < 30) return null;
  if (cleaned.experience.length === 0) return null;

  return cleaned;
}

/**
 * QUALITY GATE — check if a resume reads like a professional resume
 * and NOT like an ATS report, AI analysis, or keyword gap report.
 *
 * A document may only be exported if:
 * - It reads like a professional resume
 * - It does not read like an ATS audit report
 * - It does not read like an AI analysis report
 * - It does not read like a keyword gap report
 */
export function isProfessionalResume(resume: ResumeData): {
  professional: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const allText = [
    resume.summary || "",
    ...resume.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...resume.skills.map((s) => s.name),
    ...resume.education.flatMap((ed) => [ed.degree, ed.institution, ...(ed.highlights || [])]),
  ].join(" ");

  // Check for analysis artifacts
  const leaks = detectLeaks(allText);
  if (leaks.length > 0) {
    issues.push(`Contains ${leaks.length} analysis/error artifact(s)`);
  }

  // Summary must describe the candidate, not the resume
  if (resume.summary) {
    const summaryLower = resume.summary.toLowerCase();
    const analysisPhrases = [
      "the original resume", "missing keywords", "keyword gap", "from jd:",
      "ats analysis", "optimization notes", "recommendations:", "suggested improvement",
      "score explanation", "reasoning:", "thought process", "the resume does not",
      "this candidate would", "areas for improvement", "identified gaps",
      "required skills:", "missing skills:", "keywords identified:",
      "here is the optimized", "i have improved", "i added the following",
      "based on the job description", "the ai has identified",
    ];
    for (const phrase of analysisPhrases) {
      if (summaryLower.includes(phrase)) {
        issues.push(`Summary contains analysis phrase: "${phrase}"`);
        break;
      }
    }
  }

  // Skills must not contain JD references
  for (const skill of resume.skills) {
    const skillLower = skill.name.toLowerCase();
    const catLower = (skill.category || "").toLowerCase();
    if (skillLower.includes("from jd") || skillLower.includes("missing skill") || skillLower.includes("keyword identified") ||
        catLower.includes("from jd") || catLower.includes("missing") || catLower.includes("keyword")) {
      issues.push(`Skill "${skill.name}" (category: ${skill.category || "none"}) contains JD/analysis reference`);
      break;
    }
  }

  return {
    professional: issues.length === 0,
    issues,
  };
}

// ============================================================================
// Grammar Cleanup — fixes common AI output issues
// ============================================================================

const FILLER_PHRASES = [
  // === Generic template phrases that repeat across bullets ===
  /demonstrating strong attention to detail/gi,
  /committed to excellence in all assigned responsibilities/gi,
  /committed to delivering exceptional results/gi,
  /demonstrating reliability and professionalism/gi,
  /consistently meeting operational standards/gi,
  /contributing to team objectives/gi,
  // === "within <Title>" hallucinations — AI inserts the job title as if it were a company ===
  // e.g., "within Intern", "within Receptionist", "within Sales Assistant"
  /\bwithin\s+(?:Intern|Receptionist|Sales Assistant|Cashier|Clerk|Attendant|Steward|Trainee|Apprentice|Associate|Assistant|Manager|Supervisor|Coordinator|Administrator|Specialist|Representative|Agent|Officer|Director|Lead|Head|Captain|Host|Hostess|Waiter|Waitress|Bartender|Barista|Concierge|Porter|Bellhop|Housekeeper|Pilot|Nurse|Therapist|Technician|Mechanic|Teacher|Professor|Accountant|Auditor|Lawyer|Writer|Chef|Cook|Baker|Engineer|Developer|Designer|Architect|Analyst|Consultant)\b/gi,
  // === "at <Title>" hallucinations — same issue, AI uses title as company ===
  /\bat\s+(?:Intern|Receptionist|Sales Assistant|Cashier|Clerk|Attendant|Steward|Trainee|Apprentice|Associate|Assistant|Manager|Supervisor|Coordinator|Administrator|Specialist|Representative|Agent|Officer|Director|Lead|Head|Captain|Host|Hostess|Waiter|Waitress|Bartender|Barista|Concierge|Porter|Bellhop|Housekeeper|Pilot|Nurse|Therapist|Technician|Mechanic|Teacher|Professor|Accountant|Auditor|Lawyer|Writer|Chef|Cook|Baker|Engineer|Developer|Designer|Architect|Analyst|Consultant)\b/gi,
  // === "in the <Title> position at <Title>" hallucinations ===
  /\bin the\s+(?:Intern|Receptionist|Sales Assistant|Cashier|Clerk|Attendant|Steward|Trainee|Apprentice|Associate|Assistant|Manager|Supervisor|Coordinator|Administrator|Specialist|Representative|Agent|Officer|Director|Lead|Head)\s+position\b/gi,
  /\bat\s+(?:Intern|Receptionist|Sales Assistant|Cashier|Clerk|Attendant|Steward|Trainee|Apprentice|Associate|Assistant|Manager|Supervisor|Coordinator|Administrator|Specialist|Representative|Agent|Officer|Director|Lead|Head)\s+position/gi,
  // === "demonstrating strong attention to detail and commitment to excellence in all assigned responsibilities within X" ===
  // (catch the full compound phrase even when title is not in the list above)
  /demonstrating strong attention to detail and commitment to excellence in all assigned responsibilities(?:\s+within\s+\w+)?/gi,
  /demonstrating strong attention to detail and commitment to excellence(?:\s+within\s+\w+)?/gi,
];

/**
 * Fix common grammar issues in AI-generated text:
 * - Double periods (.. → .)
 * - Filler phrases that repeat across bullets
 * - Extra spaces before periods/commas
 * - Stray backticks (`) that leak from code fences
 * - Orphaned trailing words (e.g., "skills and" with no continuation)
 * - Sentences ending with comma instead of period
 */
export function cleanupGrammar(text: string): string {
  if (!text) return text;
  let result = text;

  // Strip stray backticks (often leak from markdown code fences)
  result = result.replace(/`/g, "");

  // Fix double periods (.. → .)
  result = result.replace(/\.{2,}/g, ".");

  // Fix triple+ periods (ellipsis) → single period
  result = result.replace(/\.{3,}/g, ".");

  // Fix space before period/comma ( ." → ".")
  result = result.replace(/\s+\./g, ".");
  result = result.replace(/\s+,/g, ",");

  // Remove filler phrases
  for (const phrase of FILLER_PHRASES) {
    result = result.replace(phrase, "");
  }

  // Clean up double spaces left by removals
  result = result.replace(/\s{2,}/g, " ");

  // Fix " ," → ","
  result = result.replace(/\s+,/g, ",");

  // Fix " ." → "."
  result = result.replace(/\s+\./g, ".");

  // Fix sentences that end with comma instead of period
  result = result.replace(/,\s*$/gm, ".");

  // Fix "word ," → "word,"
  result = result.replace(/\s+,/g, ",");

  // Remove empty bullets / bullets that are just punctuation
  result = result.replace(/^[\s.,;:|-]+$/gm, "");

  // Fix orphaned trailing words at end of text (e.g., "with a solid understanding of" with no continuation)
  // If the text ends with a preposition/article and no period, remove the trailing fragment
  result = result.replace(/\s+(?:of|in|on|at|with|for|and|the|a|an|to|by|from)\s*$/i, "");

  // Fix duplicate consecutive words ("the the" → "the")
  result = result.replace(/\b(\w+)\s+\1\b/gi, "$1");

  return result.trim();
}

/**
 * Clean up grammar in a parsed resume object.
 * Fixes double periods and filler phrases in all text fields.
 * Also strips stray backticks, normalizes whitespace, and removes
 * date fragments that leak into institution/degree fields.
 */
export function cleanupResumeGrammar<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const cleaned = JSON.parse(JSON.stringify(data)) as any;

  // Helper: strip date patterns from a field (e.g., "INFOHAS 2023 – 2025" → "INFOHAS")
  const stripDates = (text: string): string => {
    if (!text) return text;
    return text
      // Remove "2023 – 2025", "2023-2025", "2023 – Present", "Jan 2020 – Mar 2022"
      .replace(/\s+\d{4}\s*[–\-—]\s*(?:\d{4}|Present|Current)\s*/gi, " ")
      // Remove trailing duplicate date range (e.g., "2023 – 2025 2023 – 2025")
      .replace(/(\d{4}\s*[–\-—]\s*(?:\d{4}|Present|Current))\s+\1/gi, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  // Clean summary
  if (cleaned.summary) {
    cleaned.summary = cleanupGrammar(cleaned.summary);
  }

  // Clean headline
  if (cleaned.headline) {
    cleaned.headline = cleanupGrammar(cleaned.headline);
  }

  // Clean experience bullets + company + title
  if (Array.isArray(cleaned.experience)) {
    for (const exp of cleaned.experience) {
      if (Array.isArray(exp.bullets)) {
        exp.bullets = exp.bullets
          .map((b: string) => cleanupGrammar(b))
          .filter((b: string) => b && b.length > 0);
      }
      if (exp.title) exp.title = cleanupGrammar(exp.title);
      if (exp.company) exp.company = cleanupGrammar(exp.company);
      if (exp.location) exp.location = cleanupGrammar(exp.location);
    }
  }

  // Clean education — strip dates from institution, clean degree
  if (Array.isArray(cleaned.education)) {
    for (const edu of cleaned.education) {
      if (Array.isArray(edu.highlights)) {
        edu.highlights = edu.highlights.map((h: string) => cleanupGrammar(h));
      }
      if (edu.degree) {
        edu.degree = cleanupGrammar(edu.degree);
        // Strip "Specialized modules include: ..." from degree field (should be in highlights)
        edu.degree = edu.degree.replace(/Specialized modules include:.*$/i, "").trim();
      }
      if (edu.institution) {
        edu.institution = cleanupGrammar(edu.institution);
        // Strip dates that leaked into institution field
        edu.institution = stripDates(edu.institution);
      }
      if (edu.location) edu.location = cleanupGrammar(edu.location);
    }
  }

  // Clean skills (strip backticks, fix whitespace)
  if (Array.isArray(cleaned.skills)) {
    for (const skill of cleaned.skills) {
      if (skill.name) skill.name = cleanupGrammar(skill.name);
      if (skill.category) skill.category = cleanupGrammar(skill.category);
    }
  }

  // Clean languages
  if (Array.isArray(cleaned.languages)) {
    for (const lang of cleaned.languages) {
      if (lang.name) lang.name = cleanupGrammar(lang.name);
      if (lang.proficiency) lang.proficiency = cleanupGrammar(lang.proficiency);
    }
  }

  return cleaned as T;
}


