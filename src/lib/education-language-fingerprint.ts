// ============================================================================
// Education & Language Fingerprint Engine
//
// Provides immutable fingerprints and ID-based matching for education and
// language entries — replacing unreliable index-based matching.
//
// Fingerprints are computed from immutable fields only:
//   Education: school + diploma + startDate + endDate
//   Languages: language + proficiency
//
// The fingerprint is NOT stored on the entry — it's computed on-demand.
// This prevents the LLM from corrupting the fingerprint itself.
// ============================================================================

"use client";

import type { ResumeEducation, ResumeLanguage, ResumeData } from "./types";

// ============================================================================
// EDUCATION FINGERPRINTS
// ============================================================================

export interface EducationFingerprint {
  id: string;
  school: string;
  diploma: string;
  startDate: string;
  endDate: string;
}

/**
 * Compute a stable fingerprint for an education entry.
 *
 * Based on IMMUTABLE fields: school + diploma + startDate + endDate
 * Highlights and location are excluded (mutable/formatting).
 */
export function computeEducationFingerprint(edu: {
  institution?: string;
  degree?: string;
  startDate?: string;
  endDate?: string;
}): string {
  const normalize = (s: string | undefined): string =>
    (s || "").toLowerCase().trim().replace(/\s+/g, " ");

  const parts = [
    normalize(edu.institution),  // school
    normalize(edu.degree),       // diploma
    normalize(edu.startDate),
    normalize(edu.endDate),
  ];
  const key = parts.join("|");

  // djb2 hash (same as experience fingerprint)
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) & 0xffffffff;
  }
  const part1 = (hash >>> 0).toString(16).padStart(8, "0");

  let hash2 = 52711;
  for (let i = 0; i < key.length; i++) {
    hash2 = ((hash2 << 5) + hash2 + key.charCodeAt(i)) & 0xffffffff;
  }
  const part2 = (hash2 >>> 0).toString(16).padStart(8, "0");

  return part1 + part2;
}

/**
 * Build a fingerprint → education entry map for fast lookup.
 */
export function buildEducationFingerprintMap(resume: ResumeData): Map<string, ResumeEducation> {
  const map = new Map<string, ResumeEducation>();
  for (const edu of resume.education) {
    const fp = computeEducationFingerprint(edu);
    map.set(fp, edu);
  }
  return map;
}

/**
 * Build an ID → education entry map for fast lookup.
 */
export function buildEducationIdMap(resume: ResumeData): Map<string, ResumeEducation> {
  const map = new Map<string, ResumeEducation>();
  for (const edu of resume.education) {
    if (edu.id) {
      map.set(edu.id, edu);
    }
  }
  return map;
}

/**
 * Find the matching source education for an optimized entry.
 *
 * Matching priority:
 *   1. ID match (100% reliable)
 *   2. Fingerprint match (school + diploma + dates hash)
 *   3. School + diploma match (fallback for slight AI rephrasing)
 *   4. Index fallback (LAST RESORT — logs a warning)
 */
export function findMatchingSourceEducation(
  optimized: { id?: string; institution?: string; degree?: string; startDate?: string; endDate?: string },
  sourceResume: ResumeData,
  index?: number,
): { match: ResumeEducation | null; method: "id" | "fingerprint" | "school-diploma" | "index" | "none"; warning?: string } {
  // 1. ID match
  if (optimized.id) {
    const idMap = buildEducationIdMap(sourceResume);
    const byId = idMap.get(optimized.id);
    if (byId) {
      return { match: byId, method: "id" };
    }
  }

  // 2. Fingerprint match
  const fpMap = buildEducationFingerprintMap(sourceResume);
  const fp = computeEducationFingerprint(optimized);
  const byFp = fpMap.get(fp);
  if (byFp) {
    return {
      match: byFp,
      method: "fingerprint",
      warning: `Education matched by fingerprint (ID "${optimized.id}" not found in source)`,
    };
  }

  // 3. School + diploma match
  const optSchoolLower = (optimized.institution || "").toLowerCase().trim();
  const optDiplomaLower = (optimized.degree || "").toLowerCase().trim();
  if (optSchoolLower || optDiplomaLower) {
    const bySchoolDiploma = sourceResume.education.find((e) => {
      const eSchoolLower = (e.institution || "").toLowerCase().trim();
      const eDiplomaLower = (e.degree || "").toLowerCase().trim();
      return (optSchoolLower && eSchoolLower === optSchoolLower) ||
             (optDiplomaLower && eDiplomaLower === optDiplomaLower) ||
             (optSchoolLower && eSchoolLower && (eSchoolLower.includes(optSchoolLower) || optSchoolLower.includes(eSchoolLower))) ||
             (optDiplomaLower && eDiplomaLower && (eDiplomaLower.includes(optDiplomaLower) || optDiplomaLower.includes(eDiplomaLower)));
    });
    if (bySchoolDiploma) {
      return {
        match: bySchoolDiploma,
        method: "school-diploma",
        warning: `Education matched by school/diploma (ID "${optimized.id}" not found in source)`,
      };
    }
  }

  // 4. Index fallback
  if (index !== undefined && index < sourceResume.education.length) {
    return {
      match: sourceResume.education[index],
      method: "index",
      warning: `Education matched by INDEX fallback (${index}) — ID, fingerprint, and school/diploma all failed`,
    };
  }

  return { match: null, method: "none" };
}

