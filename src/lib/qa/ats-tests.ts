// ResumeAI Pro — ATS Mode Dynamic Tests
// Tests that the optimizer is dynamic and not hardcoded for any industry.
// Validates all 8 industry profiles are functional and auto-detection works.
//
// Pure functions — safe for Edge Runtime.

import type { QATestResult } from "./types";

/**
 * The expected industry modes — must NOT be hardcoded to just aviation/hospitality.
 */
const EXPECTED_INDUSTRY_MODES = [
  "aviation",
  "hospitality",
  "retail",
  "engineering",
  "finance",
  "healthcare",
  "IT",
  "marketing",
] as const;

/**
 * Patterns that indicate hardcoding (should NOT appear in the optimizer).
 */
const HARDCODED_PATTERNS = [
  { pattern: /cabin.?crew.?only/i, issue: "Optimizer hardcoded for Cabin Crew only" },
  { pattern: /aviation.?only/i, issue: "Optimizer hardcoded for Aviation only" },
  { pattern: /hospitality.?only/i, issue: "Optimizer hardcoded for Hospitality only" },
  { pattern: /always.*aviation/i, issue: "Optimizer always uses Aviation mode" },
  { pattern: /default.*cabin.?crew/i, issue: "Default is hardcoded to Cabin Crew" },
  { pattern: /industry.*===.*['\"]aviation['\"]/i, issue: "Hardcoded aviation check" },
  { pattern: /industry.*===.*['\"]hospitality['\"]/i, issue: "Hardcoded hospitality check" },
];

/**
 * Validate that all industry modes are available.
 */
export function validateIndustryModes(
  availableModes: string[]
): { allPresent: boolean; missing: string[]; extra: string[] } {
  const expected = [...EXPECTED_INDUSTRY_MODES].map((m) => m.toLowerCase());
  const available = availableModes.map((m) => m.toLowerCase());

  const missing = expected.filter((e) => !available.includes(e));
  const extra = available.filter((a) => !expected.includes(a));

  return {
    allPresent: missing.length === 0,
    missing,
    extra,
  };
}

/**
 * Scan source code for hardcoded industry patterns.
 */
export function scanForHardcodedIndustry(
  source: string,
  fileName: string
): Array<{ file: string; line: number; issue: string }> {
  const issues: Array<{ file: string; line: number; issue: string }> = [];

  for (const { pattern, issue } of HARDCODED_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const line = getLineNumber(source, m.index);
      issues.push({ file: fileName, line, issue });
    }
  }

  return issues;
}

/**
 * Validate that auto-detection works for different resume types.
 */
export function validateAutoDetection(
  testCases: Array<{ resumeSnippet: string; expectedIndustry: string; detectedIndustry: string }>
): { passed: boolean; failures: Array<{ expected: string; detected: string; snippet: string }> } {
  const failures = testCases.filter(
    (tc) => tc.detectedIndustry.toLowerCase() !== tc.expectedIndustry.toLowerCase()
  );

  return {
    passed: failures.length === 0,
    failures: failures.map((f) => ({
      expected: f.expectedIndustry,
      detected: f.detectedIndustry,
      snippet: f.resumeSnippet.slice(0, 50),
    })),
  };
}

/**
 * Generate QA test results from ATS mode validation.
 */
export function atsModeToQATests(
  industryValidation: ReturnType<typeof validateIndustryModes>,
  hardcodedIssues: Array<{ file: string; line: number; issue: string }>,
  autoDetectionResult?: ReturnType<typeof validateAutoDetection>
): QATestResult[] {
  const tests: QATestResult[] = [];
  const timestamp = new Date().toISOString();

  // Test: All industry modes available
  tests.push({
    id: `ats_industries_${Date.now()}`,
    name: "ATS: All Industry Modes Available",
    category: "ats",
    severity: "high",
    passed: industryValidation.allPresent,
    message: industryValidation.allPresent
      ? `All ${EXPECTED_INDUSTRY_MODES.length} industry modes available`
      : `Missing industry modes: ${industryValidation.missing.join(", ")}`,
    durationMs: 0,
    timestamp,
    suggestion: industryValidation.allPresent
      ? undefined
      : "Add the missing industry profiles to the industry-ats module",
  });

  // Test: No hardcoded industry patterns
  tests.push({
    id: `ats_hardcoded_${Date.now()}`,
    name: "ATS: No Hardcoded Industry Patterns",
    category: "ats",
    severity: "critical",
    passed: hardcodedIssues.length === 0,
    message: hardcodedIssues.length === 0
      ? "No hardcoded industry patterns detected — optimizer is dynamic"
      : `${hardcodedIssues.length} hardcoded pattern(s) detected: ${hardcodedIssues.map((i) => i.issue).join("; ")}`,
    durationMs: 0,
    timestamp,
    suggestion: hardcodedIssues.length > 0
      ? "The optimizer must be dynamic — never hardcode Cabin Crew, Aviation, or Hospitality"
      : undefined,
    details: {
      issues: hardcodedIssues,
    },
  });

  // Test: Auto-detection accuracy
  if (autoDetectionResult) {
    tests.push({
      id: `ats_autodetect_${Date.now()}`,
      name: "ATS: Auto-Detection Works Correctly",
      category: "ats",
      severity: "medium",
      passed: autoDetectionResult.passed,
      message: autoDetectionResult.passed
        ? "Industry auto-detection works for all test cases"
        : `${autoDetectionResult.failures.length} auto-detection failure(s): ${autoDetectionResult.failures.map((f) => `${f.expected}→${f.detected}`).join(", ")}`,
      durationMs: 0,
      timestamp,
    });
  }

  // Test: Optimizer is dynamic (not hardcoded)
  tests.push({
    id: `ats_dynamic_${Date.now()}`,
    name: "ATS: Optimizer is Dynamic (Not Hardcoded)",
    category: "ats",
    severity: "critical",
    passed: hardcodedIssues.length === 0 && industryValidation.allPresent,
    message: hardcodedIssues.length === 0 && industryValidation.allPresent
      ? "Optimizer is fully dynamic — all industry modes work"
      : "Optimizer has hardcoded patterns or missing industry modes — must be fixed",
    durationMs: 0,
    timestamp,
  });

  return tests;
}

function getLineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
