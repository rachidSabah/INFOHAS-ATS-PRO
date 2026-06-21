// ResumeAI Pro — AI Error Leak Prevention
// Scans generated resume content for AI error messages, system messages,
// debug info, and other leaks that should NEVER appear in a final resume.
//
// If any leaks are detected, they are stripped out and replaced with
// clean content (or the resume is rejected entirely if too many leaks).

"use client";

import type { ResumeData } from "./types";

/**
 * Patterns that indicate an AI error leak in generated content.
 * If any of these appear in the resume, the content is contaminated.
 */
const ERROR_LEAK_PATTERNS: RegExp[] = [
  // Explicit error messages
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
  // HTTP error codes leaking into content
  /\b429\b.*rate.?limit/i,
  /\b429\b.*too.?many/i,
  /\b401\b.*unauthor/i,
  /\b403\b.*forbidden/i,
  /\b404\b.*not.?found/i,
  /\b500\b.*server.?error/i,
  /rate.?limit(?:ed)?/i,
  /too.?many.?requests/i,
  /quota.?exceeded/i,
  /api.?key.?invalid/i,
  /authentication.?failed/i,
  /model.?not.?found/i,
  /not_found_error/i,
  /insufficient.?quota/i,
  /service.?unavailable/i,
  /internal.?server.?error/i,
  /connection.?refused/i,
  /connection.?timeout/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  // Provider names leaking into content
  /\b(claude-sonnet|gpt-4o-mini|gpt-5-nano|deepseek|putern?\.js|z\.ai)\b/i,
  // Code-like patterns
  /\bundefined\b/i,
  /\bnull\b/i,
  /\[object object\]/i,
  /```json/i,
  /```/i,
  // ATS/optimization metadata that should never appear in a resume
  /\b(ats score|keyword match|requirements match|optimization notes|ai notes)\b/i,
];

/**
 * Forbidden section titles that should never appear in a resume.
 * The reference template only allows: Header, Summary, Skills, Experience, Education, Languages.
 */
const FORBIDDEN_SECTIONS = [
  "requirements match",
  "ats analysis",
  "keyword match",
  "additional information",
  "ai notes",
  "optimization notes",
  "provider errors",
  "system messages",
  "debug information",
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cleanedResume: ResumeData | null;
}

/**
 * Validate a resume for AI error leaks and forbidden content.
 * Returns a validation result with the cleaned resume (if salvageable).
 */
export function validateResumeContent(resume: ResumeData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check all text fields for error leaks
  const fieldsToCheck: { name: string; value: string }[] = [
    { name: "name", value: resume.name || "" },
    { name: "headline", value: resume.headline || "" },
    { name: "summary", value: resume.summary || "" },
  ];

  for (const e of resume.experience) {
    fieldsToCheck.push({ name: `experience[${e.title}].title`, value: e.title });
    fieldsToCheck.push({ name: `experience[${e.title}].company`, value: e.company });
    fieldsToCheck.push({ name: `experience[${e.title}].bullets`, value: e.bullets.join(" ") });
  }

  for (const s of resume.skills) {
    fieldsToCheck.push({ name: `skills[${s.name}]`, value: s.name });
  }

  for (const ed of resume.education) {
    fieldsToCheck.push({ name: `education[${ed.degree}]`, value: `${ed.degree} ${ed.institution}` });
    if (ed.highlights) fieldsToCheck.push({ name: `education[${ed.degree}].highlights`, value: ed.highlights.join(" ") });
  }

  for (const l of resume.languages) {
    fieldsToCheck.push({ name: `languages[${l.name}]`, value: `${l.name} ${l.proficiency}` });
  }

  for (const field of fieldsToCheck) {
    for (const pattern of ERROR_LEAK_PATTERNS) {
      if (pattern.test(field.value)) {
        errors.push(`AI error leak detected in "${field.name}": matches pattern "${pattern.source}"`);
      }
    }
  }

  // Check for keyword stuffing (same keyword repeated 5+ times in summary)
  if (resume.summary) {
    const words = resume.summary.toLowerCase().match(/\b[a-z][a-z0-9+#.\s-]+\b/g) || [];
    const freq: Record<string, number> = {};
    for (const w of words) {
      const trimmed = w.trim();
      if (trimmed.length > 3) freq[trimmed] = (freq[trimmed] || 0) + 1;
    }
    const stuffed = Object.entries(freq).filter(([_, count]) => count >= 4);
    for (const [word, count] of stuffed) {
      warnings.push(`Possible keyword stuffing: "${word}" appears ${count} times in summary`);
    }
  }

  // If there are errors, the resume is invalid
  const valid = errors.length === 0;

  // Try to clean the resume by stripping error messages from text fields
  const cleanedResume = valid ? resume : cleanResume(resume);

  return {
    valid,
    errors,
    warnings,
    cleanedResume: cleanedResume,
  };
}

/**
 * Attempt to clean error leaks from a resume.
 * Strips error messages, but if too many leaks, returns null (unsalvageable).
 */
function cleanResume(resume: ResumeData): ResumeData | null {
  const cleaned: ResumeData = {
    ...resume,
    summary: stripErrors(resume.summary || ""),
    experience: resume.experience.map((e) => ({
      ...e,
      title: stripErrors(e.title),
      company: stripErrors(e.company),
      bullets: e.bullets.map((b) => stripErrors(b)).filter((b) => b.length > 0),
    })),
    skills: resume.skills.filter((s) => !hasErrorLeak(s.name)),
    education: resume.education.map((ed) => ({
      ...ed,
      degree: stripErrors(ed.degree),
      institution: stripErrors(ed.institution),
      highlights: ed.highlights?.map((h) => stripErrors(h)).filter((h) => h.length > 0),
    })),
    languages: resume.languages.filter((l) => !hasErrorLeak(l.name) && !hasErrorLeak(l.proficiency)),
  };

  // If the summary is empty after cleaning, the resume is unsalvageable
  if (!cleaned.summary || cleaned.summary.length < 30) return null;
  if (cleaned.experience.length === 0) return null;

  return cleaned;
}

function stripErrors(text: string): string {
  let cleaned = text;
  for (const pattern of ERROR_LEAK_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  // Clean up extra whitespace
  return cleaned.replace(/\s+/g, " ").trim();
}

function hasErrorLeak(text: string): boolean {
  return ERROR_LEAK_PATTERNS.some((p) => p.test(text));
}

/**
 * Check if a section title is forbidden.
 * The reference template only allows specific sections.
 */
export function isForbiddenSection(title: string): boolean {
  const lower = title.toLowerCase();
  return FORBIDDEN_SECTIONS.some((forbidden) => lower.includes(forbidden));
}

/**
 * Allowed section titles (in order).
 * Any section not in this list is forbidden.
 */
export const ALLOWED_SECTIONS = [
  "professional summary",
  "core competencies & skills",
  "core competencies",
  "skills",
  "professional experience",
  "experience",
  "education",
  "languages",
] as const;
