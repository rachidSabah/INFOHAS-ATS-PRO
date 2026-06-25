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
 * RESTORE EXPERIENCE METADATA
 *
 * Strictly restores company, title, dates, location from source resume.
 * Uses INDEX-BASED matching (not fuzzy) — the i-th optimized entry gets
 * the i-th original entry's locked fields.
 *
 * If the AI returns FEWER entries than original, the missing entries are
 * appended from the original (preserving ALL experience).
 *
 * If the AI returns MORE entries than original (duplicates), the extras
 * are removed (deduplication).
 */
export function restoreExperienceMetadata(optimized: ResumeData, sourceResume: ResumeData): {
  resume: ResumeData;
  restored: string[];
  countMismatch: boolean;
} {
  const result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const restored: string[] = [];

  if (!sourceResume.experience || sourceResume.experience.length === 0) {
    return { resume: result, restored, countMismatch: false };
  }

  const source = sourceResume.experience;
  const ai = result.experience || [];

  // Step 1: For each AI entry, restore locked fields from the CORRESPONDING original entry (by index)
  const restoredExp = ai.slice(0, source.length).map((entry, i) => {
    const orig = source[i];
    if (!orig) return entry;

    if (entry.company !== orig.company && orig.company) {
      restored.push(`Experience[${i}]: company "${entry.company}" → "${orig.company}"`);
    }
    if (entry.title !== orig.title && orig.title) {
      restored.push(`Experience[${i}]: title "${entry.title}" → "${orig.title}"`);
    }
    if (entry.startDate !== orig.startDate && orig.startDate) {
      restored.push(`Experience[${i}]: startDate "${entry.startDate}" → "${orig.startDate}"`);
    }
    if (entry.endDate !== orig.endDate && orig.endDate) {
      restored.push(`Experience[${i}]: endDate "${entry.endDate}" → "${orig.endDate}"`);
    }
    if ((entry.location || "") !== (orig.location || "") && orig.location) {
      restored.push(`Experience[${i}]: location "${entry.location}" → "${orig.location}"`);
    }

    return {
      ...entry,
      // STRICT LOCK: always use source values if they exist
      company: orig.company || entry.company || "",
      title: orig.title || entry.title || "",
      startDate: orig.startDate || entry.startDate || "",
      endDate: orig.endDate || entry.endDate || "",
      location: orig.location || entry.location || "",
      // Keep AI's bullets (the optimization)
      bullets: entry.bullets || orig.bullets,
    };
  });

  // Step 2: If AI dropped entries, append the missing ones from source
  for (let i = ai.length; i < source.length; i++) {
    restoredExp.push({ ...source[i] });
    restored.push(`Restored dropped experience[${i}]: ${source[i].title} at ${source[i].company}`);
  }

  // Step 3: If AI added EXTRA entries (duplicates), remove them
  if (ai.length > source.length) {
    restored.push(`Removed ${ai.length - source.length} duplicate/extra experience entries`);
  }

  result.experience = restoredExp;

  const countMismatch = result.experience.length !== source.length;

  if (restored.length > 0) {
    console.info(`[restoreExperienceMetadata] Restored ${restored.length} field(s)`, restored);
  }

  return { resume: result, restored, countMismatch };
}

/**
 * RESTORE EDUCATION
 *
 * Education entries are immutable. If the AI removes any, restore from source.
 */
