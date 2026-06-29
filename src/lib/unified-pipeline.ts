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
import { cleanupResumeGrammar, stripMarkdown, repairMalformedJSON, filterForbiddenSkills, isForbiddenSkill } from "./ai-response-processor";
import { extractJSON } from "./ai";
import { extractLockedFacts, computeFactDiff, computeFactualIntegrityScore } from "./locked-facts";
import {
  findMatchingSourceEducation,
  findMatchingSourceLanguage,
  computeEducationFingerprint,
  computeLanguageFingerprint,
  validateEducationFingerprints,
  validateLanguageFingerprints,
  logEducationPipeline,
  logLanguagePipeline,
} from "./education-language-fingerprint";
import { computeExperienceFingerprint } from "./experience-fingerprint";

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
 * - Duplicate bullets within an experience entry (exact + fuzzy prefix match)
 * - Duplicate sentences in summary (exact + prefix match)
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
          const seenBulletPrefixes = new Set<string>();
          const uniqueBullets: string[] = [];
          for (const bullet of exp.bullets) {
            const normalized = bullet.toLowerCase().replace(/\s+/g, " ").trim();
            // Exact match check
            if (seenBullets.has(normalized)) {
              removed++;
              continue;
            }
            // Prefix match check — if a bullet starts with the same 60 chars as another, consider it a duplicate
            // (catches "Provided exceptional..." vs "Provided exceptional... in a fast-paced environment")
            const prefix = normalized.slice(0, 60);
            if (normalized.length > 60 && seenBulletPrefixes.has(prefix)) {
              removed++;
              continue;
            }
            // Suffix match check — if a bullet ENDS with the same 60 chars as another, consider it a duplicate
            // (catches bullets that have different preambles but same core content)
            const suffix = normalized.slice(-60);
            if (normalized.length > 60 && seenBullets.has(`__suffix__${suffix}`)) {
              removed++;
              continue;
            }
            seenBullets.add(normalized);
            if (normalized.length > 60) seenBulletPrefixes.add(prefix);
            seenBullets.add(`__suffix__${suffix}`);
            uniqueBullets.push(bullet);
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
    // Split on period followed by space (but keep the period)
    const sentences = deduped.summary
      .split(/(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const seen = new Set<string>();
    const seenPrefixes = new Set<string>();
    const uniqueSentences: string[] = [];
    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase().replace(/\s+/g, " ").trim();
      if (normalized.length < 10) {
        // Skip very short fragments (likely truncated/garbled)
        removed++;
        continue;
      }
      // Exact match
      if (seen.has(normalized)) {
        removed++;
        continue;
      }
      // Prefix match — if first 50 chars match, consider duplicate
      const prefix = normalized.slice(0, 50);
      if (normalized.length > 50 && seenPrefixes.has(prefix)) {
        removed++;
        continue;
      }
      // Check if sentence is a truncated fragment (doesn't end with period AND next sentence exists)
      // We'll keep it but mark it
      seen.add(normalized);
      if (normalized.length > 50) seenPrefixes.add(prefix);
      uniqueSentences.push(sentence);
    }
    deduped.summary = uniqueSentences.join(" ").trim();
    // Fix any double spaces left over
    deduped.summary = deduped.summary.replace(/\s{2,}/g, " ").trim();
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
 * STRICT POLICY:
 * - company: ALWAYS from source. If source.company is empty, use "" (NOT AI's hallucinated name).
 *   The renderer will show the title only — better than showing a wrong company.
 * - title: From source if available, otherwise keep AI's title (AI may have improved it).
 * - dates: ALWAYS from source. If source.dates are empty, use "".
 * - location: From source if available, otherwise keep AI's location.
 * - bullets: Always keep AI's bullets (the optimization).
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

  // Match each AI experience to a source experience using ID first, then fingerprint
  const restoredExp = ai.map((entry, idx) => {
    let orig = source.find((x) => x.id === entry.id);
    if (!orig) {
      const entryFp = computeExperienceFingerprint(entry);
      orig = source.find((x) => computeExperienceFingerprint(x) === entryFp);
    }

    if (!orig) {
      restored.push(`Experience entry (id="${entry.id}") had no matching source entry and was removed.`);
      return null;
    }

    if (entry.company !== orig.company && orig.company) {
      restored.push(`Experience[${entry.id}]: company "${entry.company}" → "${orig.company}"`);
    }
    if (entry.title !== orig.title && orig.title) {
      restored.push(`Experience[${entry.id}]: title "${entry.title}" → "${orig.title}"`);
    }
    if (entry.startDate !== orig.startDate && orig.startDate) {
      restored.push(`Experience[${entry.id}]: startDate "${entry.startDate}" → "${orig.startDate}"`);
    }
    if (entry.endDate !== orig.endDate && orig.endDate) {
      restored.push(`Experience[${entry.id}]: endDate "${entry.endDate}" → "${orig.endDate}"`);
    }
    if ((entry.location || "") !== (orig.location || "") && orig.location) {
      restored.push(`Experience[${entry.id}]: location "${entry.location}" → "${orig.location}"`);
    }

    return {
      ...entry,
      id: orig.id,
      company: orig.company || "",
      title: orig.title || entry.title || "",
      startDate: orig.startDate || "",
      endDate: orig.endDate || "",
      location: orig.location || entry.location || "",
      bullets: entry.bullets || orig.bullets,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // If source experiences are missing in AI output, append them
  for (const origExp of source) {
    const hasMatch = restoredExp.some((e) => e.id === origExp.id);
    if (!hasMatch) {
      restoredExp.push({ ...origExp, location: origExp.location || "" });
      restored.push(`Restored dropped experience: ${origExp.title} at ${origExp.company}`);
    }
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
 * STRICT POLICY:
 * - institution: ALWAYS from source. If source.institution is empty, use "".
 * - degree: From source if available, otherwise keep AI's degree.
 * - dates: ALWAYS from source. If source dates are empty, use "".
 * - location: From source if available, otherwise keep AI's location.
 * - highlights: Keep AI's highlights (the optimization).
 */
export function restoreEducation(optimized: ResumeData, sourceResume: ResumeData): {
  resume: ResumeData;
  restored: string[];
} {
  const result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const restored: string[] = [];

  logEducationPipeline("optimized", result.education || []);

  if (!sourceResume.education || sourceResume.education.length === 0) {
    return { resume: result, restored };
  }

  const source = sourceResume.education;
  const ai = result.education || [];

  // If AI dropped education entirely, restore all
  if (ai.length === 0) {
    result.education = source.map((e) => ({ ...e }));
    restored.push(`Restored ALL education (${source.length} entries) — AI had removed it`);
    logEducationPipeline("restored", result.education);
    return { resume: result, restored };
  }

  // For each AI entry, find matching source entry by ID/fingerprint (NOT index)
  const usedSourceIds = new Set<string>();
  const restoredEdu = ai.slice(0, source.length).map((entry, i) => {
    // Use ID-based matching to find the correct source entry
    const matchResult = findMatchingSourceEducation(entry, sourceResume, i);
    const orig = matchResult.match;

    if (!orig) {
      restored.push(`Education[${i}]: no source match found — keeping AI entry`);
      return entry;
    }

    if (matchResult.method !== "id") {
      restored.push(`Education[${i}]: matched by ${matchResult.method} — ${matchResult.warning || ""}`);
    }

    // Track which source entries we've used (for restoring dropped entries)
    usedSourceIds.add(orig.id);

    if (entry.institution !== orig.institution && orig.institution) {
      restored.push(`Education[${i}]: institution "${entry.institution}" → "${orig.institution}"`);
    }

    return {
      ...entry,
      // STRICT LOCK: ID is ALWAYS from source (immutable)
      id: orig.id,
      // STRICT LOCK: institution (school) is ALWAYS from source.
      institution: orig.institution || "",
      // degree: prefer source, fall back to AI
      degree: orig.degree || entry.degree || "",
      location: orig.location || entry.location || "",
      // STRICT: dates ALWAYS from source
      startDate: orig.startDate || "",
      endDate: orig.endDate || "",
      // Keep AI's highlights (the optimization)
      highlights: entry.highlights || orig.highlights,
    };
  });

  // Add back dropped entries (source entries that weren't matched)
  for (const srcEdu of source) {
    if (!usedSourceIds.has(srcEdu.id)) {
      restoredEdu.push({ ...srcEdu });
      restored.push(`Restored dropped education: ${srcEdu.degree} at ${srcEdu.institution}`);
    }
  }

  result.education = restoredEdu;

  // Validate fingerprints
  const fpValidation = validateEducationFingerprints(result, sourceResume);
  if (!fpValidation.valid) {
    restored.push(`WARNING: Education fingerprint validation: ${fpValidation.violations.length} violation(s)`);
    console.warn("[restoreEducation] Fingerprint violations:", fpValidation.violations);
  }

  logEducationPipeline("restored", result.education);

  if (restored.length > 0) {
    console.info(`[restoreEducation] Restored ${restored.length} field(s)`, restored);
  }

  return { resume: result, restored };
}

/**
 * RESTORE LANGUAGES
 *
 * Languages are immutable. ALWAYS use the original language set —
 * AI frequently corrupts language format (e.g., ": English: fluent").
 */
export function restoreLanguages(optimized: ResumeData, sourceResume: ResumeData): {
  resume: ResumeData;
  restored: string[];
} {
  const result = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const restored: string[] = [];

  logLanguagePipeline("optimized", result.languages || []);

  if (!sourceResume.languages || sourceResume.languages.length === 0) {
    return { resume: result, restored };
  }

  // ALWAYS use original languages — AI frequently corrupts the format
  // (e.g., leading colon, wrong proficiency values, missing names).
  // The original language set is the source of truth.
  const aiLangCount = result.languages?.length || 0;
  result.languages = sourceResume.languages.map((l) => ({ ...l }));
  restored.push(`Restored languages (${sourceResume.languages.length} entries) — using original set (AI had ${aiLangCount})`);

  // Validate fingerprints
  const fpValidation = validateLanguageFingerprints(result, sourceResume);
  if (!fpValidation.valid) {
    restored.push(`WARNING: Language fingerprint validation: ${fpValidation.violations.length} violation(s)`);
    console.warn("[restoreLanguages] Fingerprint violations:", fpValidation.violations);
  }

  logLanguagePipeline("restored", result.languages);

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

  // Check experience count (skip if source has none — parser didn't match)
  if (sourceResume.experience.length > 0 && optimized.experience.length !== sourceResume.experience.length) {
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

  // Check education count (skip if source has none)
  if (sourceResume.education.length > 0 && optimized.education.length < sourceResume.education.length) {
    violations.push(`Education entries dropped: ${sourceResume.education.length} → ${optimized.education.length}`);
  }

  // Check languages (skip if source has none)
  if (sourceResume.languages.length > 0 && optimized.languages.length < sourceResume.languages.length) {
    violations.push(`Languages dropped: ${sourceResume.languages.length} → ${optimized.languages.length}`);
  }

  // Check dynamic sections
  const srcDynCount = sourceResume.dynamicSections?.length || 0;
  const optDynCount = optimized.dynamicSections?.length || 0;
  if (srcDynCount > 0 && optDynCount < srcDynCount) {
    violations.push(`Dynamic sections dropped: ${srcDynCount} → ${optDynCount}`);
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
 * Also filters forbidden skills (JD company names, locations) from the skills list.
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

  // === PRESERVE OPTIONAL FIELDS (IMMUTABLE) ===
  // These fields are parsed from the original resume and must NEVER be lost
  if (original.dateOfBirth) {
    result.dateOfBirth = original.dateOfBirth;
  }
  if (original.additionalInfo) {
    result.additionalInfo = original.additionalInfo;
  }
  if (original.dynamicSections && original.dynamicSections.length > 0) {
    result.dynamicSections = original.dynamicSections.map((s) => ({ ...s }));
  }

  // === Lock headline — STRICT PROTECTION ===
  // The AI frequently replaces the original headline with the JD job title + JD company
  // (e.g., "Till Assistant | Qatar Duty Free" when the candidate never worked there).
  // We restore the original headline if ANY of these conditions are true:
  //   1. AI headline is empty
  //   2. AI headline contains a JD company name (Qatar Duty Free, Qatar Airways, etc.)
  //   3. AI headline contains a pipe "|" followed by a company name (likely JD-derived)
  //   4. AI headline is substantially different from original (different first 3 words)
  if (original.headline && original.headline.trim()) {
    const aiHeadline = (result.headline || "").trim();
    const aiHeadlineLower = aiHeadline.toLowerCase();
    const origHeadlineLower = original.headline.toLowerCase().trim();

    // JD company names that should NEVER appear in a candidate's headline
    const jdCompanyNames = [
      "qatar duty free", "qatar airways", "hamad international",
      "doha", "qatar", "dubai", "abu dhabi", "uae",
      "riyadh", "saudi arabia", "kuwait", "bahrain", "oman", "muscat",
    ];
    const containsJdCompany = jdCompanyNames.some((name) => aiHeadlineLower.includes(name));

    // Check if AI headline has a pipe with a company-like word after it
    // (e.g., "Till Assistant | Qatar Duty Free")
    const pipeMatch = aiHeadline.match(/\|\s*(.+)/);
    const hasPipeWithCompany = pipeMatch && jdCompanyNames.some((name) =>
      pipeMatch[1].toLowerCase().includes(name)
    );

    // Check if first 3 words match between original and AI headline
    const origFirst3 = origHeadlineLower.split(/\s+/).slice(0, 3).join(" ");
    const aiFirst3 = aiHeadlineLower.split(/\s+/).slice(0, 3).join(" ");
    const headlinesDiverge = origFirst3 && aiFirst3 && origFirst3 !== aiFirst3;

    if (!aiHeadline || containsJdCompany || hasPipeWithCompany || headlinesDiverge) {
      if (containsJdCompany) {
        allRestored.push(`Headline restored to original (AI had injected JD company name: "${aiHeadline}")`);
      } else if (hasPipeWithCompany) {
        allRestored.push(`Headline restored to original (AI had JD company after pipe: "${aiHeadline}")`);
      } else if (headlinesDiverge) {
        allRestored.push(`Headline restored to original (AI changed first 3 words: "${aiFirst3}" vs "${origFirst3}")`);
      } else {
        allRestored.push(`Headline restored to original (AI headline was empty)`);
      }
      result.headline = original.headline;
    }
  }

  // === Filter forbidden skills (JD company names, locations) ===
  if (result.skills && result.skills.length > 0) {
    const { filtered, removed } = filterForbiddenSkills(result.skills);
    if (removed.length > 0) {
      allRestored.push(`Removed ${removed.length} forbidden skill(s): ${removed.join(", ")}`);
      result.skills = filtered;
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

  // Restore skill categories from source (optimizer frequently drops them)
  if (original.skills && original.skills.length > 0 && result.skills) {
    const srcCatMap = new Map<string, string>();
    for (const src of original.skills) {
      const key = src.name.toLowerCase().trim();
      if (!srcCatMap.has(key) && src.category) srcCatMap.set(key, src.category);
    }
    let restoredCatCount = 0;
    for (const skill of result.skills) {
      if (!skill.category || skill.category === "General") {
        const srcKey = skill.name.toLowerCase().trim();
        const srcCat = srcCatMap.get(srcKey);
        if (srcCat) { skill.category = srcCat; restoredCatCount++; }
      }
    }
    if (restoredCatCount > 0) {
      allRestored.push(`Restored categories for ${restoredCatCount} skill(s) from source (optimizer dropped them).`);
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

  // === GUARDIAN VALIDATION (Dynamic Section Preservation) ===
  // Reject or alert if section counts don't match original blueprint
  const finalValidation = validateImmutableEntities(result, sourceResume);
  if (!finalValidation.valid) {
    console.error("[Guardian] Final validation failed after all restoration attempts!", finalValidation.violations);
    // In a strict production environment, we might throw an error here.
    // For now, we log it clearly for the observability system.
  }

  return result;
}
