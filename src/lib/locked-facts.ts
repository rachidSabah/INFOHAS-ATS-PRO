// ============================================================================
// LockedFacts Engine — extracts and persists the immutable facts from a
// source resume so they can be verified against the AI's optimized output.
//
// PROBLEM (P1.6 — Optimizer Stability):
//   The AI sometimes "optimizes" a resume by inventing new employers,
//   changing dates, adding metrics that weren't in the source, etc. The
//   existing enforceLockedFields() function in orchestrator.ts catches
//   SOME of these, but it operates on the AI's output only — it doesn't
//   have a clean, separate representation of the "locked facts" that can
//   be persisted, displayed to the user, or used for cross-pipeline
//   verification.
//
// SOLUTION:
//   extractLockedFacts(resume) returns a LockedFacts object that contains
//   ONLY the fields that must NEVER change during optimization:
//     - name
//     - email
//     - phone
//     - location
//     - companies (all employer names)
//     - dates (all start/end dates)
//     - education institutions
//     - languages
//     - certifications
//     - metrics (all numbers/percentages in the source)
//
//   computeFactDiff(originalFacts, optimizedFacts) returns a FactDiff that
//   lists every field where the optimized resume diverges from the original.
//   The optimizer uses this to REJECT the optimization if any "new" fact
//   was introduced (a fact in the optimized that wasn't in the original).
//
//   computeFactualIntegrityScore(diff) returns 0-100 — must be 100 for the
//   optimization to be accepted.
// ============================================================================

import type { ResumeData } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface LockedFacts {
  name: string;
  email: string;
  phone: string;
  location: string;
  companies: string[];
  jobTitles: string[];
  dates: {
    experience: Array<{ company: string; startDate: string; endDate: string }>;
    education: Array<{ institution: string; startDate: string; endDate: string }>;
  };
  educationInstitutions: string[];
  educationDegrees: string[];
  languages: string[];
  certifications: string[];
  /** All numbers/percentages/dollar amounts found in the source resume. */
  metrics: string[];
  /** All bullet points from the source (used to verify no new content was invented). */
  bullets: string[];
  /** The source resume's raw text (lowercased) for substring matching. */
  rawText: string;
}

export interface FactDiff {
  /** Fields that were CHANGED (original value → optimized value). */
  changed: Array<{
    field: string;
    original: string;
    optimized: string;
    severity: "critical" | "warning";
  }>;
  /** NEW facts in the optimized that don't exist in the original (HALLUCINATIONS). */
  newFacts: Array<{
    field: string;
    value: string;
    severity: "critical" | "warning";
  }>;
  /** Original facts that are MISSING from the optimized (data loss). */
  missing: Array<{
    field: string;
    value: string;
    severity: "critical" | "warning";
  }>;
  /** True if no factual integrity issues were found. */
  isConsistent: boolean;
  /** 0-100 score — 100 means no issues. */
  factualIntegrityScore: number;
}

// ============================================================================
// Extract locked facts from a resume
// ============================================================================

/**
 * Extract the immutable facts from a resume. These facts must NEVER change
 * during optimization — if the AI's output has different facts, the
 * optimization is rejected.
 */
export function extractLockedFacts(resume: ResumeData): LockedFacts {
  const contact = resume.contact ?? ({} as any);

  // Extract all metrics from the source resume.
  // Matches: 95%, 20%, $1.2M, 40M+, 5,000+, 28%, 6.4%, 41%, 12 months, etc.
  const metricPattern = /\$?\d+(?:[.,]\d+)*\s*(?:%|M|K|B|million|billion|thousand|\+|months?|years?|days?|hours?|minutes?|seconds?|x|×)?/gi;
  const allText = JSON.stringify(resume);
  const metrics = Array.from(
    new Set(
      (allText.match(metricPattern) ?? [])
        .map((m) => m.trim())
        .filter((m) => m.length > 0 && m !== "0" && !/^[0-9]{4}$/.test(m)), // exclude plain years
    ),
  );

  // Collect all bullets (for content provenance — the AI shouldn't invent new bullets)
  const bullets: string[] = [];
  for (const exp of resume.experience ?? []) {
    bullets.push(...(exp.bullets ?? []));
  }
  for (const edu of resume.education ?? []) {
    bullets.push(...(edu.highlights ?? []));
  }

  // Normalize company names (lowercase, trim) for fuzzy matching
  const companies = (resume.experience ?? [])
    .map((e) => e.company?.trim())
    .filter((c): c is string => !!c && c.length > 0);

  const jobTitles = (resume.experience ?? [])
    .map((e) => e.title?.trim())
    .filter((t): t is string => !!t && t.length > 0);

  return {
    name: resume.name?.trim() ?? "",
    email: contact.email?.trim() ?? "",
    phone: contact.phone?.trim() ?? "",
    location: contact.location?.trim() ?? "",
    companies,
    jobTitles,
    dates: {
      experience: (resume.experience ?? []).map((e) => ({
        company: e.company?.trim() ?? "",
        startDate: e.startDate?.trim() ?? "",
        endDate: e.endDate?.trim() ?? "",
      })),
      education: (resume.education ?? []).map((e) => ({
        institution: e.institution?.trim() ?? "",
        startDate: e.startDate?.trim() ?? "",
        endDate: e.endDate?.trim() ?? "",
      })),
    },
    educationInstitutions: (resume.education ?? [])
      .map((e) => e.institution?.trim())
      .filter((i): i is string => !!i && i.length > 0),
    educationDegrees: (resume.education ?? [])
      .map((e) => e.degree?.trim())
      .filter((d): d is string => !!d && d.length > 0),
    languages: (resume.languages ?? [])
      .map((l) => l.name?.trim())
      .filter((l): l is string => !!l && l.length > 0),
    certifications: (resume.certifications ?? [])
      .map((c) => c.name?.trim())
      .filter((c): c is string => !!c && c.length > 0),
    metrics,
    bullets: bullets.map((b) => b.trim()).filter((b) => b.length > 0),
    rawText: allText.toLowerCase(),
  };
}

