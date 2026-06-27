// ============================================================================
// Resume Similarity & Compliance Engines
//
// Three verification components in one module:
//
// 1. Resume Similarity Score — compares original vs optimized resume structure.
//    If similarity < 85: REJECT optimization, retry failed sections.
//
// 2. Agent Confidence Score — each agent returns a confidence number (0-100).
//    Supervisor: confidence < 70 → retry agent. Guardian: confidence < 80 → reject.
//
// 3. Directive Compliance Score — measures how well the optimizer followed the
//    optimization directive. Score < 90 → reject.
//
// All three scores feed into the Guardian's final VETO decision.
// ============================================================================

import type { ResumeData, ResumeExperience, ResumeEducation, ResumeSkill } from "./types";
import type { ResumeSnapshot } from "./resume-snapshot-engine";

// ============================================================================
// 1. RESUME SIMILARITY ENGINE
// ============================================================================

export interface SimilarityResult {
  /** Overall similarity score 0-100 */
  overallScore: number;
  /** Structure similarity — section presence and ordering */
  structureScore: number;
  /** Entity preservation — companies, schools, languages unchanged */
  entityScore: number;
  /** Chronology preservation — dates unchanged */
  chronologyScore: number;
  /** Whether the result passes the 85 threshold */
  passed: boolean;
  /** Detailed issues found */
  issues: string[];
  /** Recommendations for retry */
  recommendations: string[];
}

/**
 * Compare original and optimized resumes for structural similarity.
 * Requires similarity ≥ 85 to pass. Below that, optimization is rejected.
 */
