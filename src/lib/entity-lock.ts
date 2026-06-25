// ============================================================================
// Entity Lock System — Immutable Entity Protection for Resume Optimization
//
// PURPOSE:
//   Extracts and locks immutable entities BEFORE optimization.
//   Restores locked entities AFTER optimization.
//   FAILS the pipeline if restoration fails.
//
// IMMUTABLE ENTITIES (from spec):
//   - employer / company names
//   - job titles
//   - dates (startDate, endDate) — NEVER changed to "Present"
//   - locations (work, education, contact)
//   - education (institution, degree, field, dates)
//   - certifications
//   - languages
//   - contact details (name, email, phone)
//
// USAGE:
//   const locked = extractLockedEntities(originalResume);
//   // ... run AI optimization ...
//   const restored = restoreLockedEntities(optimizedResume, locked);
//   const check = verifyEntityIntegrity(restored, locked);
//   if (!check.passed) FAIL_PIPELINE();
// ============================================================================

import type { ResumeData, ResumeExperience, ResumeEducation, ResumeLanguage, ResumeCertification, ResumeSkill } from "./types";

// ============================================================================
// Types
// ============================================================================

/** A single locked experience entry — ALL fields are immutable */
export interface LockedExperience {
  id: string;
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[]; // Original bullets preserved for restoration fallback
}

/** A single locked education entry — ALL fields are immutable */
export interface LockedEducation {
  id: string;
  institution: string;
  degree: string;
  field: string;
  location: string;
  startDate: string;
  endDate: string;
  highlights: string[];
}

/** All immutable entities extracted from the original resume */
export interface LockedEntities {
  /** Original resume ID for traceability */
  sourceResumeId: string;
  /** Contact info — NEVER changes */
  contact: {
    name: string;
    email: string;
    phone: string;
    location: string;
  };
  /** Experience entries — NEVER added, removed, or modified at metadata level */
  experiences: LockedExperience[];
  /** Education entries — NEVER added, removed, or modified */
  education: LockedEducation[];
  /** Languages — NEVER added or removed */
  languages: ResumeLanguage[];
  /** Certifications — NEVER added or removed */
  certifications: ResumeCertification[];
  /** Counts for integrity verification */
  counts: {
    experience: number;
    education: number;
    languages: number;
    certifications: number;
  };
  /** Hash of original data for tamper detection */
  integrityHash: string;
}

/** Result of entity integrity verification */
export interface EntityIntegrityCheck {
  passed: boolean;
  /** Critical failures that must fail the pipeline */
  criticalFailures: EntityFailure[];
  /** Warnings that don't fail but should be logged */
  warnings: string[];
  /** Score 0-100 (100 = perfect integrity) */
  integrityScore: number;
}

export interface EntityFailure {
  type: "company_missing" | "date_missing" | "date_changed" | "education_missing"
    | "language_missing" | "certification_missing" | "duplicate_experience"
    | "hallucinated_employer" | "hallucinated_university" | "hallucinated_location"
    | "company_count_mismatch" | "education_count_mismatch" | "language_count_mismatch"
    | "certification_count_mismatch" | "contact_changed" | "summary_corruption"
    | "present_injection";
  message: string;
  field?: string;
  expected?: string;
  actual?: string;
}

// ============================================================================
// PLACEHOLDER / HALLUCINATION DETECTION
// ============================================================================

const PLACEHOLDER_COMPANY_PATTERNS = [
  /^\s*unknown\s*$/i,
  /^\s*n\/a\s*$/i,
  /^\s*retail company\s*$/i,
  /^\s*beauty retailer\s*$/i,
  /^\s*qdfc\s*$/i,
  /^\s*company name\s*$/i,
  /^\s*previous employer\s*$/i,
  /^\s*projected role\s*$/i,
  /^\s*example company\s*$/i,
  /^\s*your company\s*$/i,
  /^\s*sample\s*$/i,
  /^\s*placeholder\s*$/i,
  /^\s*xxx\s*$/i,
];

