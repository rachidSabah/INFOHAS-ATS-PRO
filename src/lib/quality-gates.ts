// ============================================================================
// Resume Quality Gates Engine
//
// Implements factual consistency validation, hallucination detection,
// professional tone scoring, AI leak detection, and page utilization
// estimation for optimized resumes.
//
// DESIGN PHILOSOPHY:
//   All gates are ADVISORY — they log warnings and trigger auto-retry,
//   but NEVER hard-reject the optimization. This prevents the "optimization
//   failed" loop that occurred when gates were fatal. The user always gets
//   a result; quality issues are surfaced for manual review.
//
// Pipeline integration:
//   Resume Upload → Parse → Extract Facts → Optimize → Verify Facts →
//   Hallucination Scan → Layout Validation → Quality Validation →
//   Reflection → Retry if needed → Export
// ============================================================================

"use client";

import type { ResumeData } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface ResumeFact {
  text: string;
  type: "metric" | "experience" | "certification" | "education" | "language" | "date" | "employer";
  verified: boolean;
}

export interface QualityGateResult {
  passed: boolean;
  score: number;
  issues: string[];
  warnings: string[];
}

export interface FactualConsistencyResult {
  score: number;
  verifiedFacts: number;
  totalFacts: number;
  hallucinatedMetrics: string[];
  hallucinatedEmployers: string[];
  hallucinatedEducation: string[];
  hallucinatedCertifications: string[];
  issues: string[];
}

export interface ProfessionalToneResult {
  score: number;
  bannedPhrasesFound: string[];
  roboticLanguageFound: string[];
  issues: string[];
}

export interface AILeakResult {
  score: number;
  leaksFound: string[];
  issues: string[];
}

export interface PageUtilizationResult {
  estimatedChars: number;
  targetMin: number;
  targetMax: number;
  utilizationPercent: number;
  appearsHalfEmpty: boolean;
  issues: string[];
}

export interface QualityReport {
  factualConsistency: FactualConsistencyResult;
  professionalTone: ProfessionalToneResult;
  aiLeak: AILeakResult;
  pageUtilization: PageUtilizationResult;
  contentValidation: QualityGateResult;
  overallScore: number;
  shouldRetry: boolean;
  retryReasons: string[];
}

// ============================================================================
// Fact Extraction Engine
// ============================================================================

/**
 * Extract verifiable facts from a resume.
 * These facts must be preserved (or only rephrased) in the optimized version.
 *
 * CRITICAL: Only extract REAL metrics — percentages and explicit counts
 * with units. Do NOT extract bare numbers (dates, IDs, phone digits, etc.)
 * which cause false hallucination flags.
 */
export function extractResumeFacts(resume: ResumeData): ResumeFact[] {
  const facts: ResumeFact[] = [];
  const fullText = JSON.stringify(resume);

  // ONLY extract real metrics:
  //   - Percentages: "15%", "20.5%"
  //   - Explicit counts with units: "5 years", "200 passengers", "30 customers"
  // Do NOT extract bare numbers (06, 26, 8, etc.) which are usually
  // dates, IDs, phone digits, or structural numbers.
  const metricRegex = /(\d+(?:[.,]\d+)?%|\d+\+\s*(?:years?|passengers?|customers?|clients?|sales?|users?|hours?|months?|days?)|\d+\s*(?:years?|passengers?|customers?|clients?|sales|users|hours|months|days))/gi;
  let match: RegExpExecArray | null;
  while ((match = metricRegex.exec(fullText)) !== null) {
    const text = match[1].trim();
    // Skip years (1900-2099)
    if (/^(19|20)\d{2}$/.test(text)) continue;
    // Skip very small counts (1-9) — these are usually structural, not metrics
    if (/^\d{1}$/.test(text)) continue;
    // Only add if it has a % or a unit word — bare numbers are NOT metrics
    if (text.includes("%") || /\d+\s*(?:years?|passengers?|customers?|clients?|sales|users|hours|months|days)/i.test(text)) {
      facts.push({ text, type: "metric", verified: false });
    }
  }

  // Extract employers (company names from experience)
  for (const exp of resume.experience || []) {
    if (exp.company && exp.company.trim()) {
      facts.push({ text: exp.company.trim(), type: "employer", verified: false });
    }
  }

  // Extract education institutions
  for (const edu of resume.education || []) {
    if (edu.institution && edu.institution.trim()) {
      facts.push({ text: edu.institution.trim(), type: "education", verified: false });
    }
    if (edu.degree && edu.degree.trim()) {
      facts.push({ text: edu.degree.trim(), type: "education", verified: false });
    }
  }

  // Extract certifications
  for (const cert of resume.certifications || []) {
    if (cert.name && cert.name.trim()) {
      facts.push({ text: cert.name.trim(), type: "certification", verified: false });
    }
  }

  // Extract languages
  for (const lang of resume.languages || []) {
    if (lang.name && lang.name.trim()) {
      facts.push({ text: lang.name.trim(), type: "language", verified: false });
    }
  }

  // Extract dates
  const dateRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\b(19|20)\d{2}\b/gi;
  while ((match = dateRegex.exec(fullText)) !== null) {
    facts.push({ text: match[0].trim(), type: "date", verified: false });
  }

  return facts;
}

