// ============================================================================
// Governed Optimizer — Comprehensive Tests for All Four New Agents
//
// Tests for:
//   1. ResumeBlueprintAgent     — extractBlueprint / compareBlueprint
//   2. ResumeTemplateBlueprintAgent — extractTemplateBlueprint / validateTemplatePreserved
//   3. ResumeGuardianAgent       — runGuardianValidation / formatGuardianVerdict
//   4. RetryEngine               — createRetryEngine / run / reset / getState
// ============================================================================

import { describe, it, expect } from "vitest";
import { extractBlueprint, compareBlueprint } from "../resume-blueprint-agent";
import type { ResumeBlueprint, BlueprintDiff } from "../resume-blueprint-agent";
import { extractTemplateBlueprint, validateTemplatePreserved } from "../resume-template-blueprint-agent";
import type { ResumeTemplateBlueprint } from "../resume-template-blueprint-agent";
import { runGuardianValidation, formatGuardianVerdict } from "../resume-guardian-agent";
import type { GuardianVerdict } from "../resume-guardian-agent";
import { createRetryEngine } from "../retry-engine";
import type { RetryEngine, RetryResult, RetryConfig } from "../retry-engine";
import type { ResumeData, ResumeTemplate } from "../types";
import type { OptimizationPolicy } from "../directive-policy";

// ============================================================================
// Test Fixtures
// ============================================================================

