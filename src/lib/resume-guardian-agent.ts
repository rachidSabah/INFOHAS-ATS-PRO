// ============================================================================
// Resume Guardian Agent — Final Validator with VETO Authority
//
// The LAST gate before export. Has VETO authority to block export if any
// critical integrity check fails. Sits at the end of the pipeline after
// all optimizations, assembly, and page-balancing are complete.
//
// VETO RULES:
//   - Any critical check fails → status = "BLOCKED", passed = false
//   - Only non-critical checks fail → status = "REQUIRES_MANUAL_REVIEW", passed = true
//   - ALL checks pass → status = "PASS", passed = true
//   - score = percentage of checks passed (critical weighted 2x, non-critical 1x)
// ============================================================================

"use client";

import type { ResumeData } from "./types";
import { extractLockedEntities, verifyEntityIntegrity } from "./entity-lock";
import { runStructureGuardian } from "./structure-guardian";
import { validateLayout } from "./layout-validator";
import type { OptimizationPolicy } from "./directive-policy";
import { checkPolicyCompliance } from "./directive-policy";
import { checkSectionPreservation, extractSectionsFromResume } from "./dynamic-section-engine";

// ============================================================================
// Types
// ============================================================================

export interface GuardianVerdict {
  passed: boolean;
  status: "PASS" | "REQUIRES_MANUAL_REVIEW" | "BLOCKED";
  score: number; // 0-100
  checks: GuardianCheck[];
}

export interface GuardianCheck {
  name: string;
  passed: boolean;
  critical: boolean; // if true, failure means BLOCKED
  detail: string;
}

// ============================================================================
// Check implementations
// ============================================================================

// ── Check 1: Companies Preserved (critical) ────────────────────────────────

function checkCompaniesPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const srcCompanies = source.experience
    .map((e) => (e.company || "").trim())
    .filter(Boolean);
  const optCompanies = optimized.experience
    .map((e) => (e.company || "").trim())
    .filter(Boolean);

  if (srcCompanies.length === 0) {
    return {
      name: "companies_preserved",
      passed: true,
      critical: true,
      detail: "No companies in source to compare — skipping",
    };
  }

  const srcLower = srcCompanies.map((c) => c.toLowerCase());
  const optLower = optCompanies.map((c) => c.toLowerCase());

  const missing = srcLower.filter(
    (sc) => !optLower.some((oc) => oc.includes(sc) || sc.includes(oc)),
  );

  if (missing.length === 0) {
    return {
      name: "companies_preserved",
      passed: true,
      critical: true,
      detail: `All ${srcCompanies.length} source companies preserved`,
    };
  }

  return {
    name: "companies_preserved",
    passed: false,
    critical: true,
    detail: `Missing companies (or renamed): [${missing.join(", ")}]. Source had: [${srcCompanies.join(", ")}]`,
  };
}

// ── Check 2: Dates Preserved (critical) ────────────────────────────────────

function checkDatesPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  if (source.experience.length === 0) {
    return {
      name: "dates_preserved",
      passed: true,
      critical: true,
      detail: "No experience entries in source to compare — skipping",
    };
  }

  const srcDates = source.experience.map(
    (e, i) => `${i}:${e.startDate || ""}-${e.endDate || ""}`,
  );
  const optDates = optimized.experience.map(
    (e, i) => `${i}:${e.startDate || ""}-${e.endDate || ""}`,
  );

  const srcDateSet = new Set(source.experience.map((e) => `${e.startDate || ""}|${e.endDate || ""}`));
  const optDateSet = new Set(optimized.experience.map((e) => `${e.startDate || ""}|${e.endDate || ""}`));

  const allPreserved = Array.from(srcDateSet).every((d) => Array.from(optDateSet).some((od) => od === d));

  if (allPreserved) {
    return {
      name: "dates_preserved",
      passed: true,
      critical: true,
      detail: `All ${source.experience.length} experience date ranges preserved`,
    };
  }

  return {
    name: "dates_preserved",
    passed: false,
    critical: true,
    detail: `Date mismatch. Source dates: [${srcDates.join(", ")}]. Optimized dates: [${optDates.join(", ")}]`,
  };
}

// ── Check 3: Schools/Education Preserved (critical) ────────────────────────

function checkEducationPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const srcEduInstitutions = source.education
    .map((e) => (e.institution || "").trim())
    .filter(Boolean);
  const optEduInstitutions = optimized.education
    .map((e) => (e.institution || "").trim())
    .filter(Boolean);

  if (source.education.length === 0 && optimized.education.length === 0) {
    return {
      name: "schools_preserved",
      passed: true,
      critical: true,
      detail: "No education entries in source or optimized — skipping",
    };
  }

  // Check count match
  if (optimized.education.length < source.education.length) {
    return {
      name: "schools_preserved",
      passed: false,
      critical: true,
      detail: `Education entries dropped: source has ${source.education.length}, optimized has ${optimized.education.length}`,
    };
  }

  // Check institutions match
  const srcInst = srcEduInstitutions.map((s) => s.toLowerCase());
  const optInst = optEduInstitutions.map((s) => s.toLowerCase());

  const missing = srcInst.filter(
    (si) => !optInst.some((oi) => oi.includes(si) || si.includes(oi)),
  );

  if (missing.length > 0) {
    return {
      name: "schools_preserved",
      passed: false,
      critical: true,
      detail: `Missing institutions: [${missing.join(", ")}]. Source: [${srcEduInstitutions.join(", ")}]`,
    };
  }

  return {
    name: "schools_preserved",
    passed: true,
    critical: true,
    detail: `All ${source.education.length} education entries preserved`,
  };
}

// ── Check 4: Languages Preserved (critical) ────────────────────────────────

function checkLanguagesPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  if (source.languages.length === 0 && optimized.languages.length === 0) {
    return {
      name: "languages_preserved",
      passed: true,
      critical: true,
      detail: "No languages in source or optimized — skipping",
    };
  }

  if (optimized.languages.length < source.languages.length) {
    return {
      name: "languages_preserved",
      passed: false,
      critical: true,
      detail: `Languages dropped: source has ${source.languages.length}, optimized has ${optimized.languages.length}`,
    };
  }

  const srcLangNames = source.languages.map((l) => (l.name || "").toLowerCase().trim()).filter(Boolean);
  const optLangNames = optimized.languages.map((l) => (l.name || "").toLowerCase().trim()).filter(Boolean);

  const missing = srcLangNames.filter((sn) => !optLangNames.includes(sn));

  if (missing.length > 0) {
    return {
      name: "languages_preserved",
      passed: false,
      critical: true,
      detail: `Missing languages: [${missing.join(", ")}]`,
    };
  }

  return {
    name: "languages_preserved",
    passed: true,
    critical: true,
    detail: `All ${source.languages.length} languages preserved`,
  };
}

