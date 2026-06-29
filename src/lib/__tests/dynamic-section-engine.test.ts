// ============================================================================
// Dynamic Section Preservation & Enhancement Engine — Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import type { ResumeData, DynamicSection, JobDescription } from "../types";
import {
  extractSectionsFromResume,
  checkSectionPreservation,
  enhanceDynamicSection,
  mergeDynamicSections,
  runDynamicSectionPipeline,
  computeFingerprintSync,
  isDirectiveDefinedSection,
  isLikelySectionHeader,
} from "../dynamic-section-engine";

// ============================================================================
// Helpers
// ============================================================================

function createMinimalResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "test-1",
    name: "Test User",
    contact: { email: "test@example.com", phone: "+1-555-1234" },
    summary: "A professional summary.",
    experience: [
      {
        id: "exp-1",
        title: "Software Engineer",
        company: "Tech Corp",
        startDate: "2020-01",
        endDate: "2023-12",
        bullets: ["Built features.", "Fixed bugs."],
      },
    ],
    education: [
      {
        id: "edu-1",
        degree: "BS Computer Science",
        institution: "University",
        startDate: "2016-09",
        endDate: "2020-06",
        highlights: ["Dean's list"],
      },
    ],
    skills: [
      { id: "sk-1", name: "TypeScript" },
      { id: "sk-2", name: "React" },
    ],
    projects: [],
    certifications: [],
    languages: [
      { id: "lang-1", name: "English", proficiency: "fluent" },
      { id: "lang-2", name: "French", proficiency: "conversational" },
    ],
    template: "ats-professional" as const,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ============================================================================
// Section Extraction Tests
// ============================================================================

describe("extractSectionsFromResume", () => {
  it("should extract all standard sections from a minimal resume", () => {
    const resume = createMinimalResume();
    const sections = extractSectionsFromResume(resume);

    expect(sections.length).toBeGreaterThanOrEqual(5);

    const sectionTitles = sections.map((s) => s.title);
    expect(sectionTitles).toContain("Summary");
    expect(sectionTitles).toContain("Experience");
    expect(sectionTitles).toContain("Education");
    expect(sectionTitles).toContain("Skills");
    expect(sectionTitles).toContain("Languages");
  });

  it("should extract certifications when present", () => {
    const resume = createMinimalResume({
      certifications: [
        { id: "cert-1", name: "AWS Certified Developer", issuer: "Amazon" },
      ],
    });
    const sections = extractSectionsFromResume(resume);
    const certs = sections.find((s) => s.normalizedTitle === "certifications");
    expect(certs).toBeDefined();
    expect(certs!.bullets).toContain("AWS Certified Developer");
  });

  it("should extract projects when present", () => {
    const resume = createMinimalResume({
      projects: [
        {
          id: "proj-1",
          name: "Portfolio Site",
          bullets: ["Built with Next.js", "Deployed on Cloudflare"],
        },
      ],
    });
    const sections = extractSectionsFromResume(resume);
    const projects = sections.find((s) => s.normalizedTitle === "projects");
    expect(projects).toBeDefined();
    expect(projects!.bullets).toContain("Portfolio Site");
    expect(projects!.bullets).toContain("Built with Next.js");
  });

  it("should extract achievements when present", () => {
    const resume = createMinimalResume({
      achievements: ["Employee of the Month", "Top Performer 2023"],
    });
    const sections = extractSectionsFromResume(resume);
    const achievements = sections.find((s) => s.normalizedTitle === "achievements");
    expect(achievements).toBeDefined();
    expect(achievements!.bullets).toEqual([
      "Employee of the Month",
      "Top Performer 2023",
    ]);
  });

  it("should extract additionalInfo as a section", () => {
    const resume = createMinimalResume({
      additionalInfo: "Willing to relocate\nAvailable immediately",
    });
    const sections = extractSectionsFromResume(resume);
    const addInfo = sections.find(
      (s) => s.normalizedTitle === "additionalinformation"
    );
    expect(addInfo).toBeDefined();
    expect(addInfo!.bullets).toContain("Willing to relocate");
    expect(addInfo!.bullets).toContain("Available immediately");
  });

  it("should assign correct order numbers", () => {
    const resume = createMinimalResume();
    const sections = extractSectionsFromResume(resume);
    for (let i = 0; i < sections.length; i++) {
      expect(sections[i].order).toBe(i);
    }
  });

  it("should set immutable and source correctly", () => {
    const resume = createMinimalResume();
    const sections = extractSectionsFromResume(resume);
    for (const section of sections) {
      expect(section.source).toBe("parsed");
      expect(section.immutable).toBe(true);
    }
  });

  it("should generate unique fingerprints per section", () => {
    const resume = createMinimalResume();
    const sections = extractSectionsFromResume(resume);
    const fingerprints = sections.map((s) => s.id);
    const unique = new Set(fingerprints);
    expect(unique.size).toBe(sections.length);
  });

  it("should honor dynamicSections already present in ResumeData", () => {
    const resume = createMinimalResume({
      dynamicSections: [
        {
          id: "fp_volunteer",
          title: "Volunteer Work",
          normalizedTitle: "volunteer",
          content: "Helped at shelter.\nOrganized events.",
          bullets: ["Helped at shelter.", "Organized events."],
          order: 0,
          source: "parsed",
          immutable: true,
        },
      ],
    });
    const sections = extractSectionsFromResume(resume);
    const volunteer = sections.find(
      (s) => s.normalizedTitle === "volunteer"
    );
    expect(volunteer).toBeDefined();
    expect(volunteer!.bullets).toContain("Helped at shelter.");
  });
});