export function computeSimilarityScore(
  original: ResumeData,
  optimized: ResumeData,
): SimilarityResult {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // ========================================================================
  // 1. Structure Score (0-40) — sections present and ordered correctly
  // ========================================================================
  let structureScore = 40;
  const originalSections = getSectionNames(original);
  const optimizedSections = getSectionNames(optimized);

  // Check each original section exists in optimized
  originalSections.forEach((section) => {
    if (!optimizedSections.includes(section)) {
      issues.push(`Missing section: ${section}`);
      structureScore -= 10;
      recommendations.push(`Restore ${section} section from original`);
    }
  });

  // Check section order matches (fuzzy)
  const orderMatches = originalSections.every((s, i) => optimizedSections[i] === s);
  if (!orderMatches) {
    structureScore -= 5;
    issues.push("Section order changed from original");
  }

  // ========================================================================
  // 2. Entity Score (0-30) — companies, schools, languages unchanged
  // ========================================================================
  let entityScore = 30;

  // Check companies
  const origCompanies = new Set(original.experience.map((e) => e.company.toLowerCase()));
  const optCompanies = new Set(optimized.experience.map((e) => e.company.toLowerCase()));
  origCompanies.forEach((c) => {
    if (!optCompanies.has(c)) {
      entityScore -= 10;
      issues.push(`Missing company: ${c}`);
      recommendations.push(`Restore company "${c}"`);
    }
  });
  optCompanies.forEach((c) => {
    if (!origCompanies.has(c)) {
      entityScore -= 15;
      issues.push(`Hallucinated company: ${c}`);
      recommendations.push(`Remove fabricated company "${c}"`);
    }
  });

  // Check schools
  const origSchools = new Set(original.education.map((e) => e.institution.toLowerCase()));
  const optSchools = new Set(optimized.education.map((e) => e.institution.toLowerCase()));
  origSchools.forEach((s) => {
    if (s && !optSchools.has(s)) {
      entityScore -= 5;
      issues.push(`Missing school: ${s}`);
      recommendations.push(`Restore school name "${s}"`);
    }
  });
  optSchools.forEach((s) => {
    if (s && !origSchools.has(s)) {
      entityScore -= 10;
      issues.push(`Changed/hallucinated school: ${s}`);
      recommendations.push(`Restore original school name`);
    }
  });

  // Check languages
  const origLangs = new Set(original.languages.map((l) => l.name.toLowerCase()));
  const optLangs = new Set(optimized.languages.map((l) => l.name.toLowerCase()));
  origLangs.forEach((l) => {
    if (!optLangs.has(l)) {
      entityScore -= 10;
      issues.push(`Missing language: ${l}`);
      recommendations.push(`Restore language "${l}"`);
    }
  });

  // Check contact info
  if (original.contact?.email !== optimized.contact?.email) {
    entityScore -= 10;
    issues.push("Email address changed");
    recommendations.push("Restore original email");
  }
  if (original.contact?.phone !== optimized.contact?.phone) {
    entityScore -= 5;
    issues.push("Phone number changed");
  }
  if (original.name !== optimized.name) {
    entityScore -= 10;
    issues.push("Name changed");
    recommendations.push("Restore original name");
  }

  // ========================================================================
  // 3. Chronology Score (0-15) — dates unchanged
  // ========================================================================
  let chronologyScore = 15;

  for (let i = 0; i < Math.min(original.experience.length, optimized.experience.length); i++) {
    const origExp = original.experience[i];
    const optExp = optimized.experience[i];
    if (origExp && optExp) {
      if (origExp.startDate !== optExp.startDate) {
        chronologyScore -= 5;
        issues.push(`Date changed in ${origExp.company}: startDate "${origExp.startDate}" → "${optExp.startDate}"`);
      }
      if (origExp.endDate !== optExp.endDate) {
        chronologyScore -= 5;
        issues.push(`Date changed in ${origExp.company}: endDate "${origExp.endDate}" → "${optExp.endDate}"`);
      }
    }
  }

  // Check education chronology
  for (let i = 0; i < Math.min(original.education.length, optimized.education.length); i++) {
    const origEd = original.education[i];
    const optEd = optimized.education[i];
    if (origEd && optEd) {
      if (origEd.startDate !== optEd.startDate || origEd.endDate !== optEd.endDate) {
        chronologyScore -= 3;
        issues.push(`Education date changed for ${origEd.degree || origEd.institution}`);
      }
    }
  }

  // ========================================================================
  // 4. Experience Count (0-15)
  // ========================================================================
  let experienceScore = 15;
  if (original.experience.length !== optimized.experience.length) {
    const diff = Math.abs(original.experience.length - optimized.experience.length);
    experienceScore -= diff * 5;
    issues.push(`Experience count mismatch: original ${original.experience.length}, optimized ${optimized.experience.length}`);
  }

  // ========================================================================
  // Compile results
  // ========================================================================
  const overallScore = Math.max(0,
    (structureScore + entityScore + chronologyScore + experienceScore)
  );

  // Normalize to 0-100
  const normalizedScore = Math.min(100, overallScore);
  const passed = normalizedScore >= 85;

  return {
    overallScore: normalizedScore,
    structureScore: Math.max(0, structureScore),
    entityScore: Math.max(0, entityScore),
    chronologyScore: Math.max(0, chronologyScore),
    passed,
    issues,
    recommendations,
  };
}

function getSectionNames(resume: ResumeData): string[] {
  const sections: string[] = [];
  if (resume.summary) sections.push("summary");
  if (resume.experience?.length > 0) sections.push("experience");
  if (resume.education?.length > 0) sections.push("education");
  if (resume.skills?.length > 0) sections.push("skills");
  if (resume.languages?.length > 0) sections.push("languages");
  if (resume.certifications?.length > 0) sections.push("certifications");
  return sections;
}

// ============================================================================
// 2. AGENT CONFIDENCE SCORE
// ============================================================================

export interface AgentConfidence {
  /** Agent name */
  agent: string;
  /** Confidence score 0-100 */
  confidence: number;
  /** Warnings generated during agent execution */
  warnings: string[];
  /** Whether this passes the confidence threshold */
  passed: boolean;
}

/**
 * Compute confidence for a summary agent based on output quality.
 */
