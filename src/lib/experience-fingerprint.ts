// ============================================================================
// Experience Fingerprint Engine
//
// Creates immutable fingerprints for experience entries based on their
// immutable fields (title + company + location + startDate + endDate).
//
// Fingerprints are used to:
//   1. Detect when the LLM has reordered/merged/dropped experience entries
//   2. Match optimized entries back to source entries by fingerprint
//      (instead of unreliable index-based matching)
//   3. Validate that no experience entries were hallucinated
//
// The fingerprint is NOT stored on the experience object — it's computed
// on-demand from the immutable fields. This prevents the LLM from
// corrupting the fingerprint itself.
// ============================================================================

"use client";

import type { ResumeExperience, ResumeData } from "./types";

/**
 * Compute a stable fingerprint for an experience entry.
 *
 * The fingerprint is based on IMMUTABLE fields only:
 *   title + company + location + startDate + endDate
 *
 * Bullets are excluded because they ARE mutable (the optimizer rewrites them).
 * IDs are excluded because they're application-owned, not LLM-owned.
 *
 * The fingerprint is normalized:
 *   - lowercase
 *   - trimmed
 *   - whitespace collapsed
 *   - empty fields contribute "" (so an entry with no company still has a stable fingerprint)
 *
 * Returns a hex string (first 16 chars of SHA-256, enough for collision resistance
 * across a resume with <100 entries).
 */
export function computeExperienceFingerprint(exp: {
  title?: string;
  company?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
}): string {
  const normalize = (s: string | undefined): string =>
    (s || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");

  const parts = [
    normalize(exp.title),
    normalize(exp.company),
    normalize(exp.location),
    normalize(exp.startDate),
    normalize(exp.endDate),
  ];
  const key = parts.join("|");

  // Simple hash (djb2) — works in browser without crypto.subtle.
  // For a resume with <100 entries, collision risk is negligible.
  // We use a 16-char hex string for readability.
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) & 0xffffffff;
  }
  // Convert to unsigned and pad to 8 hex chars, then double it for 16 chars
  const part1 = (hash >>> 0).toString(16).padStart(8, "0");
  // Second hash with different seed for the second half
  let hash2 = 52711;
  for (let i = 0; i < key.length; i++) {
    hash2 = ((hash2 << 5) + hash2 + key.charCodeAt(i)) & 0xffffffff;
  }
  const part2 = (hash2 >>> 0).toString(16).padStart(8, "0");
  return part1 + part2;
}

/**
 * Build a fingerprint map for all experience entries in a resume.
 * Returns Map<fingerprint, ResumeExperience>.
 */
export function buildExperienceFingerprintMap(resume: ResumeData): Map<string, ResumeExperience> {
  const map = new Map<string, ResumeExperience>();
  for (const exp of resume.experience) {
    const fp = computeExperienceFingerprint(exp);
    map.set(fp, exp);
  }
  return map;
}

/**
 * Build an ID-based map for all experience entries.
 * Returns Map<id, ResumeExperience>.
 *
 * This is the PRIMARY matching method — ID-based matching is 100% reliable
 * when the LLM preserves IDs (which it MUST in the new architecture).
 */
export function buildExperienceIdMap(resume: ResumeData): Map<string, ResumeExperience> {
  const map = new Map<string, ResumeExperience>();
  for (const exp of resume.experience) {
    if (exp.id) {
      map.set(exp.id, exp);
    }
  }
  return map;
}

/**
 * Find the matching source experience for an optimized entry.
 *
 * Matching priority:
 *   1. ID match (100% reliable — LLM must preserve IDs)
 *   2. Fingerprint match (reliable when LLM preserved immutable fields)
 *   3. Title + Company match (fallback for slight AI rephrasing)
 *   4. Index fallback (LAST RESORT — logs a warning)
 *
 * Returns the matched source entry, or null if no match found.
 */
