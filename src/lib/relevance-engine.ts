// ResumeAI Pro — Relevance Scoring Engine
// Computes a 0-100 relevance score for a resume against a job intelligence.
// Score < 90 → regenerate (don't generate final PDF).
// Score >= 90 → generate final PDF.

"use client";

import type { ResumeData } from "./types";
import type { JobIntelligence } from "./job-intelligence";

export interface RelevanceScore {
  overall: number;          // 0-100
  skillMatch: number;       // 0-100
  experienceMatch: number;  // 0-100
  languageMatch: number;    // 0-100
  industryMatch: number;    // 0-100
  roleMatch: number;        // 0-100
  customerServiceMatch: number; // 0-100
  communicationMatch: number;   // 0-100
  salesMatch: number;       // 0-100
  // Detailed breakdown for debugging
  details: {
    matchedPriorityKeywords: string[];
    missingPriorityKeywords: string[];
    avoidKeywordsFound: string[];
    transferableSkillsDetected: string[];
  };
  // Whether the resume passes the relevance threshold
  passes: boolean;          // overall >= 90
}

/**
 * Compute the relevance score of a resume against a job intelligence.
 * This is a heuristic engine (no AI call) — fast and deterministic.
 */
export function computeRelevanceScore(resume: ResumeData, ji: JobIntelligence): RelevanceScore {
  // === 1. SKILL MATCH (weight: 25%) ===
  // How many of the job's required/priority skills are present in the resume?
  const resumeSkillsLower = (resume.skills || []).map((s) => s.name.toLowerCase());
  const resumeTextLower = buildResumeText(resume).toLowerCase();

  const matchedPriorityKeywords: string[] = [];
  const missingPriorityKeywords: string[] = [];
  for (const kw of ji.priorityKeywords) {
    const kwLower = kw.toLowerCase();
    const found = resumeSkillsLower.some((s) => s.includes(kwLower) || kwLower.includes(s)) || resumeTextLower.includes(kwLower);
    if (found) matchedPriorityKeywords.push(kw);
    else missingPriorityKeywords.push(kw);
  }
  const skillMatch = ji.priorityKeywords.length > 0
    ? Math.round((matchedPriorityKeywords.length / ji.priorityKeywords.length) * 100)
    : 50;

  // === 2. EXPERIENCE MATCH (weight: 15%) ===
  // Does the resume have enough years of experience?
  const resumeYears = estimateExperienceYears(resume);
  const experienceMatch = ji.requiredExperienceYears > 0
    ? Math.min(100, Math.round((resumeYears / ji.requiredExperienceYears) * 100))
    : 80; // no requirement → assume OK

  // === 3. LANGUAGE MATCH (weight: 10%) ===
  // Does the resume have the required languages?
  const resumeLanguagesLower = (resume.languages || []).map((l) => l.name.toLowerCase());
  const matchedLanguages = ji.requiredLanguages.filter((rl) =>
    resumeLanguagesLower.some((sl) => sl.includes(rl.toLowerCase()) || rl.toLowerCase().includes(sl))
  );
  const languageMatch = ji.requiredLanguages.length > 0
    ? Math.round((matchedLanguages.length / ji.requiredLanguages.length) * 100)
    : 80;

  // === 4. INDUSTRY MATCH (weight: 10%) ===
  // Does the resume mention the target industry?
  const industryKws = ji.requiredIndustryKnowledge.concat(ji.industry ? [ji.industry] : []);
  const industryMatch = industryKws.length > 0
    ? Math.min(100, Math.round(industryKws.filter((kw) => resumeTextLower.includes(kw.toLowerCase())).length / industryKws.length * 100))
    : 50;

  // === 5. ROLE MATCH (weight: 15%) ===
  // Does the resume's headline/title match the target role?
  const headlineLower = (resume.headline || "").toLowerCase();
  const roleTitleLower = ji.roleTitle.toLowerCase();
  const roleKeywords = roleTitleLower.split(/\s+/).filter((w) => w.length > 3);
  const matchedRoleKeywords = roleKeywords.filter((kw) => headlineLower.includes(kw) || resumeTextLower.includes(kw));
  const roleMatch = roleKeywords.length > 0
    ? Math.min(100, Math.round((matchedRoleKeywords.length / roleKeywords.length) * 100))
    : 50;

  // === 6. CUSTOMER SERVICE MATCH (weight: 10%) ===
  // Specific to customer-service roles (very common in aviation/retail/hospitality)
  const csKeywords = ["customer service", "customer support", "customer satisfaction", "customer experience", "client service", "passenger service", "guest service"];
  const csRequired = ji.businessFunction.toLowerCase().includes("customer") || ji.requiredCompetencies.some((c) => /customer/i.test(c));
  const csFound = csKeywords.filter((kw) => resumeTextLower.includes(kw));
  const customerServiceMatch = csRequired
    ? Math.min(100, Math.round((csFound.length / Math.min(csKeywords.length, 4)) * 100))
    : 80; // not required → neutral

  // === 7. COMMUNICATION MATCH (weight: 5%) ===
  const commKeywords = ["communication", "communicate", "verbal", "written", "interpersonal", "active listening"];
  const commFound = commKeywords.filter((kw) => resumeTextLower.includes(kw));
  const communicationMatch = Math.min(100, Math.round((commFound.length / commKeywords.length) * 100) + 40);

  // === 8. SALES MATCH (weight: 5%) ===
  const salesKeywords = ["sales", "selling", "cross-sell", "upsell", "upselling", "cross-selling", "revenue", "target"];
  const salesRequired = ji.businessFunction.toLowerCase().includes("sales") || ji.requiredCompetencies.some((c) => /sales/i.test(c));
  const salesFound = salesKeywords.filter((kw) => resumeTextLower.includes(kw));
  const salesMatch = salesRequired
    ? Math.min(100, Math.round((salesFound.length / salesKeywords.length) * 100) + 30)
    : 80; // not required → neutral

  // === AVOID KEYWORDS DETECTION ===
  const avoidKeywordsFound = ji.avoidKeywords.filter((kw) => resumeTextLower.includes(kw.toLowerCase()));

  // === TRANSFERABLE SKILLS DETECTION ===
  const transferableSkillsDetected = detectTransferableSkills(resumeTextLower);

  // === OVERALL SCORE (weighted average) ===
  const overall = Math.round(
    skillMatch * 0.25 +
    experienceMatch * 0.15 +
    languageMatch * 0.10 +
    industryMatch * 0.10 +
    roleMatch * 0.15 +
    customerServiceMatch * 0.10 +
    communicationMatch * 0.05 +
    salesMatch * 0.05 +
    5 // base bonus
  );

  // Penalize if avoid keywords are present (irrelevant keywords emphasized)
  const penalizedOverall = Math.max(0, overall - (avoidKeywordsFound.length * 5));

  return {
    overall: penalizedOverall,
    skillMatch,
    experienceMatch,
    languageMatch,
    industryMatch,
    roleMatch,
    customerServiceMatch,
    communicationMatch,
    salesMatch,
    details: {
      matchedPriorityKeywords,
      missingPriorityKeywords,
      avoidKeywordsFound,
      transferableSkillsDetected,
    },
    passes: penalizedOverall >= 90,
  };
}

