// ============================================================================
// Regional resume norms — domain logic tests (pure functions, node env)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  REGION_NORMS,
  REGION_OPTIONS,
  normalizeRegion,
  getResumeRegion,
  hasPersonalDetail,
  hasNormField,
  computeRegionalNormReport,
  buildRegionalFixPatch,
  type RegionalNormIssue,
} from "./regional-norms";
import type { ResumeData } from "./types";

// ── Fixture helpers ──────────────────────────────────────────────────────────
function baseResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "r_test",
    name: "Rachid El Sabah",
    contact: {},
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    languages: [],
    template: "ats-professional",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const withRegion = (region: string | undefined, overrides: Partial<ResumeData> = {}) =>
  baseResume({ contact: { region: region as never }, ...overrides });

function issueFor(issues: RegionalNormIssue[], id: string): RegionalNormIssue {
  const hit = issues.find((i) => i.id === id);
  expect(hit, `expected issue ${id} in [${issues.map((i) => i.id).join(", ")}]`).toBeTruthy();
  return hit!;
}

// ── Norms table integrity ────────────────────────────────────────────────────
describe("REGION_NORMS table integrity", () => {
  it("defines exactly the three supported regions", () => {
    expect(Object.keys(REGION_NORMS).sort()).toEqual(["eu", "gulf", "na"]);
  });

  it("every region has label, tagline, advice and a non-empty field table", () => {
    for (const norms of Object.values(REGION_NORMS)) {
      expect(norms.label.length).toBeGreaterThan(0);
      expect(norms.tagline.length).toBeGreaterThan(0);
      expect(norms.advice.length).toBeGreaterThan(0);
      expect(norms.fields.length).toBeGreaterThanOrEqual(5);
      for (const f of norms.fields) {
        expect(f.label.length).toBeGreaterThan(0);
        expect(f.note.length).toBeGreaterThan(20);
        expect(["expected", "optional", "discouraged", "avoid"]).toContain(f.stance);
      }
    }
  });

  it("encodes the headline market differences correctly", () => {
    // Photo: expected in the Gulf, avoided in North America
    expect(REGION_NORMS.gulf.fields.find((f) => f.key === "photo")!.stance).toBe("expected");
    expect(REGION_NORMS.na.fields.find((f) => f.key === "photo")!.stance).toBe("avoid");
    // Nationality: expected in the Gulf, avoided in North America, optional in EU
    expect(REGION_NORMS.gulf.fields.find((f) => f.key === "nationality")!.stance).toBe("expected");
    expect(REGION_NORMS.na.fields.find((f) => f.key === "nationality")!.stance).toBe("avoid");
    expect(REGION_NORMS.eu.fields.find((f) => f.key === "nationality")!.stance).toBe("optional");
    // Marital status: avoid in NA/EU, optional (common but not required) in the Gulf
    expect(REGION_NORMS.na.fields.find((f) => f.key === "maritalStatus")!.stance).toBe("avoid");
    expect(REGION_NORMS.eu.fields.find((f) => f.key === "maritalStatus")!.stance).toBe("avoid");
    expect(REGION_NORMS.gulf.fields.find((f) => f.key === "maritalStatus")!.stance).toBe("optional");
  });

  it("selector options cover all regions plus the international default", () => {
    expect(REGION_OPTIONS.map((o) => o.value)).toEqual(["", "na", "eu", "gulf"]);
  });
});

// ── normalizeRegion ──────────────────────────────────────────────────────────
describe("normalizeRegion", () => {
  it("accepts canonical ids case-insensitively", () => {
    expect(normalizeRegion("na")).toBe("na");
    expect(normalizeRegion("EU")).toBe("eu");
    expect(normalizeRegion(" Gulf ")).toBe("gulf");
  });

  it("accepts common aliases", () => {
    expect(normalizeRegion("US")).toBe("na");
    expect(normalizeRegion("canada")).toBe("na");
    expect(normalizeRegion("UK")).toBe("eu");
    expect(normalizeRegion("gcc")).toBe("gulf");
    expect(normalizeRegion("uae")).toBe("gulf");
    expect(normalizeRegion("ksa")).toBe("gulf");
  });

  it("rejects garbage, non-strings and empties", () => {
    expect(normalizeRegion("antarctica")).toBeNull();
    expect(normalizeRegion("")).toBeNull();
    expect(normalizeRegion(null)).toBeNull();
    expect(normalizeRegion(undefined)).toBeNull();
    expect(normalizeRegion(42)).toBeNull();
    expect(normalizeRegion({ region: "na" })).toBeNull();
  });
});

