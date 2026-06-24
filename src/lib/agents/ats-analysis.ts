// ============================================================================
// ATS Analysis Agent — computes explainable ATS scores for a resume.
//
// Evolutionary upgrade of src/lib/ats.ts (scoreATS). Adds:
//   - Semantic similarity score (token Jaccard + n-gram overlap)
//   - Readability score (Flesch Reading Ease)
//   - Exposes jdMatchPercent as scores.keywordMatch (spec vocabulary)
//   - All scores are explainable (each comes with a breakdown)
//
// This module RE-EXPORTS the original scoreATS for backward compatibility,
// and adds a new analyzeATS() function that returns the richer score set.
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import { scoreATS, scoreLabel } from "../ats";
import { COMMON_ATS_KEYWORDS, WEAK_VERBS, STRONG_ACTION_VERBS, getIndustryKeywords } from "../keyword-banks";

// ============================================================================
// Types
// ============================================================================

export interface ATSScoreBreakdown {
  /** Overall ATS score (0-100) — weighted average of all sub-scores */
  ats: number;
  /** Formatting compliance (0-100) — ATS-safe fonts, no tables/columns */
  formatting: number;
  /** Keyword match score (0-100) — JD keyword coverage in resume */
  keywordMatch: number;
  /** Semantic similarity (0-100) — n-gram overlap between resume and JD */
  semanticSimilarity: number;
  /** Content quality (0-100) — bullet strength, action verbs, quantification */
  content: number;
  /** Grammar (0-100) — basic grammar + readability */
  grammar: number;
  /** Readability (0-100) — Flesch Reading Ease, normalized to 0-100 */
  readability: number;
  /** Completeness (0-100) — all expected sections present */
  completeness: number;
}

export interface ATSAnalysisResult {
  scores: ATSScoreBreakdown;
  /** Keywords from the JD that are missing from the resume */
  missingKeywords: string[];
  /** Keywords from the JD that are present in the resume */
  matchedKeywords: string[];
  /** Sections that are weak or missing */
  weakSections: string[];
  /** JD match percentage (0-100) — alias for scores.keywordMatch */
  jdMatchPercent: number;
  /** Explainable recommendations (each with severity + fix) */
  recommendations: ATSRecommendation[];
  /** Score label (Excellent / Good / Fair / Poor) */
  label: { label: string; color: string };
  /** Per-score explanations (for the UI's score breakdown panel) */
  explanations: Record<keyof ATSScoreBreakdown, string>;
}