// ── Check 4b: Languages NOT in Skills (critical) ──────────────────────────
// Languages must NEVER be merged into skills. If a language name appears in
// skills, it's a data integrity violation.
function checkLanguagesNotInSkills(optimized: ResumeData, source: ResumeData): GuardianCheck {
  if (source.languages.length === 0) {
    return {
      name: "languages_not_in_skills",
      passed: true,
      critical: true,
      detail: "No languages in source — skipping",
    };
  }

  const langNames = new Set(
    source.languages.map((l) => (l.name || "").toLowerCase().trim()).filter(Boolean),
  );
  if (langNames.size === 0) {
    return {
      name: "languages_not_in_skills",
      passed: true,
      critical: true,
      detail: "No named languages in source — skipping",
    };
  }

  const skillNames = optimized.skills.map((s) => (s.name || "").toLowerCase().trim()).filter(Boolean);
  const leaked = skillNames.filter((sn) => langNames.has(sn));

  if (leaked.length > 0) {
    return {
      name: "languages_not_in_skills",
      passed: false,
      critical: true,
      detail: `Languages found in skills: [${leaked.join(", ")}]. Languages must remain in the Languages section, not skills.`,
    };
  }

  return {
    name: "languages_not_in_skills",
    passed: true,
    critical: true,
    detail: "No language names leaked into skills",
  };
}

// ── Check 5: Skills Preserved (non-critical) ───────────────────────────────

function checkSkillsPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const srcSkills = source.skills.map((s) => (s.name || "").toLowerCase().trim()).filter(Boolean);
  const optSkillNames = optimized.skills.map((s) => (s.name || "").toLowerCase().trim()).filter(Boolean);

  if (srcSkills.length === 0) {
    return {
      name: "skills_preserved",
      passed: true,
      critical: false,
      detail: "No skills in source — skipping",
    };
  }

  // Check source skills still exist
  const missingSkills = srcSkills.filter((ss) => !optSkillNames.includes(ss));
  if (missingSkills.length > 0) {
    return {
      name: "skills_preserved",
      passed: false,
      critical: false,
      detail: `Source skills missing from optimized: [${missingSkills.join(", ")}]`,
    };
  }

  // Check for forbidden keywords in optimized skills (company names, locations, etc.)
  const FORBIDDEN_PATTERNS = [
    /\bqatar\b/i, /\bdubai\b/i, /\babu dhabi\b/i, /\briyadh\b/i,
    /\bkuwait\b/i, /\bbahrain\b/i, /\boman\b/i, /\bmuscat\b/i,
    /\bunknown\b/i, /\bn\/a\b/i, /\bplaceholder\b/i,
    /\bcompany name\b/i, /\byour company\b/i,
    /\bprevious employer\b/i,
  ];

  const forbiddenFound = optSkillNames.filter((skill) =>
    FORBIDDEN_PATTERNS.some((p) => p.test(skill)),
  );

  if (forbiddenFound.length > 0) {
    return {
      name: "skills_preserved",
      passed: false,
      critical: false,
      detail: `Forbidden keywords found in skills: [${forbiddenFound.join(", ")}]`,
    };
  }

  return {
    name: "skills_preserved",
    passed: true,
    critical: false,
    detail: `All ${source.skills.length} source skills preserved, no forbidden keywords`,
  };
}

// ── Check 6: Template Preserved (critical) ─────────────────────────────────

function checkTemplatePreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  if (optimized.template === source.template) {
    return {
      name: "template_preserved",
      passed: true,
      critical: true,
      detail: `Template unchanged: "${source.template}"`,
    };
  }

  return {
    name: "template_preserved",
    passed: false,
    critical: true,
    detail: `Template changed: "${source.template}" → "${optimized.template}"`,
  };
}

// ── Check 7: Layout Preserved (critical) — uses structure-guardian ─────────

function checkLayoutPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const sgResult = runStructureGuardian(optimized, source);

  if (sgResult.criticalIssues.length === 0) {
    return {
      name: "layout_preserved",
      passed: true,
      critical: true,
      detail: `Structure Guardian passed (score: ${sgResult.score}, warnings: ${sgResult.warnings.length})`,
    };
  }

  return {
    name: "layout_preserved",
    passed: false,
    critical: true,
    detail: `Structure Guardian found ${sgResult.criticalIssues.length} critical issue(s): ${sgResult.criticalIssues.join("; ")}`,
  };
}

// ── Check 8: No Hallucinations (critical) — uses entity-lock ───────────────

function checkNoHallucinations(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const locked = extractLockedEntities(source);
  const integrity = verifyEntityIntegrity(optimized, locked);

  if (integrity.passed) {
    return {
      name: "no_hallucinations",
      passed: true,
      critical: true,
      detail: `Entity integrity verified (score: ${integrity.integrityScore}/100, warnings: ${integrity.warnings.length})`,
    };
  }

  const failures = integrity.criticalFailures.map((f) => f.message).join("; ");
  return {
    name: "no_hallucinations",
    passed: false,
    critical: true,
    detail: `Entity integrity failures (${integrity.criticalFailures.length}): ${failures}`,
  };
}

// ── Check 9: No Duplicate Sentences (non-critical) ─────────────────────────

