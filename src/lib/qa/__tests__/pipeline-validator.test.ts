import { describe, it, expect } from "vitest";
import { GOLDEN_CORPUS } from "../golden-corpus";
import {
  validateSectionParity,
  validateImmutability,
  validateContentPreservation,
  validateSemanticPreservation,
  validateAgainstGoldenCorpus,
  pipelineValidatorToQATests,
} from "../pipeline-validator";
import type { ResumeData } from "../../types";

describe("PipelineValidator", () => {
  // Use the first golden resume as baseline
  const baseline = GOLDEN_CORPUS[0].expected;

  function cloneResume(r: ResumeData): ResumeData {
    return JSON.parse(JSON.stringify(r));
  }

  describe("validateSectionParity", () => {
    it("should pass when sections match", () => {
      const result = validateSectionParity(baseline, baseline);
      expect(result.countMatch).toBe(true);
      expect(result.missing.length).toBe(0);
    });

    it("should detect missing sections", () => {
      const modified = cloneResume(baseline);
      modified.experience = [];
      modified.skills = [];
      const result = validateSectionParity(baseline, modified);
      expect(result.missing.length).toBeGreaterThan(0);
      expect(result.countMatch).toBe(false);
    });

    it("should detect extra sections", () => {
      const modified = cloneResume(baseline);
      modified.achievements = ["Award 1"];
      const result = validateSectionParity(baseline, modified);
      expect(result.extra.length).toBeGreaterThan(0);
    });
  });

  describe("validateImmutability", () => {
    it("should pass when unchanged", () => {
      const result = validateImmutability(baseline, baseline);
      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it("should detect name change", () => {
      const modified = cloneResume(baseline);
      modified.name = "Changed Name";
      const result = validateImmutability(baseline, modified);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.field === "name")).toBe(true);
    });

    it("should detect employer change", () => {
      const modified = cloneResume(baseline);
      if (modified.experience.length > 0) {
        modified.experience[0].company = "Different Company";
      }
      const result = validateImmutability(baseline, modified);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.field.indexOf("company") !== -1)).toBe(true);
    });

    it("should detect school change", () => {
      const modified = cloneResume(baseline);
      if (modified.education.length > 0) {
        modified.education[0].institution = "Different School";
      }
      const result = validateImmutability(baseline, modified);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.field.indexOf("institution") !== -1)).toBe(true);
    });

    it("should detect degree change", () => {
      const modified = cloneResume(baseline);
      if (modified.education.length > 0) {
        modified.education[0].degree = "Different Degree";
      }
      const result = validateImmutability(baseline, modified);
      expect(result.passed).toBe(false);
    });
  });

  describe("validateContentPreservation", () => {
    it("should pass when all sections have content", () => {
      const result = validateContentPreservation(baseline);
      expect(result.passed).toBe(true);
    });

    it("should detect empty experience bullets", () => {
      const modified = cloneResume(baseline);
      if (modified.experience.length > 0) {
        modified.experience[0].bullets = [];
      }
      const result = validateContentPreservation(modified);
      expect(result.passed).toBe(false);
      expect(result.emptySections.some((s) => s.indexOf("bullets") !== -1)).toBe(true);
    });
  });

  describe("validateSemanticPreservation", () => {
    it("should return high similarity when unchanged", () => {
      const result = validateSemanticPreservation(baseline, baseline);
      expect(result.summarySimilarity).toBeGreaterThanOrEqual(0.9);
      expect(result.experienceSimilarity).toBeGreaterThanOrEqual(0.9);
      expect(result.overallPassed).toBe(true);
    });

    it("should detect low similarity when content is empty", () => {
      const empty: ResumeData = {
        id: "", name: "", contact: {}, summary: "", experience: [], education: [],
        skills: [], languages: [], certifications: [], projects: [],
        template: "ats-professional", createdAt: "", updatedAt: "",
      };
      const result = validateSemanticPreservation(baseline, empty);
      expect(result.overallPassed).toBe(false);
    });
  });

  describe("validateAgainstGoldenCorpus", () => {
    it("should pass when pipeline outputs match corpus", () => {
      const outputs = GOLDEN_CORPUS.map((g) => ({
        resumeId: g.id,
        result: g.expected,
      }));
      const results = validateAgainstGoldenCorpus(outputs);
      results.forEach((r) => {
        expect(r.allPassed).toBe(true);
      });
    });

    it("should detect golden corpus entry not found", () => {
      const results = validateAgainstGoldenCorpus([
        { resumeId: "nonexistent", result: baseline },
      ]);
      expect(results[0].allPassed).toBe(false);
    });
  });

  describe("pipelineValidatorToQATests", () => {
    it("should convert results to QATestResult format", () => {
      const outputs = GOLDEN_CORPUS.slice(0, 2).map((g) => ({
        resumeId: g.id,
        result: g.expected,
      }));
      const validationResults = validateAgainstGoldenCorpus(outputs);
      const tests = pipelineValidatorToQATests(validationResults);
      expect(tests.length).toBeGreaterThan(0);
      tests.forEach((t) => {
        expect(t.id).toBeTruthy();
        expect(t.category).toBe("regression");
        expect(typeof t.passed).toBe("boolean");
      });
    });
  });
});