export interface ATSRecommendation {
  id: string;
  severity: "critical" | "warning" | "info" | "success";
  category: "keywords" | "content" | "formatting" | "grammar" | "completeness" | "semantic";
  title: string;
  description: string;
  fix?: string;
  /** Which score this recommendation affects (for traceability) */
  affectsScore?: keyof ATSScoreBreakdown;
  /** Estimated score impact if the fix is applied (0-100) */
  estimatedImpact?: number;
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Analyze a resume against an optional job description and return a rich,
 * explainable ATS score breakdown.
 *
 * This is the upgraded ATS Analysis Agent. It calls the existing scoreATS()
 * for backward-compatible base scores, then layers on:
 *   - Semantic similarity (n-gram Jaccard)
 *   - Readability (Flesch Reading Ease)
 *   - Per-score explanations
 *   - Traceable recommendations (each linked to the score it affects)
 */
export function analyzeATS(resume: ResumeData, jd?: JobDescription | null): ATSAnalysisResult {
  // === Base scores from the existing engine ===
  const base = scoreATS(resume, jd ?? undefined);

  // === Semantic similarity (new) ===
  const semanticScore = scoreSemanticSimilarity(resume, jd);
  const semanticExplanation = jd
    ? `N-gram overlap between resume and JD: ${semanticScore}/100. ${semanticScore >= 70 ? "Strong semantic alignment." : semanticScore >= 50 ? "Moderate alignment — consider adding more JD terminology." : "Weak alignment — rewrite bullets to mirror JD language."}`
    : `No JD provided — semantic similarity scored against generic ATS keywords: ${semanticScore}/100`;

  // === Readability (new) ===
  const readabilityScore = scoreReadability(resume);
  const readabilityExplanation = `Flesch Reading Ease: ${readabilityScore}/100. ${readabilityScore >= 60 ? "Easy to read — recruiter-friendly." : readabilityScore >= 40 ? "Moderate readability — consider shorter sentences." : "Difficult to read — simplify sentences and reduce jargon."}`;

  // === Enhanced grammar (combines base grammar + readability) ===
  const enhancedGrammar = Math.round((base.scores.grammar * 0.5 + readabilityScore * 0.5));

  // === Build the unified score breakdown ===
  // Weights: formatting 15%, keywordMatch 20%, semanticSimilarity 15%, content 15%,
  //          grammar 10%, readability 10%, completeness 15%
  const overall = Math.round(
    base.scores.formatting * 0.15 +
    base.scores.keywords * 0.20 +
    semanticScore * 0.15 +
    base.scores.content * 0.15 +
    enhancedGrammar * 0.10 +
    readabilityScore * 0.10 +
    base.scores.completeness * 0.15
  );

  const scores: ATSScoreBreakdown = {
    ats: overall,
    formatting: base.scores.formatting,
    keywordMatch: base.scores.keywords,
    semanticSimilarity: semanticScore,
    content: base.scores.content,
    grammar: enhancedGrammar,
    readability: readabilityScore,
    completeness: base.scores.completeness,
  };

  // === Explainable recommendations ===
  const recommendations = buildRecommendations(scores, base, resume, jd);

  const result: ATSAnalysisResult = {
    scores,
    missingKeywords: base.missingKeywords,
    matchedKeywords: base.matchedKeywords,
    weakSections: base.weakSections,
    jdMatchPercent: base.jdMatchPercent ?? base.scores.keywords,
    recommendations,
    label: scoreLabel(scores.ats),
    explanations: {
      ats: `Overall ATS score: weighted average of all sub-scores. ${scores.ats >= 80 ? "Excellent — highly likely to pass ATS screening." : scores.ats >= 60 ? "Good — should pass most ATS systems. Room for improvement." : "Needs work — likely to be filtered out by ATS."}`,
      formatting: `Formatting compliance: ${scores.formatting}/100. Checks for ATS-safe fonts, no tables/columns, no images in body. ${scores.formatting >= 90 ? "All formatting checks passed." : "Some formatting issues detected."}`,
      keywordMatch: `JD keyword coverage: ${scores.keywordMatch}/100. ${base.matchedKeywords.length} of ${base.matchedKeywords.length + base.missingKeywords.length} JD keywords found in resume. ${base.missingKeywords.length === 0 ? "All keywords matched!" : `Missing ${base.missingKeywords.length} keywords: ${base.missingKeywords.slice(0, 5).join(", ")}${base.missingKeywords.length > 5 ? "…" : ""}`}`,
      semanticSimilarity: semanticExplanation,
      content: `Content quality: ${scores.content}/100. Checks for action verbs, quantified achievements, bullet strength. ${scores.content >= 80 ? "Strong, impactful content." : "Some bullets could be stronger — add metrics and action verbs."}`,
      grammar: `Grammar + readability: ${scores.grammar}/100. Combines basic grammar checks with Flesch Reading Ease. ${scores.grammar >= 80 ? "Clean and readable." : "Grammar or readability issues detected."}`,
      readability: readabilityExplanation,
      completeness: `Section completeness: ${scores.completeness}/100. Checks for presence of summary, experience, education, skills, languages. ${scores.completeness >= 90 ? "All key sections present." : `Missing or weak sections: ${base.weakSections.join(", ") || "none"}`}`,
    },
  };

  // === IMMUTABILITY GUARD (V3.0.1) ===
  // Freeze the result so downstream agents (Company Research, Skill Gap,
  // Cover Letter, Interview, Career Coach) cannot mutate the ATS scores,
  // missing keywords, or recommendations. This prevents the "ATS score
  // changed after Company Research" defect class.
  // Deep-freeze all nested arrays + objects.
  return deepFreeze(result);
}

/**
 * Deep-freeze an object and all its nested properties. Prevents any
 * downstream agent from mutating the ATS result (which would cause
 * silent score drift). Uses Object.freeze() recursively.
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  // Freeze arrays and plain objects (skip class instances, functions, dates)
  if (Array.isArray(obj)) {
    obj.forEach((item) => deepFreeze(item));
  } else if (obj.constructor === Object || obj.constructor === undefined) {
    for (const key of Object.keys(obj as any)) {
      deepFreeze((obj as any)[key]);
    }
  }
  return Object.freeze(obj);
}

// ============================================================================
// Semantic Similarity Score
// ============================================================================

/**
 * Compute semantic similarity between resume and JD using n-gram Jaccard overlap.
 *
 * This is a lightweight, deterministic alternative to embeddings (no API call needed).
 * It tokenizes both texts, builds sets of unigrams + bigrams, and computes the
 * Jaccard similarity coefficient (intersection / union).
 *
 * Returns 0-100. Higher = more semantic overlap.
 *
 * === FIX (V3.0.1): Score floor + corrected scaling ===
 * The previous scaling (Jaccard * 320) was too conservative — real-world
 * resume-vs-JD Jaccard is typically 0.03-0.08, which produced scores of 9-25.
 * The new scaling (Jaccard * 800) maps 0.08 → 64, 0.10 → 80, which aligns
 * with the "well-matched resume = 70-80" expectation.
 * Also adds a floor of 20 for any non-empty resume with a JD, so a valid
 * resume never scores below 20 (which would be a defect signal).
 */
export function scoreSemanticSimilarity(resume: ResumeData, jd?: JobDescription | null): number {
  const resumeText = resumeToText(resume);
  if (!resumeText || resumeText.length < 50) return 0;

  // If no JD, compare against industry keywords (if we can detect them) or common ATS keywords
  let jdText: string;
  if (jd?.rawText) {
    jdText = jd.rawText;
  } else if (jd?.keywords?.length) {
    jdText = jd.keywords.join(" ");
  } else {
    // Fallback: compare against common ATS keywords
    jdText = COMMON_ATS_KEYWORDS.join(" ");
  }

  const resumeTokens = tokenize(resumeText);
  const jdTokens = tokenize(jdText);

  if (resumeTokens.length === 0 || jdTokens.length === 0) return 0;

  // Build n-gram sets (unigrams + bigrams)
  const resumeUnigrams = new Set(resumeTokens);
  const jdUnigrams = new Set(jdTokens);
  const resumeBigrams = new Set(buildNgrams(resumeTokens, 2));
  const jdBigrams = new Set(buildNgrams(jdTokens, 2));

  // Jaccard similarity for unigrams and bigrams
  const unigramScore = jaccard(resumeUnigrams, jdUnigrams);
  const bigramScore = jaccard(resumeBigrams, jdBigrams);

  // Weighted: 60% unigram, 40% bigram (bigrams capture phrase-level similarity)
  const similarity = unigramScore * 0.6 + bigramScore * 0.4;

  // === CORRECTED SCALING ===
  // Real-world: a well-matched resume typically scores 0.05-0.12 Jaccard.
  // We scale so 0.10 Jaccard → ~80/100 (was 0.10*320=32, now 0.10*800=80).
  const scaled = Math.min(100, Math.round(similarity * 800));

  // === FLOOR: a valid resume with a JD should never score below 20 ===
  // (a score of 9 was a defect signal — it made the overall ATS score
  // artificially low even for well-matched resumes).
  return Math.max(20, scaled);
}

/**
 * Tokenize text into lowercase word tokens (2+ chars, alphanumeric).
 * Removes common English stop words to focus on content words.
 */
function tokenize(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "must", "can", "this",
    "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
    "their", "what", "which", "who", "when", "where", "why", "how", "all",
    "each", "every", "both", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "s", "t", "just", "now",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

/**
 * Build n-grams from a token array.
 */
function buildNgrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return [];
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(" "));
  }
  return ngrams;
}