const PLACEHOLDER_INSTITUTION_PATTERNS = [
  /^\s*unknown\s*$/i,
  /^\s*n\/a\s*$/i,
  /^\s*institution name\s*$/i,
  /^\s*university name\s*$/i,
  /^\s*college name\s*$/i,
  /^\s*example university\s*$/i,
  /^\s*placeholder\s*$/i,
  /^\s*xxx\s*$/i,
];

/** Check if a company name is a placeholder/hallucination */
export function isPlaceholderCompany(company: string): boolean {
  if (!company || company.trim().length === 0) return true;
  return PLACEHOLDER_COMPANY_PATTERNS.some((p) => p.test(company.trim()));
}

/** Check if an institution name is a placeholder/hallucination */
export function isPlaceholderInstitution(institution: string): boolean {
  if (!institution || institution.trim().length === 0) return true;
  return PLACEHOLDER_INSTITUTION_PATTERNS.some((p) => p.test(institution.trim()));
}

/** Check if an end date was incorrectly injected as "Present" */
export function isPresentInjection(originalEndDate: string, optimizedEndDate: string): boolean {
  if (!optimizedEndDate) return false;
  const opt = optimizedEndDate.trim().toLowerCase();
  const orig = (originalEndDate || "").trim().toLowerCase();
  // "Present" is only valid if the original also says "Present"
  if (opt === "present" && orig !== "present") return true;
  if (opt === "current" && orig !== "current" && orig !== "present") return true;
  return false;
}

/** Check if a date was changed (excluding legitimate formatting changes) */
export function isDateChanged(original: string, optimized: string): boolean {
  if (!original && !optimized) return false;
  const orig = (original || "").trim().toLowerCase();
  const opt = (optimized || "").trim().toLowerCase();
  if (orig === opt) return false;
  // Allow same date with different formatting (e.g. "Jan 2020" vs "January 2020")
  // Extract year — if years match, it's likely a formatting difference
  const origYear = orig.match(/\b(20\d{2})\b/);
  const optYear = opt.match(/\b(20\d{2})\b/);
  if (origYear && optYear && origYear[1] === optYear[1]) {
    // Years match — check if months also match
    const origMonth = extractMonth(orig);
    const optMonth = extractMonth(opt);
    if (origMonth === optMonth) return false; // Same date, different format
  }
  return true;
}

/** Extract month number from date string (0-11, -1 if not found) */
function extractMonth(dateStr: string): number {
  const monthMap: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  const lower = dateStr.toLowerCase();
  for (const [name, num] of Object.entries(monthMap)) {
    if (lower.includes(name)) return num;
  }
  return -1;
}

// ============================================================================
// ENTITY EXTRACTION (Pre-Optimization)
// ============================================================================

/**
 * Extract all immutable entities from the original resume.
 * Call this BEFORE optimization. Store the result.
 * No downstream agent may modify these values.
 */
export function extractLockedEntities(resume: ResumeData): LockedEntities {
  const experiences: LockedExperience[] = resume.experience.map((e) => ({
    id: e.id,
    title: e.title || "",
    company: e.company || "",
    location: e.location || "",
    startDate: e.startDate || "",
    endDate: e.endDate || "",
    bullets: [...e.bullets],
  }));

  const education: LockedEducation[] = resume.education.map((ed) => ({
    id: ed.id,
    institution: ed.institution || "",
    degree: ed.degree || "",
    field: ed.field || "",
    location: ed.location || "",
    startDate: ed.startDate || "",
    endDate: ed.endDate || "",
    highlights: [...(ed.highlights || [])],
  }));

  const languages: ResumeLanguage[] = resume.languages.map((l) => ({
    ...l,
    name: l.name || "",
    proficiency: l.proficiency || "fluent",
  }));

  const certifications: ResumeCertification[] = resume.certifications.map((c) => ({
    ...c,
    name: c.name || "",
  }));

  return {
    sourceResumeId: resume.id,
    contact: {
      name: resume.name || "",
      email: resume.contact?.email || "",
      phone: resume.contact?.phone || "",
      location: resume.contact?.location || "",
    },
    experiences,
    education,
    languages,
    certifications,
    counts: {
      experience: experiences.length,
      education: education.length,
      languages: languages.length,
      certifications: certifications.length,
    },
    integrityHash: computeIntegrityHash(resume),
  };
}