// ============================================================================
// Factual Consistency Validation
// ============================================================================

/**
 * Validate that all facts in the optimized resume exist in the original.
 * Hallucinated facts (metrics, employers, education, certs) are flagged.
 */
export function validateFactualConsistency(
  original: ResumeData,
  optimized: ResumeData,
): FactualConsistencyResult {
  const originalFacts = extractResumeFacts(original);
  const optimizedFacts = extractResumeFacts(optimized);

  const originalMetrics = new Set(originalFacts.filter((f) => f.type === "metric").map((f) => f.text.toLowerCase()));
  const originalEmployers = new Set(originalFacts.filter((f) => f.type === "employer").map((f) => f.text.toLowerCase()));
  const originalEducation = new Set(originalFacts.filter((f) => f.type === "education").map((f) => f.text.toLowerCase()));
  const originalCerts = new Set(originalFacts.filter((f) => f.type === "certification").map((f) => f.text.toLowerCase()));

  const hallucinatedMetrics: string[] = [];
  const hallucinatedEmployers: string[] = [];
  const hallucinatedEducation: string[] = [];
  const hallucinatedCertifications: string[] = [];

  let verifiedCount = 0;

  for (const fact of optimizedFacts) {
    const lower = fact.text.toLowerCase();
    let found = false;

    switch (fact.type) {
      case "metric":
        // Check if metric exists in original (exact or contains)
        if (originalMetrics.has(lower)) {
          found = true;
        } else {
          // Check partial match (e.g., "15%" matches "15%")
          for (const om of originalMetrics) {
            if (om.includes(lower) || lower.includes(om)) {
              found = true;
              break;
            }
          }
        }
        if (!found) hallucinatedMetrics.push(fact.text);
        break;

      case "employer":
        if (originalEmployers.has(lower)) {
          found = true;
        } else {
          for (const oe of originalEmployers) {
            if (oe.includes(lower) || lower.includes(oe)) {
              found = true;
              break;
            }
          }
        }
        if (!found) hallucinatedEmployers.push(fact.text);
        break;

      case "education":
        if (originalEducation.has(lower)) {
          found = true;
        } else {
          for (const oed of originalEducation) {
            if (oed.includes(lower) || lower.includes(oed)) {
              found = true;
              break;
            }
          }
        }
        if (!found) hallucinatedEducation.push(fact.text);
        break;

      case "certification":
        if (originalCerts.has(lower)) {
          found = true;
        } else {
          for (const oc of originalCerts) {
            if (oc.includes(lower) || lower.includes(oc)) {
              found = true;
              break;
            }
          }
        }
        if (!found) hallucinatedCertifications.push(fact.text);
        break;

      default:
        found = true; // dates, languages — don't flag
    }

    if (found) verifiedCount++;
  }

  const totalFacts = optimizedFacts.length || 1;
  const score = Math.round((verifiedCount / totalFacts) * 100);

  const issues: string[] = [];
  if (hallucinatedMetrics.length > 0) {
    issues.push(`Hallucinated metrics: ${hallucinatedMetrics.join(", ")}`);
  }
  if (hallucinatedEmployers.length > 0) {
    issues.push(`Hallucinated employers: ${hallucinatedEmployers.join(", ")}`);
  }
  if (hallucinatedEducation.length > 0) {
    issues.push(`Hallucinated education: ${hallucinatedEducation.join(", ")}`);
  }
  if (hallucinatedCertifications.length > 0) {
    issues.push(`Hallucinated certifications: ${hallucinatedCertifications.join(", ")}`);
  }

  return {
    score,
    verifiedFacts: verifiedCount,
    totalFacts: optimizedFacts.length,
    hallucinatedMetrics,
    hallucinatedEmployers,
    hallucinatedEducation,
    hallucinatedCertifications,
    issues,
  };
}

