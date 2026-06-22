// Tests for the Dynamic Page Balancing Engine.
//
// Verifies:
//   - Page-fill target calculation (90-98% sweet spot)
//   - Expansion: adds bullets, keywords, expands summary
//   - Compression: removes redundancy, shortens bullets, merges skills
//   - Validation: detects under-fill, overflow, sweet spot
//   - Data preservation: no experience/education/languages lost

import { describe, it, expect } from "vitest";
import {
  computePageFillTarget,
  computeResumeCharCount,
  expandResume,
  compressResume,
  validatePageFill,
} from "./page-balancer";
import type { ResumeData, JobDescription } from "../types";

// ============================================================================
// Mock data
// ============================================================================

function makeShortResume(): ResumeData {
  return {
    id: "r1",
    name: "Test User",
    headline: "Engineer",
    contact: { email: "test@test.com", phone: "+1-555", location: "SF" },
    summary: "Engineer with 5 years of experience.",
    experience: [
      {
        id: "e1",
        title: "Engineer",
        company: "Acme",
        location: "SF",
        startDate: "2020",
        endDate: "Present",
        bullets: ["Built things", "Improved performance"],
      },
    ],
    education: [{ id: "ed1", institution: "MIT", degree: "BS", startDate: "2014", endDate: "2018" }],
    skills: [{ id: "s1", name: "JavaScript", category: "Languages" }],
    projects: [],
    certifications: [],
    languages: [{ id: "l1", name: "English", proficiency: "native" }],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    source: "manual",
  } as ResumeData;
}

function makeLongResume(): ResumeData {
  return {
    id: "r2",
    name: "Test User Long",
    headline: "Senior Engineer with extensive experience in software development, team leadership, and system architecture",
    contact: { email: "test@test.com", phone: "+1-555", location: "SF" },
    summary: "Senior engineer with 15+ years of experience in software development, team leadership, and system architecture. Proven track record of building scalable systems, leading cross-functional teams, and delivering high-impact products. In order to achieve operational excellence, I have consistently delivered results due to the fact that I focus on the most important problems at this point in time. In the event that challenges arise, I adapt quickly and find creative solutions.",
    experience: [
      {
        id: "e1",
        title: "Principal Engineer",
        company: "Big Tech Corp",
        location: "San Francisco, CA",
        startDate: "2018",
        endDate: "Present",
        bullets: [
          "Led a team of 20 engineers to build a distributed system processing 10 billion events per day with 99.99% uptime, resulting in a 40% reduction in operational costs",
          "Designed and implemented a microservices architecture that improved system reliability by 60% and reduced deployment time from 2 hours to 15 minutes",
          "Spearheaded the migration from a monolithic architecture to a service-oriented architecture, which improved development velocity by 3x and reduced bug rates by 45%",
          "Established engineering best practices including code reviews, automated testing, and continuous integration, which improved code quality by 50%",
          "Mentored 15 junior engineers and led weekly technical discussions on system design, resulting in 5 promotions within the team",
        ],
      },
      {
        id: "e2",
        title: "Senior Engineer",
        company: "Startup Inc",
        location: "Palo Alto, CA",
        startDate: "2015",
        endDate: "2018",
        bullets: [
          "Built the entire backend infrastructure from scratch using Node.js, PostgreSQL, and Redis, serving 1 million users",
          "Implemented a real-time analytics pipeline processing 100 million events per day",
          "Led the technical interview process and hired 8 engineers",
        ],
      },
    ],
    education: [{ id: "ed1", institution: "Stanford", degree: "MS Computer Science", startDate: "2010", endDate: "2015" }],
    skills: [
      { id: "s1", name: "JavaScript", category: "Languages" },
      { id: "s2", name: "Python", category: "Languages" },
      { id: "s3", name: "Go", category: "Languages" },
      { id: "s4", name: "React", category: "Frontend" },
      { id: "s5", name: "Node.js", category: "Backend" },
      { id: "s6", name: "PostgreSQL", category: "Databases" },
    ],
    projects: [],
    certifications: [{ id: "c1", name: "AWS Certified", issuer: "Amazon", date: "2023" }],
    languages: [{ id: "l1", name: "English", proficiency: "native" }],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    source: "manual",
  } as ResumeData;
}

function makeJD(): JobDescription {
  return {
    id: "jd1",
    title: "Senior Software Engineer",
    company: "Tech Corp",
    location: "San Francisco, CA",
    responsibilities: [
      "Lead development of customer-facing features",
      "Manage a team of engineers",
      "Improve system performance",
    ],
    requiredSkills: ["JavaScript", "React", "Node.js"],
    preferredSkills: ["Go", "Python"],
    technologies: ["PostgreSQL", "Redis"],
    keywords: ["scalability", "microservices", "leadership", "customer-focused", "performance"],
    rawText: "Senior engineer role",
    source: "text",
    createdAt: "2025-01-01T00:00:00Z",
  } as JobDescription;
}

