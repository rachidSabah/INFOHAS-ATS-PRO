// Tests for the Job Intelligence Engine
import { describe, it, expect } from "vitest";
import { analyzeJobIntelligence } from "./job-intelligence";
import { computeRelevanceScore } from "./relevance-engine";
import { validateResumeContent, isForbiddenSection } from "./ai-error-filter";
import { runValidationPipeline } from "./output-validator";
import type { JobDescription } from "./types";

describe("Job Intelligence Engine", () => {
  const mockJD: JobDescription = {
    id: "jd_test",
    title: "Customer Contact Centre Agent",
    company: "Emirates",
    location: "Dubai, UAE",
    employmentType: "Full-time",
    salary: "",
    responsibilities: ["Handle customer calls", "Resolve complaints"],
    requiredSkills: ["Customer Service", "Communication", "CRM"],
    preferredSkills: ["Multilingual"],
    technologies: ["Salesforce"],
    experienceYears: "2",
    education: "High School",
    keywords: ["customer service", "call center", "communication"],
    rawText: "Customer Contact Centre Agent at Emirates. Handle customer calls, resolve complaints, provide excellent service.",
    source: "text",
    createdAt: new Date().toISOString(),
  };

  it("analyzes a job description and returns structured intelligence", async () => {
    // This test will use the AI provider chain (Puter → server → local)
    // In the test environment, it will fall back to the local engine
    const result = await analyzeJobIntelligence(mockJD);
    expect(result).toBeDefined();
    expect(result.roleTitle).toBeDefined();
    expect(result.priorityKeywords).toBeDefined();
    expect(Array.isArray(result.priorityKeywords)).toBe(true);
  });

  it("falls back gracefully when AI fails", async () => {
    // Even if the AI call fails, the function should return a valid object
    const result = await analyzeJobIntelligence({
      ...mockJD,
      rawText: "", // empty raw text to trigger edge case
    });
    expect(result).toBeDefined();
    expect(result.roleTitle).toBe(mockJD.title);
  });
});

describe("Relevance Scoring Engine", () => {
  const mockResume = {
    id: "r1",
    name: "Test User",
    headline: "Customer Service Agent",
    contact: { email: "test@test.com", phone: "+1234567890", location: "Dubai" },
    summary: "Customer service professional with 3 years of experience in call center operations, complaint resolution, and CRM systems.",
    experience: [
      {
        id: "e1",
        title: "Customer Service Agent",
        company: "Emirates",
        location: "Dubai",
        startDate: "2022",
        endDate: "Present",
        bullets: ["Handled customer calls and resolved complaints", "Used CRM to track customer interactions"],
      },
    ],
    education: [{ id: "ed1", institution: "University", degree: "BA", startDate: "2018", endDate: "2022" }],
    skills: [
      { id: "s1", name: "Customer Service" },
      { id: "s2", name: "Communication" },
      { id: "s3", name: "CRM" },
    ],
    languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
    projects: [],
    certifications: [],
    template: "infohas-pro",
    accentColor: "#0563C1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "manual",
  };

  const mockJI = {
    requiredSkills: ["Customer Service", "Communication", "CRM"],
    preferredSkills: ["Multilingual"],
    requiredExperienceYears: 2,
    requiredRoles: ["Customer Service Agent"],
    requiredLanguages: ["English"],
    requiredCompetencies: ["customer service", "communication"],
    requiredTechnicalSkills: ["CRM"],
    requiredSoftSkills: ["active listening"],
    requiredIndustryKnowledge: ["aviation"],
    preferredQualifications: [],
    industry: "aviation",
    businessFunction: "customer service",
    recruiterIntent: "Looking for customer-focused agent",
    roleTitle: "Customer Contact Centre Agent",
    company: "Emirates",
    priorityKeywords: ["customer service", "communication", "crm", "complaint resolution", "call handling"],
    avoidKeywords: ["airport security", "passenger profiling"],
  };

  it("computes a relevance score between 0 and 100", () => {
    const score = computeRelevanceScore(mockResume as any, mockJI as any);
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
  });

  it("detects matched priority keywords", () => {
    const score = computeRelevanceScore(mockResume as any, mockJI as any);
    expect(score.details.matchedPriorityKeywords).toContain("customer service");
    expect(score.details.matchedPriorityKeywords).toContain("communication");
    expect(score.details.matchedPriorityKeywords).toContain("crm");
  });

  it("detects missing priority keywords", () => {
    const score = computeRelevanceScore(mockResume as any, mockJI as any);
    // "call handling" is not in the resume
    expect(score.details.missingPriorityKeywords).toContain("call handling");
  });

  it("detects avoid keywords when present", () => {
    const resumeWithAvoid = {
      ...mockResume,
      summary: mockResume.summary + " Experience in airport security and passenger profiling.",
    };
    const score = computeRelevanceScore(resumeWithAvoid as any, mockJI as any);
    expect(score.details.avoidKeywordsFound).toContain("airport security");
    expect(score.details.avoidKeywordsFound).toContain("passenger profiling");
    // Score should be penalized
    expect(score.overall).toBeLessThan(100);
  });

  it("detects transferable skills", () => {
    const score = computeRelevanceScore(mockResume as any, mockJI as any);
    expect(score.details.transferableSkillsDetected).toContain("Customer Support");
    expect(score.details.transferableSkillsDetected).toContain("Communication");
  });

  it("sets passes=true when score >= 90", () => {
    // The mock resume has good relevance — should pass
    const score = computeRelevanceScore(mockResume as any, mockJI as any);
    if (score.overall >= 90) {
      expect(score.passes).toBe(true);
    } else {
      expect(score.passes).toBe(false);
    }
  });
});

