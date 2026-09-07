import { describe, it, expect } from "vitest";
import { assembleResume, findRemovedSourceSkills } from "../resume-assembler";
import type { ResumeData } from "../types";

// Gate-vs-gate contradiction: the assembler legitimately MOVES
// language-category skills into languages[] (language separation), but the
// Fix-8 immutability check demanded them in skills[] — every attempt failed
// identically ("Fluent in English was removed") with no possible recovery.
// Relocated skills count as preserved; truly deleted ones still fail.
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

describe("skill relocation preservation (Fix 8)", () => {
  it("accepts the production case: language skill moved to languages[]", () => {
    const asm = assembleResume(source, {
      summary: "Crew member.",
      skills: [{ name: "Customer Service", category: "Soft" }],
      experiences: [{ id: "e1", bullets: ["Helped guests daily"] }],
    } as never, {} as never);
    expect(asm.resume.languages.map((l: any) => l.name)).toContain("Fluent in English");
    expect(findRemovedSourceSkills(source.skills, asm.resume.skills, asm.resume.languages)).toEqual([]);
  });

  it("still flags a genuinely deleted skill", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Customer Service" }],
      [],
      [],
    )).toEqual(["Customer Service"]);
  });

  it("accepts split multi-language relocation", () => {
    expect(findRemovedSourceSkills(
      [{ name: "English, French" }],
      [],
      [{ name: "English" }, { name: "French" }],
    )).toEqual([]);
  });

  it("accepts language proficiency qualifiers (e.g. 'Fluent in English' matching 'English')", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Fluent in English" }],
      [],
      [{ name: "English" }],
    )).toEqual([]);
  });

  it("accepts parenthetical proficiency (e.g. 'English (Fluent)' matching 'English')", () => {
    expect(findRemovedSourceSkills(
      [{ name: "English (Fluent)" }],
      [],
      [{ name: "English" }],
    )).toEqual([]);
  });

  it("accepts natural language conjunctions (e.g. 'Fluent in English and French')", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Fluent in English and French" }],
      [],
      [{ name: "English" }, { name: "French" }],
    )).toEqual([]);
  });

  it("accepts leaked 'Languages:' category header as preserved when languages exist", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Languages:" }],
      [],
      [{ name: "English" }],
    )).toEqual([]);
  });

  it("keeps the category-prefix normalization working", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Active Listening" }],
      [{ name: "General: Active Listening" }],
      [],
    )).toEqual([]);
  });
});
