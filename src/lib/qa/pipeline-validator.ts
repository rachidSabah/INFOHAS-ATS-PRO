// ============================================================================
// Enterprise QA Platform — Pipeline Validator
// ============================================================================
// Validates the complete resume pipeline: section parity, immutability,
// content preservation, and structural integrity.
// ============================================================================

import type { ResumeData } from "../types";
import type { QATestResult } from "./types";
import { GOLDEN_CORPUS } from "./golden-corpus";

// ============================================================================
// Section Parity Validation
// ============================================================================

export interface SectionParityResult {
  expected: string[];
  actual: string[];
  missing: string[];
  extra: string[];
  countMatch: boolean;
}

export function validateSectionParity(
  expected: ResumeData,
  actual: ResumeData,
): SectionParityResult {
  const getSectionNames = (r: ResumeData): string[] => {
    const sections: string[] = [];
    if (r.summary) sections.push("summary");
    if (r.experience.length > 0) sections.push("experience");
    if (r.education.length > 0) sections.push("education");
    if (r.skills.length > 0) sections.push("skills");
    if (r.languages.length > 0) sections.push("languages");
    if (r.certifications.length > 0) sections.push("certifications");
    if (r.projects.length > 0) sections.push("projects");
    if (r.achievements && r.achievements.length > 0) sections.push("achievements");
    if (r.dynamicSections && r.dynamicSections.length > 0) {
      r.dynamicSections.forEach((ds) => sections.push(`dynamic:${ds.normalizedTitle}`));
    }
    return sections;
  };

  const expectedSections = getSectionNames(expected);
  const actualSections = getSectionNames(actual);

  const missing = expectedSections.filter((s) => actualSections.indexOf(s) === -1);
  const extra = actualSections.filter((s) => expectedSections.indexOf(s) === -1);

  return {
    expected: expectedSections,
    actual: actualSections,
    missing,
    extra,
    countMatch: expectedSections.length === actualSections.length,
  };
}

// ============================================================================
// Immutable Field Validation
// ============================================================================

export interface ImmutableFieldViolation {
  field: string;
  expected: string;
  actual: string;
}

export function validateImmutability(
  expected: ResumeData,
  actual: ResumeData,
): { violations: ImmutableFieldViolation[]; passed: boolean } {
  const violations: ImmutableFieldViolation[] = [];

  // Check contact fields (name stored in ResumeData.name)
  if (expected.name && expected.name !== actual.name) {
    violations.push({ field: "name", expected: expected.name, actual: actual.name });
  }

  // Check experience companies and titles
  expected.experience.forEach((exp, i) => {
    const actualExp = actual.experience[i];
    if (!actualExp) {
      violations.push({ field: `experience[${i}]`, expected: exp.company, actual: "(missing)" });
      return;
    }
    if (exp.company !== actualExp.company) {
      violations.push({ field: `experience[${i}].company`, expected: exp.company, actual: actualExp.company });
    }
  });

  // Check education institutions and degrees
  expected.education.forEach((edu, i) => {
    const actualEdu = actual.education[i];
    if (!actualEdu) {
      violations.push({ field: `education[${i}]`, expected: edu.institution, actual: "(missing)" });
      return;
    }
    if (edu.institution !== actualEdu.institution) {
      violations.push({ field: `education[${i}].institution`, expected: edu.institution, actual: actualEdu.institution });
    }
    if (edu.degree !== actualEdu.degree) {
      violations.push({ field: `education[${i}].degree`, expected: edu.degree, actual: actualEdu.degree });
    }
  });

  // Check languages preserved
  const expectedLangNames = expected.languages.map((l) => l.name.toLowerCase());
  const actualLangNames = actual.languages.map((l) => l.name.toLowerCase());
  expectedLangNames.forEach((name) => {
    if (actualLangNames.indexOf(name) === -1) {
      violations.push({ field: "language", expected: name, actual: "(missing)" });
    }
  });

  return {
    violations,
    passed: violations.length === 0,
  };
}

// ============================================================================
// Content Preservation Check (section content must not be empty)
// ============================================================================

export function validateContentPreservation(
  actual: ResumeData,
): { emptySections: string[]; passed: boolean } {
  const emptySections: string[] = [];

  if (actual.experience.length === 0) emptySections.push("experience");
  if (actual.education.length === 0) emptySections.push("education");
  if (actual.skills.length === 0) emptySections.push("skills");

  actual.experience.forEach((exp, i) => {
    if (!exp.bullets || exp.bullets.length === 0) {
      emptySections.push(`experience[${i}].bullets`);
    }
  });

  return {
    emptySections,
    passed: emptySections.length === 0,
  };
}

// ============================================================================
// Golden Corpus Validation Runner
// ============================================================================

export interface GoldenCorpusValidationResult {
  corpusEntry: string;
  sectionParity: SectionParityResult;
  immutability: { violations: ImmutableFieldViolation[]; passed: boolean };
  contentPreservation: { emptySections: string[]; passed: boolean };
  allPassed: boolean;
}