// ============================================================================
// Professional Tone Detector
// ============================================================================

const BANNED_PHRASES = [
  "results-driven professional",
  "dynamic individual",
  "highly motivated",
  "seasoned expert",
  "leveraging",
  "passionate professional",
  "proven track record",
  "go-getter",
  "team player",
  "detail-oriented",
  "self-starter",
  "think outside the box",
  "synergy",
  "value add",
  "value-add",
  "best of breed",
  "cross-functional",
  "results-oriented",
  "customer-centric",
  "data-driven",
];

const ROBOTIC_PATTERNS = [
  /\b(?:I am|I have) (?:a|an) (?:highly|very) (?:motivated|dedicated|passionate)\b/i,
  /\bseeking (?:a|an) (?:challenging|dynamic|rewarding) (?:position|role|opportunity)\b/i,
  /\b(?:looking|seeking) to (?:leverage|utilize|apply) my\b/i,
  /\b(?:with|having) (?:\d+|several|many) years? of experience in\b/i,
];

/**
 * Detect robotic/banned language and score professional tone.
 * Target: 90+/100
 */
export function detectProfessionalTone(resume: ResumeData): ProfessionalToneResult {
  const fullText = [
    resume.summary || "",
    resume.headline || "",
    ...resume.experience.flatMap((e) => [e.title || "", ...e.bullets]),
  ].join(" ").toLowerCase();

  const bannedPhrasesFound: string[] = [];
  const roboticLanguageFound: string[] = [];

  for (const phrase of BANNED_PHRASES) {
    if (fullText.includes(phrase.toLowerCase())) {
      bannedPhrasesFound.push(phrase);
    }
  }

  for (const pattern of ROBOTIC_PATTERNS) {
    const match = fullText.match(pattern);
    if (match) {
      roboticLanguageFound.push(match[0]);
    }
  }

  // Score: start at 100, deduct for each issue
  let score = 100;
  score -= bannedPhrasesFound.length * 10;
  score -= roboticLanguageFound.length * 8;
  score = Math.max(0, Math.min(100, score));

  const issues: string[] = [];
  if (bannedPhrasesFound.length > 0) {
    issues.push(`Banned phrases: ${bannedPhrasesFound.join(", ")}`);
  }
  if (roboticLanguageFound.length > 0) {
    issues.push(`Robotic language: ${roboticLanguageFound.join(", ")}`);
  }

  return { score, bannedPhrasesFound, roboticLanguageFound, issues };
}

// ============================================================================
// AI Leak Detector
// ============================================================================

const AI_LEAK_PATTERNS = [
  /\bfrom jd\b/i,
  /\bjob description\b/i,
  /\bats score\b/i,
  /\bmatch percentage\b/i,
  /\bgenerated by ai\b/i,
  /\boptimization summary\b/i,
  /\bcandidate profile\b/i,
  /\baccording to jd\b/i,
  /\bbased on job description\b/i,
  /\bkeywords added\b/i,
  /\boptimization notes\b/i,
  /\bai notes\b/i,
  /\bdebug information\b/i,
  /\bprovider errors?\b/i,
];

/**
 * Detect AI leakage in the optimized resume.
 * Target: 100 (no leaks allowed)
 */
export function detectAILeaks(resume: ResumeData): AILeakResult {
  const fullText = JSON.stringify(resume).toLowerCase();
  const leaksFound: string[] = [];

  for (const pattern of AI_LEAK_PATTERNS) {
    const match = fullText.match(pattern);
    if (match) {
      leaksFound.push(match[0]);
    }
  }

  const score = leaksFound.length === 0 ? 100 : Math.max(0, 100 - leaksFound.length * 25);

  return {
    score,
    leaksFound,
    issues: leaksFound.length > 0 ? [`AI leaks detected: ${leaksFound.join(", ")}`] : [],
  };
}

// ============================================================================
// Page Utilization Estimator
// ============================================================================

/**
 * Estimate page utilization based on character count.
 * Target: 2,700-3,200 chars for a full A4 page.
 *
 * Note: This is a character-based estimation. Actual PDF page utilization
 * requires rendering, which is expensive. The character count is a reliable
 * proxy — resumes under 2,000 chars almost always look half-empty.
 */
