// ============================================================================
// Unit tests for the new interview AI helpers introduced by the Sonru
// Video & Voice Screen Simulator integration:
//   • buildInterviewMatchScore
//   • generateHiringRecommendation
//   • normalizeSubType (indirectly, via generateInterviewQuestions mocks)
// ----------------------------------------------------------------------------
// These tests do NOT make real AI calls — `recordAI` is mocked so the helpers
// run deterministically. Mirrors the pattern in `src/lib/interview/adaptive.test.ts`.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Flight Recorder so no provider call is attempted.
vi.mock("@/lib/ai/flight-recorder", () => ({
  recordAI: vi.fn(async () => ({
    text: JSON.stringify({
      narrative: "Mock narrative. The candidate performed well.",
    }),
    provider: "mock",
    latencyMs: 1,
    tokensEstimate: 10,
  })),
  setFlightScope: vi.fn(),
  setFlightRecordSink: vi.fn(),
}));

import { recordAI } from "@/lib/ai/flight-recorder";
import {
  buildInterviewMatchScore,
  generateHiringRecommendation,
  type InterviewMatchScore,
} from "@/lib/interview/ai";
import type { ResumeData, JobDescription, ATSReport, ResumeReviewReport } from "@/lib/types";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "r1",
    name: "Jane Doe",
    headline: "Senior Cabin Crew",
    contact: { email: "jane@example.com", phone: "+1 555 0100" } as any,
    summary: "Experienced cabin crew member.",
    experience: [
      {
        id: "e1",
        company: "Emirates",
        title: "Cabin Crew",
        location: "Dubai",
        startDate: "2019-01",
        endDate: "Present",
        bullets: ["Delivered service", "Handled emergencies"],
      },
      {
        id: "e2",
        company: "Qatar Airways",
        title: "Junior Cabin Crew",
        location: "Doha",
        startDate: "2016-03",
        endDate: "2018-12",
        bullets: ["Assisted senior crew"],
      },
    ],
    education: [
      { id: "ed1", degree: "Bachelor of Arts", institution: "Univ X", startDate: "2012", endDate: "2015" } as any,
    ],
    skills: [
      { id: "s1", name: "Customer Service", category: "soft" } as any,
      { id: "s2", name: "Safety Procedures", category: "hard" } as any,
      { id: "s3", name: "First Aid", category: "hard" } as any,
    ],
    projects: [],
    certifications: [{ id: "c1", name: "Cabin Crew Attestation", issuer: "EASA", date: "2016" } as any],
    languages: [{ id: "l1", name: "English" } as any, { id: "l2", name: "Arabic" } as any],
    template: "modern" as any,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeJd(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    id: "jd1",
    title: "Cabin Crew Member",
    company: "Emirates",
    location: "Dubai",
    employmentType: "Full-time",
    salary: "AED 9,500/mo",
    responsibilities: ["In-flight service", "Safety demos"],
    requiredSkills: ["Customer Service", "Safety Procedures", "CPR"],
    preferredSkills: ["Multilingual"],
    technologies: [],
    experienceYears: "2+ years",
    education: "High school diploma",
    keywords: ["cabin crew", "emirates", "safety", "service"],
    rawText: "Emirates cabin crew member with 2+ years experience...",
    source: "text",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAtsReport(overrides: Partial<ATSReport> = {}): ATSReport {
  return {
    id: "ats1",
    resumeId: "r1",
    scores: { ats: 80, formatting: 90, keywords: 70, content: 85, grammar: 95, completeness: 80 },
    recommendations: [],
    missingKeywords: ["CPR", "Multilingual"],
    matchedKeywords: ["cabin crew", "emirates", "safety", "service"],
    weakSections: [],
    jdMatchPercent: 80,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeReviewReport(overrides: Partial<ResumeReviewReport> = {}): ResumeReviewReport {
  return {
    id: "rev1",
    resumeId: "r1",
    jdId: "jd1",
    createdAt: "2024-01-01T00:00:00.000Z",
    jobMatch: {
      overallMatch: 78,
      atsMatch: 80,
      experienceMatch: 85,
      skillMatch: 70,
      educationMatch: 90,
      industryMatch: 95,
      missingSkills: ["CPR"],
      missingKeywords: ["CPR"],
      missingCertifications: ["CPR Certification"],
    },
  } as ResumeReviewReport & { jobMatch: any };
}

// ----------------------------------------------------------------------------
// buildInterviewMatchScore
// ----------------------------------------------------------------------------

describe("buildInterviewMatchScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 100 across the board when no JD is provided", () => {
    const resume = makeResume();
    const score = buildInterviewMatchScore(resume, null, null, null);
    expect(score.overall).toBe(100);
    expect(score.skillMatch).toBe(100);
    expect(score.keywordMatch).toBe(100);
    expect(score.experienceMatch).toBe(100);
    expect(score.educationMatch).toBe(100);
    expect(score.industryMatch).toBe(100);
    expect(score.industry).toBe("Generic");
    expect(score.seniority).not.toBe("unknown");
  });

  it("computes skillMatch as matched/required ratio", () => {
    const resume = makeResume();
    const jd = makeJd({ requiredSkills: ["Customer Service", "Safety Procedures", "CPR", "Multilingual", "Leadership"] });
    const score = buildInterviewMatchScore(resume, jd, null, null);
    // 2 of 5 required skills are present → 40%
    expect(score.skillMatch).toBe(40);
    expect(score.matchedSkills).toEqual(expect.arrayContaining(["Customer Service", "Safety Procedures"]));
    expect(score.missingSkills).toEqual(expect.arrayContaining(["Cpr", "Multilingual", "Leadership"]));
  });

  it("uses ATS report keyword data when available", () => {
    const resume = makeResume();
    const jd = makeJd();
    const ats = makeAtsReport({
      missingKeywords: ["CPR", "Multilingual"],
      matchedKeywords: ["cabin crew", "emirates", "safety", "service"],
    });
    const score = buildInterviewMatchScore(resume, jd, ats, null);
    // 4 matched out of 6 total → 67%
    expect(score.keywordMatch).toBe(67);
  });

  it("falls back to JD keyword overlap when no ATS report", () => {
    const resume = makeResume({
      skills: [
        { id: "s1", name: "cabin crew" } as any,
        { id: "s2", name: "emirates" } as any,
      ],
    });
    const jd = makeJd({ keywords: ["cabin crew", "emirates", "safety", "service"] });
    const score = buildInterviewMatchScore(resume, jd, null, null);
    // 2 of 4 keywords match → 50%
    expect(score.keywordMatch).toBe(50);
  });

  it("estimates experience years from resume dates and compares to JD requirement", () => {
    const resume = makeResume();
    const jd = makeJd({ experienceYears: "5+ years" });
    const score = buildInterviewMatchScore(resume, jd, null, null);
    // Candidate has ~6 years (2016-2022), required 5 → 100%
    expect(score.experienceMatch).toBeLessThanOrEqual(100);
    expect(score.experienceMatch).toBeGreaterThan(50);
  });

  it("prefers reviewReport.jobMatch.overallMatch when available", () => {
    const resume = makeResume();
    const jd = makeJd();
    const rev = makeReviewReport();
    const score = buildInterviewMatchScore(resume, jd, null, rev);
    expect(score.overall).toBe(78);
  });

  it("detects seniority from headline", () => {
    const senior = makeResume({ headline: "Senior Cabin Crew" });
    const score = buildInterviewMatchScore(senior, null, null, null);
    expect(score.seniority).toBe("senior");
  });

  it("detects seniority from leadership title", () => {
    const lead = makeResume({ headline: "Director of Cabin Operations" });
    const score = buildInterviewMatchScore(lead, null, null, null);
    expect(score.seniority).toBe("lead");
  });

  it("surfaces missing certifications from reviewReport.jobMatch", () => {
    const resume = makeResume({ certifications: [{ id: "c1", name: "Cabin Crew Attestation" } as any] });
    const jd = makeJd();
    const rev = makeReviewReport();
    const score = buildInterviewMatchScore(resume, jd, null, rev);
    // The helper lower-cases the certification names for matching; verify the
    // value is preserved (case-insensitive comparison).
    expect(score.missingCertifications).toHaveLength(1);
    expect(score.missingCertifications[0].toLowerCase()).toBe("cpr certification");
  });
});

// ----------------------------------------------------------------------------
// generateHiringRecommendation
// ----------------------------------------------------------------------------

describe("generateHiringRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a zero-score report when no evaluations are provided", async () => {
    const report = await generateHiringRecommendation({
      evaluations: [],
      totalCount: 5,
      skippedCount: 5,
      useAI: false,
    });
    expect(report.overallScore).toBe(0);
    expect(report.answeredCount).toBe(0);
    expect(report.skippedCount).toBe(5);
    expect(report.totalCount).toBe(5);
    expect(report.verdict).toBe("strong-no");
  });

  it("aggregates per-category averages correctly", async () => {
    const report = await generateHiringRecommendation({
      evaluations: [
        { questionId: "q1", category: "technical", overallScore: 80, strengths: [], weaknesses: [], suggestions: [] },
        { questionId: "q2", category: "technical", overallScore: 70, strengths: [], weaknesses: [], suggestions: [] },
        { questionId: "q3", category: "behavioral", overallScore: 60, strengths: [], weaknesses: [], suggestions: [] },
      ],
      totalCount: 3,
      useAI: false,
    });
    expect(report.categoryAverages.technical).toBe(75);
    expect(report.categoryAverages.behavioral).toBe(60);
    expect(report.overallScore).toBe(Math.round((80 + 70 + 60) / 3));
  });

  it("returns 'strong-yes' verdict when score and ATS readiness are high", async () => {
    const report = await generateHiringRecommendation({
      evaluations: [
        { questionId: "q1", category: "technical", overallScore: 90, strengths: [], weaknesses: [], suggestions: [] },
        { questionId: "q2", category: "behavioral", overallScore: 92, strengths: [], weaknesses: [], suggestions: [] },
      ],
      totalCount: 2,
      matchScore: {
        overall: 90,
        skillMatch: 90,
        keywordMatch: 90,
        experienceMatch: 90,
        educationMatch: 90,
        industryMatch: 90,
        matchedSkills: [],
        missingSkills: [],
        missingKeywords: [],
        missingCertifications: [],
        seniority: "senior",
        industry: "Aviation",
        education: "BA",
        certifications: [],
      },
      useAI: false,
    });
    // overall = 91; atsReadiness = 91*0.5 + 90*0.3 + 90*0.2 = 90.5 ≈ 91
    // blended = 91*0.7 + 91*0.3 = 91 ≥ 85 → strong-yes
    expect(report.verdict).toBe("strong-yes");
    expect(report.atsReadiness).toBeGreaterThanOrEqual(85);
  });

  it("returns 'no' verdict when score is below 45", async () => {
    const report = await generateHiringRecommendation({
      evaluations: [
        { questionId: "q1", category: "technical", overallScore: 30, strengths: [], weaknesses: [], suggestions: [] },
      ],
      totalCount: 1,
      useAI: false,
    });
    // overall = 30; atsReadiness = 30; blended = 30 ≥ 45? No → 'no' or 'strong-no'
    expect(["no", "strong-no"]).toContain(report.verdict);
  });

  it("calls the AI exactly once when useAI is true", async () => {
    const mocked = recordAI as unknown as ReturnType<typeof vi.fn>;
    await generateHiringRecommendation({
      evaluations: [
        { questionId: "q1", category: "technical", overallScore: 80, strengths: ["S1"], weaknesses: ["W1"], suggestions: ["A1"] },
      ],
      totalCount: 1,
      useAI: true,
    });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("falls back to heuristic narrative when useAI is false", async () => {
    const report = await generateHiringRecommendation({
      evaluations: [
        { questionId: "q1", category: "technical", overallScore: 80, strengths: ["Good"], weaknesses: ["Slow"], suggestions: ["Speed up"] },
      ],
      totalCount: 1,
      useAI: false,
    });
    expect(report.narrative).toContain("80");
    expect(report.narrative).toContain("Hiring recommendation");
    expect(report.narrative).toContain("Good");
    expect(report.narrative).toContain("Slow");
  });

  it("top strengths/weaknesses are frequency-weighted across evaluations", async () => {
    const report = await generateHiringRecommendation({
      evaluations: [
        { questionId: "q1", category: "technical", overallScore: 80, strengths: ["Clear communication", "Deep knowledge"], weaknesses: ["Slow start"], suggestions: [] },
        { questionId: "q2", category: "behavioral", overallScore: 70, strengths: ["Clear communication", "Teamwork"], weaknesses: ["Slow start", "Vague result"], suggestions: [] },
        { questionId: "q3", category: "hr", overallScore: 90, strengths: ["Clear communication"], weaknesses: [], suggestions: [] },
      ],
      totalCount: 3,
      useAI: false,
    });
    // "Clear communication" appears 3x → top strength
    expect(report.topStrengths[0]).toBe("Clear communication");
    // "Slow start" appears 2x → top weakness
    expect(report.topWeaknesses[0]).toBe("Slow start");
  });
});
