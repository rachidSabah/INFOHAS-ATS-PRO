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
function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const lengthProperty = 'length';
  let i;

  const words: number[] = [];
  const asciiLength = ascii[lengthProperty];

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const wordsLength = ((asciiLength + 8) >> 6) + 1;
  const wordsCount = wordsLength * 16;
  for (i = 0; i < wordsCount; i++) words[i] = 0;
  for (i = 0; i < asciiLength; i++) {
    words[i >> 2] |= ascii.charCodeAt(i) << (24 - (i & 3) * 8);
  }
  words[asciiLength >> 2] |= 0x80 << (24 - (asciiLength & 3) * 8);
  words[wordsCount - 1] = asciiLength * 8;

  for (let blockIndex = 0; blockIndex < wordsLength; blockIndex++) {
    const w: number[] = [];
    for (i = 0; i < 16; i++) w[i] = words[blockIndex * 16 + i];
    for (i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  let hex = '';
  for (i = 0; i < 8; i++) {
    const hStr = (hash[i] >>> 0).toString(16);
    hex += hStr.padStart(8, '0');
  }
  return hex;
}

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
 * Returns the SHA-256 hash string (64 characters).
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

  const concatenated =
    normalize(exp.title) +
    normalize(exp.company) +
    normalize(exp.location) +
    normalize(exp.startDate) +
    normalize(exp.endDate);

  return sha256(concatenated);
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
    if (!opt.id) {
      violations.push(`Experience[${i}] is missing an ID.`);
      continue;
    }
    const byId = sourceIdMap.get(opt.id);
    const optFp = computeExperienceFingerprint(opt);

    if (byId) {
      const srcFp = computeExperienceFingerprint(byId);
      if (srcFp !== optFp) {
        violations.push(
          `Experience[${i}] (id="${opt.id}") changed fingerprint (original fingerprint: ${srcFp}, optimized fingerprint: ${optFp}).`,
        );
      } else {
        matched++;
      }
    } else {
      // No match by ID, check if it matches by fingerprint
      const byFp = sourceFpMap.get(optFp);
      if (byFp) {
        violations.push(
          `Experience[${i}] (title="${opt.title}", company="${opt.company}") matched by fingerprint but has a different ID (expected "${byFp.id}", got "${opt.id}").`,
        );
      } else {
        unmatched++;
        violations.push(
          `Experience[${i}] (id="${opt.id}", title="${opt.title}", company="${opt.company}") has no matching source entry — possibly hallucinated`,
        );
      }
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
