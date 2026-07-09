// ============================================================================
// star-validator.test.ts
// Unit tests for the Programmatic STAR Validator
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  validateSTAR,
  restoreViolatedEntities,
  APPROVED_ACTIVE_VERBS,
  PASSIVE_VERB_PREFIXES,
  METRIC_PATTERNS,
  type STARValidationResult,
} from "./star-validator";
import type { ResumeData } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResume(bullets: string[], overrides: Partial<ResumeData["experience"][0]> = {}): ResumeData {
  return {
    id: "test-resume",
    name: "Jane Doe",
    headline: "Senior Engineer",
    summary: "Experienced engineer.",
    contact: { email: "jane@example.com", phone: "555-1234" },
    experience: [
      {
        id: "exp-1",
        company: "Acme Corp",
        title: "Engineer",
        startDate: "2020-01",
        endDate: "2023-12",
        location: "London",
        bullets,
        ...overrides,
      },
    ],
    education: [
      {
        id: "edu-1",
        institution: "Oxford University",
        degree: "BSc Computer Science",
        startDate: "2015",
        endDate: "2019",
        location: "Oxford",
      },
    ],
    skills: [{ id: "s1", name: "TypeScript", category: "Languages" }],
    languages: [{ id: "l1", name: "English", proficiency: "native" as any }],
    certifications: [{ id: "cert-1", name: "AWS Solutions Architect" } as any],
    projects: [],
    template: "infohas-pro",
    accentColor: "#0563C1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "upload",
  };
}

// ---------------------------------------------------------------------------
// Active Verb Detection
// ---------------------------------------------------------------------------

