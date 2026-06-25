// ============================================================================
// Layout Validator — A4 page validation + section enforcement
//
// Validates that a resume:
//   - Has exactly 1 A4 page (2500-3800 chars)
//   - Has all required sections (Header, Summary, Skills, Experience, Education, Languages)
//   - Has 85-100% page utilization
//   - No half-empty pages, no overflow, no orphan sections
// ============================================================================

"use client";

import type { ResumeData } from "./types";

export interface LayoutValidationResult {
  valid: boolean;
  charCount: number;
  pageUtilization: number; // 0-100
  sections: { name: string; present: boolean; charCount: number }[];
  issues: string[];
  recommendations: string[];
}

const REQUIRED_SECTIONS = [
  { name: "Header", check: (r: ResumeData) => !!(r.name || r.headline) },
  { name: "Professional Summary", check: (r: ResumeData) => !!(r.summary && r.summary.length > 50) },
  { name: "Core Competencies", check: (r: ResumeData) => !!(r.skills && r.skills.length > 0) },
  { name: "Professional Experience", check: (r: ResumeData) => !!(r.experience && r.experience.length > 0) },
  { name: "Education", check: (r: ResumeData) => !!(r.education && r.education.length > 0) },
  { name: "Languages", check: (r: ResumeData) => !!(r.languages && r.languages.length > 0) },
];

const MIN_CHARS = 2500;
const MAX_CHARS = 3800;
const TARGET_MIN = 2700;
const TARGET_MAX = 3200;
const MIN_PAGE_FILL = 85; // %

/**
 * Calculate the visible character count of a resume (not JSON structure).
 */
function getVisibleCharCount(resume: ResumeData): number {
  const parts: string[] = [];
  parts.push(resume.name || "");
  parts.push(resume.headline || "");
  parts.push(resume.summary || "");
  for (const exp of resume.experience || []) {
    parts.push(exp.title || "");
    parts.push(exp.company || "");
    parts.push(exp.location || "");
    parts.push(...(exp.bullets || []));
  }
  for (const edu of resume.education || []) {
    parts.push(edu.degree || "");
    parts.push(edu.institution || "");
    parts.push(...(edu.highlights || []));
  }
  for (const skill of resume.skills || []) {
    parts.push(skill.name || "");
  }
  for (const lang of resume.languages || []) {
    parts.push(lang.name || "");
  }
  for (const cert of resume.certifications || []) {
    parts.push(cert.name || "");
  }
  return parts.join(" ").length;
}

/**
 * Validate a resume against A4 page layout requirements.
 */
export function validateLayout(resume: ResumeData): LayoutValidationResult {
  const charCount = getVisibleCharCount(resume);
  const pageUtilization = Math.min(100, Math.round((charCount / TARGET_MAX) * 100));
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check character count
  if (charCount < MIN_CHARS) {
    issues.push(`Content too short: ${charCount} chars (minimum ${MIN_CHARS})`);
    recommendations.push("Expand summary, add more experience bullets, add skills");
  } else if (charCount > MAX_CHARS) {
    issues.push(`Content too long: ${charCount} chars (maximum ${MAX_CHARS})`);
    recommendations.push("Shorten summary, reduce bullets, merge skills");
  }

  // Check page utilization
  if (pageUtilization < MIN_PAGE_FILL) {
    issues.push(`Page utilization low: ${pageUtilization}% (minimum ${MIN_PAGE_FILL}%)`);
    recommendations.push("Add more content to fill the A4 page");
  }

  // Check required sections
  const sections = REQUIRED_SECTIONS.map((section) => {
    const present = section.check(resume);
    let sectionCharCount = 0;

    switch (section.name) {
      case "Header":
        sectionCharCount = (resume.name || "").length + (resume.headline || "").length;
        break;
      case "Professional Summary":
        sectionCharCount = (resume.summary || "").length;
        break;
      case "Core Competencies":
        sectionCharCount = (resume.skills || []).reduce((sum, s) => sum + (s.name || "").length, 0);
        break;
      case "Professional Experience":
        sectionCharCount = (resume.experience || []).reduce((sum, e) =>
          sum + (e.title || "").length + (e.company || "").length +
            (e.bullets || []).reduce((bs, b) => bs + (b || "").length, 0), 0);
        break;
      case "Education":
        sectionCharCount = (resume.education || []).reduce((sum, e) =>
          sum + (e.degree || "").length + (e.institution || "").length, 0);
        break;
      case "Languages":
        sectionCharCount = (resume.languages || []).reduce((sum, l) => sum + (l.name || "").length, 0);
        break;
    }

    if (!present) {
      issues.push(`Missing section: ${section.name}`);
      recommendations.push(`Add ${section.name} section`);
    }

    return { name: section.name, present, charCount: sectionCharCount };
  });

  // Check experience bullet count
  for (const exp of resume.experience || []) {
    if (!exp.bullets || exp.bullets.length < 2) {
      issues.push(`Experience "${exp.title}" has fewer than 2 bullets`);
      recommendations.push(`Add more bullets to ${exp.title} at ${exp.company}`);
    }
  }

  const valid = issues.length === 0;

  if (valid) {
    console.info(`[Layout Validator] Valid — ${charCount} chars, ${pageUtilization}% utilization, all sections present`);
  } else {
    console.warn(`[Layout Validator] Invalid — ${issues.length} issue(s): ${issues.join("; ")}`);
  }

  return {
    valid,
    charCount,
    pageUtilization,
    sections,
    issues,
    recommendations,
  };
}

/**
 * Quick check — is the resume valid for export?
 */
export function isExportReady(resume: ResumeData): boolean {
  return validateLayout(resume).valid;
}
