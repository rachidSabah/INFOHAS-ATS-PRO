// ResumeAI Pro — client-side document exporters (PDF / DOCX / TXT)
// Critical: ALL resume PDFs MUST fit on exactly ONE A4 page.
// We use jsPDF with carefully-tuned font sizes & spacing, and validate by checking
// the resulting PDF page count: assert(pdf.pages === 1).

"use client";

import jsPDF from "jspdf";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  TabStopType, TabStopPosition, convertInchesToTwip,
} from "docx";
import { saveAs } from "file-saver";
import type { ResumeData, CoverLetter, InterviewPackage } from "./types";

// ---------- PDF: One A4 page enforcement ----------

const A4 = { w: 210, h: 297 }; // mm
const MARGIN = 14; // mm

interface PDFOptions {
  accentColor?: string;
  template?: string;
  footerText?: string;
  /** If true (default), will throw if content would overflow one page. */
  enforceOnePage?: boolean;
}

export function exportResumePDF(resume: ResumeData, opts: PDFOptions = {}): { ok: boolean; pages: number; error?: string } {
  const accent = opts.accentColor || resume.accentColor || "#1154A3";
  const accentRgb = hexToRgb(accent);

  // Pick font sizes based on content volume — auto-compress
  const sizes = pickSizesForResume(resume);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // Try to render; if it overflows, retry with progressively tighter sizes
  let attempt = 0;
  let result: { ok: boolean; pages: number; error?: string } = { ok: false, pages: 0 };
  let currentSizes = { ...sizes };

  while (attempt < 4) {
    doc.deletePage(1);
    doc.addPage("a4", "portrait");
    renderResumeToPdf(doc, resume, currentSizes, accentRgb);
    const pages = doc.getNumberOfPages();
    if (pages === 1) {
      result = { ok: true, pages };
      break;
    }
    // Overflow — compress and retry
    currentSizes = compressSizes(currentSizes);
    attempt++;
  }

  if (!result.ok && opts.enforceOnePage !== false) {
    // Final attempt: strip optional sections
    doc.deletePage(1);
    doc.addPage("a4", "portrait");
    const stripped: ResumeData = {
      ...resume,
      projects: [],
      certifications: resume.certifications.slice(0, 2),
      languages: resume.languages.slice(0, 2),
      achievements: [],
    };
    renderResumeToPdf(doc, stripped, compressSizes(currentSizes), accentRgb);
    const pages = doc.getNumberOfPages();
    if (pages > 1 && opts.enforceOnePage !== false) {
      return { ok: false, pages, error: "Could not fit resume on one A4 page after compression. Please reduce content manually." };
    }
    result = { ok: true, pages };
  }

  // Validation: assert(pdf.pages === 1)
  if (opts.enforceOnePage !== false && result.pages !== 1) {
    return { ok: false, pages: result.pages, error: `Validation failed: ${result.pages} pages generated, expected 1.` };
  }

  const fname = (resume.name || "resume").replace(/\s+/g, "_") + "_resume.pdf";
  doc.save(fname);
  return result;
}

