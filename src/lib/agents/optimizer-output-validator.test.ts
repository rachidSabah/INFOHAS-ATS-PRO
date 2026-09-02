// Tests — OptimizerOutputValidator (directive §11 keyword accountability,
// §24 output contract, §25 no bad output propagation).

import { describe, it, expect } from "vitest";
import { computeKeywordCoverage, validateOptimizerOutput } from "./optimizer-output-validator";
import type { ResumeData, JobDescription } from "../types";

function makeResume(): ResumeData {
  return {
    id: "r1",
    name: "Test User",
    headline: "Engineer",
    contact: { email: "t@e.com", phone: "", location: "" },
    summary: "Software engineer with 10 years of experience building scalable web applications and leading teams.",
    experience: [
      {
        id: "e1",
        title: "Engineer",
        company: "Tech Corp",
        location: "SF",
        startDate: "2020-01",
        endDate: "Present",
        bullets: [
          "Led migration to microservices architecture, reducing deployment time by 65%.",
          "Mentored 5 junior engineers, with 3 receiving promotions within 18 months.",
        ],
      },
    ],
    education: [{ id: "ed1", institution: "UC Berkeley", degree: "B.S.", field: "CS", startDate: "2012", endDate: "2016" }],
    skills: [
      { id: "s1", name: "JavaScript", category: "Frontend" },
      { id: "s2", name: "Node.js", category: "Backend" },
    ],
    languages: [{ id: "l1", name: "English", proficiency: "native" }],
    projects: [],
    certifications: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    source: "manual",
  };
}

function makeJD(): JobDescription {
  return {
    id: "jd1",
    title: "Senior Engineer",
    company: "Tech Corp",
    location: "SF",
    employmentType: "Full-time",
    salary: "",
    responsibilities: ["Build scalable systems"],
    requiredSkills: ["Kubernetes", "GraphQL", "Terraform"],
    preferredSkills: [],
    technologies: ["Kubernetes"],
    experienceYears: "5+",
    education: "Bachelor's degree",
    // 4 actionable keywords (none present in the source resume) + 1 junk token
    keywords: ["Kubernetes", "GraphQL", "Terraform", "Observability", "go"],
    rawText: "Looking for a senior engineer with Kubernetes, GraphQL, Terraform and Observability experience.",
    source: "text",
    createdAt: "2025-01-01T00:00:00Z",
  };
}

describe("computeKeywordCoverage", () => {
  it("counts already-present vs integrated vs still-missing keywords", () => {
    const resume = makeResume();
    const output = {
      summary: "Software engineer with 10 years of experience building scalable web applications on Kubernetes.",
      experiences: [{ id: "e1", bullets: resume.experience[0].bullets }],
      skills: [{ id: "s1", name: "JavaScript", category: "Frontend" }],
    };
    const cov = computeKeywordCoverage(resume, output, makeJD());
    // 4 actionable keywords in JD; 1 (Kubernetes) integrated by the output.
    expect(cov.total).toBe(4); // junk token "go" filtered
    expect(cov.alreadyPresent).toBe(0);
    expect(cov.integrated).toBe(1);
    expect(cov.integrated + cov.stillMissing.length).toBe(cov.total - cov.alreadyPresent);
  });
});

