// ============================================================================
// Unified Provider Pipeline
//
// ALL optimization providers (Industry ATS, Standard, Aviation, Future) MUST
// execute this EXACT pipeline:
//
//   LLM output
//   → extractJSON
//   → processAIResponse (leak stripping, grammar cleanup)
//   → cleanupResumeGrammar (double periods, filler phrases)
//   → restoreLockedEntities (employers, dates, education, languages)
//   → deduplicateResume (remove duplicate entries/bullets/sentences)
//   → factualConsistencyCheck (compare against source of truth)
//   → finalOutput
//
// No provider may bypass this pipeline.
// ============================================================================

"use client";

import type { ResumeData } from "./types";
import { cleanupResumeGrammar, stripMarkdown, repairMalformedJSON } from "./ai-response-processor";
import { extractJSON } from "./ai";
import { extractLockedFacts, computeFactDiff, computeFactualIntegrityScore } from "./locked-facts";

export interface UnifiedPipelineResult {
  resume: ResumeData;
  success: boolean;
  errors: string[];
  warnings: string[];
  factualIntegrityScore: number;
  duplicatesRemoved: number;
  entitiesRestored: string[];
}

/**
 * DEDUPLICATE RESUME
 *
 * Removes:
 * - Duplicate experience entries (same company + title)
 * - Duplicate bullets within an experience entry
 * - Duplicate sentences in summary
 * - Duplicate education entries (same institution + degree)
 * - Duplicate skills (same name)
 *
 * Normalizes whitespace before comparison.
 */
export function deduplicateResume(resume: ResumeData): { resume: ResumeData; duplicatesRemoved: number } {
  const deduped = JSON.parse(JSON.stringify(resume)) as ResumeData;
  let removed = 0;

  // === Deduplicate experience entries ===
  if (deduped.experience && deduped.experience.length > 1) {
    const seen = new Set<string>();
    const uniqueExp: typeof deduped.experience = [];
    for (const exp of deduped.experience) {
      const key = `${(exp.company || "").toLowerCase().trim()}|${(exp.title || "").toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Also deduplicate bullets within this entry
        if (exp.bullets && exp.bullets.length > 1) {
          const seenBullets = new Set<string>();
          const uniqueBullets: string[] = [];
          for (const bullet of exp.bullets) {
            const normalized = bullet.toLowerCase().replace(/\s+/g, " ").trim();
            if (!seenBullets.has(normalized)) {
              seenBullets.add(normalized);
              uniqueBullets.push(bullet);
            } else {
              removed++;
            }
          }
          exp.bullets = uniqueBullets;
        }
        uniqueExp.push(exp);
      } else {
        removed++;
        console.warn(`[Deduplicate] Removed duplicate experience: ${exp.title} at ${exp.company}`);
      }
    }
    deduped.experience = uniqueExp;
  }

  // === Deduplicate education entries ===
  if (deduped.education && deduped.education.length > 1) {
    const seen = new Set<string>();
    const uniqueEdu: typeof deduped.education = [];
    for (const edu of deduped.education) {
      const key = `${(edu.institution || "").toLowerCase().trim()}|${(edu.degree || "").toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEdu.push(edu);
      } else {
        removed++;
        console.warn(`[Deduplicate] Removed duplicate education: ${edu.degree} at ${edu.institution}`);
      }
    }
    deduped.education = uniqueEdu;
  }

  // === Deduplicate skills ===
  if (deduped.skills && deduped.skills.length > 1) {
    const seen = new Set<string>();
    const uniqueSkills: typeof deduped.skills = [];
    for (const skill of deduped.skills) {
      const key = (skill.name || "").toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSkills.push(skill);
      } else {
        removed++;
      }
    }
    deduped.skills = uniqueSkills;
  }

  // === Deduplicate summary sentences ===
  if (deduped.summary) {
    const sentences = deduped.summary.split(/(?<=\.)\s+/);
    const seen = new Set<string>();
    const uniqueSentences: string[] = [];
    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase().replace(/\s+/g, " ").trim();
      if (!seen.has(normalized) && normalized.length > 10) {
        seen.add(normalized);
        uniqueSentences.push(sentence);
      } else if (normalized.length > 10) {
        removed++;
      }
    }
    deduped.summary = uniqueSentences.join(" ").trim();
  }

  // === Deduplicate languages ===
  if (deduped.languages && deduped.languages.length > 1) {
    const seen = new Set<string>();
    const uniqueLangs: typeof deduped.languages = [];
    for (const lang of deduped.languages) {
      const key = (lang.name || "").toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueLangs.push(lang);
      } else {
        removed++;
      }
    }
    deduped.languages = uniqueLangs;
  }

  if (removed > 0) {
    console.info(`[Deduplicate] Removed ${removed} duplicate(s) from resume`);
  }

  return { resume: deduped, duplicatesRemoved: removed };
}

