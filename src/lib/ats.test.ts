import { describe, it, expect } from "vitest";
import { scoreATS, scoreLabel } from "@/lib/ats";
import type { ResumeData, JobDescription } from "@/lib/types";

// Minimal valid resume for testing
function makeResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "r_test",
    name: "Test User",
    headline: "Software Engineer",
    contact: {
      email: "test@example.com",
      phone: "+1-555-0100",
      location: "San Francisco, CA",
      linkedin: "linkedin.com/in/test",
    },
    summary: "Senior engineer with 7+ years building scalable web apps.",
    experience: [
      {
        id: "e1",
        title: "Senior Engineer",
        company: "Acme",
        location: "Remote",
        startDate: "2022-01",
        endDate: "Present",
        bullets: [
          "Led migration to Next.js, cutting build times by 62%.",
          "Built design system used by 28 engineers across 6 teams.",
          "Reduced API latency by 40% through query optimization.",
        ],
      },
    ],
    education: [
      {
        id: "ed1",
        institution: "MIT",
        degree: "B.S.",
        field: "Computer Science",
        startDate: "2014-09",
        endDate: "2018-05",
      },
    ],
    skills: [
      { id: "s1", name: "React", category: "Frontend" },
      { id: "s2", name: "TypeScript", category: "Languages" },
      { id: "s3", name: "Next.js", category: "Frontend" },
      { id: "s4", name: "Node.js", category: "Backend" },
      { id: "s5", name: "GraphQL", category: "API" },
    ],
    projects: [],
    certifications: [],
    languages: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeJD(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    id: "jd_test",
    title: "Senior Frontend Engineer",
    company: "Stripe",
    keywords: ["React", "TypeScript", "Next.js", "GraphQL", "accessibility", "performance", "Playwright", "Storybook"],
    responsibilities: [],
    requiredSkills: [],
    preferredSkills: [],
    technologies: [],
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("scoreATS", () => {
  it("returns a report with all 6 score axes", () => {
    const report = scoreATS(makeResume());
    expect(report.scores).toBeDefined();
    expect(report.scores.ats).toBeGreaterThan(0);
    expect(report.scores.ats).toBeLessThanOrEqual(100);
    expect(report.scores.formatting).toBeGreaterThanOrEqual(0);
    expect(report.scores.keywords).toBeGreaterThanOrEqual(0);
    expect(report.scores.content).toBeGreaterThanOrEqual(0);
    expect(report.scores.grammar).toBeGreaterThanOrEqual(0);
    expect(report.scores.completeness).toBeGreaterThanOrEqual(0);
  });

  it("produces recommendations", () => {
    const report = scoreATS(makeResume());
    expect(Array.isArray(report.recommendations)).toBe(true);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it("detects missing keywords when compared to a JD", () => {
    const report = scoreATS(makeResume(), makeJD());
    // The JD has 8 keywords; resume matches React, TypeScript, Next.js, GraphQL (4)
    // Missing: accessibility, performance, Playwright, Storybook
    expect(report.missingKeywords).toContain("Playwright");
    expect(report.missingKeywords).toContain("Storybook");
    expect(report.matchedKeywords).toContain("React");
    expect(report.matchedKeywords).toContain("TypeScript");
    expect(report.jdMatchPercent).toBe(50); // 4/8
  });

  it("flags weak bullets starting with 'responsible for'", () => {
    const resume = makeResume({
      experience: [{
        id: "e1",
        title: "Engineer",
        company: "Acme",
        startDate: "2022-01",
        endDate: "Present",
        bullets: ["Responsible for maintaining the codebase.", "Helped with bug fixes."],
      }],
    });
    const report = scoreATS(resume);
    const weakRec = report.recommendations.find((r) => r.title.includes("weak bullet"));
    expect(weakRec).toBeDefined();
    expect(weakRec!.severity).toBe("warning");
  });

  it("rewards quantified bullets", () => {
    const quantified = makeResume({
      experience: [{
        id: "e1", title: "Engineer", company: "Acme", startDate: "2022-01", endDate: "Present",
        bullets: ["Increased revenue by 32%.", "Reduced latency from 500ms to 120ms.", "Saved $50K annually."],
      }],
    });
    const vague = makeResume({
      experience: [{
        id: "e1", title: "Engineer", company: "Acme", startDate: "2022-01", endDate: "Present",
        bullets: ["Worked on various features.", "Participated in meetings.", "Helped the team."],
      }],
    });
    const quantReport = scoreATS(quantified);
    const vagueReport = scoreATS(vague);
    expect(quantReport.scores.content).toBeGreaterThan(vagueReport.scores.content);
  });

  it("penalizes parentheses in phone numbers", () => {
    const resume = makeResume({
      contact: { email: "test@example.com", phone: "(415) 555-0100", location: "SF" },
    });
    const report = scoreATS(resume);
    const phoneRec = report.recommendations.find((r) => r.title.toLowerCase().includes("phone"));
    expect(phoneRec).toBeDefined();
  });

  it("flags missing LinkedIn", () => {
    const resume = makeResume({
      contact: { email: "test@example.com", phone: "+1-555-0100", location: "SF" },
    });
    const report = scoreATS(resume);
    const linkedinRec = report.recommendations.find((r) => r.title.toLowerCase().includes("linkedin"));
    expect(linkedinRec).toBeDefined();
  });

  it("produces a critical recommendation for empty experience", () => {
    const resume = makeResume({ experience: [] });
    const report = scoreATS(resume);
    const expRec = report.recommendations.find((r) => r.title.includes("No experience"));
    expect(expRec).toBeDefined();
    expect(expRec!.severity).toBe("critical");
  });
});

describe("scoreLabel", () => {
  it("returns 'Excellent' for scores >= 85", () => {
    expect(scoreLabel(85).label).toBe("Excellent");
    expect(scoreLabel(100).label).toBe("Excellent");
  });
  it("returns 'Good' for scores 70-84", () => {
    expect(scoreLabel(70).label).toBe("Good");
    expect(scoreLabel(84).label).toBe("Good");
  });
  it("returns 'Needs Work' for scores 50-69", () => {
    expect(scoreLabel(50).label).toBe("Needs Work");
    expect(scoreLabel(69).label).toBe("Needs Work");
  });
  it("returns 'Critical' for scores < 50", () => {
    expect(scoreLabel(49).label).toBe("Critical");
    expect(scoreLabel(0).label).toBe("Critical");
  });
});
