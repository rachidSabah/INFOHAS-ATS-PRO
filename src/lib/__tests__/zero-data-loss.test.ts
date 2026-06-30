// ============================================================================
// Zero Data Loss + Sentence Completeness Tests
//
// Validates:
//   - Education is ALWAYS from source (never AI output)
//   - Languages are ALWAYS from source
//   - Experience entries are never dropped
//   - Certifications are never dropped
//   - Projects are never dropped
//   - Truncated sentences are detected and fixed
// ============================================================================

import { describe, it, expect } from "vitest";
import { validateSentenceCompleteness, validateResumeSentenceCompleteness } from "../sentence-validator";
import { finalizeResume } from "../unified-pipeline";
import type { ResumeData } from "../types";

function makeResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "test",
    name: "Test User",
    contact: { email: "test@example.com", phone: "+1234567890", location: "Test City" },
    summary: "Experienced professional with 5 years in software development.",
    experience: [
      { id: "e1", title: "Developer", company: "TechCorp", location: "", startDate: "2020", endDate: "2024", bullets: ["Built systems"] },
    ],
    education: [
      { id: "ed1", degree: "B.S.", institution: "MIT", location: "", startDate: "2016", endDate: "2020", highlights: [] },
      { id: "ed2", degree: "M.S.", institution: "Stanford", location: "", startDate: "2020", endDate: "2022", highlights: [] },
    ],
    skills: [{ id: "s1", name: "JavaScript", category: "Tech" }],
    languages: [
      { id: "l1", name: "English", proficiency: "fluent" },
      { id: "l2", name: "French", proficiency: "native" },
      { id: "l3", name: "Arabic", proficiency: "fluent" },
    ],
    certifications: [{ id: "c1", name: "AWS Certified" }],
    projects: [{ id: "p1", name: "Project A", description: "A project", bullets: [] }],
    template: "infohas-pro",
    accentColor: "#0563C1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "upload",
    ...overrides,
  };
}

// ============================================================================
// 1. EDUCATION PRESERVATION
// ============================================================================

describe("Zero Data Loss — Education", () => {
  it("preserves ALL education entries through finalizeResume", () => {
    const source = makeResume();
    const optimized = finalizeResume({ ...source }, source);
    expect(optimized.education.length).toBe(2);
    expect(optimized.education[0].institution).toBe("MIT");
    expect(optimized.education[1].institution).toBe("Stanford");
  });

  it("restores dropped education entries", () => {
    const source = makeResume();
    const optimized: ResumeData = {
      ...source,
      education: [source.education[0]], // AI dropped 1 entry
    };
    const result = finalizeResume(optimized, source);
    expect(result.education.length).toBe(2); // restored
  });
});

// ============================================================================
// 2. LANGUAGE PRESERVATION
// ============================================================================

describe("Zero Data Loss — Languages", () => {
  it("preserves ALL languages through finalizeResume", () => {
    const source = makeResume();
    const optimized = finalizeResume({ ...source }, source);
    expect(optimized.languages.length).toBe(3);
  });

  it("restores dropped languages", () => {
    const source = makeResume();
    const optimized: ResumeData = {
      ...source,
      languages: [source.languages[0]], // AI dropped 2
    };
    const result = finalizeResume(optimized, source);
    expect(result.languages.length).toBe(3); // restored
  });
});

// ============================================================================
// 3. EXPERIENCE PRESERVATION
// ============================================================================

describe("Zero Data Loss — Experience", () => {
  it("preserves ALL experience entries through finalizeResume", () => {
    const source = makeResume({
      experience: [
        { id: "e1", title: "Dev", company: "A", location: "", startDate: "2020", endDate: "2021", bullets: ["a"] },
        { id: "e2", title: "Dev2", company: "B", location: "", startDate: "2018", endDate: "2020", bullets: ["b"] },
        { id: "e3", title: "Dev3", company: "C", location: "", startDate: "2016", endDate: "2018", bullets: ["c"] },
      ],
    });
    const optimized = finalizeResume({ ...source }, source);
    expect(optimized.experience.length).toBe(3);
  });

  it("restores dropped experience entries", () => {
    const source = makeResume({
      experience: [
        { id: "e1", title: "Dev", company: "A", location: "", startDate: "2020", endDate: "2021", bullets: ["a"] },
        { id: "e2", title: "Dev2", company: "B", location: "", startDate: "2018", endDate: "2020", bullets: ["b"] },
      ],
    });
    const optimized: ResumeData = {
      ...source,
      experience: [source.experience[0]], // AI dropped 1
    };
    const result = finalizeResume(optimized, source);
    expect(result.experience.length).toBe(2); // restored
  });
});