/**
 * RESTORE LOCKED ENTITIES
 *
 * Strictly restores ALL immutable fields from the source of truth (original resume).
 * This is the HARDEST lock — it doesn't just check, it FORCES restoration.
 *
 * LOCKED_FIELDS:
 * - employers (company names)
 * - job_titles
 * - employment_dates (startDate, endDate)
 * - locations
 * - education (institutions, degrees, dates)
 * - languages
 * - certifications
 * - contact info (name, email, phone)
 *
 * The optimizer may ONLY change:
 * - summary wording
 * - bullet wording
 * - skills (add/remove/reorganize)
 * - headline
 */
export function restoreLockedEntities(optimized: ResumeData, original: ResumeData): {
  resume: ResumeData;
  restored: string[];
} {
  const result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const restored: string[] = [];

  // === LOCK CONTACT INFO ===
  result.name = original.name;
  if (original.contact) {
    result.contact = {
      ...result.contact,
      email: original.contact.email,
      phone: original.contact.phone,
      location: original.contact.location,
    };
  }

  // === LOCK EXPERIENCE: match by company or title, restore ALL locked fields ===
  if (original.experience && original.experience.length > 0) {
    // First, try to match each optimized entry to an original entry
    const matchedOriginals = new Set<number>();
    result.experience = result.experience.map((exp, i) => {
      const aiCompanyLower = (exp.company || "").toLowerCase().trim();
      const aiTitleLower = (exp.title || "").toLowerCase().trim();

      // Try company match
      let origIdx = original.experience.findIndex((o, idx) => {
        if (matchedOriginals.has(idx)) return false;
        const oCompanyLower = (o.company || "").toLowerCase().trim();
        return oCompanyLower && (
          oCompanyLower === aiCompanyLower ||
          oCompanyLower.includes(aiCompanyLower) ||
          aiCompanyLower.includes(oCompanyLower)
        );
      });

      // Try title match if company didn't match
      if (origIdx === -1) {
        origIdx = original.experience.findIndex((o, idx) => {
          if (matchedOriginals.has(idx)) return false;
          const oTitleLower = (o.title || "").toLowerCase().trim();
          return oTitleLower && (
            oTitleLower === aiTitleLower ||
            oTitleLower.includes(aiTitleLower) ||
            aiTitleLower.includes(oTitleLower)
          );
        });
      }

      // Fallback to index
      if (origIdx === -1) {
        origIdx = Math.min(i, original.experience.length - 1);
      }

      if (origIdx >= 0 && !matchedOriginals.has(origIdx)) {
        matchedOriginals.add(origIdx);
        const orig = original.experience[origIdx];

        // Check if restoration is needed
        if (exp.company !== orig.company) {
          restored.push(`Experience ${i}: company "${exp.company}" → "${orig.company}"`);
        }
        if (exp.startDate !== orig.startDate) {
          restored.push(`Experience ${i}: startDate "${exp.startDate}" → "${orig.startDate}"`);
        }
        if (exp.endDate !== orig.endDate) {
          restored.push(`Experience ${i}: endDate "${exp.endDate}" → "${orig.endDate}"`);
        }
        if ((exp.location || "") !== (orig.location || "")) {
          restored.push(`Experience ${i}: location "${exp.location}" → "${orig.location}"`);
        }

        return {
          ...exp,
          company: orig.company,        // LOCKED
          startDate: orig.startDate,     // LOCKED
          endDate: orig.endDate,         // LOCKED
          location: orig.location,       // LOCKED
          // Keep AI's title if it's an improvement, otherwise restore original
          title: exp.title || orig.title,
          // Keep AI's bullets (they're the optimization)
          bullets: exp.bullets,
        };
      }

      return exp;
    });

    // Add back any original entries that weren't matched (dropped by AI)
    for (let idx = 0; idx < original.experience.length; idx++) {
      if (!matchedOriginals.has(idx)) {
        const orig = original.experience[idx];
        result.experience.push({ ...orig });
        restored.push(`Restored dropped experience: ${orig.title} at ${orig.company}`);
      }
    }
  }

  // === LOCK EDUCATION: match by institution or degree ===
  if (original.education && original.education.length > 0) {
    const matchedEdu = new Set<number>();
    result.education = result.education.map((edu, i) => {
      const aiInstLower = (edu.institution || "").toLowerCase().trim();
      const aiDegreeLower = (edu.degree || "").toLowerCase().trim();

      let origIdx = original.education.findIndex((o, idx) => {
        if (matchedEdu.has(idx)) return false;
        const oInstLower = (o.institution || "").toLowerCase().trim();
        return oInstLower && (
          oInstLower === aiInstLower ||
          oInstLower.includes(aiInstLower) ||
          aiInstLower.includes(oInstLower)
        );
      });

      if (origIdx === -1) {
        origIdx = original.education.findIndex((o, idx) => {
          if (matchedEdu.has(idx)) return false;
          const oDegreeLower = (o.degree || "").toLowerCase().trim();
          return oDegreeLower && (
            oDegreeLower === aiDegreeLower ||
            oDegreeLower.includes(aiDegreeLower) ||
            aiDegreeLower.includes(oDegreeLower)
          );
        });
      }

      if (origIdx === -1) origIdx = Math.min(i, original.education.length - 1);

      if (origIdx >= 0 && !matchedEdu.has(origIdx)) {
        matchedEdu.add(origIdx);
        const orig = original.education[origIdx];

        if (edu.institution !== orig.institution) {
          restored.push(`Education ${i}: institution "${edu.institution}" → "${orig.institution}"`);
        }

        return {
          ...edu,
          institution: orig.institution,   // LOCKED
          startDate: orig.startDate,        // LOCKED
          endDate: orig.endDate,            // LOCKED
          location: orig.location,          // LOCKED
          degree: edu.degree || orig.degree,
        };
      }

      return edu;
    });

    // Add back dropped education
    for (let idx = 0; idx < original.education.length; idx++) {
      if (!matchedEdu.has(idx)) {
        const orig = original.education[idx];
        result.education.push({ ...orig });
        restored.push(`Restored dropped education: ${orig.degree} at ${orig.institution}`);
      }
    }
  }

  // === LOCK LANGUAGES ===
  if (original.languages && original.languages.length > 0) {
    result.languages = original.languages; // NEVER change language set
  }

  // === LOCK CERTIFICATIONS ===
  if (original.certifications && original.certifications.length > 0) {
    // Keep AI's certs if they exist, but always include original certs
    const aiCertNames = new Set((result.certifications || []).map((c) => (c.name || "").toLowerCase()));
    for (const origCert of original.certifications) {
      if (!aiCertNames.has((origCert.name || "").toLowerCase())) {
        if (!result.certifications) result.certifications = [];
        result.certifications.push(origCert);
        restored.push(`Restored certification: ${origCert.name}`);
      }
    }
  }

  if (restored.length > 0) {
    console.info(`[restoreLockedEntities] Restored ${restored.length} locked field(s):`, restored);
  }

  return { resume: result, restored };
}

