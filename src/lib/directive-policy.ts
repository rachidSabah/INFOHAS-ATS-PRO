// ============================================================================
// OptimizationPolicy — Single Source of Truth for all optimization behavior
//
// This file defines the OptimizationPolicy type and the buildOptimizationPolicy
// function that derives it from the store state (OptimizerDirectiveConfig).
//
// The policy is injected into EVERY agent as "SYSTEM POLICY:" at the top of
// their system prompt. Agents cannot override it. QA validates against it.
// ============================================================================

"use client";

import type { OptimizerDirectiveConfig, ResumeData } from "./types";

// ============================================================================
// OPTIMIZATION POLICY TYPE
// ============================================================================

export interface OptimizationPolicy {
  version: string;

  // === LAYOUT ===
  pageLimit: "one-page" | "two-page" | "auto";
  layoutTemplate: "preserve-original" | "modern" | "professional";
  fontSize: number;
  lineHeight: number;

  // === SUMMARY ===
  summaryLength: "short" | "medium" | "comprehensive";
  summaryMinWords: number;
  summaryMaxWords: number;

  // === OPTIMIZATION LEVEL ===
  optimizationLevel: "conservative" | "balanced" | "aggressive";

  // === KEYWORDS ===
  keywordStrategy: "minimal" | "balanced" | "ats-heavy";

  // === SKILLS ===
  skillsStrategy: "real-skills-only" | "enrich-with-keywords";

  // === EXPERIENCE ===
  experienceStrategy: "bullet-only" | "bullet-and-title" | "full-rewrite";

  // === IMMUTABLE ENTITY FLAGS ===
  preserveCompanies: boolean;
  preserveDates: boolean;
  preserveEducation: boolean;
  preserveLanguages: boolean;
  preserveCertifications: boolean;
  preserveContact: boolean;

  // === FORBIDDEN BEHAVIORS ===
  forbidKeywordDumping: boolean;
  forbidTargetedKeywordsSection: boolean;
  forbidFakeSkills: boolean;
  forbidSectionReorder: boolean;
  forbidSectionAddRemove: boolean;

  // === HALLUCINATION GUARD ===
  hallucinationPolicy: "strict" | "lenient" | "off";

  // === SUPERVISOR CONTROLS ===
  supervisorStrictMode: boolean;
  supervisorEnableRetries: boolean;
  supervisorEnableProviderSwitch: boolean;

  // === FORMATTING ===
  formattingRules: {
    experienceHeader: string;   // "<Role> | <Company> | <Date>"
    educationHeader: string;    // "<Diploma> | <School> | <Date>"
    bulletPrefix: string;       // "• " or ""
    dateFormat: string;         // "Mon YYYY" or "MM/YYYY"
    emptyCompanyFormat: string; // "omit-line" or "blank"
  };

  // === ATS ===
  // ATS
  atsStrategy: "minimal" | "balanced" | "ats-heavy";

  // === CHARACTER LIMITS ===
  maxTotalChars: number;
  minTotalChars: number;

  // === SECTION OWNERSHIP MAP ===
  // Maps each resume section to the agent that owns it
  sectionOwnership: Record<string, string>;
}

// ============================================================================
// POLICY BUILDER
// ============================================================================

const POLICY_VERSION = "1.0";

/**
 * Translate an atsAggressiveness number (0-100) to a keyword strategy label.
 */
function computeKeywordStrategy(atsAggressiveness: number): OptimizationPolicy["keywordStrategy"] {
  if (atsAggressiveness < 33) return "minimal";
  if (atsAggressiveness < 66) return "balanced";
  return "ats-heavy";
}

/**
 * Map atsAggressiveness to optimization level.
 */
function computeOptimizationLevel(atsAggressiveness: number): OptimizationPolicy["optimizationLevel"] {
  if (atsAggressiveness < 33) return "conservative";
  if (atsAggressiveness < 66) return "balanced";
  return "aggressive";
}

/**
 * Map summary minChars/maxChars to a summary length label.
 */
function computeSummaryLength(minChars: number, maxChars: number): OptimizationPolicy["summaryLength"] {
  const avgChar = (minChars + maxChars) / 2;
  if (avgChar < 600) return "short";
  if (avgChar < 1200) return "medium";
  return "comprehensive";
}

/**
 * Build the default section ownership map.
 */
