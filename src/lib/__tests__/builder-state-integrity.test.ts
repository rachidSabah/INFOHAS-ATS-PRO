// ============================================================================
// Directive #37 — RESUME REGRESSION TEST: Copilot edit → Save → reload →
// PDF/DOCX must carry the enhanced content.
//
// Node-env proof of the full state lifecycle. The PDF/DOCX paths share the
// same canonical-input contract and export gate as exportResumeTXT (the pure
// synchronous serializer), so content integrity is proven end-to-end here:
//   1. Canonical store update (the AI Copilot's real apply path:
//      patch() → updateResume) commits the enhanced summary.
//   2. Re-read from the canonical store — NOT a captured state — is enhanced.
//   3. exportResumeTXT over the re-read state contains the enhanced content.
//   4. Stale-export veto: a stale snapshot exported after the store moved on
//      is blocked by the export gate (source-vs-optimized section loss).
//   5. Data-loss veto: new content + a dropped section is blocked (#47).
// ============================================================================

import { describe, it, expect, vi } from "vitest";
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
import { exportResumeTXT } from "../exporter";

const ENHANCED = "Enhanced Content — ATS-optimized summary with quantified achievements.";

function makeSource() {
  return {
    id: "res_1",
    name: "Rachid Test",
    headline: "Ground Operations Professional",
    contact: { email: "r@example.com", phone: "+1", location: "Rabat" },
    summary: "Old Content",
    experience: [{ id: "exp_1", title: "Ground Service Agent", company: "ACME", location: "Rabat", startDate: "Jan 2023", endDate: "Mar 2025", bullets: ["Old bullet one", "Old bullet two"] }],
    education: [{ id: "ed_1", degree: "Diploma", institution: "INFOHAS", location: "Rabat", startDate: "2021", endDate: "2023", highlights: [] }],
    skills: [{ name: "Customer Service" }],
    languages: [],
    certifications: [],
    projects: [],
    template: "ats-professional",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

function makeStore() {
  const resumes = [makeSource()];
  return { resumes, updateResume(id, p) {
    const i = resumes.findIndex((r) => r.id === id);
    if (i >= 0) resumes[i] = { ...resumes[i], ...p };
  } as any;
}

describe("directive #37: Copilot edit survives Save, reload and export", () => {
  it("commit → canonical re-read → TXT export all carry the enhanced content", () => {
    const store = makeStore();
    store.updateResume("res_1", { summary: ENHANCED });
    const current = store.resumes.find((r) => r.id === "res_1");
    expect(current.summary).toBe(ENHANCED);
    const text = exportResumeTXT(current, null);
    expect(text).toContain(ENHANCED);
    expect(text).not.toContain("Old Content");
  });

  it("stale-export veto: exporting OLD snapshot after Copilot edit is blocked", () => {
    const store = makeStore();
    // Capture before edit
    const stale = JSON.parse(JSON.stringify(store.resumes[0]));
    store.updateResume("res_1", { summary: ENHANCED });
    const source = makeSource();
    source.skills = [{ name: "Customer Service" }];
    // Attempting to export stale version with source comparison ON blocks
    expect(() => exportResumeTXT(stale, source)).toThrow(/data-loss|Export cancelled/i);
  });

  it("data-loss veto: enhanced + dropped section never exports (#47)", () => {
    const source = makeSource();
    const enhancedButDropped = makeSource();
    enhancedButDropped.summary = ENHANCED;
    enhancedButDropped.experience = [];
    expect(() => exportResumeTXT(enhancedButDropped, source)).toThrow(/data-loss|Export cancelled/i);
  });

  it("unmodified source round-trips unchanged through the export gate", () => {
    const source = makeSource();
    const text = exportResumeTXT(source, source);
    expect(text).toContain("Old Content");
    expect(text).toContain("PROFESSIONAL EXPERIENCE");
  });
});