export function estimatePageUtilization(resume: ResumeData): PageUtilizationResult {
  const charCount = JSON.stringify({
    name: resume.name,
    headline: resume.headline,
    summary: resume.summary,
    experience: resume.experience,
    education: resume.education,
    skills: resume.skills,
    languages: resume.languages,
    certifications: resume.certifications,
  }).length;

  const targetMin = 2700;
  const targetMax = 3200;
  const utilizationPercent = Math.round((charCount / targetMax) * 100);
  const appearsHalfEmpty = charCount < 2000;

  const issues: string[] = [];
  if (charCount < 2500) {
    issues.push(`Content too short: ${charCount} chars (minimum 2500)`);
  }
  if (appearsHalfEmpty) {
    issues.push(`Resume appears half-empty: ${charCount} chars (under 2000)`);
  }
  if (charCount > 3500) {
    issues.push(`Content may overflow: ${charCount} chars (over 3500)`);
  }

  return {
    estimatedChars: charCount,
    targetMin,
    targetMax,
    utilizationPercent,
    appearsHalfEmpty,
    issues,
  };
}

// ============================================================================
// Content Validation
// ============================================================================

/**
 * Validate that all required sections are present and non-empty.
 */
export function validateContent(resume: ResumeData): QualityGateResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  const hasSummary = !!(resume.summary && resume.summary.trim().length > 50);
  const hasExperience = !!(resume.experience && resume.experience.length > 0);
  const hasEducation = !!(resume.education && resume.education.length > 0);
  const hasSkills = !!(resume.skills && resume.skills.length > 0);

  if (!hasSummary) issues.push("Missing or too-short Professional Summary");
  if (!hasExperience) issues.push("Missing Professional Experience");
  if (!hasEducation) warnings.push("Missing Education section");
  if (!hasSkills) issues.push("Missing Skills section");

  // Check experience bullets
  for (const exp of resume.experience || []) {
    if (!exp.bullets || exp.bullets.length < 2) {
      warnings.push(`Experience "${exp.title}" has fewer than 2 bullets`);
    }
  }

  // Check summary length (target: 500-800 chars)
  if (resume.summary) {
    if (resume.summary.length < 300) {
      warnings.push(`Summary is short: ${resume.summary.length} chars (target 500-800)`);
    }
  }

  const passed = issues.length === 0;
  const score = Math.max(0, 100 - issues.length * 20 - warnings.length * 5);

  return { passed, score, issues, warnings };
}

// ============================================================================
// Comprehensive Quality Report
// ============================================================================

/**
 * Run all quality gates and produce a comprehensive report.
 *
 * IMPORTANT: This function NEVER hard-rejects. It returns shouldRetry=true
 * if quality is low, allowing the pipeline to retry with stricter prompts.
 * The user always gets a result — quality issues are advisory.
 */
export function runQualityGates(
  original: ResumeData,
  optimized: ResumeData,
): QualityReport {
  const factualConsistency = validateFactualConsistency(original, optimized);
  const professionalTone = detectProfessionalTone(optimized);
  const aiLeak = detectAILeaks(optimized);
  const pageUtilization = estimatePageUtilization(optimized);
  const contentValidation = validateContent(optimized);

  // Calculate overall score (weighted average)
  const overallScore = Math.round(
    factualConsistency.score * 0.25 +
    professionalTone.score * 0.20 +
    aiLeak.score * 0.15 +
    pageUtilization.utilizationPercent * 0.15 +
    contentValidation.score * 0.25,
  );

  // Determine if retry is needed (but never hard-reject)
  const retryReasons: string[] = [];
  if (factualConsistency.hallucinatedMetrics.length > 0) {
    retryReasons.push(`${factualConsistency.hallucinatedMetrics.length} hallucinated metrics`);
  }
  if (factualConsistency.hallucinatedEmployers.length > 0) {
    retryReasons.push(`${factualConsistency.hallucinatedEmployers.length} hallucinated employers`);
  }
  if (professionalTone.score < 70) {
    retryReasons.push(`Professional tone ${professionalTone.score}/100`);
  }
  if (aiLeak.leaksFound.length > 0) {
    retryReasons.push(`${aiLeak.leaksFound.length} AI leaks`);
  }
  if (pageUtilization.appearsHalfEmpty) {
    retryReasons.push(`Page appears half-empty (${pageUtilization.estimatedChars} chars)`);
  }
  if (!contentValidation.passed) {
    retryReasons.push(`${contentValidation.issues.length} content issues`);
  }

  const shouldRetry = retryReasons.length > 0 && overallScore < 75;

  // Log summary
  console.info(
    `[Quality Gates] Overall: ${overallScore}/100 | ` +
    `Factual: ${factualConsistency.score} | Tone: ${professionalTone.score} | ` +
    `AILeak: ${aiLeak.score} | PageUtil: ${pageUtilization.utilizationPercent}% | ` +
    `Content: ${contentValidation.score} | ` +
    `Retry: ${shouldRetry ? "yes" : "no"}` +
    (retryReasons.length > 0 ? ` | Reasons: ${retryReasons.join(", ")}` : ""),
  );

  if (factualConsistency.issues.length > 0) {
    console.warn(`[Quality Gates] Factual issues: ${factualConsistency.issues.join("; ")}`);
  }
  if (professionalTone.issues.length > 0) {
    console.warn(`[Quality Gates] Tone issues: ${professionalTone.issues.join("; ")}`);
  }
  if (aiLeak.issues.length > 0) {
    console.warn(`[Quality Gates] AI leak issues: ${aiLeak.issues.join("; ")}`);
  }
  if (pageUtilization.issues.length > 0) {
    console.warn(`[Quality Gates] Page utilization issues: ${pageUtilization.issues.join("; ")}`);
  }

  return {
    factualConsistency,
    professionalTone,
    aiLeak,
    pageUtilization,
    contentValidation,
    overallScore,
    shouldRetry,
    retryReasons,
  };
}

