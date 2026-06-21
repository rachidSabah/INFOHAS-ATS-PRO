// ============================================================================
// CompanyIntelligenceAgent + SkillGapAgent
//
// Two new agents that run IN PARALLEL during Step 2 of the upgraded pipeline:
//   - CompanyIntelligenceAgent: generates a company profile (culture, values,
//     leadership principles, hiring priorities, ATS vendor, interview focus)
//   - SkillGapAgent: analyzes the gap between the candidate's skills and the
//     job/industry/company requirements, categorizes missing skills, and
//     identifies transferable/adjacent skills for bridging.
//
// Both results are passed to the Resume Optimizer agent (Step 6) so it can
// reason about what the company values and how to bridge missing skills —
// instead of just keyword-stuffing.
//
// Designed for Cloudflare Pages Free (Edge Runtime compatible):
//   - Each agent is a single async function that completes in < 30s
//   - No external queues, no message buses
//   - Results are returned to the orchestrator for persistence
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import type { JobIntelligence } from "../job-intelligence";
import { callAI, extractJSON } from "../ai";

// ============================================================================
// CompanyIntelligenceAgent
// ============================================================================

export interface CompanyIntelligence {
  companyName: string;
  overview: string;
  culture: string;
  values: string[];
  leadershipPrinciples: string[];
  hiringPriorities: string[];
  businessFocus: string;
  technologyStack: string[];
  likelyAtsSystem: string;
  interviewFocusAreas: string[];
  valuedCompetencies: string[];
  /** What this specific company looks for in candidates (e.g. Amazon → Leadership Principles, Google → Impact+Scale, Emirates → Service Excellence+Safety). */
  companySpecificPriorities: string[];
  /** How the candidate should position themselves for THIS company. */
  positioningAdvice: string;
}

/**
 * Generate company intelligence from the JD + company name.
 *
 * If no company is identifiable from the JD, returns a generic profile
 * (still useful for the optimizer — it gets industry-level intelligence
 * instead of nothing).
 */
export async function analyzeCompanyIntelligence(
  jd: JobDescription,
  ji: JobIntelligence | null,
): Promise<CompanyIntelligence | null> {
  const companyName = jd.company?.trim() || ji?.company?.trim() || "";
  if (!companyName) {
    // No company identifiable — return null so the orchestrator can skip
    // company-specific optimization. The optimizer will still work with
    // just JI + SkillGap + ATS.
    return null;
  }

  const jdContext = jd.rawText?.slice(0, 2000) ??
    JSON.stringify({ title: jd.title, company: jd.company, responsibilities: jd.responsibilities, requiredSkills: jd.requiredSkills, keywords: jd.keywords });

  const result = await callAI({
    systemPrompt: `You are an Expert Company Intelligence Analyst. You generate concise, actionable company profiles that a resume optimizer can use to tailor a candidate's resume for THIS specific company. NEVER fabricate — if you don't know something, say "Information not available". Return ONLY valid JSON.`,
    userPrompt: `COMPANY: ${companyName}
JOB TITLE: ${jd.title || "N/A"}
INDUSTRY: ${ji?.industry ?? "unknown"}

JOB DESCRIPTION:
${jdContext}

${ji ? `JOB INTELLIGENCE:\nIndustry: ${ji.industry}\nBusiness Function: ${ji.businessFunction}\nRecruiter Intent: ${ji.recruiterIntent}\n` : ""}

Generate a company intelligence profile for ${companyName}. Focus on what a resume optimizer needs to know to tailor a resume for THIS company. Return JSON:
{
  "companyName": "${companyName}",
  "overview": "1-2 sentence company overview",
  "culture": "1-2 sentence culture description",
  "values": ["value1", "value2", "value3"],
  "leadershipPrinciples": ["principle1", "principle2"],
  "hiringPriorities": ["priority1", "priority2"],
  "businessFocus": "1 sentence on what the company does / its strategic focus",
  "technologyStack": ["tech1", "tech2"],
  "likelyAtsSystem": "Workday | Greenhouse | Taleo | Lever | SuccessFactors | Unknown",
  "interviewFocusAreas": ["area1", "area2"],
  "valuedCompetencies": ["competency1", "competency2"],
  "companySpecificPriorities": ["e.g. for Amazon: 'Customer Obsession', 'Bias for Action'; for Google: 'Impact at Scale', 'Googleyness'; for Emirates: 'Service Excellence', 'Safety Culture'"],
  "positioningAdvice": "1-2 sentences on how a candidate should position themselves for THIS company"
}

Be specific to ${companyName}. If information is not available for a field, use an empty array or "Information not available" — never fabricate.`,
    maxTokens: 1800,
    temperature: 0.3,
    taskCategory: "document",
  });

  let data: any;
  try { data = extractJSON<any>(result.text); }
  catch { return null; }

  // Defensive normalization (the AI may return arrays as strings, etc.)
  const toArray = (v: any): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    if (typeof v === "string" && v.trim()) return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    return [];
  };
  const toStr = (v: any): string => (v === null || v === undefined) ? "" : String(v);

  return {
    companyName: toStr(data.companyName) || companyName,
    overview: toStr(data.overview),
    culture: toStr(data.culture),
    values: toArray(data.values),
    leadershipPrinciples: toArray(data.leadershipPrinciples),
    hiringPriorities: toArray(data.hiringPriorities),
    businessFocus: toStr(data.businessFocus),
    technologyStack: toArray(data.technologyStack),
    likelyAtsSystem: toStr(data.likelyAtsSystem) || "Unknown",
    interviewFocusAreas: toArray(data.interviewFocusAreas),
    valuedCompetencies: toArray(data.valuedCompetencies),
    companySpecificPriorities: toArray(data.companySpecificPriorities),
    positioningAdvice: toStr(data.positioningAdvice),
  };
}

