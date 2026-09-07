import { describe, it, expect } from "vitest";
import {
  computeATSDashboard,
  sanitizeTerm,
  sanitizeTerms,
  termInText,
  MATCH_WEIGHTS,
  type ATSDashboard,
} from "@/lib/ats-match";
import type { ResumeData, JobDescription } from "@/lib/types";

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
    company: "Globex",
    responsibilities: ["Build web apps", "Mentor engineers"],
    requiredSkills: ["React", "TypeScript", "Kubernetes"],
    preferredSkills: ["GraphQL", "Rust"],
    technologies: ["Next.js", "Docker"],
    experienceYears: "5+ years",
    keywords: ["performance", "accessibility", "go", "basic"],
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function groupOf(d: ATSDashboard, priority: string) {
  return d.groups.find((g) => g.priority === priority);
}

// ─── sanitizeTerm / sanitizeTerms ───────────────────────────────────────────

describe("sanitizeTerm", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeTerm("  project   management ")).toBe("project management");
  });
  it("drops empty and non-string inputs", () => {
    expect(sanitizeTerm("")).toBe("");
    expect(sanitizeTerm("   ")).toBe("");
    expect(sanitizeTerm(42 as any)).toBe("");
    expect(sanitizeTerm(null)).toBe("");
  });
  it("drops meaningless single chars but keeps tech tokens", () => {
    expect(sanitizeTerm("a")).toBe("");
    expect(sanitizeTerm("7")).toBe("");
    expect(sanitizeTerm("R")).toBe("R");
    expect(sanitizeTerm("C#")).toBe("C#");
    expect(sanitizeTerm("C++")).toBe("C++");
  });
});

describe("sanitizeTerms", () => {
  it("dedupes case-insensitively keeping first casing", () => {
    expect(sanitizeTerms(["React", "react", "REACT", "  react "])).toEqual(["React"]);
  });
  it("drops junk entries and preserves order", () => {
    expect(sanitizeTerms([null, "", "Docker", 5, "docker", "K8s"])).toEqual(["Docker", "K8s"]);
  });
  it("returns [] for non-array input", () => {
    expect(sanitizeTerms(undefined)).toEqual([]);
    expect(sanitizeTerms("docker")).toEqual([]);
  });
});

// ─── termInText ─────────────────────────────────────────────────────────────

describe("termInText", () => {
  it("matches multi-word phrases case-insensitively", () => {
    expect(termInText("Project Management", "led project management office")).toBe(true);
  });
  it("uses word boundaries for short tokens", () => {
    expect(termInText("R", "a senior developer")).toBe(false);
    expect(termInText("R", "proficient in R and python")).toBe(true);
    expect(termInText("Go", "good at go language")).toBe(true);
    expect(termInText("Go", "good food")).toBe(false);
  });
  it("matches tech tokens with special characters", () => {
    expect(termInText("C++", "skills: c++, rust")).toBe(true);
    expect(termInText("C#", "knows c# well")).toBe(true);
  });
  it("returns false for empty term", () => {
    expect(termInText("", "anything")).toBe(false);
  });
});

// ─── computeATSDashboard ────────────────────────────────────────────────────

describe("computeATSDashboard — group construction", () => {
  it("builds four priority groups from structured JD fields", () => {
    const d = computeATSDashboard(makeResume(), makeJD());
    expect(groupOf(d, "required")!.label).toBe("Must-have skills");
    expect(groupOf(d, "technology")!.label).toBe("Core technologies");
    expect(groupOf(d, "preferred")!.label).toBe("Nice-to-have");
    expect(groupOf(d, "keyword")!.label).toBe("Other JD keywords");
  });

  it("filters junk tokens only from the keywords group", () => {
    const d = computeATSDashboard(makeResume(), makeJD());
    const kwTerms = groupOf(d, "keyword")!.terms.map((t) => t.term.toLowerCase());
    expect(kwTerms).not.toContain("go");
    expect(kwTerms).not.toContain("basic");
    expect(kwTerms).toContain("performance");
  });

  it("dedupes a term across groups with required winning over keyword", () => {
    const jd = makeJD({
      requiredSkills: ["React"],
      technologies: [],
      preferredSkills: [],
      keywords: ["react", "typescript"],
    });
    const d = computeATSDashboard(makeResume(), jd);
    const all = d.groups.flatMap((g) => g.terms.map((t) => t.term.toLowerCase()));
    expect(all.filter((t) => t === "react").length).toBe(1);
    const req = groupOf(d, "required")!;
    expect(req.terms.map((t) => t.term)).toEqual(["React"]);
  });

  it("falls back to a single keywords group when JD has no structured fields", () => {
    const jd = makeJD({
      requiredSkills: [] as any,
      preferredSkills: [] as any,
      technologies: [] as any,
      keywords: ["react", "docker"],
    });
    const d = computeATSDashboard(makeResume(), jd);
    expect(d.groups.length).toBe(1);
    expect(d.groups[0].priority).toBe("keyword");
    expect(d.totalTerms).toBe(2);
  });
});