function checkNoDuplicateSentences(optimized: ResumeData, _source: ResumeData): GuardianCheck {
  // Collect all text from the resume
  const textParts: string[] = [];

  if (optimized.summary) textParts.push(optimized.summary);
  for (const exp of optimized.experience) {
    if (exp.bullets) textParts.push(...exp.bullets);
  }
  for (const edu of optimized.education) {
    if (edu.highlights) textParts.push(...edu.highlights);
  }

  const fullText = textParts.join(" ");
  const sentences = fullText
    .split(/[.!?]+\s+/)
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ""))
    .filter((s) => s.split(/\s+/).length >= 4); // only meaningful sentences

  const seen = new Map<string, number>();
  const duplicates: string[] = [];

  for (const sentence of sentences) {
    const normalized = sentence.replace(/\s+/g, " ").trim();
    if (seen.has(normalized)) {
      const count = seen.get(normalized)!;
      if (count === 1) {
        duplicates.push(normalized.slice(0, 80));
      }
      seen.set(normalized, count + 1);
    } else {
      seen.set(normalized, 1);
    }
  }

  if (duplicates.length === 0) {
    return {
      name: "no_duplicate_sentences",
      passed: true,
      critical: false,
      detail: "No duplicate sentences detected",
    };
  }

  return {
    name: "no_duplicate_sentences",
    passed: false,
    critical: false,
    detail: `Found ${duplicates.length} duplicate sentence(s): "${duplicates.slice(0, 3).join('", "')}"`,
  };
}

// ── Check 10: ATS Improvement (non-critical) ────────────────────────────────

function checkAtsImprovement(optimized: ResumeData, source: ResumeData): GuardianCheck {
  // Compute char counts (visible text)
  const getVisibleText = (r: ResumeData): string => {
    const parts: string[] = [];
    parts.push(r.summary || "");
    for (const exp of r.experience) {
      parts.push(...(exp.bullets || []));
    }
    for (const skill of r.skills) {
      parts.push(skill.name || "");
    }
    return parts.join(" ");
  };

  const sourceText = getVisibleText(source);
  const optText = getVisibleText(optimized);

  const sourceChars = sourceText.length;
  const optChars = optText.length;

  // Check if content was meaningfully expanded (keyword addition)
  const charDiff = optChars - sourceChars;

  // Check source skill names are in optimized (keywords enriched)
  const srcSkillNames = source.skills.map((s) => (s.name || "").toLowerCase()).filter(Boolean);
  const optTextLower = optText.toLowerCase();
  const keywordsPresent = srcSkillNames.filter((k) => optTextLower.includes(k)).length;
  const keywordRatio = srcSkillNames.length > 0 ? keywordsPresent / srcSkillNames.length : 1;

  const improved = charDiff > 20 || keywordRatio >= 0.8;

  if (improved) {
    return {
      name: "ats_improvement",
      passed: true,
      critical: false,
      detail: `Optimized content expanded by ${charDiff} chars (${sourceChars} → ${optChars}), keyword retention: ${Math.round(keywordRatio * 100)}%`,
    };
  }

  return {
    name: "ats_improvement",
    passed: false,
    critical: false,
    detail: `Limited ATS improvement: char diff=${charDiff}, keyword retention=${Math.round(keywordRatio * 100)}%`,
  };
}

// ── Check 11: One-Page Validation (non-critical) — uses layout-validator
// Non-critical because page utilization and content length are advisory
// — a resume with shorter content (e.g. minimal mock/test data) should not
// BLOCK the pipeline. Warnings are still surfaced as REQUIRES_MANUAL_REVIEW.

function checkOnePageValidation(optimized: ResumeData): GuardianCheck {
  const layoutResult = validateLayout(optimized);

  if (layoutResult.valid) {
    return {
      name: "one_page_validation",
      passed: true,
      critical: false,
      detail: `Layout valid: ${layoutResult.charCount} chars, ${layoutResult.pageUtilization}% utilization`,
    };
  }

  return {
    name: "one_page_validation",
    passed: false,
    critical: false,
    detail: `Layout issues (${layoutResult.issues.length}): ${layoutResult.issues.join("; ")}`,
  };
}

// ── Check 12: Directive Compliance (critical) — uses directive-policy ──────

function checkDirectiveCompliance(
  optimized: ResumeData,
  source: ResumeData,
  policy?: OptimizationPolicy,
): GuardianCheck {
  if (!policy) {
    return {
      name: "directive_compliance",
      passed: true,
      critical: true,
      detail: "No policy provided — skipping directive compliance check",
    };
  }

  const { complianceScore, checks } = checkPolicyCompliance(optimized, source, policy);

  if (complianceScore >= 90) {
    return {
      name: "directive_compliance",
      passed: true,
      critical: true,
      detail: `Policy compliance score: ${complianceScore}/100 (threshold: 90)`,
    };
  }

  const failingChecks = checks.filter((c) => !c.passed).map((c) => c.check);
  return {
    name: "directive_compliance",
    passed: false,
    critical: true,
    detail: `Policy compliance score: ${complianceScore}/100 (below 90 threshold). Failing checks: [${failingChecks.join(", ")}]`,
  };
}

// ── Check 13: Bullet Count Preservation (critical) ──────────────────────────

/**
 * Verifies that EVERY experience entry has the EXACT SAME number of bullets
 * as the corresponding entry in the source resume. This prevents the LLM
 * from dropping, merging, or truncating bullet points during optimization.
 */
function checkBulletsPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const failures: string[] = [];

  for (const optExp of optimized.experience) {
    const srcExp = source.experience.find(
      (s) =>
        s.company?.toLowerCase() === optExp.company?.toLowerCase() ||
        s.title?.toLowerCase() === optExp.title?.toLowerCase()
    );
    if (!srcExp) continue; // Check 1 already catches new/removed entries

    const srcBullets = srcExp.bullets || [];
    const optBullets = optExp.bullets || [];
    const srcCount = srcBullets.length;
    const optCount = optBullets.length;

    if (optCount < srcCount) {
      failures.push(
        `"${optExp.title} @ ${optExp.company}": ${srcCount} bullets → ${optCount} (${srcCount - optCount} missing)`
      );
    } else if (optCount > srcCount) {
      // More bullets than source is suspicious (hallucination)
      failures.push(
        `"${optExp.title} @ ${optExp.company}": ${srcCount} bullets → ${optCount} (${optCount - srcCount} extra — potential hallucination)`
      );
    }
  }

  if (failures.length === 0) {
    return {
      name: "bullets_preserved",
      passed: true,
      critical: true,
      detail: "All experience entries have the exact same number of bullets as the source",
    };
  }

  return {
    name: "bullets_preserved",
    passed: false,
    critical: true,
    detail: `Bullet count mismatch: ${failures.join("; ")}`,
  };
}

/**
 * Verifies that EVERY education entry has the EXACT SAME number of highlights
 * as the corresponding entry in the source resume. This prevents the LLM
 * from dropping or truncating education achievements during optimization.
 */
function checkEducationHighlightsPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  if (source.education.length === 0) {
    return {
      name: "education_highlights_preserved",
      passed: true,
      critical: true,
      detail: "No source education entries to check",
    };
  }

  const failures: string[] = [];

  for (const srcEdu of source.education) {
    const optEdu = optimized.education.find(
      (o) =>
        o.institution?.toLowerCase() === srcEdu.institution?.toLowerCase() ||
        o.id === srcEdu.id
    );
    if (!optEdu) continue; // Count check already catches removed entries

    const srcHL = srcEdu.highlights || [];
    const optHL = optEdu.highlights || [];
    const srcCount = srcHL.length;
    const optCount = optHL.length;

    if (srcCount > 0 && optCount < srcCount) {
      failures.push(
        `"${srcEdu.degree} @ ${srcEdu.institution}": ${srcCount} highlights → ${optCount} (${srcCount - optCount} missing)`
      );
    } else if (srcCount > 0 && optCount > srcCount) {
      failures.push(
        `"${srcEdu.degree} @ ${srcEdu.institution}": ${srcCount} highlights → ${optCount} (${optCount - srcCount} extra — potential hallucination)`
      );
    }
  }

  if (failures.length === 0) {
    return {
      name: "education_highlights_preserved",
      passed: true,
      critical: true,
      detail: "All education entries have the exact same number of highlights as the source",
    };
  }

  return {
    name: "education_highlights_preserved",
    passed: false,
    critical: true,
    detail: `Education highlight count mismatch: ${failures.join("; ")}`,
  };
}

// ── Check 14: Skill Categories Preserved (critical) ──────────────────────────

/**
 * Verifies that ALL skill categories from the source resume are present in the
 * optimized output. This prevents the LLM from dropping entire competency
 * categories during skills optimization.
 */
function checkSkillCategoriesPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  if (source.skills.length === 0) {
    return {
      name: "skill_categories_preserved",
      passed: true,
      critical: true,
      detail: "No source skill categories to check",
    };
  }

  // Extract source categories (handle both .category field and skills with no category)
  const srcCategories = new Set<string>();
  for (const s of source.skills) {
    if (s.category?.trim()) {
      srcCategories.add(s.category.trim().toLowerCase());
    }
  }

  // If source has no categories, skip this check
  if (srcCategories.size === 0) {
    return {
      name: "skill_categories_preserved",
      passed: true,
      critical: true,
      detail: "Source skills have no categories — skipping category check",
    };
  }

  // Extract optimized categories
  const optCategories = new Set<string>();
  for (const s of optimized.skills) {
    if (s.category?.trim()) {
      optCategories.add(s.category.trim().toLowerCase());
    }
  }

  const missing: string[] = [];
  Array.from(srcCategories).forEach((srcCat) => {
    if (!optCategories.has(srcCat)) {
      missing.push(srcCat);
    }
  });

  if (missing.length === 0) {
    return {
      name: "skill_categories_preserved",
      passed: true,
      critical: true,
      detail: `All ${srcCategories.size} source skill categories preserved in optimized output`,
    };
  }

  return {
    name: "skill_categories_preserved",
    passed: false,
    critical: true,
    detail: `Missing ${missing.length}/${srcCategories.size} skill categories: "${missing.join('", "')}"`,
  };
}

// ── Check 15: Personal Details Preserved (critical) ──────────────────────────

/**
 * Verifies that personal details from the source resume (date of birth,
 * location, etc.) are preserved in the optimized output. Prevents the LLM
 * from silently dropping contact/personal information.
 */
function checkPersonalDetailsPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const failures: string[] = [];

  // Check date of birth
  const srcDob = (source as any).dateOfBirth;
  if (srcDob && typeof srcDob === "string" && srcDob.trim()) {
    const optDob = (optimized as any).dateOfBirth;
    if (!optDob || !optDob.toString().trim()) {
      failures.push(`dateOfBirth ("${srcDob.trim()}") missing from output`);
    }
  }

  // Check location (stored in contact.location)
  const srcLoc = source.contact?.location || (source as any).city;
  if (srcLoc && typeof srcLoc === "string" && srcLoc.trim()) {
    const optLoc = optimized.contact?.location || (optimized as any).city;
    if (!optLoc || !optLoc.toString().trim()) {
      failures.push(`location ("${srcLoc.trim()}") missing from output`);
    }
  }

  if (failures.length === 0) {
    return {
      name: "personal_details_preserved",
      passed: true,
      critical: true,
      detail: "All source personal details (DOB, location) preserved in output",
    };
  }

  return {
    name: "personal_details_preserved",
    passed: false,
    critical: true,
    detail: `Missing personal details: ${failures.join("; ")}`,
  };
}

// ── Check 16: Education Structure Clean (critical) ──────────────────────────

/**
 * Ensures education entries don't contain skill-section keywords that would
 * corrupt DOCX rendering (e.g., "High School Degree | KEY COMPETENCIES").
 * Also verifies education highlights don't contain skill-category text.
 */