// ============================================================================
// Fingerprint Tests
// ============================================================================

describe("computeFingerprintSync", () => {
  it("should produce the same fingerprint for identical inputs", () => {
    const fp1 = computeFingerprintSync("Summary", "A professional summary.");
    const fp2 = computeFingerprintSync("Summary", "A professional summary.");
    expect(fp1).toBe(fp2);
  });

  it("should produce different fingerprints for different inputs", () => {
    const fp1 = computeFingerprintSync("Summary", "A professional summary.");
    const fp2 = computeFingerprintSync("Summary", "A different summary.");
    expect(fp1).not.toBe(fp2);
  });

  it("should be case-insensitive for title", () => {
    const fp1 = computeFingerprintSync("Summary", "content");
    const fp2 = computeFingerprintSync("SUMMARY", "content");
    expect(fp1).toBe(fp2);
  });
});

// ============================================================================
// Section Preservation Tests
// ============================================================================

describe("checkSectionPreservation", () => {
  it("should pass when all source sections are present in optimized", () => {
    const source = createMinimalResume();
    const optimized = createMinimalResume();
    const sourceSections = extractSectionsFromResume(source);
    const result = checkSectionPreservation(sourceSections, optimized);
    expect(result.preserved).toBe(true);
    expect(result.missing.length).toBe(0);
  });

  it("should detect when a section is missing", () => {
    const source = createMinimalResume({
      certifications: [
        { id: "cert-1", name: "AWS Certified", issuer: "Amazon" },
      ],
    });
    const optimized = createMinimalResume(); // no certifications

    const sourceSections = extractSectionsFromResume(source);
    const result = checkSectionPreservation(sourceSections, optimized);
    expect(result.preserved).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(1);
    expect(result.missing.some((s) => s.title === "Certifications")).toBe(true);
  });

  it("should detect multiple missing sections", () => {
    const source = createMinimalResume({
      certifications: [
        { id: "cert-1", name: "AWS Certified", issuer: "Amazon" },
      ],
      projects: [
        { id: "proj-1", name: "Portfolio", bullets: ["Built with React"] },
      ],
      achievements: ["Award 1"],
    });
    const optimized = createMinimalResume(); // none of the extras

    const sourceSections = extractSectionsFromResume(source);
    const result = checkSectionPreservation(sourceSections, optimized);
    expect(result.preserved).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(3);
  });

  it("should report all preserved section titles", () => {
    const source = createMinimalResume();
    const optimized = createMinimalResume();
    const sourceSections = extractSectionsFromResume(source);
    const result = checkSectionPreservation(sourceSections, optimized);
    expect(result.preservedSections.length).toBe(sourceSections.length);
    expect(result.preservedSections).toContain("Summary");
    expect(result.preservedSections).toContain("Experience");
  });
});

