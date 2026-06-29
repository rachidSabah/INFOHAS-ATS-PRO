/**
 * JobMemory Architecture — Pre-Optimization Context Extraction
 *
 * MISSION:
 * Before any agent starts optimizing, we parse the Job Description (JD)
 * to extract keywords, competencies, and terminology. This "Memory" is then
 * used by all agents to ensure consistency and high ATS alignment.
 */

import type { JobDescription } from "./types";

export interface JobMemory {
  jobTitle: string;
  company?: string;
  keywords: string[];
  competencies: string[];
  terminology: string[];
  phrases: string[];
  hardSkills: string[];
  softSkills: string[];
  industry: string;
}

/**
 * Extract JobMemory from a raw Job Description.
 */
export function extractJobMemory(jd: JobDescription | string): JobMemory {
  const text = typeof jd === 'string' ? jd : `${jd.title} ${jd.company || ''} ${(jd as any).description || (jd as any).rawText || ''}`;
  const lowerText = text.toLowerCase();

  // 1. Extract Keywords (Common ATS keywords)
  const keywords = extractKeywords(lowerText);

  // 2. Extract Competencies
  const competencies = extractCompetencies(lowerText);

  // 3. Extract Industry Terminology
  const terminology = extractTerminology(lowerText);

  // 4. Identify Industry
  const industry = identifyIndustry(lowerText);

  return {
    jobTitle: typeof jd === 'string' ? "Target Role" : jd.title,
    company: typeof jd === 'string' ? undefined : jd.company,
    keywords,
    competencies,
    terminology,
    phrases: [], // Can be populated by AI later if needed
    hardSkills: keywords.slice(0, 10),
    softSkills: competencies.slice(0, 5),
    industry
  };
}

function extractKeywords(text: string): string[] {
  // Simple heuristic for now — in production this could use a small NLP model
  const commonKeywords = [
    "project management", "software development", "customer service", "sales",
    "marketing", "data analysis", "leadership", "teamwork", "communication",
    "problem solving", "agile", "scrum", "python", "javascript", "react",
    "cloud computing", "aws", "azure", "docker", "kubernetes", "sql",
    "nosql", "machine learning", "ai", "devops", "sre", "security",
    "compliance", "risk management", "financial analysis", "accounting",
    "strategic planning", "operations", "supply chain", "logistics"
  ];

  return commonKeywords.filter(kw => text.includes(kw));
}

function extractCompetencies(text: string): string[] {
  const commonCompetencies = [
    "analytical thinking", "attention to detail", "creativity", "flexibility",
    "initiative", "interpersonal skills", "negotiation", "organization",
    "persuasion", "planning", "presentation skills", "reliability",
    "self-motivation", "stress management", "time management"
  ];

  return commonCompetencies.filter(c => text.includes(c));
}

function extractTerminology(text: string): string[] {
  const commonTerms = [
    "stakeholder", "deliverable", "kpi", "roi", "milestone", "roadmap",
    "best practices", "standard operating procedures", "sop", "scalability",
    "high availability", "fault tolerance", "disaster recovery", "user experience",
    "ux", "user interface", "ui", "customer journey", "omnichannel"
  ];

  return commonTerms.filter(t => text.includes(t));
}

function identifyIndustry(text: string): string {
  if (text.includes("software") || text.includes("developer") || text.includes("engineer")) return "Technology";
  if (text.includes("patient") || text.includes("hospital") || text.includes("medical")) return "Healthcare";
  if (text.includes("financial") || text.includes("bank") || text.includes("investment")) return "Finance";
  if (text.includes("flight") || text.includes("cabin") || text.includes("airline")) return "Aviation";
  return "General";
}
