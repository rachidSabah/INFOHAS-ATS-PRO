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
 */
export function extractResumeFacts(resume: ResumeData): ResumeFact[] {
  const facts: ResumeFact[] = [];
  const fullText = JSON.stringify(resume);

  // Extract metrics (numbers, percentages, counts)
  // Regex: \d+%, \d+\+, \d+ years, \d+ passengers, etc.
  const metricRegex = /\b(\d+(?:[.,]\d+)?(?:%|\+|\s*(?:years?|passengers?|customers?|clients?|sales?|users?|hours?|months?|days?))?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = metricRegex.exec(fullText)) !== null) {
    const text = match[1].trim();
    // Skip years (1900-2099) and small counts (1-4)
    if (/^(19|20)\d{2}$/.test(text)) continue;
    if (/^\d{1}$/.test(text)) continue;
    facts.push({ text, type: "metric", verified: false });
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
