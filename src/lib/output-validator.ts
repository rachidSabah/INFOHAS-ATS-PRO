// ResumeAI Pro — Output Validation Pipeline
// Runs multiple validators on a generated resume BEFORE PDF generation.
// Only generates PDF if ALL validators pass.
//
// Validators:
//   1. Layout Validation — section order, fonts, spacing
//   2. Content Validation — no forbidden sections, no error leaks
//   3. Grammar Validation — basic grammar checks
//   4. ATS Validation — ATS-friendly formatting
//   5. Job Relevance Validation — relevance score >= 90
//   6. AI Leak Validation — no AI error messages
//   7. Page Validation — fits on one A4 page

"use client";

import type { ResumeData, JobDescription } from "./types";
import { validateResumeContent, isForbiddenSection } from "./ai-error-filter";
import { computeRelevanceScore } from "./relevance-engine";
import type { JobIntelligence } from "./job-intelligence";

export interface ValidationCheck {
  name: string;
  passed: boolean;
  score?: number;
  details: string;
  errors?: string[];
}

export interface PipelineResult {
  allPassed: boolean;
  checks: ValidationCheck[];
  relevanceScore?: number;
  blockReason?: string;
}

/**
 * Run the full validation pipeline on a resume.
 * Returns allPassed=true only if every check passes.
 */
export function runValidationPipeline(
  resume: ResumeData,
  jd: JobDescription | null,
  ji: JobIntelligence | null,
): PipelineResult {
  const checks: ValidationCheck[] = [];

  // === 1. LAYOUT VALIDATION ===
  checks.push(validateLayout(resume));

  // === 2. CONTENT VALIDATION ===
  checks.push(validateContent(resume));

  // === 3. GRAMMAR VALIDATION ===
  checks.push(validateGrammar(resume));

  // === 4. ATS VALIDATION ===
  checks.push(validateATS(resume));

  // === 5. JOB RELEVANCE VALIDATION ===
  let relevanceScore: number | undefined;
  if (ji) {
    const relCheck = validateJobRelevance(resume, ji);
    checks.push(relCheck);
    relevanceScore = relCheck.score;
  }

  // === 6. AI LEAK VALIDATION ===
  checks.push(validateNoAILeaks(resume));

  // === 7. PAGE VALIDATION (heuristic — actual page count checked at PDF render) ===
  checks.push(validatePageFit(resume));

  const allPassed = checks.every((c) => c.passed);
  const failedCheck = checks.find((c) => !c.passed);

  return {
    allPassed,
    checks,
    relevanceScore,
    blockReason: failedCheck ? `${failedCheck.name}: ${failedCheck.details}` : undefined,
  };
}

// ============================================================================
// INDIVIDUAL VALIDATORS
// ============================================================================

function validateLayout(resume: ResumeData): ValidationCheck {
  const errors: string[] = [];

  // Check section order: Summary → Skills → Experience → Education → Languages
  // We verify that the resume has the required sections (not necessarily in order,
  // since the renderer enforces order — but we check that the data exists)
  if (!resume.summary || resume.summary.length < 30) {
    errors.push("Missing or too-short professional summary");
  }
  if (!resume.skills || resume.skills.length === 0) {
    errors.push("Missing skills section");
  }
  if (!resume.experience || resume.experience.length === 0) {
    errors.push("Missing professional experience section");
  }
  if (!resume.education || resume.education.length === 0) {
    errors.push("Missing education section");
  }
  if (!resume.languages || resume.languages.length === 0) {
    errors.push("Missing languages section");
  }

  // Check template is infohas-pro (the reference template)
  if (resume.template !== "infohas-pro") {
    errors.push(`Wrong template: expected "infohas-pro", got "${resume.template}"`);
  }

  return {
    name: "Layout Validation",
    passed: errors.length === 0,
    details: errors.length === 0 ? "All required sections present, template correct" : `${errors.length} layout issue(s)`,
    errors,
  };
}

function validateContent(resume: ResumeData): ValidationCheck {
  const result = validateResumeContent(resume);
  return {
    name: "Content Validation",
    passed: result.valid,
    details: result.valid
      ? "No forbidden content or error leaks detected"
      : `${result.errors.length} content issue(s) detected`,
    errors: result.errors,
  };
}

function validateGrammar(resume: ResumeData): ValidationCheck {
  const errors: string[] = [];

  // Basic grammar checks
  // 1. Check for ALL CAPS words (excluding acronyms)
  const allText = [resume.summary, resume.headline, resume.name]
    .concat(resume.experience.flatMap((e) => [e.title, e.company, ...e.bullets]))
    .filter(Boolean)
    .join(" ");

  const capsWords = allText.match(/\b[A-Z]{4,}\b/g) || [];
  // Allow common acronyms
  const allowedAcronyms = ["HTML", "CSS", "API", "SQL", "AWS", "CRM", "POS", "HR", "IT", "CEO", "CFO", "CTO", "KPI", "SLA", "B2B", "B2C", "SOP", "STEB", "FAB"];
  const badCaps = capsWords.filter((w) => !allowedAcronyms.includes(w));
  if (badCaps.length > 3) {
    errors.push(`Excessive ALL CAPS words detected (${badCaps.length})`);
  }

  // 2. Check for excessively long sentences (> 250 chars)
  const sentences = allText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const longSentences = sentences.filter((s) => s.length > 250);
  if (longSentences.length > 0) {
    errors.push(`${longSentences.length} overly long sentence(s) detected`);
  }

  // 3. Check for repeated words ("the the", "and and")
  const repeated = allText.match(/\b(\w+)\s+\1\b/gi);
  if (repeated && repeated.length > 0) {
    errors.push(`${repeated.length} repeated word(s) detected`);
  }

  return {
    name: "Grammar Validation",
    passed: errors.length === 0,
    details: errors.length === 0 ? "Grammar checks passed" : `${errors.length} grammar issue(s)`,
    errors,
  };
}