/**
 * Validate that all education entries in the optimized resume have
 * matching source entries (by ID or fingerprint).
 */
export function validateEducationFingerprints(
  optimized: ResumeData,
  source: ResumeData,
): { valid: boolean; violations: string[]; matched: number; unmatched: number } {
  const violations: string[] = [];
  let matched = 0;
  let unmatched = 0;

  const sourceIdMap = buildEducationIdMap(source);
  const sourceFpMap = buildEducationFingerprintMap(source);

  for (let i = 0; i < optimized.education.length; i++) {
    const opt = optimized.education[i];
    const byId = opt.id ? sourceIdMap.get(opt.id) : null;
    const byFp = sourceFpMap.get(computeEducationFingerprint(opt));

    if (byId || byFp) {
      matched++;
    } else {
      unmatched++;
      violations.push(
        `Education[${i}] (id="${opt.id}", degree="${opt.degree}", institution="${opt.institution}") has no matching source entry`,
      );
    }
  }

  // Check for missing entries (in source but not in optimized)
  const optIds = new Set(optimized.education.map((e) => e.id).filter(Boolean));
  const optFps = new Set(optimized.education.map((e) => computeEducationFingerprint(e)));
  for (const srcEdu of source.education) {
    const srcFp = computeEducationFingerprint(srcEdu);
    if (!optIds.has(srcEdu.id) && !optFps.has(srcFp)) {
      violations.push(
        `Source education (id="${srcEdu.id}", degree="${srcEdu.degree}", institution="${srcEdu.institution}") was dropped from optimized resume`,
      );
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    matched,
    unmatched,
  };
}

// ============================================================================
// LANGUAGE FINGERPRINTS
// ============================================================================

export interface LanguageFingerprint {
  id: string;
  language: string;
  proficiency: string;
}

/**
 * Compute a stable fingerprint for a language entry.
 *
 * Based on IMMUTABLE fields: language + proficiency
 */
export function computeLanguageFingerprint(lang: {
  name?: string;
  proficiency?: string;
}): string {
  const normalize = (s: string | undefined): string =>
    (s || "").toLowerCase().trim().replace(/\s+/g, " ");

  const parts = [
    normalize(lang.name),        // language
    normalize(lang.proficiency),
  ];
  const key = parts.join("|");

  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) & 0xffffffff;
  }
  const part1 = (hash >>> 0).toString(16).padStart(8, "0");

  let hash2 = 52711;
  for (let i = 0; i < key.length; i++) {
    hash2 = ((hash2 << 5) + hash2 + key.charCodeAt(i)) & 0xffffffff;
  }
  const part2 = (hash2 >>> 0).toString(16).padStart(8, "0");

  return part1 + part2;
}

/**
 * Build a fingerprint → language entry map for fast lookup.
 */
export function buildLanguageFingerprintMap(resume: ResumeData): Map<string, ResumeLanguage> {
  const map = new Map<string, ResumeLanguage>();
  for (const lang of resume.languages) {
    const fp = computeLanguageFingerprint(lang);
    map.set(fp, lang);
  }
  return map;
}

/**
 * Build an ID → language entry map for fast lookup.
 */
export function buildLanguageIdMap(resume: ResumeData): Map<string, ResumeLanguage> {
  const map = new Map<string, ResumeLanguage>();
  for (const lang of resume.languages) {
    if (lang.id) {
      map.set(lang.id, lang);
    }
  }
  return map;
}

