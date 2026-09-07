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
});
