import { describe, it, expect } from "vitest";
import {
  GOLDEN_CORPUS,
  getGoldenResume,
  getGoldenResumesByIndustry,
  getGoldenResumesByTag,
  getAllGoldenIndustries,
} from "../golden-corpus";

describe("GoldenCorpus", () => {
  it("should have at least 10 entries", () => {
    expect(GOLDEN_CORPUS.length).toBeGreaterThanOrEqual(10);
  });

  it("should have unique IDs", () => {
    const ids = GOLDEN_CORPUS.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("each entry should have required fields", () => {
    GOLDEN_CORPUS.forEach((entry) => {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.industry).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.expected).toBeTruthy();
      expect(entry.invariants).toBeTruthy();
      expect(entry.tags.length).toBeGreaterThan(0);
    });
  });

  it("each entry should have non-empty name in ResumeData", () => {
    GOLDEN_CORPUS.forEach((entry) => {
      expect(entry.expected.name).toBeTruthy();
    });
  });

  it("each entry should have experience with at least one bullet per role", () => {
    GOLDEN_CORPUS.forEach((entry) => {
      entry.expected.experience.forEach((exp) => {
        expect(exp.bullets.length).toBeGreaterThan(0);
      });
    });
  });

  it("each entry should have at least one education entry", () => {
    GOLDEN_CORPUS.forEach((entry) => {
      expect(entry.expected.education.length).toBeGreaterThan(0);
    });
  });

  it("each entry should have at least one skill", () => {
    GOLDEN_CORPUS.forEach((entry) => {
      expect(entry.expected.skills.length).toBeGreaterThan(0);
    });
  });

  it("getGoldenResume should find by ID", () => {
    const first = GOLDEN_CORPUS[0];
    const found = getGoldenResume(first.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(first.id);
  });

  it("getGoldenResume should return undefined for unknown ID", () => {
    expect(getGoldenResume("nonexistent")).toBeUndefined();
  });

  it("getGoldenResumesByIndustry should return entries", () => {
    const techEntries = getGoldenResumesByIndustry("technology");
    expect(techEntries.length).toBeGreaterThan(0);
    techEntries.forEach((e) => expect(e.industry).toBe("technology"));
  });

  it("getGoldenResumesByTag should work", () => {
    const tagged = getGoldenResumesByTag("management");
    expect(tagged.length).toBeGreaterThan(0);
  });

  it("getAllGoldenIndustries should return unique industries", () => {
    const industries = getAllGoldenIndustries();
    const uniqueIndustries = new Set(industries);
    expect(uniqueIndustries.size).toBe(industries.length);
    expect(industries.length).toBeGreaterThanOrEqual(5);
  });

  it("invariants should be populated correctly", () => {
    GOLDEN_CORPUS.forEach((entry) => {
      expect(entry.invariants.names.length).toBeGreaterThan(0);
      expect(entry.invariants.employers.length).toBeGreaterThan(0);
      expect(entry.invariants.schools.length).toBeGreaterThan(0);
      expect(entry.invariants.diplomas.length).toBeGreaterThan(0);
      expect(entry.invariants.dates.length).toBeGreaterThan(0);
      expect(entry.invariants.expectedSectionCount).toBeGreaterThan(3);
    });
  });
});
