// ResumeAI Pro — Job Intelligence Engine
// Analyzes a job description and extracts structured intelligence:
//   - Required skills (technical + soft)
//   - Required experience (years, roles)
//   - Required languages
//   - Required competencies
//   - Preferred qualifications
//   - Industry / business function
//   - Recruiter intent
//
// This engine runs BEFORE optimization so the optimizer can prioritize
// job requirements over original-resume keywords.

"use client";

import { callAI, extractJSON } from "./ai";
import type { JobDescription } from "./types";

export interface JobIntelligence {
  // Core required skills (the MUST-HAVES)
  requiredSkills: string[];
  // Preferred skills (nice-to-haves)
  preferredSkills: string[];
  // Required experience (years + role types)
  requiredExperienceYears: number;
  requiredRoles: string[];
  // Required languages
  requiredLanguages: string[];
  // Required competencies (behavioral)
  requiredCompetencies: string[];
  // Required technical skills
  requiredTechnicalSkills: string[];
  // Required soft skills
  requiredSoftSkills: string[];
  // Required industry knowledge
  requiredIndustryKnowledge: string[];
  // Preferred qualifications
  preferredQualifications: string[];
  // Technologies / tools explicitly mentioned (e.g. React, Kubernetes, Salesforce)
  technologies: string[];
  // Required certifications (e.g. PMP, AWS Certified, CPA)
  requiredCertifications: string[];
  // ATS keywords — the exact phrases the ATS will scan for (extracted from
  // responsibilities + requirements, normalized to lowercase)
  atsKeywords: string[];
  // Industry terminology — domain-specific terms that signal industry familiarity
  industryTerminology: string[];
  // Industry / business function
  industry: string;
  businessFunction: string;
  // Recruiter intent (what the recruiter is actually looking for)
  recruiterIntent: string;
  // Role title (normalized)
  roleTitle: string;
  // Company
  company: string;
  // Top 10 priority keywords (ranked by importance — these are what the
  // optimizer MUST embed naturally, in order of priority)
  priorityKeywords: string[];
  // Keywords to AVOID (irrelevant to this job — e.g. "airport security" for a
  // call center role)
  avoidKeywords: string[];
}

/**
 * Analyze a job description and extract structured intelligence.
 * Uses the configured AI provider (via callAI).
 */
export async function analyzeJobIntelligence(jd: JobDescription): Promise<JobIntelligence> {
  const jdText = jd.rawText || [
    `Title: ${jd.title}`,
    jd.company ? `Company: ${jd.company}` : "",
    jd.location ? `Location: ${jd.location}` : "",
    jd.responsibilities?.length ? `Responsibilities:\n${jd.responsibilities.map((r) => `  - ${r}`).join("\n")}` : "",
    jd.requiredSkills?.length ? `Required Skills:\n${jd.requiredSkills.map((s) => `  - ${s}`).join("\n")}` : "",
    jd.preferredSkills?.length ? `Preferred Skills:\n${jd.preferredSkills.map((s) => `  - ${s}`).join("\n")}` : "",
    jd.keywords?.length ? `Keywords: ${jd.keywords.join(", ")}` : "",
  ].filter(Boolean).join("\n\n");

  const prompt = `You are a Job Intelligence Analyst. Analyze this job description and extract structured intelligence.

JOB DESCRIPTION:
${jdText}

Extract:
1. Required skills (MUST-HAVES — the candidate MUST have these)
2. Preferred skills (nice-to-haves)
3. Required experience (years + role types)
4. Required languages
5. Required competencies (behavioral — e.g. "customer service", "problem solving")
6. Required technical skills (e.g. "CRM", "Excel", "POS systems")
7. Required soft skills (e.g. "communication", "active listening")
8. Required industry knowledge (e.g. "aviation", "retail", "hospitality")
9. Preferred qualifications
10. Technologies / tools explicitly mentioned (e.g. React, Kubernetes, Salesforce, SAP)
11. Required certifications (e.g. PMP, AWS Certified, CPA, CCA)
12. ATS keywords — the exact phrases an Applicant Tracking System will scan for (from responsibilities + requirements, lowercase)
13. Industry terminology — domain-specific terms that signal industry familiarity (e.g. "SEP", "CRM", "DGR" for aviation)
14. Industry + business function (e.g. "aviation / customer service")
15. Recruiter intent — what is the recruiter ACTUALLY looking for? (1-2 sentences)
16. Top 10 PRIORITY keywords — ranked by importance. These are the keywords the resume optimizer MUST embed naturally, in priority order.
17. Keywords to AVOID — keywords that are IRRELEVANT to this job and should NOT be emphasized (e.g. "airport security" for a call center role).

Return ONLY valid JSON:
{
  "requiredSkills": ["skill1", "skill2", ...],
  "preferredSkills": ["skill1", ...],
  "requiredExperienceYears": 2,
  "requiredRoles": ["Customer Service Agent", "Call Center Representative", ...],
  "requiredLanguages": ["English", "French", ...],
  "requiredCompetencies": ["customer service", "problem solving", ...],
  "requiredTechnicalSkills": ["CRM", "POS", ...],
  "requiredSoftSkills": ["communication", "active listening", ...],
  "requiredIndustryKnowledge": ["aviation", "retail", ...],
  "preferredQualifications": ["Bachelor's degree", ...],
  "technologies": ["React", "Kubernetes", "Salesforce", ...],
  "requiredCertifications": ["PMP", "AWS Certified", ...],
  "atsKeywords": ["customer service", "call handling", "problem resolution", ...],
  "industryTerminology": ["SEP", "CRM", "DGR", ...],
  "industry": "aviation",
  "businessFunction": "customer service",
  "recruiterIntent": "Looking for a customer-focused agent who can handle high-volume call center operations...",
  "roleTitle": "Customer Contact Centre Agent",
  "company": "${jd.company || ""}",
  "priorityKeywords": ["customer service", "call handling", "communication", ...],
  "avoidKeywords": ["airport security", "passenger profiling", ...]
}`;

  try {
    const result = await callAI({
      systemPrompt: "You are a Job Intelligence Analyst. You extract structured intelligence from job descriptions. Always return ONLY valid JSON — no prose, no markdown fences.",
      userPrompt: prompt,
      maxTokens: 3000,
      temperature: 0.3,
      taskCategory: "document",
    });

    const data = extractJSON<JobIntelligence>(result.text);

    // Reject local fallback — it returns empty/placeholder data
    if (result.provider === "Local Engine (offline mode)") {
      console.warn("[JobIntelligence] No AI provider available — using fallback");
      return fallbackJobIntelligence(jd);
    }

    return normalizeJobIntelligence(data, jd);
  } catch (e: any) {
    console.warn("[JobIntelligence] Analysis failed, using fallback:", e?.message);
    return fallbackJobIntelligence(jd);
  }
}

