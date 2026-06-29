// ============================================================================
// Dynamic Section Preservation & Enhancement Engine
//
// PURPOSE:
//   Guarantee that ANY section parsed from the original resume survives
//   optimization — even if it's not explicitly defined in the directives.
//
// PIPELINE POSITION:
//   Parser → Section Registry → Fingerprint Engine → Optimizer
//                               → Enhancement Engine → Guardian → Assembler
//
// KEY CONCEPTS:
//   - DynamicSection: Any resume section not in the directive-defined set
//   - Fingerprint: SHA-256(normalizedTitle + content) for stable matching
//   - Enhancement: Grammar + ATS keywords + professional wording only
//   - Preservation: 100% information retention; no section may disappear
// ============================================================================

"use client";

import type { ResumeData, DynamicSection, JobDescription } from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Directive-defined sections that have dedicated processing pipelines.
 *  All other sections in the resume are treated as "dynamic" and must be
 *  preserved through optimization. */
const DIRECTIVE_DEFINED_SECTIONS = new Set([
  "summary",
  "experience",
  "education",
  "skills",
  "languages",
  "additional information",
  "additionalinfo",
]);

// ============================================================================
// Section Header Detection Patterns
// ============================================================================

/** Regex patterns that match common resume section headers.
 *  These are used by the parser to identify section boundaries. */
const SECTION_HEADER_PATTERNS = [
  /^(?:professional\s+)?summary$/i,
  /^objective$/i,
  /^career\s+(?:objective|goals?|summary|profile)$/i,
  /^personal\s+(?:profile|statement|summary)$/i,
  /^profile$/i,
  /^experience$/i,
  /^professional\s+experience$/i,
  /^work\s+(?:experience|history|background)$/i,
  /^employment\s+(?:history|experience)$/i,
  /^relevant\s+experience$/i,
  /^education$/i,
  /^academic\s+(?:background|history|qualifications?)$/i,
  /^skills$/i,
  /^core\s+(?:competencies|skills|qualifications|strengths)$/i,
  /^technical\s+skills$/i,
  /^key\s+skills$/i,
  /^languages$/i,
  /^language\s+(?:skills?|proficiency|competencies)$/i,
  /^certifications?$/i,
  /^professional\s+certifications?$/i,
  /^licenses?\s+(?:and\s+)?certifications?$/i,
  /^projects?$/i,
  /^personal\s+projects?$/i,
  /^academic\s+projects?$/i,
  /^awards?$/i,
  /^honors?\s+(?:and\s+)?awards?$/i,
  /^achievements?$/i,
  /^professional\s+achievements?$/i,
  /^publications?$/i,
  /^research\s+(?:experience|publications?|work)$/i,
  /^volunteer\s+(?:experience|work|activities?|service)$/i,
  /^community\s+(?:involvement|service|volunteer|outreach)$/i,
  /^internships?$/i,
  /^training$/i,
  /^professional\s+training$/i,
  /^courses?$/i,
  /^relevant\s+coursework$/i,
  /^memberships?$/i,
  /^professional\s+(?:memberships?|affiliations?|associations?)$/i,
  /^affiliations?$/i,
  /^interests?$/i,
  /^hobbies?$/i,
  /^hobbies\s+(?:and\s+)?interests?$/i,
  /^extra[- ]curricular\s+(?:activities?|involvement)$/i,
  /^activities?$/i,
  /^military\s+service$/i,
  /^conferences?$/i,
  /^seminars?\s+(?:and\s+)?workshops?$/i,
  /^workshops?$/i,
  /^references?$/i,
  /^accomplishments?$/i,
  /^patents?$/i,
  /^additional\s+information$/i,
  /^additional\s+details?$/i,
  /^add\.?\s*info$/i,
  /^custom\s+section$/i,
  /^other$/i,
];

// ============================================================================
// Fingerprint
// ============================================================================