describe("AI Error Leak Prevention", () => {
  it("detects AI error messages in resume content", () => {
    const contaminatedResume = {
      id: "r1",
      name: "Test User",
      headline: "Developer",
      contact: {},
      summary: "Optimization incomplete — the AI returned non-JSON output. Please try again.",
      experience: [{
        id: "e1",
        title: "Developer",
        company: "Test Co",
        startDate: "2022",
        endDate: "Present",
        bullets: ["Built things", "AI did not return valid JSON"],
      }],
      education: [],
      skills: [{ id: "s1", name: "JavaScript" }],
      languages: [],
      projects: [],
      certifications: [],
      template: "infohas-pro",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "manual",
    };

    const result = validateResumeContent(contaminatedResume as any);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e: string) => e.includes("AI error leak"))).toBe(true);
  });

  it("accepts clean resume content", () => {
    const cleanResume = {
      id: "r1",
      name: "Test User",
      headline: "Customer Service Agent",
      contact: { email: "test@test.com" },
      summary: "Customer service professional with 3 years of experience in call center operations and complaint resolution.",
      experience: [{
        id: "e1",
        title: "Customer Service Agent",
        company: "Emirates",
        startDate: "2022",
        endDate: "Present",
        bullets: ["Handled customer calls", "Resolved complaints using CRM"],
      }],
      education: [{ id: "ed1", institution: "University", degree: "BA", startDate: "2018", endDate: "2022" }],
      skills: [{ id: "s1", name: "Customer Service" }],
      languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
      projects: [],
      certifications: [],
      template: "infohas-pro",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "manual",
    };

    const result = validateResumeContent(cleanResume as any);
    expect(result.valid).toBe(true);
  });

  it("detects forbidden section titles", () => {
    expect(isForbiddenSection("Requirements Match")).toBe(true);
    expect(isForbiddenSection("ATS Analysis")).toBe(true);
    expect(isForbiddenSection("AI Notes")).toBe(true);
    expect(isForbiddenSection("Optimization Notes")).toBe(true);
    expect(isForbiddenSection("Provider Errors")).toBe(true);
  });

  it("allows legitimate section titles", () => {
    expect(isForbiddenSection("Professional Summary")).toBe(false);
    expect(isForbiddenSection("Core Competencies & Skills")).toBe(false);
    expect(isForbiddenSection("Professional Experience")).toBe(false);
    expect(isForbiddenSection("Education")).toBe(false);
    expect(isForbiddenSection("Languages")).toBe(false);
  });
});

describe("Output Validation Pipeline", () => {
  it("runs all 7 validators and returns a pipeline result", () => {
    const resume = {
      id: "r1",
      name: "Test User",
      headline: "Customer Service Agent",
      contact: { email: "test@test.com", phone: "+1234567890" },
      summary: "Customer service professional with 3 years of experience in call center operations and complaint resolution.",
      experience: [{
        id: "e1",
        title: "Customer Service Agent",
        company: "Emirates",
        startDate: "2022",
        endDate: "Present",
        bullets: ["Handled customer calls", "Resolved complaints"],
      }],
      education: [{ id: "ed1", institution: "University", degree: "BA", startDate: "2018", endDate: "2022" }],
      skills: [{ id: "s1", name: "Customer Service" }],
      languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
      projects: [],
      certifications: [],
      template: "infohas-pro",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "manual",
    };

    const result = runValidationPipeline(resume as any, null, null);
    expect(result.checks.length).toBe(6); // 6 checks without job intelligence (no ji)
    expect(result.allPassed).toBeDefined();
    expect(result.checks.every((c: any) => c.name && typeof c.passed === "boolean")).toBe(true);
  });
});