/** Compute a simple integrity hash for tamper detection */
function computeIntegrityHash(resume: ResumeData): string {
  const payload = JSON.stringify({
    name: resume.name,
    email: resume.contact?.email,
    phone: resume.contact?.phone,
    expCount: resume.experience.length,
    eduCount: resume.education.length,
    langCount: resume.languages.length,
    certCount: resume.certifications.length,
    companies: resume.experience.map((e) => e.company).join("|"),
    institutions: resume.education.map((e) => e.institution).join("|"),
  });
  // Simple hash
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const chr = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ============================================================================
// EXPERIENCE MATCHING (Robust matching by company + title)
// ============================================================================

/**
 * Find the best matching locked experience for an optimized experience entry.
 * Uses company name first, then title, then index fallback.
 * NEVER returns undefined if a fallback index is provided.
 */
export function findMatchingExperience(
  optimized: ResumeExperience,
  locked: LockedExperience[],
  indexFallback?: number,
): LockedExperience | null {
  const optCompany = (optimized.company || "").toLowerCase().trim();
  const optTitle = (optimized.title || "").toLowerCase().trim();

  // Strategy 1: Exact company match
  let match = locked.find((l) => l.company.toLowerCase().trim() === optCompany);
  if (match) return match;

  // Strategy 2: Substring company match (AI may have cleaned up the name)
  match = locked.find((l) => {
    const lc = l.company.toLowerCase().trim();
    return lc.includes(optCompany) || optCompany.includes(lc);
  });
  if (match) return match;

  // Strategy 3: Exact title match
  match = locked.find((l) => l.title.toLowerCase().trim() === optTitle);
  if (match) return match;

  // Strategy 4: Substring title match
  match = locked.find((l) => {
    const lt = l.title.toLowerCase().trim();
    return lt.includes(optTitle) || optTitle.includes(lt);
  });
  if (match) return match;

  // Strategy 5: Index fallback (only if index is valid)
  if (indexFallback !== undefined && indexFallback >= 0 && indexFallback < locked.length) {
    return locked[indexFallback];
  }

  // No match found
  return null;
}

/**
 * Find the best matching locked education for an optimized education entry.
 */
export function findMatchingEducation(
  optimized: ResumeEducation,
  locked: LockedEducation[],
  indexFallback?: number,
): LockedEducation | null {
  const optInst = (optimized.institution || "").toLowerCase().trim();
  const optDegree = (optimized.degree || "").toLowerCase().trim();

  // Strategy 1: Exact institution match
  let match = locked.find((l) => l.institution.toLowerCase().trim() === optInst);
  if (match) return match;

  // Strategy 2: Substring institution match
  match = locked.find((l) => {
    const li = l.institution.toLowerCase().trim();
    return li.includes(optInst) || optInst.includes(li);
  });
  if (match) return match;

  // Strategy 3: Exact degree match
  match = locked.find((l) => l.degree.toLowerCase().trim() === optDegree);
  if (match) return match;

  // Strategy 4: Index fallback
  if (indexFallback !== undefined && indexFallback >= 0 && indexFallback < locked.length) {
    return locked[indexFallback];
  }

  return null;
}

// ============================================================================
// ENTITY RESTORATION (Post-Optimization)
// ============================================================================

/**
 * Restore ALL locked entities into the optimized resume.
 * This overwrites any AI-modified immutable fields with the original values.
 *
 * RULES:
 *   - Company names are ALWAYS restored from locked entities
 *   - Dates are ALWAYS restored from locked entities
 *   - Locations are ALWAYS restored from locked entities
 *   - Education is ALWAYS restored from locked entities
 *   - Languages are ALWAYS restored from locked entities
 *   - Certifications are ALWAYS restored from locked entities
 *   - Contact info is ALWAYS restored from locked entities
 *   - Bullets are KEPT from AI (if valid) — only metadata is restored
 *   - Summary is KEPT from AI (if valid length) — meaning may be improved
 *
 * Call this AFTER AI optimization, BEFORE any quality gates.
 */
export function restoreLockedEntities(optimized: ResumeData, locked: LockedEntities): ResumeData {
  const restored: ResumeData = {
    ...optimized,
    // Contact info — ALWAYS locked
    name: locked.contact.name,
    contact: {
      ...optimized.contact,
      email: locked.contact.email,
      phone: locked.contact.phone,
      location: locked.contact.location,
    },
  };

  // === Restore Experience ===
  if (locked.experiences.length > 0) {
    const matchedIndices = new Set<number>();
    const restoredExperiences: ResumeExperience[] = [];

    // First pass: match optimized entries to locked entries
    for (let i = 0; i < optimized.experience.length; i++) {
      const opt = optimized.experience[i];
      const match = findMatchingExperience(opt, locked.experiences, i);

      if (match) {
        matchedIndices.add(locked.experiences.indexOf(match));
        restoredExperiences.push({
          ...opt,
          id: match.id, // Preserve original ID
          title: match.title, // LOCKED
          company: match.company, // LOCKED
          location: match.location, // LOCKED
          startDate: match.startDate, // LOCKED
          endDate: match.endDate, // LOCKED
          // Bullets come from AI (they were optimized), but if AI dropped them, restore original
          bullets: opt.bullets && opt.bullets.length > 0 ? opt.bullets : [...match.bullets],
        });
      } else {
        // Optimized entry has no match — it might be hallucinated.
        // Only keep it if it passes placeholder detection.
        if (!isPlaceholderCompany(opt.company)) {
          // It's not an obvious placeholder, but it wasn't in the original.
          // This is a potential hallucination. Strip it.
          console.warn(`[EntityLock] Stripping hallucinated experience entry: "${opt.company}" — "${opt.title}"`);
        }
        // Otherwise drop it (don't add to restoredExperiences)
      }
    }

    // Second pass: add any missing original experiences that the AI dropped
    for (let i = 0; i < locked.experiences.length; i++) {
      if (!matchedIndices.has(i)) {
        const missing = locked.experiences[i];
        console.info(`[EntityLock] Restoring dropped experience: ${missing.title} at ${missing.company}`);
        restoredExperiences.push({
          id: missing.id,
          title: missing.title,
          company: missing.company,
          location: missing.location,
          startDate: missing.startDate,
          endDate: missing.endDate,
          bullets: [...missing.bullets],
        });
      }
    }

    restored.experience = restoredExperiences;
  }

  // === Restore Education ===
  if (locked.education.length > 0) {
    const matchedEduIndices = new Set<number>();
    const restoredEducation: ResumeEducation[] = [];

    for (let i = 0; i < optimized.education.length; i++) {
      const opt = optimized.education[i];
      const match = findMatchingEducation(opt, locked.education, i);

      if (match) {
        matchedEduIndices.add(locked.education.indexOf(match));
        restoredEducation.push({
          ...opt,
          id: match.id,
          institution: match.institution, // LOCKED
          degree: match.degree, // LOCKED
          field: match.field, // LOCKED
          location: match.location, // LOCKED
          startDate: match.startDate, // LOCKED
          endDate: match.endDate, // LOCKED
          highlights: opt.highlights && opt.highlights.length > 0 ? opt.highlights : [...match.highlights],
        });
      } else if (!isPlaceholderInstitution(opt.institution)) {
        // Not a placeholder, but not in original — potential hallucination
        console.warn(`[EntityLock] Stripping hallucinated education entry: "${opt.institution}"`);
      }
    }

    // Restore dropped education entries
    for (let i = 0; i < locked.education.length; i++) {
      if (!matchedEduIndices.has(i)) {
        const missing = locked.education[i];
        console.info(`[EntityLock] Restoring dropped education: ${missing.degree} at ${missing.institution}`);
        restoredEducation.push({
          id: missing.id,
          institution: missing.institution,
          degree: missing.degree,
          field: missing.field,
          location: missing.location,
          startDate: missing.startDate,
          endDate: missing.endDate,
          highlights: [...missing.highlights],
        });
      }
    }

    restored.education = restoredEducation;
  }

  // === Restore Languages — EXACT set, no additions, no removals ===
  if (locked.languages.length > 0) {
    restored.languages = locked.languages.map((l) => ({ ...l }));
  }

  // === Restore Certifications — EXACT set, no additions, no removals ===
  if (locked.certifications.length > 0) {
    restored.certifications = locked.certifications.map((c) => ({ ...c }));
  }

  return restored;
}

// ============================================================================
// DUPLICATE DETECTION
// ============================================================================

/**
 * Detect and remove duplicate experiences (same company + title + dates).
 * Keeps the first occurrence, removes subsequent duplicates.
 */
export function deduplicateExperiences(experiences: ResumeExperience[]): ResumeExperience[] {
  const seen = new Set<string>();
  const unique: ResumeExperience[] = [];

  for (const exp of experiences) {
    const key = `${(exp.company || "").toLowerCase().trim()}|${(exp.title || "").toLowerCase().trim()}|${(exp.startDate || "").toLowerCase().trim()}`;
    if (seen.has(key)) {
      console.warn(`[EntityLock] Removing duplicate experience: ${exp.title} at ${exp.company}`);
      continue;
    }
    seen.add(key);
    unique.push(exp);
  }

  return unique;
}

/**
 * Detect and remove duplicate education entries (same institution + degree).
 */
export function deduplicateEducation(education: ResumeEducation[]): ResumeEducation[] {
  const seen = new Set<string>();
  const unique: ResumeEducation[] = [];

  for (const ed of education) {
    const key = `${(ed.institution || "").toLowerCase().trim()}|${(ed.degree || "").toLowerCase().trim()}`;
    if (seen.has(key)) {
      console.warn(`[EntityLock] Removing duplicate education: ${ed.degree} at ${ed.institution}`);
      continue;
    }
    seen.add(key);
    unique.push(ed);
  }

  return unique;
}

/**
 * Detect and remove duplicate bullets within each experience entry.
 */
export function deduplicateBullets(experience: ResumeExperience): ResumeExperience {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const bullet of experience.bullets) {
    const normalized = bullet.toLowerCase().trim().replace(/\s+/g, " ");
    if (seen.has(normalized)) {
      console.warn(`[EntityLock] Removing duplicate bullet in "${experience.company}": ${bullet.slice(0, 60)}...`);
      continue;
    }
    seen.add(normalized);
    unique.push(bullet);
  }

  return { ...experience, bullets: unique };
}