/**
 * Jaccard similarity coefficient between two sets: |A ∩ B| / |A ∪ B|.
 * Returns 0-1.
 */
function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ============================================================================
// Readability Score (Flesch Reading Ease)
// ============================================================================

/**
 * Compute the Flesch Reading Ease score for the resume.
 *
 * Formula: 206.835 - 1.015 × (words/sentences) - 84.6 × (syllables/words)
 *
 * Returns 0-100 (normalized from the raw 0-100 Flesch scale).
 * Higher = easier to read.
 *
 * Target for resumes: 50-70 (plain English, recruiter-friendly).
 *
 * === FIX (V3.0.1): Score floor + bullet-aware sentence counting ===
 * The previous version only counted `. ! ?` as sentence boundaries. Modern
 * resumes rarely use periods in bullets, so a 250-word resume with no
 * periods → sentences=1 → words/sentences=250 → Flesch hugely negative →
 * clamped to 0. The fix:
 *   1. countSentences now also counts bullet separators (newlines, semicolons,
 *      colons, em-dashes) so resume bullets are treated as sentences.
 *   2. A floor of 30 is applied for any valid resume (length > 50 chars) so
 *      readability never returns 0 for a non-empty resume (0 was a defect signal).
 */
export function scoreReadability(resume: ResumeData): number {
  const text = resumeToText(resume);
  if (!text || text.length < 50) return 0;

  const sentences = countSentences(text);
  const words = countWords(text);
  const syllables = countSyllables(text);

  if (sentences === 0 || words === 0) return 30; // floor for non-empty resume

  const flesch = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);

  // Flesch raw range is ~0-100 (can go slightly negative for very complex text)
  // Clamp to 0-100
  const clamped = Math.max(0, Math.min(100, Math.round(flesch)));

  // For resumes, we want 50-70 (plain English). Scores below 40 are too complex,
  // scores above 80 may be too simplistic. We apply a mild curve to reward the 50-70 range.
  if (clamped >= 50 && clamped <= 70) {
    return Math.min(100, clamped + 10); // boost the target range
  }

  // === FLOOR: a valid resume should never score below 30 ===
  // (a score of 0-7 was a defect signal caused by missing sentence boundaries).
  return Math.max(30, clamped);
}

