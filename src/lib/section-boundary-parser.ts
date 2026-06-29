// ============================================================================
// Section Boundary Parser
//
// Two-stage parser that replaces fragile lookahead-based regexes:
//
// Stage 1 — Section Detection:
//   Scan the document ONCE to identify every section heading.
//   The last section automatically extends to the end of the document.
//   No lookahead dependencies.
//
// Stage 2 — Section Extraction:
//   Extract content between recorded boundaries using simple substring/slice.
//   Works regardless of section order.
//
// Supports:
//   - Known sections (Summary, Experience, Education, Languages, etc.)
//   - Unknown/custom sections (any uppercase heading or synonym)
//   - Sections with colons (LANGUAGES:)
//   - Mixed capitalization
//   - No blank lines between sections
//   - Single-section documents
// ============================================================================

"use client";

import type { ResumeData } from "./types";
import { uid } from "./store";
import { detectLanguage } from "./parser-detect";

// Known language words for filtering false-positive headers
const KNOWN_LANGUAGE_WORDS = [
  "english", "french", "arabic", "spanish", "german", "italian", "chinese", "japanese",
  "russian", "portuguese", "hindi", "turkish", "korean", "dutch", "greek", "swedish",
  "polish", "hebrew", "indonesian", "malay", "norwegian", "danish", "finnish",
  "cantonese", "mandarin", "urdu", "bengali", "punjabi", "tamil", "telugu",
  "tagalog", "filipino", "swahili", "afrikaans", "kabyle", "berber", "amazigh",
];

// ============================================================================
// Types
// ============================================================================

export interface SectionBoundary {
  /** Original heading text as it appears in the document */
  title: string;
  /** Normalized title (uppercase, no colon) */
  normalizedTitle: string;
  /** Section type (summary, experience, education, etc.) */
  type: SectionType;
  /** Line index where the heading appears */
  startLine: number;
  /** Line index where the next section starts (or lines.length for last section) */
  endLine: number;
  /** Content lines between startLine+1 and endLine */
  contentLines: string[];
}

export type SectionType =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "languages"
  | "certifications"
  | "projects"
  | "achievements"
  | "personal"
  | "unknown";

// ============================================================================
// Section Synonym Registry
// ============================================================================

const SECTION_SYNONYMS: Record<string, SectionType> = {
  // Summary
  "summary": "summary",
  "professional summary": "summary",
  "professional profile": "summary",
  "profile": "summary",
  "objective": "summary",
  "career objective": "summary",
  "career profile": "summary",
  "about me": "summary",
  "career summary": "summary",

  // Experience
  "experience": "experience",
  "professional experience": "experience",
  "work experience": "experience",
  "employment": "experience",
  "employment history": "experience",
  "work history": "experience",
  "experiences": "experience",

  // Education
  "education": "education",
  "academic background": "education",
  "academic": "education",
  "qualifications": "education",
  "education and training": "education",

  // Skills
  "skills": "skills",
  "technical skills": "skills",
  "core skills": "skills",
  "core competencies": "skills",
  "core competencies & skills": "skills",
  "competencies": "skills",
  "key competencies": "skills",
  "key skills": "skills",
  "digital skills": "skills",

  // Languages
  "languages": "languages",
  "language": "languages",
  "language skills": "languages",
  "linguistic skills": "languages",

  // Certifications
  "certifications": "certifications",
  "certificates": "certifications",
  "licenses": "certifications",
  "licenses and certifications": "certifications",
  "licences": "certifications",

  // Projects
  "projects": "projects",
  "personal projects": "projects",
  "side projects": "projects",

  // Achievements
  "achievements": "achievements",
  "key achievements": "achievements",
  "awards": "achievements",
  "honors": "achievements",
  "awards & honors": "achievements",

  // Personal
  "personal informations": "personal",
  "personal information": "personal",
  "personal info": "personal",
  "personal details": "personal",
  "nationality": "personal",
  "additional information": "personal",
  "interests": "personal",
  "hobbies": "personal",
};