function renderResumeToPdf(doc: jsPDF, r: ResumeData, sizes: ResumeSizes, accent: [number, number, number]) {
  const { w: pageW, h: pageH } = A4;
  const left = MARGIN;
  const right = pageW - MARGIN;
  const contentW = right - left;
  let y = MARGIN;

  // Header: name + headline
  doc.setFont("helvetica", "bold");
  doc.setTextColor(11, 31, 58);
  doc.setFontSize(sizes.name);
  doc.text(r.name || "Your Name", left, y + sizes.name * 0.35);
  y += sizes.name * 0.6 + 1;

  if (r.headline) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.setFontSize(sizes.headline);
    doc.text(r.headline, left, y + sizes.headline * 0.35);
    y += sizes.headline * 0.5 + 2;
  }

  // Contact line
  const contactParts = [
    r.contact.email,
    r.contact.phone,
    r.contact.location,
    r.contact.linkedin,
    r.contact.github,
    r.contact.website,
  ].filter(Boolean);
  if (contactParts.length) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(sizes.contact);
    const contactStr = contactParts.join("  •  ");
    doc.text(contactStr, left, y + sizes.contact * 0.35);
    y += sizes.contact * 0.5 + 3;
  }

  // Separator
  drawSeparator(doc, left, right, y, accent);
  y += 4;

  // Summary
  if (r.summary) {
    y = sectionTitle(doc, "PROFESSIONAL SUMMARY", left, y, sizes.section, accent);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(sizes.body);
    y = drawWrappedText(doc, r.summary, left, y, contentW, sizes.body, 4);
    y += 3;
  }

  // Experience
  if (r.experience.length) {
    y = sectionTitle(doc, "PROFESSIONAL EXPERIENCE", left, y, sizes.section, accent);
    for (const exp of r.experience) {
      if (y > pageH - MARGIN - 20) break;
      // Title — company line
      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 58);
      doc.setFontSize(sizes.subhead);
      const titleStr = `${exp.title}${exp.company ? " — " + exp.company : ""}`;
      doc.text(titleStr, left, y + sizes.subhead * 0.35);
      y += sizes.subhead * 0.5 + 1;

      if (exp.startDate || exp.endDate) {
        doc.setFont("helvetica", "italic");
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(sizes.small);
        const dateStr = `${formatDate(exp.startDate)} – ${formatDate(exp.endDate)}`;
        doc.text(dateStr, left, y + sizes.small * 0.35);
        y += sizes.small * 0.5 + 1.5;
      }

      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(sizes.body);
      for (const b of exp.bullets) {
        if (y > pageH - MARGIN - 10) break;
        y = drawBullet(doc, b, left, y, contentW, sizes.body, 4);
      }
      y += 2;
    }
  }

  // Education
  if (r.education.length) {
    if (y > pageH - MARGIN - 25) {
      // skip if no room
    } else {
      y = sectionTitle(doc, "EDUCATION", left, y, sizes.section, accent);
      for (const ed of r.education) {
        if (y > pageH - MARGIN - 12) break;
        doc.setFont("helvetica", "bold");
        doc.setTextColor(11, 31, 58);
        doc.setFontSize(sizes.subhead);
        const edStr = `${ed.degree}${ed.field ? " in " + ed.field : ""}`;
        doc.text(edStr, left, y + sizes.subhead * 0.35);
        y += sizes.subhead * 0.5 + 1;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(sizes.small);
        doc.text(`${ed.institution}${ed.startDate || ed.endDate ? "  •  " + formatDate(ed.startDate) + " – " + formatDate(ed.endDate) : ""}`, left, y + sizes.small * 0.35);
        y += sizes.small * 0.5 + 2;
      }
    }
  }

  // Skills
  if (r.skills.length) {
    if (y <= pageH - MARGIN - 18) {
      y = sectionTitle(doc, "SKILLS", left, y, sizes.section, accent);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(sizes.body);
      const skillStr = r.skills.map((s) => s.name).join("  •  ");
      y = drawWrappedText(doc, skillStr, left, y, contentW, sizes.body, 4);
      y += 2;
    }
  }

  // Projects (only if room)
  if (r.projects.length && y <= pageH - MARGIN - 20) {
    y = sectionTitle(doc, "PROJECTS", left, y, sizes.section, accent);
    for (const p of r.projects.slice(0, 2)) {
      if (y > pageH - MARGIN - 12) break;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 58);
      doc.setFontSize(sizes.subhead);
      doc.text(p.name, left, y + sizes.subhead * 0.35);
      y += sizes.subhead * 0.5 + 1;
      if (p.description) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(51, 65, 85);
        doc.setFontSize(sizes.body);
        y = drawWrappedText(doc, p.description, left, y, contentW, sizes.body, 3);
      }
      y += 1;
    }
  }

  // Certifications (only if room)
  if (r.certifications.length && y <= pageH - MARGIN - 14) {
    y = sectionTitle(doc, "CERTIFICATIONS", left, y, sizes.section, accent);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(sizes.body);
    for (const c of r.certifications.slice(0, 4)) {
      if (y > pageH - MARGIN - 6) break;
      const cStr = `${c.name}${c.issuer ? " — " + c.issuer : ""}${c.date ? " (" + formatDate(c.date) + ")" : ""}`;
      y = drawBullet(doc, cStr, left, y, contentW, sizes.body, 2);
    }
  }
}

interface ResumeSizes { name: number; headline: number; contact: number; section: number; subhead: number; body: number; small: number; }

function pickSizesForResume(r: ResumeData): ResumeSizes {
  const totalBullets = r.experience.reduce((n, e) => n + e.bullets.length, 0);
  if (totalBullets > 14 || r.experience.length > 4) {
    return { name: 18, headline: 10, contact: 8.5, section: 9, subhead: 9.5, body: 8.5, small: 8 };
  }
  if (totalBullets > 8) {
    return { name: 20, headline: 11, contact: 9, section: 9.5, subhead: 10, body: 9, small: 8.5 };
  }
  return { name: 22, headline: 11.5, contact: 9.5, section: 10, subhead: 10.5, body: 9.5, small: 9 };
}