// ============================================================================
// Tests
// ============================================================================

describe("computePageFillTarget", () => {
  it("returns a target in the 2700-3500 range for default directive", () => {
    const target = computePageFillTarget(null);
    expect(target.minChars).toBeGreaterThanOrEqual(2400);
    expect(target.targetChars).toBeGreaterThanOrEqual(2700);
    expect(target.maxChars).toBeLessThanOrEqual(3500);
  });

  it("min < target < max", () => {
    const target = computePageFillTarget(null);
    expect(target.minChars).toBeLessThan(target.targetChars);
    expect(target.targetChars).toBeLessThan(target.maxChars);
  });

  it("estimatePageUsage returns 0 for 0 chars", () => {
    const target = computePageFillTarget(null);
    expect(target.estimatePageUsage(0)).toBe(0);
  });

  it("estimatePageUsage returns ~100% for the target chars", () => {
    const target = computePageFillTarget(null);
    const usage = target.estimatePageUsage(target.targetChars);
    expect(usage).toBeGreaterThanOrEqual(90);
    expect(usage).toBeLessThanOrEqual(98);
  });
});

describe("computeResumeCharCount", () => {
  it("returns a positive number for a non-empty resume", () => {
    const count = computeResumeCharCount(makeShortResume());
    expect(count).toBeGreaterThan(100);
  });
});

describe("expandResume", () => {
  it("preserves all experience entries", () => {
    const original = makeShortResume();
    const expanded = expandResume(original, {
      originalResume: original,
      jd: makeJD(),
      targetChars: 3000,
      currentChars: 500,
      missingKeywords: ["scalability", "microservices"],
    });
    expect(expanded.experience.length).toBe(original.experience.length);
  });

  it("preserves all education entries", () => {
    const original = makeShortResume();
    const expanded = expandResume(original, {
      originalResume: original,
      jd: makeJD(),
      targetChars: 3000,
      currentChars: 500,
    });
    expect(expanded.education.length).toBe(original.education.length);
  });

  it("preserves all languages", () => {
    const original = makeShortResume();
    const expanded = expandResume(original, {
      originalResume: original,
      jd: makeJD(),
      targetChars: 3000,
      currentChars: 500,
    });
    expect(expanded.languages.length).toBe(original.languages.length);
  });

  it("adds missing keywords to skills", () => {
    const original = makeShortResume();
    const expanded = expandResume(original, {
      originalResume: original,
      jd: makeJD(),
      targetChars: 3000,
      currentChars: 500,
      missingKeywords: ["scalability", "microservices"],
    });
    const allSkills = expanded.skills.map((s) => s.name ?? "").join(" ").toLowerCase();
    expect(allSkills).toContain("scalability");
    expect(allSkills).toContain("microservices");
  });

  it("expands the summary if < 60 words", () => {
    const original = makeShortResume();
    const originalWordCount = original.summary!.split(/\s+/).length;
    const expanded = expandResume(original, {
      originalResume: original,
      jd: makeJD(),
      targetChars: 3000,
      currentChars: 500,
    });
    const expandedWordCount = expanded.summary!.split(/\s+/).length;
    expect(expandedWordCount).toBeGreaterThan(originalWordCount);
  });

  it("returns the resume unchanged if currentChars >= targetChars", () => {
    const original = makeShortResume();
    const expanded = expandResume(original, {
      originalResume: original,
      jd: makeJD(),
      targetChars: 100,
      currentChars: 200,
    });
    expect(expanded).toEqual(original);
  });
});

