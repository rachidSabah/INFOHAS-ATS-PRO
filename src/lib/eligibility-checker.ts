// ============================================================================
// Eligibility Checker — Surface hard requirements the candidate cannot meet
//
// Extracts hard/soft requirements from a live Job Description and compares
// them against the candidate's resume profile. Surfaces gaps and blockers
// that the optimizer cannot fix (e.g. height minimum, age, certifications).
//
// DESIGN PRINCIPLES:
//   - PURELY INFORMATIONAL: never blocks the pipeline or throws
//   - NO fabrication: if a gap is detected, it's reported — never silently filled
//   - Pattern-matched: extracts known requirement patterns from JD text
//   - Extensible: add new requirement patterns to REQUIRED_PATTERNS
// ============================================================================

import type { ResumeData, JobDescription } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface EligibilityReport {
  /** Overall: true if no blockers exist */
  eligible: boolean;
  /** Blocking issues — candidate cannot meet these (e.g., height < minimum) */
  blockers: EligibilityItem[];
  /** Non-blocking gaps — candidate should address (e.g., missing certification) */
  gaps: EligibilityItem[];
  /** Requirements the candidate meets */
  met: EligibilityItem[];
  /** Requirements extracted from the JD */
  extractedRequirements: ExtractedRequirement[];
  /** ISO timestamp */
  assessedAt: string;
}

export interface EligibilityItem {
  requirement: string;
  detail: string;
  severity: "blocker" | "gap" | "met";
  source: string; // where this was extracted from
}

export interface ExtractedRequirement {
  category: RequirementCategory;
  rawText: string;
  value?: string | number;
  unit?: string;
  operator?: ">=" | "<=" | ">" | "<" | "==";
}

export type RequirementCategory =
  | "height"
  | "age"
  | "education"
  | "experience_years"
  | "language"
  | "certification"
  | "physical"
  | "location"
  | "travel"
  | "swimming"
  | "vision"
  | "other";

// ============================================================================
// Requirement extraction patterns (ordered by specificity)
// ============================================================================

interface RequirementPattern {
  category: RequirementCategory;
  pattern: RegExp;
  parseValue: (match: RegExpExecArray) => { value: number; unit: string; operator: ">=" | "<=" };
}

const REQUIRED_PATTERNS: RequirementPattern[] = [
  // Height requirements (common in aviation/cabin crew)
  {
    category: "height",
    pattern: /(?:minimum\s+)?height\s+(?:requirement|must\s+be|of|:)?\s*(?:\:)?\s*(\d+)\s*(cm|m|inches|ft|feet)?/gi,
    parseValue: (m) => ({ value: parseInt(m[1], 10), unit: m[2] || "cm", operator: ">=" }),
  },
  {
    category: "height",
    pattern: /(?:reach|arm\s*reach|standing\s*reach)\s+(?:\:)?\s*(\d+)\s*(cm|m)?/gi,
    parseValue: (m) => ({ value: parseInt(m[1], 10), unit: m[2] || "cm", operator: ">=" }),
  },
  // Age requirements
  {
    category: "age",
    pattern: /(?:minimum\s+)?age\s+(?:requirement|must\s+be|of|:)?\s*(?:\:)?\s*(\d+)/gi,
    parseValue: (m) => ({ value: parseInt(m[1], 10), unit: "years", operator: ">=" }),
  },
  {
    category: "age",
    pattern: /(?:at\s+least|minimum)\s+(\d+)\s*years\s*(?:old|of\s*age)?/gi,
    parseValue: (m) => ({ value: parseInt(m[1], 10), unit: "years", operator: ">=" }),
  },
  // Swimming requirement (common in aviation)
  {
    category: "swimming",
    pattern: /(?:must\s+be\s+able\s+to\s+)?swim(?:\s+(\d+)\s*(m|meters|metres))?/gi,
    parseValue: (m) => ({ value: parseInt(m[1], 10) || 50, unit: m[2] || "m", operator: ">=" }),
  },
  // Experience years
  {
    category: "experience_years",
    pattern: /(?:minimum\s+)?(\d+)\s*(?:\+?\s*years?)\s+(?:of\s+)?(?:experience|work)/gi,
    parseValue: (m) => ({ value: parseInt(m[1], 10), unit: "years", operator: ">=" }),
  },
  // Vision requirements
  {
    category: "vision",
    pattern: /(?:vision|eyesight)\s*(?:\:)?\s*(?:\d+\/\d+|20\/\d+|6\/\d+)/gi,
    parseValue: () => ({ value: 0, unit: "standard", operator: ">=" }),
  },
  // Physical requirements
  {
    category: "physical",
    pattern: /(?:physically\s+fit|good\s+health|medical\s+fitness|fit\s+for\s+duty)/gi,
    parseValue: () => ({ value: 1, unit: "boolean", operator: ">=" }),
  },
  // Travel / relocation
  {
    category: "travel",
    pattern: /(?:willing(?:ness)?\s+to\s+(?:relocate|travel|move\s+to|based\sin))(?:\s+to\s+([A-Za-z\s]+))?/gi,
    parseValue: () => ({ value: 1, unit: "boolean", operator: ">=" }),
  },
];

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Check a candidate's eligibility against a live JD.
 *
 * @param resume - The candidate's parsed resume
 * @param jd - The job description (preferably live-fetched)
 * @returns EligibilityReport — never throws
 */