// ============================================================================
// Stage 1: Section Detection
// ============================================================================

/**
 * Detect all section boundaries in a document.
 *
 * Scans line-by-line. A line is considered a section heading if:
 *   1. It matches a known synonym (case-insensitive), OR
 *   2. It's short (< 60 chars), uppercase or title case, and ends with optional colon
 *
 * The last section's endLine is always the total number of lines.
 */
export function detectSectionBoundaries(lines: string[]): SectionBoundary[] {
  const boundaries: SectionBoundary[] = [];
  const headerIndices: Array<{ line: number; title: string; type: SectionType }> = [];

  // Detect all section headers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if line is a known section header
    const normalized = line.replace(/[:\s]+$/, "").toLowerCase().trim();
    const type = SECTION_SYNONYMS[normalized];

    if (type) {
      headerIndices.push({ line: i, title: line, type });
      continue;
    }

    // Check for unknown headers: short, uppercase or title case, with optional colon
    // BUT exclude lines that look like content (start with bullet, date, or have lowercase words)
    // Also exclude lines that contain known language names (e.g., "ENGLISH (ORAL/WRITTEN) :")
    // or proficiency words (e.g., "FLUENT", "NATIVE", "CONVERSATIONAL")
    const LANG_PROFICIENCY_WORDS = ["fluent", "native", "conversational", "basic", "intermediate", "beginner", "elementary", "bilingual"];
    const lowerLine = line.toLowerCase();
    const looksLikeLanguageContent = KNOWN_LANGUAGE_WORDS.some(lang => lowerLine.includes(lang)) ||
      LANG_PROFICIENCY_WORDS.some(prof => lowerLine === prof);

    if (
      line.length > 0 &&
      line.length < 60 &&
      !line.startsWith("•") &&
      !line.startsWith("-") &&
      !line.startsWith("*") &&
      !/^\d/.test(line) && // Not a date or number
      !/@/.test(line) && // Not an email
      !/\d{4}/.test(line) && // Not a year
      !looksLikeLanguageContent && // NOT a language name or proficiency word
      (
        // All uppercase with at least 2 letters (e.g., "PROFESSIONAL EXPERIENCE")
        // This is the primary signal for section headers
        (line === line.toUpperCase() && /[A-Z]{2,}/.test(line) && !/[a-z]/.test(line.replace(/[^a-zA-Z]/g, ""))) ||
        // Title case ending with colon (e.g., "Languages:")
        (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*:?$/.test(line) && line.endsWith(":"))
      )
    ) {
      // Check if it matches any synonym after normalization
      const synonymType = SECTION_SYNONYMS[normalized];
      if (synonymType) {
        headerIndices.push({ line: i, title: line, type: synonymType });
      } else {
        // Unknown section header — preserve it
        headerIndices.push({ line: i, title: line, type: "unknown" });
      }
    }
  }

  // Create boundaries: each section extends from its header to the next header
  for (let i = 0; i < headerIndices.length; i++) {
    const current = headerIndices[i];
    const next = i + 1 < headerIndices.length ? headerIndices[i + 1] : null;
    const endLine = next ? next.line : lines.length;
    const contentLines = lines.slice(current.line + 1, endLine).map(l => l.trim()).filter(Boolean);

    boundaries.push({
      title: current.title,
      normalizedTitle: current.title.replace(/[:\s]+$/, "").toUpperCase().trim(),
      type: current.type,
      startLine: current.line,
      endLine,
      contentLines,
    });
  }

  return boundaries;
}

// ============================================================================
// Stage 2: Section Extraction
// ============================================================================

/**
 * Extract all sections from a document using boundary detection.
 * Returns a map of section type → content lines.
 */
export function extractSections(text: string): Map<SectionType, string[]> {
  const lines = text.split(/\r?\n/);
  const boundaries = detectSectionBoundaries(lines);
  const sections = new Map<SectionType, string[]>();

  for (const boundary of boundaries) {
    if (boundary.type !== "unknown") {
      // For known sections, merge if the same type appears multiple times
      const existing = sections.get(boundary.type) || [];
      sections.set(boundary.type, [...existing, ...boundary.contentLines]);
    }
  }

  return sections;
}