// ── getResumeRegion ──────────────────────────────────────────────────────────
describe("getResumeRegion", () => {
  it("reads contact.region", () => {
    expect(getResumeRegion(withRegion("gulf"))).toBe("gulf");
    expect(getResumeRegion(withRegion("NA"))).toBe("na");
  });

  it("returns null when unset or malformed", () => {
    expect(getResumeRegion(baseResume())).toBeNull();
    expect(getResumeRegion({ ...baseResume(), contact: undefined } as unknown as ResumeData)).toBeNull();
    expect(getResumeRegion(withRegion("nope" as never))).toBeNull();
    expect(getResumeRegion(null)).toBeNull();
    expect(getResumeRegion(undefined)).toBeNull();
    expect(getResumeRegion("garbage" as unknown as ResumeData)).toBeNull();
  });
});

// ── Field detection ──────────────────────────────────────────────────────────
describe("personal-detail detection", () => {
  it("hasPersonalDetail matches labels case-insensitively and ignores blanks", () => {
    const resume = baseResume({ contact: { personalDetails: { Nationality: "Moroccan", "Visa Status": "  ", Gender: "M" } } });
    expect(hasPersonalDetail(resume, "nationality")).toBe(true);
    expect(hasPersonalDetail(resume, "NATIONALITY")).toBe(true);
    expect(hasPersonalDetail(resume, "visa status")).toBe(false); // whitespace-only counts as missing
    expect(hasPersonalDetail(resume, "gender")).toBe(true);
    expect(hasPersonalDetail(resume, "marital status")).toBe(false);
  });

  it("hasPersonalDetail tolerates malformed personalDetails", () => {
    expect(hasPersonalDetail({ ...baseResume(), contact: { personalDetails: "junk" } as never }, "nationality")).toBe(false);
    expect(hasPersonalDetail(baseResume(), "nationality")).toBe(false);
    expect(hasPersonalDetail(null, "nationality")).toBe(false);
  });

  it("hasNormField routes photo and dateOfBirth to their dedicated slots", () => {
    expect(hasNormField(baseResume({ photoUrl: "https://x/y.png" }), "photo")).toBe(true);
    expect(hasNormField(baseResume({ photoUrl: "   " }), "photo")).toBe(false);
    expect(hasNormField(baseResume({ dateOfBirth: "1994-05-01" }), "dateOfBirth")).toBe(true);
    expect(hasNormField(baseResume({ dateOfBirth: "" }), "dateOfBirth")).toBe(false);
    expect(hasNormField(null, "photo")).toBe(false);
  });

  it("hasNormField resolves personal-detail labels through the region's norms table", () => {
    const gulf = baseResume({ contact: { region: "gulf", personalDetails: { Nationality: "Moroccan" } } });
    expect(hasNormField(gulf, "nationality")).toBe(true);
    expect(hasNormField(gulf, "visaStatus")).toBe(false);
    expect(hasNormField(withRegion("na"), "nationality")).toBe(false);
  });
});

