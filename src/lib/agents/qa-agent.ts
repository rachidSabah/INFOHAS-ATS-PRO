// ============================================================================
// Quality Assurance Agent — validates optimized resume output.
//
// Evolutionary upgrade of src/lib/output-validator.ts (runValidationPipeline).
// Adds:
//   - Factual consistency check (compares optimized resume against original
//     to detect fabricated employers, dates, metrics)
//   - Export quality check (verifies PDF render succeeds + 1 page)
//   - Professional tone check (wires in isProfessionalResume)
//   - Unified leak-pattern source (uses leak-patterns.ts)
//
// This module RE-EXPORTS the original runValidationPipeline for backward
// compatibility, and adds a new runQA() function with the richer checks.
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import type { JobIntelligence } from "../job-intelligence";
import { runValidationPipeline, type PipelineResult, type ValidationCheck } from "../output-validator";
import { isProfessionalResume, validateResumeForExport } from "../ai-response-processor";
import { validateResumeContent } from "../ai-error-filter";
import { detectLeaks, isClean } from "../leak-patterns";
import { isForbiddenSection } from "../keyword-banks";
import { exportResumePDF } from "../exporter";

// ============================================================================
// Types
// ============================================================================

export interface QAResult extends PipelineResult {
  /** Factual consistency check — detects fabrication by comparing optimized vs original */
  factualConsistency?: FactualConsistencyResult;
  /** Export quality check — verifies PDF render succeeds + page count */
  exportQuality?: ExportQualityResult;
  /** Professional tone check — detects analysis artifacts in resume content */
  professionalTone?: ProfessionalToneResult;
  /** Overall confidence score (0-100) — used by the Reflection Agent trigger */
  confidence: number;
  /** Whether the Reflection Agent should be triggered */
  shouldReflect: boolean;
}

export interface FactualConsistencyResult {
  passed: boolean;
  /** Employers in the optimized resume that don't appear in the original (potential fabrication) */
  fabricatedEmployers: string[];
  /** Degrees/institutions in the optimized resume that don't appear in the original */
  fabricatedEducation: string[];
  /** Metrics/numbers in the optimized resume that don't appear in the original (potential fabrication) */
  fabricatedMetrics: string[];
  /** Certifications in the optimized resume that don't appear in the original */
  fabricatedCertifications: string[];
  /** Total issues found */
  issueCount: number;
  /** Explanation for the UI */
  explanation: string;
}

export interface ExportQualityResult {
  passed: boolean;
  /** Whether the PDF export succeeded */
  pdfExportSucceeded: boolean;
  /** Number of pages in the exported PDF (should be 1) */
  pageCount: number;
  /** Error message if export failed */
  error?: string;
  /** Explanation for the UI */
  explanation: string;
}

