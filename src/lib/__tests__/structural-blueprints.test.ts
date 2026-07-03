import { describe, it, expect } from "vitest";
import { alignResumeToBlueprint } from "../unified-pipeline";
import type { ResumeData } from "../types";

describe("Structural Blueprints Alignment", () => {
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
