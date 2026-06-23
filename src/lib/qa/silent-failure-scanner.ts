// ResumeAI Pro — Silent Failure Scanner
// Scans the codebase for patterns that indicate silent failures:
// empty catch blocks, fallback returns without logging, swallowed errors.
//
// This runs as a build-time and deploy-time check.

import type { SilentFailureMatch, SilentFailureReport, QATestResult } from "./types";
import { SILENT_FAILURE_PATTERNS } from "./types";

/**
 * Scan source code for silent failure patterns.
 * Returns all matches with file, line, and context.
 */
export function scanSourceForSilentFailures(
  source: string,
  fileName: string
): SilentFailureMatch[] {
  const matches: SilentFailureMatch[] = [];

  for (const { regex, pattern, severity, suggestion } of SILENT_FAILURE_PATTERNS) {
    // Reset regex state for global patterns
    const re = new RegExp(regex.source, regex.flags);
    let m: RegExpExecArray | null;

    while ((m = re.exec(source)) !== null) {
      const line = getLineNumber(source, m.index);
      const column = getColumnNumber(source, m.index);
      const snippet = getContextSnippet(source, m.index, 80);

      matches.push({
        file: fileName,
        line,
        column,
        pattern,
        snippet,
        severity,
        suggestion,
      });
    }
  }

  return matches;
}

/**
 * Scan multiple source files for silent failures.
 */
export function scanMultipleSources(
  sources: Array<{ content: string; fileName: string }>
): SilentFailureReport {
  const allMatches: SilentFailureMatch[] = [];

  for (const { content, fileName } of sources) {
    allMatches.push(...scanSourceForSilentFailures(content, fileName));
  }

  const criticalMatches = allMatches.filter(
    (m) => m.severity === "critical"
  );

  return {
    totalMatches: allMatches.length,
    criticalMatches: criticalMatches.length,
    matches: allMatches,
    passed: criticalMatches.length === 0,
  };
}

/**
 * Generate QA test results from silent failure scan.
 */
export function silentFailureToQATests(
  report: SilentFailureReport
): QATestResult[] {
  const tests: QATestResult[] = [];
  const timestamp = new Date().toISOString();

  // Test: No critical silent failures
  tests.push({
    id: `silent_critical_${Date.now()}`,
    name: "Silent Failures: No Critical Empty Catch Blocks",
    category: "api",
    severity: "critical",
    passed: report.criticalMatches === 0,
    message:
      report.criticalMatches === 0
        ? "No critical silent failure patterns detected"
        : `${report.criticalMatches} critical silent failure(s) detected: empty catch blocks, swallowed exceptions`,
    durationMs: 0,
    timestamp,
    suggestion:
      report.criticalMatches > 0
        ? "Every catch block must log, surface, or report the error. Never swallow exceptions."
        : undefined,
    details: {
      criticalFiles: [...new Set(report.matches.filter((m) => m.severity === "critical").map((m) => m.file))],
    },
  });

  // Test: Total silent failure count
  tests.push({
    id: `silent_total_${Date.now()}`,
    name: "Silent Failures: Total Count Acceptable",
    category: "api",
    severity: "high",
    passed: report.totalMatches <= 5,
    message:
      report.totalMatches <= 5
        ? `${report.totalMatches} silent failure patterns found (acceptable threshold: 5)`
        : `${report.totalMatches} silent failure patterns found (threshold: 5) — review and fix`,
    durationMs: 0,
    timestamp,
    suggestion:
      report.totalMatches > 5
        ? "Review all catch blocks and fallback returns for proper error handling"
        : undefined,
  });

  return tests;
}

// ============================================================================
// Helpers
// ============================================================================

function getLineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function getColumnNumber(text: string, index: number): number {
  let col = 1;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === "\n") break;
    col++;
  }
  return col;
}

function getContextSnippet(text: string, index: number, maxLength: number): string {
  const start = Math.max(0, index - Math.floor(maxLength / 2));
  const end = Math.min(text.length, index + Math.ceil(maxLength / 2));
  let snippet = text.slice(start, end).replace(/\n/g, " ").trim();
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}
