// ============================================================================
// RED TESTS — "Guardian BLOCKED: Experience section is empty" after 4 attempts
//
// Production failure (user trace, 2025-08):
//   Optimization failed after 4 validated attempts with
//   "Guardian BLOCKED (standard path): layout_preserved: Structure Guardian
//    found 1 critical issue(s): Experience section is empty".
//
// Root-cause chain established by audit:
//   1. Source resume parsed with experience: [] — two parser gaps:
//      (a) extractResumeWithAI result accepted when education > 0 even with
//          zero experience, WITHOUT merging heuristic-parser experience;
//      (b) all three heuristic strategies (extractResumeFromText,
//          secondaryParser, heuristicParser) only know ENGLISH section
//          headers — French headers (EXPÉRIENCE PROFESSIONNELLE, PARCOURS
//          PROFESSIONNEL, FORMATION, COMPÉTENCES, LANGUES) and common
//          English aliases (EMPLOYMENT HISTORY in the label-index strategy,
//          CAREER HISTORY, PROFESSIONAL BACKGROUND) are missed entirely.
//   2. With source.experience empty, both restore layers short-circuit and
//      the optimizer mirrors the empty section — Guardian vetoes every
//      attempt deterministically. 4 AI attempts burned on a doomed job
//      (violates the AI Readiness Gate ABSOLUTE RULE).
//   3. The recoverable-error banner blames "AI provider unavailable" for
//      what is actually a parse failure.
//
// Fixes verified here:
//   F1. Parser header aliases (EN + FR) across all three strategies.
//   F2. mergeAiParsedWithHeuristics — fills AI-parse section gaps from the
//       heuristic result instead of accepting an experience-less parse.
//   F3. diagnoseSourceResumeGap — fail-fast diagnosis used by the
//       orchestrator BEFORE burning any AI attempts.
//   F4. Structure Guardian source-aware experience-empty message.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  extractResumeFromText,
  heuristicParser,
  secondaryParser,
  mergeAiParsedWithHeuristics,
  diagnoseSourceResumeGap,
  blankResume,
} from "../parser";
import type { ResumeData } from "../types";
import { runStructureGuardian } from "../structure-guardian";

