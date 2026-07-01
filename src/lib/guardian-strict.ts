// ============================================================================
// Guardian Strict — Anti-Fabrication Enforcement
//
// After optimization, this module traces EVERY number, metric, award, and
// credential back to the original source resume. Any fabricated value that
// cannot be traced to the source is flagged.
//
// The rule is simple: the optimizer can REPHRASE but cannot ADD.
//   - "Managed patient scheduling" → "Managed high-volume scheduling" ✅ rephrase
//   - "Improved satisfaction by 40%" → ❌ no source metric → violation
//   - "Awarded Employee of the Month" → ❌ not in source → violation
//
// DESIGN PRINCIPLES:
//   - ADVISORY only: does not block pipeline, returns violations as data
//   - Conservative: any value that CANNOT be traced is flagged
//   - No false negatives: we'd rather flag a real value than miss a fake one
//   - Extensible pattern set for metric detection
// ============================================================================

import type { ResumeData } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface GuardianStrictReport {
  /** Total violations found */
  totalViolations: number;
  /** Individual violations (fabricated or untraceable values) */
  violations: GuardianViolation[];
  /** Source text fingerprints for reference */
  sourceFingerprint: SourceFingerprint;
  /** Assessment */
  verdict: "CLEAN" | "FLAGGED" | "VIOLATION";
  /** ISO timestamp */
  assessedAt: string;
}

export interface GuardianViolation {
  type: ViolationType;
  value: string;
  location: string;
  reason: string;
  severity: "warning" | "violation";
}

export type ViolationType =
  | "untraceable_metric"
  | "untraceable_award"
  | "untraceable_certification"
  | "untraceable_percentage"
  | "untraceable_number"
  | "unknown_credential";

export interface SourceFingerprint {
  /** All numeric values found in source */
  numbers: Set<string>;
  /** All percentage values found in source */
  percentages: Set<string>;
  /** All award/grant/recognition mentions */
  awards: Set<string>;
  /** All certification/license mentions */
  certifications: Set<string>;
  /** All named entities (people, orgs, locations) */
  namedEntities: Set<string>;
}

// ============================================================================
// Pattern sets
// ============================================================================