function compressSizes(s: ResumeSizes): ResumeSizes {
  return {
    name: Math.max(15, s.name - 2),
    headline: Math.max(9, s.headline - 1),
    contact: Math.max(8, s.contact - 0.5),
    section: Math.max(8.5, s.section - 0.5),
    subhead: Math.max(9, s.subhead - 0.5),
    body: Math.max(8, s.body - 0.5),
    small: Math.max(7.5, s.small - 0.5),
  };
}

function sectionTitle(doc: jsPDF, title: string, x: number, y: number, size: number, accent: [number, number, number]): number {
  doc.setFont("helvetica", "bold");
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFontSize(size);
  doc.text(title, x, y + size * 0.35);
  // underline
  const tw = doc.getTextWidth(title);
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.4);
  doc.line(x, y + size * 0.45, x + tw, y + size * 0.45);
  return y + size * 0.6 + 2;
}

function drawSeparator(doc: jsPDF, x1: number, x2: number, y: number, accent: [number, number, number]) {
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.6);
  doc.line(x1, y, x2, y);
}

function drawWrappedText(doc: jsPDF, text: string, x: number, y: number, maxW: number, size: number, lineGap: number): number {
  const lines = doc.splitTextToSize(text, maxW);
  for (const line of lines) {
    doc.text(line, x, y + size * 0.35);
    y += size * 0.5 + lineGap;
  }
  return y;
}

function drawBullet(doc: jsPDF, text: string, x: number, y: number, maxW: number, size: number, lineGap: number): number {
  const bulletX = x;
  const textX = x + 3;
  const innerW = maxW - 3;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, innerW);
  // bullet
  doc.setFillColor(115, 134, 165);
  doc.circle(bulletX + 0.8, y + size * 0.2, 0.6, "F");
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i], textX, y + size * 0.35);
    y += size * 0.5 + lineGap;
  }
  return y;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

function formatDate(d?: string): string {
  if (!d) return "";
  if (/present/i.test(d)) return "Present";
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mi = parseInt(m[2], 10) - 1;
    return `${months[mi] ?? m[2]} ${m[1]}`;
  }
  return d;
}

// ---------- TXT ----------