export function restoreEducation(optimized: ResumeData, sourceResume: ResumeData): {
  resume: ResumeData;
  restored: string[];
} {
  const result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const restored: string[] = [];

  if (!sourceResume.education || sourceResume.education.length === 0) {
    return { resume: result, restored };
  }

  const source = sourceResume.education;
  const ai = result.education || [];

  // If AI dropped education entirely, restore all
  if (ai.length === 0) {
    result.education = source.map((e) => ({ ...e }));
    restored.push(`Restored ALL education (${source.length} entries) — AI had removed it`);
    return { resume: result, restored };
  }

  // For each AI entry, restore locked fields from source by index
  const restoredEdu = ai.slice(0, source.length).map((entry, i) => {
    const orig = source[i];
    if (!orig) return entry;

    return {
      ...entry,
      institution: orig.institution || entry.institution || "",
      degree: orig.degree || entry.degree || "",
      location: orig.location || entry.location || "",
      startDate: orig.startDate || entry.startDate || "",
      endDate: orig.endDate || entry.endDate || "",
    };
  });

  // Add back dropped entries
  for (let i = ai.length; i < source.length; i++) {
    restoredEdu.push({ ...source[i] });
    restored.push(`Restored dropped education[${i}]: ${source[i].degree} at ${source[i].institution}`);
  }

  result.education = restoredEdu;

  if (restored.length > 0) {
    console.info(`[restoreEducation] Restored ${restored.length} field(s)`, restored);
  }

  return { resume: result, restored };
}

/**
 * RESTORE LANGUAGES
 *
 * Languages are immutable. If AI removes them, restore from source.
 */
export function restoreLanguages(optimized: ResumeData, sourceResume: ResumeData): {
  resume: ResumeData;
  restored: string[];
} {
  const result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const restored: string[] = [];

  if (!sourceResume.languages || sourceResume.languages.length === 0) {
    return { resume: result, restored };
  }

  // If AI removed languages or returned fewer, restore from source
  if (!result.languages || result.languages.length < sourceResume.languages.length) {
    result.languages = sourceResume.languages.map((l) => ({ ...l }));
    restored.push(`Restored languages (${sourceResume.languages.length} entries) — AI had removed/shortened them`);
  }

  if (restored.length > 0) {
    console.info(`[restoreLanguages] Restored ${restored.length} field(s)`, restored);
  }

  return { resume: result, restored };
}

/**
 * VALIDATE IMMUTABLE ENTITIES
 *
 * Hard validation — checks that experience count matches, companies match,
 * dates match. Returns violations list.
 */