// ── Compliance report ────────────────────────────────────────────────────────
describe("computeRegionalNormReport", () => {
  it("is dormant without a region — no issues, score 100", () => {
    const report = computeRegionalNormReport(baseResume({ photoUrl: "https://x/y.png", dateOfBirth: "1990-01-01" }));
    expect(report.region).toBeNull();
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
    expect(report.fields).toEqual([]);
  });

  it("is defensive against null/garbage input", () => {
    expect(computeRegionalNormReport(null).region).toBeNull();
    expect(computeRegionalNormReport(undefined).score).toBe(100);
    expect(computeRegionalNormReport("junk" as unknown as ResumeData).issues).toEqual([]);
  });

  it("flags North American liabilities: photo, DOB, nationality, marital status", () => {
    const resume = withRegion("na", {
      photoUrl: "https://x/y.png",
      dateOfBirth: "1994-05-01",
      contact: {
        region: "na",
        personalDetails: { Nationality: "Moroccan", "Marital status": "Single" },
      },
    });
    const report = computeRegionalNormReport(resume);
    expect(report.region).toBe("na");
    // 100 - 20 (photo) - 20 (dob) - 20 (nationality) - 20 (marital) = 20
    expect(report.score).toBe(20);
    expect(report.issues.filter((i) => i.kind === "remove" && i.severity === "warning").map((i) => i.fieldKey).sort())
      .toEqual(["dateOfBirth", "maritalStatus", "nationality", "photo"]);
  });

  it("a clean North American resume scores 100 with no issues", () => {
    const resume = withRegion("na", { contact: { region: "na", personalDetails: { "Driving licence": "B" } } });
    const report = computeRegionalNormReport(resume);
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
  });

  it("flags missing Gulf expectations: photo, nationality, visa status", () => {
    const report = computeRegionalNormReport(withRegion("gulf"));
    expect(report.region).toBe("gulf");
    expect(report.score).toBe(100 - 15 * 3);
    expect(report.issues.filter((i) => i.kind === "add").map((i) => i.fieldKey).sort())
      .toEqual(["nationality", "photo", "visaStatus"]);
    // All "expected"-missing issues are warnings
    expect(report.issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("a fully-loaded Gulf CV scores 100", () => {
    const resume = withRegion("gulf", {
      photoUrl: "https://x/y.png",
      contact: {
        region: "gulf",
        personalDetails: { Nationality: "Moroccan", "Visa status": "UAE residence — transferable" },
      },
    });
    expect(computeRegionalNormReport(resume).score).toBe(100);
  });

  it("Europe stays quiet on photo/DOB (optional) but warns on marital status + gender", () => {
    const resume = withRegion("eu", {
      photoUrl: "https://x/y.png",
      dateOfBirth: "1990-02-02",
      contact: { region: "eu", personalDetails: { "Marital status": "Married", Gender: "F" } },
    });
    const report = computeRegionalNormReport(resume);
    // 100 - 20 (marital) - 20 (gender) — photo & DOB are optional in the EU
    expect(report.score).toBe(60);
    expect(report.issues.map((i) => i.fieldKey).sort()).toEqual(["gender", "maritalStatus"]);
  });

  it("clean EU resume scores 100", () => {
    expect(computeRegionalNormReport(withRegion("eu")).score).toBe(100);
  });

  it("score never escapes the 0–100 band", () => {
    const resume = withRegion("na", {
      photoUrl: "https://x/y.png",
      dateOfBirth: "1990-01-01",
      contact: { region: "na", personalDetails: { Nationality: "x", "Marital status": "y", Gender: "z" } },
    });
    expect(computeRegionalNormReport(resume).score).toBe(0);
  });

  it("carries the region's reference fields and advice for the panel", () => {
    const report = computeRegionalNormReport(withRegion("gulf"));
    expect(report.fields).toEqual(REGION_NORMS.gulf.fields);
    expect(report.advice).toEqual(REGION_NORMS.gulf.advice);
    expect(report.regionLabel).toBe("Gulf (GCC)");
  });
});

// ── One-click fixes ──────────────────────────────────────────────────────────
describe("buildRegionalFixPatch", () => {
  it("clears the photo for a NA resume", () => {
    const resume = withRegion("na", { photoUrl: "https://x/y.png" });
    const report = computeRegionalNormReport(resume);
    const patch = buildRegionalFixPatch(resume, issueFor(report.issues, "regional_remove_photo"));
    expect(patch).toEqual({ photoUrl: "" });
  });

  it("clears the date of birth", () => {
    const resume = withRegion("na", { dateOfBirth: "1994-05-01" });
    const report = computeRegionalNormReport(resume);
    const patch = buildRegionalFixPatch(resume, issueFor(report.issues, "regional_remove_dateOfBirth"));
    expect(patch).toEqual({ dateOfBirth: "" });
  });

  it("deletes only the matching personalDetails key (case-insensitive), preserving the rest", () => {
    const resume = withRegion("na", {
      contact: { region: "na", personalDetails: { NATIONALITY: "Moroccan", "Visa status": "H-1B", Availability: "2 weeks" } },
    });
    const report = computeRegionalNormReport(resume);
    const patch = buildRegionalFixPatch(resume, issueFor(report.issues, "regional_remove_nationality"));
    expect(patch).toBeTruthy();
    const pd = (patch as { contact: { personalDetails: Record<string, string> } }).contact.personalDetails;
    expect(Object.keys(pd).sort()).toEqual(["Availability", "Visa status"]);
  });

  it("returns null for 'add' issues (needs human input) and when nothing is present", () => {
    const resume = withRegion("gulf");
    const report = computeRegionalNormReport(resume);
    expect(buildRegionalFixPatch(resume, issueFor(report.issues, "regional_add_photo"))).toBeNull();
    // A 'remove' issue for a field that is not present resolves to no patch:
    // build it directly since a clean NA resume never generates one.
    const na = withRegion("na");
    expect(buildRegionalFixPatch(na, {
      id: "regional_remove_photo", fieldKey: "photo", label: "Photo", kind: "remove", severity: "warning", message: "",
    })).toBeNull();
    expect(buildRegionalFixPatch(na, {
      id: "regional_remove_nationality", fieldKey: "nationality", label: "Nationality", kind: "remove", severity: "warning", message: "",
    })).toBeNull();
  });

  it("returns null on garbage input", () => {
    expect(buildRegionalFixPatch(null, {
      id: "x", fieldKey: "photo", label: "Photo", kind: "remove", severity: "warning", message: "",
    })).toBeNull();
  });
});