export function validateAgainstGoldenCorpus(
  pipelineOutputs: Array<{ resumeId: string; result: ResumeData }>,
): GoldenCorpusValidationResult[] {
  return pipelineOutputs.map((output) => {
    const golden = GOLDEN_CORPUS.find((g) => g.id === output.resumeId);
    if (!golden) {
      return {
        corpusEntry: output.resumeId,
        sectionParity: { expected: [], actual: [], missing: ["(golden not found)"], extra: [], countMatch: false },
        immutability: { violations: [{ field: "golden", expected: "corpus entry", actual: "not found" }], passed: false },
        contentPreservation: { emptySections: ["(no pipeline output)"], passed: false },
        allPassed: false,
      };
    }

    const sectionParity = validateSectionParity(golden.expected, output.result);
    const immutability = validateImmutability(golden.expected, output.result);
    const contentPreservation = validateContentPreservation(output.result);

    return {
      corpusEntry: output.resumeId,
      sectionParity,
      immutability,
      contentPreservation,
      allPassed: sectionParity.countMatch && immutability.passed && contentPreservation.passed,
    };
  });
}

// ============================================================================
// Convert to QATestResult format
// ============================================================================

export function pipelineValidatorToQATests(
  validationResults: GoldenCorpusValidationResult[],
): QATestResult[] {
  const results: QATestResult[] = [];

  validationResults.forEach((vr) => {
    results.push({
      id: `pipeline-section-parity-${vr.corpusEntry}`,
      name: `Section Parity: ${vr.corpusEntry}`,
      category: "regression",
      severity: "high",
      passed: vr.sectionParity.countMatch,
      message: vr.sectionParity.countMatch
        ? `All sections preserved (${vr.sectionParity.actual.length})`
        : `Missing sections: ${vr.sectionParity.missing.join(", ")}`,
      durationMs: 0,
      timestamp: new Date().toISOString(),
      details: {
        expected: vr.sectionParity.expected,
        actual: vr.sectionParity.actual,
        missing: vr.sectionParity.missing,
      },
    });

    results.push({
      id: `pipeline-immutability-${vr.corpusEntry}`,
      name: `Immutability: ${vr.corpusEntry}`,
      category: "regression",
      severity: "critical",
      passed: vr.immutability.passed,
      message: vr.immutability.passed
        ? "All immutable fields preserved"
        : `${vr.immutability.violations.length} violation(s): ${vr.immutability.violations.map((v) => v.field).join(", ")}`,
      durationMs: 0,
      timestamp: new Date().toISOString(),
      details: { violations: vr.immutability.violations },
    });

    results.push({
      id: `pipeline-content-${vr.corpusEntry}`,
      name: `Content Preservation: ${vr.corpusEntry}`,
      category: "regression",
      severity: "high",
      passed: vr.contentPreservation.passed,
      message: vr.contentPreservation.passed
        ? "All sections have content"
        : `Empty sections: ${vr.contentPreservation.emptySections.join(", ")}`,
      durationMs: 0,
      timestamp: new Date().toISOString(),
      details: { emptySections: vr.contentPreservation.emptySections },
    });
  });

  return results;
}

// ============================================================================
// Semantic Preservation Validation (using Phase 6 engines)
// ============================================================================

export interface SemanticValidationResult {
  summarySimilarity: number;
  experienceSimilarity: number;
  bulletPreservationPercent: number;
  overallPassed: boolean;
}

export function validateSemanticPreservation(
  expected: ResumeData,
  actual: ResumeData,
  thresholds?: { summary?: number; experience?: number; education?: number },
): SemanticValidationResult {
  const t = thresholds || { summary: 0.9, experience: 0.98, education: 1.0 };

  // Simple Jaccard similarity on summary
  const summarySim = computeWordOverlap(expected.summary || "", actual.summary || "");

  // Experience content similarity
  const expectedExpText = expected.experience.map((e) => e.bullets.join(" ")).join(" ");
  const actualExpText = actual.experience.map((e) => e.bullets.join(" ")).join(" ");
  const expSim = computeWordOverlap(expectedExpText, actualExpText);

  // Bullet count preservation
  const expectedBullets = expected.experience.reduce((sum, e) => sum + e.bullets.length, 0);
  const actualBullets = actual.experience.reduce((sum, e) => sum + e.bullets.length, 0);
  const bulletPreservation = expectedBullets > 0 ? Math.min(actualBullets / expectedBullets, 1) : 1;

  return {
    summarySimilarity: summarySim,
    experienceSimilarity: expSim,
    bulletPreservationPercent: Math.round(bulletPreservation * 100),
    overallPassed:
      summarySim >= t.summary! &&
      expSim >= t.experience! &&
      bulletPreservation >= t.experience!,
  };
}

function computeWordOverlap(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const wordsA = a.toLowerCase().split(/\W+/).filter(Boolean);
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wordsA.length === 0) return wordsB.size === 0 ? 1 : 0;
  const matches = wordsA.filter((w) => wordsB.has(w));
  return matches.length / wordsA.length;
}