describe("validateOptimizerOutput", () => {
  it("PASSES a materially different output that integrates keywords", () => {
    const output = {
      summary: "Senior software engineer specialising in Kubernetes-driven platforms and Observability-first operations, with 10 years of experience leading high-performance teams.",
      experiences: [
        {
          id: "e1",
          bullets: [
            "Led migration to Kubernetes-based microservices, reducing deployment time by 65% while strengthening Observability.",
            "Mentored 5 junior engineers using GraphQL-first API standards, with 3 receiving promotions within 18 months.",
          ],
        },
      ],
      skills: [{ id: "s1", name: "Terraform", category: "Infrastructure" }],
    };
    const res = validateOptimizerOutput(makeResume(), output, makeJD());
    expect(res.valid).toBe(true);
    expect(res.violations).toHaveLength(0);
    expect(res.keywordCoverage.integrated).toBeGreaterThanOrEqual(3);
  });

  it("FAILS an output with 0 keyword integration when ≥3 actionable keywords exist (directive §11)", () => {
    const resume = makeResume();
    const output = {
      summary: "Experienced software engineer building scalable web applications and leading engineering teams.",
      experiences: [{ id: "e1", bullets: resume.experience[0].bullets }],
      skills: [{ id: "s1", name: "JavaScript", category: "Frontend" }],
    };
    const res = validateOptimizerOutput(resume, output, makeJD());
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.includes("Keyword integration floor"))).toBe(true);
  });

  it("FAILS an output identical to the source (no meaningful optimization)", () => {
    const resume = makeResume();
    const output = {
      summary: resume.summary,
      experiences: [{ id: "e1", bullets: resume.experience[0].bullets }],
      skills: resume.skills,
    };
    const res = validateOptimizerOutput(resume, output, makeJD());
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.includes("identical to the source"))).toBe(true);
  });

  it("FAILS an empty output", () => {
    const res = validateOptimizerOutput(makeResume(), {}, makeJD());
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.includes("empty"))).toBe(true);
  });

  it("FAILS incomplete experience coverage", () => {
    const output = {
      summary: "Kubernetes and Terraform focused platform engineer with Observability expertise and GraphQL APIs.",
      experiences: [], // source has 1 entry — coverage incomplete
      skills: [{ id: "s1", name: "Terraform", category: "Infrastructure" }],
    };
    const res = validateOptimizerOutput(makeResume(), output, makeJD());
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.includes("incomplete coverage"))).toBe(true);
  });

  // ==========================================================================
  // DEADLOCK REGRESSION (production trace 0256e12b):
  // A skills-less resume + a JD whose keywords are company/location entities
  // ("Qatar Airways", "Doha") previously produced a contradictory contract:
  //   - OptimizerOutputValidator: "Keyword integration floor not met: 0 of 10
  //     actionable JD keywords integrated (Cabin Crew, Qatar Airways, Doha…)"
  //   - Structure Guardian: vetoes "Skill 'Qatar Airways' is a JD company
  //     name/location" the moment the optimizer integrated them as skills
  // Every attempt failed and all retries were exhausted. Guardian-protected
  // entities must never count toward the keyword floor.
  // ==========================================================================
  it("EXCLUDES Guardian-protected JD entities (Qatar Airways/Doha) from the actionable keyword floor", () => {
    const resume = makeResume();
    resume.skills = []; // skills-less resume — the exact production scenario
    const jd: JobDescription = {
      ...makeJD(),
      // 10 keywords, of which 2 are Guardian-protected entities
      keywords: ["Cabin Crew", "Qatar Airways", "Doha", "Flight Attendant", "Safety", "Passenger Service", "Emergency", "In-flight", "Announcements", "First Aid"],
    };
    const output = {
      summary: "Customer experience professional with safety-first passenger service, first aid readiness, and calm in-flight emergency handling across hospitality-driven teams.",
      experiences: [{ id: "e1", bullets: resume.experience[0].bullets }],
      skills: [], // cannot hold entities — Guardian vetoes them
    };
    const res = validateOptimizerOutput(resume, output, jd);
    // The 2 protected entities are excluded → 8 actionable remain; the output
    // integrates 5 of them → no floor violation.
    expect(res.keywordCoverage.total).toBe(8);
    expect(res.violations.some((v) => v.includes("Keyword integration floor"))).toBe(false);
    expect(res.valid).toBe(true);
  });

  it("STILL fails when non-entity actionable keywords are not integrated", () => {
    const resume = makeResume();
    resume.skills = [];
    const jd: JobDescription = {
      ...makeJD(),
      keywords: ["Cabin Crew", "Qatar Airways", "Doha", "Flight Attendant", "Safety", "Passenger Service", "Emergency", "In-flight", "Announcements", "First Aid"],
    };
    const output = {
      summary: "Dedicated professional focused on quality service and teamwork.",
      experiences: [{ id: "e1", bullets: resume.experience[0].bullets }],
      skills: [],
    };
    const res = validateOptimizerOutput(resume, output, jd);
    // 8 actionable remain after entity exclusion; 0 integrated → floor violation
    expect(res.keywordCoverage.total).toBe(8);
    expect(res.violations.some((v) => v.includes("Keyword integration floor"))).toBe(true);
  });
});