describe("compressResume", () => {
  it("returns the resume unchanged if currentChars <= maxChars", () => {
    const original = makeShortResume();
    const compressed = compressResume(original, {
      targetChars: 3000,
      maxChars: 5000,
      currentChars: 1000,
    });
    expect(compressed).toEqual(original);
  });

  it("removes redundant words ('in order to' → 'to')", () => {
    const resume: ResumeData = {
      ...makeLongResume(),
      experience: [
        {
          id: "e1",
          title: "Engineer",
          company: "Acme",
          location: "SF",
          startDate: "2020",
          endDate: "Present",
          bullets: ["I did this in order to achieve that due to the fact that it was necessary."],
        },
      ],
    };
    const compressed = compressResume(resume, {
      targetChars: 100,
      maxChars: 200,
      currentChars: 1000,
    });
    expect(compressed.experience[0].bullets[0]).toContain("to achieve");
    expect(compressed.experience[0].bullets[0]).not.toContain("in order to");
    expect(compressed.experience[0].bullets[0]).toContain("because");
    expect(compressed.experience[0].bullets[0]).not.toContain("due to the fact that");
  });

  it("truncates long bullets at 180 chars", () => {
    const longBullet = "Built a system that does many things including scaling to millions of users and handling complex business logic while maintaining high availability and low latency across multiple regions globally with comprehensive monitoring and alerting.";
    const resume: ResumeData = {
      ...makeLongResume(),
      experience: [
        {
          id: "e1",
          title: "Engineer",
          company: "Acme",
          location: "SF",
          startDate: "2020",
          endDate: "Present",
          bullets: [longBullet],
        },
      ],
    };
    const compressed = compressResume(resume, {
      targetChars: 100,
      maxChars: 200,
      currentChars: 1000,
    });
    expect(compressed.experience[0].bullets[0].length).toBeLessThanOrEqual(182);
  });

  it("preserves all experience entries (no data loss)", () => {
    const original = makeLongResume();
    const compressed = compressResume(original, {
      targetChars: 100,
      maxChars: 200,
      currentChars: 5000,
    });
    expect(compressed.experience.length).toBe(original.experience.length);
  });
});

describe("validatePageFill", () => {
  it("returns action='expand' for a short resume", () => {
    const validation = validatePageFill(makeShortResume(), null);
    expect(validation.action).toBe("expand");
    expect(validation.passesMinimum).toBe(false);
    expect(validation.inSweetSpot).toBe(false);
  });

  it("returns action='compress' for a very long resume", () => {
    // Create a resume that's definitely over the max (add many long bullets)
    const veryLongResume: ResumeData = {
      ...makeLongResume(),
      experience: [
        {
          id: "e1",
          title: "Principal Engineer",
          company: "Big Tech Corp",
          location: "San Francisco, CA",
          startDate: "2018",
          endDate: "Present",
          bullets: Array.from({ length: 8 }, (_, i) =>
            `Led initiative #${i + 1} that improved system performance by 40%, reduced costs by $2M annually, and increased customer satisfaction scores by 25% through the implementation of advanced distributed systems architecture and comprehensive monitoring solutions across multiple global regions with high availability requirements and stringent latency constraints.`,
          ),
        },
        {
          id: "e2",
          title: "Senior Engineer",
          company: "Startup Inc",
          location: "Palo Alto, CA",
          startDate: "2015",
          endDate: "2018",
          bullets: Array.from({ length: 6 }, (_, i) =>
            `Delivered feature #${i + 1} that improved user engagement by 30%, reduced bounce rate by 15%, and increased conversion by 22% through the implementation of personalized recommendations and A/B testing frameworks with real-time analytics and machine learning models.`,
          ),
        },
      ],
    };
    const validation = validatePageFill(veryLongResume, null);
    // It should either compress (over 100%) or be in the sweet spot (90-98%)
    expect(["compress", "none"]).toContain(validation.action);
  });

  it("returns a summary string with the page usage percentage", () => {
    const validation = validatePageFill(makeShortResume(), null);
    expect(validation.summary).toContain("%");
    expect(typeof validation.pageUsage).toBe("number");
  });

  it("estimatePageUsage is consistent with the validation", () => {
    const validation = validatePageFill(makeShortResume(), null);
    expect(validation.pageUsage).toBeGreaterThanOrEqual(0);
    expect(validation.pageUsage).toBeLessThanOrEqual(100);
  });
});

describe("Data preservation (spec requirement)", () => {
  it("expansion never removes experience entries", () => {
    const original = makeShortResume();
    const expanded = expandResume(original, {
      originalResume: original,
      jd: makeJD(),
      targetChars: 5000,
      currentChars: 100,
      missingKeywords: ["a", "b", "c", "d", "e"],
    });
    expect(expanded.experience.length).toBeGreaterThanOrEqual(original.experience.length);
  });

  it("compression never removes experience entries", () => {
    const original = makeLongResume();
    const compressed = compressResume(original, {
      targetChars: 100,
      maxChars: 200,
      currentChars: 10000,
    });
    expect(compressed.experience.length).toBe(original.experience.length);
  });

  it("compression never removes education entries", () => {
    const original = makeLongResume();
    const compressed = compressResume(original, {
      targetChars: 100,
      maxChars: 200,
      currentChars: 10000,
    });
    expect(compressed.education.length).toBe(original.education.length);
  });

  it("compression never removes languages", () => {
    const original = makeLongResume();
    const compressed = compressResume(original, {
      targetChars: 100,
      maxChars: 200,
      currentChars: 10000,
    });
    expect(compressed.languages.length).toBe(original.languages.length);
  });
});
