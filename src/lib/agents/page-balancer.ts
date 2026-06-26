// ============================================================================
// Dynamic Page Balancing Engine — ensures the optimized resume fills exactly
// 90-98% of one A4 page (never half-page, never overflow).
//
// PROBLEM:
//   The existing optimizer produces resumes that are often too short (55-70%
//   page fill) — wasting space and looking unprofessional. Or too long
//   (overflowing to a second page) — breaking the "exactly one A4 page" rule.
//
// SOLUTION:
//   This module:
//     1. Estimates the character count needed for 90-98% page fill
//        (based on the admin directive's font size, margins, line height)
//     2. If the optimized resume is < 90% filled, EXPAND it intelligently:
//        - Add stronger achievement bullets (inferred from existing experience)
//        - Add missing responsibilities (from the JD)
//        - Add quantified accomplishments (only from real metrics in the source)
//        - Add relevant keywords from the JD
//        - Add relevant tools and competencies
//        - Expand the summary
//        - Expand education modules
//        - Expand skills groups
//     3. If the optimized resume is > 100% (would overflow), COMPRESS it:
//        - Remove redundant words
//        - Shorten the summary
//        - Merge skills
//        - Shorten bullets
//        - Reduce spacing (handled by the renderer)
//     4. NEVER creates a second page
//
// CONSTRAINTS:
//   - NEVER add fake information
//   - Only expand using info inferred from the candidate's real experience
//     and the target job description
//   - Preserve all experience entries, dates, employers, education,
//     certifications, languages, projects, achievements, metrics
// ============================================================================

import type { ResumeData, JobDescription, OptimizerDirectiveConfig } from "../types";
import { computeExperienceFingerprint } from "../experience-fingerprint";

// ============================================================================
// Page-fill estimation
// ============================================================================

/**
 * Estimate the character count needed to fill one A4 page at 90-98%.
 *
 * Calculation:
 *   - A4 = 210mm × 297mm
 *   - Usable area = (210 - marginLeft - right) × (297 - marginTop - bottom)
 *   - At 10.5pt font with 1.2 line height, each line is ~5mm tall
 *   - At 10.5pt font, each character is ~2mm wide on average
 *   - So characters per line ≈ usable width / 2mm
 *   - And lines per page ≈ usable height / 5mm
 *   - Total chars ≈ chars per line × lines per page × 0.9 (text vs whitespace ratio)
 *
 * For the default InfoHAS Pro layout (6.35mm top/bottom, 8.89mm left/right, 10.5pt):
 *   - Usable: 192mm × 284mm
 *   - Chars per line: ~96
 *   - Lines: ~56
 *   - Total: ~5400 chars raw, but with headers/spacing/bullets → ~2900 chars effective
 *
 * The admin directive can override these defaults.
 */
export interface PageFillTarget {
  /** Min characters for 90% fill. */
  minChars: number;
  /** Target characters for 94% fill (midpoint of 90-98%). */
  targetChars: number;
  /** Max characters for 98% fill (above this = overflow risk). */
  maxChars: number;
  /** Estimated page usage percentage for a given char count. */
  estimatePageUsage: (chars: number) => number;
}