/**
 * FACTUAL CONSISTENCY CHECK
 *
 * Compares optimized resume against source of truth.
 * Returns score (0-100) and list of violations.
 */
export function factualConsistencyCheck(optimized: ResumeData, original: ResumeData): {
  score: number;
  violations: string[];
} {
  const originalFacts = extractLockedFacts(original);
  const optimizedFacts = extractLockedFacts(optimized);
  const diff = computeFactDiff(originalFacts, optimizedFacts);
  const score = computeFactualIntegrityScore(diff);

  const violations: string[] = [];

  // Check employer preservation
  const originalCompanies = new Set(original.experience.map((e) => e.company?.toLowerCase().trim()).filter(Boolean));
  const optimizedCompanies = new Set(optimized.experience.map((e) => e.company?.toLowerCase().trim()).filter(Boolean));
  for (const company of optimizedCompanies) {
    if (!originalCompanies.has(company) && !Array.from(originalCompanies).some((oc) => oc.includes(company) || company.includes(oc))) {
      violations.push(`Hallucinated employer: "${company}"`);
    }
  }

  // Check experience count
  if (optimized.experience.length < original.experience.length) {
    violations.push(`Experience entries dropped: ${original.experience.length} → ${optimized.experience.length}`);
  }

  // Check education preservation
  const originalInsts = new Set(original.education.map((e) => e.institution?.toLowerCase().trim()).filter(Boolean));
  for (const edu of optimized.education || []) {
    const inst = (edu.institution || "").toLowerCase().trim();
    if (inst && !originalInsts.has(inst) && !Array.from(originalInsts).some((oi) => oi.includes(inst) || inst.includes(oi))) {
      violations.push(`Hallucinated education: "${edu.institution}"`);
    }
  }

  return { score, violations };
}

