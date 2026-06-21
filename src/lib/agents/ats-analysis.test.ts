import { describe, it, expect } from "vitest";
import { analyzeATS, scoreSemanticSimilarity, scoreReadability } from "./ats-analysis";
import type { ResumeData, JobDescription } from "../types";

// === Test fixtures ===

function makeResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "r1",
    name: "Test User",
    headline: "Software Engineer",
    contact: { email: "test@example.com", phone: "+1-555-0100", location: "San Francisco, CA" },
    summary: "Senior software engineer with 8+ years building scalable web applications.",
    experience: [
      {
        id: "e1",
        title: "Senior Engineer",
        company: "Tech Corp",
        location: "SF",
        startDate: "2020-01",
        endDate: "Present",
        bullets: [
          "Led migration to microservices, reducing deployment time by 65%",
          "Built analytics dashboard processing 2M events daily",
          "Mentored 5 junior engineers with 3 promotions",
        ],
      },
    ],
    education: [{ id: "ed1", institution: "UC Berkeley", degree: "BS", field: "CS", startDate: "2012", endDate: "2016" }],
    skills: [
      { id: "s1", name: "React", category: "Frontend" },
      { id: "s2", name: "Node.js", category: "Backend" },
      { id: "s3", name: "AWS", category: "Cloud" },
    ],
    projects: [],
    certifications: [],
    languages: [{ id: "l1", name: "English", proficiency: "native" }],
    achievements: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    source: "upload",
    ...overrides,
  };
}

function makeJD(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    id: "jd1",
    title: "Senior Software Engineer",
    company: "Tech Corp",
    location: "San Francisco, CA",
    keywords: ["react", "node.js", "aws", "microservices", "typescript"],
    requiredSkills: ["React", "Node.js"],
    preferredSkills: ["AWS"],
    technologies: [],
    responsibilities: [],
    rawText: "We are seeking a Senior Software Engineer with React, Node.js, and AWS experience. Must have microservices and TypeScript skills.",
    source: "text",
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// ============================================================================
// Regression tests for the V3.0.1 ATS scoring fix
// ============================================================================

describe("ATS Scoring — V3.0.1 regression tests", () => {
  describe("Semantic similarity score", () => {
    it("never returns below 20 for a valid resume with a JD", () => {
      const resume = makeResume();
      const jd = makeJD();
      const score = scoreSemanticSimilarity(resume, jd);
      expect(score).toBeGreaterThanOrEqual(20);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns 0 only for empty/invalid resumes", () => {
      const emptyResume: ResumeData = {
        id: "empty", name: "", headline: "",
        contact: { email: "", phone: "", location: "" },
        summary: "", experience: [], education: [], skills: [],
        projects: [], certifications: [], languages: [], achievements: [],
        template: "ats-professional", accentColor: "#1154A3",
        createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", source: "upload",
      };
      const score = scoreSemanticSimilarity(emptyResume, makeJD());
      expect(score).toBe(0);
    });

    it("returns a realistic score (40-100) for a well-matched resume", () => {
      const resume = makeResume();
      const jd = makeJD();
      const score = scoreSemanticSimilarity(resume, jd);
      // A well-matched resume should score at least 40 (was 9-26 before the fix)
      expect(score).toBeGreaterThanOrEqual(40);
    });
  });

  describe("Readability score", () => {
    it("never returns 0 for a valid non-empty resume", () => {
      const resume = makeResume();
      const score = scoreReadability(resume);
      expect(score).toBeGreaterThanOrEqual(30); // floor
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns 0 only for empty resumes (< 50 chars of text)", () => {
      // A truly empty resume — no name, no headline, no summary, no experience, no skills
      const emptyResume: ResumeData = {
        id: "empty", name: "", headline: "",
        contact: { email: "", phone: "", location: "" },
        summary: "", experience: [], education: [], skills: [],
        projects: [], certifications: [], languages: [], achievements: [],
        template: "ats-professional", accentColor: "#1154A3",
        createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", source: "upload",
      };
      const score = scoreReadability(emptyResume);
      expect(score).toBe(0); // < 50 chars → returns 0
    });

    it("handles resumes with no periods in bullets (modern style)", () => {
      // Resume with long bullets, no periods — this was the bug that caused readability = 0
      const resume = makeResume({
        experience: [{
          id: "e1",
          title: "Engineer",
          company: "Corp",
          location: "SF",
          startDate: "2020",
          endDate: "Present",
          bullets: [
            "Led migration to microservices architecture reducing deployment time by 65% and improving system reliability across multiple teams",
            "Built real-time analytics dashboard processing 2M events daily using React WebSocket and Redis for sub-second query performance",
            "Mentored 5 junior engineers with 3 receiving promotions within 18 months of joining the team through structured code reviews",
          ],
        }],
      });
      const score = scoreReadability(resume);
      // Must not be 0 — the bug was that countSentences only counted . ! ?
      expect(score).toBeGreaterThanOrEqual(30);
    });
  });

  describe("ATS result immutability", () => {
    it("freezes the ATS result so downstream agents cannot mutate it", () => {
      const resume = makeResume();
      const jd = makeJD();
      const result = analyzeATS(resume, jd);

      // The result + all nested objects should be frozen
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.scores)).toBe(true);
      expect(Object.isFrozen(result.missingKeywords)).toBe(true);
      expect(Object.isFrozen(result.matchedKeywords)).toBe(true);
      expect(Object.isFrozen(result.recommendations)).toBe(true);
      expect(Object.isFrozen(result.explanations)).toBe(true);

      // Attempting to mutate a frozen object should throw in strict mode
      expect(() => { (result.scores as any).ats = 0; }).toThrow();
      expect(() => { (result.missingKeywords as any).push("fake"); }).toThrow();
    });

    it("produces stable scores — calling analyzeATS twice with the same inputs returns identical results", () => {
      const resume = makeResume();
      const jd = makeJD();
      const result1 = analyzeATS(resume, jd);
      const result2 = analyzeATS(resume, jd);
      expect(result2.scores.ats).toBe(result1.scores.ats);
      expect(result2.scores.semanticSimilarity).toBe(result1.scores.semanticSimilarity);
      expect(result2.scores.readability).toBe(result1.scores.readability);
      expect(result2.scores.formatting).toBe(result1.scores.formatting);
    });
  });

  describe("Overall ATS score sanity", () => {
    it("produces a realistic overall score (50-100) for a valid resume+JD", () => {
      const resume = makeResume();
      const jd = makeJD();
      const result = analyzeATS(resume, jd);
      // Before the fix, overall was 59 (artificially low due to semantic=9, readability=0)
      // After the fix, overall should be 70+ for a well-matched resume
      expect(result.scores.ats).toBeGreaterThanOrEqual(50);
      expect(result.scores.ats).toBeLessThanOrEqual(100);
    });

    it("does not regress: semantic + readability scores are never abnormally low", () => {
      const resume = makeResume();
      const jd = makeJD();
      const result = analyzeATS(resume, jd);
      // The bug was semantic=9, readability=0. After the fix:
      expect(result.scores.semanticSimilarity).toBeGreaterThanOrEqual(20);
      expect(result.scores.readability).toBeGreaterThanOrEqual(30);
    });
  });
});