function normalizeJobIntelligence(data: any, jd: JobDescription): JobIntelligence {
  return {
    requiredSkills: Array.isArray(data.requiredSkills) ? data.requiredSkills : (jd.requiredSkills || []),
    preferredSkills: Array.isArray(data.preferredSkills) ? data.preferredSkills : (jd.preferredSkills || []),
    requiredExperienceYears: typeof data.requiredExperienceYears === "number" ? data.requiredExperienceYears : 0,
    requiredRoles: Array.isArray(data.requiredRoles) ? data.requiredRoles : [],
    requiredLanguages: Array.isArray(data.requiredLanguages) ? data.requiredLanguages : [],
    requiredCompetencies: Array.isArray(data.requiredCompetencies) ? data.requiredCompetencies : [],
    requiredTechnicalSkills: Array.isArray(data.requiredTechnicalSkills) ? data.requiredTechnicalSkills : [],
    requiredSoftSkills: Array.isArray(data.requiredSoftSkills) ? data.requiredSoftSkills : [],
    requiredIndustryKnowledge: Array.isArray(data.requiredIndustryKnowledge) ? data.requiredIndustryKnowledge : [],
    preferredQualifications: Array.isArray(data.preferredQualifications) ? data.preferredQualifications : [],
    technologies: Array.isArray(data.technologies) ? data.technologies : (jd.technologies || []),
    requiredCertifications: Array.isArray(data.requiredCertifications) ? data.requiredCertifications : [],
    atsKeywords: Array.isArray(data.atsKeywords) ? data.atsKeywords : (jd.keywords || []),
    industryTerminology: Array.isArray(data.industryTerminology) ? data.industryTerminology : [],
    industry: data.industry || "",
    businessFunction: data.businessFunction || "",
    recruiterIntent: data.recruiterIntent || "",
    roleTitle: data.roleTitle || jd.title || "",
    company: data.company || jd.company || "",
    priorityKeywords: Array.isArray(data.priorityKeywords) ? data.priorityKeywords.slice(0, 10) : (jd.keywords || []).slice(0, 10),
    avoidKeywords: Array.isArray(data.avoidKeywords) ? data.avoidKeywords : [],
  };
}

function fallbackJobIntelligence(jd: JobDescription): JobIntelligence {
  return {
    requiredSkills: jd.requiredSkills || [],
    preferredSkills: jd.preferredSkills || [],
    requiredExperienceYears: 0,
    requiredRoles: [],
    requiredLanguages: [],
    requiredCompetencies: [],
    requiredTechnicalSkills: [],
    requiredSoftSkills: [],
    requiredIndustryKnowledge: [],
    preferredQualifications: [],
    technologies: jd.technologies || [],
    requiredCertifications: [],
    atsKeywords: jd.keywords || [],
    industryTerminology: [],
    industry: "",
    businessFunction: "",
    recruiterIntent: "",
    roleTitle: jd.title || "",
    company: jd.company || "",
    priorityKeywords: (jd.keywords || []).slice(0, 10),
    avoidKeywords: [],
  };
}