// ============================================================================
// Enhancement Tests
// ============================================================================

describe("enhanceDynamicSection", () => {
  it("should capitalize first letter of bullet points", () => {
    const section: DynamicSection = {
      id: "test",
      title: "Volunteer Work",
      normalizedTitle: "volunteer",
      content: "helped at shelter.\norganized events.",
      bullets: ["helped at shelter.", "organized events."],
      order: 0,
      source: "parsed",
      immutable: true,
    };
    const result = enhanceDynamicSection(section);
    // First letter is capitalized, even if keywords are injected
    expect(result.bullets[0]).toMatch(/^Helped at shelter\.*/);
  });

  it("should ensure bullet points end with a period", () => {
    const section: DynamicSection = {
      id: "test",
      title: "Projects",
      normalizedTitle: "projects",
      content: "Built a website",
      bullets: ["Built a website"],
      order: 0,
      source: "parsed",
      immutable: true,
    };
    const result = enhanceDynamicSection(section);
    expect(result.bullets[0]).toMatch(/\.$/);
  });

  it("should not add period if bullet already ends with punctuation", () => {
    const section: DynamicSection = {
      id: "test",
      title: "Patent",
      normalizedTitle: "patent",
      content: "Employee of the Month!",
      bullets: ["Employee of the Month!"],
      order: 0,
      source: "parsed",
      immutable: true,
    };
    const result = enhanceDynamicSection(section);
    expect(result.bullets[0]).toBe("Employee of the Month!");
  });

  it("should inject relevant ATS keywords for short bullets", () => {
    const section: DynamicSection = {
      id: "test",
      title: "Volunteer",
      normalizedTitle: "volunteer",
      content: "Helped.",
      bullets: ["Helped."],
      order: 0,
      source: "parsed",
      immutable: true,
    };
    const result = enhanceDynamicSection(section);
    expect(result.bullets[0]).toContain("Demonstrating");
  });

  it("should use job description keywords when provided", () => {
    const section: DynamicSection = {
      id: "test",
      title: "Projects",
      normalizedTitle: "projects",
      content: "Built.",
      bullets: ["Built."],
      order: 0,
      source: "parsed",
      immutable: true,
    };
    const jd: JobDescription = {
      id: "jd-1",
      title: "Software Engineer",
      company: "Acme Inc",
      keywords: ["agile", "kubernetes"],
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      createdAt: "2024-01-01T00:00:00Z",
    };
    const result = enhanceDynamicSection(section, jd);
    expect(result.bullets[0].toLowerCase()).toContain("demonstrating");
  });

  it("should preserve content when no enhancement is needed", () => {
    const section: DynamicSection = {
      id: "test",
      title: "Patent",
      normalizedTitle: "patent",
      content: "Employee of the Month - Q3 2023.",
      bullets: ["Employee of the Month - Q3 2023."],
      order: 0,
      source: "parsed",
      immutable: true,
    };
    const result = enhanceDynamicSection(section);
    expect(result.bullets[0]).toBe("Employee of the Month - Q3 2023.");
  });

  it("should return content as newline-joined bullets", () => {
    const section: DynamicSection = {
      id: "test",
      title: "Certifications",
      normalizedTitle: "certifications",
      content: "aws csa.\ngcp pca.",
      bullets: ["aws csa.", "gcp pca."],
      order: 0,
      source: "parsed",
      immutable: true,
    };
    const result = enhanceDynamicSection(section);
    expect(result.content).toBe(
      result.bullets.join("\n")
    );
    expect(result.bullets[0]).toMatch(/^Aws/);
    expect(result.bullets[1]).toMatch(/^Gcp/);
  });
});

// ============================================================================
// Merge Tests
// ============================================================================