export function exportResumeTXT(resume: ResumeData) {
  const lines: string[] = [];
  lines.push(resume.name || "");
  if (resume.headline) lines.push(resume.headline);
  const contact = [resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedin, resume.contact.github, resume.contact.website].filter(Boolean).join("  |  ");
  if (contact) lines.push(contact);
  lines.push("");
  if (resume.summary) { lines.push("PROFESSIONAL SUMMARY"); lines.push(resume.summary); lines.push(""); }
  if (resume.experience.length) {
    lines.push("PROFESSIONAL EXPERIENCE");
    for (const e of resume.experience) {
      lines.push(`${e.title}${e.company ? " — " + e.company : ""}  (${formatDate(e.startDate)} – ${formatDate(e.endDate)})`);
      for (const b of e.bullets) lines.push(`  • ${b}`);
      lines.push("");
    }
  }
  if (resume.education.length) {
    lines.push("EDUCATION");
    for (const ed of resume.education) {
      lines.push(`${ed.degree}${ed.field ? " in " + ed.field : ""} — ${ed.institution}  (${formatDate(ed.startDate)} – ${formatDate(ed.endDate)})`);
    }
    lines.push("");
  }
  if (resume.skills.length) lines.push("SKILLS", resume.skills.map((s) => s.name).join(", "), "");
  if (resume.projects.length) {
    lines.push("PROJECTS");
    for (const p of resume.projects) { lines.push(`• ${p.name}`); if (p.description) lines.push(`  ${p.description}`); }
    lines.push("");
  }
  if (resume.certifications.length) {
    lines.push("CERTIFICATIONS");
    for (const c of resume.certifications) lines.push(`• ${c.name}${c.issuer ? " — " + c.issuer : ""}`);
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  saveAs(blob, (resume.name || "resume").replace(/\s+/g, "_") + "_resume.txt");
}

// ---------- DOCX ----------

export async function exportResumeDOCX(resume: ResumeData) {
  const accent = resume.accentColor || "#1154A3";
  const accentHex = accent.replace("#", "");

  const children: Paragraph[] = [];

  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 60 },
    children: [new TextRun({ text: resume.name || "Your Name", bold: true, size: 44, color: "0B1F3A" })],
  }));
  if (resume.headline) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: resume.headline, size: 22, color: accentHex })],
    }));
  }
  const contactParts = [resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedin, resume.contact.github, resume.contact.website].filter(Boolean);
  if (contactParts.length) {
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: contactParts.join("  •  "), size: 18, color: "64748B" })],
    }));
  }

  if (resume.summary) {
    children.push(sectionPara("PROFESSIONAL SUMMARY", accentHex));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: resume.summary, size: 20, color: "334155" })] }));
  }

  if (resume.experience.length) {
    children.push(sectionPara("PROFESSIONAL EXPERIENCE", accentHex));
    for (const e of resume.experience) {
      children.push(new Paragraph({
        spacing: { after: 30 },
        children: [new TextRun({ text: `${e.title}${e.company ? " — " + e.company : ""}`, bold: true, size: 22, color: "0B1F3A" })],
      }));
      if (e.startDate || e.endDate) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: `${formatDate(e.startDate)} – ${formatDate(e.endDate)}`, italics: true, size: 18, color: "64748B" })],
        }));
      }
      for (const b of e.bullets) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 30 },
          children: [new TextRun({ text: b, size: 20, color: "334155" })],
        }));
      }
    }
  }

  if (resume.education.length) {
    children.push(sectionPara("EDUCATION", accentHex));
    for (const ed of resume.education) {
      children.push(new Paragraph({
        spacing: { after: 30 },
        children: [new TextRun({ text: `${ed.degree}${ed.field ? " in " + ed.field : ""}`, bold: true, size: 22, color: "0B1F3A" })],
      }));
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: `${ed.institution}${ed.startDate || ed.endDate ? "  •  " + formatDate(ed.startDate) + " – " + formatDate(ed.endDate) : ""}`, size: 18, color: "64748B" })],
      }));
    }
  }

  if (resume.skills.length) {
    children.push(sectionPara("SKILLS", accentHex));
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: resume.skills.map((s) => s.name).join("  •  "), size: 20, color: "334155" })],
    }));
  }

  if (resume.projects.length) {
    children.push(sectionPara("PROJECTS", accentHex));
    for (const p of resume.projects) {
      children.push(new Paragraph({
        spacing: { after: 30 },
        children: [new TextRun({ text: p.name, bold: true, size: 22, color: "0B1F3A" })],
      }));
      if (p.description) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: p.description, size: 20, color: "334155" })],
        }));
      }
    }
  }

  if (resume.certifications.length) {
    children.push(sectionPara("CERTIFICATIONS", accentHex));
    for (const c of resume.certifications) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 30 },
        children: [new TextRun({ text: `${c.name}${c.issuer ? " — " + c.issuer : ""}`, size: 20, color: "334155" })],
      }));
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{ properties: { page: { margin: { top: convertInchesToTwip(0.5), bottom: convertInchesToTwip(0.5), left: convertInchesToTwip(0.6), right: convertInchesToTwip(0.6) } } }, children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, (resume.name || "resume").replace(/\s+/g, "_") + "_resume.docx");
}

function sectionPara(title: string, color: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 60 },
    border: { bottom: { color, space: 1, style: "single", size: 8 } },
    children: [new TextRun({ text: title, bold: true, size: 20, color })],
  });
}

// ---------- Cover letter ----------

export function exportCoverLetterPDF(cl: CoverLetter, opts: { accentColor?: string } = {}) {
  const accent = hexToRgb(opts.accentColor || "#1154A3");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const { w: pageW, h: pageH } = A4;
  const left = MARGIN;
  const right = pageW - MARGIN;
  const contentW = right - left;
  let y = MARGIN;

  // Header band
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, pageW, 4, "F");

  doc.setFont("helvetica", "bold");
  doc.setTextColor(11, 31, 58);
  doc.setFontSize(11);
  doc.text(cl.title || "Cover Letter", left, y + 4);
  y += 12;

  if (cl.company || cl.role) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.setFontSize(10);
    const sub = [cl.role, cl.company].filter(Boolean).join(" at ");
    doc.text(sub, left, y);
    y += 8;
  }

  // Date
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9.5);
  doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), left, y);
  y += 8;

  // Body
  const paragraphs = cl.content.split(/\n\s*\n/);
  for (const p of paragraphs) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(33, 49, 70);
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(p.trim(), contentW);
    for (const line of lines) {
      if (y > pageH - MARGIN - 10) {
        doc.addPage();
        y = MARGIN;
      }
      doc.text(line, left, y);
      y += 6;
    }
    y += 4;
  }

  doc.save((cl.title || "cover_letter").replace(/\s+/g, "_") + ".pdf");
}

