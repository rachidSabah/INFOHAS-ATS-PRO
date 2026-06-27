import { describe, it, expect } from "vitest";
import { createSnapshot, restoreResumeFromSnapshot, compareSnapshots } from "../resume-snapshot-engine";
import type { ResumeData } from "../types";

const MOCK_RESUME: ResumeData = {
  id: "r_test1",
  name: "John Doe",
  headline: "Software Engineer",
  contact: { email: "john@test.com", phone: "+123", location: "NYC" },
  summary: "Experienced engineer with 5 years...",
  experience: [
    { id: "exp_1", title: "Senior Dev", company: "Acme Corp", location: "NYC",
      startDate: "2020-01", endDate: "2024-01", bullets: ["Built API", "Led team"] }
  ],
  education: [
    { id: "ed_1", institution: "MIT", degree: "BS CS", startDate: "2016", endDate: "2020" }
  ],
  skills: [{ id: "s1", name: "TypeScript", category: "Languages" }],
  languages: [{ name: "English", proficiency: "Fluent" }],
  certifications: [],
  projects: [],
  template: "ats-professional",
  accentColor: "#1154A3",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: "manual",
};

describe("Resume Snapshot Engine", () => {
  describe("createSnapshot", () => {
    it("creates a snapshot with resumeId, snapshotId, and timestamp", () => {
      const snapshot = createSnapshot(MOCK_RESUME);
      expect(snapshot.resumeId).toBe("r_test1");
      expect(snapshot.snapshotId).toMatch(/^snap_/);
      expect(snapshot.timestamp).toBeTruthy();
      expect(snapshot.fullResume).toEqual(MOCK_RESUME);
    });

    it("includes blueprint with experience count", () => {
      const snapshot = createSnapshot(MOCK_RESUME);
      expect(snapshot.blueprint.experience.length).toBe(1);
      expect(snapshot.blueprint.education.length).toBe(1);
      expect(snapshot.blueprint.experience[0].company).toBe("Acme Corp");
    });

    it("includes experience fingerprints for matching", () => {
      const snapshot = createSnapshot(MOCK_RESUME);
      expect(snapshot.experienceFingerprints.length).toBe(1);
      expect(snapshot.experienceFingerprints[0].expId).toBe("exp_1");
      expect(snapshot.experienceFingerprints[0].fingerprint).toBeTruthy();
    });

    it("accepts an optional label", () => {
      const snapshot = createSnapshot(MOCK_RESUME, "pre-optimization");
      expect(snapshot.label).toBe("pre-optimization");
    });
  });

  describe("restoreResumeFromSnapshot", () => {
    it("returns the full resume from a snapshot", () => {
      const snapshot = createSnapshot(MOCK_RESUME);
      const restored = restoreResumeFromSnapshot(snapshot);
      expect(restored).toEqual(MOCK_RESUME);
      expect(restored!.name).toBe("John Doe");
    });

    it("returns null for null snapshot", () => {
      expect(restoreResumeFromSnapshot(null as any)).toBeNull();
    });

    it("returns null for undefined snapshot", () => {
      expect(restoreResumeFromSnapshot(undefined as any)).toBeNull();
    });

    it("returns null for snapshot missing fullResume", () => {
      expect(restoreResumeFromSnapshot({} as any)).toBeNull();
    });
  });

  describe("compareSnapshots", () => {
    it("returns empty diff for identical resumes", () => {
      const before = createSnapshot(MOCK_RESUME);
      const after = createSnapshot(MOCK_RESUME);
      const diff = compareSnapshots(before, after);
      expect(diff.changes).toEqual([]);
      expect(diff.hallucinations).toEqual([]);
    });

    it("detects changed summary", () => {
      const before = createSnapshot(MOCK_RESUME);
      const modified = { ...MOCK_RESUME, summary: "New summary text" };
      const after = createSnapshot(modified);
      const diff = compareSnapshots(before, after);
      expect(diff.changes).toContainEqual(
        expect.objectContaining({ field: "summary" })
      );
    });

    it("detects dropped experience entry", () => {
      const before = createSnapshot(MOCK_RESUME);
      const modified = { ...MOCK_RESUME, experience: [] };
      const after = createSnapshot(modified);
      const diff = compareSnapshots(before, after);
      expect(diff.changes.length).toBeGreaterThan(0);
      expect(diff.changes.some(c => c.field === "experience")).toBe(true);
    });

    it("detects added experience entry (hallucination)", () => {
      const before = createSnapshot(MOCK_RESUME);
      const modified = {
        ...MOCK_RESUME,
        experience: [...MOCK_RESUME.experience, {
          id: "exp_hallucination", title: "Fake Role", company: "FakeCorp",
          location: "Nowhere", startDate: "2024", endDate: "2025", bullets: ["Did nothing"]
        }]
      };
      const after = createSnapshot(modified);
      const diff = compareSnapshots(before, after);
      expect(diff.hallucinations.length).toBe(1);
      expect(diff.hallucinations[0]).toContain("FakeCorp");
    });

    it("generates a summary string", () => {
      const before = createSnapshot(MOCK_RESUME);
      const after = createSnapshot(MOCK_RESUME);
      const diff = compareSnapshots(before, after);
      expect(typeof diff.summary).toBe("string");
      expect(diff.summary.length).toBeGreaterThan(10);
    });
  });
});