/**
 * Find the matching source language for an optimized entry.
 *
 * Matching priority:
 *   1. ID match
 *   2. Fingerprint match (language + proficiency hash)
 *   3. Language name match (case-insensitive)
 *   4. Index fallback (LAST RESORT — logs a warning)
 */
export function findMatchingSourceLanguage(
  optimized: { id?: string; name?: string; proficiency?: string },
  sourceResume: ResumeData,
  index?: number,
): { match: ResumeLanguage | null; method: "id" | "fingerprint" | "name" | "index" | "none"; warning?: string } {
  // 1. ID match
  if (optimized.id) {
    const idMap = buildLanguageIdMap(sourceResume);
    const byId = idMap.get(optimized.id);
    if (byId) {
      return { match: byId, method: "id" };
    }
  }

  // 2. Fingerprint match
  const fpMap = buildLanguageFingerprintMap(sourceResume);
  const fp = computeLanguageFingerprint(optimized);
  const byFp = fpMap.get(fp);
  if (byFp) {
    return {
      match: byFp,
      method: "fingerprint",
      warning: `Language matched by fingerprint (ID "${optimized.id}" not found in source)`,
    };
  }

  // 3. Language name match (case-insensitive)
  const optNameLower = (optimized.name || "").toLowerCase().trim();
  if (optNameLower) {
    const byName = sourceResume.languages.find((l) => {
      const lNameLower = (l.name || "").toLowerCase().trim();
      return lNameLower === optNameLower;
    });
    if (byName) {
      return {
        match: byName,
        method: "name",
        warning: `Language matched by name "${optimized.name}" (ID "${optimized.id}" not found in source)`,
      };
    }
  }

  // 4. Index fallback
  if (index !== undefined && index < sourceResume.languages.length) {
    return {
      match: sourceResume.languages[index],
      method: "index",
      warning: `Language matched by INDEX fallback (${index}) — ID, fingerprint, and name all failed`,
    };
  }

  return { match: null, method: "none" };
}

/**
 * Validate that all language entries in the optimized resume have
 * matching source entries and that no languages were dropped.
 */