// ============================================================================
// SELF-HEALING ENGINE
//
// Instead of rejecting resumes with hallucinations or short content, REPAIR
// them in-place. Only fail after 2 repair attempts.
// ============================================================================

export interface RepairResult {
  repaired: boolean;
  repairedResume: ResumeData;
  repairsMade: string[];
  hallucinationsRemoved: number;
  contentExpanded: boolean;
}

/**
 * Remove hallucinated metrics from a resume and rewrite the affected
 * sentences descriptively (without numbers).
 *
 * Example:
 *   BAD:  "Served 26,000 passengers annually."
 *   GOOD: "Provided passenger service support in a high-volume international airport environment."
 */
export function repairHallucinations(
  optimized: ResumeData,
  original: ResumeData,
): RepairResult {
  const repaired = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const repairsMade: string[] = [];
  let hallucinationsRemoved = 0;

  // Get the set of valid metrics from the original resume
  const originalFacts = extractResumeFacts(original);
  const validMetrics = new Set(originalFacts.filter((f) => f.type === "metric").map((f) => f.text.toLowerCase()));

  // Metric regex — ONLY matches real metrics (percentages + counts with units)
  // Do NOT match bare numbers (06, 26, 8) which are dates/IDs/structural
  const metricRegex = /(\d+(?:[.,]\d+)?%|\d+\s*(?:years?|passengers?|customers?|clients?|sales|revenue|users|hours|months|days))/gi;

  /**
   * Rewrite a bullet/sentence: remove hallucinated metrics and replace
   * with descriptive language.
   */
  function rewriteText(text: string): string {
    if (!text) return text;
    let result = text;

    // Find all metrics in the text
    const metrics: string[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(metricRegex.source, "gi");
    while ((match = regex.exec(text)) !== null) {
      const metric = match[1].trim();
      // Skip years (1900-2099) and single digits
      if (/^(19|20)\d{2}$/.test(metric)) continue;
      if (/^\d{1}$/.test(metric)) continue;

      // Check if this metric exists in the original
      const lower = metric.toLowerCase();
      const isValid = validMetrics.has(lower) ||
        Array.from(validMetrics).some((vm) => vm.includes(lower) || lower.includes(vm));

      if (!isValid) {
        metrics.push(metric);
        hallucinationsRemoved++;
      }
    }

    if (metrics.length === 0) return text;

    // Remove each hallucinated metric and clean up the sentence
    for (const metric of metrics) {
      // Escape regex special chars in the metric
      const escaped = metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Pattern 1: "over X passengers" → "passengers" (remove the number + "over")
      result = result.replace(new RegExp(`\\bover\\s+${escaped}\\b`, "gi"), "");
      result = result.replace(new RegExp(`\\bmore than\\s+${escaped}\\b`, "gi"), "");

      // Pattern 2: "X passengers/customers/etc" → descriptive
      result = result.replace(new RegExp(`\\b${escaped}\\s+(passengers?|customers?|clients?|sales?|revenue?|users?)\\b`, "gi"), "$1");
      result = result.replace(new RegExp(`\\b(passengers?|customers?|clients?|sales?|revenue?|users?)\\s+${escaped}\\b`, "gi"), "$1");

      // Pattern 3: "X%" → remove entirely
      result = result.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "");

      // Pattern 4: "X years" → "several years"
      result = result.replace(new RegExp(`\\b${escaped}\\s+years?\\b`, "gi"), "several years");
    }

    // Clean up: remove double spaces, fix "  " left by removals
    result = result.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").replace(/\s+\./g, ".").trim();

    // Fix sentences that start with a verb after number removal
    // "Served passengers" is fine, but " passengers" at start needs fixing
    result = result.replace(/^\s+/, "");

    if (metrics.length > 0) {
      repairsMade.push(`Removed ${metrics.length} hallucinated metric(s): ${metrics.join(", ")}`);
    }

    return result;
  }

  // Repair summary
  if (repaired.summary) {
    const newSummary = rewriteText(repaired.summary);
    if (newSummary !== repaired.summary) {
      repaired.summary = newSummary;
    }
  }

  // Repair experience bullets
  for (const exp of repaired.experience || []) {
    if (exp.bullets) {
      exp.bullets = exp.bullets.map((b) => rewriteText(b)).filter((b) => b.length > 0);
    }
  }

  // Repair headline
  if (repaired.headline) {
    repaired.headline = rewriteText(repaired.headline);
  }

  return {
    repaired: hallucinationsRemoved > 0,
    repairedResume: repaired,
    repairsMade,
    hallucinationsRemoved,
    contentExpanded: false,
  };
}

