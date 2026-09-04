import { describe, it, expect } from "vitest";
import { exportResumeTXT, validateExportCompleteness } from "../exporter";
import { resumeToDirectiveHtml } from "../ats-directives";
import type { ResumeData } from "../types";

// Wave 4 (§37): Builder canonical-state integrity.
// Proves the Copilot-enhanced resume is what Save / reload / export carry —
// a stale or data-lost copy can never silently reach an export artifact.
function makeSource(): ResumeData {
  return {
    id: "src-1",
    name: "Test Candidate",
    headline: "Cabin Crew Professional",
    contact: { email: "test@example.com", phone: "+212 600000000", location: "Rabat, Morocco" },
    summary: "Original summary text.",
    experience: [
      { id: "exp-1", company: "Hotel A", title: "Receptionist", location: "Rabat", startDate: "2023-01", endDate: "2024-01", bullets: ["Welcomed guests daily"] },
      { id: "exp-2", company: "Hotel B", title: "Host", location: "Casa", startDate: "2024-02", endDate: "Present", bullets: ["Managed seating plan"] }
    ],
    education: [
      { id: "edu-1", institution: "INFOHAS", degree: "Diploma", startDate: "2021", endDate: "2023", highlights: ["Hospitality"] },
      { id: "edu-2", institution: "Lycee X", degree: "Baccalaureate", startDate: "2018", endDate: "2021", highlights: [] }
    ],
    skills: [
      { id: "s1", name: "Customer Service", category: "Soft" },
      { id: "s2", name: "Safety Procedures", category: "Technical" }
    ],
    languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
    certifications: [{ id: "c1", name: "First Aid", issuer: "Red Crescent" }],
    projects: [],
    additionalInfo: "Willing to relocate",
    dynamicSections: [],
    template: "infohas-pro",
    accentColor: "#000000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("builder state integrity", () => {
  it("canonical commit survives re-read: enhanced content reaches export", () => {
    const enhanced = makeSource();
    enhanced.summary = "Copilot enhanced summary with Qatar Airways keywords.";
    const reloaded: ResumeData = structuredClone(enhanced);
    const gate = validateExportCompleteness(reloaded, reloaded);
    expect(gate.ok).toBe(true);
    const html = resumeToDirectiveHtml(reloaded);
    expect(html).toContain("Copilot enhanced summary");
  });

  it("stale export is blocked when the source has sections the export lacks", () => {
    const source = makeSource();
    const stale = makeSource();
    stale.certifications = [];
    expect(() => exportResumeTXT(stale, source)).toThrow("Export cancelled");
  });

  it("data-loss veto fires when education entries are dropped", () => {
    const source = makeSource();
    const dropped = makeSource();
    dropped.education = [];
    const result = validateExportCompleteness(source, dropped);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join()).toContain("Education");
    }
  });

  it("unmodified source round-trips through export unchanged", () => {
    const source = makeSource();
    const html = resumeToDirectiveHtml(source);
    expect(html).toContain("TEST CANDIDATE");
    expect(html).toContain("Welcomed guests daily");
  });
});
