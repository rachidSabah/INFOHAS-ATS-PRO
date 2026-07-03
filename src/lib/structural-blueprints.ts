/**
 * ResumeAI Pro — Structural Blueprints Library
 * Defines structural skeletons, section sequences, and formatting hint guidelines
 * that the optimization agents and supervisor use to maintain layout fidelity.
 */

export interface ResumeSectionStructure {
  id: "contact" | "headline" | "summary" | "experience" | "education" | "skills" | "languages" | "additional";
  name: string;
  required: boolean;
  hints: string[];
  maxEntries?: number;
  maxBulletsPerEntry?: number;
}

export interface StructuralBlueprint {
  id: string;
  name: string;
  description: string;
  sections: ResumeSectionStructure[];
  formattingHints: {
    datesFormat: string;
    bulletStyle: string;
    entityOrder: string;
  };
}

export const STRUCTURAL_BLUEPRINTS: Record<string, StructuralBlueprint> = {
  infohas_aviation: {
    id: "infohas_aviation",
    name: "InfoHAS Aviation & Hospitality",
    description: "Tailored for aviation academies and cabin crew roles (INFOHAS/OFPPT). Highlighting language proficiencies, emergency procedures, and customer experience.",
    sections: [
      { id: "contact", name: "Contact Information", required: true, hints: ["Ensure both Email and Phone are valid and formatted", "Location should be City, Country"] },
      { id: "headline", name: "Professional Headline", required: true, hints: ["Aviation or Cabin Crew specific title", "No candidate name in headline"] },
      { id: "summary", name: "Professional Summary", required: true, hints: ["Max 80 words", "Focus on guest relations, flight safety, hospitality, and communication"] },
      { id: "education", name: "Education", required: true, hints: ["INFOHAS and aviation vocational training rows first", "Separate Moroccan vocational schools (OFPPT/INFOHAS) as distinct rows", "High school degree listed after diplomas"], maxEntries: 3 },
      { id: "experience", name: "Work Experience", required: true, hints: ["Focus on premium guest service, customer care, and operations", "Keep to 3-4 quantified bullets per job entry to fit A4"], maxEntries: 3, maxBulletsPerEntry: 4 },
      { id: "skills", name: "Core Skills", required: true, hints: ["Soft skills: Customer Service, Passenger Safety, Flight Service", "Hard skills: Cabin Operations, First Aid, Crisis Management"], maxEntries: 10 },
      { id: "languages", name: "Languages", required: true, hints: ["Highlight English, French, Arabic proficiency (must be fluent/native)"] }
    ],
    formattingHints: {
      datesFormat: "YYYY-MM (e.g. 2023-09 to 2025-05)",
      bulletStyle: "Quantified action verb bullets (e.g. 'Delivered premium cabin service to over 100+ passengers daily')",
      entityOrder: "Vocational Aviation degrees -> High school diplomas -> Experience entries"
    }
  },
  ofppt_technician: {
    id: "ofppt_technician",
    name: "OFPPT Specialized Technician",
    description: "Designed for technical, business management, and vocational school graduates. Focuses on specialized technical skills, practical internships, and projects.",
    sections: [
      { id: "contact", name: "Contact Information", required: true, hints: ["Valid email and phone number", "City, Country"] },
      { id: "headline", name: "Professional Headline", required: true, hints: ["Specialized Technician or Technical Role title"] },
      { id: "summary", name: "Professional Summary", required: true, hints: ["Max 70 words", "Technical competencies and vocational projects"] },
      { id: "skills", name: "Technical Competencies", required: true, hints: ["Categorized technical skills (languages, frameworks, tools)"], maxEntries: 12 },
      { id: "experience", name: "Professional Experience", required: true, hints: ["Detail internships, practical projects, and work experience", "3 bullets per entry"], maxEntries: 4, maxBulletsPerEntry: 3 },
      { id: "education", name: "Education", required: true, hints: ["OFPPT Specialized Technician diploma", "Relevance of school context"], maxEntries: 3 },
      { id: "languages", name: "Languages", required: true, hints: ["Language list with proficiency ratings"] }
    ],
    formattingHints: {
      datesFormat: "YYYY (e.g. 2021 to 2023)",
      bulletStyle: "Action-oriented bullets with technical outcomes",
      entityOrder: "Specialized Technician degree -> Work/Internship experiences"
    }
  },
  standard_ats: {
    id: "standard_ats",
    name: "Standard Corporate ATS",
    description: "Universal single-page corporate structure optimized for parsing engines.",
    sections: [
      { id: "contact", name: "Contact Information", required: true, hints: ["Basic email, phone, location, LinkedIn link"] },
      { id: "headline", name: "Targeted Title", required: true, hints: ["Matches the target job title exactly"] },
      { id: "summary", name: "Professional Summary", required: true, hints: ["ATS keyword-rich narrative of 3-4 lines"] },
      { id: "experience", name: "Work History", required: true, hints: ["Reverse chronological order", "Focus on metric-based results"], maxEntries: 4, maxBulletsPerEntry: 5 },
      { id: "education", name: "Education", required: true, hints: ["University degrees and dates"], maxEntries: 2 },
      { id: "skills", name: "Skills Matrix", required: true, hints: ["Grouped keywords matching target JD"], maxEntries: 15 }
    ],
    formattingHints: {
      datesFormat: "YYYY-MM or YYYY",
      bulletStyle: "STAR method (Situation, Task, Action, Result) bullets",
      entityOrder: "Chronological experiences -> Degrees"
    }
  }
};