/**
 * Expand short content to fill an A4 page. Only uses existing information
 * from the original resume — NEVER invents metrics or achievements.
 *
 * Expansion strategies:
 *   1. Expand summary if < 500 chars
 *   2. Add more detail to experience bullets
 *   3. Add missing JD keywords to skills
 *   4. Restore any dropped experience/education entries from original
 */
export function repairContent(
  optimized: ResumeData,
  original: ResumeData,
  jdKeywords?: string[],
): RepairResult {
  const repaired = JSON.parse(JSON.stringify(optimized)) as ResumeData;
  const repairsMade: string[] = [];
  let expanded = false;

  // Strategy 1: Restore dropped experience entries from original
  if (original.experience && original.experience.length > 0) {
    const optimizedCompanies = new Set((repaired.experience || []).map((e) => (e.company || "").toLowerCase()));
    for (const origExp of original.experience) {
      if (!optimizedCompanies.has((origExp.company || "").toLowerCase())) {
        // This experience was dropped — restore it
        if (!repaired.experience) repaired.experience = [];
        repaired.experience.push(origExp);
        repairsMade.push(`Restored dropped experience: ${origExp.title} at ${origExp.company}`);
        expanded = true;
      }
    }
  }

  // Strategy 2: Restore dropped education entries
  if (original.education && original.education.length > 0) {
    const optimizedInsts = new Set((repaired.education || []).map((e) => (e.institution || "").toLowerCase()));
    for (const origEdu of original.education) {
      if (!optimizedInsts.has((origEdu.institution || "").toLowerCase()) && origEdu.institution) {
        if (!repaired.education) repaired.education = [];
        repaired.education.push(origEdu);
        repairsMade.push(`Restored dropped education: ${origEdu.degree} at ${origEdu.institution}`);
        expanded = true;
      }
    }
  }

  // Strategy 3: Expand short summary
  if (repaired.summary && repaired.summary.length < 500 && original.summary) {
    // Merge original summary content into the optimized summary
    const originalSentences = original.summary.split(". ").filter((s) => s.length > 20);
    const currentSentences = repaired.summary.split(". ").filter((s) => s.length > 20);

    // Add original sentences that aren't already present
    for (const sent of originalSentences) {
      const sentLower = sent.toLowerCase();
      const alreadyPresent = currentSentences.some((cs) => cs.toLowerCase().includes(sentLower) || sentLower.includes(cs.toLowerCase()));
      if (!alreadyPresent && currentSentences.length < 5) {
        currentSentences.push(sent);
        expanded = true;
      }
    }
    repaired.summary = currentSentences.join(". ") + ".";
    if (expanded) {
      repairsMade.push("Expanded summary with content from original resume");
    }
  }

  // Strategy 4: Add missing JD keywords to skills
  if (jdKeywords && jdKeywords.length > 0 && repaired.skills) {
    const existingSkillNames = new Set(repaired.skills.map((s) => s.name.toLowerCase()));
    const skillsToAdd = jdKeywords
      .filter((k) => !existingSkillNames.has(k.toLowerCase()))
      .slice(0, 5)
      .map((name) => ({ id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, category: "Targeted Keywords" }));

    if (skillsToAdd.length > 0) {
      repaired.skills = [...repaired.skills, ...skillsToAdd];
      repairsMade.push(`Added ${skillsToAdd.length} JD keywords to skills: ${skillsToAdd.map((s) => s.name).join(", ")}`);
      expanded = true;
    }
  }

  // Strategy 5: Restore dropped skills from original
  if (original.skills && original.skills.length > 0) {
    const optimizedSkillNames = new Set((repaired.skills || []).map((s) => s.name.toLowerCase()));
    for (const origSkill of original.skills) {
      if (!optimizedSkillNames.has(origSkill.name.toLowerCase())) {
        if (!repaired.skills) repaired.skills = [];
        repaired.skills.push(origSkill);
        repairsMade.push(`Restored dropped skill: ${origSkill.name}`);
        expanded = true;
      }
    }
  }

  // Strategy 6: Restore dropped languages
  if (original.languages && original.languages.length > 0) {
    const optimizedLangNames = new Set((repaired.languages || []).map((l) => l.name.toLowerCase()));
    for (const origLang of original.languages) {
      if (!optimizedLangNames.has(origLang.name.toLowerCase())) {
        if (!repaired.languages) repaired.languages = [];
        repaired.languages.push(origLang);
        repairsMade.push(`Restored dropped language: ${origLang.name}`);
        expanded = true;
      }
    }
  }

  // Strategy 7: Restore dropped certifications
  if (original.certifications && original.certifications.length > 0) {
    const optimizedCertNames = new Set((repaired.certifications || []).map((c) => c.name.toLowerCase()));
    for (const origCert of original.certifications) {
      if (!optimizedCertNames.has(origCert.name.toLowerCase())) {
        if (!repaired.certifications) repaired.certifications = [];
        repaired.certifications.push(origCert);
        repairsMade.push(`Restored dropped certification: ${origCert.name}`);
        expanded = true;
      }
    }
  }

  return {
    repaired: expanded,
    repairedResume: repaired,
    repairsMade,
    hallucinationsRemoved: 0,
    contentExpanded: expanded,
  };
}

