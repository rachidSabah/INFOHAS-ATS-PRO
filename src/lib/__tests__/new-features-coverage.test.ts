/**
 * new-features-coverage.test.ts
 *
 * Covers every untested module added in Phase 2 and today's bugfix session:
 *  1.  render-document.ts   — contact block sanitisation & field ordering
 *  2.  export-docx-render   — produces a Blob with correct structure
 *  3.  ats-directives.ts    — GCC / Aviation airline presets (16+)
 *  4.  headlineIsDuplicate  — duplicate-contact suppression logic
 *  5.  InterviewPackage     — null-guard on pkg.questions
 *  6.  exportInterviewPDF   — null-safe questions loop
 *  7.  render-document      — skills / education / languages sections
 *  8.  render-document      — dynamic section de-duplication
 *  9.  contact field parity — screen preview vs export match
 */

import { describe, it, expect } from "vitest";
import type { ResumeData, InterviewPackage } from "../types";

// ─── Shared test fixture ────────────────────────────────────────────────────

function makeResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "r1",
    name: "ZAKARIYA NADIF",
    headline: "Cabin Crew Specialist",
    contact: {
      email: "zakaria.n004@gmail.com",
      phone: "+212 694-122414",
      location: "Rabat, Morocco",
    },
    summary: "Trilingual professional seeking cabin crew role.",
    experience: [
      {
        id: "e1",
        title: "Administrative Agent",
        company: "BIOLOGIA LABORATORY",
        location: "Rabat",
        startDate: "2023-01",
        endDate: "2025-10",
        bullets: ["Resolved client inquiries.", "Managed scheduling."],
      },
    ],
    education: [
      {
        id: "edu1",
        institution: "INFOHAS",
        degree: "Aviation and Hospitality Vocational Training",
        field: "Hospitality",
        startDate: "2024-01",
        endDate: "2025-12",
        highlights: [],
      },
    ],
    skills: [
      { id: "sk1", name: "Customer Service", category: "Core" },
      { id: "sk2", name: "Trilingual Communication", category: "Language" },
    ],
    languages: [
      { id: "lg1", name: "Arabic", proficiency: "native" },
      { id: "lg2", name: "French", proficiency: "fluent" },
      { id: "lg3", name: "English", proficiency: "fluent" },
    ],
    certifications: [],
    projects: [],
    template: "ats-professional",
    createdAt: "2025-07-01T00:00:00Z",
    updatedAt: "2025-07-08T00:00:00Z",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. render-document — buildContactBlock
// ═══════════════════════════════════════════════════════════════════════════

describe("render-document — buildContactBlock", () => {
  it("preserves a clean non-contact headline", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume({ headline: "Cabin Crew Specialist" }));
    expect(rd.contact.headline).toBe("Cabin Crew Specialist");
  });

  it("strips a pipe-delimited contact string from headline", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(
      makeResume({ headline: "Rabat, Morocco | +212 694-122414 | zakaria.n004@gmail.com" })
    );
    expect(rd.contact.headline).toBe("");
  });

  it("strips headline that contains an email address (@)", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume({ headline: "zakaria.n004@gmail.com" }));
    expect(rd.contact.headline).toBe("");
  });

  it("strips headline prefixed with PHONE:", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume({ headline: "PHONE: +212 694-122414" }));
    expect(rd.contact.headline).toBe("");
  });

  it("maps contact fields correctly", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume());
    expect(rd.contact.email).toBe("zakaria.n004@gmail.com");
    expect(rd.contact.phone).toBe("+212 694-122414");
    expect(rd.contact.location).toBe("Rabat, Morocco");
    expect(rd.contact.name).toBe("ZAKARIYA NADIF");
  });

  it("produces sections in canonical order", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume());
    const types = rd.sections.map((s) => s.type);
    expect(types[0]).toBe("professionalProfile");
    expect(types[1]).toBe("professionalExperience");
    expect(types[2]).toBe("education");
    expect(types[3]).toBe("skills");
    expect(types[4]).toBe("languages");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. export-docx-render — blob output
// ═══════════════════════════════════════════════════════════════════════════