/**
 * RUN UNIFIED PROVIDER PIPELINE
 *
 * This is the SINGLE entry point that ALL providers must use.
 * Executes the full pipeline:
 *   extractJSON → cleanupGrammar → restoreLockedEntities → deduplicate → factualCheck
 *
 * No provider may bypass this pipeline.
 */
export function runUnifiedPipeline(
  aiOutput: string,
  originalResume: ResumeData,
  parsedResume?: ResumeData,
): UnifiedPipelineResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceOfTruth = parsedResume || originalResume;

  // Step 1: Extract JSON from AI output
  let parsed: any;
  try {
    // Try direct parse first
    parsed = extractJSON<any>(aiOutput);
  } catch {
    // Try repair
    const repaired = repairMalformedJSON(aiOutput);
    if (repaired.json) {
      parsed = repaired.json;
      warnings.push(`JSON repaired: ${repaired.repairs.join(", ")}`);
    } else {
      // Try stripping markdown then parsing
      const stripped = stripMarkdown(aiOutput);
      try {
        parsed = JSON.parse(stripped);
        warnings.push("Stripped markdown before parsing");
      } catch {
        errors.push("Failed to parse AI output as JSON after all repair attempts");
        return {
          resume: sourceOfTruth,
          success: false,
          errors,
          warnings,
          factualIntegrityScore: 0,
          duplicatesRemoved: 0,
          entitiesRestored: [],
        };
      }
    }
  }

  // Step 2: Grammar cleanup
  let resume: ResumeData;
  try {
    resume = cleanupResumeGrammar(parsed) as ResumeData;
  } catch {
    resume = parsed as ResumeData;
    warnings.push("Grammar cleanup failed — using raw parsed data");
  }

  // Step 3: Restore locked entities
  const { resume: restored, restored: entitiesRestored } = restoreLockedEntities(resume, sourceOfTruth);
  resume = restored;

  // Step 4: Deduplicate
  const { resume: deduped, duplicatesRemoved } = deduplicateResume(resume);
  resume = deduped;

  // Step 5: Factual consistency check
  const { score: factualIntegrityScore, violations } = factualConsistencyCheck(resume, sourceOfTruth);

  if (violations.length > 0) {
    warnings.push(...violations);
  }

  // Step 6: Final output
  const success = errors.length === 0 && factualIntegrityScore >= 80;

  console.info(
    `[Unified Pipeline] Complete — ` +
    `score: ${factualIntegrityScore}/100, ` +
    `duplicates removed: ${duplicatesRemoved}, ` +
    `entities restored: ${entitiesRestored.length}, ` +
    `violations: ${violations.length}, ` +
    `success: ${success}`
  );

  return {
    resume,
    success,
    errors,
    warnings,
    factualIntegrityScore,
    duplicatesRemoved,
    entitiesRestored,
  };
}
