// Regression tests for the resume parser fixes.
//
// These tests verify the bugs shown in the user's screenshots:
//   1. PDF parser was putting the company name into the title field
//      ("Senior Customer Experience Specialist Vercel" as title, "Remote" as company)
//   2. Education parser was extracting "•" as the institution
//   3. Contact location was extracting "Francisco, CA" instead of "San Francisco, CA"
//
// After the fix:
//   - Experience entries: title="Senior Customer Experience Specialist",
//     company="Vercel", location="Remote"
//   - Education entries: degree="B.S.", institution="University of California, Berkeley"
//   - Contact location: "San Francisco, CA"

import { describe, it, expect } from "vitest";
import { extractResumeFromText } from "./parser";

// The exact text from ALEX_MORGAN_resume.pdf (extracted via pdftotext)
const ALEX_MORGAN_PDF_TEXT = `ALEX MORGAN
Customer Experience Professional | Multilingual Service Specialist
San Francisco, CA | +1 (415) 555-0182
alex.morgan@example.com

PROFESSIONAL SUMMARY
Customer-focused professional with 7+ years of experience delivering exceptional service in high-volume, multicultural environments.

CORE COMPETENCIES & SKILLS
Customer Service & Hospitality: Passenger assistance, Multicultural communication.

PROFESSIONAL EXPERIENCE
Senior Customer Experience Specialist Vercel | Remote Mar 2022 – Present
• Delivered high-quality customer support for 40M+ monthly users
• Led cross-functional initiatives improving user satisfaction metrics by 28%
• Resolved complex technical and service-related issues
• Collaborated with engineering teams to enhance product accessibility

Customer Experience Associate Airbnb | San Francisco, CA Jun 2019 – Feb 2022
• Provided exceptional service to 40M+ monthly users
• Assisted diverse customer base with complex travel arrangements
• Ensured compliance with company policies
• Trained new team members on service protocols

Technical Support Specialist University of California, Berkeley | Berkeley, CA Sep 2016 – May 2018
• Provided technical assistance to 5,000+ students and faculty
• Developed multilingual support materials
• Coordinated emergency response protocols

EDUCATION
B.S. in Computer Science University of California, Berkeley | 2014 – 2018
• Modules: Human-Computer Interaction, Multicultural Communication, Crisis Management

LANGUAGES
English: native
Spanish: conversational`;

describe("Parser — ALEX_MORGAN regression", () => {
  const parsed = extractResumeFromText(ALEX_MORGAN_PDF_TEXT, "ALEX_MORGAN_resume.pdf");

  it("extracts the contact location as 'San Francisco, CA' (not 'Francisco, CA')", () => {
    expect(parsed.contact.location).toBe("San Francisco, CA");
  });

  it("extracts 3 experience entries with correctly-split title/company/location", () => {
    expect(parsed.experience.length).toBe(3);

    // Entry 1: "Senior Customer Experience Specialist Vercel | Remote Mar 2022 – Present"
    expect(parsed.experience[0].title).toBe("Senior Customer Experience Specialist");
    expect(parsed.experience[0].company).toBe("Vercel");
    expect(parsed.experience[0].location).toBe("Remote");
    expect(parsed.experience[0].startDate).toBe("Mar 2022");
    expect(parsed.experience[0].endDate).toBe("Present");

    // Entry 2: "Customer Experience Associate Airbnb | San Francisco, CA Jun 2019 – Feb 2022"
    expect(parsed.experience[1].title).toBe("Customer Experience Associate");
    expect(parsed.experience[1].company).toBe("Airbnb");
    expect(parsed.experience[1].location).toBe("San Francisco, CA");
    expect(parsed.experience[1].startDate).toBe("Jun 2019");
    expect(parsed.experience[1].endDate).toBe("Feb 2022");

    // Entry 3: "Technical Support Specialist University of California, Berkeley | Berkeley, CA Sep 2016 – May 2018"
    expect(parsed.experience[2].title).toBe("Technical Support Specialist");
    expect(parsed.experience[2].company).toBe("University of California, Berkeley");
    expect(parsed.experience[2].location).toBe("Berkeley, CA");
    expect(parsed.experience[2].startDate).toBe("Sep 2016");
    expect(parsed.experience[2].endDate).toBe("May 2018");
  });

  it("extracts education institution from the same line as the degree", () => {
    expect(parsed.education.length).toBeGreaterThanOrEqual(1);
    const edu = parsed.education[0];
    expect(edu.degree).toBe("B.S.");
    // CRITICAL: institution should be "University of California, Berkeley", NOT "•"
    expect(edu.institution).toBe("University of California, Berkeley");
    // Should NOT include the date range in the institution field
    expect(edu.institution).not.toContain("2014");
    expect(edu.institution).not.toContain("|");
    expect(edu.startDate).toBe("2014");
    expect(edu.endDate).toBe("2018");
  });
});

describe("Parser — title/company split heuristics", () => {
  it("splits 'Manager Company | Location' correctly", () => {
    const text = `John Doe
Engineer

EXPERIENCE
Product Manager Acme Corp | New York, NY Jan 2020 – Present
• Did things
`;
    const parsed = extractResumeFromText(text, "test.pdf");
    expect(parsed.experience[0].title).toBe("Product Manager");
    expect(parsed.experience[0].company).toBe("Acme Corp");
    expect(parsed.experience[0].location).toBe("New York, NY");
  });

  it("splits 'Title at Company' format correctly", () => {
    const text = `Jane Doe
Engineer

EXPERIENCE
Software Engineer at Google, Mountain View, CA Jan 2020 – Present
• Did things
`;
    const parsed = extractResumeFromText(text, "test.pdf");
    expect(parsed.experience[0].title).toBe("Software Engineer");
    // The "at" split puts "Google, Mountain View, CA" as company
    // The comma split should separate company="Google" and location="Mountain View, CA"
    expect(parsed.experience[0].company).toContain("Google");
  });
});

describe("Parser — QA false positive prevention", () => {
  // This test verifies that the original parsed resume's companies match
  // the AI's optimized resume's companies, so the QA agent's
  // "companiesChanged" check does NOT produce a false positive.
  it("original companies include Vercel, Airbnb, University of California Berkeley", () => {
    const parsed = extractResumeFromText(ALEX_MORGAN_PDF_TEXT, "ALEX_MORGAN_resume.pdf");
    const originalCompanies = new Set(
      parsed.experience.map((e) => e.company?.toLowerCase().trim()).filter(Boolean)
    );
    expect(originalCompanies.has("vercel")).toBe(true);
    expect(originalCompanies.has("airbnb")).toBe(true);
    expect(originalCompanies.has("university of california, berkeley")).toBe(true);
  });
});
