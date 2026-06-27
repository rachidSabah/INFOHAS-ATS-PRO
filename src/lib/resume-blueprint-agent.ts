// ============================================================================
// Resume Blueprint Agent — Immutable Blueprint Capture & Diff for Resume Optimization
//
// PURPOSE:
//   Freeze original resume into immutable structured data BEFORE optimization.
//   No downstream agent may modify these entities.
//   Provides a diff function to detect what the optimizer changed.
//
// KEY CONCEPTS:
//   - Blueprint: A snapshot of ALL immutable entities from the original resume
//   - Diff: Flags specific changes between original blueprint and optimized result
//   - Fingerprint: Uses computeExperienceFingerprint from experience-fingerprint.ts
//     for stable matching of experience entries across optimization
//
// IMMUTABLE ENTITIES (ALL frozen, never modified by downstream agents):
//   - header: name, title, phone, email, location, links
//   - summary: original summary text
//   - experience: company, dates, location, role, bullets
//   - education: institution, degree, field, dates, gpa
//   - skills: names, levels, keywords
//   - languages: language and proficiency
//   - additionalInformation: certifications, projects, achievements, source
//
// USAGE:
//   const blueprint = extractBlueprint(originalResume);
//   // ... run AI optimization ...
//   const diff = compareBlueprint(blueprint, optimizedResume);
//   if (diff.hasChanges) {
//     console.warn("[ResumeBlueprint] Changes detected:", diff);
//   }
// ============================================================================

import type { ResumeData, ResumeExperience, ResumeEducation } from "./types";
import { computeExperienceFingerprint } from "./experience-fingerprint";

// ============================================================================
// Types
// ============================================================================

/**
 * ResumeBlueprint — immutable structured representation of the original resume.
 *
 * All fields are extracted from the ResumeData input and frozen.
 * No downstream agent may modify any field in this structure.
 */
export interface ResumeBlueprint {
  /** Contact header — NEVER changes */
  header: {
    name: string;
    title: string;
    phone: string;
    email: string;
    location: string;
    links: Record<string, string>;
  };
  /** Original summary text (may be optimized for length, but meaning is preserved) */
  summary: string;
  /** Experience entries — ALL fields are immutable */
  experience: Array<{
    id: string;
    role: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    bullets: string[];
    highlights: string[];
    companyDescription: string;
  }>;
  /** Education entries — ALL fields are immutable */
  education: Array<{
    id: string;
    institution: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string;
    gpa: string;
  }>;
  /** Skills — names, levels, and associated keywords */
  skills: Array<{
    name: string;
    level: string;
    keywords: string[];
  }>;
  /** Languages — NEVER added or removed */
  languages: Array<{
    language: string;
    proficiency: string;
  }>;
  /** Additional information — certifications, projects, achievements, etc. */
  additionalInformation: Record<string, any>;
}

/**
 * BlueprintDiff — detailed report of what changed between the original blueprint
 * and the optimized resume.
 */
export interface BlueprintDiff {
  /** Employers found in optimized resume that were NOT in the original */
  hallucinatedEmployers: Array<{
    name: string;
    inOptimized: boolean;
    inOriginal: boolean;
  }>;
  /** Schools found in optimized resume that were NOT in the original */
  hallucinatedSchools: Array<{
    name: string;
    inOptimized: boolean;
    inOriginal: boolean;
  }>;
  /** Companies from the original that are MISSING from the optimized resume */
  missingCompanies: Array<{
    name: string;
    reason: string;
  }>;
  /** Dates that were changed between original and optimized */
  missingDates: Array<{
    field: string;
    original: string;
    optimized: string;
  }>;
  /** Education fields that were corrupted/changed */
  corruptedEducation: Array<{
    field: string;
    original: string;
    optimized: string;
  }>;
  /** Languages that were added or corrupted */
  corruptedLanguages: Array<{
    original: string;
    optimized: string;
    issue: string;
  }>;
  /** True if ANY change was detected */
  hasChanges: boolean;
}

// ============================================================================
// LINK EXTRACTION
// ============================================================================

/**
 * Extract all known links from contact info into a flat record.
 */