// blankResume() is a filled-in TEMPLATE (1 experience, 1 education, 3 skills).
// These tests need a genuinely EMPTY shell.
function emptyResume(): ResumeData {
  const r = blankResume("Empty");
  r.summary = "";
  r.experience = [];
  r.education = [];
  r.skills = [];
  r.languages = [];
  r.projects = [];
  r.certifications = [];
  return r;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// French-format resume (Morocco / aviation market) — the highest-probability
// real-world trigger for this failure in this product's target audience.
const FRENCH_RESUME_TEXT = `AHMED BENALI
Agent d'escale aéroportuaire
Casablanca, Maroc
ahmed.benali@example.com | +212 6 12 34 56 78

PROFIL PROFESSIONNEL
Agent d'escale avec 6 ans d'expérience dans les opérations au sol et le service passagers.

PARCOURS PROFESSIONNEL
Agent d'escale | Royal Air Maroc | Casablanca, Maroc (Mars 2019 - Présent)
- Enregistrement des passagers et gestion de l'embarquement (200+ passagers/vol)
- Coordination des opérations ramp avec les équipes de piste
Agent de check-in | ONDA | Aéroport Mohammed V (Juin 2016 - Février 2019)
- Accueil et orientation des passagers au comptoir
- Gestion des bagages hors format et des urgences

FORMATION
Licence Professionnelle en Logistique et Transport
Université Hassan II, Casablanca, 2016

COMPÉTENCES
Opérations au sol, Check-in, Embarquement, Amadeus, Service passagers

LANGUES
Arabe: langue maternelle, Français: courant, Anglais: professionnel
`;

// English resume with headers the label-index strategy (extractResumeFromText)
// historically missed: EMPLOYMENT HISTORY / CAREER HISTORY / PROFESSIONAL
// BACKGROUND as the experience header.
const EN_ALIAS_RESUME_TEXT = `SARA ALAMI
Airport Services Agent
Casablanca, Morocco
sara.alami@example.com | +212 6 98 76 54 32

SUMMARY
Airport services agent with 5 years of ground operations experience.

CAREER HISTORY
Check-in Agent | MENA Handling | Casablanca (Jan 2020 - Present)
- Processed 300+ passengers per shift at check-in counters
- Coordinated boarding gate operations and turnaround times
Ramp Agent | Swissport | Casablanca (Mar 2018 - Dec 2019)
- Loaded and unloaded baggage with zero-damage handling record

PROFESSIONAL BACKGROUND
Lounge Agent | ATA by MENA | Casablanca (Jun 2017 - Feb 2018)
- Staffed premium lounge reception and managed guest access lists

EDUCATION
BTS in Airport Operations
OFPPT, Casablanca, 2018

SKILLS
Ground Operations, Check-in, Boarding, Ramp, Passenger Services

LANGUAGES
Arabic (native), French (fluent), English (professional)
`;

const EMPLOYMENT_HISTORY_RESUME_TEXT = `TAREK IDRISSI
Passenger Services Officer
Rabat, Morocco
tarek.idrissi@example.com | +212 6 11 22 33 44

PROFILE
Passenger services professional with 4 years of airport experience.

EMPLOYMENT HISTORY
Passenger Services Officer | ONDA | Rabat (Feb 2021 - Present)
- Managed boarding priorities and special-assistance passengers
- Resolved disrupted-travel rebooking for 50+ passengers daily
Ground Agent | Groundstar | Rabat (Sep 2019 - Jan 2021)
- Performed ramp marshalling and baggage transfer coordination

EDUCATION
Licence en Management du Transport
Université Mohammed V, Rabat, 2019

LANGUAGES
Arabic (native), French (fluent)
`;

// ---------------------------------------------------------------------------
// F1 — Parser header aliases (EN + FR), all three strategies
// ---------------------------------------------------------------------------

describe("Parser — French section headers (F1)", () => {
  it("extractResumeFromText extracts experience from a French-header resume", () => {
    const parsed = extractResumeFromText(FRENCH_RESUME_TEXT, "ahmed_benali_fr.pdf");
    expect(parsed.experience.length).toBeGreaterThanOrEqual(2);
    expect(parsed.experience[0].company.toLowerCase()).toContain("royal air maroc");
  });

  it("extractResumeFromText extracts education and skills from a French-header resume", () => {
    const parsed = extractResumeFromText(FRENCH_RESUME_TEXT, "ahmed_benali_fr.pdf");
    expect(parsed.education.length).toBeGreaterThanOrEqual(1);
    expect(parsed.skills.length).toBeGreaterThanOrEqual(3);
    expect(parsed.languages.length).toBeGreaterThanOrEqual(1);
  });

  it("secondaryParser extracts experience from a French-header resume", () => {
    const parsed = secondaryParser(FRENCH_RESUME_TEXT, "ahmed_benali_fr.pdf");
    expect(parsed.experience.length).toBeGreaterThanOrEqual(1);
  });

  it("heuristicParser extracts experience from a French-header resume", () => {
    const parsed = heuristicParser(FRENCH_RESUME_TEXT, "ahmed_benali_fr.pdf");
    expect(parsed.experience.length).toBeGreaterThanOrEqual(1);
  });

  it("extractResumeFromText handles 'CAREER HISTORY' + 'PROFESSIONAL BACKGROUND' headers", () => {
    const parsed = extractResumeFromText(EN_ALIAS_RESUME_TEXT, "sara_alami.pdf");
    expect(parsed.experience.length).toBeGreaterThanOrEqual(2);
    expect(parsed.experience[0].company.toLowerCase()).toContain("mena handling");
  });

  it("extractResumeFromText handles 'EMPLOYMENT HISTORY' header", () => {
    const parsed = extractResumeFromText(EMPLOYMENT_HISTORY_RESUME_TEXT, "tarek_idrissi.pdf");
    expect(parsed.experience.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// F2 — mergeAiParsedWithHeuristics: fill AI-parse gaps from heuristics
// ---------------------------------------------------------------------------

describe("mergeAiParsedWithHeuristics (F2)", () => {
  it("fills empty AI experience from the heuristic result", () => {
    const aiParsed = emptyResume();
    aiParsed.name = "Ahmed Benali";
    aiParsed.education = [
      {
        id: "edu_1",
        degree: "Licence Professionnelle",
        institution: "Université Hassan II",
        field: "Logistique",
        location: "Casablanca",
        startDate: "2013",
        endDate: "2016",
        highlights: [],
      },
    ];
    const heuristic = extractResumeFromText(FRENCH_RESUME_TEXT, "ahmed_benali_fr.pdf");
    expect(heuristic.experience.length).toBeGreaterThanOrEqual(1);

    const merged = mergeAiParsedWithHeuristics(aiParsed, heuristic);
    expect(merged.experience.length).toBeGreaterThanOrEqual(1);
    // AI sections are preserved, not overwritten
    expect(merged.education.length).toBe(1);
    expect(merged.education[0].institution).toBe("Université Hassan II");
  });

  it("never overwrites non-empty AI sections with heuristic content", () => {
    const aiParsed = emptyResume();
    aiParsed.experience = [
      {
        id: "exp_ai",
        title: "Agent d'escale",
        company: "Royal Air Maroc",
        location: "Casablanca",
        startDate: "Mars 2019",
        endDate: "Présent",
        bullets: ["AI-extracted bullet"],
      },
    ];
    const heuristic = emptyResume();
    heuristic.experience = [
      {
        id: "exp_h",
        title: "Different Entry",
        company: "Other Employer",
        location: "Rabat",
        startDate: "2016",
        endDate: "2019",
        bullets: ["Heuristic bullet"],
      },
    ];
    const merged = mergeAiParsedWithHeuristics(aiParsed, heuristic);
    expect(merged.experience.length).toBe(1);
    expect(merged.experience[0].company).toBe("Royal Air Maroc");
  });

  it("returns the AI parse unchanged when heuristics found nothing extra", () => {
    const aiParsed = emptyResume();
    aiParsed.summary = "AI summary";
    const heuristic = emptyResume();
    const merged = mergeAiParsedWithHeuristics(aiParsed, heuristic);
    expect(merged.summary).toBe("AI summary");
    expect(merged.experience.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F3 — diagnoseSourceResumeGap: fail-fast diagnosis for the orchestrator
// ---------------------------------------------------------------------------

describe("diagnoseSourceResumeGap (F3)", () => {
  it("returns a diagnosis when the source resume has no experience entries", () => {
    const resume = emptyResume();
    resume.skills = [{ id: "s1", name: "Check-in", category: "Skills" }];
    const diagnosis = diagnoseSourceResumeGap(resume);
    expect(diagnosis).not.toBeNull();
    expect(diagnosis!).toContain("experience");
    expect(diagnosis!.toLowerCase()).toContain("pars");
  });

  it("returns null when the source resume has experience entries", () => {
    const resume = emptyResume();
    resume.experience = [
      {
        id: "e1",
        title: "Agent",
        company: "ONDA",
        location: "Rabat",
        startDate: "2020",
        endDate: "Present",
        bullets: ["Did things"],
      },
    ];
    expect(diagnoseSourceResumeGap(resume)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F4 — Structure Guardian: source-aware experience-empty message
// ---------------------------------------------------------------------------

describe("Structure Guardian — source-aware experience message (F4)", () => {
  it("points at the PARSER (not the AI) when source experience is also empty", () => {
    const source = emptyResume();
    source.skills = [{ id: "s1", name: "Check-in", category: "Skills" }];
    const optimized = emptyResume();
    optimized.skills = [{ id: "s1", name: "Check-in", category: "Skills" }];
    optimized.summary = "Optimized summary";

    const result = runStructureGuardian(optimized, source);
    const expIssue = result.criticalIssues.find((i) => i.toLowerCase().includes("experience"));
    expect(expIssue).toBeDefined();
    expect(expIssue!.toLowerCase()).toContain("pars");
    expect(expIssue!.toLowerCase()).toMatch(/source|upload/);
  });

  it("keeps the plain message when the source HAS experience (AI dropped it)", () => {
    const source = emptyResume();
    source.experience = [
      {
        id: "e1",
        title: "Agent",
        company: "ONDA",
        location: "Rabat",
        startDate: "2020",
        endDate: "Present",
        bullets: ["Did things"],
      },
    ];
    const optimized = emptyResume();
    const result = runStructureGuardian(optimized, source);
    const expIssue = result.criticalIssues.find((i) =>
      i.toLowerCase().includes("experience section is empty"),
    );
    expect(expIssue).toBeDefined();
    expect(expIssue!.toLowerCase()).not.toContain("pars");
  });
});