function checkEducationStructureClean(optimized: ResumeData): GuardianCheck {
  const education = optimized.education || [];
  const SKILL_KEYWORDS = [
    "key competencies", "core competencies", "professional skills", "technical skills",
    "soft skills", "skills &", "skills and", "areas of expertise", "areas of strength",
    "professional summary", "professional profile", "career overview", "qualifications"
  ];
  const issues: string[] = [];
  for (let i = 0; i < education.length; i++) {
    const ed = education[i];
    if (ed.degree) {
      const lower = ed.degree.toLowerCase();
      for (const kw of SKILL_KEYWORDS) {
        if (lower.includes(kw)) {
          issues.push(`Education[${i}] degree contains skill keyword "${kw}": "${ed.degree}"`);
          break;
        }
      }
      const pipeIdx = ed.degree.indexOf("|");
      if (pipeIdx >= 0) {
        const afterPipe = ed.degree.substring(pipeIdx + 1).trim().toLowerCase();
        if (SKILL_KEYWORDS.some(kw => afterPipe.includes(kw))) {
          issues.push(`Education[${i}] degree has pipe-delineated skill section header`);
        }
      }
    }
    if (ed.highlights) {
      for (let j = 0; j < ed.highlights.length; j++) {
        const h = ed.highlights[j];
        const lowerH = h.toLowerCase().trim();
        if (SKILL_KEYWORDS.includes(lowerH)) {
          issues.push(`Education[${i}] highlight[${j}] is a skill section header: "${h}"`);
        } else if (h.length < 50 && /^(guest service|professional presence|operational efficiency|teamwork|communication|customer service|leadership|management|technical|analytical|interpersonal)/i.test(h) && !h.includes(":")) {
          issues.push(`Education[${i}] highlight[${j}] looks like a skill category: "${h}"`);
        }
      }
    }
    // NEW: Check institution for contamination (e.g., parser sets institution="KEY COMPETENCIES")
    if (ed.institution) {
      const lowerInst = ed.institution.toLowerCase().trim();
      if (SKILL_KEYWORDS.includes(lowerInst)) {
        issues.push(`Education[${i}] institution is a section header: "${ed.institution}"`);
      } else {
        for (const kw of SKILL_KEYWORDS) {
          if (lowerInst.includes(kw)) {
            issues.push(`Education[${i}] institution contains skill keyword "${kw}": "${ed.institution}"`);
            break;
          }
        }
      }
    }
  }
  return {
    name: "Education Structure",
    detail: issues.length > 0
      ? `Education structure corruption detected: ${issues.join("; ")}`
      : "All education entries have clean structure",
    passed: issues.length === 0,
    critical: true,
  };
}

// ── Check 17: No Hallucinated Proficiency Levels (critical) ──────────────────

/**
 * Detects when the LLM adds proficiency levels (e.g., "(fluent)", "(expert)",
 * "(native)") to language entries when they were NOT present in the source.
 * This is a common hallucination pattern where the LLM "improves" the resume
 * by inventing proficiency claims.
 */
function checkNoProficiencyHallucination(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const srcLanguages = source.languages || [];
  const optLanguages = optimized.languages || [];

  // Build source text for each language (lowercase, whitespace-normalized)
  const srcLangTexts = srcLanguages.map((l) => {
    const name = l.name.toLowerCase().trim();
    const proficiency = l.proficiency?.toLowerCase().trim() || "";
    return { name, proficiency };
  });

  const optLangTexts = optLanguages.map((l) => {
    // The optimized output might embed proficiency in the language name string
    const nameRaw = l.name.toLowerCase().trim();
    const proficiency = l.proficiency?.toLowerCase().trim() || "";
    return { raw: nameRaw, proficiency };
  });

  const knownLevels = ["fluent", "native", "expert", "advanced", "intermediate", "beginner", "bilingual", "c2", "c1", "b2", "b1", "a2", "a1"];
  const addedProficiencies: string[] = [];

  for (const opt of optLangTexts) {
    // Check if the language name itself contains a proficiency level (e.g., "English (fluent)")
    const embeddedLevel = knownLevels.find((lvl) => opt.raw.includes(`(${lvl})`));
    // Check the proficiency field
    const fieldLevel = opt.proficiency && knownLevels.includes(opt.proficiency) ? opt.proficiency : null;

    if (embeddedLevel || fieldLevel) {
      // Find the matching source language
      const baseName = embeddedLevel
        ? opt.raw.replace(/\([^)]+\)/g, "").trim()
        : opt.raw;
      const srcMatch = srcLangTexts.find(
        (s) => s.name === baseName || s.name.includes(baseName) || baseName.includes(s.name)
      );

      if (srcMatch && !srcMatch.proficiency) {
        // Source had no proficiency but output has one — hallucination
        addedProficiencies.push(`${opt.raw} → added "${embeddedLevel || fieldLevel}" (not in source)`);
      } else if (!srcMatch) {
        // New language — could be hallucination but check 4 (languages_preserved) handles this
      }
    }
  }

  if (addedProficiencies.length === 0) {
    return {
      name: "no_proficiency_hallucination",
      passed: true,
      critical: true,
      detail: "No hallucinated proficiency levels detected in language entries",
    };
  }

  return {
    name: "no_proficiency_hallucination",
    passed: false,
    critical: true,
    detail: `Added proficiency levels not in source: ${addedProficiencies.join("; ")}`,
  };
}

// ============================================================================
// Main Validation Runner
// ============================================================================

// ── Check N: Dynamic Section Preservation (critical) ─────────────────────

/**
 * Verifies that ALL sections from the original resume are present in the
 * optimized output. Uses fingerprint-based matching.
 *
 * This is the final guarantee against section loss.
 */
function checkDynamicSectionsPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const sourceSections = extractSectionsFromResume(source);
  const optimizedSections = extractSectionsFromResume(optimized);

  if (sourceSections.length === 0) {
    return {
      name: "dynamic_sections_preserved",
      passed: true,
      critical: true,
      detail: "No sections in source to compare — skipping",
    };
  }

  const preservation = checkSectionPreservation(sourceSections, optimized);

  if (preservation.missing.length === 0) {
    return {
      name: "dynamic_sections_preserved",
      passed: true,
      critical: true,
      detail: `All ${sourceSections.length} sections preserved: [${preservation.preservedSections.join(", ")}]`,
    };
  }

  return {
    name: "dynamic_sections_preserved",
    passed: false,
    critical: true,
    detail: `Missing ${preservation.missing.length}/${sourceSections.length} sections: [${preservation.missing.map((s) => s.title).join(", ")}]. Source had: [${sourceSections.map((s) => s.title).join(", ")}]`,
  };
}

// ── Check 17: Job Titles Preserved (critical) ────────────────────────────

/**
 * Verifies that EVERY experience entry has the EXACT SAME job title as the
 * corresponding entry in the source resume. Prevents the LLM from silently
 * changing job titles during optimization.
 */
function checkJobTitlesPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const failures: string[] = [];

  for (const srcExp of source.experience) {
    const optExp = optimized.experience.find(
      (o) =>
        o.company?.toLowerCase() === srcExp.company?.toLowerCase() ||
        o.id === srcExp.id
    );
    if (!optExp) continue; // Already caught by checkCompaniesPreserved

    const srcTitle = (srcExp.title || "").trim().toLowerCase();
    const optTitle = (optExp.title || "").trim().toLowerCase();

    if (srcTitle && optTitle && srcTitle !== optTitle) {
      failures.push(
        `"${srcExp.title}" → "${optExp.title}" at ${srcExp.company || "(unknown)"}`
      );
    }
  }

  if (failures.length === 0) {
    return {
      name: "job_titles_preserved",
      passed: true,
      critical: true,
      detail: `All ${source.experience.length} experience job titles match source`,
    };
  }

  return {
    name: "job_titles_preserved",
    passed: false,
    critical: true,
    detail: `Job title changes detected (${failures.length}): ${failures.join("; ")}`,
  };
}