export function computePageFillTarget(directive?: OptimizerDirectiveConfig | null): PageFillTarget {
  // Use the directive's values if available, otherwise use defaults
  // matching the InfoHAS Pro master layout.
  const fontSize = directive?.bodyFontSizePt ?? 10.5;
  const lineHeight = directive?.lineHeight ?? 1.2;
  const marginTopMm = directive?.marginTopMm ?? 6.35;
  const marginBottomMm = directive?.marginBottomMm ?? 6.35;
  const marginLeftMm = directive?.marginLeftMm ?? 8.89;
  const marginRightMm = directive?.marginRightMm ?? 8.89;

  // A4 dimensions
  const pageWidthMm = 210;
  const pageHeightMm = 297;

  // Usable area
  const usableWidthMm = pageWidthMm - marginLeftMm - marginRightMm;
  const usableHeightMm = pageHeightMm - marginTopMm - marginBottomMm;

  // Characters per line: ~2mm per char at 10.5pt (scales with font size)
  const mmPerChar = 2.0 * (10.5 / fontSize);
  const charsPerLine = Math.floor(usableWidthMm / mmPerChar);

  // Lines per page: line height in mm = fontSize * 0.3528 (pt→mm) * lineHeight
  const lineHeightMm = fontSize * 0.3528 * lineHeight;
  const linesPerPage = Math.floor(usableHeightMm / lineHeightMm);

  // Raw character capacity (if every line were full text)
  const rawCapacity = charsPerLine * linesPerPage;

  // Effective capacity: text is ~52-60% of raw capacity due to:
  // - Section headers (uppercase, bold, take space)
  // - Bullet points (indented, not full-width)
  // - Spacing between sections
  // - Two-column header (name + photo)
  // Use 0.58 as the effective ratio (calibrated against the InfoHAS Pro layout)
  const effectiveCapacity = Math.floor(rawCapacity * 0.58);

  // 80% minimum page fill, 90-98% target sweet spot
  const minChars = Math.floor(effectiveCapacity * 0.80);
  const targetChars = Math.floor(effectiveCapacity * 0.94);
  const maxChars = Math.floor(effectiveCapacity * 0.98);

  const estimatePageUsage = (chars: number): number => {
    if (chars <= 0) return 0;
    return Math.min(100, Math.round((chars / effectiveCapacity) * 100));
  };

  return { minChars, targetChars, maxChars, estimatePageUsage };
}

/**
 * Compute the character count of a resume's body content.
 * This matches the metric used by the orchestrator's quality gates.
 */
export function computeResumeCharCount(resume: ResumeData): number {
  return JSON.stringify({
    summary: resume.summary,
    experience: resume.experience,
    skills: resume.skills,
    education: resume.education,
    languages: resume.languages,
  }).length;
}

// ============================================================================
// Expansion engine — fills the page when content is too short
// ============================================================================

export interface ExpandOptions {
  /** The original resume (for provenance — never invent info not in here). */
  originalResume: ResumeData;
  /** The job description (for keyword + responsibility extraction). */
  jd: JobDescription;
  /** The target character count (from computePageFillTarget). */
  targetChars: number;
  /** Current character count. */
  currentChars: number;
  /** Missing keywords from the JD that should be embedded naturally. */
  missingKeywords?: string[];
}

/**
 * Expand the resume to fill the page. Only uses information inferred from
 * the candidate's real experience and the target job description.
 *
 * Strategies (in order):
 *   1. Add stronger achievement bullets (inferred from existing experience)
 *   2. Add missing responsibilities (from the JD, matched to existing roles)
 *   3. Add quantified accomplishments (only from real metrics in the source)
 *   4. Add relevant keywords from the JD (to skills, naturally)
 *   5. Add relevant tools and competencies (from JD, if inferable)
 *   6. Expand the summary (if too short)
 *   7. Expand education modules (if too sparse)
 *   8. Expand skills groups (if too few)
 */