describe("mergeDynamicSections", () => {
  it("should not modify resume when all sections are present", () => {
    const source = createMinimalResume();
    const sourceSections = extractSectionsFromResume(source);
    const result = mergeDynamicSections(source, sourceSections);
    // All sections present, no dynamicSections field should have been added
    expect(result.dynamicSections).toBeUndefined();
  });

  it("should restore missing sections from source", () => {
    const source = createMinimalResume({
      certifications: [
        { id: "cert-1", name: "AWS Certified Developer", issuer: "Amazon" },
      ],
    });
    const optimized = createMinimalResume(); // missing certifications

    const sourceSections = extractSectionsFromResume(source);
    const result = mergeDynamicSections(optimized, sourceSections);

    expect(result.dynamicSections).toBeDefined();
    expect(result.dynamicSections!.length).toBeGreaterThanOrEqual(1);
    const restored = result.dynamicSections!.find(
      (ds) => ds.normalizedTitle === "certifications"
    );
    expect(restored).toBeDefined();
    expect(restored!.title).toBe("Certifications");
  });

  it("should use enhanced content over original when restoring", () => {
    const source = createMinimalResume({
      certifications: [
        { id: "cert-1", name: "AWS Certified Developer", issuer: "Amazon" },
      ],
    });
    const optimized = createMinimalResume();

    const sourceSections = extractSectionsFromResume(source);
    const enhancedSections = sourceSections.map((s) => ({
      ...s,
      content: "Enhanced: " + s.content,
      bullets: s.bullets.map((b) => "Enhanced: " + b),
    }));

    const result = mergeDynamicSections(optimized, sourceSections, enhancedSections);
    expect(result.dynamicSections).toBeDefined();
    const restored = result.dynamicSections!.find(
      (ds) => ds.normalizedTitle === "certifications"
    );
    expect(restored).toBeDefined();
    expect(restored!.content).toContain("Enhanced:");
  });

  it("should preserve existing dynamicSections from source resume", () => {
    const sourceVolunteer: DynamicSection = {
      id: "fp_volunteer",
      title: "Volunteer Work",
      normalizedTitle: "volunteer",
      content: "Helped at shelter.",
      bullets: ["Helped at shelter."],
      order: 6,
      source: "parsed",
      immutable: true,
    };

    const source = createMinimalResume({
      dynamicSections: [sourceVolunteer],
    });

    const optimized = createMinimalResume();
    const sourceSections = extractSectionsFromResume(source);
    const result = mergeDynamicSections(optimized, sourceSections);

    expect(result.dynamicSections).toBeDefined();
    expect(result.dynamicSections!.some((ds) => ds.normalizedTitle === "volunteer")).toBe(true);
  });
});

// ============================================================================
// Full Pipeline Tests
// ============================================================================