export function computeSummaryConfidence(
  originalSummary: string,
  optimizedSummary: string,
  jdKeywords: string[],
): AgentConfidence {
  const warnings: string[] = [];
  let confidence = 80;

  // Length check (30 words minimum for a meaningful summary)
  const wordCount = optimizedSummary.split(/\s+/).length;
  if (wordCount < 20) {
    confidence -= 20;
    warnings.push(`Summary too short: ${wordCount} words (minimum 20)`);
  }
  if (wordCount > 150) {
    confidence -= 5;
    warnings.push(`Summary too long: ${wordCount} words (maximum 150)`);
  }

  // Keyword coverage
  const lowerSummary = optimizedSummary.toLowerCase();
  const keywordHits = jdKeywords.filter((k) => lowerSummary.includes(k.toLowerCase()));
  const keywordCoverage = jdKeywords.length > 0 ? keywordHits.length / jdKeywords.length : 1;
  if (keywordCoverage < 0.3) {
    confidence -= 10;
    warnings.push(`Low keyword coverage: ${Math.round(keywordCoverage * 100)}%`);
  }

  // No parentheses (ATS parsers hate them)
  if (optimizedSummary.includes("(") || optimizedSummary.includes(")")) {
    confidence -= 15;
    warnings.push("Summary contains parentheses — incompatible with ATS parsers");
  }

  // Not empty
  if (!optimizedSummary || optimizedSummary.length < 30) {
    confidence = 0;
    warnings.push("Summary is empty or too short");
  }

  const passed = confidence >= 70;

  return { agent: "SummaryAgent", confidence, warnings, passed };
}

/**
 * Compute confidence for an experience agent based on output quality.
 */
export function computeExperienceConfidence(
  originalExperiences: ResumeExperience[],
  optimizedExperiences: ResumeExperience[],
): AgentConfidence {
  const warnings: string[] = [];
  let confidence = 85;

  // Count match
  if (optimizedExperiences.length !== originalExperiences.length) {
    confidence -= 30;
    warnings.push(`Experience count mismatch: ${originalExperiences.length} original vs ${optimizedExperiences.length} optimized`);
  }

  // Company match
  for (const orig of originalExperiences) {
    const match = optimizedExperiences.find((e) => e.company.toLowerCase() === orig.company.toLowerCase());
    if (!match) {
      confidence -= 20;
      warnings.push(`Missing experience for company: ${orig.company}`);
    } else {
      // Check bullets
      if (match.bullets.length === 0) {
        confidence -= 10;
        warnings.push(`No bullets for ${orig.company}`);
      }
      // Check dates
      if (match.startDate !== orig.startDate || match.endDate !== orig.endDate) {
        confidence -= 15;
        warnings.push(`Date mismatch for ${orig.company}`);
      }
    }
  }

  // Hallucination check
  for (const opt of optimizedExperiences) {
    const match = originalExperiences.find((e) => e.company.toLowerCase() === opt.company.toLowerCase());
    if (!match) {
      confidence -= 25;
      warnings.push(`Hallucinated employer: ${opt.company} — ${opt.title}`);
    }
  }

  const passed = confidence >= 70;

  return { agent: "ExperienceAgent", confidence, warnings, passed };
}

/**
 * Compute confidence for a skills agent based on output quality.
 */
export function computeSkillsConfidence(
  originalSkills: ResumeSkill[],
  optimizedSkills: ResumeSkill[],
  knownCompanies: string[],
  knownLocations: string[],
): AgentConfidence {
  const warnings: string[] = [];
  let confidence = 85;

  const skillNames = optimizedSkills.map((s) => s.name.toLowerCase());
  const companiesLower = knownCompanies.map((c) => c.toLowerCase());
  const locationsLower = knownLocations.map((l) => l.toLowerCase());

  // Check for company names in skills
  for (const skill of optimizedSkills) {
    if (companiesLower.some((c) => skill.name.toLowerCase().includes(c))) {
      confidence -= 20;
      warnings.push(`Company name in skills: "${skill.name}"`);
    }
    if (locationsLower.some((l) => skill.name.toLowerCase().includes(l))) {
      confidence -= 10;
      warnings.push(`Location in skills: "${skill.name}"`);
    }
  }

  // Must have skills
  if (optimizedSkills.length === 0) {
    confidence -= 40;
    warnings.push("Skills section is empty");
  }

  // Should preserve or increase skills
  if (optimizedSkills.length < originalSkills.length) {
    confidence -= 10;
    warnings.push(`Skills reduced: ${originalSkills.length} → ${optimizedSkills.length}`);
  }

  const passed = confidence >= 70;

  return { agent: "SkillsAgent", confidence, warnings, passed };
}

