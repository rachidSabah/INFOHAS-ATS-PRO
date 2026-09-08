import { describe, it, expect } from "vitest";
import {
  assembleResume,
  findRemovedSourceSkills,
  canonicalSkillKey,
  normalizeSkillName,
} from "../resume-assembler";
import { cleanupNameField, cleanupGrammar, cleanupResumeGrammar } from "../ai-response-processor";
import type { ResumeData } from "../types";

// ============================================================================
// Regression: production failure "Skill 'Passenger Check - in' was removed
// from assembled resume" (4/4 attempts burned, optimization unrecoverable).
//
// Root cause chain (HEAD 21096df):
//   1. PDF text extraction emits spaced-hyphen artifacts ("Passenger Check - in").
//   2. The assembler merge-back added the source variant (optimizer returned
//      the normalized "Passenger Check-in").
//   3. cleanupResumeGrammar ran the BULLET-oriented cleanupGrammar on skill
//      names — its orphaned-trailing-preposition rule
//      (\s+(?:of|in|on|at|with|for|and|the|a|an|to|by|from)$) ate the " in",
//      renaming the skill to "Passenger Check -".
//   4. The Fix-8 preservation check correctly reported the (corrupted) skill
//      as removed → every attempt failed identically → unrecoverable.
//
// Fixes pinned here:
//   A. cleanupNameField — name-safe cleanup for entity names (no trailing-
//      word removal, no filler-phrase removal).
//   B. canonicalSkillKey — dash/whitespace-insensitive matching so a PDF
//      artifact spelling and its AI-normalized spelling are the same skill
//      (findRemovedSourceSkills, assembler merge-back, category restoration).
// ============================================================================

describe("cleanupNameField (Fix A — name-safe cleanup)", () => {
  it("preserves spaced-hyphen skill names that cleanupGrammar corrupts", () => {
    // Documents the contrast: the bullet-oriented cleaner mangles names.
    expect(cleanupGrammar("Passenger Check - in")).toBe("Passenger Check -");
    // The name-safe cleaner must not.
    expect(cleanupNameField("Passenger Check - in")).toBe("Passenger Check - in");
  });

  it("keeps names ending with common prepositions/articles intact", () => {
    expect(cleanupNameField("Check - in")).toBe("Check - in");
    expect(cleanupNameField("Cabin and Cockpit Crew - at")).toBe("Cabin and Cockpit Crew - at");
    expect(cleanupNameField("Boarding - for")).toBe("Boarding - for");
    expect(cleanupNameField("Ramp Services - the")).toBe("Ramp Services - the");
  });

  it("still performs safe punctuation/whitespace fixes", () => {
    expect(cleanupNameField("Customer  Service")).toBe("Customer Service");
    expect(cleanupNameField("`Leadership`")).toBe("Leadership");
    expect(cleanupNameField("Team .. Work")).toBe("Team. Work");
    expect(cleanupNameField("Passenger Handling ,")).toBe("Passenger Handling,");
    expect(cleanupNameField(" - ")).toBe("");
  });
});

describe("cleanupResumeGrammar keeps entity names intact (Fix A)", () => {
  const resume = {
    id: "r1",
    name: "Test Candidate",
    headline: "Customer Service Agent",
    contact: { email: "t@example.com" },
    summary: "Airport customer service professional.",
    experience: [
      {
        id: "e1",
        title: "Customer Service Agent",
        company: "Aviation Services Co",
        startDate: "2021",
        endDate: "2024",
        bullets: ["Assisted passengers at check-in counters..", "Handled boarding, and gate duties."],
      },
    ],
    education: [],
    skills: [
      { id: "s1", name: "Passenger Check - in", category: "Ground Operations" },
      { id: "s2", name: "Ramp  Services", category: "Ground Operations" },
    ],
    languages: [{ id: "l1", name: "English", proficiency: "Fluent - in" }],
    certifications: [],
    projects: [],
  } as unknown as ResumeData;

  it("does not rename skills/languages while still cleaning bullets", () => {
    const cleaned = cleanupResumeGrammar(resume) as typeof resume;
    expect(cleaned.skills[0].name).toBe("Passenger Check - in");
    expect(cleaned.skills[1].name).toBe("Ramp Services"); // whitespace still fixed
    expect(cleaned.languages[0].name).toBe("English");
    // Bullets still get the full sentence-oriented cleanup
    expect(cleaned.experience[0].bullets[0]).toBe("Assisted passengers at check-in counters.");
  });
});

describe("canonicalSkillKey (Fix B — dash-insensitive equality)", () => {
  it("folds every dash family member and whitespace", () => {
    expect(canonicalSkillKey("Passenger Check - in")).toBe("passenger check in");
    expect(canonicalSkillKey("Passenger Check-in")).toBe("passenger check in");
    expect(canonicalSkillKey("Passenger Check–in")).toBe("passenger check in"); // en dash
    expect(canonicalSkillKey("Passenger Check—in")).toBe("passenger check in"); // em dash
    expect(canonicalSkillKey("Passenger  Check-In")).toBe("passenger check in");
  });

  it("keeps category prefixes and case folded", () => {
    expect(canonicalSkillKey("General: Check-in")).toBe(canonicalSkillKey("check - in"));
    expect(canonicalSkillKey("Check-In") === normalizeSkillName("check - in")).toBe(false);
  });

  it("does NOT fold non-dash punctuation (C++ vs C stay distinct)", () => {
    expect(canonicalSkillKey("C++")).not.toBe(canonicalSkillKey("C"));
    expect(canonicalSkillKey("C#")).not.toBe(canonicalSkillKey("C"));
  });
});