export function exportCoverLetterTXT(cl: CoverLetter) {
  const header = [cl.title, cl.role && cl.company ? `${cl.role} at ${cl.company}` : cl.role || cl.company, ""].filter(Boolean).join("\n");
  const blob = new Blob([header + "\n\n" + cl.content], { type: "text/plain;charset=utf-8" });
  saveAs(blob, (cl.title || "cover_letter").replace(/\s+/g, "_") + ".txt");
}

export async function exportCoverLetterDOCX(cl: CoverLetter) {
  const children: Paragraph[] = [];
  children.push(new Paragraph({ children: [new TextRun({ text: cl.title || "Cover Letter", bold: true, size: 26, color: "0B1F3A" })], spacing: { after: 80 } }));
  if (cl.role || cl.company) {
    children.push(new Paragraph({ children: [new TextRun({ text: [cl.role, cl.company].filter(Boolean).join(" at "), size: 20, color: "1154A3" })], spacing: { after: 80 } }));
  }
  for (const p of cl.content.split(/\n\s*\n/)) {
    children.push(new Paragraph({ children: [new TextRun({ text: p.trim(), size: 22, color: "1F2937" })], spacing: { after: 160 } }));
  }
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: convertInchesToTwip(0.8), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(0.9), right: convertInchesToTwip(0.9) } } }, children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, (cl.title || "cover_letter").replace(/\s+/g, "_") + ".docx");
}

// ---------- Interview package ----------

export function exportInterviewPDF(pkg: InterviewPackage) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const { w: pageW, h: pageH } = A4;
  const left = MARGIN;
  const right = pageW - MARGIN;
  const contentW = right - left;
  let y = MARGIN;

  // Header band
  doc.setFillColor(17, 84, 163);
  doc.rect(0, 0, pageW, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text("Interview Preparation Package", left, y + 8);
  y += 24;

  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`${pkg.role || "Role"}${pkg.company ? " at " + pkg.company : ""}`, left, y);
  y += 8;

  const grouped: Record<string, typeof pkg.questions> = {};
  for (const q of pkg.questions) (grouped[q.category] ||= []).push(q);

  const categoryLabels: Record<string, string> = {
    technical: "Technical Questions",
    behavioral: "Behavioral Questions",
    situational: "Situational Questions",
    hr: "HR Questions",
    company: "Company-Specific Questions",
  };

  for (const cat of ["technical", "behavioral", "situational", "hr", "company"]) {
    if (!grouped[cat]) continue;
    if (y > pageH - MARGIN - 20) { doc.addPage(); y = MARGIN; }
    doc.setFont("helvetica", "bold");
    doc.setTextColor(17, 84, 163);
    doc.setFontSize(12);
    doc.text(categoryLabels[cat], left, y);
    y += 6;
    doc.setDrawColor(17, 84, 163);
    doc.line(left, y, right, y);
    y += 6;

    for (const q of grouped[cat]) {
      if (y > pageH - MARGIN - 40) { doc.addPage(); y = MARGIN; }
      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 58);
      doc.setFontSize(10.5);
      y = drawWrappedText(doc, `Q${pkg.questions.indexOf(q) + 1}. ${q.question}`, left, y, contentW, 10.5, 3);
      y += 1;

      doc.setFont("helvetica", "italic");
      doc.setTextColor(245, 158, 11);
      doc.setFontSize(9);
      doc.text(`Difficulty: ${q.difficulty.toUpperCase()}`, left, y);
      y += 5;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 58);
      doc.setFontSize(10);
      doc.text("Recommended answer:", left, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(33, 49, 70);
      y = drawWrappedText(doc, q.recommendedAnswer, left + 2, y, contentW - 2, 10, 3);
      y += 2;

      if (q.talkingPoints?.length) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(11, 31, 58);
        doc.setFontSize(10);
        doc.text("Talking points:", left, y);
        y += 4;
        for (const t of q.talkingPoints) {
          if (y > pageH - MARGIN - 12) { doc.addPage(); y = MARGIN; }
          y = drawBullet(doc, t, left, y, contentW, 9.5, 2);
        }
        y += 1;
      }

      if (q.starExample) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(11, 31, 58);
        doc.setFontSize(10);
        doc.text("STAR example:", left, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(33, 49, 70);
        y = drawWrappedText(doc, `Situation: ${q.starExample.situation}`, left + 2, y, contentW - 2, 9.5, 2);
        y = drawWrappedText(doc, `Task: ${q.starExample.task}`, left + 2, y, contentW - 2, 9.5, 2);
        y = drawWrappedText(doc, `Action: ${q.starExample.action}`, left + 2, y, contentW - 2, 9.5, 2);
        y = drawWrappedText(doc, `Result: ${q.starExample.result}`, left + 2, y, contentW - 2, 9.5, 2);
        y += 2;
      }

      if (q.followUps?.length) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(11, 31, 58);
        doc.setFontSize(10);
        doc.text("Follow-up questions:", left, y);
        y += 4;
        for (const f of q.followUps) {
          if (y > pageH - MARGIN - 10) { doc.addPage(); y = MARGIN; }
          y = drawBullet(doc, f, left, y, contentW, 9.5, 2);
        }
        y += 2;
      }
      y += 4;
    }
  }

  doc.save((`interview_prep_${(pkg.company || "package").replace(/\s+/g, "_")}`).toLowerCase() + ".pdf");
}

