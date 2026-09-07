/**
 * template-design-export.test.ts
 *
 * Covers two user-reported bugs:
 *
 * Bug A — "choose a template in the Builder, save, download: the resume has
 *         no template design". Root cause: the PDF and DOCX renderers ignored
 *         rd.template and always produced the generic single-column flow.
 *         Sidebar templates (modern / creative) must render the full-height
 *         accent sidebar (PDF: filled rect + white sidebar text at sidebar
 *         coordinates; DOCX: borderless two-column table with shaded cell).
 *
 * Bug B — "cover letter adds the title 'Cover Letter — <Company>' to the
 *         letter header". The internal title is a file label only and must
 *         never be printed in the exported PDF/DOCX.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jsPDF from "jspdf";
import JSZip from "jszip";
import type { ResumeData, CoverLetter } from "./types";
import { getLayoutForTemplate } from "./exporter";

// Capture blobs handed to file-saver's saveAs (node has no download flow).
const { savedBlobs } = vi.hoisted(() => ({
  savedBlobs: [] as { blob: Blob; name: string }[],
}));
vi.mock("file-saver", () => ({
  saveAs: (blob: Blob, name: string) => {
    savedBlobs.push({ blob, name });
  },
}));

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
    ],
    certifications: [],
    projects: [],
    template: "ats-professional",
    createdAt: "2025-07-01T00:00:00Z",
    updatedAt: "2025-07-08T00:00:00Z",
    ...overrides,
  };
}

function makeCL(overrides: Partial<CoverLetter> = {}): CoverLetter {
  return {
    id: "cl1",
    title: "Cover Letter — Qatar Airways",
    template: "modern",
    content: "Dear Hiring Manager,\n\nI am writing to express my interest in the Cabin Crew position.\n\nSincerely,\nZakariya",
    resumeId: "r1",
    jdId: "jd1",
    company: "Qatar Airways",
    role: "Cabin Crew",
    createdAt: "2025-07-01T00:00:00Z",
    updatedAt: "2025-07-08T00:00:00Z",
    ...overrides,
  };
}

// Spy bookkeeping — jsPDF copies API methods onto each instance AT
// CONSTRUCTION, so replacing jsPDF.API.* before the export creates its
// jsPDF intercepts every doc.* call made by that instance.
const jsPDF_API = (jsPDF as any).API;
let textCalls: { text: string; x: number; y: number }[];
let rectCalls: { x: number; y: number; w: number; h: number; style?: string }[];
let fillCalls: { r: number; g: number; b: number }[];
let savedFiles: string[];
let patchedNames: string[] = [];

function patchApi(name: string, impl: (...args: any[]) => any) {
  if (!patchedNames.includes(name)) patchedNames.push(name);
  (jsPDF_API as any)[name] = impl;
}

beforeEach(() => {
  // Keep originals on first patch of this process so afterEach can restore.
  if (!(jsPDF_API as any).__originals) {
    (jsPDF_API as any).__originals = {};
    for (const n of ["save", "text", "rect", "setFillColor"]) {
      (jsPDF_API as any).__originals[n] = (jsPDF_API as any)[n];
    }
  }
  patchedNames = [];
  textCalls = [];
  rectCalls = [];
  fillCalls = [];
  savedFiles = [];
  savedBlobs.length = 0;

  patchApi("save", function (this: any, name: string) { savedFiles.push(String(name)); return this; });
  patchApi("text", function (this: any, text: any, x: any, y: any) {
    textCalls.push({ text: String(text), x: Number(x), y: Number(y) });
    return this;
  });
  patchApi("rect", function (this: any, x: any, y: any, w: any, h: any, style?: string) {
    rectCalls.push({ x: Number(x), y: Number(y), w: Number(w), h: Number(h), style });
    return this;
  });
  patchApi("setFillColor", function (this: any, r: any, g: any, b: any) {
    fillCalls.push({ r: Number(r), g: Number(g), b: Number(b) });
    return this;
  });
});

afterEach(() => {
  const originals = (jsPDF_API as any).__originals || {};
  for (const n of patchedNames) {
    if (originals[n]) (jsPDF_API as any)[n] = originals[n];
  }
  vi.restoreAllMocks();
});

async function buildRD(template: string, accent = "#0EA5E9") {
  const { toRenderDocument } = await import("./render-document");
  const resume = makeResume({ template: template as ResumeData["template"], accentColor: accent });
  const L = getLayoutForTemplate(template, accent);
  return { rd: toRenderDocument(resume, L), accent };
}

// ═══════════════════════════════════════════════════════════════════════════
// Bug A — PDF: sidebar templates render the accent sidebar
// ═══════════════════════════════════════════════════════════════════════════

describe("export-pdf-render — sidebar templates (modern / creative)", () => {
  it("modern: paints the full-height accent sidebar rect", async () => {
    const { exportResumePDFRenderDoc } = await import("./export-pdf-render");
    const { rd, accent } = await buildRD("modern");
    const r = parseInt(accent.slice(1, 3), 16);
    const g = parseInt(accent.slice(3, 5), 16);
    const b = parseInt(accent.slice(5, 7), 16);

    await exportResumePDFRenderDoc(rd);

    expect(fillCalls.some((c) => c.r === r && c.g === g && c.b === b)).toBe(true);
    // Sidebar panel: x=0, y=0, width=66 (≈31% of A4), full height, filled
    expect(rectCalls.some((c) => c.x === 0 && c.y === 0 && Math.round(c.w) === 66 && c.h >= 297)).toBe(true);
  });

  it("modern: name and skills are drawn INSIDE the sidebar column (x < 66mm)", async () => {
    const { exportResumePDFRenderDoc } = await import("./export-pdf-render");
    const { rd } = await buildRD("modern");

    await exportResumePDFRenderDoc(rd);

    const nameInSidebar = textCalls.some((c) => c.text.includes("ZAKARIYA") && c.x < 66);
    const skillsInSidebar = textCalls.some((c) => c.text.includes("Customer Service") && c.x < 66);
    const languagesInSidebar = textCalls.some((c) => c.text.includes("Arabic") && c.x < 66);
    expect(nameInSidebar).toBe(true);
    expect(skillsInSidebar).toBe(true);
    expect(languagesInSidebar).toBe(true);

    // Main column content lands to the RIGHT of the sidebar
    const experienceInMain = textCalls.some((c) => c.text.includes("PROFESSIONAL EXPERIENCE") && c.x >= 66);
    expect(experienceInMain).toBe(true);
  });

  it("creative: also uses the sidebar layout", async () => {
    const { exportResumePDFRenderDoc } = await import("./export-pdf-render");
    const { rd } = await buildRD("creative", "#DB2777");

    await exportResumePDFRenderDoc(rd);

    expect(rectCalls.some((c) => c.x === 0 && c.y === 0 && Math.round(c.w) === 66)).toBe(true);
    expect(textCalls.some((c) => c.text.includes("ZAKARIYA") && c.x < 66)).toBe(true);
  });

  it("ats-professional: keeps the single-column flow (no sidebar rect)", async () => {
    const { exportResumePDFRenderDoc } = await import("./export-pdf-render");
    const { rd } = await buildRD("ats-professional");

    await exportResumePDFRenderDoc(rd);

    // The single-column renderer never fills a colored rect — the "F" fill
    // for the sidebar is exclusive to the sidebar branch.
    expect(rectCalls.some((c) => c.style === "F")).toBe(false);
    // Body text starts at the left margin, not offset by a sidebar
    const nameCall = textCalls.find((c) => c.text.includes("ZAKARIYA"));
    expect(nameCall).toBeDefined();
    expect(nameCall!.x).toBeLessThan(20);
  });

  it("returns ok without truncation for a small resume (no scale retry)", async () => {
    const { exportResumePDFRenderDoc } = await import("./export-pdf-render");
    const { rd } = await buildRD("modern");
    const result = await exportResumePDFRenderDoc(rd);
    expect(result.ok).toBe(true);
    expect(result.pages).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bug A — DOCX: sidebar templates render a shaded two-column table
// ═══════════════════════════════════════════════════════════════════════════

describe("export-docx-render — sidebar templates", () => {
  async function docxXml(template: string, accent = "#0EA5E9") {
    const { toRenderDocument } = await import("./render-document");
    const { exportResumeDOCXRenderDoc } = await import("./export-docx-render");
    const resume = makeResume({ template: template as ResumeData["template"], accentColor: accent });
    const L = getLayoutForTemplate(template, accent);
    const blob = await exportResumeDOCXRenderDoc(toRenderDocument(resume, L));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return await zip.file("word/document.xml")!.async("string");
  }

  it("modern: document.xml contains a borderless two-column table with shaded sidebar", async () => {
    const xml = await docxXml("modern");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain('w:fill="0EA5E9"');
    // White sidebar text
    expect(xml).toContain('w:val="FFFFFF"');
    // Name lives in the document
    expect(xml).toContain("ZAKARIYA NADIF");
  });

  it("modern: sidebar sections and main sections are both present", async () => {
    const xml = await docxXml("modern");
    // skills (sidebar), experience (main)
    expect(xml.toUpperCase()).toContain("SKILL");
    expect(xml.toUpperCase()).toContain("EXPERIENCE");
  });

  it("ats-professional: no table — classic single-column flow preserved", async () => {
    const xml = await docxXml("ats-professional");
    expect(xml).not.toContain("<w:tbl>");
    expect(xml).not.toContain('w:fill="0EA5E9"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bug B — cover letter exports never print the internal title
// ═══════════════════════════════════════════════════════════════════════════

describe("cover letter exports — internal title is a file label only", () => {
  it("PDF: title is never drawn, role@company and body are", async () => {
    const { exportCoverLetterPDF } = await import("./exporter");
    const cl = makeCL();

    exportCoverLetterPDF(cl);

    const drawnTexts = textCalls.map((c) => c.text);
    expect(drawnTexts.some((t) => t.includes("Cover Letter —"))).toBe(false);
    expect(drawnTexts.some((t) => t.includes("Cover Letter — Qatar Airways"))).toBe(false);
    expect(drawnTexts.some((t) => t.includes("Cabin Crew at Qatar Airways"))).toBe(true);
    expect(drawnTexts.some((t) => t.includes("Dear Hiring Manager"))).toBe(true);
  });

  it("DOCX: document.xml never contains the title", async () => {
    const { exportCoverLetterDOCX } = await import("./exporter");
    await exportCoverLetterDOCX(makeCL());
    expect(savedBlobs.length).toBe(1);
    const zip = await JSZip.loadAsync(await savedBlobs[0].blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");

    expect(xml).not.toContain("Cover Letter — Qatar Airways");
    expect(xml).toContain("Cabin Crew at Qatar Airways");
    expect(xml).toContain("Dear Hiring Manager");
  });

  it("PDF: filename still uses the internal title (label role preserved)", async () => {
    const { exportCoverLetterPDF } = await import("./exporter");
    const cl = makeCL();

    exportCoverLetterPDF(cl);

    expect(savedFiles.length).toBe(1);
    expect(savedFiles[0]).toBe("Cover_Letter_—_Qatar_Airways.pdf");
  });
});