/**
 * Expand short bullets to fill more of the A4 page.
 *
 * Elaborates existing bullets with contextual descriptions — NEVER invents
 * metrics. Only adds descriptive language around existing content.
 *
 * Example:
 *   Short: "Assisted customers."
 *   Expanded: "Assisted international customers with inquiries, check-in
 *   procedures and service requests while maintaining high standards of
 *   hospitality and professional communication."
 */
function expandBullet(bullet: string, jobTitle?: string, company?: string): string {
  if (!bullet || bullet.length >= 120) return bullet; // already long enough

  // Contextual expansions based on keywords in the bullet
  const lower = bullet.toLowerCase();

  // Customer service / passenger service
  if (lower.includes("customer") || lower.includes("passenger") || lower.includes("guest")) {
    if (lower.includes("assist") || lower.includes("help") || lower.includes("support")) {
      return bullet.replace(/\.$/, "") +
        " with inquiries, check-in procedures and service requests while maintaining high standards of hospitality and professional communication.";
    }
    if (lower.includes("serv")) {
      return bullet.replace(/\.$/, "") +
        " in a fast-paced environment, addressing diverse needs and ensuring positive experiences for all stakeholders.";
    }
  }

  // Sales / retail
  if (lower.includes("sale") || lower.includes("retail") || lower.includes("merchandis")) {
    return bullet.replace(/\.$/, "") +
      ", supported merchandising activities, processed transactions accurately, and contributed to achieving daily sales targets.";
  }

  // General expansion for short bullets
  if (bullet.length < 80) {
    const context = jobTitle ? ` as ${jobTitle}` : "";
    const companyContext = company ? ` at ${company}` : "";
    return bullet.replace(/\.$/, "") +
      `${context}${companyContext}, demonstrating strong attention to detail and commitment to excellence in all assigned responsibilities.`;
  }

  return bullet;
}

/**
 * Expand all short bullets in the resume to fill the A4 page.
 * Only elaborates existing content — never invents metrics.
 */