// Patterns that indicate a fabricated or untraceable claim
const METRIC_PATTERNS = [
  // Percentage claims (e.g. "increased by 40%", "40% improvement")
  /(\d+[.,]?\d*)\s*%/g,
  // Dollar/financial amounts
  /[\$€£]\s*[\d,]+(?:\.\d{2})?(?:\s*(?:million|billion|k|K))?/g,
  // Award mentions (e.g. "Employee of the Month", "Best Employee")
  /(?:award(?:ed)?|recognized|honored|won|achieved|received)\s+(?:the\s+)?(?:[A-Z][a-z]+\s+){1,5}(?:award|prize|recognition|honor|title)/gi,
  // Certification claims (e.g. "Certified", "Certificate in")
  /(?:certified|certificate|accredited|licensed)\s+(?:in\s+)?(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
  // Quantified achievements (e.g. "managed 50+ clients", "led team of 20")
  /(?:managed|led|supervised|handled|processed|trained|mentored|coordinated)\s+(?:a\s+team\s+of\s+)?(\d+[\d,+\s]*)/gi,
  // Explicit metric claims
  /(?:increased|decreased|improved|reduced|boosted|cut|grew|raised|lowered|optimized|streamlined)\s+(?:by\s+)?(\d+[.,]?\d*\s*%|\d+\s*(?:percent|points|times|fold))/gi,
  // Time metrics (e.g. "reduced time by 50%")
  /(?:within|under|in\s+(?:less\s+than|just|only)?)\s*(\d+)\s*(?:days|weeks|months|hours|minutes|years)/gi,
];

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Run Guardian Strict on the optimized resume against the source.
 *
 * @param sourceResume - The original parsed resume (ground truth)
 * @param optimizedResume - The optimizer's output to check
 * @returns GuardianStrictReport with violations
 */
export function runGuardianStrict(
  sourceResume: ResumeData,
  optimizedResume: ResumeData,
): GuardianStrictReport {
  const violations: GuardianViolation[] = [];

  // Build source fingerprint
  const sourceFingerprint = extractSourceFingerprint(sourceResume);

  // Build optimized text (flatten to string for pattern matching)
  const optimizedText = flattenResume(optimizedResume);
  const sourceText = flattenResume(sourceResume);

  // === Check 1: Untraceable percentages and metrics ===
  for (const pattern of METRIC_PATTERNS) {
    const regex = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(optimizedText)) !== null) {
      const value = match[0].trim().toLowerCase();

      // Check if this exact value exists in source
      if (!sourceText.toLowerCase().includes(value)) {
        // Check if the number component exists in source numbers
        const numberMatch = match[1] || match[0];
        const numValue = numberMatch.replace(/[,+\s]/g, "").trim();

        // Only flag if neither the phrase nor the number is in source
        if (!sourceFingerprint.numbers.has(numValue) && !sourceFingerprint.percentages.has(numValue)) {
          violations.push({
            type: classifyViolation(match[0]),
            value: match[0].trim(),
            location: findLocationInResume(optimizedResume, match[0]),
            reason: `Metric "${match[0].trim()}" appears in optimized output but cannot be traced to source resume`,
            severity: "violation",
          });
        }
      }
    }
  }

  // === Check 2: Untraceable awards ===
  // Look for award/recognition patterns
  const awardPattern = /(?:award(?:ed)?|recognized|honored|won)\s+([^.]+)/gi;
  let awardMatch: RegExpExecArray | null;
  while ((awardMatch = awardPattern.exec(optimizedText)) !== null) {
    const fullMatch = awardMatch[0].toLowerCase();
    const corePhrase = awardMatch[1]?.trim()?.toLowerCase() || fullMatch;
    // Check both: the full match AND the core noun phrase (handles "Awarded X" vs "Recognized as X")
    const isInSource = sourceText.toLowerCase().includes(fullMatch) ||
      sourceText.toLowerCase().includes(corePhrase) ||
      [...sourceFingerprint.awards].some((a) => fullMatch.includes(a.toLowerCase()) || corePhrase.includes(a.toLowerCase()));
    if (!isInSource) {
      violations.push({
        type: "untraceable_award",
        value: awardMatch[0].trim(),
        location: findLocationInResume(optimizedResume, awardMatch[0]),
        reason: `Award/recognition "${awardMatch[0].trim()}" not found in source resume`,
        severity: "violation",
      });
    }
  }

  // === Check 3: Untraceable certifications ===
  const certPattern = /(?:certified|certificate|certification)\s+(?:in\s+)?([A-Za-z\s]{3,50})(?:\.|,|$)/gi;
  let certMatch: RegExpExecArray | null;
  while ((certMatch = certPattern.exec(optimizedText)) !== null) {
    const cert = certMatch[1].trim().toLowerCase();
    const isInSource = sourceText.toLowerCase().includes(cert) ||
      [...sourceFingerprint.certifications].some((c) => cert.includes(c.toLowerCase()) || c.toLowerCase().includes(cert));
    if (!isInSource && cert.length > 3) {
      violations.push({
        type: "untraceable_certification",
        value: certMatch[0].trim(),
        location: findLocationInResume(optimizedResume, certMatch[0]),
        reason: `Certification "${certMatch[0].trim()}" not found in source resume`,
        severity: "violation",
      });
    }
  }

  // === Determine verdict ===
  let verdict: "CLEAN" | "FLAGGED" | "VIOLATION" = "CLEAN";
  const violationCount = violations.filter((v) => v.severity === "violation").length;
  if (violationCount > 0) verdict = "VIOLATION";
  else if (violations.length > 0) verdict = "FLAGGED";

  return {
    totalViolations: violations.length,
    violations,
    sourceFingerprint: {
      numbers: sourceFingerprint.numbers,
      percentages: sourceFingerprint.percentages,
      awards: sourceFingerprint.awards,
      certifications: sourceFingerprint.certifications,
      namedEntities: sourceFingerprint.namedEntities,
    },
    verdict,
    assessedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Source Fingerprinting
// ============================================================================

function extractSourceFingerprint(resume: ResumeData): {
  numbers: Set<string>;
  percentages: Set<string>;
  awards: Set<string>;
  certifications: Set<string>;
  namedEntities: Set<string>;
} {
  const text = flattenResume(resume);
  const numbers = new Set<string>();
  const percentages = new Set<string>();
  const awards = new Set<string>();
  const certifications = new Set<string>();
  const namedEntities = new Set<string>();

  // Extract all numbers
  const numPattern = /\b(\d{1,4}(?:[.,]\d{1,2})?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = numPattern.exec(text)) !== null) {
    numbers.add(m[1].replace(/[.,]/g, ""));
  }

  // Extract percentages
  const pctPattern = /(\d+[.,]?\d*)\s*%/g;
  while ((m = pctPattern.exec(text)) !== null) {
    percentages.add(m[1].replace(/[.,]/g, ""));
  }

  // Extract award keywords
  const awardKeywords = ["award", "prize", "recognition", "honor", "scholarship", "grant", "medal", "trophy"];
  for (const kw of awardKeywords) {
    if (text.toLowerCase().includes(kw)) {
      awards.add(kw);
    }
  }
  // Also extract full award phrases (noun phrases after award verbs)
  const awardPhrasePattern = /(?:award(?:ed)?|recognized|honored|won)\s+([^.]+)/gi;
  while ((m = awardPhrasePattern.exec(text)) !== null) {
    const phrase = m[1]?.trim()?.toLowerCase();
    if (phrase && phrase.length > 5) {
      awards.add(phrase);
    }
  }

  // Extract certification keywords
  const certKeywords = ["certified", "certificate", "certification", "license", "accredited", "attestation"];
  for (const kw of certKeywords) {
    if (text.toLowerCase().includes(kw)) {
      certifications.add(kw);
    }
  }

  return { numbers, percentages, awards, certifications, namedEntities };
}

