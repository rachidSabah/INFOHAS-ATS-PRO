// ============================================================================
// Directive Compliance Service
//
// Validates optimization outputs against directive parameters.
// Computes compliance score, generates corrective feedback, and tracks
// directive version/hash for provenance.
// ============================================================================

import type { OptimizerDirectiveConfig, ResumeData } from "./types";

export interface ComplianceResult {
  score: number;           // 0-100
  passed: boolean;         // score >= threshold
  checks: ComplianceCheck[];
  directiveVersion: string;
  directiveHash: string;
  feedback: string[];      // corrective instructions for retry
}

export interface ComplianceCheck {
  name: string;
  passed: boolean;
  actual: string;
  expected: string;
  deduct: number;          // points deducted if failed
}

/** Compute a simple hash of the directive for version tracking */
function hashDirective(config: OptimizerDirectiveConfig): string {
  const key = JSON.stringify({
    pageSize: config.pageSize,
    summaryMinWords: config.summaryMinWords,
    summaryMaxWords: config.summaryMaxWords,
    skillsMaxGroups: config.skillsMaxGroups,
    experienceMaxEntries: config.experienceMaxEntries,
    experienceBulletsPerEntry: config.experienceBulletsPerEntry,
    educationMaxEntries: config.educationMaxEntries,
    languagesMaxEntries: config.languagesMaxEntries,
    enforceOnePage: config.enforceOnePage,
    fontFamily: config.fontFamily,
    bodyFontSizePt: config.bodyFontSizePt,
  });
  // Simple DJB2 hash
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) + key.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export function verifyDirectiveCompliance(
  original: ResumeData,
  optimized: ResumeData,
  config: OptimizerDirectiveConfig,
  options: { minScore?: number } = {}
): ComplianceResult {
  const checks: ComplianceCheck[] = [];
  const feedback: string[] = [];
  const minScore = options.minScore ?? config.agentDirectives?.guardian?.minimumScore ?? 80;
  let maxScore = 0;

  // 1. Summary word count check
  maxScore += 20;
  const summaryWords = (optimized.summary || "").split(/\s+/).filter(Boolean).length;
  const inRange = summaryWords >= config.summaryMinWords && summaryWords <= config.summaryMaxWords;
  checks.push({
    name: "summary_word_count",
    passed: inRange,
    actual: String(summaryWords) + " words",
    expected: config.summaryMinWords + "-" + config.summaryMaxWords + " words",
    deduct: inRange ? 0 : 20,
  });
  if (!inRange) {
    feedback.push("Summary must be " + config.summaryMinWords + "-" + config.summaryMaxWords + " words. Current: " + summaryWords + " words.");
  }

  // 2. Summary no duplicates check
  maxScore += 15;
  const sentences = (optimized.summary || "").split(/[.!?]+/).filter(s => s.trim().length > 10);
  const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
  const hasDuplicates = uniqueSentences.size < sentences.length;
  checks.push({
    name: "summary_no_duplicates",
    passed: !hasDuplicates,
    actual: uniqueSentences.size + " unique / " + sentences.length + " total sentences",
    expected: "All sentences unique",
    deduct: hasDuplicates ? 15 : 0,
  });
  if (hasDuplicates) {
    feedback.push("Summary contains duplicate sentences. Remove repeated content.");
  }

  // 3. Skills group count check
  maxScore += 15;
  const skillGroups = optimized.skills?.length || 0;
  const skillsInLimit = skillGroups <= config.skillsMaxGroups;
  checks.push({
    name: "skills_group_count",
    passed: skillsInLimit,
    actual: String(skillGroups),
    expected: "<= " + config.skillsMaxGroups,
    deduct: skillsInLimit ? 0 : 15,
  });
  if (!skillsInLimit) {
    feedback.push("Skills must have <= " + config.skillsMaxGroups + " groups. Current: " + skillGroups + ".");
  }

  // 4. Experience entries count check
  maxScore += 15;
  const expCount = optimized.experience?.length || 0;
  const expInLimit = expCount <= config.experienceMaxEntries;
  checks.push({
    name: "experience_entry_count",
    passed: expInLimit,
    actual: String(expCount),
    expected: "<= " + config.experienceMaxEntries,
    deduct: expInLimit ? 0 : 15,
  });
  if (!expInLimit) {
    feedback.push("Experience must have <= " + config.experienceMaxEntries + " entries. Current: " + expCount + ".");
  }

  // 5. Experience immutable fields check (companies, dates, roles preserved)
  maxScore += 20;
  let immutableIssues = 0;
  for (const origExp of original.experience) {
    const optExp = optimized.experience?.find(
      e => e.company === origExp.company && e.title === origExp.title
    );
    if (!optExp) {
      // Experience entry exists in original but not in optimized
      immutableIssues++;
      continue;
    }
    // Check dates are preserved
    if (optExp.startDate !== origExp.startDate || optExp.endDate !== origExp.endDate) {
      immutableIssues++;
    }
  }
  const immutablesOk = immutableIssues === 0;
  checks.push({
    name: "experience_immutable_fields",
    passed: immutablesOk,
    actual: immutableIssues + " mismatches",
    expected: "0 mismatches",
    deduct: immutablesOk ? 0 : ((immutableIssues / Math.max(original.experience.length, 1)) * 20),
  });
  if (!immutablesOk) {
    feedback.push("Experience immutable fields (company, title, dates) must be preserved. Found " + immutableIssues + " mismatch(es).");
  }

  // 6. Education school names preserved
  maxScore += 10;
  let eduPreserved = true;
  for (let i = 0; i < original.education.length; i++) {
    const origEdu = original.education[i];
    const optEdu = optimized.education[i];
    if (!optEdu) { eduPreserved = false; break; }
    // Only check if original had a non-empty institution
    if (origEdu.institution && origEdu.institution.trim() && 
        optEdu.institution?.trim() !== origEdu.institution.trim()) {
      eduPreserved = false;
      break;
    }
  }
  checks.push({
    name: "education_schools_preserved",
    passed: eduPreserved,
    actual: eduPreserved ? "All preserved" : "School mismatch detected",
    expected: "All school names preserved",
    deduct: eduPreserved ? 0 : 10,
  });
  if (!eduPreserved) {
    feedback.push("Education school names must be preserved. Check institution field.");
  }

  // 7. Languages preserved
  maxScore += 5;
  const origLangCount = original.languages?.length || 0;
  const optLangCount = optimized.languages?.length || 0;
  const langsPreserved = optLangCount >= origLangCount;
  checks.push({
    name: "languages_preserved",
    passed: langsPreserved,
    actual: String(optLangCount),
    expected: ">= " + origLangCount,
    deduct: langsPreserved ? 0 : 5,
  });
  if (!langsPreserved) {
    feedback.push("Languages must be preserved. Original had " + origLangCount + ", optimized has " + optLangCount + ".");
  }

  // Compute score
  const totalDeduct = checks.reduce((sum, c) => sum + c.deduct, 0);
  const score = Math.max(0, Math.round(100 - (totalDeduct / maxScore) * 100));

  return {
    score,
    passed: score >= minScore,
    checks,
    directiveVersion: "v1",
    directiveHash: hashDirective(config),
    feedback,
  };
}

/** Generate a directive version string from config */
export function getDirectiveVersion(config: OptimizerDirectiveConfig): string {
  return "v1-" + hashDirective(config).slice(0, 6);
}