describe("computeATSDashboard — matching", () => {
  it("matches terms case-insensitively against skills and bullets", () => {
    const d = computeATSDashboard(makeResume(), makeJD());
    const req = groupOf(d, "required")!;
    const react = req.terms.find((t) => t.term === "React")!;
    const k8s = req.terms.find((t) => t.term === "Kubernetes")!;
    expect(react.matched).toBe(true);
    expect(k8s.matched).toBe(false);
  });

  it("attributes sections correctly (summary, experience, skills, projects, education)", () => {
    const resume = makeResume({
      summary: "AWS certified engineer passionate about accessibility.",
      projects: [
        {
          id: "p1",
          name: "Perf Dashboard",
          description: "Real-time performance monitoring",
          bullets: ["Cut page load by 3x"],
          technologies: [],
        } as any,
      ],
    });
    const jd = makeJD({
      requiredSkills: ["accessibility"],
      technologies: [],
      preferredSkills: [],
      keywords: ["performance", "computer science"],
    });
    const d = computeATSDashboard(resume, jd);
    expect(d.matched.find((t) => t.term === "accessibility")!.sections).toEqual(["summary"]);
    expect(d.matched.find((t) => t.term === "performance")!.sections).toEqual(["projects"]);
    expect(d.matched.find((t) => t.term === "computer science")!.sections).toEqual(["education"]);
  });

  it("counts achievements as experience and languages as skills", () => {
    const resume = makeResume({
      achievements: ["Reached Rust mastery in systems rewrite"],
      languages: ["French", "Arabic"] as any,
    });
    const jd = makeJD({
      requiredSkills: ["Rust"],
      technologies: [],
      preferredSkills: ["French"],
      keywords: [],
    });
    const d = computeATSDashboard(resume, jd);
    expect(d.matched.find((t) => t.term === "Rust")!.sections).toContain("experience");
    expect(d.matched.find((t) => t.term === "French")!.sections).toContain("skills");
  });

  it("treats whitespace-collapsed JD terms as equivalent", () => {
    const jd = makeJD({ requiredSkills: ["project   management"], keywords: [] });
    const resume = makeResume({
      experience: [
        {
          id: "e9",
          title: "PM",
          company: "Acme",
          location: "",
          startDate: "2020-01",
          endDate: "2021-01",
          bullets: ["ran project management office"],
        },
      ],
    });
    const d = computeATSDashboard(resume, jd);
    expect(groupOf(d, "required")!.terms[0].matched).toBe(true);
  });
});

describe("computeATSDashboard — scoring math", () => {
  it("computes weighted overall with all groups present", () => {
    // required 1/2 = 50, technology 1/1 = 100, preferred 0/1 = 0, keyword 1/1 = 100
    // ("typescript" as keyword avoids dedupe collision with the technology group)
    const resume = makeResume(); // has React (skill), Next.js (skill+bullet)
    const jd = makeJD({
      requiredSkills: ["React", "Kubernetes"],
      technologies: ["Next.js"],
      preferredSkills: ["Rust"],
      keywords: ["typescript"],
    });
    const d = computeATSDashboard(resume, jd);
    // "next.js" keyword: junk filter keeps it; matched via skills.
    const expected = Math.round(
      (MATCH_WEIGHTS.required * 50 +
        MATCH_WEIGHTS.technology * 100 +
        MATCH_WEIGHTS.preferred * 0 +
        MATCH_WEIGHTS.keyword * 100) /
        1,
    );
    expect(d.overall).toBe(expected); // 63
  });

  it("renormalizes weights over groups that have terms", () => {
    const resume = makeResume();
    const jd = makeJD({
      requiredSkills: ["React"],
      technologies: [],
      preferredSkills: [],
      keywords: [],
    });
    const d = computeATSDashboard(resume, jd);
    expect(d.overall).toBe(100);
    const jd2 = makeJD({
      requiredSkills: ["Kubernetes"],
      technologies: [],
      preferredSkills: [],
      keywords: [],
    });
    expect(computeATSDashboard(resume, jd2).overall).toBe(0);
  });

  it("returns overall 0 with no groups for an empty JD", () => {
    const jd = makeJD({
      requiredSkills: [] as any,
      technologies: [] as any,
      preferredSkills: [] as any,
      keywords: [],
    });
    const d = computeATSDashboard(makeResume(), jd);
    expect(d.groups).toEqual([]);
    expect(d.totalTerms).toBe(0);
    expect(d.overall).toBe(0);
    expect(d.missing).toEqual([]);
  });
});

describe("computeATSDashboard — gaps & coverage", () => {
  it("orders missing terms by priority and limits mustHaveMissing to required+technology", () => {
    const jd = makeJD(); // required missing: Kubernetes; tech missing: Docker; preferred missing: GraphQL, Rust; kw missing: performance, accessibility
    const d = computeATSDashboard(makeResume(), makeJD());
    const priorities = d.missing.map((t) => {
      const g = d.groups.find((grp) => grp.terms.includes(t))!;
      return g.priority;
    });
    const order = ["required", "technology", "preferred", "keyword"];
    const indices = priorities.map((p) => order.indexOf(p));
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    expect(d.mustHaveMissing).toContain("Kubernetes");
    expect(d.mustHaveMissing).toContain("Docker");
    expect(d.mustHaveMissing).not.toContain("Rust");
    expect(d.mustHaveMissing).not.toContain("performance");
  });

  it("computes per-section coverage against total JD terms", () => {
    const jd = makeJD({
      requiredSkills: ["React"],
      technologies: [],
      preferredSkills: [],
      keywords: [],
    });
    const d = computeATSDashboard(makeResume(), jd);
    const skills = d.sectionCoverage.find((s) => s.section === "skills")!;
    expect(skills.hits).toBe(1);
    expect(skills.total).toBe(1);
    expect(skills.percent).toBe(100);
    const certs = d.sectionCoverage.find((s) => s.section === "certifications")!;
    expect(certs.percent).toBe(0);
  });

  it("is defensive against partially-empty resume objects", () => {
    const bare = { id: "r0", name: "", contact: {} } as unknown as ResumeData;
    const jd = makeJD();
    expect(() => computeATSDashboard(bare, jd)).not.toThrow();
    const d = computeATSDashboard(bare, jd);
    expect(d.matched.length).toBe(0);
    expect(d.totalTerms).toBeGreaterThan(0);
  });
});
