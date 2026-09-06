import { describe, it, expect, afterEach } from "vitest";
import { alignResumeToBlueprint } from "../unified-pipeline";
import {
  STRUCTURAL_BLUEPRINTS,
  registerCustomBlueprints,
  getBlueprintById,
  getAllBlueprints,
  isBuiltInBlueprint,
  isCustomizedBlueprint,
} from "../structural-blueprints";
import type { StructuralBlueprint } from "../structural-blueprints";
import type { ResumeData } from "../types";

// Shared fixture (module scope — used by both describes)
const mockResume = {
  name: "ADAM BOUDKIK",
  headline: "Hospitality Professional",
  contact: {
    email: "adam@gmail.com",
    phone: "+212 661-617075",
    location: "Doha, Qatar",
  },
  summary: "Dedicated service professional.",
  experience: [
    {
      id: "exp-1",
      title: "Cabin Crew",
      company: "Qatar Airways",
      location: "Doha",
      startDate: "2024-01",
      endDate: "Present",
      bullets: ["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5"],
    },
    {
      id: "exp-2",
      title: "Intern",
      company: "Hotel",
      location: "Bahrain",
      startDate: "2023-01",
      endDate: "2023-05",
      bullets: ["Intern bullet 1", "Intern bullet 2"],
    },
  ],
  education: [
    {
      id: "edu-1",
      institution: "Temara High School",
      degree: "High School Degree",
      field: "Science",
      startDate: "2021",
      endDate: "2022",
      highlights: [],
    },
    {
      id: "edu-2",
      institution: "INFOHAS Aviation Center",
      degree: "Cabin Crew Attestation",
      field: "Aviation",
      startDate: "2022",
      endDate: "2023",
      highlights: [],
    },
    {
      id: "edu-3",
      institution: "OFPPT Business School",
      degree: "Specialized Technician",
      field: "Business",
      startDate: "2023",
      endDate: "2024",
      highlights: [],
    },
  ],
  skills: [
    { id: "s1", name: "Customer Relations", category: "Soft" },
    { id: "s2", name: "First Aid", category: "Safety" },
  ],
  languages: [
    { id: "l1", name: "Arabic", proficiency: "native" },
    { id: "l2", name: "English", proficiency: "fluent" },
  ],
  certifications: [],
  dynamicSections: [],
} as unknown as ResumeData;

describe("Structural Blueprints Alignment", () => {

  it("should sort INFOHAS and OFPPT education rows to the top of the list", () => {
    const aligned = alignResumeToBlueprint(mockResume, "infohas_aviation");
    
    // INFOHAS or OFPPT must be the first entries, high school at the bottom
    expect(aligned.education[0].institution).toContain("INFOHAS");
    expect(aligned.education[1].institution).toContain("OFPPT");
    expect(aligned.education[2].institution).toContain("Temara High School");
  });

  it("should limit experience bullets per entry based on blueprint constraints", () => {
    const aligned = alignResumeToBlueprint(mockResume, "infohas_aviation");
    
    // infohas_aviation allows max 4 bullets per experience
    expect(aligned.experience[0].bullets.length).toBe(4);
    expect(aligned.experience[0].bullets).toEqual(["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4"]);
    
    // The second experience was already under 4, so it stays unchanged
    expect(aligned.experience[1].bullets.length).toBe(2);
  });
});

// ============================================================================
// Task 15 — Custom Blueprint Registry (Blueprint Editor backend)
// ============================================================================

describe("Custom blueprint registry", () => {
  afterEach(() => {
    registerCustomBlueprints([]); // reset module state between tests
  });

  const CUSTOM_BP: StructuralBlueprint = {
    id: "custom_bp_test",
    name: "Test Custom Blueprint",
    description: "User-created blueprint",
    sections: [
      { id: "contact", name: "Contact", required: true, hints: [] },
      { id: "experience", name: "Experience", required: true, hints: [], maxEntries: 1, maxBulletsPerEntry: 2 },
    ],
    formattingHints: { datesFormat: "YYYY", bulletStyle: "Terse", entityOrder: "Experience first" },
  };

  const OVERRIDE_BP: StructuralBlueprint = {
    ...JSON.parse(JSON.stringify(STRUCTURAL_BLUEPRINTS.standard_ats)),
    name: "Standard Corporate ATS (Customized)",
  };

  it("registerCustomBlueprints makes a new custom blueprint resolvable and listed", () => {
    registerCustomBlueprints([CUSTOM_BP]);
    expect(getBlueprintById("custom_bp_test")?.name).toBe("Test Custom Blueprint");
    expect(getAllBlueprints().some((b) => b.id === "custom_bp_test")).toBe(true);
    expect(isBuiltInBlueprint("custom_bp_test")).toBe(false);
    expect(isCustomizedBlueprint("custom_bp_test")).toBe(true);
  });

  it("a custom entry with a built-in id SHADOWS the built-in (edit in place)", () => {
    registerCustomBlueprints([OVERRIDE_BP]);
    expect(getBlueprintById("standard_ats")?.name).toBe("Standard Corporate ATS (Customized)");
    // still identified as a built-in id, but customized
    expect(isBuiltInBlueprint("standard_ats")).toBe(true);
    expect(isCustomizedBlueprint("standard_ats")).toBe(true);
    // merged list keeps ONE entry for the id (no duplicates)
    expect(getAllBlueprints().filter((b) => b.id === "standard_ats")).toHaveLength(1);
  });

  it("clearing the registry restores factory built-ins", () => {
    registerCustomBlueprints([OVERRIDE_BP]);
    registerCustomBlueprints([]);
    expect(getBlueprintById("standard_ats")?.name).toBe("Standard Corporate ATS");
    expect(isCustomizedBlueprint("standard_ats")).toBe(false);
  });

  it("unknown ids resolve to undefined (pipeline applies its own fallback)", () => {
    expect(getBlueprintById("does_not_exist")).toBeUndefined();
    expect(getBlueprintById(undefined)).toBeUndefined();
  });

  it("alignResumeToBlueprint enforces limits from a CUSTOM blueprint", () => {
    registerCustomBlueprints([CUSTOM_BP]);
    // custom limits: maxEntries 1, maxBulletsPerEntry 2
    const aligned = alignResumeToBlueprint(mockResume, "custom_bp_test");
    expect(aligned.experience).toHaveLength(1);
    expect(aligned.experience[0].bullets).toHaveLength(2);
  });

  it("alignResumeToBlueprint still falls back to infohas_aviation for unknown ids", () => {
    const aligned = alignResumeToBlueprint(mockResume, "no_such_blueprint");
    // infohas_aviation max 4 bullets per entry
    expect(aligned.experience[0].bullets.length).toBe(4);
  });

  it("registerCustomBlueprints ignores malformed entries", () => {
    registerCustomBlueprints([null as any, { id: "" } as any, { id: "x" } as any, CUSTOM_BP]);
    expect(Object.keys(getAllBlueprints().filter((b) => b.id === "custom_bp_test"))).toHaveLength(1);
    expect(getBlueprintById("x")).toBeUndefined();
  });
});
