import { describe, it, expect } from "vitest";
import { assembleResume } from "../resume-assembler";
import { checkSkillCategoriesPreserved } from "../resume-guardian-agent";
import type { ResumeData } from "../types";

// Guardian-vs-Guardian contradiction: checkLanguagesNotInSkills strips
// language entries from skills[] while checkSkillCategoriesPreserved
// BLOCKED on the missing "languages" category — mutually unsatisfiable,
// identical BLOCK x4. A category relocated into languages[] is preserved.
const source = {
  id: "r1",
  name: "Test Candidate",
  headline: "Cabin Crew",
  contact: { email: "t@example.com" },
  summary: "Crew member.",
  experience: [{ id: "e1", title: "Agent", company: "Air", startDate: "2020", endDate: "2024", bullets: ["Helped guests daily"] }],
  education: [],
  skills: [
    { id: "s1", name: "Fluent in English", category: "Languages" },
    { id: "s2", name: "Customer Service", category: "Soft" },
  ],
  languages: [],
  certifications: [],
  projects: [],
} as unknown as ResumeData;

describe("guardian skill-category relocation", () => {
  it("passes the production case end to end (assemble moves, guardian accepts)", () => {
    const asm = assembleResume(source, {
      summary: "Crew member.",
      skills: [{ name: "Customer Service", category: "Soft" }],
      experiences: [{ id: "e1", bullets: ["Helped guests daily"] }],
    } as never, {} as never);
    const check = checkSkillCategoriesPreserved(asm.resume, source);
    expect(check.passed).toBe(true);
  });

  it("still BLOCKs a language category lost entirely", () => {
    const lost = { ...source, skills: [{ id: "s2", name: "Customer Service", category: "Soft" }] } as unknown as ResumeData;
    const optimized = { ...lost, skills: [{ id: "s2", name: "Customer Service", category: "Soft" }], languages: [] } as unknown as ResumeData;
    const check = checkSkillCategoriesPreserved(optimized, source);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("languages");
  });

  it("still BLOCKs a dropped non-language category", () => {
    const optimized = {
      ...source,
      skills: [{ id: "s1", name: "Fluent in English", category: "Languages" }],
      languages: [{ id: "l1", name: "Fluent in English" }],
    } as unknown as ResumeData;
    const check = checkSkillCategoriesPreserved(optimized, source);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("soft");
  });

  it('passes when one "English and French" skill is split into two languages by the assembler', () => {
    const andSource = {
      ...source,
      skills: [
        { id: "s1", name: "English and French", category: "Languages" },
        { id: "s2", name: "Customer Service", category: "Soft" },
      ],
    } as unknown as ResumeData;
    const asm = assembleResume(andSource, {
      summary: "Crew member.",
      skills: [{ name: "Customer Service", category: "Soft" }],
      experiences: [{ id: "e1", bullets: ["Helped guests daily"] }],
    } as never, {} as never);
    expect(asm.resume.languages.map((l: any) => l.name)).toEqual(
      expect.arrayContaining(["English", "French"]),
    );
    expect(checkSkillCategoriesPreserved(asm.resume, andSource).passed).toBe(true);
  });

  it("passes when proficiency qualifiers differ between skill and language entries", () => {
    const optimized = {
      ...source,
      skills: [{ id: "s2", name: "Customer Service", category: "Soft" }],
      languages: [{ id: "l1", name: "English (Fluent)" }],
    } as unknown as ResumeData;
    // source.skills[0] is "Fluent in English" / Languages; "English (Fluent)"
    // is the same language with a different qualifier shape.
    expect(checkSkillCategoriesPreserved(optimized, source).passed).toBe(true);
  });

  it('passes when the source "languages" skill is a bare section header and languages[] is populated', () => {
    const headerSource = {
      ...source,
      skills: [
        { id: "s1", name: "Languages", category: "Languages" },
        { id: "s2", name: "Customer Service", category: "Soft" },
      ],
      languages: [{ id: "l1", name: "English" }],
    } as unknown as ResumeData;
    const optimized = {
      ...headerSource,
      skills: [{ id: "s2", name: "Customer Service", category: "Soft" }],
      languages: [{ id: "l1", name: "English" }],
    } as unknown as ResumeData;
    expect(checkSkillCategoriesPreserved(optimized, headerSource).passed).toBe(true);
  });

  it("preserves all 6 education highlights in assembleResume including bullets starting with Communication and Teamwork", () => {
    const eduSource = {
      ...source,
      education: [
        {
          id: "ed_galileo",
          degree: "High school diploma",
          institution: "Lycée scientifique Galileo",
          highlights: [
            "Option: Mathématiques",
            "Physique-Chimie",
            "Mention Très Bien",
            "Communication and international projects",
            "Teamwork in science Olympiad",
            "Scientific methodology",
          ],
        },
      ],
    } as unknown as ResumeData;

    const asm = assembleResume(eduSource, {
      summary: "Crew member.",
      skills: [{ name: "Customer Service", category: "Soft" }],
      experiences: [{ id: "e1", bullets: ["Helped guests daily"] }],
    } as never, {} as never);

    expect(asm.resume.education[0].highlights).toHaveLength(6);
    expect(asm.resume.education[0].highlights).toContain("Communication and international projects");
    expect(asm.resume.education[0].highlights).toContain("Teamwork in science Olympiad");
  });
});