/**
 * Simple SHA-256 fingerprint generator using the Web Crypto API.
 * This is used for stable identification of dynamic sections so they can
 * be tracked across optimization by fingerprint rather than array index.
 *
 * For environments where crypto.subtle is unavailable (e.g., some test
 * runners), we fall back to a string-based hash.
 */
async function computeSectionFingerprint(
  normalizedTitle: string,
  content: string
): Promise<string> {
  const input = normalizedTitle + content;
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Fallback: simple hash for environments without crypto.subtle
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return `fp_${Math.abs(hash).toString(16).padStart(8, "0")}`;
  }
}

/**
 * Compute a fingerprint synchronously for cases where async is not convenient.
 * Uses the same fallback hashing always.
 */
export function computeFingerprintSync(title: string, content: string): string {
  const normalizedTitle = normalizeTitle(title);
  const input = normalizedTitle + content;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

// ============================================================================
// Helpers
// ============================================================================

/** Normalize a section title for comparison and fingerprinting */
function normalizeTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:and|&)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Check if a title corresponds to a directive-defined section */
export function isDirectiveDefinedSection(title: string): boolean {
  const normalized = normalizeTitle(title);
  return DIRECTIVE_DEFINED_SECTIONS.has(normalized);
}

/** Check if a line looks like a section header */
export function isLikelySectionHeader(line: string): boolean {
  const trimmed = line.trim();
  // Section headers are typically short, uppercase-heavy, and standalone
  if (trimmed.length > 50 || trimmed.length < 2) return false;
  return SECTION_HEADER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ============================================================================
// DynamicSection Registry — Extract all sections from a ResumeData
// ============================================================================

/**
 * Extract ALL sections from a parsed ResumeData into DynamicSection[].
 *
 * This covers:
 * 1. Directive-defined sections (summary, experience, education, etc.)
 * 2. Dynamic sections (certifications, awards, volunteer, custom, etc.)
 *
 * Directive-defined sections are included but marked as such so the engine
 * can still track their presence across optimization.
 *
 * @param resume - The parsed ResumeData (from source or optimized)
 * @returns Array of DynamicSection entries for ALL sections found
 */
export function extractSectionsFromResume(resume: ResumeData): DynamicSection[] {
  const sections: DynamicSection[] = [];
  let order = 0;

  // --- Summary ---
  if (resume.summary?.trim()) {
    sections.push({
      id: computeFingerprintSync("summary", resume.summary),
      title: "Summary",
      normalizedTitle: "summary",
      content: resume.summary,
      bullets: [resume.summary],
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Experience ---
  if (resume.experience?.length > 0) {
    const expContent = resume.experience
      .map(
        (e) =>
          `${e.title} at ${e.company} (${e.startDate} - ${e.endDate}): ${e.bullets.join("; ")}`
      )
      .join("\n");
    sections.push({
      id: computeFingerprintSync("experience", expContent),
      title: "Experience",
      normalizedTitle: "experience",
      content: expContent,
      bullets: resume.experience.flatMap((e) => [e.title, ...e.bullets]),
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Education ---
  if (resume.education?.length > 0) {
    const eduContent = resume.education
      .map(
        (e) =>
          `${e.degree} at ${e.institution}${e.field ? `, ${e.field}` : ""} (${e.startDate} - ${e.endDate})`
      )
      .join("\n");
    sections.push({
      id: computeFingerprintSync("education", eduContent),
      title: "Education",
      normalizedTitle: "education",
      content: eduContent,
      bullets: resume.education.flatMap((e) => [
        `${e.degree} - ${e.institution}`,
        ...(e.highlights || []),
      ]),
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Skills ---
  if (resume.skills?.length > 0) {
    const skillsContent = resume.skills
      .map((s) => `${s.name}${s.category ? ` [${s.category}]` : ""}`)
      .join(", ");
    sections.push({
      id: computeFingerprintSync("skills", skillsContent),
      title: "Skills",
      normalizedTitle: "skills",
      content: skillsContent,
      bullets: resume.skills.map((s) => s.name),
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Languages ---
  if (resume.languages?.length > 0) {
    const langContent = resume.languages
      .map((l) => `${l.name} (${l.proficiency})`)
      .join(", ");
    sections.push({
      id: computeFingerprintSync("languages", langContent),
      title: "Languages",
      normalizedTitle: "languages",
      content: langContent,
      bullets: resume.languages.map((l) => `${l.name} - ${l.proficiency}`),
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Additional Information (free-text) ---
  if (resume.additionalInfo?.trim()) {
    const addInfoLines = resume.additionalInfo
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    sections.push({
      id: computeFingerprintSync("additionalinformation", resume.additionalInfo),
      title: "Additional Information",
      normalizedTitle: "additionalinformation",
      content: resume.additionalInfo,
      bullets: addInfoLines,
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Certifications (structured) ---
  if (resume.certifications?.length > 0) {
    const certContent = resume.certifications
      .map((c) => `${c.name}${c.issuer ? ` — ${c.issuer}` : ""}`)
      .join("\n");
    sections.push({
      id: computeFingerprintSync("certifications", certContent),
      title: "Certifications",
      normalizedTitle: "certifications",
      content: certContent,
      bullets: resume.certifications.map((c) => c.name),
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Projects (structured) ---
  if (resume.projects?.length > 0) {
    const projContent = resume.projects
      .map((p) => `${p.name}: ${p.bullets.join("; ")}`)
      .join("\n");
    sections.push({
      id: computeFingerprintSync("projects", projContent),
      title: "Projects",
      normalizedTitle: "projects",
      content: projContent,
      bullets: resume.projects.flatMap((p) => [p.name, ...p.bullets]),
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Achievements ---
  const achievements = resume.achievements ?? [];
  if (achievements.length > 0) {
    const achContent = achievements.join("\n");
    sections.push({
      id: computeFingerprintSync("achievements", achContent),
      title: "Achievements",
      normalizedTitle: "achievements",
      content: achContent,
      bullets: [...achievements],
      order: order++,
      source: "parsed",
      immutable: true,
    });
  }

  // --- Dynamic sections already in ResumeData (from parser) ---
  const existingDynamic = resume.dynamicSections ?? [];
  if (existingDynamic.length > 0) {
    for (const ds of existingDynamic) {
      // Only add if not already covered by the structured sections above
      const alreadyExists = sections.some(
        (s) => s.normalizedTitle === ds.normalizedTitle
      );
      if (!alreadyExists) {
        sections.push({
          ...ds,
          order: order++,
        });
      }
    }
  }

  return sections;
}

// ============================================================================
// Preservation Check — Verify all original sections are in the optimized output
// ============================================================================

export interface SectionPreservationResult {
  preserved: boolean;
  originalCount: number;
  optimizedCount: number;
  missing: DynamicSection[];
  preservedSections: string[];
  details: string[];
}

/**
 * Check that ALL sections from the original resume are present in the
 * optimized resume. Uses fingerprint matching — never array indexes.
 *
 * @param originalSections - Sections extracted from the SOURCE resume
 * @param optimizedResume - The optimized ResumeData to check
 * @returns SectionPreservationResult with details about what was preserved/missing
 */
export function checkSectionPreservation(
  originalSections: DynamicSection[],
  optimizedResume: ResumeData
): SectionPreservationResult {
  const optimizedSections = extractSectionsFromResume(optimizedResume);
  const missing: DynamicSection[] = [];
  const preservedSections: string[] = [];
  const details: string[] = [];

  for (const origSection of originalSections) {
    // Find matching section in optimized by fingerprint, then by normalized title
    let found = optimizedSections.find(
      (os) => os.id === origSection.id
    );
    if (!found) {
      // Fallback: match by normalized title (content may have been enhanced)
      found = optimizedSections.find(
        (os) => os.normalizedTitle === origSection.normalizedTitle
      );
    }

    if (found) {
      preservedSections.push(origSection.title);
      const contentKept = origSection.bullets.every((b) =>
        found!.content.includes(b) || found!.bullets.includes(b)
      );
      if (!contentKept) {
        details.push(
          `⚠ ${origSection.title}: content partially preserved (${origSection.bullets.length} original bullets, ${found.bullets.length} final bullets)`
        );
      } else {
        details.push(`✓ ${origSection.title}: fully preserved`);
      }
    } else {
      missing.push(origSection);
      details.push(`✗ ${origSection.title}: MISSING from optimized resume`);
    }
  }

  return {
    preserved: missing.length === 0,
    originalCount: originalSections.length,
    optimizedCount: optimizedSections.length,
    missing,
    preservedSections,
    details,
  };
}

// ============================================================================
// Content Enhancement — Apply ATS-friendly improvements to dynamic sections
// ============================================================================

/**
 * Keywords commonly associated with ATS-friendly resume content.
 * Used to enhance dynamic section content with relevant terminology.
 */
const ATS_ENHANCEMENT_KEYWORDS: Record<string, string[]> = {
  volunteer: [
    "teamwork",
    "community engagement",
    "leadership",
    "initiative",
    "service-oriented",
    "collaboration",
    "non-profit",
    "outreach",
  ],
  certification: [
    "certified",
    "qualified",
    "professional development",
    "industry-recognized",
    "specialized training",
    "accredited",
  ],
  project: [
    "delivered",
    "implemented",
    "managed",
    "coordinated",
    "streamlined",
    "optimized",
    "cross-functional",
    "stakeholder",
  ],
  award: [
    "recognized",
    "achievement",
    "excellence",
    "outstanding",
    "top performer",
    "merit-based",
  ],
  publication: [
    "research",
    "co-authored",
    "published",
    "peer-reviewed",
    "scholarly",
    "citation",
  ],
  training: [
    "professional development",
    "skill enhancement",
    "continuing education",
    "workshop",
    "seminar",
  ],
  membership: [
    "professional affiliation",
    "industry association",
    "networking",
    "member",
  ],
  interest: [
    "enthusiastic",
    "passionate",
    "dedicated",
    "committed",
  ],
};

/**
 * Get ATS enhancement keywords relevant to a section title.
 */
function getRelevantKeywords(title: string): string[] {
  const lower = title.toLowerCase();
  const keywords: string[] = [];

  for (const [key, values] of Object.entries(ATS_ENHANCEMENT_KEYWORDS)) {
    if (lower.includes(key)) {
      keywords.push(...values);
    }
  }

  return keywords;
}

/**
 * Enhance dynamic section content with ATS-friendly wording, grammar
 * improvements, and industry-appropriate terminology.
 *
 * This is a text-level enhancement pass. For true AI-driven enhancement,
 * the section content is passed to the AI optimizer alongside directive-
 * defined sections.
 *
 * @param section - The dynamic section to enhance
 * @param jd - Optional job description for keyword alignment
 * @returns Enhanced bullets for the section
 */
export function enhanceDynamicSection(
  section: DynamicSection,
  jd?: JobDescription
): { bullets: string[]; content: string } {
  const jdKeywords = new Set<string>();
  if (jd?.keywords) {
    for (const kw of jd.keywords) {
      jdKeywords.add(kw.toLowerCase().trim());
    }
  }

  const relevantKeywords = getRelevantKeywords(section.title);
  const allKeywords: string[] = (() => {
    const seen = new Set<string>();
    relevantKeywords.forEach((k) => seen.add(k));
    jdKeywords.forEach((k) => seen.add(k));
    const result: string[] = [];
    seen.forEach((k) => result.push(k));
    return result;
  })();

  // Enhance each bullet: capitalize first letter, ensure period at end,
  // inject relevant keywords where appropriate
  const enhancedBullets = section.bullets.map((bullet) => {
    let enhanced = bullet.trim();

    // Capitalize first letter
    if (enhanced.length > 0 && /^[a-z]/.test(enhanced)) {
      enhanced = enhanced.charAt(0).toUpperCase() + enhanced.slice(1);
    }

    // Ensure period at end — but not if bullet already ends with punctuation
    if (enhanced.length > 0 && ![".", "!", "?"].includes(enhanced.slice(-1))) {
      enhanced += ".";
    }

    // Inject missing ATS keywords if the bullet is short and keywords exist
    if (enhanced.length > 0 && enhanced.length < 150 && allKeywords.length > 0) {
      const missingKws = allKeywords.filter(
        (kw) => !enhanced.toLowerCase().includes(kw)
      );
      if (missingKws.length > 0 && !enhanced.toLowerCase().includes(missingKws[0])) {
        enhanced = `${enhanced} Demonstrating ${missingKws[0]}.`;
      }
    }

    return enhanced;
  });

  const content = enhancedBullets.join("\n");

  console.log(`[Dynamic Section Engine] Enhanced: "${section.title}" — ${enhancedBullets.length} bullets`);
  return { bullets: enhancedBullets, content };
}

// ============================================================================
// Merge — Restore any missing dynamic sections into the optimized resume
// ============================================================================

/**
 * Merge original dynamic sections into an optimized resume.
 * Any section that was lost during optimization is restored from the original.
 * Existing enhanced sections take priority unless they were dropped.
 *
 * @param optimizedResume - The optimized resume (may be missing sections)
 * @param originalSections - Dynamic sections from the source resume
 * @param enhancedSections - Enhanced versions of sections (where available)
 * @returns The resume with all dynamic sections restored
 */
export function mergeDynamicSections(
  optimizedResume: ResumeData,
  originalSections: DynamicSection[],
  enhancedSections?: DynamicSection[]
): ResumeData {
  const output = { ...optimizedResume };

  // Extract what currently exists in the optimized resume
  const existingSections = extractSectionsFromResume(output);
  const existingTitles = new Set(existingSections.map((s) => s.normalizedTitle));

  // Build map of enhanced versions keyed by normalized title
  const enhancedMap = new Map<string, DynamicSection>();
  if (enhancedSections) {
    for (const es of enhancedSections) {
      enhancedMap.set(es.normalizedTitle, es);
    }
  }

  const restored: string[] = [];
  const alreadyPresent: string[] = [];

  for (const origSection of originalSections) {
    if (existingTitles.has(origSection.normalizedTitle)) {
      alreadyPresent.push(origSection.title);
      continue;
    }

    // Section is missing — restore it
    const enhanced = enhancedMap.get(origSection.normalizedTitle);
    const restoredSection: DynamicSection = {
      ...origSection,
      id: computeFingerprintSync(
        origSection.normalizedTitle,
        enhanced?.content ?? origSection.content
      ),
      content: enhanced?.content ?? origSection.content,
      bullets: enhanced?.bullets ?? origSection.bullets,
    };

    if (!output.dynamicSections) {
      output.dynamicSections = [];
    }
    output.dynamicSections.push(restoredSection);
    restored.push(origSection.title);

    console.log(
      `[Dynamic Section Engine] Restored: "${origSection.title}" (${origSection.bullets.length} bullets)`
    );
  }

  if (restored.length > 0) {
    console.log(
      `[Dynamic Section Engine] Merged: restored ${restored.length} sections [${restored.join(", ")}], ${alreadyPresent.length} already present`
    );
  }

  return output;
}

// ============================================================================
// Complete Pipeline Integration
// ============================================================================

export interface DynamicSectionPipelineResult {
  originalSections: DynamicSection[];
  enhancedSections: DynamicSection[];
  preservation: SectionPreservationResult;
  mergedResume: ResumeData | null;
  logs: string[];
}

/**
 * Run the full Dynamic Section Preservation pipeline.
 *
 * 1. Extract all sections from the source resume
 * 2. Check preservation in the optimized output
 * 3. Enhance dynamic sections with ATS-friendly content
 * 4. Merge any missing sections back into the result
 *
 * @param sourceResume - The original parsed resume
 * @param optimizedResume - The optimizer's output resume
 * @param jd - Optional job description for keyword alignment
 * @returns Pipeline result with preservation check, enhanced sections, and merged resume
 */
export function runDynamicSectionPipeline(
  sourceResume: ResumeData,
  optimizedResume: ResumeData,
  jd?: JobDescription
): DynamicSectionPipelineResult {
  const logs: string[] = [];

  // Step 1: Extract all sections from source
  const originalSections = extractSectionsFromResume(sourceResume);
  logs.push(
    `[Dynamic Section Engine] Source: extracted ${originalSections.length} sections: [${originalSections.map((s) => s.title).join(", ")}]`
  );
  console.log(
    `[Dynamic Section Engine] Source: extracted ${originalSections.length} sections: [${originalSections.map((s) => s.title).join(", ")}]`
  );

  // Step 2: Check preservation in optimized output
  const preservation = checkSectionPreservation(originalSections, optimizedResume);
  logs.push(
    `[Dynamic Section Engine] Preservation: ${preservation.preservedSections.length}/${originalSections.length} — ${preservation.preserved ? "ALL PRESERVED" : `${preservation.missing.length} MISSING`}`
  );
  console.log(
    `[Dynamic Section Engine] Preservation: ${preservation.preservedSections.length}/${originalSections.length} — ${preservation.preserved ? "ALL PRESERVED" : `${preservation.missing.length} MISSING`}`
  );

  // Step 3: Enhance dynamic sections
  const enhancedSections: DynamicSection[] = [];
  for (const section of originalSections) {
    const enhancement = enhanceDynamicSection(section, jd);
    const enhancedSection: DynamicSection = {
      ...section,
      content: enhancement.content,
      bullets: enhancement.bullets,
      enhanced: enhancement.content,
      enhancedBullets: enhancement.bullets,
    };
    // Recompute fingerprint with enhanced content
    enhancedSection.id = computeFingerprintSync(
      section.normalizedTitle,
      enhancement.content
    );
    enhancedSections.push(enhancedSection);
  }
  logs.push(
    `[Dynamic Section Engine] Enhanced: ${enhancedSections.length} sections processed`
  );
  console.log(
    `[Dynamic Section Engine] Enhanced: ${enhancedSections.length} sections processed`
  );

  // Step 4: Merge any missing sections back
  const mergedResume = mergeDynamicSections(
    optimizedResume,
    originalSections,
    enhancedSections
  );

  // Check if any sections were actually restored
  const restoredCount = mergedResume.dynamicSections?.length ?? 0;
  if (restoredCount > 0 && preservation.missing.length > 0) {
    logs.push(
      `[Dynamic Section Engine] Restored: ${preservation.missing.length} sections merged back`
    );
    console.log(
      `[Dynamic Section Engine] Restored: ${preservation.missing.length} sections merged back`
    );
  }

  logs.push("[Dynamic Section Engine] Pipeline complete");
  console.log("[Dynamic Section Engine] Pipeline complete");

  // Ensure dynamicSections from source resume are preserved in merged result
  if (sourceResume.dynamicSections && sourceResume.dynamicSections.length > 0) {
    const existingNormTitles = new Set(
      (mergedResume.dynamicSections || []).map((ds) => ds.normalizedTitle)
    );
    for (const srcDs of sourceResume.dynamicSections) {
      if (!existingNormTitles.has(srcDs.normalizedTitle)) {
        if (!mergedResume.dynamicSections) {
          mergedResume.dynamicSections = [];
        }
        mergedResume.dynamicSections.push({ ...srcDs });
      }
    }
  }

  return {
    originalSections,
    enhancedSections,
    preservation,
    mergedResume,
    logs,
  };
}