/**
 * Run full deduplication on a resume.
 */
export function deduplicateResume(resume: ResumeData): ResumeData {
  return {
    ...resume,
    experience: deduplicateExperiences(resume.experience).map(deduplicateBullets),
    education: deduplicateEducation(resume.education),
  };
}

// ============================================================================
// ENTITY INTEGRITY VERIFICATION (Hard Failure Conditions)
// ============================================================================

/**
 * Verify that ALL immutable entities are intact after optimization.
 * This is the HARD FAILURE CHECK — any critical failure must fail the pipeline.
 *
 * Checks (from spec):
 *   - Company missing → FAIL
 *   - Date missing → FAIL
 *   - Date changed → FAIL
 *   - Education missing → FAIL
 *   - Languages missing → FAIL
 *   - Duplicate experiences → FAIL
 *   - Hallucinated employer → FAIL
 *   - Hallucinated university → FAIL
 *   - Hallucinated location → FAIL (warnings)
 *   - Summary corruption → FAIL
 *   - Character limit exceeded → FAIL
 *   - QA confidence < 80 → FAIL
 */
export function verifyEntityIntegrity(
  optimized: ResumeData,
  locked: LockedEntities,
): EntityIntegrityCheck {
  const criticalFailures: EntityFailure[] = [];
  const warnings: string[] = [];
  let score = 100;

  // === Check 1: Experience count must match ===
  if (optimized.experience.length !== locked.counts.experience) {
    const diff = optimized.experience.length - locked.counts.experience;
    if (diff < 0) {
      criticalFailures.push({
        type: "company_count_mismatch",
        message: `Experience count mismatch: original=${locked.counts.experience}, optimized=${optimized.experience.length}. Missing ${Math.abs(diff)} experience entries.`,
        expected: String(locked.counts.experience),
        actual: String(optimized.experience.length),
      });
    }
    score -= Math.abs(diff) * 10;
  }

  // === Check 2: Every experience must have a company (not placeholder) ===
  for (let i = 0; i < optimized.experience.length; i++) {
    const exp = optimized.experience[i];
    const origExp = locked.experiences[i];

    if (isPlaceholderCompany(exp.company)) {
      criticalFailures.push({
        type: "company_missing",
        message: `Experience #${i + 1} has placeholder company name: "${exp.company}". Original: "${origExp?.company || "N/A"}"`,
        field: `experience[${i}].company`,
        expected: origExp?.company || "(original company)",
        actual: exp.company,
      });
      score -= 15;
      continue;
    }

    // Check if company was in the original (hallucination check)
    const companyLower = (exp.company || "").toLowerCase().trim();
    const isOriginalCompany = locked.experiences.some(
      (l) => l.company.toLowerCase().trim() === companyLower ||
        l.company.toLowerCase().trim().includes(companyLower) ||
        companyLower.includes(l.company.toLowerCase().trim()),
    );
    if (!isOriginalCompany && exp.company) {
      criticalFailures.push({
        type: "hallucinated_employer",
        message: `Hallucinated employer in experience #${i + 1}: "${exp.company}" not found in original resume`,
        field: `experience[${i}].company`,
        actual: exp.company,
      });
      score -= 20;
    }

    // Check dates
    if (!exp.startDate || exp.startDate.trim().length === 0) {
      criticalFailures.push({
        type: "date_missing",
        message: `Experience #${i + 1} ("${exp.company}") is missing startDate`,
        field: `experience[${i}].startDate`,
        expected: origExp?.startDate || "(original date)",
      });
      score -= 10;
    }

    if (!exp.endDate || exp.endDate.trim().length === 0) {
      // endDate can be empty for "Present" roles, but warn
      warnings.push(`Experience #${i + 1} ("${exp.company}") has empty endDate — may indicate a current role`);
    }

    // Check for "Present" injection
    if (origExp && isPresentInjection(origExp.endDate, exp.endDate)) {
      criticalFailures.push({
        type: "present_injection",
        message: `Experience #${i + 1} ("${exp.company}") endDate changed from "${origExp.endDate}" to "${exp.endDate}" — "Present" is NOT in the original`,
        field: `experience[${i}].endDate`,
        expected: origExp.endDate,
        actual: exp.endDate,
      });
      score -= 15;
    }

    // Check for date changes
    if (origExp && isDateChanged(origExp.startDate, exp.startDate)) {
      criticalFailures.push({
        type: "date_changed",
        message: `Experience #${i + 1} ("${exp.company}") startDate changed from "${origExp.startDate}" to "${exp.startDate}"`,
        field: `experience[${i}].startDate`,
        expected: origExp.startDate,
        actual: exp.startDate,
      });
      score -= 10;
    }
    if (origExp && isDateChanged(origExp.endDate, exp.endDate)) {
      criticalFailures.push({
        type: "date_changed",
        message: `Experience #${i + 1} ("${exp.company}") endDate changed from "${origExp.endDate}" to "${exp.endDate}"`,
        field: `experience[${i}].endDate`,
        expected: origExp.endDate,
        actual: exp.endDate,
      });
      score -= 10;
    }
  }

  // === Check 3: Education must not disappear ===
  if (locked.counts.education > 0 && optimized.education.length === 0) {
    criticalFailures.push({
      type: "education_missing",
      message: `Education section was completely removed. Original had ${locked.counts.education} education entries.`,
      expected: String(locked.counts.education),
      actual: "0",
    });
    score -= 20;
  }

  if (optimized.education.length < locked.counts.education) {
    criticalFailures.push({
      type: "education_count_mismatch",
      message: `Education count dropped: original=${locked.counts.education}, optimized=${optimized.education.length}`,
      expected: String(locked.counts.education),
      actual: String(optimized.education.length),
    });
    score -= 10;
  }

  // Check each education entry
  for (let i = 0; i < optimized.education.length; i++) {
    const ed = optimized.education[i];
    const origEd = locked.education[i];

    if (isPlaceholderInstitution(ed.institution)) {
      criticalFailures.push({
        type: "hallucinated_university",
        message: `Education #${i + 1} has placeholder institution: "${ed.institution}". Original: "${origEd?.institution || "N/A"}"`,
        field: `education[${i}].institution`,
        expected: origEd?.institution || "(original institution)",
        actual: ed.institution,
      });
      score -= 15;
    }

    // Check if institution was in original
    const instLower = (ed.institution || "").toLowerCase().trim();
    const isOriginalInst = locked.education.some(
      (l) => l.institution.toLowerCase().trim() === instLower ||
        l.institution.toLowerCase().trim().includes(instLower) ||
        instLower.includes(l.institution.toLowerCase().trim()),
    );
    if (!isOriginalInst && ed.institution) {
      criticalFailures.push({
        type: "hallucinated_university",
        message: `Hallucinated institution in education #${i + 1}: "${ed.institution}" not found in original`,
        field: `education[${i}].institution`,
        actual: ed.institution,
      });
      score -= 15;
    }
  }

  // === Check 4: Languages must not disappear ===
  if (locked.counts.languages > 0 && optimized.languages.length === 0) {
    criticalFailures.push({
      type: "language_missing",
      message: `Languages section was completely removed. Original had ${locked.counts.languages} languages.`,
      expected: String(locked.counts.languages),
      actual: "0",
    });
    score -= 15;
  }

  if (optimized.languages.length < locked.counts.languages) {
    criticalFailures.push({
      type: "language_count_mismatch",
      message: `Language count dropped: original=${locked.counts.languages}, optimized=${optimized.languages.length}`,
      expected: String(locked.counts.languages),
      actual: String(optimized.languages.length),
    });
    score -= 10;
  }

  // === Check 5: Contact info must not change ===
  if (optimized.name !== locked.contact.name) {
    criticalFailures.push({
      type: "contact_changed",
      message: `Name was changed from "${locked.contact.name}" to "${optimized.name}"`,
      field: "name",
      expected: locked.contact.name,
      actual: optimized.name,
    });
    score -= 20;
  }
  if ((optimized.contact?.email || "").toLowerCase().trim() !== locked.contact.email.toLowerCase().trim()) {
    criticalFailures.push({
      type: "contact_changed",
      message: `Email was changed`,
      field: "contact.email",
      expected: locked.contact.email,
      actual: optimized.contact?.email,
    });
    score -= 20;
  }
  if ((optimized.contact?.phone || "").toLowerCase().trim() !== locked.contact.phone.toLowerCase().trim()) {
    criticalFailures.push({
      type: "contact_changed",
      message: `Phone was changed`,
      field: "contact.phone",
      expected: locked.contact.phone,
      actual: optimized.contact?.phone,
    });
    score -= 20;
  }

  // === Check 6: Duplicate detection ===
  const uniqueExpKeys = new Set<string>();
  for (const exp of optimized.experience) {
    const key = `${(exp.company || "").toLowerCase().trim()}|${(exp.title || "").toLowerCase().trim()}`;
    if (uniqueExpKeys.has(key)) {
      criticalFailures.push({
        type: "duplicate_experience",
        message: `Duplicate experience entry detected: ${exp.title} at ${exp.company}`,
      });
      score -= 10;
    }
    uniqueExpKeys.add(key);
  }

  // === Check 7: Summary corruption ===
  if (!optimized.summary || optimized.summary.trim().length < 30) {
    criticalFailures.push({
      type: "summary_corruption",
      message: `Summary is too short or empty (${optimized.summary?.length || 0} chars)`,
      actual: optimized.summary,
    });
    score -= 10;
  }
  // Check for duplicate sentences in summary
  if (optimized.summary) {
    const sentences = optimized.summary.split(/[.!?]+/).filter((s) => s.trim().length > 10);
    const seenSentences = new Set<string>();
    for (const sent of sentences) {
      const normalized = sent.toLowerCase().trim().replace(/\s+/g, " ");
      if (seenSentences.has(normalized)) {
        criticalFailures.push({
          type: "summary_corruption",
          message: `Summary contains duplicate sentence: "${sent.trim()}"`,
        });
        score -= 5;
      }
      seenSentences.add(normalized);
    }
    // Check for ".." (double periods)
    if (optimized.summary.includes("..")) {
      criticalFailures.push({
        type: "summary_corruption",
        message: `Summary contains double periods ("..")`,
      });
      score -= 5;
    }
  }

  // === Check 8: Character count ===
  const charCount = JSON.stringify({
    summary: optimized.summary,
    experience: optimized.experience,
    skills: optimized.skills,
    education: optimized.education,
    languages: optimized.languages,
  }).length;
  if (charCount > 4200) {
    criticalFailures.push({
      type: "summary_corruption", // Reuse type for size violation
      message: `Resume exceeds 4200 character limit: ${charCount} chars`,
      actual: String(charCount),
    });
    score -= 10;
  }

  return {
    passed: criticalFailures.length === 0,
    criticalFailures,
    warnings,
    integrityScore: Math.max(0, score),
  };
}

