import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLiveJD } from "./jd-fetch-engine";
import { checkEligibility } from "./eligibility-checker";
import { runGuardianStrict } from "./guardian-strict";
import { prepareLiveJD, verifyOptimizationHonesty, checkCandidateEligibility } from "./jd-fetch-integration";
import type { ResumeData, JobDescription } from "./types";

// ============================================================================
// JD Fetch Engine Tests
// ============================================================================

describe("jd-fetch-engine", () => {
  it("returns input JD unchanged when no company/role is provided", async () => {
    const jd: JobDescription = {
      id: "jd_empty",
      title: "",
      company: "",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const result = await fetchLiveJD(jd);
    expect(result.ok).toBe(false);
    expect(result.jd).toBe(jd);
    expect(result.source).toBe("input-only");
  });

  it("returns input as-is when JD already has complete data (url + rawText)", async () => {
    const jd: JobDescription = {
      id: "jd_complete",
      title: "Cabin Crew",
      company: "Emirates",
      url: "https://emiratesgroupcareers.com/job/123",
      rawText: "We are looking for Cabin Crew members... ".repeat(10),
      responsibilities: ["Serve passengers"],
      requiredSkills: ["Customer service"],
      preferredSkills: [],
      technologies: [],
      keywords: ["cabin crew", "emirates"],
      createdAt: new Date().toISOString(),
    };

    const result = await fetchLiveJD(jd);
    expect(result.ok).toBe(true);
    expect(result.source).toBe("input-only");
    expect(result.errors).toHaveLength(0);
  });

  it("handles partial JD gracefully without throwing", async () => {
    const jd: JobDescription = {
      id: "jd_partial",
      title: "Cabin Crew",
      company: "NonExistentAirlines",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    // Should not throw — returns gracefully
    const result = await fetchLiveJD(jd);
    expect(result).toBeDefined();
    expect(result.jd).toBe(jd);
  });
});

// ============================================================================
// Eligibility Checker Tests
// ============================================================================

describe("eligibility-checker", () => {
  const sampleResume: ResumeData = {
    id: "resume_test",
    name: "Zakariya Nadif",
    contact: { email: "zakariya@example.com", phone: "+212 694-122414" },
    summary: "Experienced customer service professional transitioning to cabin crew",
    headline: "Cabin Crew Applicant",
    experience: [
      {
        id: "exp1",
        company: "BIOLOGIA LABORATORY",
        title: "Administrative Agent",
        startDate: "2023-01",
        endDate: "Present",
        bullets: ["Managed patient scheduling"],
      },
    ],
    education: [
      {
        id: "edu1",
        institution: "INFOHAS",
        degree: "Aviation Training",
        field: "Aviation",
        startDate: "2024-01",
        endDate: "2025-06",
      },
    ],
    skills: [{ id: "s1", name: "Customer Service" }, { id: "s2", name: "Safety Compliance" }, { id: "s3", name: "Communication" }],
    languages: [{ id: "l1", name: "Arabic", proficiency: "native" }, { id: "l2", name: "French", proficiency: "fluent" }, { id: "l3", name: "English", proficiency: "fluent" }],
    projects: [],
    certifications: [],
    template: "ats-professional",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };

  it("returns eligible=true when no requirements are in JD", () => {
    const jd: JobDescription = {
      id: "jd_simple",
      title: "Cabin Crew",
      responsibilities: ["Serve passengers"],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const report = checkEligibility(sampleResume, jd);
    expect(report.eligible).toBe(true);
    expect(report.blockers).toHaveLength(0);
  });

  it("flags height requirement as gap when candidate has no height data", () => {
    const jd: JobDescription = {
      id: "jd_height",
      title: "Cabin Crew",
      rawText: "Minimum height requirement: 212 cm arm reach. Must be able to swim.",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const report = checkEligibility(sampleResume, jd);
    // Height is a gap (not blocker) because candidate has no height data
    const heightGap = report.gaps.find((g) => g.requirement.includes("Height"));
    expect(heightGap).toBeDefined();
    expect(heightGap!.severity).toBe("gap");
  });

  it("detects swimming as a gap when not in resume", () => {
    const jd: JobDescription = {
      id: "jd_swim",
      title: "Cabin Crew",
      rawText: "Must be able to swim 50 meters as part of safety training.",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const report = checkEligibility(sampleResume, jd);
    const swimGap = report.gaps.find((g) => g.requirement.includes("Swimming") || g.detail.includes("swim"));
    expect(swimGap).toBeDefined();
    expect(swimGap!.severity).toBe("gap");
  });

  it("marks language requirements as met when candidate has them", () => {
    const jd: JobDescription = {
      id: "jd_lang",
      title: "Cabin Crew",
      rawText: "English and Arabic language skills required. French is an asset.",
      responsibilities: [],
      requiredSkills: ["English communication", "Arabic"],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const report = checkEligibility(sampleResume, jd);
    // Candidate has Arabic, French, English
    const englishMet = report.met.find((g) => g.detail.toLowerCase().includes("english"));
    const arabicMet = report.met.find((g) => g.detail.toLowerCase().includes("arabic"));
    expect(englishMet).toBeDefined();
    expect(englishMet!.severity).toBe("met");
    expect(arabicMet).toBeDefined();
  });

  it("reports gaps for languages candidate doesn't have", () => {
    const jd: JobDescription = {
      id: "jd_lang_gap",
      title: "Cabin Crew",
      rawText: "Mandarin Chinese language skills required.",
      responsibilities: [],
      requiredSkills: ["Mandarin"],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const report = checkEligibility(sampleResume, jd);
    const mandarinGap = report.gaps.find((g) => g.detail.toLowerCase().includes("mandarin"));
    expect(mandarinGap).toBeDefined();
    expect(mandarinGap!.severity).toBe("gap");
  });

  it("extracts requirements from JD text", () => {
    const jd: JobDescription = {
      id: "jd_extract",
      title: "Cabin Crew",
      rawText: "Minimum height requirement: 212 cm. Must be 21 years or older. Must be able to swim. Previous experience of 1 year in customer service preferred.",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const report = checkEligibility(sampleResume, jd);
    expect(report.extractedRequirements.length).toBeGreaterThanOrEqual(2);
    const heightReq = report.extractedRequirements.find((r) => r.category === "height");
    expect(heightReq).toBeDefined();
    expect(heightReq!.value).toBe(212);
    expect(heightReq!.unit).toBe("cm");
  });
});

// ============================================================================
// Guardian Strict Tests
// ============================================================================

describe("guardian-strict", () => {
  const sourceResume: ResumeData = {
    id: "source",
    name: "Test User",
    contact: { email: "test@example.com" },
    summary: "Customer service professional",
    headline: "Professional",
    experience: [
      {
        id: "exp1",
        company: "BIOLOGIA LABORATORY",
        title: "Administrative Agent",
        startDate: "2023-01",
        endDate: "Present",
        bullets: ["Managed patient scheduling for daily appointments"],
      },
    ],
    skills: [{ id: "s1", name: "Customer Service" }, { id: "s2", name: "Communication" }],
    languages: [{ id: "l1", name: "English", proficiency: "fluent" }, { id: "l2", name: "French", proficiency: "fluent" }],
    projects: [],
    certifications: [],
    education: [],
    template: "ats-professional",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };

  it("returns CLEAN when optimized resume adds no untraceable metrics", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      summary: "Dedicated customer service professional transitioning to cabin crew",
      skills: [
        ...sourceResume.skills,
        { id: "s3", name: "Team Collaboration" },
      ],
      languages: [
        ...sourceResume.languages,
        { id: "l3", name: "Arabic", proficiency: "native" },
      ],
    };

    const report = runGuardianStrict(sourceResume, optimized);
    expect(report.verdict).toBe("CLEAN");
    expect(report.totalViolations).toBe(0);
  });

  it("flags untraceable percentages as violations", () => {
    const fabricated: ResumeData = {
      ...sourceResume,
      summary: "Improved satisfaction by 40% and reduced costs by 25%",
      experience: [
        {
          ...sourceResume.experience[0],
          bullets: [
            "Managed patient scheduling",
            "Improved efficiency by 50%",
          ],
        },
      ],
    };

    const report = runGuardianStrict(sourceResume, fabricated);
    expect(report.verdict).toBe("VIOLATION");
    expect(report.totalViolations).toBeGreaterThanOrEqual(2);
    const pctViolations = report.violations.filter(
      (v) => v.type === "untraceable_percentage",
    );
    expect(pctViolations.length).toBeGreaterThanOrEqual(2);
  });

  it("flags untraceable awards as violations", () => {
    const fabricated: ResumeData = {
      ...sourceResume,
      summary: "Awarded Employee of the Year two years running",
      experience: [
        {
          ...sourceResume.experience[0],
          bullets: ["Managed patient scheduling"],
        },
      ],
    };

    const report = runGuardianStrict(sourceResume, fabricated);
    expect(report.verdict).toBe("VIOLATION");
    const awardViolations = report.violations.filter(
      (v) => v.type === "untraceable_award",
    );
    expect(awardViolations.length).toBeGreaterThanOrEqual(1);
  });

  it("flags untraceable certifications as violations", () => {
    const fabricated: ResumeData = {
      ...sourceResume,
      summary: "Certified Safety Professional with license to operate",
    };

    const report = runGuardianStrict(sourceResume, fabricated);
    expect(report.verdict).toBe("VIOLATION");
    const certViolations = report.violations.filter(
      (v) => v.type === "untraceable_certification",
    );
    expect(certViolations.length).toBeGreaterThanOrEqual(1);
  });

  it("passes when source already contains the metrics used", () => {
    const source: ResumeData = {
      id: "src",
      name: "Test",
      contact: { email: "test@test.com" },
      summary: "Managed 50+ clients. Awarded Employee of the Month.",
      headline: "Manager",
      experience: [
        {
          id: "exp1",
          company: "Company",
          title: "Manager",
          startDate: "2020-01",
          endDate: "Present",
          bullets: ["Managed 50+ clients", "Awarded Employee of the Month"],
        },
      ],
      skills: [],
      languages: [],
      projects: [],
      certifications: [],
      education: [],
      template: "ats-professional",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    // Optimized: rephrases the same facts without adding new metrics
    const optimized: ResumeData = {
      ...source,
      summary: "Managed a portfolio of 50+ clients. Recognized as Employee of the Month.",
      experience: [
        {
          ...source.experience[0],
          bullets: [
            "Managed 50+ client portfolio",
            "Recognized as Employee of the Month for outstanding service",
          ],
        },
      ],
    };

    const report = runGuardianStrict(source, optimized);
    // "Employee of the Month" and "50+" are in source — rephrasing is allowed
    expect(report.verdict).toBe("CLEAN");
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("jd-fetch-integration", () => {
  it("prepareLiveJD returns gracefully for empty JD", async () => {
    const jd: JobDescription = {
      id: "jd_empty",
      title: "",
      company: "",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const result = await prepareLiveJD(jd);
    expect(result.liveFetchAttempted).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.jd).toBe(jd);
  });

  it("verifyOptimizationHonesty passes for identical source data", () => {
    const resume: ResumeData = {
      id: "test",
      name: "Test",
      contact: { email: "test@test.com" },
      summary: "Professional summary",
      headline: "",
      experience: [],
      skills: [],
      languages: [],
      projects: [],
      certifications: [],
      education: [],
      template: "ats-professional",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const result = verifyOptimizationHonesty(resume, resume);
    expect(result.passed).toBe(true);
    expect(result.guardianStrict.verdict).toBe("CLEAN");
  });

  it("checkCandidateEligibility passes for empty JD", () => {
    const resume: ResumeData = {
      id: "test",
      name: "Test",
      contact: { email: "test@test.com" },
      summary: "",
      headline: "",
      experience: [],
      skills: [],
      languages: [],
      projects: [],
      certifications: [],
      education: [],
      template: "ats-professional",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const jd: JobDescription = {
      id: "jd_empty",
      title: "",
      company: "",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };
    const report = checkCandidateEligibility(resume, jd);
    expect(report.eligible).toBe(true);
    expect(report.blockers).toHaveLength(0);
  });
});