// ============================================================================
// Compute the diff between original and optimized facts
// ============================================================================

/**
 * Compare the original resume's locked facts against the optimized resume's
 * locked facts. Returns a FactDiff listing every divergence.
 *
 * Rules:
 *   - A CHANGED field is one where the original had a value AND the optimized
 *     has a DIFFERENT value. (e.g. name changed from "John" to "Jon")
 *   - A NEW fact is one where the optimized has a value that doesn't exist
 *     ANYWHERE in the original. (e.g. a new company "Google" that wasn't in
 *     the source resume — this is a HALLUCINATION.)
 *   - A MISSING fact is one where the original had a value AND the optimized
 *     doesn't have it. (e.g. an education entry was dropped.)
 *
 * Severity:
 *   - "critical" — the optimization MUST be rejected (hallucination, changed
 *     contact info, changed dates)
 *   - "warning" — the optimization is suspect but might be acceptable (e.g.
 *     a bullet was rewritten, but the meaning is preserved)
 */
export function computeFactDiff(original: LockedFacts, optimized: LockedFacts): FactDiff {
  const changed: FactDiff["changed"] = [];
  const newFacts: FactDiff["newFacts"] = [];
  const missing: FactDiff["missing"] = [];

  // === Contact info (critical if changed) ===
  if (original.name && optimized.name && original.name.toLowerCase() !== optimized.name.toLowerCase()) {
    changed.push({
      field: "name",
      original: original.name,
      optimized: optimized.name,
      severity: "critical",
    });
  }
  if (original.email && optimized.email && original.email.toLowerCase() !== optimized.email.toLowerCase()) {
    changed.push({
      field: "email",
      original: original.email,
      optimized: optimized.email,
      severity: "critical",
    });
  }
  if (original.phone && optimized.phone && original.phone !== optimized.phone) {
    changed.push({
      field: "phone",
      original: original.phone,
      optimized: optimized.phone,
      severity: "critical",
    });
  }
  if (
    original.location &&
    optimized.location &&
    original.location.toLowerCase() !== optimized.location.toLowerCase() &&
    !original.location.toLowerCase().includes(optimized.location.toLowerCase()) &&
    !optimized.location.toLowerCase().includes(original.location.toLowerCase())
  ) {
    changed.push({
      field: "location",
      original: original.location,
      optimized: optimized.location,
      severity: "critical",
    });
  }

  // === Companies (critical if NEW company introduced) ===
  for (const optCompany of optimized.companies) {
    const optLower = optCompany.toLowerCase();
    const found = original.companies.some(
      (orig) =>
        orig.toLowerCase() === optLower ||
        orig.toLowerCase().includes(optLower) ||
        optLower.includes(orig.toLowerCase()),
    );
    if (!found) {
      newFacts.push({
        field: "experience.company",
        value: optCompany,
        severity: "critical",
      });
    }
  }

  // === Missing companies (critical — data loss) ===
  for (const origCompany of original.companies) {
    const origLower = origCompany.toLowerCase();
    const found = optimized.companies.some(
      (opt) =>
        opt.toLowerCase() === origLower ||
        opt.toLowerCase().includes(origLower) ||
        origLower.includes(opt.toLowerCase()),
    );
    if (!found) {
      missing.push({
        field: "experience.company",
        value: origCompany,
        severity: "critical",
      });
    }
  }

  // === Dates (critical if changed) ===
  for (const optDate of optimized.dates.experience) {
    const origDate = original.dates.experience.find(
      (o) =>
        o.company.toLowerCase() === optDate.company.toLowerCase() ||
        o.company.toLowerCase().includes(optDate.company.toLowerCase()) ||
        optDate.company.toLowerCase().includes(o.company.toLowerCase()),
    );
    if (origDate) {
      if (optDate.startDate && origDate.startDate && optDate.startDate !== origDate.startDate) {
        changed.push({
          field: `experience[${optDate.company}].startDate`,
          original: origDate.startDate,
          optimized: optDate.startDate,
          severity: "critical",
        });
      }
      if (optDate.endDate && origDate.endDate && optDate.endDate !== origDate.endDate) {
        // Special case: "Present" when original has a real date
        if (optDate.endDate.toLowerCase() === "present" && origDate.endDate.toLowerCase() !== "present") {
          changed.push({
            field: `experience[${optDate.company}].endDate`,
            original: origDate.endDate,
            optimized: optDate.endDate,
            severity: "critical",
          });
        }
      }
    }
  }

  // === Education institutions (critical if NEW institution introduced) ===
  for (const optInst of optimized.educationInstitutions) {
    const optLower = optInst.toLowerCase();
    const found = original.educationInstitutions.some(
      (orig) =>
        orig.toLowerCase() === optLower ||
        orig.toLowerCase().includes(optLower) ||
        optLower.includes(orig.toLowerCase()),
    );
    if (!found) {
      newFacts.push({
        field: "education.institution",
        value: optInst,
        severity: "critical",
      });
    }
  }

  // === Languages (warning if new language introduced) ===
  for (const optLang of optimized.languages) {
    const optLower = optLang.toLowerCase();
    const found = original.languages.some((orig) => orig.toLowerCase() === optLower);
    if (!found) {
      newFacts.push({
        field: "languages.name",
        value: optLang,
        severity: "warning",
      });
    }
  }

  // === Certifications (warning if new cert introduced) ===
  for (const optCert of optimized.certifications) {
    const optLower = optCert.toLowerCase();
    const found = original.certifications.some(
      (orig) =>
        orig.toLowerCase() === optLower ||
        orig.toLowerCase().includes(optLower) ||
        optLower.includes(orig.toLowerCase()),
    );
    if (!found) {
      newFacts.push({
        field: "certifications.name",
        value: optCert,
        severity: "warning",
      });
    }
  }

  // === Metrics (critical if NEW metric introduced — hallucination) ===
  for (const optMetric of optimized.metrics) {
    const optLower = optMetric.toLowerCase();
    const found = original.metrics.some(
      (orig) => orig.toLowerCase() === optLower,
    );
    if (!found) {
      // Check if the metric is a substring of any original metric (e.g. "40M" in "40M+")
      const substringFound = original.metrics.some(
        (orig) => orig.toLowerCase().includes(optLower) || optLower.includes(orig.toLowerCase()),
      );
      if (!substringFound) {
        newFacts.push({
          field: "metrics",
          value: optMetric,
          severity: "critical",
        });
      }
    }
  }

  // === Compute the factual integrity score ===
  const criticalCount = [
    ...changed.filter((c) => c.severity === "critical"),
    ...newFacts.filter((c) => c.severity === "critical"),
    ...missing.filter((c) => c.severity === "critical"),
  ].length;
  const warningCount = [
    ...changed.filter((c) => c.severity === "warning"),
    ...newFacts.filter((c) => c.severity === "warning"),
    ...missing.filter((c) => c.severity === "warning"),
  ].length;

  // Score: 100 - (critical * 25) - (warning * 5), clamped to 0-100
  const score = Math.max(0, Math.min(100, 100 - criticalCount * 25 - warningCount * 5));
  const isConsistent = criticalCount === 0 && warningCount === 0;

  return {
    changed,
    newFacts,
    missing,
    isConsistent,
    factualIntegrityScore: score,
  };
}

// ============================================================================
// Placeholder detection
// ============================================================================

const PLACEHOLDER_PATTERNS = [
  /projected\s*role/i,
  /previous\s*employer/i,
  /institution\s*name/i,
  /company\s*name/i,
  /\bxxx\b/i,
  /^n\/?a$/i,
  /placeholder/i,
  /example\s*company/i,
  /your\s*company/i,
  /\bsample\b/i,
  /lorem\s*ipsum/i,
  /tbd\b/i,
  /tba\b/i,
  /fill\s*in/i,
  /enter\s*your/i,
  /city,?\s*country/i, // "City, Country" placeholder
  /\[your\s+/i, // "[Your Name]"
  /\[insert\s+/i, // "[Insert Details]"
];

/**
 * Returns true if the text matches any placeholder pattern.
 * Used to reject AI output that contains placeholder text instead of real content.
 */
export function isPlaceholder(text: string | null | undefined): boolean {
  if (!text) return true;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(text));
}

/**
 * Returns the list of placeholder patterns found in the text (for diagnostics).
 */
export function findPlaceholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) {
      found.push(pattern.source);
    }
  }
  return found;
}