export function validateLanguageFingerprints(
  optimized: ResumeData,
  source: ResumeData,
): { valid: boolean; violations: string[]; matched: number; unmatched: number; dropped: number } {
  const violations: string[] = [];
  let matched = 0;
  let unmatched = 0;

  const sourceIdMap = buildLanguageIdMap(source);
  const sourceFpMap = buildLanguageFingerprintMap(source);
  const sourceNameSet = new Set(source.languages.map((l) => l.name.toLowerCase().trim()).filter(Boolean));

  for (let i = 0; i < optimized.languages.length; i++) {
    const opt = optimized.languages[i];
    const byId = opt.id ? sourceIdMap.get(opt.id) : null;
    const byFp = sourceFpMap.get(computeLanguageFingerprint(opt));
    const optNameLower = (opt.name || "").toLowerCase().trim();
    const byName = optNameLower && sourceNameSet.has(optNameLower);

    if (byId || byFp || byName) {
      matched++;
    } else {
      unmatched++;
      violations.push(
        `Languages[${i}] (id="${opt.id}", name="${opt.name}", proficiency="${opt.proficiency}") has no matching source entry`,
      );
    }
  }

  // Check for dropped languages (in source but not in optimized)
  const optNames = new Set(optimized.languages.map((l) => l.name.toLowerCase().trim()).filter(Boolean));
  const optIds = new Set(optimized.languages.map((l) => l.id).filter(Boolean));
  let dropped = 0;
  for (const srcLang of source.languages) {
    const srcNameLower = (srcLang.name || "").toLowerCase().trim();
    if (!optIds.has(srcLang.id) && !optNames.has(srcNameLower)) {
      dropped++;
      violations.push(
        `Source language "${srcLang.name}" (${srcLang.proficiency}) was dropped from optimized resume`,
      );
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    matched,
    unmatched,
    dropped,
  };
}

// ============================================================================
// SIMILARITY ENGINE
// ============================================================================

/**
 * Calculate education similarity between source and optimized.
 * Returns a percentage (0-100).
 *
 * Checks:
 *   - Same number of entries
 *   - Same institutions (school names)
 *   - Same degrees (diplomas)
 *   - Same dates
 */
export function calculateEducationSimilarity(source: ResumeData, optimized: ResumeData): number {
  if (source.education.length === 0 && optimized.education.length === 0) return 100;
  if (source.education.length === 0 || optimized.education.length === 0) return 0;

  let totalScore = 0;
  const sourceFpMap = buildEducationFingerprintMap(source);
  const sourceIdMap = buildEducationIdMap(source);

  for (const optEdu of optimized.education) {
    // Find matching source entry
    const match = optEdu.id ? sourceIdMap.get(optEdu.id) : null;
    const fpMatch = sourceFpMap.get(computeEducationFingerprint(optEdu));
    const srcEdu = match || fpMatch || source.education.find((s) =>
      s.institution?.toLowerCase().trim() === optEdu.institution?.toLowerCase().trim() &&
      s.degree?.toLowerCase().trim() === optEdu.degree?.toLowerCase().trim()
    );

    if (!srcEdu) {
      continue; // No match — 0 for this entry
    }

    let entryScore = 0;
    const fields = 4; // institution, degree, startDate, endDate

    // Institution (school) — weight 40%
    if ((srcEdu.institution || "").toLowerCase().trim() === (optEdu.institution || "").toLowerCase().trim() && srcEdu.institution) {
      entryScore += 40;
    }
    // Degree (diploma) — weight 30%
    if ((srcEdu.degree || "").toLowerCase().trim() === (optEdu.degree || "").toLowerCase().trim() && srcEdu.degree) {
      entryScore += 30;
    }
    // Start date — weight 15%
    if ((srcEdu.startDate || "").toLowerCase().trim() === (optEdu.startDate || "").toLowerCase().trim()) {
      entryScore += 15;
    }
    // End date — weight 15%
    if ((srcEdu.endDate || "").toLowerCase().trim() === (optEdu.endDate || "").toLowerCase().trim()) {
      entryScore += 15;
    }

    totalScore += entryScore;
  }

  // Penalize for dropped/added entries
  const countDiff = Math.abs(source.education.length - optimized.education.length);
  const countPenalty = countDiff * 10;

  return Math.max(0, Math.min(100, Math.round(totalScore / source.education.length) - countPenalty));
}

/**
 * Calculate language similarity between source and optimized.
 * Returns a percentage (0-100). Must be 100% (languages are immutable).
 *
 * Checks:
 *   - Same number of languages
 *   - Same language names
 *   - Same proficiency levels
 */
export function calculateLanguageSimilarity(source: ResumeData, optimized: ResumeData): number {
  if (source.languages.length === 0 && optimized.languages.length === 0) return 100;
  if (source.languages.length === 0 || optimized.languages.length === 0) return 0;

  let matched = 0;
  for (const srcLang of source.languages) {
    const srcNameLower = (srcLang.name || "").toLowerCase().trim();
    const srcProfLower = (srcLang.proficiency || "").toLowerCase().trim();

    const optMatch = optimized.languages.find((l) => {
      const lNameLower = (l.name || "").toLowerCase().trim();
      const lProfLower = (l.proficiency || "").toLowerCase().trim();
      return lNameLower === srcNameLower;
    });

    if (optMatch) {
      const lProfLower = (optMatch.proficiency || "").toLowerCase().trim();
      if (lProfLower === srcProfLower) {
        matched++;
      } else {
        // Name matches but proficiency different — half credit
        matched += 0.5;
      }
    }
  }

  return Math.round((matched / source.languages.length) * 100);
}

// ============================================================================
// OBSERVABILITY LOGGING
// ============================================================================

export function logEducationPipeline(stage: "parsed" | "optimized" | "restored", education: ResumeEducation[]): void {
  console.info(`[Education Pipeline] ${stage.toUpperCase()}: ${education.length} entries`);
  for (let i = 0; i < education.length; i++) {
    const edu = education[i];
    console.info(`  [${i}] id=${edu.id}, school="${edu.institution}", diploma="${edu.degree}", dates=${edu.startDate}–${edu.endDate}`);
  }
}

export function logLanguagePipeline(stage: "parsed" | "optimized" | "restored", languages: ResumeLanguage[]): void {
  console.info(`[Language Pipeline] ${stage.toUpperCase()}: ${languages.length} entries`);
  for (let i = 0; i < languages.length; i++) {
    const lang = languages[i];
    console.info(`  [${i}] id=${lang.id}, language="${lang.name}", proficiency="${lang.proficiency}"`);
  }
}