describe("findRemovedSourceSkills accepts dash-variant spellings (Fix B)", () => {
  it("accepts 'Passenger Check - in' vs 'Passenger Check-in'", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Passenger Check - in" }],
      [{ name: "Passenger Check-in" }],
      [],
    )).toEqual([]);
  });

  it("accepts en-dash / em-dash variants", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Passenger Check - in" }],
      [{ name: "Passenger Check–in" }],
      [],
    )).toEqual([]);
    expect(findRemovedSourceSkills(
      [{ name: "Ground - handling" }],
      [{ name: "Ground—handling" }],
      [],
    )).toEqual([]);
  });

  it("still flags genuinely deleted skills", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Passenger Check - in" }],
      [{ name: "Boarding" }],
      [],
    )).toEqual(["Passenger Check - in"]);
  });

  it("still flags a different skill that merely shares words", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Passenger Check - in" }],
      [{ name: "Passenger Check" }],
      [],
    )).toEqual(["Passenger Check - in"]);
  });

  it("accepts dash variants inside compound relocation and language sets", () => {
    expect(findRemovedSourceSkills(
      [{ name: "Check - in, Boarding" }],
      [{ name: "Check-in" }, { name: "Boarding" }],
      [],
    )).toEqual([]);
    expect(findRemovedSourceSkills(
      [{ name: "Bahasa - Indonesia" }],
      [],
      [{ name: "Bahasa-Indonesia" }],
    )).toEqual([]);
  });
});

describe("assembler end-to-end: spaced-hyphen source survives the full chain", () => {
  const source = {
    id: "r1",
    name: "Test Candidate",
    headline: "Customer Service Agent",
    contact: { email: "t@example.com", location: "Doha" },
    summary: "Customer service professional with airport experience.",
    experience: [
      {
        id: "e1",
        title: "Customer Service Agent",
        company: "Aviation Services Co",
        startDate: "2021",
        endDate: "2024",
        bullets: [
          "Assisted passengers at check-in counters and boarding gates.",
          "Resolved customer complaints with high satisfaction scores.",
        ],
      },
    ],
    education: [],
    skills: [
      { id: "s1", name: "Passenger Check - in", category: "Ground Operations" },
      { id: "s2", name: "Boarding Pass Issuance", category: "Ground Operations" },
      { id: "s3", name: "Customer Service", category: "Soft" },
    ],
    languages: [{ id: "l1", name: "English" }, { id: "l2", name: "Arabic" }],
    certifications: [],
    projects: [],
  } as unknown as ResumeData;

  const optimizerOutput = {
    summary: "Customer service professional with airport check-in expertise.",
    headline: "Customer Service Agent",
    skills: [
      { name: "Passenger Check-in", category: "Ground Operations" }, // normalized spelling
      { name: "Boarding Pass Issuance", category: "Ground Operations" },
      { name: "Customer Service", category: "Soft" },
      { name: "Passenger Services", category: "Ground Operations" },
    ],
    experiences: [
      {
        id: "e1",
        bullets: [
          "Assisted passengers at check-in counters and boarding gates, ensuring on-time departures.",
          "Resolved customer complaints with high satisfaction scores and empathy.",
        ],
      },
    ],
  };

  it("Fix-8 check passes and no lookalike duplicate is rendered", () => {
    const asm = assembleResume(source, optimizerOutput as never, {} as never);
    const names = asm.resume.skills.map((s: any) => s.name);

    // The preservation gate (Fix 8) must pass:
    expect(findRemovedSourceSkills(source.skills, asm.resume.skills, asm.resume.languages)).toEqual([]);

    // The normalized optimizer spelling wins; the PDF artifact is NOT merged
    // back as a lookalike duplicate (canonical dedup).
    expect(names).toContain("Passenger Check-in");
    expect(names.filter((n: string) => /check/i.test(n))).toHaveLength(1);

    // Category restoration works across the dash-variant boundary.
    expect(asm.resume.skills.find((s: any) => s.name === "Passenger Check-in")?.category).toBe("Ground Operations");
  });

  it("merge-back still restores genuinely new source skills (exact)", () => {
    const asm = assembleResume(
      source,
      {
        summary: optimizerOutput.summary,
        headline: optimizerOutput.headline,
        skills: [{ name: "Passenger Check-in", category: "Ground Operations" }],
        experiences: optimizerOutput.experiences,
      } as never,
    );
    const names = asm.resume.skills.map((s: any) => s.name);
    expect(names).toContain("Boarding Pass Issuance"); // restored from source
    expect(names).toContain("Customer Service"); // restored from source
  });
});
