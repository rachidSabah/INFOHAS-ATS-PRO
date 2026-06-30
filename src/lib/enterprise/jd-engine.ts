// ============================================================================
// Enterprise Job Description Engine — ResumeAI Pro
// ============================================================================
// Deterministic JD analysis engine that extracts structured intelligence
// from job description text without AI calls.
//
// Complements job-intelligence.ts (which uses AI) with reliable,
// rule-based extraction for keyword/skill/competency identification.
// ============================================================================

import { detectIndustry, getIndustryProfile, resolveToCanonical } from "./industry-knowledge-engine";

// ============================================================================
// Types
// ============================================================================

export interface JDExtractedSkill {
  name: string;
  canonical?: string;
  category?: string;
  type: "technical" | "soft" | "domain" | "certification" | "tool";
  weight: number; // 0-1, higher = more important/required
}

export interface JDExtractedCompetency {
  name: string;
  type: "responsibility" | "requirement" | "preferred";
}

export interface JDAnalysis {
  /** Raw extracted skills with weights */
  skills: JDExtractedSkill[];
  /** Extracted responsibilities */
  responsibilities: string[];
  /** Required qualifications */
  requiredQualifications: string[];
  /** Preferred qualifications */
  preferredQualifications: string[];
  /** Certifications mentioned */
  certifications: string[];
  /** Tools/technologies mentioned */
  tools: string[];
  /** Years of experience mentioned */
  experienceYears: number | null;
  /** Education mentioned */
  educationRequirements: string[];
  /** Soft skills extracted */
  softSkills: string[];
  /** Detected industry */
  industryId: string;
  /** Priority keywords (ranked) */
  priorityKeywords: string[];
  /** Critical keywords (must-have, from required skills) */
  criticalKeywords: string[];
  /** Role title extracted */
  roleTitle: string;
  /** Company extracted */
  company: string;
  /** Employment type */
  employmentType: string | null;
}

// ============================================================================
// Well-known keywords by category (for deterministic extraction)
// ============================================================================

const TECHNICAL_KEYWORDS = new Set([
  "javascript", "typescript", "python", "java", "go", "rust", "c++", "c#", "ruby",
  "php", "swift", "kotlin", "scala", "perl", "r", "matlab", "sql", "nosql",
  "react", "vue", "angular", "next.js", "node.js", "express", "django", "flask",
  "spring boot", "fastapi", "asp.net", "rails", "laravel",
  "aws", "azure", "gcp", "cloud", "kubernetes", "docker", "terraform",
  "ci/cd", "jenkins", "gitlab", "github actions", "circleci",
  "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "dynamodb",
  "graphql", "rest", "grpc", "websocket", "microservices",
  "agile", "scrum", "kanban", "jira", "confluence",
  "linux", "unix", "bash", "powershell", "shell scripting",
  "machine learning", "deep learning", "nlp", "computer vision", "data science",
  "blockchain", "smart contracts", "solidity",
  "cybersecurity", "penetration testing", "security", "compliance",
  "tableau", "power bi", "looker", "qlik",
  "sap", "oracle", "salesforce", "hubspot", "marketo",
]);

const SOFT_SKILL_KEYWORDS = new Set([
  "leadership", "communication", "teamwork", "collaboration", "problem solving",
  "critical thinking", "analytical", "time management", "prioritization",
  "adaptability", "flexibility", "creativity", "innovation",
  "interpersonal", "negotiation", "presentation", "public speaking",
  "written communication", "verbal communication", "active listening",
  "conflict resolution", "decision making", "strategic thinking",
  "attention to detail", "detail-oriented", "organizational",
  "mentoring", "coaching", "training", "people management",
  "customer service", "client management", "stakeholder management",
  "multitasking", "fast-paced", "self-motivated", "proactive",
  "results-oriented", "goal-oriented", "data-driven",
]);

const CERTIFICATION_KEYWORDS = new Set([
  "pmp", "aws certified", "aws certification", "azure certification",
  "cisco certified", "ccna", "ccnp", "ccie",
  "cpa", "cfa", "frm", "acca", "cma",
  "six sigma", "lean", "scrum master", "csm", "psm",
  "itil", "comptia", "security+", "network+",
  "ceh", "cissp", "oscp",
  "bls", "acls", "pals", "cpr", "rn", "lpn", "cna",
  "google analytics", "google ads certification", "facebook blueprint",
  "prince2", "msp", "mop",
  "toefl", "ielts", "cambridge",
]);

const TOOL_PATTERNS = [
  /(?:^|\s)(opera|micros|symphony|fidelio)(?:\s|$|[,;])/i,
  /(?:^|\s)(bloomberg|factset|capital\s*iq|quickbooks)(?:\s|$|[,;])/i,
  /(?:^|\s)(zendesk|freshdesk|servicenow|salesforce|hubspot)(?:\s|$|[,;])/i,
  /(?:^|\s)(autocad|revit|solidworks|primavera)(?:\s|$|[,;])/i,
  /(?:^|\s)(epic|cerner|meditech|eclinicalworks)(?:\s|$|[,;])/i,
  /(?:^|\s)(moodle|blackboard|canvas|google\s*classroom)(?:\s|$|[,;])/i,
  /(?:^|\s)(sap|oracle|dynamics\s*365)(?:\s|$|[,;])/i,
];