describe("STAR Validator — Active Verb", () => {
  it("passes for a recognized active verb", () => {
    const resume = makeResume(["Spearheaded a migration that reduced latency by 40%."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesActiveVerb).toBe(true);
  });

  it("passes for 'Orchestrated' (casing should not matter)", () => {
    const resume = makeResume(["Orchestrated cross-functional teams across 3 regions saving $500K."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesActiveVerb).toBe(true);
  });

  it("fails for an unknown opening word", () => {
    const resume = makeResume(["Masterminded a project reducing costs by 30%."]);
    const result = validateSTAR(resume);
    // "masterminded" is not in the approved list
    expect(result.bulletResults[0].passesActiveVerb).toBe(false);
  });

  it("all approved verbs: spot-check 10 entries", () => {
    const sample = ["spearheaded", "orchestrated", "delivered", "optimized", "analyzed",
                    "managed", "engineered", "generated", "mentored", "coordinated"];
    for (const verb of sample) {
      expect(APPROVED_ACTIVE_VERBS.has(verb)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Passive Verb Guard
// ---------------------------------------------------------------------------

describe("STAR Validator — Passive Verb Guard", () => {
  it("flags 'Responsible for' as passive", () => {
    const resume = makeResume(["Responsible for managing a team of 10 engineers, improving output by 25%."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesNonPassive).toBe(false);
    expect(result.passiveVerbCount).toBe(1);
  });

  it("flags 'Assisted with' as passive", () => {
    const resume = makeResume(["Assisted with the deployment of a new CI/CD pipeline used by 50 developers."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesNonPassive).toBe(false);
  });

  it("flags 'Worked on' as passive", () => {
    const resume = makeResume(["Worked on a system that handled 10,000 requests per day."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesNonPassive).toBe(false);
  });

  it("does NOT flag a bullet starting with a good active verb", () => {
    const resume = makeResume(["Reduced TTFB by 35% by implementing CDN edge caching."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesNonPassive).toBe(true);
  });

  it("passive verb prefix list is non-empty", () => {
    expect(PASSIVE_VERB_PREFIXES.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// Metric Detection
// ---------------------------------------------------------------------------

describe("STAR Validator — Metric Detection", () => {
  const metricCases: [string, string][] = [
    ["percentage", "Reduced server costs by 42% over 6 months."],
    ["dollar amount", "Generated $1.2M in new ARR within Q3."],
    ["user count", "Onboarded 500+ enterprise customers to the new platform."],
    ["time saving", "Cut release cycle from 14 days to 3 days using automated testing."],
    ["multiplier", "Improved processing speed by 5x through query optimization."],
    ["ratio", "Achieved 9/10 customer satisfaction score across all accounts."],
    ["team scale", "Managed a team of 12 engineers across 3 product lines."],
    ["top %", "Ranked in the top 1% of performers company-wide for FY2023."],
  ];

  for (const [label, bullet] of metricCases) {
    it(`detects metric: ${label}`, () => {
      const resume = makeResume([`Spearheaded initiative. ${bullet}`]);
      const result = validateSTAR(resume);
      expect(result.bulletResults[0].passesMetric).toBe(true);
    });
  }

  it("fails when no metric is present", () => {
    const resume = makeResume(["Improved the deployment process for the engineering team."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesMetric).toBe(false);
  });

  it("metric patterns array is non-empty", () => {
    expect(METRIC_PATTERNS.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Full STAR pass / fail
// ---------------------------------------------------------------------------

describe("STAR Validator — Full STAR check", () => {
  it("passes a perfect STAR bullet", () => {
    const resume = makeResume([
      "Optimized database query performance by 60%, reducing average response time from 800ms to 320ms.",
    ]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passes).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("fails a bullet missing the metric", () => {
    const resume = makeResume(["Delivered a new CI/CD pipeline to the engineering team."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesMetric).toBe(false);
    expect(result.bulletResults[0].passes).toBe(false);
  });

  it("fails a bullet with passive opening AND no metric", () => {
    const resume = makeResume(["Responsible for managing the team projects."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesNonPassive).toBe(false);
    expect(result.bulletResults[0].passesMetric).toBe(false);
    expect(result.bulletResults[0].passes).toBe(false);
  });

  it("scores 100 when all bullets pass and no entity violations", () => {
    const resume = makeResume([
      "Spearheaded cloud migration saving $500K annually.",
      "Reduced deployment time by 70% by implementing GitHub Actions CI/CD.",
    ]);
    const result = validateSTAR(resume);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("score degrades proportionally with failing bullets", () => {
    const resume = makeResume([
      "Optimized database queries reducing latency by 40%.",         // PASS
      "Responsible for managing sprints for the agile team.",        // FAIL
    ]);
    const result = validateSTAR(resume);
    expect(result.score).toBeLessThan(100);
    expect(result.passed).toBe(false);
    expect(result.passingBullets).toBe(1);
    expect(result.totalBullets).toBe(2);
  });

  it("hint is provided for failing bullets", () => {
    const resume = makeResume(["Responsible for product strategy."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].hint).toBeTruthy();
    expect(result.bulletResults[0].hint.length).toBeGreaterThan(10);
  });

  it("errors array is populated for failing bullets", () => {
    const resume = makeResume(["Worked on improving user engagement."]);
    const result = validateSTAR(resume);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("exp-1");
  });
});

// ---------------------------------------------------------------------------
// Entity Protection
// ---------------------------------------------------------------------------

describe("STAR Validator — Entity Protection", () => {
  it("flags changed employer name", () => {
    const original = makeResume([]);
    const optimized = makeResume([], { company: "ACME Corporation" }); // changed casing/expansion
    const result = validateSTAR(optimized, original);
    expect(result.entityViolationCount).toBe(1);
    expect(result.entityViolations[0].field).toBe("employer");
    expect(result.entityViolations[0].originalValue).toBe("Acme Corp");
  });

  it("flags changed job title", () => {
    const original = makeResume([]);
    const optimized = makeResume([], { title: "Senior Software Engineer" }); // inflated title
    const result = validateSTAR(optimized, original);
    const titleViolation = result.entityViolations.find((v) => v.field === "jobTitle");
    expect(titleViolation).toBeDefined();
    expect(titleViolation?.originalValue).toBe("Engineer");
  });

  it("flags changed start date", () => {
    const original = makeResume([]);
    const optimized = makeResume([], { startDate: "2019-06" }); // hallucinated earlier start
    const result = validateSTAR(optimized, original);
    const dateViolation = result.entityViolations.find((v) => v.field === "startDate");
    expect(dateViolation).toBeDefined();
  });

  it("does NOT flag when employer name is identical", () => {
    const original = makeResume([]);
    const optimized = makeResume([], { company: "Acme Corp" });
    const result = validateSTAR(optimized, original);
    const employerViolation = result.entityViolations.find((v) => v.field === "employer");
    expect(employerViolation).toBeUndefined();
  });

  it("flags changed institution name", () => {
    const original = makeResume([]);
    const optimized: ResumeData = JSON.parse(JSON.stringify(original));
    optimized.education[0].institution = "University of Oxford"; // changed
    const result = validateSTAR(optimized, original);
    const instViolation = result.entityViolations.find((v) => v.field === "institution");
    expect(instViolation).toBeDefined();
    expect(instViolation?.originalValue).toBe("Oxford University");
  });

  it("flags changed certification name", () => {
    const original = makeResume([]);
    const optimized: ResumeData = JSON.parse(JSON.stringify(original));
    optimized.certifications[0].name = "AWS Certified Solutions Architect"; // expanded
    const result = validateSTAR(optimized, original);
    const certViolation = result.entityViolations.find((v) => v.field === "certification");
    expect(certViolation).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Auto-correction: restoreViolatedEntities
// ---------------------------------------------------------------------------

describe("restoreViolatedEntities", () => {
  it("restores violated employer name", () => {
    const original = makeResume([]);
    const optimized = makeResume([], { company: "ACME Corporation" });
    const { entityViolations } = validateSTAR(optimized, original);
    const fixed = restoreViolatedEntities(optimized, original, entityViolations);
    expect(fixed.experience[0].company).toBe("Acme Corp");
  });

  it("restores violated job title", () => {
    const original = makeResume([]);
    const optimized = makeResume([], { title: "Principal Engineer" });
    const { entityViolations } = validateSTAR(optimized, original);
    const fixed = restoreViolatedEntities(optimized, original, entityViolations);
    expect(fixed.experience[0].title).toBe("Engineer");
  });

  it("does not mutate the optimized resume object", () => {
    const original = makeResume([]);
    const optimized = makeResume([], { company: "ACME Corporation" });
    const { entityViolations } = validateSTAR(optimized, original);
    restoreViolatedEntities(optimized, original, entityViolations);
    // The original `optimized` object should be unchanged
    expect(optimized.experience[0].company).toBe("ACME Corporation");
  });

  it("restores institution and degree", () => {
    const original = makeResume([]);
    const optimized: ResumeData = JSON.parse(JSON.stringify(original));
    optimized.education[0].institution = "University of Oxford";
    optimized.education[0].degree = "Bachelor of Science in Computer Science";
    const { entityViolations } = validateSTAR(optimized, original);
    const fixed = restoreViolatedEntities(optimized, original, entityViolations);
    expect(fixed.education[0].institution).toBe("Oxford University");
    expect(fixed.education[0].degree).toBe("BSc Computer Science");
  });

  it("returns the same resume when there are no violations", () => {
    const original = makeResume([]);
    const optimized = makeResume([]);
    const result = validateSTAR(optimized, original);
    const fixed = restoreViolatedEntities(optimized, original, result.entityViolations);
    expect(fixed).toBe(optimized); // same reference — no copy needed
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("STAR Validator — Edge cases", () => {
  it("handles a resume with no experience bullets gracefully", () => {
    const resume = makeResume([]);
    const result = validateSTAR(resume);
    expect(result.totalBullets).toBe(0);
    expect(result.passed).toBe(true); // vacuously true
    expect(result.score).toBe(80); // no bullet score + 20 entity bonus
  });

  it("handles bullet with leading bullet-point character", () => {
    const resume = makeResume(["• Optimized API throughput by 50% using Redis caching."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesActiveVerb).toBe(true);
  });

  it("handles bullet with dash prefix", () => {
    const resume = makeResume(["- Reduced operational costs by $200K annually."]);
    const result = validateSTAR(resume);
    expect(result.bulletResults[0].passesActiveVerb).toBe(true);
  });

  it("does not run entity checks when original is not provided", () => {
    const resume = makeResume(["Delivered a key project for 50 clients."]);
    const result = validateSTAR(resume);
    expect(result.entityViolationCount).toBe(0);
    expect(result.entityViolations).toHaveLength(0);
  });
});