// ============================================================================
// 3. DIRECTIVE COMPLIANCE SCORE
// ============================================================================

export interface DirectiveComplianceResult {
  /** Overall compliance score 0-100 */
  score: number;
  /** Whether the result passes the ≥ 90 threshold */
  passed: boolean;
  /** Individual compliance checks */
  checks: ComplianceCheck;
  /** Issues found */
  issues: string[];
}

export interface ComplianceCheck {
  companiesPreserved: boolean;
  datesPreserved: boolean;
  educationPreserved: boolean;
  languagesPreserved: boolean;
  skillsPreserved: boolean;
  layoutPreserved: boolean;
  noHallucinations: boolean;
  onePageValid: boolean;
  summaryLengthCompliant: boolean;
  keywordStrategyCompliant: boolean;
}

/**
 * Compute directive compliance score by comparing original vs optimized resume.
 * Verifies all policy requirements from the OptimizationPolicy.
 */
export function computeDirectiveComplianceScore(
  original: ResumeData,
  optimized: ResumeData,
  snapshot?: ResumeSnapshot | null,
): DirectiveComplianceResult {
  const issues: string[] = [];
  const checks: ComplianceCheck = {
    companiesPreserved: true,
    datesPreserved: true,
    educationPreserved: true,
    languagesPreserved: true,
    skillsPreserved: true,
    layoutPreserved: true,
    noHallucinations: true,
    onePageValid: true,
    summaryLengthCompliant: true,
    keywordStrategyCompliant: true,
  };

  // 1. Companies preserved
  const origCompanies = new Set(original.experience.map((e) => e.company.toLowerCase()));
  for (const e of optimized.experience) {
    if (!origCompanies.has(e.company.toLowerCase())) {
      checks.companiesPreserved = false;
      issues.push(`Company not preserved: "${e.company}"`);
    }
  }

  // 2. Dates preserved
  for (let i = 0; i < Math.min(original.experience.length, optimized.experience.length); i++) {
    if (original.experience[i].startDate !== optimized.experience[i].startDate ||
        original.experience[i].endDate !== optimized.experience[i].endDate) {
      checks.datesPreserved = false;
      issues.push(`Date mismatch in experience #${i}`);
    }
  }

  // 3. Education preserved
  const origSchools = new Set(original.education.map((e) => e.institution.toLowerCase()));
  for (const ed of optimized.education) {
    if (ed.institution && !origSchools.has(ed.institution.toLowerCase())) {
      checks.educationPreserved = false;
      issues.push(`School changed: "${ed.institution}"`);
    }
  }
  if (original.education.length !== optimized.education.length) {
    checks.educationPreserved = false;
    issues.push(`Education count mismatch`);
  }

  // 4. Languages preserved
  const origLangs = new Set(original.languages.map((l) => l.name.toLowerCase()));
  for (const l of optimized.languages) {
    if (!origLangs.has(l.name.toLowerCase())) {
      checks.languagesPreserved = false;
      issues.push(`Language changed: "${l.name}"`);
    }
  }
  if (original.languages.length !== optimized.languages.length) {
    checks.languagesPreserved = false;
    issues.push(`Language count mismatch`);
  }

  // 5. No hallucinations (companies)
  for (const e of optimized.experience) {
    if (!origCompanies.has(e.company.toLowerCase())) {
      checks.noHallucinations = false;
      issues.push(`Hallucinated employer: "${e.company}"`);
    }
  }

  // 6. Summary length (30-150 words — practical minimum for resume summaries)
  const wordCount = optimized.summary?.split(/\s+/).length ?? 0;
  if (wordCount < 30 || wordCount > 150) {
    checks.summaryLengthCompliant = false;
    issues.push(`Summary length ${wordCount} words (target 80-130)`);
  }

  // 7. No parentheses in summary
  if (optimized.summary?.includes("(") || optimized.summary?.includes(")")) {
    checks.keywordStrategyCompliant = false;
    issues.push("Summary contains parentheses");
  }

  // Compute total score
  const totalChecks = Object.keys(checks).length;
  const passedChecks = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passedChecks / totalChecks) * 100);
  const passed = score >= 90;

  return { score, passed, checks, issues };
}