// ============================================================================
// Engine Functions
// ============================================================================

/**
 * Analyze a job description text and extract structured intelligence.
 * Uses deterministic/rule-based extraction — no AI calls.
 */
export function analyzeJD(jdText: string): JDAnalysis {
  const text = jdText || "";
  const textLower = text.toLowerCase();

  // Split into sections for targeted extraction
  // Common JD section headers
  const sections = extractSections(text);

  // Extract all skills
  const skills = extractSkills(textLower, text);

  // Extract responsibilities
  const responsibilities = extractResponsibilities(sections);

  // Extract qualifications
  const { required, preferred } = extractQualifications(sections);

  // Extract certifications
  const certifications = extractCertifications(textLower, text);

  // Extract tools
  const tools = extractTools(text, textLower);

  // Extract experience years
  const experienceYears = extractExperienceYears(textLower);

  // Extract education
  const educationRequirements = extractEducation(textLower);

  // Extract soft skills
  const softSkills = extractSoftSkills(textLower);

  // Extract role and company
  const roleTitle = extractRoleTitle(text);
  const company = extractCompany(text);

  // Detect industry
  const industryResult = detectIndustry([text]);
  const industryId = industryResult.industry.id;

  // Build keyword lists
  const criticalKeywords = skills
    .filter((s) => s.weight >= 0.8 && s.type !== "soft")
    .map((s) => s.name);

  const priorityKeywords = [
    ...criticalKeywords,
    ...certifications,
    ...tools,
  ].slice(0, 20);

  // Employment type
  const employmentType = extractEmploymentType(textLower);

  return {
    skills,
    responsibilities,
    requiredQualifications: required,
    preferredQualifications: preferred,
    certifications,
    tools,
    experienceYears,
    educationRequirements,
    softSkills,
    industryId,
    priorityKeywords,
    criticalKeywords,
    roleTitle,
    company,
    employmentType,
  };
}

// ============================================================================
// Extraction Helpers
// ============================================================================

function dedupe(items: string[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (result.indexOf(item) === -1) result.push(item);
  }
  return result;
}

function extractSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = text.split("\n");

  let currentSection = "main";
  const sectionHeaders = [
    { pattern: /^(?:about|job\s*(?:title|description|summary)|position\s*(?:title|overview|summary)|role\s*(?:title|overview|description))\s*[:;]?\s*$/im, name: "overview" },
    { pattern: /^(?:responsibilities|what you['"]?ll do|what you['"]?ll be doing|key responsibilities|duties and responsibilities|job duties|role responsibilities|the role|the opportunity|what we['"]?re looking for)\s*[:;]?\s*$/im, name: "responsibilities" },
    { pattern: /^(?:requirements|qualifications|what we['"]?re looking for|what you need|required qualifications|minimum qualifications|basic qualifications|what you bring|skills and experience|the ideal candidate|requirements and qualifications|essential requirements|necessary qualifications)\s*[:;]?\s*$/im, name: "requirements" },
    { pattern: /^(?:preferred|preferred qualifications|nice to haves|bonus points|bonus qualifications|additional qualifications|preferred skills|desired qualifications|even better if|you might also have)\s*[:;]?\s*$/im, name: "preferred" },
    { pattern: /^(?:benefits|what we offer|perks|compensation)\s*[:;]?\s*$/im, name: "benefits" },
    { pattern: /^(?:about the company|about us|who we are|our company|company overview)\s*[:;]?\s*$/im, name: "company" },
    { pattern: /^(?:education|education requirements|education qualifications)\s*[:;]?\s*$/im, name: "education" },
    { pattern: /^(?:certifications|licenses|certifications required)\s*[:;]?\s*$/im, name: "certifications" },
  ];

  for (let li = 0; li < lines.length; li++) {
    const trimmed = lines[li].trim();
    let matched = false;
    for (let si = 0; si < sectionHeaders.length; si++) {
      const { pattern, name } = sectionHeaders[si];
      if (pattern.test(trimmed)) {
        currentSection = name;
        matched = true;
        break;
      }
    }
    if (!matched && trimmed) {
      sections[currentSection] = (sections[currentSection] || "") + trimmed + "\n";
    }
  }

  return sections;
}

function extractSkills(textLower: string, originalText: string): JDExtractedSkill[] {
  const skills: JDExtractedSkill[] = [];
  const seen: string[] = [];

  function addIfNotSeen(kw: string, type: "technical" | "soft", weight: number) {
    if (textLower.includes(kw) && seen.indexOf(kw) === -1) {
      seen.push(kw);
      skills.push({ name: kw, type, weight });
    }
  }

  TECHNICAL_KEYWORDS.forEach((kw) => addIfNotSeen(kw, "technical", 0.9));
  SOFT_SKILL_KEYWORDS.forEach((kw) => addIfNotSeen(kw, "soft", 0.7));

  // Check skills against industry knowledge engine
  // (resolving aliases is done by the semantic matching engine)

  return skills;
}

function extractResponsibilities(sections: Record<string, string>): string[] {
  const resp = sections["responsibilities"] || "";
  const overview = sections["overview"] || "";
  const combined = resp + "\n" + overview;

  // Extract bulleted or numbered lines
  const items: string[] = [];
  const lines = combined.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Match bullet points
    if (/^[•\-*]\s/.test(trimmed)) {
      items.push(trimmed.replace(/^[•\-*]\s+/, "").trim());
    } else if (/^\d+[.)]\s/.test(trimmed)) {
      items.push(trimmed.replace(/^\d+[.)]\s+/, "").trim());
    } else if (trimmed && trimmed.length > 20 && !trimmed.endsWith(":")) {
      // Long continuous text might be a responsibility paragraph
      items.push(trimmed);
    }
  }

  // Deduplicate
  return dedupe(items);
}