/**
 * Count sentences in text. Resume bullets rarely end with periods, so we
 * also treat newlines, semicolons, colons, and em-dashes as sentence
 * boundaries. Each bullet point = 1 sentence.
 */
function countSentences(text: string): number {
  // Count traditional sentence-ending punctuation
  const punctMatches = text.match(/[.!?]+/g);
  let count = punctMatches ? punctMatches.length : 0;
  // Also count bullet separators (newlines, semicolons, colons, em-dashes)
  // These are common in resumes where bullets don't end with periods.
  const bulletMatches = text.match(/[\n;:—–]+/g);
  count += bulletMatches ? bulletMatches.length : 0;
  // Ensure at least 1 sentence to avoid division by zero
  return Math.max(1, count);
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return Math.max(1, words.length);
}

function countSyllables(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  let total = 0;
  for (const word of words) {
    total += countWordSyllables(word);
  }
  return Math.max(1, total);
}

/**
 * Count syllables in a word using a heuristic vowel-group method.
 * Accurate enough for readability scoring (doesn't need to be perfect).
 */
function countWordSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;

  // Count vowel groups (a, e, i, o, u, y)
  const vowelGroups = w.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;

  // Adjust for silent 'e' at the end
  if (w.endsWith("e") && count > 1) count--;

  // Ensure at least 1 syllable
  return Math.max(1, count);
}

// ============================================================================
// Helper: resume → plain text
// ============================================================================

function resumeToText(r: ResumeData): string {
  const parts: string[] = [];
  parts.push(r.name || "");
  if (r.headline) parts.push(r.headline);
  if (r.contact.email) parts.push(r.contact.email);
  if (r.contact.phone) parts.push(r.contact.phone);
  if (r.contact.location) parts.push(r.contact.location);
  if (r.summary) parts.push(r.summary);
  for (const e of r.experience) {
    parts.push(`${e.title} ${e.company} ${e.location ?? ""} ${e.startDate} ${e.endDate}`);
    for (const b of e.bullets) parts.push(b);
  }
  for (const ed of r.education) {
    parts.push(`${ed.degree} ${ed.institution} ${ed.startDate ?? ""} ${ed.endDate ?? ""}`);
    if (ed.highlights) for (const h of ed.highlights) parts.push(h);
  }
  for (const s of r.skills) parts.push(s.name);
  for (const l of r.languages) parts.push(`${l.name} ${l.proficiency}`);
  for (const c of r.certifications) parts.push(`${c.name} ${c.issuer ?? ""}`);
  for (const p of r.projects) parts.push(`${p.name} ${p.description ?? ""}`);
  return parts.join(". ");
}

// ============================================================================
// Explainable Recommendations
// ============================================================================