function makeTestResume(overrides?: Partial<ResumeData>): ResumeData {
  return {
    id: "res-test-1",
    name: "Jane Doe",
    headline: "Customer Service Professional",
    contact: {
      email: "jane@example.com",
      phone: "+97450123456",
      location: "Doha, Qatar",
    },
    summary:
      "Experienced customer service professional with over 10 years in the aviation industry, " +
      "demonstrating exceptional communication skills, conflict resolution abilities, and a strong " +
      "commitment to delivering world-class passenger experiences. Proven track record of managing " +
      "high-volume inquiries, resolving complex escalated complaints with outstanding satisfaction " +
      "rates, and mentoring new team members. Adept at using CRM systems, handling VIP services, " +
      "and maintaining composure under pressure in fast-paced airport and airline environments. " +
      "Passionate about continuous improvement and delivering measurable results that enhance " +
      "operational efficiency and elevate the overall customer journey from check-in to boarding.",
    experience: [
      {
        id: "exp-1",
        title: "Senior Customer Service Agent",
        company: "Qatar Airways",
        location: "Doha, Qatar",
        startDate: "2018-03",
        endDate: "Present",
        bullets: [
          "Managed customer inquiries for 500+ passengers daily across multiple touchpoints including phone, email, and in-person counters",
          "Resolved escalated complaints with 98% satisfaction rate, reducing repeat escalation cases by 40% year-over-year",
          "Trained 15 new hires on company procedures, CRM software, and customer service best practices",
          "Coordinated with ground staff and flight crews to ensure seamless handling of delayed and cancelled flights",
          "Implemented a new queue management system that reduced average wait times from 12 to 4 minutes",
          "Recognized as Employee of the Month three times for exceptional service and leadership",
          "Served as the primary point of contact for VIP passengers including government officials and corporate executives",
        ],
      },
      {
        id: "exp-2",
        title: "Customer Service Representative",
        company: "Hamad International Airport",
        location: "Doha, Qatar",
        startDate: "2015-01",
        endDate: "2018-02",
        bullets: [
          "Assisted passengers with check-in and boarding procedures for 200+ daily flights across international and domestic terminals",
          "Handled VIP passenger services including meet-and-greet, lounge access, and priority boarding coordination",
          "Resolved baggage-related issues and flight transfer queries with focus on minimizing passenger disruption",
          "Collaborated with security and customs teams to facilitate smooth passenger flow during peak travel seasons",
          "Maintained detailed records of passenger interactions and service requests in the airport CRM system",
          "Received commendation letters from senior management for handling emergency medical situations with professionalism",
        ],
      },
      {
        id: "exp-3",
        title: "Junior Customer Service Associate",
        company: "Doha Travel Solutions",
        location: "Doha, Qatar",
        startDate: "2013-06",
        endDate: "2014-12",
        bullets: [
          "Provided travel consultation services including flight bookings, itinerary planning, and visa assistance",
          "Maintained 95% customer satisfaction score on post-service surveys",
          "Processed refunds, exchanges, and cancellations in compliance with company policies and regulations",
          "Assisted senior agents with administrative tasks and documentation for corporate travel accounts",
        ],
      },
    ],
    education: [
      {
        id: "edu-1",
        institution: "University of Qatar",
        degree: "Bachelor of Business Administration",
        field: "Business",
        startDate: "2010-09",
        endDate: "2014-06",
        gpa: "3.5",
        highlights: [
          "Dean's List for academic excellence",
          "Completed capstone project on customer loyalty programs in the aviation sector",
        ],
      },
      {
        id: "edu-2",
        institution: "Doha International College",
        degree: "High School Diploma",
        field: "General Studies",
        startDate: "2008-09",
        endDate: "2010-06",
        gpa: "3.8",
      },
    ],
    skills: [
      { id: "sk-1", name: "Customer Service", level: "expert" },
      { id: "sk-2", name: "Conflict Resolution", level: "advanced" },
      { id: "sk-3", name: "CRM Systems (Salesforce)", level: "advanced" },
      { id: "sk-4", name: "Team Training & Mentoring", level: "intermediate" },
      { id: "sk-5", name: "Multilingual Communication", level: "advanced" },
    ],
    languages: [
      { id: "lang-1", name: "English", proficiency: "native" },
      { id: "lang-2", name: "Arabic", proficiency: "native" },
    ],
    projects: [],
    certifications: [
      { id: "cert-1", name: "Certified Customer Service Professional (CCSP)" },
      { id: "cert-2", name: "Advanced Conflict Resolution Training" },
    ],
    template: "infohas-pro",
    accentColor: "#1a73e8",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// 1. ResumeBlueprintAgent
// ============================================================================

describe("ResumeBlueprintAgent", () => {
  // ── extractBlueprint ──────────────────────────────────────────────────────

  it("extractBlueprint preserves all immutable entities (companies, dates, schools, languages)", () => {
    const resume = makeTestResume();
    const blueprint = extractBlueprint(resume);

    // Header
    expect(blueprint.header.name).toBe("Jane Doe");
    expect(blueprint.header.title).toBe("Customer Service Professional");
    expect(blueprint.header.email).toBe("jane@example.com");
    expect(blueprint.header.phone).toBe("+97450123456");
    expect(blueprint.header.location).toBe("Doha, Qatar");

    // Experience — companies, dates, roles
    expect(blueprint.experience).toHaveLength(3);
    expect(blueprint.experience[0].company).toBe("Qatar Airways");
    expect(blueprint.experience[0].role).toBe("Senior Customer Service Agent");
    expect(blueprint.experience[0].startDate).toBe("2018-03");
    expect(blueprint.experience[0].endDate).toBe("Present");
    expect(blueprint.experience[0].bullets).toHaveLength(7);
    expect(blueprint.experience[1].company).toBe("Hamad International Airport");
    expect(blueprint.experience[2].company).toBe("Doha Travel Solutions");

    // Education — institution, degree, field
    expect(blueprint.education).toHaveLength(2);
    expect(blueprint.education[0].institution).toBe("University of Qatar");
    expect(blueprint.education[0].degree).toBe("Bachelor of Business Administration");
    expect(blueprint.education[0].field).toBe("Business");

    // Skills
    expect(blueprint.skills).toHaveLength(5);
    expect(blueprint.skills[0].name).toBe("Customer Service");
    expect(blueprint.skills[1].name).toBe("Conflict Resolution");

    // Languages
    expect(blueprint.languages).toHaveLength(2);
    expect(blueprint.languages[0].language).toBe("English");
    expect(blueprint.languages[1].language).toBe("Arabic");

    // Summary
    expect(blueprint.summary).toContain("aviation industry");
  });

  it("extractBlueprint handles empty resume (no experience, education)", () => {
    const resume = makeTestResume({ experience: [], education: [] });
    const blueprint = extractBlueprint(resume);

    expect(blueprint.experience).toEqual([]);
    expect(blueprint.education).toEqual([]);
    // Header should still be populated
    expect(blueprint.header.name).toBe("Jane Doe");
    // Skills & languages should still work with empty arrays
    expect(blueprint.skills).toHaveLength(5);
    expect(blueprint.languages).toHaveLength(2);
  });

  // ── compareBlueprint ──────────────────────────────────────────────────────

  it("compareBlueprint detects hallucinated employer", () => {
    const resume = makeTestResume();
    const blueprint = extractBlueprint(resume);

    // Optimized adds a company NOT in the original
    const optimized = makeTestResume({
      experience: [
        ...resume.experience,
        {
          id: "exp-fake",
          title: "Fake Manager",
          company: "NonExistent Airlines Corp",
          location: "Dubai, UAE",
          startDate: "2020-01",
          endDate: "2023-06",
          bullets: ["This is a hallucinated entry"],
        },
      ],
    });

    const diff = compareBlueprint(blueprint, optimized);
    expect(diff.hasChanges).toBe(true);
    expect(diff.hallucinatedEmployers.length).toBeGreaterThan(0);
    expect(diff.hallucinatedEmployers.some((h) => h.name === "NonExistent Airlines Corp")).toBe(true);
  });

  it("compareBlueprint detects missing company", () => {
    const resume = makeTestResume();
    const blueprint = extractBlueprint(resume);

    // Optimized drops one company entirely
    const optimized = makeTestResume({
      experience: [resume.experience[0]], // only Qatar Airways, missing Hamad International Airport
    });

    const diff = compareBlueprint(blueprint, optimized);
    expect(diff.hasChanges).toBe(true);
    expect(diff.missingCompanies.length).toBeGreaterThan(0);
    expect(diff.missingCompanies.some((m) => m.name === "Hamad International Airport")).toBe(true);
  });

  it("compareBlueprint detects corrupted education (degree changed)", () => {
    const resume = makeTestResume();
    const blueprint = extractBlueprint(resume);

    // Optimized changes the degree
    const optimized = makeTestResume({
      education: [
        {
          ...resume.education[0],
          degree: "Bachelor of Arts in Business Studies", // AI hallucinated a different degree
        },
      ],
    });

    const diff = compareBlueprint(blueprint, optimized);
    expect(diff.hasChanges).toBe(true);
    expect(diff.corruptedEducation.length).toBeGreaterThan(0);
    expect(
      diff.corruptedEducation.some((c) => c.original === "Bachelor of Business Administration"),
    ).toBe(true);
  });
});

// ============================================================================
// 2. ResumeTemplateBlueprintAgent
// ============================================================================

describe("ResumeTemplateBlueprintAgent", () => {
  // ── extractTemplateBlueprint ──────────────────────────────────────────────

  it("extractTemplateBlueprint captures layout from template", () => {
    const resume = makeTestResume({ template: "infohas-pro" });
    const blueprint = extractTemplateBlueprint(resume);

    // Section order for infohas-pro
    expect(blueprint.sectionOrder).toEqual([
      "headline",
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
      "projects",
    ]);

    // Layout type
    expect(blueprint.layoutType).toBe("two-column");

    // Education format
    expect(blueprint.educationFormat.diplomaFirst).toBe(true);
    expect(blueprint.educationFormat.separator).toBe(" — ");

    // Experience format
    expect(blueprint.experienceFormat.roleFirst).toBe(true);
    expect(blueprint.experienceFormat.separator).toBe(" — ");

    // Accent color from resume
    expect(blueprint.accentColor).toBe("#1a73e8");

    // Margins
    expect(blueprint.margins.top).toBe(6.35);
    expect(blueprint.margins.right).toBe(8.89);
    expect(blueprint.margins.bottom).toBe(6.35);
    expect(blueprint.margins.left).toBe(8.89);
  });

  it("extractTemplateBlueprint handles unknown template with defaults", () => {
    const resume = makeTestResume({
      template: "nonexistent-template" as ResumeTemplate,
    });
    const blueprint = extractTemplateBlueprint(resume);

    // Falls back to DEFAULT_TEMPLATE_META which has a standard section order
    expect(blueprint.sectionOrder).toEqual([
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
      "certifications",
    ]);
    expect(blueprint.layoutType).toBe("single-column");
    // accentColor should still come from the resume
    expect(blueprint.accentColor).toBe("#1a73e8");
  });

  // ── validateTemplatePreserved ─────────────────────────────────────────────

  it("validateTemplatePreserved returns true on identical resume", () => {
    const resume = makeTestResume();
    const blueprint = extractTemplateBlueprint(resume);

    const result = validateTemplatePreserved(blueprint, resume);
    expect(result).toBe(true);
  });

  it("validateTemplatePreserved detects section order change", () => {
    const resume = makeTestResume({ template: "infohas-pro" });
    const blueprint = extractTemplateBlueprint(resume);

    // Create an optimized resume with a different template that changes section order
    const optimized = makeTestResume({ template: "academic" });
    // academic has different section order (education before experience)
    const result = validateTemplatePreserved(blueprint, optimized);
    expect(result).toBe(false);
  });
});

// ============================================================================
// 3. ResumeGuardianAgent
// ============================================================================

describe("ResumeGuardianAgent", () => {
  // ── runGuardianValidation ─────────────────────────────────────────────────

  it("runGuardianValidation passes on clean resume (same as source)", async () => {
    const source = makeTestResume();
    const optimized = makeTestResume();

    const verdict = await runGuardianValidation(optimized, source);
    expect(verdict.passed).toBe(true);
    expect(verdict.status).toBe("PASS");
    expect(verdict.score).toBe(100);
  });

  it("runGuardianValidation BLOCKS on missing company", async () => {
    const source = makeTestResume();
    // Replace a company name with something completely different
    const optimized = makeTestResume({
      experience: source.experience.map((e, i) =>
        i === 0 ? { ...e, company: "Unknown Airline" } : e,
      ),
    });

    const verdict = await runGuardianValidation(optimized, source);
    expect(verdict.status).toBe("BLOCKED");
    expect(verdict.passed).toBe(false);
    // Should have at least one critical failure about companies
    const companyCheck = verdict.checks.find((c) => c.name === "companies_preserved");
    expect(companyCheck).toBeDefined();
    expect(companyCheck!.passed).toBe(false);
    expect(companyCheck!.critical).toBe(true);
  });

  it("runGuardianValidation BLOCKS on missing school", async () => {
    const source = makeTestResume();
    // Remove education entirely
    const optimized = makeTestResume({ education: [] });

    const verdict = await runGuardianValidation(optimized, source);
    expect(verdict.status).toBe("BLOCKED");
    expect(verdict.passed).toBe(false);
    const schoolCheck = verdict.checks.find((c) => c.name === "schools_preserved");
    expect(schoolCheck).toBeDefined();
    expect(schoolCheck!.passed).toBe(false);
    expect(schoolCheck!.critical).toBe(true);
  });

  it("runGuardianValidation BLOCKS on missing language", async () => {
    const source = makeTestResume();
    // Remove Arabic language
    const optimized = makeTestResume({
      languages: [{ id: "lang-1", name: "English", proficiency: "native" }],
    });

    const verdict = await runGuardianValidation(optimized, source);
    expect(verdict.status).toBe("BLOCKED");
    expect(verdict.passed).toBe(false);
    const langCheck = verdict.checks.find((c) => c.name === "languages_preserved");
    expect(langCheck).toBeDefined();
    expect(langCheck!.passed).toBe(false);
    expect(langCheck!.critical).toBe(true);
  });

  it("runGuardianValidation returns REQUIRES_MANUAL_REVIEW on minor skill changes", async () => {
    const source = makeTestResume();
    // Remove one skill (non-critical change)
    const optimized = makeTestResume({
      skills: [{ id: "sk-1", name: "Customer Service", level: "expert" }],
    });

    const verdict = await runGuardianValidation(optimized, source);
    // Skills check is non-critical, so no critical failures → REQUIRES_MANUAL_REVIEW
    expect(verdict.status).toBe("REQUIRES_MANUAL_REVIEW");
    expect(verdict.passed).toBe(true);
    const skillCheck = verdict.checks.find((c) => c.name === "skills_preserved");
    expect(skillCheck).toBeDefined();
    expect(skillCheck!.passed).toBe(false);
    expect(skillCheck!.critical).toBe(false);
  });

  // ── formatGuardianVerdict ─────────────────────────────────────────────────

  it("formatGuardianVerdict produces readable output", async () => {
    const source = makeTestResume();
    const optimized = makeTestResume();
    const verdict = await runGuardianValidation(optimized, source);

    const formatted = formatGuardianVerdict(verdict);
    expect(formatted).toContain("GUARDIAN VERDICT");
    expect(formatted).toContain("PASS");
    expect(formatted).toContain("100");
    expect(formatted).toContain("✓");
    expect(formatted).toContain("Ready for export");
  });

  // ── Policy parameter ──────────────────────────────────────────────────────

  it("runGuardianValidation accepts optimization policy parameter", async () => {
    const source = makeTestResume();
    const optimized = makeTestResume();

    const policy: OptimizationPolicy = {
      version: "1.0",
      pageLimit: "one-page",
      layoutTemplate: "preserve-original",
      fontSize: 11,
      lineHeight: 1.15,
      summaryLength: "comprehensive",
      summaryMinWords: 40,
      summaryMaxWords: 200,
      optimizationLevel: "balanced",
      keywordStrategy: "balanced",
      skillsStrategy: "real-skills-only",
      experienceStrategy: "bullet-only",
      preserveCompanies: true,
      preserveDates: true,
      preserveEducation: true,
      preserveLanguages: true,
      preserveCertifications: true,
      preserveContact: true,
      forbidKeywordDumping: false,
      forbidTargetedKeywordsSection: false,
      forbidFakeSkills: false,
      forbidSectionReorder: true,
      forbidSectionAddRemove: true,
      hallucinationPolicy: "lenient",
      supervisorStrictMode: true,
      supervisorEnableRetries: true,
      supervisorEnableProviderSwitch: true,
      formattingRules: {
        experienceHeader: "<Role> | <Company> | <Date>",
        educationHeader: "<Diploma> | <School> | <Date>",
        bulletPrefix: "• ",
        dateFormat: "Mon YYYY",
        emptyCompanyFormat: "omit-line",
      },
      atsStrategy: "balanced",
      maxTotalChars: 4500,
      minTotalChars: 2000,
      sectionOwnership: { summary: "summary-agent", experience: "experience-agent" },
    };

    const verdict = await runGuardianValidation(optimized, source, policy);
    // The directive_compliance check should have run (not skipped)
    const directiveCheck = verdict.checks.find((c) => c.name === "directive_compliance");
    expect(directiveCheck).toBeDefined();
    expect(directiveCheck!.detail).not.toContain("skipping");
    // The policy was processed — directive compliance evaluated some checks
    expect(directiveCheck!.passed).toBe(true);
  });
});

// ============================================================================
// 4. RetryEngine
// ============================================================================

describe("RetryEngine", () => {
  // ── Factory ───────────────────────────────────────────────────────────────

  it("createRetryEngine returns engine with default config", () => {
    const engine = createRetryEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.run).toBe("function");
    expect(typeof engine.reset).toBe("function");
    expect(typeof engine.getState).toBe("function");
    expect(typeof engine.getAllStates).toBe("function");
  });

  // ── run succeeds on first attempt ─────────────────────────────────────────

  it("run succeeds on first attempt", async () => {
    const engine = createRetryEngine({ maxRetries: 3, baseDelayMs: 1 });
    const result = await engine.run("quick-agent", async () => "hello world");
    expect(result.success).toBe(true);
    expect(result.value).toBe("hello world");
    expect(result.attempt).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.exhausted).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.errors).toEqual([]);
  });

  // ── run retries on failure ────────────────────────────────────────────────

  it("run retries on failure (fails twice then succeeds)", async () => {
    const engine = createRetryEngine({ maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 });
    let callCount = 0;

    const result = await engine.run("retry-agent", async () => {
      callCount++;
      if (callCount < 3) throw new Error(`Attempt ${callCount} failed`);
      return "success after retries";
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe("success after retries");
    expect(result.attempt).toBe(3);
    expect(result.attempts).toBe(3);
    expect(result.exhausted).toBe(false);
    expect(callCount).toBe(3);
  });

  // ── run exhausts max retries ──────────────────────────────────────────────

  it("run exhausts max retries and returns exhausted=true", async () => {
    const engine = createRetryEngine({ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 });

    const result = await engine.run("exhaust-agent", async () => {
      throw new Error("Always fails");
    });

    expect(result.success).toBe(false);
    expect(result.value).toBeNull();
    expect(result.exhausted).toBe(true);
    expect(result.attempt).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.fallbackUsed).toBe(false);
  });

  // ── run uses fallback value when exhausted ────────────────────────────────

  it("run uses fallback value when provided and exhausted", async () => {
    const engine = createRetryEngine({ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 });
    const fallback = { data: "fallback-resume-data" };

    const result = await engine.run(
      "fallback-agent",
      async () => {
        throw new Error("Always fails");
      },
      fallback,
    );

    expect(result.success).toBe(false);
    expect(result.value).toEqual(fallback);
    expect(result.exhausted).toBe(true);
    expect(result.fallbackUsed).toBe(true);
    expect(result.errors).toHaveLength(2);
  });
});