function buildSectionOwnership(): Record<string, string> {
  return {
    summary: "summary-agent",
    skills: "skills-agent",
    experience: "experience-agent",
    education: "education-agent",
    languages: "languages-agent",
    certifications: "languages-agent",
    projects: "additional-information-agent",
  };
}

/**
 * Derive OptimizationPolicy from the store's OptimizerDirectiveConfig.
 *
 * This is the key function that bridges UI state → policy →
 * agent prompts. It reads ALL directive knobs and produces a
 * single, flat policy object that agents cannot override.
 */
export function buildOptimizationPolicy(
  directiveConfig: OptimizerDirectiveConfig | null | undefined,
  sourceResume?: ResumeData,
): OptimizationPolicy {
  const agentDirs = directiveConfig?.agentDirectives;

  const atsAggressiveness = agentDirs?.summary?.atsAggressiveness ?? 50;

  return {
    version: POLICY_VERSION,

    // Layout
    pageLimit: directiveConfig?.enforceOnePage ? "one-page" : "auto",
    layoutTemplate: "preserve-original",
    fontSize: directiveConfig?.bodyFontSizePt ?? 10.5,
    lineHeight: directiveConfig?.lineHeight ?? 1.2,

    // Summary
    summaryLength: computeSummaryLength(
      directiveConfig?.summaryMinWords ?? 300,
      directiveConfig?.summaryMaxWords ?? 800,
    ),
    summaryMinWords: directiveConfig?.summaryMinWords ?? 60,
    summaryMaxWords: directiveConfig?.summaryMaxWords ?? 130,

    // Optimization
    optimizationLevel: computeOptimizationLevel(atsAggressiveness),
    keywordStrategy: computeKeywordStrategy(atsAggressiveness),
    skillsStrategy: agentDirs?.skills?.allowCompanyKeywords ? "enrich-with-keywords" : "real-skills-only",
    experienceStrategy: "bullet-only",

    // Immutable entities
    preserveCompanies: agentDirs?.experience?.rewriteCompany !== true,
    preserveDates: agentDirs?.experience?.rewriteDates !== true,
    preserveEducation: true,
    preserveLanguages: true,
    preserveCertifications: true,
    preserveContact: true,

    // Forbidden behaviors
    forbidKeywordDumping: true,
    forbidTargetedKeywordsSection: true,
    forbidFakeSkills: true,
    forbidSectionReorder: true,
    forbidSectionAddRemove: true,

    // Hallucination guard
    hallucinationPolicy: "strict",

    // Supervisor controls
    supervisorStrictMode: agentDirs?.supervisor?.strictMode ?? true,
    supervisorEnableRetries: agentDirs?.supervisor?.enableRetries ?? true,
    supervisorEnableProviderSwitch: agentDirs?.supervisor?.enableProviderSwitch ?? false,

    // Formatting
    formattingRules: {
      experienceHeader: "<Role> | <Company> | <Date>",
      educationHeader: "<Diploma> | <School> | <Date>",
      bulletPrefix: "",
      dateFormat: "Mon YYYY",
      emptyCompanyFormat: "omit-line",
    },

    // ATS
    atsStrategy: computeKeywordStrategy(atsAggressiveness),

    // Character limits
    minTotalChars: 2500,
    maxTotalChars: 3800,

    // Section ownership
    sectionOwnership: buildSectionOwnership(),
  };
}

// ============================================================================
// POLICY SERIALIZATION
// ============================================================================

/**
 * Format the policy as a human-readable section for injection into LLM prompts.
 * Each agent prompt must begin with this section.
 */