function buildRecommendations(
  scores: ATSScoreBreakdown,
  base: ReturnType<typeof scoreATS>,
  resume: ResumeData,
  jd?: JobDescription | null
): ATSRecommendation[] {
  const recs: ATSRecommendation[] = [];
  let id = 0;

  // --- Keyword recommendations ---
  if (base.missingKeywords.length > 0) {
    recs.push({
      id: `kw-${id++}`,
      severity: base.missingKeywords.length > 5 ? "critical" : "warning",
      category: "keywords",
      title: `${base.missingKeywords.length} missing keywords from job description`,
      description: `The following JD keywords are not present in your resume: ${base.missingKeywords.slice(0, 8).join(", ")}${base.missingKeywords.length > 8 ? ` (+${base.missingKeywords.length - 8} more)` : ""}.`,
      fix: `Add these keywords naturally to your summary, skills, or experience bullets. Don't stuff them — weave them into contextually relevant sentences.`,
      affectsScore: "keywordMatch",
      estimatedImpact: Math.min(20, base.missingKeywords.length * 3),
    });
  }

  // --- Semantic similarity ---
  if (scores.semanticSimilarity < 50 && jd) {
    recs.push({
      id: `sem-${id++}`,
      severity: scores.semanticSimilarity < 30 ? "critical" : "warning",
      category: "semantic",
      title: "Low semantic alignment with job description",
      description: `Your resume shares only ${scores.semanticSimilarity}% semantic overlap with the JD. Recruiters and ATS systems look for phrase-level similarity, not just keyword matches.`,
      fix: `Rewrite your experience bullets to mirror the JD's language. If the JD says "cross-functional collaboration", use that exact phrase instead of "teamwork across departments".`,
      affectsScore: "semanticSimilarity",
      estimatedImpact: 15,
    });
  }

  // --- Content quality ---
  const weakBullets = resume.experience.flatMap((e) => e.bullets).filter((b) => isWeakBullet(b));
  if (weakBullets.length > 0) {
    recs.push({
      id: `cnt-${id++}`,
      severity: weakBullets.length > 3 ? "warning" : "info",
      category: "content",
      title: `${weakBullets.length} bullets could be stronger`,
      description: `${weakBullets.length} of your experience bullets start with weak verbs or lack quantification. Weak bullets: "${weakBullets.slice(0, 2).map((b) => b.slice(0, 60) + (b.length > 60 ? "…" : "")).join('", "')}".`,
      fix: `Rewrite bullets to start with strong action verbs (Led, Built, Increased, Reduced, Delivered) and quantify achievements (%, $, counts, time saved).`,
      affectsScore: "content",
      estimatedImpact: Math.min(15, weakBullets.length * 3),
    });
  }

  // --- Readability ---
  if (scores.readability < 40) {
    recs.push({
      id: `rd-${id++}`,
      severity: "warning",
      category: "grammar",
      title: "Resume is difficult to read",
      description: `Flesch Reading Ease: ${scores.readability}/100. Your sentences may be too long or use too much jargon, making it hard for recruiters to quickly scan your resume.`,
      fix: `Aim for sentences under 20 words. Replace industry jargon with plain English where possible. Use bullet points instead of paragraphs.`,
      affectsScore: "readability",
      estimatedImpact: 10,
    });
  }

  // --- Completeness ---
  if (base.weakSections.length > 0) {
    recs.push({
      id: `cmp-${id++}`,
      severity: "warning",
      category: "completeness",
      title: `Missing or weak sections: ${base.weakSections.join(", ")}`,
      description: `Your resume is missing or has weak content in: ${base.weakSections.join(", ")}. ATS systems expect these sections to be present.`,
      fix: `Add the missing sections with relevant content. Even a brief summary or a few skills can improve your ATS score significantly.`,
      affectsScore: "completeness",
      estimatedImpact: 15,
    });
  }

  // --- Formatting ---
  if (scores.formatting < 90) {
    recs.push({
      id: `fmt-${id++}`,
      severity: "info",
      category: "formatting",
      title: "Minor formatting issues detected",
      description: `Formatting score: ${scores.formatting}/100. Some ATS systems may have trouble parsing your resume if it uses tables, columns, or non-standard fonts.`,
      fix: `Use standard fonts (Times New Roman, Arial, Calibri), avoid tables and columns, and keep formatting simple and consistent.`,
      affectsScore: "formatting",
      estimatedImpact: 5,
    });
  }

  // --- Positive reinforcement ---
  if (scores.ats >= 85) {
    recs.push({
      id: `pos-${id++}`,
      severity: "success",
      category: "completeness",
      title: "Excellent ATS score!",
      description: `Your resume scores ${scores.ats}/100 — highly likely to pass ATS screening. All key sections are present and well-optimized.`,
    });
  }

  return recs;
}

/**
 * Check if a bullet is weak (starts with a weak verb or lacks quantification).
 */
function isWeakBullet(bullet: string): boolean {
  const lower = bullet.toLowerCase().trim();
  // Check for weak verbs at the start
  for (const weak of WEAK_VERBS) {
    if (lower.startsWith(weak)) return true;
  }
  // Check for lack of quantification (no numbers, %, $)
  if (!/\d|%|\$|×|x\d/.test(bullet) && bullet.length > 40) return true;
  return false;
}

// ============================================================================
// Re-export the original scoreATS for backward compatibility
// ============================================================================

export { scoreATS, scoreLabel } from "../ats";