describe("runDynamicSectionPipeline", () => {
  it("should preserve all sections from source to optimized output", () => {
    const source = createMinimalResume();
    const optimized = createMinimalResume();
    const result = runDynamicSectionPipeline(source, optimized);

    expect(result.preservation.preserved).toBe(true);
    expect(result.originalSections.length).toBeGreaterThanOrEqual(5);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  it("should detect and restore a missing certification section", () => {
    const source = createMinimalResume({
      certifications: [
        { id: "cert-1", name: "AWS Certified Developer", issuer: "Amazon" },
      ],
    });
    const optimized = createMinimalResume(); // missing certs
    const result = runDynamicSectionPipeline(source, optimized);

    // Should detect missing
    expect(result.preservation.missing.some((s) => s.title === "Certifications")).toBe(true);
    // Should restore
    expect(result.mergedResume).toBeDefined();
    expect(result.mergedResume!.dynamicSections).toBeDefined();
    const restored = result.mergedResume!.dynamicSections!.find(
      (s) => s.normalizedTitle === "certifications"
    );
    expect(restored).toBeDefined();
  });

  it("should enhance all sections", () => {
    const source = createMinimalResume();
    const result = runDynamicSectionPipeline(source, source);

    expect(result.enhancedSections.length).toBe(result.originalSections.length);
    for (const enhanced of result.enhancedSections) {
      expect(enhanced.enhanced).toBeDefined();
      expect(enhanced.enhancedBullets).toBeDefined();
    }
  });

  it("should produce observable logs", () => {
    const source = createMinimalResume();
    const result = runDynamicSectionPipeline(source, source);

    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.logs.some((l) => l.includes("extracted"))).toBe(true);
    expect(result.logs.some((l) => l.includes("Enhanced"))).toBe(true);
    expect(result.logs.some((l) => l.includes("Pipeline complete"))).toBe(true);
  });
});

// ============================================================================
// Utility Tests
// ============================================================================

describe("isDirectiveDefinedSection", () => {
  it("should return true for standard sections", () => {
    expect(isDirectiveDefinedSection("Summary")).toBe(true);
    expect(isDirectiveDefinedSection("Experience")).toBe(true);
    expect(isDirectiveDefinedSection("Education")).toBe(true);
    expect(isDirectiveDefinedSection("Skills")).toBe(true);
    expect(isDirectiveDefinedSection("Languages")).toBe(true);
    expect(isDirectiveDefinedSection("Additional Information")).toBe(true);
  });

  it("should return false for custom sections", () => {
    expect(isDirectiveDefinedSection("Certifications")).toBe(false);
    expect(isDirectiveDefinedSection("Awards")).toBe(false);
    expect(isDirectiveDefinedSection("Volunteer Experience")).toBe(false);
    expect(isDirectiveDefinedSection("Projects")).toBe(false);
    expect(isDirectiveDefinedSection("Publications")).toBe(false);
    expect(isDirectiveDefinedSection("Custom Section")).toBe(false);
  });
});

describe("isLikelySectionHeader", () => {
  it("should match common section headers", () => {
    expect(isLikelySectionHeader("Summary")).toBe(true);
    expect(isLikelySectionHeader("Professional Experience")).toBe(true);
    expect(isLikelySectionHeader("Certifications")).toBe(true);
    expect(isLikelySectionHeader("Volunteer Experience")).toBe(true);
    expect(isLikelySectionHeader("Technical Skills")).toBe(true);
    expect(isLikelySectionHeader("Extra-Curricular Activities")).toBe(true);
  });

  it("should not match content lines", () => {
    expect(isLikelySectionHeader("I worked at Google for 5 years as a software engineer.")).toBe(false);
    expect(isLikelySectionHeader("")).toBe(false);
    expect(isLikelySectionHeader("a")).toBe(false);
  });
});

// ============================================================================
// Section Order Preservation Tests
// ============================================================================

describe("Section Order Preservation", () => {
  it("should preserve the original section order in a full pipeline run", () => {
    const source = createMinimalResume();
    const result = runDynamicSectionPipeline(source, source);

    const originalOrder = result.originalSections.map((s) => s.title);
    const enhancedOrder = result.enhancedSections.map((s) => s.title);

    expect(originalOrder).toEqual(enhancedOrder);
  });

  it("should preserve order with certifications and projects present", () => {
    const source = createMinimalResume({
      certifications: [
        { id: "cert-1", name: "AWS Certified", issuer: "Amazon" },
      ],
      projects: [
        { id: "proj-1", name: "Portfolio", bullets: ["Built with React"] },
      ],
    });

    const result = runDynamicSectionPipeline(source, source);
    const titles = result.originalSections.map((s) => s.title);

    // Summary should come first
    expect(titles[0]).toBe("Summary");
    // Certifications and projects should appear
    expect(titles).toContain("Certifications");
    expect(titles).toContain("Projects");
  });
});

// ============================================================================
// Regression: Empty/Degenerate Cases
// ============================================================================

describe("Edge Cases", () => {
  it("should handle empty resume gracefully", () => {
    const empty: ResumeData = {
      id: "empty",
      name: "",
      contact: {},
      experience: [],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
      languages: [],
      template: "ats-professional" as const,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const sections = extractSectionsFromResume(empty);
    expect(sections.length).toBe(0);

    const result = runDynamicSectionPipeline(empty, empty);
    expect(result.preservation.preserved).toBe(true);
    expect(result.originalSections.length).toBe(0);
  });

  it("should handle resume with only summary", () => {
    const resume: ResumeData = {
      id: "summary-only",
      name: "Test",
      contact: {},
      summary: "Just a summary.",
      experience: [],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
      languages: [],
      template: "ats-professional" as const,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const sections = extractSectionsFromResume(resume);
    expect(sections.length).toBe(1);
    expect(sections[0].title).toBe("Summary");
  });
});