// ── Check 18: Contact Info Preserved (critical) ─────────────────────────

/**
 * Verifies that ALL contact fields from the source resume are preserved
 * in the optimized output. This prevents silent corruption or dropping of
 * email, phone, location, website, linkedin, and github fields.
 */
function checkContactInfoPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const contactFields: Array<{ key: string; get: (c: any) => string | undefined }> = [
    { key: "email", get: (c) => c.email },
    { key: "phone", get: (c) => c.phone },
    { key: "location", get: (c) => c.location || c.city },
    { key: "website", get: (c) => c.website },
    { key: "linkedin", get: (c) => c.linkedin },
    { key: "github", get: (c) => c.github },
  ];

  const missing: string[] = [];

  for (const field of contactFields) {
    const srcVal = field.get(source.contact);
    if (srcVal && typeof srcVal === "string" && srcVal.trim()) {
      const optVal = field.get(optimized.contact);
      if (!optVal || !optVal.toString().trim()) {
        missing.push(field.key);
      }
    }
  }

  if (missing.length === 0) {
    return {
      name: "contact_info_preserved",
      passed: true,
      critical: true,
      detail: "All source contact fields preserved in output",
    };
  }

  return {
    name: "contact_info_preserved",
    passed: false,
    critical: true,
    detail: `Missing contact fields: [${missing.join(", ")}]`,
  };
}

// ── Check 19: Certifications Preserved (critical) ────────────────────────

/**
 * Verifies that ALL certifications from the source resume are preserved
 * in the optimized output. Prevents the LLM from dropping certifications.
 */
function checkCertificationsPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const srcCerts = (source.certifications || []).map((c: any) => (c.name || "").toLowerCase().trim()).filter(Boolean);
  const optCerts = (optimized.certifications || []).map((c: any) => (c.name || "").toLowerCase().trim()).filter(Boolean);

  if (srcCerts.length === 0 && optCerts.length === 0) {
    return {
      name: "certifications_preserved",
      passed: true,
      critical: true,
      detail: "No certifications in source or optimized — skipping",
    };
  }

  if (optimized.certifications.length < source.certifications.length) {
    return {
      name: "certifications_preserved",
      passed: false,
      critical: true,
      detail: `Certifications dropped: source has ${source.certifications.length}, optimized has ${optimized.certifications.length}`,
    };
  }

  const missing = srcCerts.filter((sn: string) => !optCerts.includes(sn));

  if (missing.length > 0) {
    return {
      name: "certifications_preserved",
      passed: false,
      critical: true,
      detail: `Missing certifications: [${missing.join(", ")}]`,
    };
  }

  return {
    name: "certifications_preserved",
    passed: true,
    critical: true,
    detail: `All ${source.certifications.length} certifications preserved`,
  };
}

// ── Check 20: Additional Info Preserved (critical) ──────────────────────

/**
 * Verifies that the additionalInfo field from the source resume is preserved
 * in the optimized output.
 */
function checkAdditionalInfoPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const srcInfo = (source as any).additionalInfo;
  if (!srcInfo || typeof srcInfo !== "string" || !srcInfo.trim()) {
    return {
      name: "additional_info_preserved",
      passed: true,
      critical: true,
      detail: "No additionalInfo in source — skipping",
    };
  }

  const optInfo = (optimized as any).additionalInfo;
  if (!optInfo || !optInfo.toString().trim()) {
    return {
      name: "additional_info_preserved",
      passed: false,
      critical: true,
      detail: `additionalInfo ("${srcInfo.trim().slice(0, 80)}…") missing from output`,
    };
  }

  return {
    name: "additional_info_preserved",
    passed: true,
    critical: true,
    detail: "additionalInfo preserved in output",
  };
}

// ── Check 21: Section Order Preserved (critical) ─────────────────────────

/**
 * Verifies that the order of sections in the optimized resume matches the
 * source resume. Uses the dynamicSections' order field plus the standard
 * sections to determine section ordering.
 */
function checkSectionOrderPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  // Build ordered list of section names from source
  const getSectionNames = (r: ResumeData): string[] => {
    const names: string[] = [];
    // Use dynamicSections order if available
    const dynSections = (r as any).dynamicSections || [];
    if (dynSections.length > 0) {
      const sorted = [...dynSections].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
      for (const s of sorted) {
        names.push(s.normalizedTitle || s.title?.toLowerCase() || "");
      }
    }
    // Include standard sections by their natural order
    if (r.summary) names.push("summary");
    if (r.experience?.length) names.push("experience");
    if (r.education?.length) names.push("education");
    if (r.skills?.length) names.push("skills");
    if (r.languages?.length) names.push("languages");
    if (r.certifications?.length) names.push("certifications");
    if (r.projects?.length) names.push("projects");
    return names;
  };

  const srcSections = getSectionNames(source);
  const optSections = getSectionNames(optimized);

  if (srcSections.length === 0) {
    return {
      name: "section_order_preserved",
      passed: true,
      critical: true,
      detail: "No sections to compare — skipping",
    };
  }

  // Compare section count first
  if (optSections.length < srcSections.length) {
    const missing = srcSections.filter((s) => !optSections.includes(s));
    return {
      name: "section_order_preserved",
      passed: false,
      critical: true,
      detail: `Sections dropped: source had ${srcSections.length}, optimized has ${optSections.length}. Missing: [${missing.join(", ")}]`,
    };
  }

  // Check order is preserved
  const orderIssues: string[] = [];
  let srcIdx = 0;
  for (const optSec of optSections) {
    const foundIdx = srcSections.indexOf(optSec, srcIdx);
    if (foundIdx === -1) {
      // Section wasn't in source at all — could be hallucination
      orderIssues.push(`unexpected section "${optSec}"`);
    } else if (foundIdx < srcIdx) {
      orderIssues.push(`section "${optSec}" reordered (was after "${srcSections[srcIdx - 1]}", now before)`);
    } else {
      srcIdx = foundIdx + 1;
    }
  }

  if (orderIssues.length === 0) {
    return {
      name: "section_order_preserved",
      passed: true,
      critical: true,
      detail: `Section order preserved (${srcSections.length} sections)`,
    };
  }

  return {
    name: "section_order_preserved",
    passed: false,
    critical: true,
    detail: `Section order issues: ${orderIssues.join("; ")}`,
  };
}

