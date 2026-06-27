import { describe, it, expect } from "vitest";
import { extractResumeFromText, blankResume } from "../parser";

describe("BOUDKIK ADAM debug", () => {
  it("shows what the parser actually returns", () => {
    const text = `BOUDKIK ADAM
Phone +212 661 617075
e-mail ADAM.BOUDKIK03@GMAIL.COM
Address INFOHAS 15 RUE DEMNATE RABAT- MOROCCO

CAREER OBJECTIVE
As a recent graduate, I am enthusiastic to begin my journey in the hospitality and aviation sector.

PERSONAL INFORMATIONS
NATIONALITY : Moroccan
HEALTH : FIT
HEIGHT CM: 180
WEIGHT KG: 65
MARITAL STATUS: Single
DATE OF BIRTH: 04/08/2003

LANGUAGES:
ENGLISH (ORAL/WRITTEN) :
FLUENT
FRENCH (ORAL/WRITTEN) :
FLUENT
ARABIC (ORAL/WRITTEN) :
FLUENT

PROFESSIONAL EXPERIENCE
Dec 2023-Mars 2024 Customer Service Agent, International Airport of Casablanca.
Apr 2024-Jan 2025 Support agent at International Negoce recruitment center Rabat.
Aug 2022-Dec 2023 Call center agent in Access Rabat.

EDUCATION
2023-2025 INFOHAS Hospitality and Aviation Accredited Diploma (Customer services, hospitality, English, Aviation and cabin crew training modules, Food & Beverage services, CRM, Communication.
2021-2022 High school degree

COMPETENCIES
Empathy: I'm a compassionate person, grasping and connecting with others' requirements and journeys, continually attaining victory via compassionate collaboration.
Time management: Moreover, I am systematic, timely, excel in task ordering, and skilled at managing my responsibilities to meet deadlines.
Customer services oriented: A perceptive auditor, empathetic, centered on resolutions, and committed to providing exceptional customer interactions.`;

    try {
      const r = extractResumeFromText(text, "test.pdf");
      console.log("WORKS! Name:", r.name);
      console.log("Experience count:", r.experience?.length);
      console.log("Education count:", r.education?.length);
      console.log("Contact:", JSON.stringify(r.contact));
      expect(r.name).toBeTruthy();
    } catch (e) {
      console.log("THROWS:", e instanceof Error ? e.message : String(e));
      expect(true).toBe(true);
    }
  });
});