function extractQualifications(sections: Record<string, string>): {
  required: string[];
  preferred: string[];
} {
  const required = extractBulletItems(sections["requirements"] || "");
  const preferred = extractBulletItems(sections["preferred"] || "");
  return { required, preferred };
}

function extractBulletItems(text: string): string[] {
  const items: string[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[•\-*]\s/.test(trimmed)) {
      items.push(trimmed.replace(/^[•\-*]\s+/, "").trim());
    } else if (/^\d+[.)]\s/.test(trimmed)) {
      items.push(trimmed.replace(/^\d+[.)]\s+/, "").trim());
    } else if (trimmed && trimmed.length > 15) {
      items.push(trimmed);
    }
  }
  return dedupe(items);
}

function extractCertifications(textLower: string, originalText: string): string[] {
  const found: string[] = [];
  CERTIFICATION_KEYWORDS.forEach((cert) => {
    if (textLower.includes(cert)) {
      found.push(cert);
    }
  });
  return found;
}

function extractTools(text: string, textLower: string): string[] {
  const found: string[] = [];
  for (const pattern of TOOL_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      found.push(match[1].trim());
    }
  }
  return found;
}

function extractExperienceYears(textLower: string): number | null {
  // Patterns: "3+ years", "3-5 years", "at least 3 years", "minimum 3 years"
  const patterns = [
    /(\d+)\+\s*(?:years?|yrs?)/i,
    /(\d+)\s*[-–—to]+\s*\d+\s*(?:years?|yrs?)/i,
    /(?:at\s*least|minimum|a\s*minimum\s*of)\s*(\d+)\s*(?:years?|yrs?)/i,
    /(\d+)\s*(?:years?|yrs?)\s*(?:of\s*)?(?:experience|work)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(textLower);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

function extractEducation(textLower: string): string[] {
  const found: string[] = [];
  const patterns = [
    /(?:bachelor|b\.?[as]\.?|bs|ba|b\.?sc\.?)\s*(?:'s|s\s*)?(?:degree)?/i,
    /(?:master|m\.?[as]\.?|ms|ma|m\.?sc\.?|mba)\s*(?:'s|s\s*)?(?:degree)?/i,
    /(?:ph\.?d|doctorate|doctoral|phd)\s*(?:degree)?/i,
    /(?:associate|associate'?s)\s*(?:degree)?/i,
    /(?:high\s*school|diploma|ged)/i,
  ];

  for (const pattern of patterns) {
    const match = textLower.match(pattern);
    if (match) {
      found.push(match[0].trim());
    }
  }

  return dedupe(found);
}

function extractSoftSkills(textLower: string): string[] {
  const found: string[] = [];
  SOFT_SKILL_KEYWORDS.forEach((kw) => {
    if (textLower.includes(kw)) {
      found.push(kw);
    }
  });
  return dedupe(found);
}

function extractRoleTitle(text: string): string {
  // Try to find "Job Title:" or "Title:" pattern first
  const titleMatch = text.match(/(?:job\s*title|position\s*title|role\s*title)\s*[:;]?\s*([^\n,.]+)/i);
  if (titleMatch) return titleMatch[1].trim();

  // Fallback: first meaningful line
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 0) {
    const first = lines[0].trim();
    // Skip common non-title headers
    if (!/^(about|we are|our company)/i.test(first)) {
      return first;
    }
  }

  return "";
}

function extractCompany(text: string): string {
  const match = text.match(/(?:company|organization|employer)\s*[:;]?\s*([^\n,.]+)/i);
  if (match) return match[1].trim();
  return "";
}

function extractEmploymentType(textLower: string): string | null {
  if (/\bfull[\s-]*time\b/i.test(textLower)) return "Full-time";
  if (/\bpart[\s-]*time\b/i.test(textLower)) return "Part-time";
  if (/\bcontract\b/i.test(textLower)) return "Contract";
  if (/\bfreelance\b/i.test(textLower)) return "Freelance";
  if (/\binternship\b/i.test(textLower)) return "Internship";
  if (/\btemporary\b/i.test(textLower)) return "Temporary";
  return null;
}

export default {
  analyzeJD,
};