export function formatPolicyForPrompt(policy: OptimizationPolicy): string {
  const lines: string[] = [];
  lines.push("=== SYSTEM POLICY ===");
  lines.push(`Version: ${policy.version}`);
  lines.push(`Page Limit: ${policy.pageLimit}`);
  lines.push(`Layout Template: ${policy.layoutTemplate}`);
  lines.push(`Font Size: ${policy.fontSize}pt, Line Height: ${policy.lineHeight}`);
  lines.push(`Summary Length: ${policy.summaryLength} (${policy.summaryMinWords}-${policy.summaryMaxWords} words)`);
  lines.push(`Optimization Level: ${policy.optimizationLevel}`);
  lines.push(`Keyword Strategy: ${policy.keywordStrategy}`);
  lines.push(`Skills Strategy: ${policy.skillsStrategy}`);
  lines.push(`Experience Strategy: ${policy.experienceStrategy}`);

  // Immutable entities
  const immutables: string[] = [];
  if (policy.preserveCompanies) immutables.push("Companies");
  if (policy.preserveDates) immutables.push("Dates");
  if (policy.preserveEducation) immutables.push("Education");
  if (policy.preserveLanguages) immutables.push("Languages");
  if (policy.preserveCertifications) immutables.push("Certifications");
  if (policy.preserveContact) immutables.push("Contact Info");
  lines.push(`Immutable Entities (DO NOT MODIFY): ${immutables.join(", ") || "None"}`);

  // Forbidden behaviors
  const forbidden: string[] = [];
  if (policy.forbidKeywordDumping) forbidden.push("Keyword dumping");
  if (policy.forbidTargetedKeywordsSection) forbidden.push("'Targeted Keywords' section");
  if (policy.forbidFakeSkills) forbidden.push("Fake or hallucinated skills");
  if (policy.forbidSectionReorder) forbidden.push("Reordering sections");
  if (policy.forbidSectionAddRemove) forbidden.push("Adding or removing sections");
  lines.push(`Forbidden: ${forbidden.join(", ") || "None"}`);

  lines.push(`Hallucination Policy: ${policy.hallucinationPolicy}`);
  lines.push(`ATS Strategy: ${policy.atsStrategy}`);
  lines.push(`Character Target: ${policy.minTotalChars}-${policy.maxTotalChars} total`);

  // Formatting
  lines.push(`Formatting: Experience="${policy.formattingRules.experienceHeader}", Education="${policy.formattingRules.educationHeader}"`);

  // Section ownership
  lines.push("Section Ownership (single-agent per section):");
  for (const [section, agent] of Object.entries(policy.sectionOwnership)) {
    lines.push(`  - ${section}: ${agent}`);
  }
  lines.push("=== END SYSTEM POLICY ===");

  return lines.join("\n");
}

// ============================================================================
// POLICY COMPLIANCE CHECKER
// ============================================================================

export interface ComplianceCheck {
  check: string;
  passed: boolean;
  detail?: string;
}

/**
 * Check a resume against the policy and return compliance results.
 * Used by QA and the supervisor to validate agent outputs.
 */