function extractLinks(contact: ResumeData["contact"]): Record<string, string> {
  const links: Record<string, string> = {};
  if (contact?.website) links.website = contact.website;
  if (contact?.linkedin) links.linkedin = contact.linkedin;
  if (contact?.github) links.github = contact.github;
  if (contact?.twitter) links.twitter = contact.twitter;
  return links;
}

// ============================================================================
// BLUEPRINT EXTRACTION (Pre-Optimization)
// ============================================================================

/**
 * Extract ALL immutable entities from the original resume into a structured blueprint.
 *
 * Call this BEFORE optimization. Store the result for later comparison.
 * No downstream agent may modify these values.
 *
 * @param resume - The original ResumeData to extract entities from
 * @returns A complete ResumeBlueprint with all immutable entities frozen
 */
export function extractBlueprint(resume: ResumeData): ResumeBlueprint {
  // --- Header ---
  const header: ResumeBlueprint["header"] = {
    name: resume.name || "",
    title: resume.headline || "",
    phone: resume.contact?.phone || "",
    email: resume.contact?.email || "",
    location: resume.contact?.location || "",
    links: extractLinks(resume.contact),
  };

  // --- Experience ---
  const experience: ResumeBlueprint["experience"] = resume.experience.map(
    (exp: ResumeExperience) => ({
      id: exp.id,
      role: exp.title || "",
      company: exp.company || "",
      location: exp.location || "",
      startDate: exp.startDate || "",
      endDate: exp.endDate || "",
      bullets: [...(exp.bullets || [])],
      // Use old_bullets as highlights (they represent original bullet content
      // that was replaced by AI-optimized bullets)
      highlights: [...(exp.old_bullets || [])],
      // Company description is not part of ResumeExperience type;
      // default to empty string in the blueprint
      companyDescription: "",
    }),
  );

  // --- Education ---
  const education: ResumeBlueprint["education"] = resume.education.map(
    (edu: ResumeEducation) => ({
      id: edu.id,
      institution: edu.institution || "",
      degree: edu.degree || "",
      field: edu.field || "",
      startDate: edu.startDate || "",
      endDate: edu.endDate || "",
      gpa: edu.gpa || "",
    }),
  );

  // --- Skills ---
  const skills: ResumeBlueprint["skills"] = resume.skills.map((skill) => ({
    name: skill.name || "",
    level: skill.level || "",
    keywords: [skill.name || ""].filter(Boolean),
  }));

  // --- Languages ---
  const languages: ResumeBlueprint["languages"] = resume.languages.map(
    (lang) => ({
      language: lang.name || "",
      proficiency: lang.proficiency || "fluent",
    }),
  );

  // --- Additional Information ---
  const additionalInformation: Record<string, any> = {};

  if (resume.certifications && resume.certifications.length > 0) {
    additionalInformation.certifications = resume.certifications.map((c) => ({
      ...c,
    }));
  }

  if (resume.projects && resume.projects.length > 0) {
    additionalInformation.projects = resume.projects.map((p) => ({
      ...p,
    }));
  }

  if (resume.achievements && resume.achievements.length > 0) {
    additionalInformation.achievements = [...resume.achievements];
  }

  if (resume.source) {
    additionalInformation.source = resume.source;
  }

  // Include any other top-level metadata that might be useful
  if (resume.template) {
    additionalInformation.template = resume.template;
  }

  if (resume.dateOfBirth) {
    additionalInformation.dateOfBirth = resume.dateOfBirth;
  }

  return {
    header,
    summary: resume.summary || "",
    experience,
    education,
    skills,
    languages,
    additionalInformation,
  };
}

// ============================================================================
// STRING NORMALIZATION HELPERS
// ============================================================================