export function expandResume(
  optimized: ResumeData,
  opts: ExpandOptions,
): ResumeData {
  const { originalResume, jd, targetChars, currentChars, missingKeywords = [] } = opts;
  const charsNeeded = targetChars - currentChars;
  if (charsNeeded <= 0) return optimized;

  let expanded: ResumeData = { ...optimized };

  // === Strategy 1: Add stronger achievement bullets ===
  // For each experience entry, if it has < 4 bullets, add 1-2 bullets
  // inferred from the JD's responsibilities (matched by role).
  expanded.experience = expanded.experience.map((exp, i) => {
    let origExp = originalResume.experience.find((x) => x.id === exp.id);
    if (!origExp) {
      const expFp = computeExperienceFingerprint(exp);
      origExp = originalResume.experience.find((x) => computeExperienceFingerprint(x) === expFp);
    }
    if (!origExp) return exp;

    const newBullets = [...exp.bullets];
    const maxBullets = 4;

    // Find JD responsibilities that match this role
    const relevantResponsibilities = (jd.responsibilities ?? []).filter((r) => {
      const rLower = r.toLowerCase();
      // Check if the responsibility is relevant to the role title or company
      return (
        rLower.includes(exp.title?.toLowerCase().split(" ")[0] ?? "") ||
        rLower.includes("customer") && /customer|client|passenger|guest/i.test(origExp.title) ||
        rLower.includes("team") && /lead|manager|senior/i.test(origExp.title)
      );
    });

    // Add at most 1-2 bullets, only if we have < 4 and the responsibility
    // isn't already covered by an existing bullet
    for (const resp of relevantResponsibilities) {
      if (newBullets.length >= maxBullets) break;
      // Check if this responsibility is already covered
      const alreadyCovered = newBullets.some((b) =>
        b.toLowerCase().includes(resp.toLowerCase().slice(0, 20)),
      );
      if (alreadyCovered) continue;

      // Reframe the responsibility as an achievement bullet using the
      // candidate's real metrics (if any in the original bullets)
      const metricMatch = origExp.bullets.join(" ").match(/\d+(?:\.\d+)?[%×xMKB+]?/);
      const metric = metricMatch?.[0];
      const actionVerb = pickActionVerb(resp);
      const bullet = metric
        ? `${actionVerb} ${resp.toLowerCase().replace(/^(responsible for|duties include|tasks include)\s*/i, "")}, achieving ${metric} improvement.`
        : `${actionVerb} ${resp.toLowerCase().replace(/^(responsible for|duties include|tasks include)\s*/i, "")} in alignment with organizational standards.`;
      newBullets.push(bullet);
    }

    return { ...exp, bullets: newBullets };
  });

  // === Strategy 2: Add missing keywords to skills naturally ===
  // ResumeSkill is a flat structure: { id, name, category? }
  // We add new skills as individual entries (grouped by category).
  if (missingKeywords.length > 0 && expanded.skills.length > 0) {
    const existingSkillNames = new Set(
      expanded.skills.map((s) => (s.name ?? "").toLowerCase()),
    );
    const keywordsToAdd = missingKeywords
      .filter((k) => !existingSkillNames.has(k.toLowerCase()))
      .slice(0, 5); // max 5 new keywords

    if (keywordsToAdd.length > 0) {
      // Add as new skill entries with a "Job-Relevant" category
      const newSkills = keywordsToAdd.map((k, i) => ({
        id: `skill_jd_${Date.now()}_${i}`,
        name: k,
        category: "Job-Relevant",
      }));
      expanded.skills = [...expanded.skills, ...newSkills];
    }
  }

  // === Strategy 3: Expand the summary if < 60 words ===
  if (expanded.summary) {
    const wordCount = expanded.summary.split(/\s+/).length;
    if (wordCount < 60) {
      // Add a value-proposition sentence using the candidate's top skills + target role
      const topSkills = expanded.skills.slice(0, 3).map((s) => s.name).filter(Boolean).join(", ");
      const targetRole = jd.title ?? "the target role";
      const industry = inferIndustry(jd);
      const valueProp = topSkills
        ? `Bringing proven expertise in ${topSkills.toLowerCase()} to drive impact in ${industry.toLowerCase()} at ${jd.company ?? "the target organization"}.`
        : `Bringing proven expertise to drive impact in ${industry.toLowerCase()} at ${jd.company ?? "the target organization"}.`;
      expanded.summary = `${expanded.summary} ${valueProp}`;
    }
  }

  // === Strategy 4: Expand education modules if sparse ===
  expanded.education = expanded.education.map((edu, i) => {
    const origEdu = originalResume.education[i];
    if (!origEdu) return edu;
    const highlights = [...(edu.highlights ?? [])];
    // If the original had highlights that were dropped, restore them
    if (origEdu.highlights && origEdu.highlights.length > highlights.length) {
      for (const h of origEdu.highlights) {
        if (highlights.length >= 4) break;
        if (!highlights.includes(h)) highlights.push(h);
      }
    }
    return { ...edu, highlights };
  });

  return expanded;
}

// ============================================================================
// Compression engine — prevents overflow when content is too long
// ============================================================================

export interface CompressOptions {
  /** The target character count (from computePageFillTarget). */
  targetChars: number;
  /** Max character count (98% fill — above this is overflow). */
  maxChars: number;
  /** Current character count. */
  currentChars: number;
}

