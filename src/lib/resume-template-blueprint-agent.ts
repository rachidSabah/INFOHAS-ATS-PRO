// ============================================================================
// Resume Template Blueprint Agent
//
// The Resume Template Blueprint Agent freezes the original resume LAYOUT and
// FORMATTING before optimization. It provides two key functions:
//
//   1. extractTemplateBlueprint(resume) — captures the full layout blueprint
//      from the source ResumeData (template name, accentColor, photoUrl, and
//      inferred template defaults).
//
//   2. validateTemplatePreserved(original, optimized) — verifies that the
//      optimized resume has NOT altered critical layout attributes:
//      - sectionOrder
//      - layoutType
//      - educationFormat
//      - experienceFormat
//
// Rules:
//   - No agent may alter the template blueprint.
//   - Only Resume Assembler (resume-assembler.ts) may render the final layout.
//   - The blueprint is extracted BEFORE optimization and validated AFTER.
// ============================================================================

"use client";

import type { ResumeData, ResumeTemplate } from "./types";

// ============================================================================
// ResumeTemplateBlueprint — the frozen layout contract
// ============================================================================

export interface ResumeTemplateBlueprint {
  /** Ordered list of section heading strings as they appear in the resume */
  sectionOrder: string[];

  /** Font sizes for key typographic elements (e.g. "name", "sectionTitle", "body") */
  fontSizes: Record<string, string>;

  /** Actual heading text used for each section (e.g. "PROFESSIONAL EXPERIENCE", "WORK EXPERIENCE") */
  headings: Record<string, string>;

  /** Overall page layout type */
  layoutType: "single-column" | "two-column";

  /** Education section formatting preferences */
  educationFormat: {
    /** Whether the diploma/degree appears before the institution name */
    diplomaFirst: boolean;
    /** Separator character(s) between diploma and institution */
    separator: string;
  };

  /** Experience section formatting preferences */
  experienceFormat: {
    /** Whether the role/job title appears before the company name */
    roleFirst: boolean;
    /** Separator character(s) between role and company */
    separator: string;
  };

  /** Whether a profile photo is present/should be rendered */
  hasProfilePhoto: boolean;

  /** Accent color used for headings and decorative elements (null = default) */
  accentColor: string | null;