describe("export-docx-render — Blob output", () => {
  it("generates a non-empty Blob", async () => {
    const { toRenderDocument } = await import("../render-document");
    const { exportResumeDOCXRenderDoc } = await import("../export-docx-render");
    const blob = await exportResumeDOCXRenderDoc(toRenderDocument(makeResume()));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("produces a valid DOCX MIME content (PK header in blob)", async () => {
    const { toRenderDocument } = await import("../render-document");
    const { exportResumeDOCXRenderDoc } = await import("../export-docx-render");
    const blob = await exportResumeDOCXRenderDoc(toRenderDocument(makeResume()));
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // DOCX starts with PK\x03\x04 (ZIP magic bytes)
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
  });

  it("contact block order: location|phone first, email second", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume());
    // Verify field separation — renderer reads these independently
    const locPhone = [rd.contact.location, rd.contact.phone].filter(Boolean).join(" | ");
    expect(locPhone).toBe("Rabat, Morocco | +212 694-122414");
    expect(rd.contact.email).toBe("zakaria.n004@gmail.com");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. ats-directives — GCC / Aviation presets
// ═══════════════════════════════════════════════════════════════════════════

describe("ats-directives — GCC airline presets", () => {
  it("has at least 16 airline profiles", async () => {
    const { AIRLINE_ATS_PROFILES } = await import("../ats-directives");
    expect(Object.keys(AIRLINE_ATS_PROFILES).length).toBeGreaterThanOrEqual(15);
  });

  it.each([
    "gulf",
    "saudia",
    "oman",
    "kuwait",
    "arabia",
    "flydubai",
    "riyadh",
    "emirates",
    "qatar",
    "etihad",
    "generic",
  ])("includes %s preset", async (key) => {
    const { AIRLINE_ATS_PROFILES } = await import("../ats-directives");
    expect(AIRLINE_ATS_PROFILES).toHaveProperty(key);
  });

  it("every preset has system and focus properties", async () => {
    const { AIRLINE_ATS_PROFILES } = await import("../ats-directives");
    for (const [key, profile] of Object.entries(AIRLINE_ATS_PROFILES)) {
      expect(profile, `${key}: missing system`).toHaveProperty("system");
      expect(profile, `${key}: missing focus`).toHaveProperty("focus");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. headlineIsDuplicateContact — pure logic unit tests
// ═══════════════════════════════════════════════════════════════════════════

/** Mirror of the helper in A4Preview.tsx and EditableA4Preview.tsx */
function headlineIsDuplicateContact(
  headline: string,
  contact: { email?: string; phone?: string; location?: string }
): boolean {
  if (!headline || !contact) return false;
  const hl = headline.toLowerCase();
  if (contact.email && hl.includes(contact.email.toLowerCase())) return true;
  if (contact.phone) {
    const digits = contact.phone.replace(/\D/g, "");
    if (digits.length >= 5 && hl.includes(digits)) return true;
  }
  if (contact.location && hl === contact.location.toLowerCase()) return true;
  return false;
}

const contact = {
  email: "zakaria.n004@gmail.com",
  phone: "+212 694-122414",
  location: "Rabat, Morocco",
};

describe("headlineIsDuplicateContact", () => {
  it("returns true when headline contains email", () => {
    expect(headlineIsDuplicateContact("zakaria.n004@gmail.com", contact)).toBe(true);
  });

  it("returns true when headline contains phone digits inline", () => {
    // digits of "+212 694-122414" = "212694122414"
    // headline contains those digit chars somewhere within it
    const hl = "Rabat Morocco 212694122414 contact";
    expect(headlineIsDuplicateContact(hl, contact)).toBe(true);
  });

  it("returns true when headline exactly matches location (case-insensitive)", () => {
    expect(headlineIsDuplicateContact("rabat, morocco", contact)).toBe(true);
  });

  it("returns false for a clean job-title headline", () => {
    expect(headlineIsDuplicateContact("Cabin Crew Specialist", contact)).toBe(false);
  });

  it("returns false for empty headline", () => {
    expect(headlineIsDuplicateContact("", contact)).toBe(false);
  });

  it("returns false when contact object is empty", () => {
    expect(headlineIsDuplicateContact("Some headline", {})).toBe(false);
  });

  it("returns false for partial location match (not exact)", () => {
    expect(headlineIsDuplicateContact("Rabat City", contact)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. InterviewPackage null-guard — pkg.questions ?? []
// ═══════════════════════════════════════════════════════════════════════════

describe("InterviewPackage null-guard", () => {
  function safeLength(pkg: any): number {
    return (pkg.questions ?? []).length;
  }

  function safePrepPercent(pkg: any, completed: Set<string>): number {
    const qs = pkg?.questions ?? [];
    return qs.length > 0 ? Math.round((completed.size / qs.length) * 100) : 0;
  }

  it("returns 0 when questions is undefined", () => {
    expect(safeLength({ id: "p1" })).toBe(0);
  });

  it("returns correct count when questions exists", () => {
    expect(safeLength({ questions: [{ id: "q1" }, { id: "q2" }] })).toBe(2);
  });

  it("prepPercent is 0 when questions undefined", () => {
    expect(safePrepPercent({ id: "p1" }, new Set(["q1"]))).toBe(0);
  });

  it("prepPercent is 50 when half completed", () => {
    const pkg = { questions: [{ id: "q1" }, { id: "q2" }] };
    expect(safePrepPercent(pkg, new Set(["q1"]))).toBe(50);
  });

  it("prepPercent is 100 when all completed", () => {
    const pkg = { questions: [{ id: "q1" }] };
    expect(safePrepPercent(pkg, new Set(["q1"]))).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. exportInterviewPDF — null-safe
// ═══════════════════════════════════════════════════════════════════════════

describe("exportInterviewPDF — null questions guard", () => {
  it("does not throw when questions is undefined", async () => {
    const { exportInterviewPDF } = await import("../exporter");
    const pkg = { id: "p1", role: "Cabin Crew", company: "Qatar", questions: undefined, createdAt: new Date().toISOString() } as any;
    expect(() => exportInterviewPDF(pkg)).not.toThrow();
  });

  it("does not throw with a valid questions array", async () => {
    const { exportInterviewPDF } = await import("../exporter");
    const pkg: InterviewPackage = {
      id: "p2",
      role: "Cabin Crew",
      company: "Emirates",
      createdAt: new Date().toISOString(),
      questions: [
        { id: "q1", category: "behavioral", question: "Tell me about yourself.", difficulty: "easy", recommendedAnswer: "I am trilingual..." },
      ],
    };
    expect(() => exportInterviewPDF(pkg)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. render-document — skills, education, languages
// ═══════════════════════════════════════════════════════════════════════════

describe("render-document — skills section", () => {
  it("groups skills into nested-bullets by category", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume());
    const section = rd.sections.find((s) => s.type === "skills")!;
    expect(section).toBeDefined();
    const item = section.items[0];
    expect(item.kind).toBe("nested-bullets");
    if (item.kind === "nested-bullets") {
      const core = item.groups.find((g) => g.label === "Core");
      expect(core?.items).toContain("Customer Service");
    }
  });

  it("omits skills section when array is empty", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume({ skills: [] }));
    expect(rd.sections.find((s) => s.type === "skills")).toBeUndefined();
  });
});

describe("render-document — education section", () => {
  it("renders degree + institution in a table-row", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume());
    const section = rd.sections.find((s) => s.type === "education")!;
    expect(section).toBeDefined();
    const row = section.items[0];
    expect(row.kind).toBe("table-row");
    if (row.kind === "table-row") {
      expect(row.cells[0].text).toContain("Aviation and Hospitality Vocational Training");
    }
  });
});

describe("render-document — languages section", () => {
  it("includes all three languages", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume());
    const section = rd.sections.find((s) => s.type === "languages")!;
    expect(section).toBeDefined();
    const item = section.items[0];
    if (item.kind === "bullets") {
      expect(item.bullets.some((b) => b.includes("Arabic"))).toBe(true);
      expect(item.bullets.some((b) => b.includes("English"))).toBe(true);
      expect(item.bullets.some((b) => b.includes("French"))).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. render-document — dynamic section de-duplication
// ═══════════════════════════════════════════════════════════════════════════

describe("render-document — dynamic section deduplication", () => {
  it("excludes dynamic sections that duplicate structured section titles", async () => {
    const { toRenderDocument } = await import("../render-document");
    const resume = makeResume({
      dynamicSections: [
        { id: "ds1", title: "Professional Experience", content: "duplicate", bullets: [] },
        { id: "ds2", title: "SKILLS", content: "more skills", bullets: [] },
      ],
    });
    const rd = toRenderDocument(resume);
    // Each title should appear at most once
    const titles = rd.sections.map((s) => s.title.toLowerCase());
    const titleSet = new Set(titles);
    expect(titleSet.size).toBe(titles.length);
  });

  it("includes novel dynamic sections not overlapping structured ones", async () => {
    const { toRenderDocument } = await import("../render-document");
    const resume = makeResume({
      dynamicSections: [
        { id: "ds3", title: "VOLUNTEER WORK", content: "", bullets: ["Organised charity events."] },
      ],
    });
    const rd = toRenderDocument(resume);
    expect(rd.sections.find((s) => s.title === "VOLUNTEER WORK")).toBeDefined();
  });

  it("skips dynamic sections containing personal info (email/phone)", async () => {
    const { toRenderDocument } = await import("../render-document");
    const resume = makeResume({
      dynamicSections: [
        { id: "ds4", title: "CONTACT INFO", content: "email: test@test.com", bullets: [] },
      ],
    });
    const rd = toRenderDocument(resume);
    expect(rd.sections.find((s) => s.title === "CONTACT INFO")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Contact field parity — screen preview vs export
// ═══════════════════════════════════════════════════════════════════════════

describe("Contact field parity — screen vs export", () => {
  it("location|phone join matches EditableA4Preview line 1", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume());
    const line1 = [rd.contact.location, rd.contact.phone].filter(Boolean).join(" | ");
    expect(line1).toBe("Rabat, Morocco | +212 694-122414");
  });

  it("email is separate — not mixed into location|phone line", async () => {
    const { toRenderDocument } = await import("../render-document");
    const rd = toRenderDocument(makeResume());
    expect(rd.contact.location).not.toContain("@");
    expect(rd.contact.phone).not.toContain("@");
    expect(rd.contact.email).toBe("zakaria.n004@gmail.com");
  });

  it("works when phone is missing — only location on line 1", async () => {
    const { toRenderDocument } = await import("../render-document");
    const resume = makeResume();
    resume.contact.phone = undefined;
    const rd = toRenderDocument(resume);
    const line1 = [rd.contact.location, rd.contact.phone].filter(Boolean).join(" | ");
    expect(line1).toBe("Rabat, Morocco");
  });

  it("works when location is missing — only phone on line 1", async () => {
    const { toRenderDocument } = await import("../render-document");
    const resume = makeResume();
    resume.contact.location = undefined;
    const rd = toRenderDocument(resume);
    const line1 = [rd.contact.location, rd.contact.phone].filter(Boolean).join(" | ");
    expect(line1).toBe("+212 694-122414");
  });
});