export function checkPolicyCompliance(
  resume: ResumeData,
  sourceResume: ResumeData | null,
  policy: OptimizationPolicy,
): { complianceScore: number; checks: ComplianceCheck[] } {
  const checks: ComplianceCheck[] = [];
  let passedCount = 0;
  let totalChecks = 0;

  // 1. Companies preserved
  totalChecks++;
  if (policy.preserveCompanies && sourceResume) {
    const srcCompanies = sourceResume.experience.map((e) => (e.company || "").toLowerCase().trim()).filter(Boolean);
    const optCompanies = resume.experience.map((e) => (e.company || "").toLowerCase().trim()).filter(Boolean);
    const allPreserved = srcCompanies.every((c) => optCompanies.some((oc) => oc.includes(c) || c.includes(oc)));
    if (allPreserved) {
      checks.push({ check: "companies_preserved", passed: true });
      passedCount++;
    } else {
      checks.push({
        check: "companies_preserved",
        passed: false,
        detail: `Source companies: [${srcCompanies.join(", ")}], Found: [${optCompanies.join(", ")}]`,
      });
    }
  } else {
    checks.push({ check: "companies_preserved", passed: true, detail: "Skipped (not enforced)" });
    passedCount++;
  }

  // 2. Dates preserved
  totalChecks++;
  if (policy.preserveDates && sourceResume) {
    const srcDates = sourceResume.experience.map((e) => `${e.startDate || ""}-${e.endDate || ""}`);
    const optDates = resume.experience.map((e) => `${e.startDate || ""}-${e.endDate || ""}`);
    const allPreserved = srcDates.every((d) => optDates.includes(d));
    if (allPreserved) {
      checks.push({ check: "dates_preserved", passed: true });
      passedCount++;
    } else {
      checks.push({
        check: "dates_preserved",
        passed: false,
        detail: "Experience dates differ between source and optimized",
      });
    }
  } else {
    checks.push({ check: "dates_preserved", passed: true, detail: "Skipped (not enforced)" });
    passedCount++;
  }

  // 3. Education preserved
  totalChecks++;
  if (policy.preserveEducation && sourceResume) {
    const srcEduCount = sourceResume.education.length;
    const optEduCount = resume.education.length;
    if (srcEduCount === optEduCount) {
      checks.push({ check: "education_preserved", passed: true });
      passedCount++;
    } else {
      checks.push({
        check: "education_preserved",
        passed: false,
        detail: `Source had ${srcEduCount} entries, optimized has ${optEduCount}`,
      });
    }
  } else {
    checks.push({ check: "education_preserved", passed: true, detail: "Skipped (not enforced)" });
    passedCount++;
  }

  // 4. Languages preserved
  totalChecks++;
  if (policy.preserveLanguages && sourceResume) {
    const srcLangCount = sourceResume.languages.length;
    const optLangCount = resume.languages.length;
    if (srcLangCount === optLangCount) {
      checks.push({ check: "languages_preserved", passed: true });
      passedCount++;
    } else {
      checks.push({
        check: "languages_preserved",
        passed: false,
        detail: `Source had ${srcLangCount} entries, optimized has ${optLangCount}`,
      });
    }
  } else {
    checks.push({ check: "languages_preserved", passed: true, detail: "Skipped (not enforced)" });
    passedCount++;
  }

  // 5. Summary length
  totalChecks++;
  if (resume.summary) {
    const wordCount = resume.summary.trim().split(/\s+/).length;
    if (wordCount >= policy.summaryMinWords && wordCount <= policy.summaryMaxWords) {
      checks.push({ check: "summary_length", passed: true });
      passedCount++;
    } else {
      checks.push({
        check: "summary_length",
        passed: false,
        detail: `Summary is ${wordCount} words, policy requires ${policy.summaryMinWords}-${policy.summaryMaxWords}`,
      });
    }
  } else {
    checks.push({ check: "summary_length", passed: false, detail: "Summary is empty" });
  }

  // 6. No targeted keywords section
  totalChecks++;
  const hasForbiddenSection = resume.skills.some(
    (s) => (s.name || "").toLowerCase().includes("targeted keyword") || (s.category || "").toLowerCase().includes("targeted keyword"),
  );
  if (!hasForbiddenSection) {
    checks.push({ check: "no_targeted_keywords_section", passed: true });
    passedCount++;
  } else {
    checks.push({ check: "no_targeted_keywords_section", passed: false, detail: "Skills section contains 'Targeted Keywords'" });
  }

  // 7. Experience count preserved
  totalChecks++;
  if (sourceResume) {
    const expCountMatch = resume.experience.length >= sourceResume.experience.length;
    if (expCountMatch) {
      checks.push({ check: "experience_count_preserved", passed: true });
      passedCount++;
    } else {
      checks.push({
        check: "experience_count_preserved",
        passed: false,
        detail: `Source had ${sourceResume.experience.length} experiences, optimized has ${resume.experience.length}`,
      });
    }
  } else {
    checks.push({ check: "experience_count_preserved", passed: true, detail: "Skipped (no source)" });
    passedCount++;
  }

  // 8. Character range
  totalChecks++;
  const charCount = JSON.stringify(resume).length;
  if (charCount >= policy.minTotalChars && charCount <= policy.maxTotalChars) {
    checks.push({ check: "character_range", passed: true });
    passedCount++;
  } else {
    checks.push({
      check: "character_range",
      passed: false,
      detail: `Resume is ${charCount} chars, policy requires ${policy.minTotalChars}-${policy.maxTotalChars}`,
    });
  }

  // 9. Experience strategy enforced (bullet-only)
  totalChecks++;
  if (policy.experienceStrategy === "bullet-only" && sourceResume) {
    // Verify companies and titles match source (not rewritten)
    const srcExpBasic = sourceResume.experience.map((e) => `${e.title}|${e.company}|${e.startDate}|${e.endDate}`);
    const optExpBasic = resume.experience.map((e) => `${e.title}|${e.company}|${e.startDate}|${e.endDate}`);
    const allMatch = srcExpBasic.every((s) => optExpBasic.includes(s));
    if (allMatch) {
      checks.push({ check: "bullet_only_compliance", passed: true });
      passedCount++;
    } else {
      checks.push({
        check: "bullet_only_compliance",
        passed: false,
        detail: "Some experience headers (title/company/dates) differ between source and optimized",
      });
    }
  } else {
    checks.push({ check: "bullet_only_compliance", passed: true, detail: "Skipped (not enforced)" });
    passedCount++;
  }

  // Compute score
  const complianceScore = totalChecks > 0 ? Math.round((passedCount / totalChecks) * 100) : 100;

  return { complianceScore, checks };
}