export interface ProfessionalToneResult {
  passed: boolean;
  /** Analysis artifacts detected (e.g. "The original resume lacks…", "ATS score") */
  artifactsFound: string[];
  /** Forbidden sections detected */
  forbiddenSectionsFound: string[];
  /** Leak patterns detected */
  leaksFound: string[];
  /** Explanation for the UI */
  explanation: string;
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Run the full QA pipeline on an optimized resume.
 *
 * @param optimizedResume The AI-optimized resume to validate
 * @param jd Optional job description (for ATS + relevance checks)
 * @param ji Optional job intelligence (for relevance checks)
 * @param originalResume Optional original resume (for factual consistency check)
 * @param options { checkExport?: boolean } — whether to run the export quality check (default: false, slow)
 */
export async function runQA(
  optimizedResume: ResumeData,
  jd?: JobDescription | null,
  ji?: JobIntelligence | null,
  originalResume?: ResumeData | null,
  options?: { checkExport?: boolean }
): Promise<QAResult> {
  // === Run the existing validation pipeline (7 checks) ===
  const basePipeline = runValidationPipeline(optimizedResume, jd ?? null, ji ?? null);

  // === Factual consistency (new — only if original resume provided) ===
  const factualConsistency = originalResume
    ? checkFactualConsistency(originalResume, optimizedResume)
    : undefined;

  // === Professional tone (new — wires in isProfessionalResume + leak detection) ===
  const professionalTone = checkProfessionalTone(optimizedResume);

  // === Export quality (new — optional, slow because it renders a PDF) ===
  const exportQuality = options?.checkExport
    ? await checkExportQuality(optimizedResume)
    : undefined;

  // === Build the combined checks list ===
  const checks: ValidationCheck[] = [...basePipeline.checks];

  // Add the new checks to the list
  if (factualConsistency) {
    checks.push({
      name: "Factual Consistency",
      passed: factualConsistency.passed,
      score: factualConsistency.issueCount === 0 ? 100 : Math.max(0, 100 - factualConsistency.issueCount * 15),
      details: factualConsistency.explanation,
      errors: factualConsistency.issueCount === 0 ? undefined : [
        ...factualConsistency.fabricatedEmployers.map((e) => `Fabricated employer: ${e}`),
        ...factualConsistency.fabricatedEducation.map((e) => `Fabricated education: ${e}`),
        ...factualConsistency.fabricatedMetrics.map((m) => `Fabricated metric: ${m}`),
        ...factualConsistency.fabricatedCertifications.map((c) => `Fabricated certification: ${c}`),
      ],
    });
  }

  if (professionalTone) {
    checks.push({
      name: "Professional Tone",
      passed: professionalTone.passed,
      score: professionalTone.passed ? 100 : Math.max(0, 100 - (professionalTone.artifactsFound.length + professionalTone.forbiddenSectionsFound.length + professionalTone.leaksFound.length) * 20),
      details: professionalTone.explanation,
      errors: professionalTone.passed ? undefined : [
        ...professionalTone.artifactsFound,
        ...professionalTone.forbiddenSectionsFound,
        ...professionalTone.leaksFound,
      ],
    });
  }

  if (exportQuality) {
    checks.push({
      name: "Export Quality",
      passed: exportQuality.passed,
      score: exportQuality.passed ? 100 : 0,
      details: exportQuality.explanation,
      errors: exportQuality.error ? [exportQuality.error] : undefined,
    });
  }

  // === Compute overall confidence (0-100) ===
  // Confidence is the average of all check scores, weighted by importance
  const weights: Record<string, number> = {
    "Layout": 1,
    "Content Validation": 1.5,
    "Grammar": 1,
    "ATS Compatibility": 2,
    "Job Relevance": 1.5,
    "AI Leak Prevention": 2,
    "Page Fit": 1.5,
    "Factual Consistency": 2.5,
    "Professional Tone": 2,
    "Export Quality": 1.5,
  };

  let totalWeight = 0;
  let weightedScore = 0;
  for (const check of checks) {
    const weight = weights[check.name] ?? 1;
    totalWeight += weight;
    weightedScore += (check.score ?? (check.passed ? 100 : 0)) * weight;
  }
  const confidence = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;

  // === Determine if Reflection Agent should trigger ===
  // Trigger if confidence < 75 OR any critical check failed.
  // (Threshold lowered from 80 to 75 per spec — Reflection should only run
  // when there's a real quality concern, not on every request.)
  const criticalFailures = checks.filter((c) => !c.passed && (weights[c.name] ?? 1) >= 2);
  const shouldReflect = confidence < 75 || criticalFailures.length > 0;

  const allPassed = checks.every((c) => c.passed);

  return {
    ...basePipeline,
    checks,
    allPassed,
    factualConsistency,
    exportQuality,
    professionalTone,
    confidence,
    shouldReflect,
  };
}

// ============================================================================
// Factual Consistency Check
// ============================================================================

/**
 * Compare the optimized resume against the original to detect fabrication.
 *
 * Checks:
 *   - Employers in optimized that don't appear (fuzzy) in original
 *   - Degrees/institutions in optimized that don't appear in original
 *   - Metrics/numbers in optimized that don't appear in original
 *   - Certifications in optimized that don't appear in original
 *
 * This is the "preserve factual information, never invent" constraint from the spec.
 */
export function checkFactualConsistency(
  original: ResumeData,
  optimized: ResumeData
): FactualConsistencyResult {
  // === Build sets of original values (lowercased for fuzzy matching) ===
  const originalEmployers = new Set(
    original.experience.map((e) => e.company.toLowerCase().trim()).filter(Boolean)
  );
  const originalInstitutions = new Set(
    original.education.map((e) => e.institution.toLowerCase().trim()).filter(Boolean)
  );
  const originalDegrees = new Set(
    original.education.map((e) => e.degree.toLowerCase().trim()).filter(Boolean)
  );
  const originalCertifications = new Set(
    original.certifications.map((c) => c.name.toLowerCase().trim()).filter(Boolean)
  );

  // Extract all numbers/metrics from original (e.g. "40M+", "23%", "$1.2M", "200+")
  const originalText = JSON.stringify(original);
  const originalMetrics = new Set(
    (originalText.match(/\d+(?:\.\d+)?[%×xMKB+]?/g) ?? []).map((m) => m.toLowerCase())
  );

  // === Check optimized values against original sets ===
  const fabricatedEmployers: string[] = [];
  for (const e of optimized.experience) {
    const employer = e.company.toLowerCase().trim();
    if (!employer) continue;
    // Fuzzy match: check if any original employer contains this one or vice versa
    const found = Array.from(originalEmployers).some(
      (orig) => orig.includes(employer) || employer.includes(orig) || levenshtein(employer, orig) <= 3
    );
    if (!found) fabricatedEmployers.push(e.company);
  }

  const fabricatedEducation: string[] = [];
  for (const ed of optimized.education) {
    const institution = ed.institution.toLowerCase().trim();
    const degree = ed.degree.toLowerCase().trim();
    if (institution && !Array.from(originalInstitutions).some((o) => o.includes(institution) || institution.includes(o))) {
      fabricatedEducation.push(ed.institution);
    }
    if (degree && !Array.from(originalDegrees).some((o) => o.includes(degree) || degree.includes(o))) {
      fabricatedEducation.push(ed.degree);
    }
  }

  const fabricatedCertifications: string[] = [];
  for (const c of optimized.certifications) {
    const name = c.name.toLowerCase().trim();
    if (!name) continue;
    const found = Array.from(originalCertifications).some(
      (orig) => orig.includes(name) || name.includes(orig)
    );
    if (!found) fabricatedCertifications.push(c.name);
  }

  // Check optimized bullets for metrics not in original
  const fabricatedMetrics: string[] = [];
  const optimizedText = JSON.stringify(optimized);
  const optimizedMetricMatches = optimizedText.match(/\d+(?:\.\d+)?[%×xMKB+]?/g) ?? [];
  for (const metric of optimizedMetricMatches) {
    const lower = metric.toLowerCase();
    // Skip small numbers (years, counts under 10) — likely safe
    if (/^\d{4}$/.test(metric)) continue; // year
    if (parseInt(metric) < 5) continue; // small count
    if (!originalMetrics.has(lower)) {
      // Check if it's close to an original metric (e.g. "23%" vs "23")
      const found = Array.from(originalMetrics).some((o) => o.includes(lower) || lower.includes(o));
      if (!found) fabricatedMetrics.push(metric);
    }
  }
  // Dedupe
  const uniqueFabricatedMetrics = [...new Set(fabricatedMetrics)].slice(0, 10);

  const issueCount =
    fabricatedEmployers.length +
    fabricatedEducation.length +
    fabricatedCertifications.length +
    uniqueFabricatedMetrics.length;

  const passed = issueCount === 0;

  let explanation: string;
  if (passed) {
    explanation = "All employers, education, certifications, and metrics in the optimized resume match the original. No fabrication detected.";
  } else {
    const parts: string[] = [];
    if (fabricatedEmployers.length) parts.push(`${fabricatedEmployers.length} employer(s)`);
    if (fabricatedEducation.length) parts.push(`${fabricatedEducation.length} education entry/entries`);
    if (fabricatedCertifications.length) parts.push(`${fabricatedCertifications.length} certification(s)`);
    if (uniqueFabricatedMetrics.length) parts.push(`${uniqueFabricatedMetrics.length} metric(s)`);
    explanation = `Potential fabrication detected: ${parts.join(", ")} in the optimized resume do not appear in the original. The AI may have invented information.`;
  }

  return {
    passed,
    fabricatedEmployers,
    fabricatedEducation,
    fabricatedMetrics: uniqueFabricatedMetrics,
    fabricatedCertifications,
    issueCount,
    explanation,
  };
}

// ============================================================================
// Professional Tone Check
// ============================================================================

/**
 * Check the resume for analysis artifacts, forbidden sections, and AI error leaks.
 *
 * Wires together:
 *   - isProfessionalResume (from ai-response-processor)
 *   - validateResumeContent (from ai-error-filter)
 *   - detectLeaks (from leak-patterns)
 *   - isForbiddenSection (from keyword-banks)
 */
export function checkProfessionalTone(resume: ResumeData): ProfessionalToneResult {
  const artifactsFound: string[] = [];
  const forbiddenSectionsFound: string[] = [];
  const leaksFound: string[] = [];

  // === Check professional tone ===
  const profCheck = isProfessionalResume(resume);
  if (!profCheck.professional) {
    artifactsFound.push(...profCheck.issues);
  }

  // === Check for AI error leaks ===
  const leakCheck = validateResumeContent(resume);
  if (!leakCheck.valid && leakCheck.errors) {
    leaksFound.push(...leakCheck.errors);
  }

  // === Check all text fields for leak patterns ===
  const allText = [
    resume.name, resume.headline, resume.summary,
    ...resume.experience.flatMap((e) => [e.title, e.company, e.location, ...e.bullets]),
    ...resume.education.flatMap((e) => [e.degree, e.institution, ...(e.highlights ?? [])]),
    ...resume.skills.map((s) => s.name),
    ...resume.languages.map((l) => l.name),
    ...resume.certifications.map((c) => c.name),
    ...resume.projects.map((p) => p.name + " " + (p.description ?? "")),
  ].filter(Boolean) as string[];

  for (const text of allText) {
    const leaks = detectLeaks(text);
    if (leaks.length > 0) {
      leaksFound.push(...leaks.slice(0, 2)); // limit per field
    }
  }

  // === Check section names for forbidden sections ===
  // The resume doesn't have explicit section objects, but we check the summary
  // and any text that looks like a section header
  const sectionLikeTexts = [
    resume.summary,
    resume.headline,
    ...resume.experience.map((e) => e.title),
    ...resume.education.map((e) => e.degree),
  ].filter(Boolean) as string[];

  for (const text of sectionLikeTexts) {
    if (isForbiddenSection(text)) {
      forbiddenSectionsFound.push(text);
    }
  }

  const issueCount = artifactsFound.length + forbiddenSectionsFound.length + leaksFound.length;
  const passed = issueCount === 0;

  let explanation: string;
  if (passed) {
    explanation = "Resume content is professional, clean, and free of analysis artifacts or AI error leaks.";
  } else {
    const parts: string[] = [];
    if (artifactsFound.length) parts.push(`${artifactsFound.length} analysis artifact(s)`);
    if (forbiddenSectionsFound.length) parts.push(`${forbiddenSectionsFound.length} forbidden section(s)`);
    if (leaksFound.length) parts.push(`${leaksFound.length} AI leak(s)`);
    explanation = `Professional tone issues detected: ${parts.join(", ")}. The resume contains content that should not appear in a professional document.`;
  }

  return {
    passed,
    artifactsFound,
    forbiddenSectionsFound,
    leaksFound,
    explanation,
  };
}

// ============================================================================
// Export Quality Check
// ============================================================================

/**
 * Verify the resume can be exported as a single-page PDF.
 *
 * This check actually calls the PDF exporter and verifies:
 *   - Export succeeds (no errors)
 *   - Page count is exactly 1
 *
 * This is slow (renders a PDF) so it's optional.
 */
export async function checkExportQuality(resume: ResumeData): Promise<ExportQualityResult> {
  try {
    const result = exportResumePDF(resume, { enforceOnePage: true });

    if (!result.ok) {
      return {
        passed: false,
        pdfExportSucceeded: false,
        pageCount: result.pages,
        error: result.error,
        explanation: `PDF export failed: ${result.error ?? "unknown error"}. The resume cannot be exported in its current state.`,
      };
    }

    const passed = result.pages === 1;
    return {
      passed,
      pdfExportSucceeded: true,
      pageCount: result.pages,
      explanation: passed
        ? "PDF export succeeded — resume fits on exactly 1 A4 page."
        : `PDF export succeeded but produced ${result.pages} pages. The resume should fit on 1 page.`,
    };
  } catch (e: any) {
    return {
      passed: false,
      pdfExportSucceeded: false,
      pageCount: 0,
      error: e?.message ?? "Unknown export error",
      explanation: `PDF export threw an exception: ${e?.message ?? "unknown error"}.`,
    };
  }
}

// ============================================================================
// Helper: Levenshtein distance (for fuzzy string matching)
// ============================================================================

/**
 * Compute the Levenshtein distance between two strings.
 * Used for fuzzy employer/institution matching (e.g. "Google" vs "Google LLC").
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1       // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// ============================================================================
// Re-export the original pipeline for backward compatibility
// ============================================================================

export { runValidationPipeline, type PipelineResult, type ValidationCheck } from "../output-validator";