function validateATS(resume: ResumeData): ValidationCheck {
  const errors: string[] = [];

  // ATS-friendly checks:
  // 1. No special characters in name
  if (resume.name && /[<>{}[\]|\\\/]/.test(resume.name)) {
    errors.push("Special characters in name (not ATS-friendly)");
  }

  // 2. Contact info present
  if (!resume.contact?.email && !resume.contact?.phone) {
    errors.push("Missing contact information (email or phone)");
  }

  // 3. No tables/columns — check for pipe characters in key fields
  // Pipes in experience titles and company names are particularly harmful
  for (const e of resume.experience) {
    if (e.title && e.title.includes("|")) {
      errors.push(`Pipe character in job title: "${e.title}"`);
    }
    if (e.company && e.company.includes("|")) {
      errors.push(`Pipe character in company name: "${e.company}"`);
    }
  }
  const allText = JSON.stringify(resume);
  if ((allText.match(/\|/g) || []).length > 5) {
    errors.push("Pipe characters detected (possible table formatting — not ATS-friendly)");
  }

  // 4. Experience entries have dates
  for (const e of resume.experience) {
    if (!e.startDate && !e.endDate) {
      errors.push(`Experience entry "${e.title}" missing dates`);
    }
  }

  // 5. Skills are present and not empty
  if (resume.skills.some((s) => !s.name || s.name.length < 2)) {
    errors.push("Some skills have empty or too-short names");
  }

  return {
    name: "ATS Validation",
    passed: errors.length === 0,
    details: errors.length === 0 ? "ATS-friendly formatting" : `${errors.length} ATS issue(s)`,
    errors,
  };
}

function validateJobRelevance(resume: ResumeData, ji: JobIntelligence): ValidationCheck {
  const score = computeRelevanceScore(resume, ji);
  return {
    name: "Job Relevance Validation",
    passed: score.passes,
    score: score.overall,
    details: score.passes
      ? `Relevance score: ${score.overall}/100 (>= 90 threshold)`
      : `Relevance score: ${score.overall}/100 (< 90 threshold — regenerate). Missing keywords: ${score.details.missingPriorityKeywords.slice(0, 5).join(", ")}`,
    errors: score.passes ? undefined : [`Missing ${score.details.missingPriorityKeywords.length} priority keywords`, `${score.details.avoidKeywordsFound.length} irrelevant keywords found`],
  };
}

function validateNoAILeaks(resume: ResumeData): ValidationCheck {
  // This is a more thorough check than validateContent — specifically for AI error messages
  const result = validateResumeContent(resume);
  const aiErrors = result.errors.filter((e) => e.includes("AI error leak"));

  return {
    name: "AI Leak Validation",
    passed: aiErrors.length === 0,
    details: aiErrors.length === 0
      ? "No AI error messages or system messages detected"
      : `${aiErrors.length} AI leak(s) detected — MUST NOT appear in final resume`,
    errors: aiErrors,
  };
}

function validatePageFit(resume: ResumeData): ValidationCheck {
  // Heuristic: estimate if the content will fit on one A4 page
  // A4 page with 10.5pt font and compact spacing fits roughly:
  //   - Summary: ~6 lines
  //   - Skills: ~4 lines
  //   - Experience: ~3 entries × 5 lines = 15 lines
  //   - Education: ~2 lines
  //   - Languages: ~2 lines
  // Total: ~29 lines max

  let estimatedLines = 0;

  // Summary: ~1 line per 12 words
  if (resume.summary) {
    estimatedLines += Math.ceil(resume.summary.split(/\s+/).length / 12);
  }

  // Skills: 1 line per group (assume 4 groups)
  estimatedLines += Math.min(4, Math.ceil(resume.skills.length / 3));

  // Experience: 1 header line + 1 line per bullet per entry
  for (const e of resume.experience) {
    estimatedLines += 1 + e.bullets.length;
  }

  // Education: 1 line per entry
  estimatedLines += resume.education.length;

  // Languages: 1 line per entry
  estimatedLines += resume.languages.length;

  const MAX_LINES = 35; // conservative estimate for one A4 page
  const fits = estimatedLines <= MAX_LINES;

  return {
    name: "Page Validation",
    passed: fits,
    details: fits
      ? `Estimated ${estimatedLines} lines (fits one A4 page)`
      : `Estimated ${estimatedLines} lines (exceeds ${MAX_LINES}-line max — compress content)`,
    errors: fits ? undefined : ["Content too long for one page — compress summary, reduce bullets, or merge skills"],
  };
}