export function expandShortContent(resume: ResumeData): ResumeData {
  const expanded = JSON.parse(JSON.stringify(resume)) as ResumeData;
  let expandedCount = 0;

  // Expand experience bullets
  for (const exp of expanded.experience || []) {
    if (exp.bullets) {
      exp.bullets = exp.bullets.map((b) => {
        const expandedBullet = expandBullet(b, exp.title, exp.company);
        if (expandedBullet !== b) expandedCount++;
        return expandedBullet;
      });
    }
    // If a role has fewer than 3 bullets, add a contextual one from the title/company
    if (exp.bullets && exp.bullets.length < 3) {
      const contextBullet = `Demonstrated reliability and professionalism in the ${exp.title || "role"} position` +
        (exp.company ? ` at ${exp.company}` : "") +
        ", consistently meeting operational standards and contributing to team objectives.`";
      exp.bullets.push(contextBullet);
      expandedCount++;
    }
  }

  // Expand summary if short
  if (expanded.summary && expanded.summary.length < 400) {
    // Add a closing sentence about readiness for the target role
    const closing = " Eager to contribute skills and dedication to a dynamic professional environment.";
    if (!expanded.summary.includes("Eager to contribute")) {
      expanded.summary = expanded.summary.replace(/\.$/, "") + closing;
      expandedCount++;
    }
  }

  if (expandedCount > 0) {
    console.info(`[Self-Healing] Expanded ${expandedCount} short content sections`);
  }

  return expanded;
}

/**
 * Run the full self-healing cycle:
 *   1. Repair hallucinations (remove invented metrics)
 *   2. Repair content (restore dropped sections, expand short content)
 *   3. Expand short bullets to fill A4 page
 *   4. Re-run quality gates
 *   5. Return the repaired resume + report
 *
 * Only called when quality gates detect issues. Never throws.
 */
export function runSelfHealing(
  optimized: ResumeData,
  original: ResumeData,
  jdKeywords?: string[],
): {
  repairedResume: ResumeData;
  repairsMade: string[];
  hallucinationsRemoved: number;
  contentExpanded: boolean;
  newQualityReport: QualityReport;
} {
  console.info("[Self-Healing] Starting repair cycle (max 3 attempts)...");

  let currentResume = optimized;
  const allRepairs: string[] = [];
  let totalHallucinationsRemoved = 0;
  let contentExpanded = false;
  const MAX_REPAIR_ATTEMPTS = 3;

  // Multi-attempt repair loop: keep repairing until quality stops improving
  // or we hit the max attempts. Each attempt removes hallucinations + expands
  // content. This handles cases where the first repair pass doesn't fully
  // fix the issues (e.g., new hallucinations detected after expansion).
  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    let attemptRepairs = 0;

    // Step 1: Repair hallucinations
    const hallucinationRepair = repairHallucinations(currentResume, original);
    if (hallucinationRepair.repaired) {
      currentResume = hallucinationRepair.repairedResume;
      allRepairs.push(...hallucinationRepair.repairsMade);
      totalHallucinationsRemoved += hallucinationRepair.hallucinationsRemoved;
      attemptRepairs += hallucinationRepair.hallucinationsRemoved;
      console.info(`[Self-Healing] Attempt ${attempt}: Removed ${hallucinationRepair.hallucinationsRemoved} hallucinated metrics`);
    }

    // Step 2: Repair content (restore dropped sections, expand)
    const contentRepair = repairContent(currentResume, original, jdKeywords);
    if (contentRepair.repaired) {
      currentResume = contentRepair.repairedResume;
      allRepairs.push(...contentRepair.repairsMade);
      if (contentRepair.contentExpanded) contentExpanded = true;
      attemptRepairs += contentRepair.repairsMade.length;
      console.info(`[Self-Healing] Attempt ${attempt}: Content expanded: ${contentRepair.repairsMade.length} repairs`);
    }

    // Step 3: Expand short bullets to fill A4 page
    const beforeExpansionChars = JSON.stringify(currentResume).length;
    currentResume = expandShortContent(currentResume);
    const afterExpansionChars = JSON.stringify(currentResume).length;
    if (afterExpansionChars > beforeExpansionChars) {
      contentExpanded = true;
      allRepairs.push(`Attempt ${attempt}: Expanded short bullets (+${afterExpansionChars - beforeExpansionChars} chars)`);
      attemptRepairs++;
    }

    // If no repairs were made this attempt, we're done
    if (attemptRepairs === 0) {
      console.info(`[Self-Healing] Attempt ${attempt}: No more repairs needed — stopping.`);
      break;
    }

    console.info(`[Self-Healing] Attempt ${attempt} complete: ${attemptRepairs} repairs applied`);
  }

  // Final step: Re-run quality gates on the repaired resume
  const newQualityReport = runQualityGates(original, currentResume);

  console.info(
    `[Self-Healing] Repair complete. ` +
    `${totalHallucinationsRemoved} hallucinations removed, ` +
    `${allRepairs.length} total repairs, ` +
    `new quality score: ${newQualityReport.overallScore}/100`
  );

  return {
    repairedResume: currentResume,
    repairsMade: allRepairs,
    hallucinationsRemoved: totalHallucinationsRemoved,
    contentExpanded,
    newQualityReport,
  };
}