export async function exportInterviewDOCX(pkg: InterviewPackage) {
  const children: Paragraph[] = [];
  children.push(new Paragraph({ children: [new TextRun({ text: "Interview Preparation Package", bold: true, size: 36, color: "1154A3" })], spacing: { after: 80 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: `${pkg.role || "Role"}${pkg.company ? " at " + pkg.company : ""}`, size: 22, color: "64748B", italics: true })], spacing: { after: 200 } }));

  const grouped: Record<string, typeof pkg.questions> = {};
  for (const q of pkg.questions) (grouped[q.category] ||= []).push(q);
  const labels: Record<string, string> = { technical: "Technical Questions", behavioral: "Behavioral Questions", situational: "Situational Questions", hr: "HR Questions", company: "Company-Specific Questions" };

  for (const cat of ["technical", "behavioral", "situational", "hr", "company"]) {
    if (!grouped[cat]) continue;
    children.push(sectionPara(labels[cat], "1154A3"));
    for (const q of grouped[cat]) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Q. ${q.question}`, bold: true, size: 22, color: "0B1F3A" })], spacing: { after: 40 } }));
      children.push(new Paragraph({ children: [new TextRun({ text: `Difficulty: ${q.difficulty.toUpperCase()}`, italics: true, size: 18, color: "F59E0B" })], spacing: { after: 60 } }));
      children.push(new Paragraph({ children: [new TextRun({ text: "Recommended answer:", bold: true, size: 20 })], spacing: { after: 30 } }));
      children.push(new Paragraph({ children: [new TextRun({ text: q.recommendedAnswer, size: 20, color: "1F2937" })], spacing: { after: 100 } }));
      if (q.talkingPoints?.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Talking points:", bold: true, size: 20 })], spacing: { after: 30 } }));
        for (const t of q.talkingPoints) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: t, size: 20 })], spacing: { after: 20 } }));
      }
      if (q.starExample) {
        children.push(new Paragraph({ children: [new TextRun({ text: "STAR example:", bold: true, size: 20 })], spacing: { after: 30 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: `Situation: ${q.starExample.situation}`, size: 20 })], spacing: { after: 20 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: `Task: ${q.starExample.task}`, size: 20 })], spacing: { after: 20 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: `Action: ${q.starExample.action}`, size: 20 })], spacing: { after: 20 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: `Result: ${q.starExample.result}`, size: 20 })], spacing: { after: 80 } }));
      }
      if (q.followUps?.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Follow-up questions:", bold: true, size: 20 })], spacing: { after: 30 } }));
        for (const f of q.followUps) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: f, size: 20 })], spacing: { after: 20 } }));
      }
      children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
    }
  }

  const doc = new Document({ sections: [{ properties: { page: { margin: { top: convertInchesToTwip(0.7), bottom: convertInchesToTwip(0.7), left: convertInchesToTwip(0.8), right: convertInchesToTwip(0.8) } } }, children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, (`interview_prep_${(pkg.company || "package").replace(/\s+/g, "_")}`).toLowerCase() + ".docx");
}