/** Normalize a string for comparison: lowercase, trim, collapse whitespace */
function normalizeStr(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Check if two strings match exactly after normalization */
function normalizedEqual(a: string, b: string): boolean {
  return normalizeStr(a) === normalizeStr(b);
}

/** Check if a company name appears in the original experience list */
function isCompanyInOriginal(
  company: string,
  originalExperiences: ResumeBlueprint["experience"],
): boolean {
  const needle = normalizeStr(company);
  if (!needle) return true; // Empty company is trivially "in original"
  return originalExperiences.some((oe) => {
    const candidate = normalizeStr(oe.company);
    return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
  });
}

/** Check if an institution name appears in the original education list */
function isInstitutionInOriginal(
  institution: string,
  originalEducation: ResumeBlueprint["education"],
): boolean {
  const needle = normalizeStr(institution);
  if (!needle) return true;
  return originalEducation.some((oe) => {
    const candidate = normalizeStr(oe.institution);
    return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
  });
}

// ============================================================================
// BLUEPRINT COMPARISON (Post-Optimization)
// ============================================================================

/**
 * Compare the original blueprint against the optimized resume.
 * Flags all changes that could indicate hallucination, corruption, or data loss.
 *
 * @param original - The blueprint extracted BEFORE optimization
 * @param optimized - The ResumeData returned AFTER optimization
 * @returns A BlueprintDiff detailing every change detected
 */
export function compareBlueprint(
  original: ResumeBlueprint,
  optimized: ResumeData,
): BlueprintDiff {
  const hallucinatedEmployers: BlueprintDiff["hallucinatedEmployers"] = [];
  const hallucinatedSchools: BlueprintDiff["hallucinatedSchools"] = [];
  const missingCompanies: BlueprintDiff["missingCompanies"] = [];
  const missingDates: BlueprintDiff["missingDates"] = [];
  const corruptedEducation: BlueprintDiff["corruptedEducation"] = [];
  const corruptedLanguages: BlueprintDiff["corruptedLanguages"] = [];

  // ========================================================================
  // 1. Experience: Hallucinated Employers & Missing Companies
  // ========================================================================

  // Track which original companies have been matched in optimized
  const matchedOriginalCompanies = new Set<string>();

  for (const optExp of optimized.experience) {
    const optCompany = optExp.company || "";

    // Check if this company is in the original
    const foundInOriginal = isCompanyInOriginal(optCompany, original.experience);

    if (!foundInOriginal && normalizeStr(optCompany).length > 0) {
      // Employer exists in optimized but NOT in original => hallucination
      hallucinatedEmployers.push({
        name: optCompany,
        inOptimized: true,
        inOriginal: false,
      });
    } else if (foundInOriginal) {
      // Mark this original company as matched
      const match = original.experience.find((oe) =>
        normalizedEqual(oe.company, optCompany) ||
        normalizeStr(oe.company).includes(normalizeStr(optCompany)) ||
        normalizeStr(optCompany).includes(normalizeStr(oe.company)),
      );
      if (match) {
        matchedOriginalCompanies.add(normalizeStr(match.company));
      }
    }

    // Check for date changes (only if we can find the matching original)
    const matchingOriginal = original.experience.find((oe) =>
      normalizedEqual(oe.company, optCompany) ||
      normalizeStr(oe.company).includes(normalizeStr(optCompany)) ||
      normalizeStr(optCompany).includes(normalizeStr(oe.company)),
    );

    if (matchingOriginal) {
      if (
        optExp.startDate &&
        matchingOriginal.startDate &&
        !normalizedEqual(optExp.startDate, matchingOriginal.startDate)
      ) {
        missingDates.push({
          field: `experience[${optExp.id || matchingOriginal.id}].startDate`,
          original: matchingOriginal.startDate,
          optimized: optExp.startDate,
        });
      }
      if (
        optExp.endDate &&
        matchingOriginal.endDate &&
        !normalizedEqual(optExp.endDate, matchingOriginal.endDate)
      ) {
        missingDates.push({
          field: `experience[${optExp.id || matchingOriginal.id}].endDate`,
          original: matchingOriginal.endDate,
          optimized: optExp.endDate,
        });
      }
    }
  }

  // Find companies in original that are missing from optimized
  for (const origExp of original.experience) {
    if (!matchedOriginalCompanies.has(normalizeStr(origExp.company))) {
      // Double-check with fingerprint matching for robust detection
      const origFp = computeExperienceFingerprint({
        title: origExp.role,
        company: origExp.company,
        location: origExp.location,
        startDate: origExp.startDate,
        endDate: origExp.endDate,
      });
      const foundByFingerprint = optimized.experience.some((optExp) => {
        const optFp = computeExperienceFingerprint(optExp);
        return optFp === origFp;
      });

      if (!foundByFingerprint) {
        missingCompanies.push({
          name: origExp.company,
          reason: `Original company "${origExp.company}" (role: "${origExp.role}") not found in optimized resume by name or fingerprint`,
        });
      }
    }
  }

  // ========================================================================
  // 2. Education: Hallucinated Schools & Corrupted Fields
  // ========================================================================

  const matchedOriginalInstitutions = new Set<string>();

  for (const optEdu of optimized.education) {
    const optInst = optEdu.institution || "";

    // Check if this institution is in the original
    const foundInOriginal = isInstitutionInOriginal(optInst, original.education);

    if (!foundInOriginal && normalizeStr(optInst).length > 0) {
      hallucinatedSchools.push({
        name: optInst,
        inOptimized: true,
        inOriginal: false,
      });
    } else if (foundInOriginal) {
      const match = original.education.find((oe) =>
        normalizedEqual(oe.institution, optInst) ||
        normalizeStr(oe.institution).includes(normalizeStr(optInst)) ||
        normalizeStr(optInst).includes(normalizeStr(oe.institution)),
      );
      if (match) {
        matchedOriginalInstitutions.add(normalizeStr(match.institution));
      }
    }

    // Check for field corruption (degree/field changes)
    const matchingOriginal = original.education.find((oe) =>
      normalizedEqual(oe.institution, optInst) ||
      normalizeStr(oe.institution).includes(normalizeStr(optInst)) ||
      normalizeStr(optInst).includes(normalizeStr(oe.institution)),
    );

    if (matchingOriginal) {
      if (
        optEdu.degree &&
        matchingOriginal.degree &&
        !normalizedEqual(optEdu.degree, matchingOriginal.degree)
      ) {
        corruptedEducation.push({
          field: `education[${optEdu.id || matchingOriginal.id}].degree`,
          original: matchingOriginal.degree,
          optimized: optEdu.degree,
        });
      }
      if (
        optEdu.field &&
        matchingOriginal.field &&
        !normalizedEqual(optEdu.field, matchingOriginal.field)
      ) {
        corruptedEducation.push({
          field: `education[${optEdu.id || matchingOriginal.id}].field`,
          original: matchingOriginal.field,
          optimized: optEdu.field,
        });
      }
    }
  }

  // ========================================================================
  // 3. Languages: Corrupted / Added / Removed
  // ========================================================================

  const originalLanguageNames = new Set(
    original.languages.map((l) => normalizeStr(l.language)),
  );

  for (const optLang of optimized.languages) {
    const langName = optLang.name || "";
    const normalizedLang = normalizeStr(langName);

    if (!originalLanguageNames.has(normalizedLang) && normalizedLang.length > 0) {
      corruptedLanguages.push({
        original: "(not in original)",
        optimized: langName,
        issue: `Language "${langName}" found in optimized resume but not in original blueprint`,
      });
    }
  }

  // Check for removed languages
  const optimizedLanguageNames = new Set(
    optimized.languages.map((l) => normalizeStr(l.name || "")),
  );

  for (const origLang of original.languages) {
    if (!optimizedLanguageNames.has(normalizeStr(origLang.language))) {
      corruptedLanguages.push({
        original: origLang.language,
        optimized: "(removed)",
        issue: `Language "${origLang.language}" present in original blueprint but missing from optimized resume`,
      });
    }
  }

  // ========================================================================
  // Result
  // ========================================================================

  const hasChanges =
    hallucinatedEmployers.length > 0 ||
    hallucinatedSchools.length > 0 ||
    missingCompanies.length > 0 ||
    missingDates.length > 0 ||
    corruptedEducation.length > 0 ||
    corruptedLanguages.length > 0;

  return {
    hallucinatedEmployers,
    hallucinatedSchools,
    missingCompanies,
    missingDates,
    corruptedEducation,
    corruptedLanguages,
    hasChanges,
  };
}
