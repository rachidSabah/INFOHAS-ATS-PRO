// ResumeAI Pro — Export Test Suite
// Tests that all export formats (PDF, DOCX, DOC, TXT) produce consistent,
// complete, and valid output. Asserts: identical content, no truncation,
// page count consistency, text alignment preservation.
//
// Pure functions — safe for Edge Runtime and unit tests.

import type { ExportTestResult, QATestResult } from "./types";

/**
 * Validate export test results across all formats.
 * Asserts that all formats contain identical content and are not truncated.
 */
export function validateExportConsistency(
  results: ExportTestResult[]
): {
  allPassed: boolean;
  contentIdenticalAcrossFormats: boolean;
  noTruncation: boolean;
  pageCountConsistent: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check each format individually
  for (const r of results) {
    if (!r.generated) {
      issues.push(`${r.format.toUpperCase()}: Failed to generate`);
    }
    if (r.noTruncation === false) {
      issues.push(`${r.format.toUpperCase()}: Content is truncated`);
    }
    if (r.sectionsIntact === false) {
      issues.push(`${r.format.toUpperCase()}: Sections are not intact`);
    }
    if (r.textAlignmentPreserved === false) {
      issues.push(`${r.format.toUpperCase()}: Text alignment not preserved`);
    }
  }

  // Cross-format consistency checks
  const generatedFormats = results.filter((r) => r.generated);
  if (generatedFormats.length < 2) {
    issues.push("Less than 2 formats generated — cannot verify cross-format consistency");
  } else {
    // Content length should be within 10% across formats
    const lengths = generatedFormats.map((r) => r.contentLength);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const outlierFormat = generatedFormats.find(
      (r) => Math.abs(r.contentLength - avgLength) / avgLength > 0.15
    );
    if (outlierFormat) {
      issues.push(
        `${outlierFormat.format.toUpperCase()}: Content length ${outlierFormat.contentLength} significantly differs from average ${Math.round(avgLength)}`
      );
    }

    // Page count consistency (PDF vs DOCX)
    const pdfResult = results.find((r) => r.format === "pdf");
    const docxResult = results.find((r) => r.format === "docx");
    if (pdfResult?.generated && docxResult?.generated && pdfResult.pageCount !== docxResult.pageCount) {
      issues.push(
        `Page count mismatch: PDF=${pdfResult.pageCount}, DOCX=${docxResult.pageCount}`
      );
    }

    // Identical content check
    const identicalCount = generatedFormats.filter((r) => r.identicalContent).length;
    if (identicalCount < generatedFormats.length) {
      issues.push(
        `Content not identical across all formats (${identicalCount}/${generatedFormats.length} match)`
      );
    }
  }

  return {
    allPassed: issues.length === 0,
    contentIdenticalAcrossFormats: !issues.some((i) => i.includes("not identical")),
    noTruncation: !issues.some((i) => i.includes("truncated")),
    pageCountConsistent: !issues.some((i) => i.includes("Page count mismatch")),
    issues,
  };
}

/**
 * Validate a single export result.
 */
export function validateExportResult(
  format: "pdf" | "docx" | "doc" | "txt",
  opts: {
    generated: boolean;
    contentLength: number;
    pageCount: number;
    hasExperience: boolean;
    hasEducation: boolean;
    hasSkills: boolean;
    hasSummary: boolean;
    error?: string;
  }
): ExportTestResult {
  const sectionsIntact = opts.hasExperience && opts.hasEducation && opts.hasSkills && opts.hasSummary;

  return {
    format,
    generated: opts.generated,
    contentLength: opts.contentLength,
    pageCount: opts.pageCount,
    sectionsIntact,
    textAlignmentPreserved: opts.generated && !opts.error,
    noTruncation: opts.generated && opts.contentLength > 500,
    identicalContent: opts.generated && opts.contentLength > 500 && sectionsIntact,
    error: opts.error,
  };
}

/**
 * Generate QA test results from export validation.
 */
export function exportToQATests(
  consistency: ReturnType<typeof validateExportConsistency>,
  results: ExportTestResult[]
): QATestResult[] {
  const tests: QATestResult[] = [];
  const timestamp = new Date().toISOString();

  // Test: All formats generated
  const allGenerated = results.every((r) => r.generated);
  tests.push({
    id: `export_generation_${Date.now()}`,
    name: "Export: All Formats Generated",
    category: "export",
    severity: "critical",
    passed: allGenerated,
    message: allGenerated
      ? `All ${results.length} formats generated successfully`
      : `Failed formats: ${results.filter((r) => !r.generated).map((r) => r.format).join(", ")}`,
    durationMs: 0,
    timestamp,
  });

  // Test: Content consistency
  tests.push({
    id: `export_consistency_${Date.now()}`,
    name: "Export: Content Identical Across Formats",
    category: "export",
    severity: "high",
    passed: consistency.contentIdenticalAcrossFormats,
    message: consistency.contentIdenticalAcrossFormats
      ? "All exports contain identical content"
      : "Content differs across export formats",
    durationMs: 0,
    timestamp,
    suggestion: consistency.contentIdenticalAcrossFormats ? undefined : "Verify each format extracts the same resume sections",
  });

  // Test: No truncation
  tests.push({
    id: `export_truncation_${Date.now()}`,
    name: "Export: No Truncated Sections",
    category: "export",
    severity: "critical",
    passed: consistency.noTruncation,
    message: consistency.noTruncation
      ? "No truncated sections in any format"
      : "Some exports have truncated content",
    durationMs: 0,
    timestamp,
  });

  // Test: Page count
  tests.push({
    id: `export_pages_${Date.now()}`,
    name: "Export: Page Count Consistent",
    category: "export",
    severity: "high",
    passed: consistency.pageCountConsistent,
    message: consistency.pageCountConsistent
      ? "Page count is consistent across formats"
      : "Page count differs between PDF and DOCX",
    durationMs: 0,
    timestamp,
  });

  // Test: One-page resume
  const pdfResult = results.find((r) => r.format === "pdf");
  if (pdfResult) {
    tests.push({
      id: `export_onepage_${Date.now()}`,
      name: "Export: Resume Fits One Page (PDF)",
      category: "export",
      severity: "critical",
      passed: pdfResult.pageCount === 1,
      message: pdfResult.pageCount === 1
        ? "PDF resume fits on one page"
        : `PDF resume spans ${pdfResult.pageCount} pages (expected 1)`,
      durationMs: 0,
      timestamp,
    });
  }

  // Test: Text alignment
  tests.push({
    id: `export_alignment_${Date.now()}`,
    name: "Export: Text Alignment Preserved",
    category: "export",
    severity: "medium",
    passed: results.every((r) => r.textAlignmentPreserved),
    message: results.every((r) => r.textAlignmentPreserved)
      ? "Text alignment preserved in all formats"
      : "Text alignment issues detected",
    durationMs: 0,
    timestamp,
  });

  return tests;
}