/**
 * Run ALL guardian checks and produce a GuardianVerdict with VETO enforcement.
 *
 * @param optimized - The final optimized/assembled resume
 * @param source    - The original source resume (before optimization)
 * @param policy    - Optional OptimizationPolicy for directive compliance check
 * @returns GuardianVerdict with VETO-enforced status
 */
export async function runGuardianValidation(
  optimized: ResumeData,
  source: ResumeData,
  policy?: OptimizationPolicy,
): Promise<GuardianVerdict> {
  const checks: GuardianCheck[] = [];

  // Run all 21 checks
  checks.push(checkCompaniesPreserved(optimized, source));
  checks.push(checkDatesPreserved(optimized, source));
  checks.push(checkEducationPreserved(optimized, source));
  checks.push(checkLanguagesPreserved(optimized, source));
  checks.push(checkLanguagesNotInSkills(optimized, source));
  checks.push(checkSkillsPreserved(optimized, source));
  checks.push(checkTemplatePreserved(optimized, source));
  checks.push(checkLayoutPreserved(optimized, source));
  checks.push(checkNoHallucinations(optimized, source));
  checks.push(checkNoDuplicateSentences(optimized, source));
  checks.push(checkBulletsPreserved(optimized, source));
  checks.push(checkEducationHighlightsPreserved(optimized, source));
  checks.push(checkSkillCategoriesPreserved(optimized, source));
  checks.push(checkPersonalDetailsPreserved(optimized, source));
  checks.push(checkNoProficiencyHallucination(optimized, source));
  checks.push(checkEducationStructureClean(optimized));
  checks.push(checkAtsImprovement(optimized, source));
  checks.push(checkOnePageValidation(optimized));
  checks.push(checkDirectiveCompliance(optimized, source, policy));
  // New checks for comprehensive immutable field preservation
  checks.push(checkJobTitlesPreserved(optimized, source));
  checks.push(checkContactInfoPreserved(optimized, source));
  checks.push(checkCertificationsPreserved(optimized, source));
  checks.push(checkAdditionalInfoPreserved(optimized, source));
  checks.push(checkSectionOrderPreserved(optimized, source));
  // Dynamic sections preservation check — if dynamic sections exist in source,
  // verify they are preserved in optimized
  const sourceDynSections = (source as any).dynamicSections || [];
  const optDynSections = (optimized as any).dynamicSections || [];
  if (sourceDynSections.length > 0) {
    checks.push({
      name: "dynamic_sections_preserved",
      passed: optDynSections.length >= sourceDynSections.length,
      critical: true,
      detail: `Source had ${sourceDynSections.length} dynamic sections, optimized has ${optDynSections.length}`,
    });
  }

  // Check N: Dynamic Section Preservation
  checks.push(checkDynamicSectionsPreserved(optimized, source));

  // Compute score (weighted: critical 2x, non-critical 1x)
  let weightedPassed = 0;
  let weightedTotal = 0;

  for (const check of checks) {
    const weight = check.critical ? 2 : 1;
    weightedTotal += weight;
    if (check.passed) {
      weightedPassed += weight;
    }
  }

  const score = weightedTotal > 0
    ? Math.round((weightedPassed / weightedTotal) * 100)
    : 100;

  // Determine VETO status
  const criticalFailures = checks.filter((c) => c.critical && !c.passed);
  const nonCriticalFailures = checks.filter((c) => !c.critical && !c.passed);

  let status: GuardianVerdict["status"];
  let passed: boolean;

  if (criticalFailures.length > 0) {
    // VETO triggered — any critical failure blocks export
    status = "BLOCKED";
    passed = false;
  } else if (nonCriticalFailures.length > 0) {
    // Only non-critical failures — requires manual review but doesn't block
    status = "REQUIRES_MANUAL_REVIEW";
    passed = true;
  } else {
    // All checks pass
    status = "PASS";
    passed = true;
  }

  const verdict: GuardianVerdict = { passed, status, score, checks };

  // Log summary
  const logFn = status === "PASS" ? console.info
    : status === "REQUIRES_MANUAL_REVIEW" ? console.warn
    : console.error;

  logFn(
    `[Guardian Agent] ${status} — score: ${score}/100, ` +
    `checks: ${checks.filter((c) => c.passed).length}/${checks.length} passed, ` +
    `critical failures: ${criticalFailures.length}, non-critical failures: ${nonCriticalFailures.length}`,
  );

  if (criticalFailures.length > 0) {
    console.error(
      "[Guardian Agent] VETO TRIGGERED — blocking export due to critical failures:",
      criticalFailures.map((c) => `  [${c.name}] ${c.detail}`).join("\n"),
    );
  }

  return verdict;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a GuardianVerdict as a human-readable string for debug logging.
 */
export function formatGuardianVerdict(v: GuardianVerdict): string {
  const lines: string[] = [];
  const divider = "─".repeat(60);

  lines.push(divider);
  lines.push("  GUARDIAN VERDICT");
  lines.push(divider);
  lines.push(`  Status: ${v.status}  |  Score: ${v.score}/100  |  Passed: ${v.passed ? "✓" : "✗"}`);
  lines.push(divider);

  // Group by critical/non-critical
  const criticalChecks = v.checks.filter((c) => c.critical);
  const nonCriticalChecks = v.checks.filter((c) => !c.critical);

  if (criticalChecks.length > 0) {
    lines.push("  CRITICAL CHECKS:");
    for (const check of criticalChecks) {
      const icon = check.passed ? "✓" : "✗";
      lines.push(`    ${icon} ${check.name}`);
      if (!check.passed || check.detail) {
        lines.push(`        ${check.detail}`);
      }
    }
  }

  if (nonCriticalChecks.length > 0) {
    lines.push("  NON-CRITICAL CHECKS:");
    for (const check of nonCriticalChecks) {
      const icon = check.passed ? "✓" : "✗";
      lines.push(`    ${icon} ${check.name}`);
      if (!check.passed || check.detail) {
        lines.push(`        ${check.detail}`);
      }
    }
  }

  lines.push(divider);

  if (v.status === "BLOCKED") {
    lines.push("  🚫 VETO: Export blocked. Fix critical failures before retrying.");
  } else if (v.status === "REQUIRES_MANUAL_REVIEW") {
    lines.push("  ⚠️  EXPORTABLE with warnings. Manual review recommended.");
  } else {
    lines.push("  ✅ All checks passed. Ready for export.");
  }

  lines.push(divider);

  return lines.join("\n");
}

// ============================================================================
// Export Gate — Guardian Check Before Export
// ============================================================================

/**
 * Error thrown when a resume fails Guardian checks and cannot be exported.
 * Contains the list of critical failures for user-friendly error messages.
 */
export class ExportGateError extends Error {
  constructor(
    message: string,
    public readonly criticalFailures: string[],
    public readonly verdict: GuardianVerdict,
  ) {
    super(message);
    this.name = "ExportGateError";
  }
}

/**
 * Synchronous quick check — runs the IMMUTABLE FIELD checks only (no LLM calls).
 *
 * This is the EXPORT GATE. Called before every DOCX/PDF/TXT export to ensure
 * the resume being exported hasn't been corrupted.
 *
 * When `source` is provided, runs the full comparison between source and resume.
 * When `source` is omitted, runs self-consistency checks only (verifies no
 * empty companies, missing education, etc.).
 *
 * Throws ExportGateError if ANY critical check fails.
 * Returns the verdict if all critical checks pass.
 */
export function assertResumeExportable(
  resume: ResumeData,
  source?: ResumeData,
): GuardianVerdict {
  // When source is available, run the full Guardian comparison
  if (source) {
    return assertResumeExportableWithSource(resume, source);
  }
  // Without source, run self-consistency checks only
  return assertResumeSelfConsistent(resume);
}

/**
 * Full export gating with source comparison — requires the source resume.
 */
function assertResumeExportableWithSource(
  resume: ResumeData,
  source: ResumeData,
): GuardianVerdict {
  // Run only deterministic (synchronous) checks for export gating.
  // We skip: checkAtsImprovement, checkOnePageValidation (advisory only),
  // checkDirectiveCompliance (policy-specific).
  const checks: GuardianCheck[] = [
    checkCompaniesPreserved(resume, source),
    checkDatesPreserved(resume, source),
    checkEducationPreserved(resume, source),
    checkLanguagesPreserved(resume, source),
    checkLanguagesNotInSkills(resume, source),
    checkSkillsPreserved(resume, source),
    checkTemplatePreserved(resume, source),
    checkNoHallucinations(resume, source),
    checkNoDuplicateSentences(resume, source),
    checkBulletsPreserved(resume, source),
    checkEducationHighlightsPreserved(resume, source),
    checkSkillCategoriesPreserved(resume, source),
    checkPersonalDetailsPreserved(resume, source),
    checkJobTitlesPreserved(resume, source),
    checkContactInfoPreserved(resume, source),
    checkCertificationsPreserved(resume, source),
    checkAdditionalInfoPreserved(resume, source),
    checkSectionOrderPreserved(resume, source),
  ];

  const criticalFailures = checks.filter((c) => c.critical && !c.passed);

  if (criticalFailures.length > 0) {
    const messages = criticalFailures.map((c) => `[${c.name}] ${c.detail}`);
    const verdict: GuardianVerdict = {
      passed: false,
      status: "BLOCKED",
      score: 0,
      checks,
    };
    throw new ExportGateError(
      `Cannot export: Resume failed ${criticalFailures.length} critical integrity check(s). ` +
      `Fix these issues or re-optimize from the original source.`,
      messages,
      verdict,
    );
  }

  const nonCriticalFailures = checks.filter((c) => !c.critical && !c.passed);
  const totalChecks = checks.length;
  const passedCount = checks.filter((c) => c.passed).length;
  const score = Math.round((passedCount / totalChecks) * 100);

  return {
    passed: nonCriticalFailures.length === 0,
    status: nonCriticalFailures.length > 0 ? "REQUIRES_MANUAL_REVIEW" : "PASS",
    score,
    checks,
  };
}

/**
 * Self-consistency check — verifies all required fields are populated
 * without needing a source resume to compare against.
 *
 * Catches: empty companies, missing education, missing languages,
 * missing contact info, empty skills.
 */
function assertResumeSelfConsistent(resume: ResumeData): GuardianVerdict {
  const issues: string[] = [];

  // Check experience entries for empty companies/titles
  for (const exp of resume.experience) {
    if (!exp.company || exp.company.trim() === "") {
      issues.push(`Experience entry has empty company name`);
    }
    if (!exp.title || exp.title.trim() === "") {
      issues.push(`Experience entry has empty job title`);
    }
  }

  // Check education exists and has content
  if (!resume.education || resume.education.length === 0) {
    issues.push(`Education section is missing`);
  } else {
    for (const edu of resume.education) {
      if (!edu.institution || edu.institution.trim() === "") {
        issues.push(`Education entry has empty institution`);
      }
    }
  }

  // Check languages exist
  if (!resume.languages || resume.languages.length === 0) {
    issues.push(`Languages section is missing`);
  }

  // Check contact info
  if (!resume.contact.email && !resume.contact.phone) {
    issues.push(`Both email and phone are missing`);
  }

  // Check skills exist
  if (!resume.skills || resume.skills.length === 0) {
    issues.push(`Skills section is empty`);
  }

  // Check certifications exist
  if (!resume.certifications || resume.certifications.length === 0) {
    issues.push(`Certifications section is missing`);
  }

  if (issues.length > 0) {
    throw new ExportGateError(
      `Cannot export: Resume has ${issues.length} integrity issue(s). ` +
      `Run optimization or fill in missing fields before exporting. ` +
      issues.join("; "),
      issues,
      {
        passed: false,
        status: "BLOCKED",
        score: Math.max(0, 100 - issues.length * 20),
        checks: issues.map((i) => ({
          name: "self_consistency",
          passed: false,
          critical: true,
          detail: i,
        })),
      },
    );
  }

  return {
    passed: true,
    status: "PASS",
    score: 100,
    checks: [],
  };
}