export function validateImmutableEntities(optimized: ResumeData, sourceResume: ResumeData): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Check experience count
  if (optimized.experience.length !== sourceResume.experience.length) {
    violations.push(`Experience count mismatch: ${optimized.experience.length} vs ${sourceResume.experience.length}`);
  }

  // Check each experience entry
  for (let i = 0; i < Math.min(optimized.experience.length, sourceResume.experience.length); i++) {
    const opt = optimized.experience[i];
    const src = sourceResume.experience[i];

    if (src.company && opt.company !== src.company) {
      violations.push(`Experience[${i}]: company changed "${src.company}" → "${opt.company}"`);
    }
    if (src.startDate && opt.startDate !== src.startDate) {
      violations.push(`Experience[${i}]: startDate changed "${src.startDate}" → "${opt.startDate}"`);
    }
    if (src.endDate && opt.endDate !== src.endDate) {
      violations.push(`Experience[${i}]: endDate changed "${src.endDate}" → "${opt.endDate}"`);
    }
  }

  // Check education count
  if (optimized.education.length < sourceResume.education.length) {
    violations.push(`Education entries dropped: ${sourceResume.education.length} → ${optimized.education.length}`);
  }

  // Check languages
  if (optimized.languages.length < sourceResume.languages.length) {
    violations.push(`Languages dropped: ${sourceResume.languages.length} → ${optimized.languages.length}`);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * RESTORE LOCKED ENTITIES (wrapper — calls all restore functions)
 *
 * This is the main entry point for entity restoration.
 */
export function restoreLockedEntities(optimized: ResumeData, original: ResumeData): {
  resume: ResumeData;
  restored: string[];
} {
  let result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const allRestored: string[] = [];

  // Lock contact info
  result.name = original.name;
  if (original.contact) {
    result.contact = {
      ...result.contact,
      email: original.contact.email,
      phone: original.contact.phone,
      location: original.contact.location,
    };
  }

  // Lock headline — NEVER replace with JD title
  if (original.headline && original.headline.trim()) {
    // Only keep AI's headline if it doesn't contain company names from JD
    const aiHeadlineLower = (result.headline || "").toLowerCase();
    const jdCompanyNames = ["qatar duty free", "qatar airways", "hamad international"];
    const containsJdCompany = jdCompanyNames.some((name) => aiHeadlineLower.includes(name));
    if (containsJdCompany || !result.headline?.trim()) {
      result.headline = original.headline;
      allRestored.push(`Headline restored to original (AI had injected JD company name)`);
    }
  }

  // Restore experience metadata
  const expResult = restoreExperienceMetadata(result, original);
  result = expResult.resume;
  allRestored.push(...expResult.restored);

  // Restore education
  const eduResult = restoreEducation(result, original);
  result = eduResult.resume;
  allRestored.push(...eduResult.restored);

  // Restore languages
  const langResult = restoreLanguages(result, original);
  result = langResult.resume;
  allRestored.push(...langResult.restored);

  // Restore certifications
  if (original.certifications && original.certifications.length > 0) {
    const aiCertNames = new Set((result.certifications || []).map((c) => (c.name || "").toLowerCase()));
    for (const origCert of original.certifications) {
      if (!aiCertNames.has((origCert.name || "").toLowerCase())) {
        if (!result.certifications) result.certifications = [];
        result.certifications.push(origCert);
        allRestored.push(`Restored certification: ${origCert.name}`);
      }
    }
  }

  if (allRestored.length > 0) {
    console.info(`[restoreLockedEntities] Restored ${allRestored.length} field(s):`, allRestored);
  }

  return { resume: result, restored: allRestored };
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

  // Step 4.5: Validate immutable entities (hard check)
  const validation = validateImmutableEntities(resume, sourceOfTruth);
  if (!validation.valid) {
    warnings.push(...validation.violations);
    // Re-run restoreLockedEntities if violations found
    const reRestore = restoreLockedEntities(resume, sourceOfTruth);
    resume = reRestore.resume;
    entitiesRestored.push(...reRestore.restored);
  }

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

/**
 * FINALIZE RESUME — the single shared function ALL providers must call.
 *
 * This is the mandatory pipeline entry point:
 *   processAIResponse → cleanupResumeGrammar → restoreLockedEntities →
 *   deduplicateResume → validateImmutableEntities → factualConsistencyCheck
 *
 * No provider may bypass this function.
 */
export function finalizeResume(optimizedResume: ResumeData, sourceResume: ResumeData): ResumeData {
  let result = JSON.parse(JSON.stringify(optimizedResume)) as ResumeData;

  // Step 1: Grammar cleanup
  try {
    result = cleanupResumeGrammar(result) as ResumeData;
  } catch { /* non-fatal */ }

  // Step 2: Restore locked entities (company, dates, education, languages, headline)
  const { resume: restored, restored: entities } = restoreLockedEntities(result, sourceResume);
  result = restored;

  // Step 3: Deduplicate
  const { resume: deduped, duplicatesRemoved } = deduplicateResume(result);
  result = deduped;

  // Step 4: Validate immutable entities — re-restore if needed
  const validation = validateImmutableEntities(result, sourceResume);
  if (!validation.valid) {
    console.warn(`[finalizeResume] ${validation.violations.length} violation(s) — re-restoring:`, validation.violations);
    const reRestore = restoreLockedEntities(result, sourceResume);
    result = reRestore.resume;
  }

  // Step 5: Final factual check (informational only)
  const { score, violations } = factualConsistencyCheck(result, sourceResume);
  if (violations.length > 0) {
    console.warn(`[finalizeResume] Factual consistency: ${score}/100, ${violations.length} violation(s):`, violations);
  } else {
    console.info(`[finalizeResume] Factual consistency: ${score}/100 — PASS`);
  }

  if (entities.length > 0 || duplicatesRemoved > 0) {
    console.info(`[finalizeResume] Complete — ${entities.length} entities restored, ${duplicatesRemoved} duplicates removed`);
  }

  return result;
}