/**
 * Build a single text blob from the resume for keyword matching.
 */
function buildResumeText(r: ResumeData): string {
  const parts: string[] = [];
  parts.push(r.name || "");
  parts.push(r.headline || "");
  parts.push(r.summary || "");
  for (const e of r.experience) {
    parts.push(e.title);
    parts.push(e.company);
    parts.push(e.bullets.join(" "));
  }
  for (const s of r.skills) parts.push(s.name);
  for (const ed of r.education) {
    parts.push(ed.degree);
    parts.push(ed.institution);
    if (ed.highlights) parts.push(ed.highlights.join(" "));
  }
  for (const l of r.languages) parts.push(l.name);
  return parts.filter(Boolean).join(" ");
}

/**
 * Estimate total years of experience from the resume.
 */
function estimateExperienceYears(r: ResumeData): number {
  let total = 0;
  for (const e of r.experience) {
    const start = parseYear(e.startDate);
    const end = e.endDate === "Present" || !e.endDate ? new Date().getFullYear() : parseYear(e.endDate);
    if (start && end && end >= start) total += (end - start);
  }
  return total;
}

function parseYear(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Detect transferable skills in the resume text.
 * These are skills that can be transferred from one role to another.
 */
function detectTransferableSkills(text: string): string[] {
  const transferable = [
    { skill: "Customer Support", patterns: ["customer service", "customer support", "passenger service", "guest service", "client service"] },
    { skill: "Communication", patterns: ["communication", "communicate", "verbal", "written", "interpersonal"] },
    { skill: "Problem Solving", patterns: ["problem solving", "problem resolution", "troubleshoot", "resolve"] },
    { skill: "Sales", patterns: ["sales", "selling", "cross-sell", "upsell", "revenue"] },
    { skill: "Teamwork", patterns: ["team", "collaborat", "cooperat"] },
    { skill: "Leadership", patterns: ["lead", "manage", "supervis", "direct"] },
    { skill: "Multilingual", patterns: ["bilingual", "multilingual", "fluent", "native speaker"] },
    { skill: "Fast-paced Environment", patterns: ["fast-paced", "fast paced", "high volume", "busy"] },
    { skill: "CRM", patterns: ["crm", "customer relationship management", "salesforce"] },
    { skill: "Complaint Resolution", patterns: ["complaint", "escalat", "service recovery"] },
  ];
  return transferable.filter((t) => t.patterns.some((p) => text.includes(p))).map((t) => t.skill);
}