// ============================================================================
// SkillGapAgent
// ============================================================================

export interface SkillGapIntelligence {
  overallMatch: number; // 0-100
  matchedSkills: string[];
  missingSkills: {
    critical: string[]; // MUST have for the job
    important: string[]; // strongly preferred
    optional: string[]; // nice-to-have
  };
  /** Skills the candidate has that can be reframed as equivalent to a missing skill (e.g. "TypeScript" ≈ "JavaScript"). */
  transferableSkills: { candidateSkill: string; equivalentTo: string; rationale: string }[];
  /** Skills adjacent to the candidate's existing skills that they likely have but didn't list (e.g. "REST APIs" if they know "HTTP"). */
  adjacentSkills: string[];
  /** Certifications that would close a gap (recommended, not required). */
  recommendedCertifications: string[];
  /** Specific improvement opportunities — what to learn or highlight next. */
  improvementOpportunities: string[];
  /** How the optimizer should bridge the missing skills (semantic alignment, not fabrication). */
  bridgingStrategy: string;
}

/**
 * Analyze the skill gap between the candidate's resume and the job + industry
 * + company requirements. Categorizes missing skills and identifies
 * transferable/adjacent skills the optimizer can use to bridge gaps without
 * fabricating experience.
 */
export async function analyzeSkillGap(
  resume: ResumeData,
  jd: JobDescription,
  ji: JobIntelligence | null,
  company: CompanyIntelligence | null,
): Promise<SkillGapIntelligence | null> {
  if (!ji) {
    // Can't do a meaningful skill gap analysis without job intelligence.
    return null;
  }

  const result = await callAI({
    systemPrompt: `You are an Expert Career Advisor and Skills Analyst. You analyze the gap between a candidate's resume and a job's requirements, then identify transferable and adjacent skills the candidate can use to bridge gaps — WITHOUT fabricating experience. Return ONLY valid JSON.`,
    userPrompt: `CANDIDATE RESUME:
${JSON.stringify({
  name: resume.name,
  headline: resume.headline,
  summary: resume.summary,
  skills: resume.skills.map((s) => s.name),
  experience: resume.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets.slice(0, 2) })),
  education: resume.education.map((ed) => ({ degree: ed.degree, field: ed.field, institution: ed.institution })),
  certifications: resume.certifications.map((c) => c.name),
})}

JOB INTELLIGENCE:
Industry: ${ji.industry}
Business Function: ${ji.businessFunction}
Required Skills: ${ji.requiredSkills.join(", ")}
Preferred Skills: ${ji.preferredSkills.join(", ")}
Required Technical Skills: ${ji.requiredTechnicalSkills.join(", ")}
Required Soft Skills: ${ji.requiredSoftSkills.join(", ")}
Required Competencies: ${ji.requiredCompetencies.join(", ")}
Required Certifications: ${ji.requiredCertifications.join(", ")}
Priority Keywords: ${ji.priorityKeywords.join(", ")}

${company ? `COMPANY INTELLIGENCE:\nCompany: ${company.companyName}\nValued Competencies: ${company.valuedCompetencies.join(", ")}\nCompany-Specific Priorities: ${company.companySpecificPriorities.join(", ")}\n` : ""}

Analyze the skill gap. Identify:
1. Matched skills (candidate has them, job wants them)
2. Missing skills — categorize as critical / important / optional
3. Transferable skills — candidate has a skill that's equivalent to a missing one (e.g. "TypeScript" ≈ "JavaScript"). Explain the rationale.
4. Adjacent skills — skills the candidate likely has but didn't list (e.g. "REST APIs" if they know "HTTP")
5. Recommended certifications (not required, just helpful)
6. Improvement opportunities
7. A bridging strategy the resume optimizer can use

Return JSON:
{
  "overallMatch": <0-100>,
  "matchedSkills": ["..."],
  "missingSkills": {
    "critical": ["..."],
    "important": ["..."],
    "optional": ["..."]
  },
  "transferableSkills": [{"candidateSkill":"...","equivalentTo":"...","rationale":"..."}],
  "adjacentSkills": ["..."],
  "recommendedCertifications": ["..."],
  "improvementOpportunities": ["..."],
  "bridgingStrategy": "1-2 sentences on how to bridge missing skills via semantic alignment, transferable experience, and repositioning — NEVER fabrication"
}

Be honest. If the candidate is a poor match, say so. The bridging strategy must be truthful — no invented experience.`,
    maxTokens: 2200,
    temperature: 0.3,
    taskCategory: "document",
  });

  let data: any;
  try { data = extractJSON<any>(result.text); }
  catch { return null; }

  // Defensive normalization
  const toArray = (v: any): string[] => {
    if (Array.isArray(v)) return v.map((x) => typeof x === "string" ? x : (typeof x === "object" ? JSON.stringify(x) : String(x))).filter(Boolean);
    if (typeof v === "string" && v.trim()) return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    return [];
  };
  const toStr = (v: any): string => (v === null || v === undefined) ? "" : String(v);
  const toNum = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const toTransferableArray = (v: any) => {
    if (!Array.isArray(v)) return [];
    return v.filter((x) => x && typeof x === "object").map((x) => ({
      candidateSkill: toStr(x.candidateSkill),
      equivalentTo: toStr(x.equivalentTo),
      rationale: toStr(x.rationale),
    }));
  };

  return {
    overallMatch: toNum(data.overallMatch),
    matchedSkills: toArray(data.matchedSkills),
    missingSkills: {
      critical: toArray(data.missingSkills?.critical),
      important: toArray(data.missingSkills?.important),
      optional: toArray(data.missingSkills?.optional),
    },
    transferableSkills: toTransferableArray(data.transferableSkills),
    adjacentSkills: toArray(data.adjacentSkills),
    recommendedCertifications: toArray(data.recommendedCertifications),
    improvementOpportunities: toArray(data.improvementOpportunities),
    bridgingStrategy: toStr(data.bridgingStrategy),
  };
}
