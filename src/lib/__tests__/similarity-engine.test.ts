import { describe, it, expect } from "vitest";
import {
  computeSimilarityScore,
  computeSummaryConfidence,
  computeExperienceConfidence,
  computeSkillsConfidence,
  computeDirectiveComplianceScore,
} from "../similarity-engine";
import type { ResumeData, ResumeSkill } from "../types";

const ORIGINAL: ResumeData = {
  id: "r_sim_test",
  name: "Jane Doe",
  headline: "Software Engineer",
  contact: { email: "jane@test.com", phone: "+123", location: "NYC" },
  summary: "Experienced software engineer with over five years of hands-on experience in full-stack development, cloud architecture, team leadership, and cross-functional collaboration across multiple enterprise projects. Proven track record of delivering measurable business outcomes through innovative technical solutions and strategic planning in fast-paced agile environments. Skilled in TypeScript, React, and Node.js with a strong foundation in system design.",
  experience: [
    { id: "e1", title: "Senior Dev", company: "Acme Corp", location: "NYC",
      startDate: "2020-01", endDate: "2024-01", bullets: ["Built API", "Led team"] }
  ],
  education: [
    { id: "ed1", institution: "MIT", degree: "BS CS", startDate: "2016", endDate: "2020" }
  ],
  skills: [
    { id: "s1", name: "TypeScript", category: "Languages" },
    { id: "s2", name: "React", category: "Frontend" },
  ],
  languages: [{ name: "English", proficiency: "fluent" } as any],
  certifications: [],
  projects: [],
  template: "ats-professional",
  accentColor: "#1154A3",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: "manual",
};

describe("Similarity Engine", () => {
  it("scores 100 for identical resumes", () => {
    const result = computeSimilarityScore(ORIGINAL, ORIGINAL);
    expect(result.overallScore).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("detects missing company", () => {
    const modified = {
      ...ORIGINAL,
      experience: [{ ...ORIGINAL.experience[0], company: "DifferentCorp" }],
    };
    const result = computeSimilarityScore(ORIGINAL, modified);
    expect(result.overallScore).toBeLessThan(85);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.includes("Missing company") || i.includes("Hallucinated"))).toBe(true);
  });

  it("detects date changes", () => {
    const modified = {
      ...ORIGINAL,
      experience: [{ ...ORIGINAL.experience[0], endDate: "2025-01" }],
    };
    const result = computeSimilarityScore(ORIGINAL, modified);
    expect(result.chronologyScore).toBeLessThan(15);
    expect(result.issues.some(i => i.includes("Date changed"))).toBe(true);
  });

  it("detects missing language", () => {
    const modified = { ...ORIGINAL, languages: [] };
    const result = computeSimilarityScore(ORIGINAL, modified);
    expect(result.entityScore).toBeLessThan(30);
    expect(result.issues.some(i => i.includes("Missing language"))).toBe(true);
  });

  it("detects missing school", () => {
    const modified = {
      ...ORIGINAL,
      education: [{ ...ORIGINAL.education[0], institution: "" }],
    };
    const result = computeSimilarityScore(ORIGINAL, modified);
    expect(result.issues.some(i => i.includes("Missing school"))).toBe(true);
  });

  it("detects hallucinated school", () => {
    const modified = {
      ...ORIGINAL,
      education: [{ ...ORIGINAL.education[0], institution: "Fake University" }],
    };
    const result = computeSimilarityScore(ORIGINAL, modified);
    expect(result.issues.some(i => i.includes("hallucinated school") || i.includes("Changed"))).toBe(true);
  });
});

describe("Confidence Engine", () => {
  it("summary confidence is high for good output", () => {
    const result = computeSummaryConfidence(
      "Old summary",
      "Experienced React and TypeScript professional with extensive enterprise software engineering background delivering impactful solutions internationally across multiple industries and diverse technical environments.",
      ["React", "TypeScript", "professional", "engineering"]
    );
    expect(result.confidence).toBeGreaterThanOrEqual(70);
    expect(result.passed).toBe(true);
  });

  it("summary confidence is low for empty output", () => {
    const result = computeSummaryConfidence("Old", "", ["React"]);
    expect(result.confidence).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("experience confidence detects hallucinated employer", () => {
    const result = computeExperienceConfidence(
      ORIGINAL.experience,
      [{ id: "e1", title: "Fake Role", company: "FakeCorp", location: "X",
        startDate: "2020", endDate: "2024", bullets: ["Did nothing"] }],
    );
    expect(result.confidence).toBeLessThan(70);
    expect(result.warnings.some(w => w.includes("Hallucinated"))).toBe(true);
  });

  it("skills confidence detects company names in skills", () => {
    const skills: ResumeSkill[] = [
      { id: "s1", name: "Acme Corp", category: "Company" },
    ];
    const result = computeSkillsConfidence(
      ORIGINAL.skills, skills,
      ["Acme Corp"], []
    );
    expect(result.confidence).toBeLessThan(70);
    expect(result.warnings.some(w => w.includes("Company name"))).toBe(true);
  });
});

describe("Directive Compliance", () => {
  it("scores 100 for compliant output", () => {
    const result = computeDirectiveComplianceScore(ORIGINAL, ORIGINAL);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("detects hallucinated employer", () => {
    const modified = {
      ...ORIGINAL,
      experience: [{ ...ORIGINAL.experience[0], company: "FakeCorp" }],
    };
    const result = computeDirectiveComplianceScore(ORIGINAL, modified);
    expect(result.checks.companiesPreserved).toBe(false);
    expect(result.checks.noHallucinations).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("detects date change", () => {
    const modified = {
      ...ORIGINAL,
      experience: [{ ...ORIGINAL.experience[0], startDate: "1999" }],
    };
    const result = computeDirectiveComplianceScore(ORIGINAL, modified);
    expect(result.checks.datesPreserved).toBe(false);
  });

  it("scores below 90 for multiple violations", () => {
    const modified = {
      ...ORIGINAL,
      name: "Wrong Name",
      experience: [{ ...ORIGINAL.experience[0], company: "FakeCorp", startDate: "1999" }],
      languages: [],
    };
    const result = computeDirectiveComplianceScore(ORIGINAL, modified);
    expect(result.score).toBeLessThan(90);
    expect(result.passed).toBe(false);
  });
});
