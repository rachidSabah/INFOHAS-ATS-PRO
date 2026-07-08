import { describe, it, expect } from "vitest";
import { toRenderDocument } from "../render-document";
import type { ResumeData, ResumeLayoutModel } from "../types";

function makeResume(): ResumeData {
  return {
    id: "test",
    name: "Test User",
    contact: { email: "test@example.com", phone: "+1234567890", location: "Test City" },
    summary: "Professional summary",
    skills: [{ id: "s1", name: "React", category: "Frontend" }],
    experience: [
      { id: "e1", title: "Senior Engineer", company: "TechCorp", startDate: "2020-01", endDate: "2023-06", bullets: ["Built scalable systems"] },
    ],
    education: [
      { id: "ed1", degree: "BS CS", institution: "MIT", startDate: "2014", endDate: "2018" },
    ],
    languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
    certifications: [],
    projects: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "upload",
  };
}

function makeLayout(overrides: Partial<ResumeLayoutModel> = {}): ResumeLayoutModel {
  return {
    pageSize: "A4",
    marginTopMm: 6.35, marginBottomMm: 6.35, marginLeftMm: 8.89, marginRightMm: 8.89,
    fontFamily: "Times New Roman", fallbackFontFamily: "Arial", nameSizePt: 14, sectionTitleSizePt: 12, bodyFontSizePt: 10.5,
    nameColor: "#8B0000", sectionTitleColor: "#8B0000", bodyTextColor: "#000000", contactColor: "#000000",
    lineHeightMm: 4, sectionGapMm: 3, headerGapMm: 1, bulletIndentMm: 4, paragraphSpacingMm: 1.5,
    photoWidthMm: 30, photoHeightMm: 40,
    enforceOnePage: true, minFontSizePt: 10,
    ...overrides,
  };
}

describe("Layout Customizations", () => {
  it("standardizes contact details in single-line format", () => {
    const resume = makeResume();
    const layout = makeLayout({ contactSpacing: "single-line" });
    const rd = toRenderDocument(resume, layout);
    expect(rd.contact.email).toBe("test@example.com");
    expect(rd.contact.phone).toBe("+1234567890");
    expect(rd.contact.location).toBe("Test City");
  });

  it("reorders sections based on layout sectionOrder settings", () => {
    const resume = makeResume();
    // Custom order: Education, then Skills, then Experience
    const layout = makeLayout({
      sectionOrder: ["education", "skills", "experience", "summary", "languages"],
    });
    const rd = toRenderDocument(resume, layout);
    const sectionTypes = rd.sections.map((s) => s.type);

    expect(sectionTypes[0]).toBe("education");
    expect(sectionTypes[1]).toBe("skills");
    expect(sectionTypes[2]).toBe("professionalExperience");
    expect(sectionTypes[3]).toBe("professionalProfile");
    expect(sectionTypes[4]).toBe("languages");
  });
});