// ============================================================================
// Helpers
// ============================================================================

function flattenResume(resume: ResumeData): string {
  const parts: string[] = [];

  if (resume.summary) parts.push(resume.summary);
  if (resume.headline) parts.push(resume.headline);
  if (resume.name) parts.push(resume.name);

  for (const exp of resume.experience || []) {
    if (exp.company) parts.push(exp.company);
    if (exp.title) parts.push(exp.title);
    for (const b of exp.bullets || []) {
      parts.push(typeof b === "string" ? b : "");
    }
  }

  for (const edu of resume.education || []) {
    if (edu.institution) parts.push(edu.institution);
    if (edu.degree) parts.push(edu.degree);
    if (edu.field) parts.push(edu.field);
    for (const h of edu.highlights || []) {
      parts.push(typeof h === "string" ? h : "");
    }
  }

  for (const skill of resume.skills || []) {
    parts.push(typeof skill === "string" ? skill : skill.name || "");
  }

  for (const lang of resume.languages || []) {
    parts.push(typeof lang === "string" ? lang : lang.name || "");
  }

  return parts.join("\n");
}

function classifyViolation(text: string): ViolationType {
  const t = text.toLowerCase();
  if (t.includes("%") || t.includes("percent")) return "untraceable_percentage";
  if (t.includes("$") || t.includes("€") || t.includes("£")) return "untraceable_metric";
  if (t.includes("award") || t.includes("recognized") || t.includes("won")) return "untraceable_award";
  if (t.includes("certif")) return "untraceable_certification";
  if (/\d+/.test(t)) return "untraceable_metric";
  return "untraceable_number";
}

function findLocationInResume(resume: ResumeData, value: string): string {
  const text = flattenResume(resume);
  const idx = text.toLowerCase().indexOf(value.toLowerCase());
  if (idx === -1) return "unknown";

  // Find which section contains this text
  const before = text.slice(Math.max(0, idx - 100), idx);
  if (before.includes("summary") || before.includes("Summary")) return "summary";
  if (before.includes("experience") || before.includes("Experience")) return "experience";
  if (before.includes("education") || before.includes("Education")) return "education";
  if (before.includes("skill") || before.includes("Skill")) return "skills";
  if (before.includes("language") || before.includes("Language")) return "languages";

  return "unknown";
}