  /** Page margin dimensions in mm */
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

// ============================================================================
// Template metadata registry
//
// Each ResumeTemplate has known layout defaults. These are the "frozen"
// values that no optimization agent may alter.
// ============================================================================

/** Default margin set for each template (top, right, bottom, left in mm) */
type MarginSet = [number, number, number, number];

interface TemplateMeta {
  sectionOrder: string[];
  fontSizes: Record<string, string>;
  headings: Record<string, string>;
  layoutType: "single-column" | "two-column";
  educationFormat: { diplomaFirst: boolean; separator: string };
  experienceFormat: { roleFirst: boolean; separator: string };
  margins: MarginSet;
}

const TEMPLATE_REGISTRY: Record<ResumeTemplate, TemplateMeta> = {
  "ats-professional": {
    sectionOrder: [
      "headline",
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
    ],
    fontSizes: {
      name: "14pt",
      sectionTitle: "11pt",
      body: "10pt",
      headline: "11pt",
    },
    headings: {
      summary: "PROFESSIONAL SUMMARY",
      experience: "PROFESSIONAL EXPERIENCE",
      education: "EDUCATION",
      skills: "SKILLS",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [6.35, 8.89, 6.35, 8.89],
  },

  executive: {
    sectionOrder: [
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
    ],
    fontSizes: {
      name: "16pt",
      sectionTitle: "12pt",
      body: "10.5pt",
      headline: "12pt",
    },
    headings: {
      summary: "EXECUTIVE SUMMARY",
      experience: "EXECUTIVE EXPERIENCE",
      education: "EDUCATION",
      skills: "CORE COMPETENCIES",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [7, 10, 7, 10],
  },

  modern: {
    sectionOrder: [
      "headline",
      "summary",
      "skills",
      "experience",
      "education",
      "languages",
      "certifications",
      "projects",
    ],
    fontSizes: {
      name: "14pt",
      sectionTitle: "11pt",
      body: "10pt",
      headline: "11pt",
    },
    headings: {
      summary: "PROFILE",
      experience: "EXPERIENCE",
      education: "EDUCATION",
      skills: "SKILLS",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
      projects: "PROJECTS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: false, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [6.35, 8.89, 6.35, 8.89],
  },

  corporate: {
    sectionOrder: [
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
    ],
    fontSizes: {
      name: "14pt",
      sectionTitle: "12pt",
      body: "10pt",
      headline: "11pt",
    },
    headings: {
      summary: "PROFESSIONAL SUMMARY",
      experience: "PROFESSIONAL EXPERIENCE",
      education: "EDUCATION",
      skills: "CORE COMPETENCIES",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [8, 10, 8, 10],
  },

  europass: {
    sectionOrder: [
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
      "projects",
    ],
    fontSizes: {
      name: "14pt",
      sectionTitle: "11pt",
      body: "10pt",
      headline: "11pt",
    },
    headings: {
      summary: "PROFILE",
      experience: "WORK EXPERIENCE",
      education: "EDUCATION AND TRAINING",
      skills: "SKILLS",
      languages: "LANGUAGE SKILLS",
      certifications: "CERTIFICATIONS",
      projects: "PROJECTS",
    },
    layoutType: "two-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [6.35, 8.89, 6.35, 8.89],
  },

  creative: {
    sectionOrder: [
      "headline",
      "skills",
      "experience",
      "education",
      "projects",
      "languages",
    ],
    fontSizes: {
      name: "18pt",
      sectionTitle: "13pt",
      body: "10pt",
      headline: "12pt",
    },
    headings: {
      summary: "ABOUT",
      experience: "EXPERIENCE",
      education: "EDUCATION",
      skills: "WHAT I DO",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
      projects: "WORK",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: " • " },
    experienceFormat: { roleFirst: true, separator: " • " },
    margins: [5, 7, 5, 7],
  },

  minimal: {
    sectionOrder: [
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
    ],
    fontSizes: {
      name: "13pt",
      sectionTitle: "10.5pt",
      body: "9.5pt",
      headline: "10.5pt",
    },
    headings: {
      summary: "SUMMARY",
      experience: "EXPERIENCE",
      education: "EDUCATION",
      skills: "SKILLS",
      languages: "LANGUAGES",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: ", " },
    experienceFormat: { roleFirst: true, separator: ", " },
    margins: [5, 6, 5, 6],
  },

  "infohas-pro": {
    sectionOrder: [
      "headline",
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
      "projects",
    ],
    fontSizes: {
      name: "14pt",
      sectionTitle: "11pt",
      body: "10pt",
      headline: "11pt",
    },
    headings: {
      summary: "PROFESSIONAL SUMMARY",
      experience: "WORK EXPERIENCE",
      education: "EDUCATION",
      skills: "SKILLS",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
      projects: "PROJECTS",
    },
    layoutType: "two-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [6.35, 8.89, 6.35, 8.89],
  },

  compact: {
    sectionOrder: [
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
    ],
    fontSizes: {
      name: "12pt",
      sectionTitle: "10pt",
      body: "9pt",
      headline: "10pt",
    },
    headings: {
      summary: "SUMMARY",
      experience: "EXPERIENCE",
      education: "EDUCATION",
      skills: "SKILLS",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: ", " },
    experienceFormat: { roleFirst: true, separator: ", " },
    margins: [4, 5, 4, 5],
  },

  tech: {
    sectionOrder: [
      "headline",
      "summary",
      "skills",
      "experience",
      "education",
      "projects",
      "certifications",
    ],
    fontSizes: {
      name: "15pt",
      sectionTitle: "11pt",
      body: "10pt",
      headline: "11pt",
    },
    headings: {
      summary: "SUMMARY",
      experience: "EXPERIENCE",
      education: "EDUCATION",
      skills: "TECHNICAL SKILLS",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
      projects: "PROJECTS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [6.35, 8.89, 6.35, 8.89],
  },

  academic: {
    sectionOrder: [
      "summary",
      "education",
      "experience",
      "certifications",
      "skills",
      "languages",
      "projects",
    ],
    fontSizes: {
      name: "14pt",
      sectionTitle: "12pt",
      body: "11pt",
      headline: "12pt",
    },
    headings: {
      summary: "ACADEMIC PROFILE",
      experience: "RESEARCH & TEACHING EXPERIENCE",
      education: "EDUCATION",
      skills: "RESEARCH SKILLS",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
      projects: "PUBLICATIONS & PROJECTS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: false, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [8, 10, 8, 10],
  },

  consulting: {
    sectionOrder: [
      "summary",
      "experience",
      "education",
      "skills",
      "certifications",
      "languages",
    ],
    fontSizes: {
      name: "14pt",
      sectionTitle: "11pt",
      body: "10pt",
      headline: "11pt",
    },
    headings: {
      summary: "PROFESSIONAL SUMMARY",
      experience: "SELECTED ENGAGEMENTS",
      education: "EDUCATION",
      skills: "AREAS OF EXPERTISE",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [6.35, 8.89, 6.35, 8.89],
  },

  startup: {
    sectionOrder: [
      "headline",
      "summary",
      "skills",
      "experience",
      "education",
      "projects",
      "languages",
    ],
    fontSizes: {
      name: "16pt",
      sectionTitle: "11pt",
      body: "10pt",
      headline: "11pt",
    },
    headings: {
      summary: "ABOUT",
      experience: "EXPERIENCE",
      education: "EDUCATION",
      skills: "SKILLS & TOOLS",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
      projects: "SIDE PROJECTS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [6.35, 8.89, 6.35, 8.89],
  },

  classic: {
    sectionOrder: [
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
    ],
    fontSizes: {
      name: "14pt",
      sectionTitle: "12pt",
      body: "11pt",
      headline: "11pt",
    },
    headings: {
      summary: "SUMMARY",
      experience: "EXPERIENCE",
      education: "EDUCATION",
      skills: "SKILLS",
      languages: "LANGUAGES",
      certifications: "CERTIFICATIONS",
    },
    layoutType: "single-column",
    educationFormat: { diplomaFirst: true, separator: " — " },
    experienceFormat: { roleFirst: true, separator: " — " },
    margins: [7.62, 9.53, 7.62, 9.53],
  },
};

// ============================================================================
// Default fallback for unknown template values
// ============================================================================

const DEFAULT_TEMPLATE_META: TemplateMeta = {
  sectionOrder: [
    "summary",
    "experience",
    "education",
    "skills",
    "languages",
    "certifications",
  ],
  fontSizes: {
    name: "14pt",
    sectionTitle: "11pt",
    body: "10pt",
    headline: "11pt",
  },
  headings: {
    summary: "SUMMARY",
    experience: "EXPERIENCE",
    education: "EDUCATION",
    skills: "SKILLS",
    languages: "LANGUAGES",
    certifications: "CERTIFICATIONS",
  },
  layoutType: "single-column",
  educationFormat: { diplomaFirst: true, separator: " — " },
  experienceFormat: { roleFirst: true, separator: " — " },
  margins: [6.35, 8.89, 6.35, 8.89],
};

// ============================================================================
// extractTemplateBlueprint — capture the full layout blueprint from ResumeData
// ============================================================================

/**
 * Extract the template blueprint from the source ResumeData.
 *
 * The blueprint captures:
 *   - Template-specific layout defaults (section order, font sizes, headings,
 *     layout type, education/experience formatting, margins)
 *   - The resume's actual accentColor (if any)
 *   - Whether a profile photo is present
 *
 * This blueprint is meant to be captured BEFORE optimization, then used AFTER
 * optimization to validate that the template layout was not altered.
 *
 * @param resume - The source ResumeData (pre- or post-optimization)
 * @returns A frozen ResumeTemplateBlueprint snapshot
 */
export function extractTemplateBlueprint(resume: ResumeData): ResumeTemplateBlueprint {
  const templateKey: ResumeTemplate = resume.template;
  const meta = TEMPLATE_REGISTRY[templateKey] ?? DEFAULT_TEMPLATE_META;

  const margins = meta.margins;

  return {
    sectionOrder: [...meta.sectionOrder],
    fontSizes: { ...meta.fontSizes },
    headings: { ...meta.headings },
    layoutType: meta.layoutType,
    educationFormat: { ...meta.educationFormat },
    experienceFormat: { ...meta.experienceFormat },
    hasProfilePhoto: !!resume.photoUrl,
    accentColor: resume.accentColor ?? null,
    margins: {
      top: margins[0],
      right: margins[1],
      bottom: margins[2],
      left: margins[3],
    },
  };
}

// ============================================================================
// validateTemplatePreserved — ensure the optimized resume didn't alter layout
// ============================================================================

/**
 * Validate that the optimized resume has preserved the original template's
 * critical layout attributes.
 *
 * The following properties MUST remain unchanged:
 *   1. sectionOrder — the order in which sections appear
 *   2. layoutType — single-column vs two-column
 *   3. educationFormat — diplomaFirst flag and separator
 *   4. experienceFormat — roleFirst flag and separator
 *
 * @param original - The template blueprint captured BEFORE optimization
 * @param optimized - The full ResumeData AFTER optimization
 * @returns true if all critical layout attributes are preserved, false otherwise
 */
export function validateTemplatePreserved(
  original: ResumeTemplateBlueprint,
  optimized: ResumeData,
): boolean {
  // Extract the blueprint from the optimized resume for comparison
  const optimizedBlueprint = extractTemplateBlueprint(optimized);

  // 1. Validate sectionOrder
  if (!arraysEqual(original.sectionOrder, optimizedBlueprint.sectionOrder)) {
    return false;
  }

  // 2. Validate layoutType
  if (original.layoutType !== optimizedBlueprint.layoutType) {
    return false;
  }

  // 3. Validate educationFormat
  if (
    original.educationFormat.diplomaFirst !==
      optimizedBlueprint.educationFormat.diplomaFirst ||
    original.educationFormat.separator !==
      optimizedBlueprint.educationFormat.separator
  ) {
    return false;
  }

  // 4. Validate experienceFormat
  if (
    original.experienceFormat.roleFirst !==
      optimizedBlueprint.experienceFormat.roleFirst ||
    original.experienceFormat.separator !==
      optimizedBlueprint.experienceFormat.separator
  ) {
    return false;
  }

  return true;
}

// ============================================================================
// validateTemplatePreservedDetailed — returns per-check diagnostics
// ============================================================================

export interface TemplatePreservationResult {
  valid: boolean;
  checks: {
    sectionOrder: { passed: boolean; expected: string[]; actual: string[] };
    layoutType: { passed: boolean; expected: string; actual: string };
    educationFormat: {
      passed: boolean;
      expected: { diplomaFirst: boolean; separator: string };
      actual: { diplomaFirst: boolean; separator: string };
    };
    experienceFormat: {
      passed: boolean;
      expected: { roleFirst: boolean; separator: string };
      actual: { roleFirst: boolean; separator: string };
    };
  };
}

/**
 * Detailed variant of validateTemplatePreserved that returns per-check
 * diagnostics, showing exactly what was expected vs what was found.
 *
 * @param original - The template blueprint captured BEFORE optimization
 * @param optimized - The full ResumeData AFTER optimization
 * @returns TemplatePreservationResult with per-check pass/fail + expected/actual values
 */
export function validateTemplatePreservedDetailed(
  original: ResumeTemplateBlueprint,
  optimized: ResumeData,
): TemplatePreservationResult {
  const optimizedBlueprint = extractTemplateBlueprint(optimized);

  const sectionOrderCheck = {
    expected: original.sectionOrder,
    actual: optimizedBlueprint.sectionOrder,
  };

  const layoutTypeCheck = {
    expected: original.layoutType,
    actual: optimizedBlueprint.layoutType,
  };

  const educationFormatCheck = {
    expected: original.educationFormat,
    actual: optimizedBlueprint.educationFormat,
  };

  const experienceFormatCheck = {
    expected: original.experienceFormat,
    actual: optimizedBlueprint.experienceFormat,
  };

  const sectionOrderPassed = arraysEqual(
    sectionOrderCheck.expected,
    sectionOrderCheck.actual,
  );
  const layoutTypePassed = layoutTypeCheck.expected === layoutTypeCheck.actual;
  const educationFormatPassed =
    educationFormatCheck.expected.diplomaFirst ===
      educationFormatCheck.actual.diplomaFirst &&
    educationFormatCheck.expected.separator ===
      educationFormatCheck.actual.separator;
  const experienceFormatPassed =
    experienceFormatCheck.expected.roleFirst ===
      experienceFormatCheck.actual.roleFirst &&
    experienceFormatCheck.expected.separator ===
      experienceFormatCheck.actual.separator;

  return {
    valid:
      sectionOrderPassed &&
      layoutTypePassed &&
      educationFormatPassed &&
      experienceFormatPassed,
    checks: {
      sectionOrder: { ...sectionOrderCheck, passed: sectionOrderPassed },
      layoutType: { ...layoutTypeCheck, passed: layoutTypePassed },
      educationFormat: { ...educationFormatCheck, passed: educationFormatPassed },
      experienceFormat: {
        ...experienceFormatCheck,
        passed: experienceFormatPassed,
      },
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Shallow-compare two arrays for strict value equality.
 */
function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