export function checkEligibility(
  resume: ResumeData,
  jd: JobDescription,
): EligibilityReport {
  const blockers: EligibilityItem[] = [];
  const gaps: EligibilityItem[] = [];
  const met: EligibilityItem[] = [];
  const extractedRequirements: ExtractedRequirement[] = [];

  // Combine all JD text for pattern matching
  const jdText = buildJDText(jd);

  // === Extract requirements from JD text ===
  for (const pattern of REQUIRED_PATTERNS) {
    const regex = new RegExp(pattern.pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(jdText)) !== null) {
      try {
        const parsed = pattern.parseValue(match);
        extractedRequirements.push({
          category: pattern.category,
          rawText: match[0].trim(),
          value: parsed.value,
          unit: parsed.unit,
          operator: parsed.operator,
        });
      } catch {
        // Malformed match, skip
      }
    }
  }

  // De-duplicate extracted requirements by category
  const uniqueRequirements = deduplicateRequirements(extractedRequirements);

  // === Check each requirement against candidate profile ===
  for (const req of uniqueRequirements) {
    const check = checkRequirement(resume, req);
    if (check === "blocker") {
      blockers.push({
        requirement: formatCategory(req.category),
        detail: `${req.rawText} — candidate profile does not meet this requirement`,
        severity: "blocker",
        source: "jd-requirement",
      });
    } else if (check === "gap") {
      gaps.push({
        requirement: formatCategory(req.category),
        detail: `${req.rawText} — not confirmed in candidate profile`,
        severity: "gap",
        source: "jd-requirement",
      });
    } else {
      met.push({
        requirement: formatCategory(req.category),
        detail: `${req.rawText} — candidate meets this requirement`,
        severity: "met",
        source: "jd-requirement",
      });
    }
  }

  // === Check for required languages ===
  checkLanguages(resume, jd, gaps, met);

  // === Check for required certifications ===
  checkCertifications(resume, jdText, gaps, blockers);

  return {
    eligible: blockers.length === 0,
    blockers,
    gaps,
    met,
    extractedRequirements,
    assessedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Individual checkers
// ============================================================================

function checkRequirement(
  resume: ResumeData,
  req: ExtractedRequirement,
): "met" | "gap" | "blocker" {
  switch (req.category) {
    case "height": {
      const candidateHeight = extractCandidateHeight(resume);
      if (!candidateHeight) return "gap"; // No height data = unknown
      if (req.operator === ">=" && candidateHeight >= (req.value as number)) return "met";
      return "blocker";
    }

    case "age": {
      const candidateAge = extractCandidateAge(resume);
      if (!candidateAge) return "gap";
      if (req.operator === ">=" && candidateAge >= (req.value as number)) return "met";
      return "blocker";
    }

    case "swimming": {
      // Swimming ability is rarely in resumes — flag as gap
      const swimming = extractSwimmingAbility(resume);
      if (swimming === true) return "met";
      return "gap";
    }

    case "experience_years": {
      const years = calculateTotalExperienceYears(resume);
      if (years < 0) return "gap";
      if (years >= (req.value as number)) return "met";
      return "gap";
    }

    case "vision":
    case "physical":
      // These are almost never in resumes — flag as unknown/gap
      return "gap";

    case "travel":
      // Willingness to relocate is typically implied by applying
      return "met";

    default:
      return "gap";
  }
}

function checkLanguages(
  resume: ResumeData,
  jd: JobDescription,
  gaps: EligibilityItem[],
  met: EligibilityItem[],
): void {
  const candidateLangs = (resume.languages || []).map((l) =>
    (typeof l === "string" ? l : l.name || "").toLowerCase(),
  );

  // Extract required languages from JD structured fields
  const requiredLangs = [...(jd.requiredSkills || []), ...(jd.keywords || [])]
    .filter((k) => k.toLowerCase().includes("language"))
    .map((k) => k.toLowerCase());

  // Check common language keywords in JD
  const commonLanguages = [
    "english", "french", "arabic", "spanish", "german",
    "mandarin", "japanese", "russian", "italian", "portuguese",
    "dutch", "hindi", "turkish", "chinese",
  ];

  const jdText = buildJDText(jd).toLowerCase();
  for (const lang of commonLanguages) {
    if (jdText.includes(lang)) {
      const hasLang = candidateLangs.some((cl) => cl.includes(lang));
      if (hasLang) {
        met.push({
          requirement: `Language: ${lang.charAt(0).toUpperCase() + lang.slice(1)}`,
          detail: `JD requires ${lang} — candidate is proficient`,
          severity: "met",
          source: "jd-language",
        });
      } else {
        gaps.push({
          requirement: `Language: ${lang.charAt(0).toUpperCase() + lang.slice(1)}`,
          detail: `JD requires ${lang} — not listed in candidate profile`,
          severity: "gap",
          source: "jd-language",
        });
      }
    }
  }
}

function checkCertifications(
  resume: ResumeData,
  jdText: string,
  gaps: EligibilityItem[],
  blockers: EligibilityItem[],
): void {
  const commonCerts: Record<string, string> = {
    "first aid": "First Aid Certificate",
    "cpr": "CPR Certification",
    "sep": "Safety & Emergency Procedures",
    "dgr": "Dangerous Goods Regulations",
    "cabin crew": "Cabin Crew Attestation",
    "customer service": "Customer Service Certification",
  };

  const candidateText = JSON.stringify(resume).toLowerCase();

  for (const [keyword, certName] of Object.entries(commonCerts)) {
    if (jdText.toLowerCase().includes(keyword)) {
      const hasCert = candidateText.includes(keyword);
      if (hasCert) {
        // met — handled in main loop
      } else {
        gaps.push({
          requirement: `Certification: ${certName}`,
          detail: `JD mentions "${keyword}" — not confirmed in candidate profile`,
          severity: "gap",
          source: "jd-certification",
        });
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function buildJDText(jd: JobDescription): string {
  return [
    jd.rawText || "",
    jd.title || "",
    ...(jd.responsibilities || []),
    ...(jd.requiredSkills || []),
    ...(jd.preferredSkills || []),
  ]
    .filter(Boolean)
    .join("\n");
}

function extractCandidateHeight(resume: ResumeData): number | null {
  const text = JSON.stringify(resume).toLowerCase();
  // Pattern matches "180 cm", "height: 180cm", "180cm"
  const m = text.match(/(?:height|tall|stand(?:ing)?)?\s*(?:is|:)?\s*(\d{3})\s*(?:cm|centimeters|centimetres)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

function extractCandidateAge(resume: ResumeData): number | null {
  const text = JSON.stringify(resume).toLowerCase();
  // Pattern matches "Date of Birth: 04/07/2000" or "DOB: 2000-07-04" or "04/07/2000"
  const dobPatterns = [
    /(?:date\s*of\s*birth|dob|birth\s*date|born)\s*(?:\:|on)?\s*(\d{1,2})[\s\/\-\.](\d{1,2})[\s\/\-\.](\d{4})/i,
    /(?:date\s*of\s*birth|dob|birth\s*date|born)\s*(?:\:|on)?\s*(\d{4})[\s\/\-](\d{1,2})[\s\/\-](\d{1,2})/i,
  ];
  for (const pattern of dobPatterns) {
    const m = text.match(pattern);
    if (m) {
      let year: number;
      if (m[1].length === 4) {
        year = parseInt(m[1], 10);
      } else if (m[3].length === 4) {
        year = parseInt(m[3], 10);
      } else {
        continue;
      }
      if (year > 1900 && year < 2010) {
        const age = new Date().getFullYear() - year;
        return age;
      }
    }
  }
  return null;
}

function extractSwimmingAbility(resume: ResumeData): boolean | null {
  const text = JSON.stringify(resume).toLowerCase();
  const patterns = [/swim/i, /swimming/i, /lifeguard/i, /water\s*safety/i, /first\s*aid/i];
  return patterns.some((p) => p.test(text)) ? true : null;
}

function calculateTotalExperienceYears(resume: ResumeData): number {
  if (!resume.experience || resume.experience.length === 0) return -1;
  let totalDays = 0;
  const now = new Date();
  for (const exp of resume.experience) {
    const startDate = exp.startDate ? new Date(exp.startDate) : null;
    const endDate = exp.endDate ? new Date(exp.endDate) : now;
    if (startDate && !isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      totalDays += (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    }
  }
  return Math.round(totalDays / 365 * 10) / 10;
}

function deduplicateRequirements(reqs: ExtractedRequirement[]): ExtractedRequirement[] {
  const seen = new Set<string>();
  return reqs.filter((r) => {
    const key = `${r.category}:${r.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatCategory(cat: RequirementCategory): string {
  const labels: Record<RequirementCategory, string> = {
    height: "Height Requirement",
    age: "Age Requirement",
    education: "Education Requirement",
    experience_years: "Experience Requirement",
    language: "Language Requirement",
    certification: "Certification Requirement",
    physical: "Physical Fitness Requirement",
    location: "Location Requirement",
    travel: "Travel/Relocation Requirement",
    swimming: "Swimming Requirement",
    vision: "Vision Requirement",
    other: "Requirement",
  };
  return labels[cat] || "Requirement";
}
