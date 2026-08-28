// ============================================================================
// Structured failure feedback — DIRECTIVE: retries observe WHAT failed.
//
// Agentic loops converge because every retry carries a STRUCTURED observation
// of the previous failure (violations, missing keywords, failed checks,
// factual issues, parse errors) — never a bare "try again". This module is
// the canonical builder used by every retry prompt in the pipeline
// (locked-pipeline attempt feedback, orchestrator self-healing critique,
// parse-repair rounds).
// ============================================================================

export interface StructuredFailureFeedback {
  /** Which stage/agent produced the failure. */
  stage: string;
  /** Contract violations (e.g. OptimizerOutputValidator). */
  violations?: string[];
  /** Keywords that must still be integrated naturally. */
  missingKeywords?: string[];
  /** Keyword coverage stats: integrated/total actionable. */
  keywordCoverage?: { integrated: number; total: number };
  /** QA check failures ("- name: details"). */
  failedChecks?: string[];
  /** Factual-consistency issues (fabricated entities…). */
  factualIssues?: string[];
  /** Structured-output parse/schema error (repair rounds). */
  parseError?: string;
  /** Layout/A4 overflow diagnostics. */
  layoutIssues?: string[];
}

/**
 * Build the canonical retry feedback block. Always names the stage, then
 * lists each failure category that has content, then closes with a
 * non-negotiable fix instruction. Empty input yields an empty string
 * (no feedback noise when there is nothing to report).
 */
export function buildStructuredFailureFeedback(f: StructuredFailureFeedback): string {
  const sections: string[] = [];

  sections.push(`FAILED STAGE: ${f.stage}`);

  if (f.parseError) {
    sections.push(`PARSE/SCHEMA ERROR (your previous output was not valid structured data): ${f.parseError}`);
  }
  if (f.violations?.length) {
    sections.push(`CONTRACT VIOLATIONS:\n${f.violations.map((v) => `- ${v}`).join("\n")}`);
  }
  if (f.keywordCoverage) {
    sections.push(`KEYWORD COVERAGE: ${f.keywordCoverage.integrated}/${f.keywordCoverage.total} actionable keywords integrated.`);
  }
  if (f.missingKeywords?.length) {
    sections.push(`MISSING KEYWORDS to integrate NATURALLY (no stuffing):\n${f.missingKeywords.slice(0, 8).map((k) => `- ${k}`).join("\n")}`);
  }
  if (f.failedChecks?.length) {
    sections.push(`FAILED QA CHECKS:\n${f.failedChecks.map((c) => `- ${c}`).join("\n")}`);
  }
  if (f.factualIssues?.length) {
    sections.push(`FACTUAL CONSISTENCY ISSUES (MUST be fixed — never fabricate):\n${f.factualIssues.map((c) => `- ${c}`).join("\n")}`);
  }
  if (f.layoutIssues?.length) {
    sections.push(`LAYOUT ISSUES:\n${f.layoutIssues.map((c) => `- ${c}`).join("\n")}`);
  }

  if (sections.length === 1) return ""; // only the stage header — nothing actionable

  return [
    "STRUCTURED FEEDBACK FROM THE PREVIOUS ATTEMPT (YOU MUST FIX THESE ISSUES):",
    ...sections,
    "Fix EVERY listed issue in this attempt. Keep every fact (employers, titles, dates, education) exactly as provided.",
  ].join("\n");
}