export function findMatchingSourceExperience(
  optimized: { id?: string; title?: string; company?: string; location?: string; startDate?: string; endDate?: string },
  sourceResume: ResumeData,
  index?: number,
): { match: ResumeExperience | null; method: "id" | "fingerprint" | "title-company" | "index" | "none"; warning?: string } {
  // 1. ID match
  if (optimized.id) {
    const idMap = buildExperienceIdMap(sourceResume);
    const byId = idMap.get(optimized.id);
    if (byId) {
      return { match: byId, method: "id" };
    }
  }

  // 2. Fingerprint match
  const fpMap = buildExperienceFingerprintMap(sourceResume);
  const fp = computeExperienceFingerprint(optimized);
  const byFp = fpMap.get(fp);
  if (byFp) {
    return {
      match: byFp,
      method: "fingerprint",
      warning: `Experience matched by fingerprint (ID "${optimized.id}" not found in source — LLM may have changed the ID)`,
    };
  }

  // 3. Title + Company match
  const optTitleLower = (optimized.title || "").toLowerCase().trim();
  const optCompanyLower = (optimized.company || "").toLowerCase().trim();
  if (optTitleLower || optCompanyLower) {
    const byTitleCompany = sourceResume.experience.find((e) => {
      const eTitleLower = (e.title || "").toLowerCase().trim();
      const eCompanyLower = (e.company || "").toLowerCase().trim();
      return (optTitleLower && eTitleLower === optTitleLower) ||
             (optCompanyLower && eCompanyLower === optCompanyLower) ||
             (optCompanyLower && eCompanyLower && (eCompanyLower.includes(optCompanyLower) || optCompanyLower.includes(eCompanyLower)));
    });
    if (byTitleCompany) {
      return {
        match: byTitleCompany,
        method: "title-company",
        warning: `Experience matched by title/company (ID "${optimized.id}" not found in source — LLM may have changed the ID)`,
      };
    }
  }

  // 4. Index fallback (LAST RESORT)
  if (index !== undefined && index < sourceResume.experience.length) {
    return {
      match: sourceResume.experience[index],
      method: "index",
      warning: `Experience matched by INDEX fallback (index ${index}) — ID, fingerprint, and title/company all failed. This indicates the LLM significantly modified the entry.`,
    };
  }

  return { match: null, method: "none" };
}

/**
 * Validate that all experience entries in the optimized resume have
 * matching source entries (by ID or fingerprint).
 *
 * Returns a list of violations (empty = valid).
 */
export function validateExperienceFingerprints(
  optimized: ResumeData,
  source: ResumeData,
): { valid: boolean; violations: string[]; matched: number; unmatched: number } {
  const violations: string[] = [];
  let matched = 0;
  let unmatched = 0;

  const sourceIdMap = buildExperienceIdMap(source);
  const sourceFpMap = buildExperienceFingerprintMap(source);

  for (let i = 0; i < optimized.experience.length; i++) {
    const opt = optimized.experience[i];
    const byId = opt.id ? sourceIdMap.get(opt.id) : null;
    const byFp = sourceFpMap.get(computeExperienceFingerprint(opt));

    if (byId || byFp) {
      matched++;
    } else {
      unmatched++;
      violations.push(
        `Experience[${i}] (id="${opt.id}", title="${opt.title}", company="${opt.company}") has no matching source entry — possibly hallucinated`,
      );
    }
  }

  // Check for missing entries (in source but not in optimized)
  const optIds = new Set(optimized.experience.map((e) => e.id).filter(Boolean));
  const optFps = new Set(optimized.experience.map((e) => computeExperienceFingerprint(e)));
  for (const srcExp of source.experience) {
    const srcFp = computeExperienceFingerprint(srcExp);
    if (!optIds.has(srcExp.id) && !optFps.has(srcFp)) {
      violations.push(
        `Source experience (id="${srcExp.id}", title="${srcExp.title}", company="${srcExp.company}") was dropped from optimized resume`,
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