// ============================================================================
// 4. CERTIFICATION + PROJECT PRESERVATION
// ============================================================================

describe("Zero Data Loss — Certifications & Projects", () => {
  it("preserves certifications through finalizeResume", () => {
    const source = makeResume({
      certifications: [
        { id: "c1", name: "AWS" },
        { id: "c2", name: "Azure" },
      ],
    });
    const optimized = finalizeResume({ ...source }, source);
    expect(optimized.certifications?.length).toBe(2);
  });

  it("preserves projects through finalizeResume", () => {
    const source = makeResume({
      projects: [
        { id: "p1", name: "A", description: "desc", bullets: [] },
        { id: "p2", name: "B", description: "desc", bullets: [] },
      ],
    });
    const optimized = finalizeResume({ ...source }, source);
    expect(optimized.projects?.length).toBe(2);
  });
});

// ============================================================================
// 5. SENTENCE COMPLETENESS
// ============================================================================

describe("Sentence Completeness Validator", () => {
  it("detects truncated sentence ending with 'and'", () => {
    const result = validateSentenceCompleteness("Excellent communication and");
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("detects truncated sentence ending with 'of'", () => {
    const result = validateSentenceCompleteness("with a solid understanding of");
    expect(result.valid).toBe(false);
  });

  it("passes complete sentences", () => {
    const result = validateSentenceCompleteness("Built scalable systems. Led team of 5.");
    expect(result.valid).toBe(true);
  });

  it("fixes truncated sentences by adding period", () => {
    const result = validateSentenceCompleteness("Excellent communication and");
    expect(result.cleaned).toContain(".");
  });

  it("fixes double periods", () => {
    const result = validateSentenceCompleteness("Built systems.. Led team.");
    expect(result.cleaned).not.toContain("..");
  });
});

// ============================================================================
// 6. RESUME-LEVEL SENTENCE VALIDATION
// ============================================================================

describe("Resume Sentence Completeness", () => {
  it("validates all text fields in resume", () => {
    const resume = makeResume({
      summary: "Professional with skills and",
      experience: [
        { id: "e1", title: "Dev", company: "A", location: "", startDate: "2020", endDate: "2021", bullets: ["Built systems", "excellent communication and"] },
      ],
    });
    const result = validateResumeSentenceCompleteness(resume);
    expect(result.issues.length).toBeGreaterThan(0);
    // Should fix the truncated sentences
    expect(result.cleaned.summary).toContain(".");
    const bullet = result.cleaned.experience?.[0]?.bullets?.[1] ?? "";
    expect(bullet).toContain(".");
  });

  it("passes clean resume", () => {
    const resume = makeResume();
    const result = validateResumeSentenceCompleteness(resume);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// 7. NO SECTION MERGING
// ============================================================================

describe("No Section Merging", () => {
  it("languages never become skills", () => {
    const source = makeResume({
      languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
      skills: [{ id: "s1", name: "JavaScript", category: "Tech" }],
    });
    const optimized = finalizeResume({ ...source }, source);
    // Languages must still be in languages array, not in skills
    expect(optimized.languages.length).toBe(1);
    expect(optimized.languages[0].name).toBe("English");
    // Skills should not contain "English"
    expect(optimized.skills.some(s => s.name === "English")).toBe(false);
  });

  it("education never becomes experience", () => {
    const source = makeResume();
    const optimized = finalizeResume({ ...source }, source);
    // Education entries should not appear in experience
    const eduDegrees = optimized.education.map(e => e.degree);
    const expTitles = optimized.experience.map(e => e.title);
    for (const degree of eduDegrees) {
      expect(expTitles).not.toContain(degree);
    }
  });
});