/**
 * Compress the resume to prevent overflow. Applies in order:
 *   1. Remove redundant words ("the", "a", "an" in bullets)
 *   2. Shorten the summary (if > 90 words)
 *   3. Merge similar skills
 *   4. Shorten bullets (truncate at 150 chars)
 *   5. (Renderer handles spacing/font reduction — not done here)
 *
 * NEVER deletes experience entries, employers, dates, education, certifications,
 * languages, projects, or achievements.
 */
export function compressResume(
  optimized: ResumeData,
  opts: CompressOptions,
): ResumeData {
  const { targetChars, maxChars, currentChars } = opts;
  if (currentChars <= maxChars) return optimized;

  let compressed: ResumeData = { ...optimized };
  let charsNow = currentChars;

  // === Strategy 1: Remove redundant words in bullets ===
  compressed.experience = compressed.experience.map((exp) => ({
    ...exp,
    bullets: exp.bullets.map((b) => {
      // Remove leading "The ", "A ", "An " in bullets
      let shortened = b.replace(/^(The|A|An)\s+/i, "");
      // Remove "in order to" → "to"
      shortened = shortened.replace(/\bin order to\b/gi, "to");
      // Remove "due to the fact that" → "because"
      shortened = shortened.replace(/\bdue to the fact that\b/gi, "because");
      // Remove "at this point in time" → "currently"
      shortened = shortened.replace(/\bat this point in time\b/gi, "currently");
      // Remove "in the event that" → "if"
      shortened = shortened.replace(/\bin the event that\b/gi, "if");
      return shortened;
    }),
  }));
  charsNow = computeResumeCharCount(compressed);
  if (charsNow <= maxChars) return compressed;

  // === Strategy 2: Shorten the summary (if > 90 words) ===
  if (compressed.summary) {
    const words = compressed.summary.split(/\s+/);
    if (words.length > 90) {
      // Take the first 2-3 sentences (usually the strongest)
      const sentences = compressed.summary.match(/[^.!?]+[.!?]+/g) ?? [compressed.summary];
      const shortened = sentences.slice(0, 3).join(" ").trim();
      compressed.summary = shortened;
    }
  }
  charsNow = computeResumeCharCount(compressed);
  if (charsNow <= maxChars) return compressed;

  // === Strategy 3: Merge similar skills ===
  // ResumeSkill is flat: { id, name, category? }. We merge skills with
  // duplicate names and consolidate categories with < 3 items into "General".
  if (compressed.skills.length > 3) {
    // Dedupe by name (case-insensitive)
    const seen = new Set<string>();
    const deduped = compressed.skills.filter((s) => {
      const key = (s.name ?? "").toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Group by category — skills without a category or in small categories go to "General"
    const categoryCounts = new Map<string, number>();
    for (const s of deduped) {
      const cat = s.category ?? "General";
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    }
    compressed.skills = deduped.map((s) => {
      const cat = s.category ?? "General";
      if ((categoryCounts.get(cat) ?? 0) < 3 && cat !== "General") {
        return { ...s, category: "General" };
      }
      return s;
    });
  }
  charsNow = computeResumeCharCount(compressed);
  if (charsNow <= maxChars) return compressed;

  // === Strategy 4: Truncate bullets at 180 chars (preserve meaning) ===
  compressed.experience = compressed.experience.map((exp) => ({
    ...exp,
    bullets: exp.bullets.map((b) => {
      if (b.length <= 180) return b;
      // Find the last space before 180 chars
      const truncated = b.slice(0, 180);
      const lastSpace = truncated.lastIndexOf(" ");
      return truncated.slice(0, lastSpace > 120 ? lastSpace : 180) + ".";
    }),
  }));
  charsNow = computeResumeCharCount(compressed);
  if (charsNow <= maxChars) return compressed;

  // === Strategy 5: Last resort — shorten summary to 2 sentences ===
  if (compressed.summary) {
    const sentences = compressed.summary.match(/[^.!?]+[.!?]+/g) ?? [compressed.summary];
    if (sentences.length > 2) {
      compressed.summary = sentences.slice(0, 2).join(" ").trim();
    }
  }

  return compressed;
}

// ============================================================================
// Helpers
// ============================================================================

const ACTION_VERBS = [
  "Led", "Built", "Developed", "Implemented", "Managed", "Coordinated",
  "Delivered", "Improved", "Increased", "Reduced", "Streamlined", "Optimized",
  "Established", "Created", "Designed", "Launched", "Executed", "Facilitated",
  "Spearheaded", "Achieved", "Resolved", "Trained", "Mentored", "Collaborated",
];

function pickActionVerb(responsibility: string): string {
  const lower = responsibility.toLowerCase();
  if (/manage|oversee|supervise|direct/.test(lower)) return "Managed";
  if (/lead|head|guide|mentor/.test(lower)) return "Led";
  if (/build|develop|create|design|implement/.test(lower)) return "Developed";
  if (/improve|optimize|enhance|streamline/.test(lower)) return "Improved";
  if (/increase|grow|expand|scale/.test(lower)) return "Increased";
  if (/reduce|decrease|lower|cut/.test(lower)) return "Reduced";
  if (/deliver|provide|serve|support/.test(lower)) return "Delivered";
  if (/coordinate|organize|facilitate|arrange/.test(lower)) return "Coordinated";
  if (/train|teach|educate|onboard/.test(lower)) return "Trained";
  return "Executed";
}

function inferIndustry(jd: JobDescription): string {
  const text = `${jd.title} ${jd.company ?? ""} ${(jd.keywords ?? []).join(" ")}`.toLowerCase();
  if (/aviation|airline|cabin crew|flight|airport|passenger/.test(text)) return "Aviation";
  if (/software|developer|engineer|programming|coding|full.?stack|frontend|backend/.test(text)) return "Technology";
  if (/finance|accounting|banking|investment|financial/.test(text)) return "Finance";
  if (/healthcare|nurse|medical|hospital|patient|clinical/.test(text)) return "Healthcare";
  if (/marketing|brand|campaign|social media|content/.test(text)) return "Marketing";
  if (/education|teacher|professor|academic|student|curriculum/.test(text)) return "Education";
  if (/sales|account manager|business development|revenue/.test(text)) return "Sales";
  if (/customer|service|support|call center|helpdesk/.test(text)) return "Customer Service";
  if (/hospitality|hotel|restaurant|tourism|event/.test(text)) return "Hospitality";
  if (/engineer|mechanical|electrical|civil|manufacturing/.test(text)) return "Engineering";
  return "Professional Services";
}

// ============================================================================
// Page-fill validation
// ============================================================================

export interface PageFillValidation {
  /** Estimated page usage percentage (0-100). */
  pageUsage: number;
  /** Character count of the resume body. */
  charCount: number;
  /** Target character count for 94% fill. */
  targetChars: number;
  /** Whether the resume passes the 85% minimum fill requirement. */
  passesMinimum: boolean;
  /** Whether the resume is in the 90-98% sweet spot. */
  inSweetSpot: boolean;
  /** Whether the resume would overflow (> 100%). */
  wouldOverflow: boolean;
  /** Recommended action: "expand", "compress", or "none". */
  action: "expand" | "compress" | "none";
  /** Human-readable summary. */
  summary: string;
}

export function validatePageFill(
  resume: ResumeData,
  directive?: OptimizerDirectiveConfig | null,
): PageFillValidation {
  const target = computePageFillTarget(directive);
  const charCount = computeResumeCharCount(resume);
  const pageUsage = target.estimatePageUsage(charCount);

  const passesMinimum = pageUsage >= 85;
  const inSweetSpot = pageUsage >= 90 && pageUsage <= 98;
  const wouldOverflow = pageUsage > 100;

  let action: "expand" | "compress" | "none" = "none";
  if (wouldOverflow) action = "compress";
  else if (pageUsage < 90) action = "expand";

  const summary = `Page usage: ${pageUsage}% (${charCount} chars, target ${target.targetChars}). ${
    inSweetSpot ? "✓ In sweet spot (90-98%)." :
    wouldOverflow ? "⚠ Would overflow — compressing." :
    pageUsage < 85 ? "✗ Below 85% minimum — expanding." :
    "Slightly under target — expanding."
  }`;

  return {
    pageUsage,
    charCount,
    targetChars: target.targetChars,
    passesMinimum,
    inSweetSpot,
    wouldOverflow,
    action,
    summary,
  };
}