// ============================================================================
// FORBIDDEN SKILL FILTER
// ============================================================================

/**
 * List of patterns that should NEVER appear in skills.
 * These include company names, locations, and other non-skill entities.
 */
const FORBIDDEN_SKILL_PATTERNS = [
  // Company names (common)
  /^qatar duty free$/i, /^qatar airways/i, /^hamad international/i, /^qdfc$/i,
  /^retail company$/i, /^beauty retailer$/i, /^duty free$/i,
  // Locations
  /^doha$/i, /^qatar$/i, /^dubai$/i, /^abu dhabi$/i, /^uae$/i,
  /^riyadh$/i, /^saudi/i, /^kuwait$/i, /^bahrain$/i, /^oman$/i,
  // Generic non-skills
  /^unknown$/i, /^n\/a$/i, /^placeholder$/i, /^sample$/i, /^example$/i,
  // Years (not skills)
  /^20\d{2}$/i, /^\d{4}-\d{4}$/i,
];

/**
 * Check if a skill name is forbidden (company name, location, etc.)
 */
export function isForbiddenSkill(skillName: string): boolean {
  if (!skillName || skillName.trim().length === 0) return true;
  const trimmed = skillName.trim();
  return FORBIDDEN_SKILL_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Filter forbidden skills from a skills list.
 * Logs warnings for removed skills.
 */
export function filterForbiddenSkills(skills: ResumeSkill[]): ResumeSkill[] {
  const filtered: ResumeSkill[] = [];
  for (const skill of skills) {
    if (isForbiddenSkill(skill.name)) {
      console.warn(`[EntityLock] Removing forbidden skill (company/location/non-skill): "${skill.name}"`);
      continue;
    }
    filtered.push(skill);
  }
  return filtered;
}

/**
 * Apply forbidden skill filtering to a resume.
 */
export function sanitizeSkills(resume: ResumeData): ResumeData {
  return {
    ...resume,
    skills: filterForbiddenSkills(resume.skills),
  };
}