/**
 * Get a specific section's content by type.
 * Returns empty array if section not found.
 */
export function getSectionContent(sections: Map<SectionType, string[]>, type: SectionType): string[] {
  return sections.get(type) || [];
}

/**
 * Get all unknown/custom sections (for preservation).
 */
export function getUnknownSections(boundaries: SectionBoundary[]): SectionBoundary[] {
  return boundaries.filter(b => b.type === "unknown");
}

// ============================================================================
// Logging / Instrumentation
// ============================================================================

export function logSectionDetection(boundaries: SectionBoundary[]): void {
  console.info(`[SectionParser] Detected ${boundaries.length} sections:`);
  for (const b of boundaries) {
    console.info(`  [${b.type}] "${b.title}" lines ${b.startLine}-${b.endLine} (${b.contentLines.length} content lines)`);
  }
}

// ============================================================================
// Full Resume Extraction (replaces regex-based parsing)
// ============================================================================

/**
 * Extract a complete ResumeData from raw text using section boundaries.
 * This is the NEW parser that replaces all lookahead-based regex parsing.
 */
export function extractResumeWithBoundaries(text: string, fileName: string): Partial<ResumeData> {
  const lines = text.split(/\r?\n/);
  const boundaries = detectSectionBoundaries(lines);

  logSectionDetection(boundaries);

  const sections = new Map<SectionType, string[]>();
  for (const b of boundaries) {
    if (b.type !== "unknown") {
      const existing = sections.get(b.type) || [];
      sections.set(b.type, [...existing, ...b.contentLines]);
    }
  }

  // Extract contact info from header (lines before first section)
  const firstSectionStart = boundaries.length > 0 ? boundaries[0].startLine : lines.length;
  const headerLines = lines.slice(0, firstSectionStart).map(l => l.trim()).filter(Boolean);

  // Extract languages
  const langLines = getSectionContent(sections, "languages");
  const languages: ResumeData["languages"] = [];
  const seenLangs = new Set<string>();
  for (const line of langLines) {
    // Try splitting by comma/semicolon for inline format
    const parts = line.split(new RegExp("[,;]"));
    for (const part of parts) {
      const detected = detectLanguage(part);
      if (detected && !seenLangs.has(detected.name.toLowerCase())) {
        seenLangs.add(detected.name.toLowerCase());
        languages.push({
          id: uid("l"),
          name: detected.name,
          proficiency: detected.proficiency,
        });
      }
    }
  }

  // Extract summary
  const summaryLines = getSectionContent(sections, "summary");
  const summary = summaryLines.join(" ").trim() || undefined;

  // Extract skills
  const skillsLines = getSectionContent(sections, "skills");
  const skills = skillsLines
    .flatMap((l) => l.split(new RegExp("[,;•|]")))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 40)
    .map((s) => ({ id: uid("s"), name: s }));

  // Extract certifications
  const certLines = getSectionContent(sections, "certifications");
  const certifications = certLines.map((c) => ({ id: uid("c"), name: c }));

  // Extract projects
  const projLines = getSectionContent(sections, "projects");
  const projects = projLines.map((p) => ({
    id: uid("p"),
    name: p.length > 60 ? p.slice(0, 57) + "…" : p,
    description: p,
    bullets: [],
  }));

  // Extract personal info
  const personalLines = getSectionContent(sections, "personal");

  // Extract date of birth from personal info
  let dateOfBirth: string | undefined;
  for (const line of personalLines) {
    const dobMatch = line.match(/(?:date\s*of\s*birth|dob)\s*:\s*(.+)/i);
    if (dobMatch) {
      dateOfBirth = dobMatch[1].trim();
      break;
    }
  }

  return {
    summary,
    skills,
    languages,
    certifications,
    projects,
    dateOfBirth,
  };
}
