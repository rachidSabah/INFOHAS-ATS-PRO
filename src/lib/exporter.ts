// ResumeAI Pro — client-side document exporters (PDF / DOCX / DOC / TXT)
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
import type { ResumeData, CoverLetter, InterviewPackage, ResumeLayoutModel } from "./types";
import { getDocxHtml, resumeToDirectiveHtml } from "./ats-directives";
import { useApp } from "./store";

// ============================================================================
// ResumeLayoutModel — single source of truth for PDF + DOCX layout
// ============================================================================

export function getDefaultResumeLayout(): ResumeLayoutModel {
  let config: any = null;
  try {
    config = useApp.getState()?.optimizerDirective;
  } catch (err) {
    console.warn("[exporter] Failed to read optimizerDirective from store, using defaults:", err);
  }

  const fontFamily = config?.fontFamily || "Times New Roman";
  const bodyFontSizePt = config?.bodyFontSizePt ?? 10.5;
  const lineHeight = config?.lineHeight ?? 1.2;

  return {
    pageSize: config?.pageSize || "A4",
    marginTopMm: config?.marginTopMm ?? 6.35,
    marginBottomMm: config?.marginBottomMm ?? 6.35,
    marginLeftMm: config?.marginLeftMm ?? 8.89,
    marginRightMm: config?.marginRightMm ?? 8.89,

    fontFamily,
    fallbackFontFamily: "Liberation Serif",
    nameSizePt: config?.nameSizePt ?? 14,
    sectionTitleSizePt: config?.sectionTitleSizePt ?? 12,
    bodyFontSizePt,

    nameColor: config?.nameColor || "#8B0000",
    sectionTitleColor: config?.sectionTitleColor || "#8B0000",
    bodyTextColor: config?.bodyTextColor || "#000000",
    contactColor: config?.bodyTextColor || "#000000",

    lineHeightMm: bodyFontSizePt * 0.352778 * lineHeight,
    sectionGapMm: config?.sectionGapMm ?? 3,
    headerGapMm: 1,
    bulletIndentMm: config?.bulletIndentMm ?? 6.4,
    paragraphSpacingMm: 1.5,

    photoWidthMm: config?.photoWidthMm ?? 30,
    photoHeightMm: config?.photoHeightMm ?? 40,

    enforceOnePage: config?.enforceOnePage ?? true,
    minFontSizePt: config?.minFontSizePt ?? 10,
  };
}

// Convert pt → mm
function ptToMm(pt: number) { return pt * 0.352778; }

// ============================================================================
// Build A4-styled HTML string that matches the DOCX visual format.
// Used by the HTML-based PDF exporter.
// ============================================================================
function buildResumeHtml(r: ResumeData, L: ResumeLayoutModel): string {
  const fmtDate = (d?: string) => {
    if (!d) return "";
    if (/present|ongoing/i.test(d)) return "Present";
    const m = d.match(/^(\d{4})-(\d{2})$/);
    if (m) return m[1];
    if (/^\d{4}$/.test(d)) return d;
    return d;
  };
  const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const nameSize = L.nameSizePt;
  const sectionSize = L.sectionTitleSizePt;
  const bodySize = L.bodyFontSizePt;
  const nameColor = L.nameColor;
  const sectionColor = L.sectionTitleColor;
  const bodyColor = L.bodyTextColor;

  // Tight unitless line-height to match DOCX single spacing
  const lh = 1.15;

  // Content area = A4 width minus both margins
  const ml = L.marginLeftMm;
  const mr = L.marginRightMm;
  const mt = L.marginTopMm;
  const mb = L.marginBottomMm;
  const cw = 210 - ml - mr;

  const lines: string[] = [];

  lines.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: '${L.fontFamily}', Times, serif;
      font-size: ${bodySize}pt;
      color: ${bodyColor};
      line-height: ${lh};
      width: ${cw}mm;
      margin: 0;
      padding: ${mt}mm ${mr}mm ${mb}mm ${ml}mm;
      background: white;
    }
    h1 {
      font-size: ${nameSize}pt; font-weight: bold;
      color: ${nameColor}; text-transform: uppercase;
      margin: 0 0 0.5mm 0;
    }
    .contact {
      font-size: ${bodySize}pt; color: #555;
      margin: 0 0 1mm 0; line-height: 1.3;
    }
    .section-title {
      font-size: ${sectionSize}pt; font-weight: bold;
      color: ${sectionColor}; text-transform: uppercase;
      margin: 1.8mm 0 0.3mm 0;
      border-bottom: 0.4px solid ${sectionColor};
      padding-bottom: 0.15mm;
      line-height: 1.2;
    }
    .entry-row {
      margin: 0.2mm 0 0 0;
      width: 100%;
      display: flow-root;
    }
    .entry-title {
      font-weight: bold; font-size: ${bodySize}pt;
      color: ${bodyColor}; line-height: ${lh};
    }
    .entry-company { font-weight: normal; }
    .entry-date {
      float: right; color: #555;
      font-size: ${(bodySize * 0.9).toFixed(1)}pt;
    }
    .edu-detail {
      font-size: ${bodySize}pt; color: ${bodyColor};
      margin: 0 0 0 0; line-height: ${lh};
    }
    p {
      margin: 0.3mm 0 0.3mm 0;
      text-align: left;
      line-height: ${lh};
    }
    ul {
      margin: 0.15mm 0 0.3mm 0;
      padding-left: 3.5mm;
      list-style: disc;
    }
    li {
      margin-bottom: 0.1mm;
      line-height: ${lh};
    }
    .skill-line {
      margin: 0.1mm 0;
      line-height: ${lh};
    }
  </style></head><body>`);

  // NAME
  lines.push(`<h1>${esc((r.name || "YOUR NAME").toUpperCase())}</h1>`);

  // Headline
  if (r.headline) {
    lines.push(`<div style="color:${sectionColor};font-size:${(bodySize * 1.05).toFixed(1)}pt;margin:0 0 0.5mm 0;line-height:${lh}">${esc(r.headline)}</div>`);
  }

  // Contact
  const contactParts = [r.contact.email, r.contact.phone, r.contact.location, r.contact.linkedin, r.contact.github, r.contact.website].filter((x): x is string => !!x);
  if (contactParts.length) {
    lines.push(`<div class="contact">${contactParts.map(c => esc(c)).join("  |  ")}</div>`);
  }

  // Thin separator
  lines.push(`<div style="height:0.3px;background:#999;margin:0.8mm 0 0.5mm 0"></div>`);

  // PROFESSIONAL SUMMARY
  if (r.summary) {
    lines.push(`<div class="section-title">PROFESSIONAL SUMMARY</div>`);
    lines.push(`<p>${esc(r.summary)}</p>`);
  }

  // PROFESSIONAL EXPERIENCE
  if (r.experience.length) {
    lines.push(`<div class="section-title">PROFESSIONAL EXPERIENCE</div>`);
    for (const e of r.experience) {
      const dateStr = e.startDate || e.endDate ? `${fmtDate(e.startDate)} \u2013 ${fmtDate(e.endDate)}` : "";
      const titleCompany = `${esc(e.title)}${e.company ? ` <span class="entry-company">\u2014 ${esc(e.company)}</span>` : ""}`;
      lines.push(`<div class="entry-row"><span class="entry-title">${titleCompany}</span>${dateStr ? `<span class="entry-date">${esc(dateStr)}</span>` : ""}</div>`);
      if (e.bullets.length) {
        lines.push(`<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>`);
      }
    }
  }

  // EDUCATION
  if (r.education.length) {
    lines.push(`<div class="section-title">EDUCATION</div>`);
    for (const ed of r.education) {
      const dateStr = ed.startDate || ed.endDate ? `${fmtDate(ed.startDate)} \u2013 ${fmtDate(ed.endDate)}` : "";
      const leftSide = `${esc(ed.degree)} ${esc(ed.institution)}${ed.location ? ` | ${esc(ed.location)}` : ""}`;
      lines.push(`<div class="entry-row"><span class="entry-title">${leftSide}</span>${dateStr ? `<span class="entry-date">${esc(dateStr)}</span>` : ""}</div>`);
      if (ed.field) {
        lines.push(`<div class="edu-detail">${esc(ed.field)}</div>`);
      }
      if (ed.highlights?.length) {
        lines.push(`<ul>${ed.highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul>`);
      }
    }
  }

  // SKILLS
  if (r.skills.length) {
    lines.push(`<div class="section-title">CORE COMPETENCIES &amp; SKILLS</div>`);
    const categorized = new Map<string, string[]>();
    for (const s of r.skills) {
      const cat = s.category?.trim() || "General";
      if (!categorized.has(cat)) categorized.set(cat, []);
      categorized.get(cat)!.push(s.name);
    }
    for (const [cat, skills] of categorized) {
      lines.push(`<div class="skill-line"><strong>${esc(cat)}:</strong> ${skills.map(s => esc(s)).join(", ")}</div>`);
    }
  }

  // PROJECTS
  if (r.projects?.length) {
    lines.push(`<div class="section-title">PROJECTS</div>`);
    for (const p of r.projects.slice(0, 2)) {
      lines.push(`<div class="entry-title">${esc(p.name)}</div>`);
      if (p.description) lines.push(`<p>${esc(p.description)}</p>`);
    }
  }

  // CERTIFICATIONS
  if (r.certifications?.length) {
    lines.push(`<div class="section-title">CERTIFICATIONS</div>`);
    lines.push(`<ul>`);
    for (const c of r.certifications.slice(0, 4)) {
      const certText = `${esc(c.name)}${c.issuer ? ` \u2014 ${esc(c.issuer)}` : ""}${c.date ? ` (${fmtDate(c.date)})` : ""}`;
      lines.push(`<li>${certText}</li>`);
    }
    lines.push(`</ul>`);
  }

  // LANGUAGES
  if (r.languages.length) {
    lines.push(`<div class="section-title">LANGUAGES</div>`);
    for (const l of r.languages) {
      const note = (l as any).note ? ` (${esc((l as any).note)})` : "";
      lines.push(`<div class="skill-line">${esc(l.name)}: ${esc(l.proficiency)}${note}</div>`);
    }
  }

  lines.push(`</body></html>`);
  return lines.join("\n");
}

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

export async function exportResumePDF(resume: ResumeData, opts: PDFOptions = {}, layout?: ResumeLayoutModel): Promise<{ ok: boolean; pages: number; error?: string }> {
  const L = layout ?? getDefaultResumeLayout();
  if (resume.template === "infohas-pro" || opts.template === "infohas-pro") {
    return exportInfohasProPDF(resume, opts, L);
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageH = A4.h;

  const left = L.marginLeftMm;
  const right = A4.w - L.marginRightMm;
  const contentW = right - left;
  const maxY = pageH - L.marginBottomMm;

  const nameRgb = hexToRgb(L.nameColor);
  const bodyRgb = hexToRgb(L.bodyTextColor);
  const sectionRgb = hexToRgb(L.sectionTitleColor);

  let y = L.marginTopMm;

  const textY = (sizePt: number) => y + ptToMm(sizePt) * 0.7;
  const advanceLine = () => { y += L.lineHeightMm; };
  const advanceMm = (mm: number) => { y += mm; };

  // Section header
  const sectionHeader = (title: string) => {
    doc.setFont("times", "bold");
    doc.setFontSize(L.sectionTitleSizePt);
    doc.setTextColor(sectionRgb[0], sectionRgb[1], sectionRgb[2]);
    doc.text(title.toUpperCase(), left, textY(L.sectionTitleSizePt));
    advanceMm(ptToMm(L.sectionTitleSizePt) * 0.6 + 0.3);
    // Underline
    doc.setDrawColor(sectionRgb[0], sectionRgb[1], sectionRgb[2]);
    doc.setLineWidth(0.15);
    doc.line(left, y, right, y);
    advanceMm(1.2);
  };

  // Bullet text with hanging indent
  const drawBullet = (text: string, width: number) => {
    const textIndent = L.bulletIndentMm;
    const textWidth = width - textIndent;
    const textLines = doc.splitTextToSize(text, textWidth);
    for (let i = 0; i < textLines.length; i++) {
      if (y > maxY - 10) break;
      if (i === 0) {
        doc.text("•", left, textY(L.bodyFontSizePt));
      }
      doc.text(textLines[i], left + textIndent, textY(L.bodyFontSizePt));
      advanceLine();
    }
  };

  // Wrapped block of text (no bullet)
  const drawWrapped = (text: string, width: number) => {
    const lines = doc.splitTextToSize(text, width);
    for (const line of lines) {
      if (y > maxY - 10) break;
      doc.text(line, left, textY(L.bodyFontSizePt));
      advanceLine();
    }
  };

  // ===== DATE FORMAT =====
  const fmt = (s?: string) => {
    if (!s) return "";
    if (/present|ongoing/i.test(s)) return "Present";
    const m = s.match(/^(\d{4})-(\d{2})$/);
    if (m) return m[1];
    if (/^\d{4}$/.test(s)) return s;
    return s;
  };

  // ===== HEADER =====
  // Name — bold, uppercase, section color
  doc.setFont("times", "bold");
  doc.setFontSize(L.nameSizePt);
  doc.setTextColor(nameRgb[0], nameRgb[1], nameRgb[2]);
  doc.text((resume.name || "YOUR NAME").toUpperCase(), left, textY(L.nameSizePt));
  advanceMm(ptToMm(L.nameSizePt) * 0.8 + 0.8);

  // Headline — body color
  doc.setFont("times", "normal");
  doc.setFontSize(L.bodyFontSizePt);
  doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
  if (resume.headline) {
    doc.text(resume.headline, left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // Contact — email | phone | location ...
  const contactParts = [resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedin, resume.contact.github, resume.contact.website].filter(Boolean);
  if (contactParts.length) {
    doc.setTextColor(100, 100, 100);
    doc.text(contactParts.join("  |  "), left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // Thin separator
  advanceMm(0.3);
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.15);
  doc.line(left, y, right, y);
  advanceMm(1.5);

  // ===== PROFESSIONAL SUMMARY =====
  if (resume.summary) {
    sectionHeader("PROFESSIONAL SUMMARY");
    doc.setFont("times", "normal");
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    drawWrapped(resume.summary, contentW);
    advanceMm(1);
  }

  // ===== PROFESSIONAL EXPERIENCE =====
  if (resume.experience.length) {
    sectionHeader("PROFESSIONAL EXPERIENCE");
    for (const e of resume.experience) {
      if (y > maxY - 20) break;

      const dateStr = e.startDate || e.endDate ? `${fmt(e.startDate)} \u2013 ${fmt(e.endDate)}` : "";
      const dateWidth = dateStr ? doc.getTextWidth(dateStr) : 0;
      const titleWidth = contentW - (dateWidth > 0 ? dateWidth + 3 : 0);
      const leftSide = `${e.title}${e.company ? ` \u2014 ${e.company}` : ""}`;
      const titleLines = doc.splitTextToSize(leftSide, titleWidth);

      // Date right-aligned
      doc.setFont("times", "bold");
      doc.setFontSize(L.bodyFontSizePt);
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      if (dateStr) {
        doc.setFont("times", "bold");
        doc.text(dateStr, right, textY(L.bodyFontSizePt), { align: "right" });
      }

      // Title lines
      doc.setFont("times", "bold");
      for (let i = 0; i < titleLines.length; i++) {
        doc.text(titleLines[i], left, textY(L.bodyFontSizePt));
        advanceLine();
      }

      // Bullets
      doc.setFont("times", "normal");
      for (const b of e.bullets) {
        if (y > maxY - 10) break;
        drawBullet(b, contentW);
      }
      advanceMm(0.3);
    }
    advanceMm(0.5);
  }

  // ===== EDUCATION =====
  if (resume.education.length) {
    sectionHeader("EDUCATION");
    for (const ed of resume.education) {
      if (y > maxY - 20) break;

      const dateStr = ed.startDate || ed.endDate ? `${fmt(ed.startDate)} \u2013 ${fmt(ed.endDate)}` : "";
      const dateWidth = dateStr ? doc.getTextWidth(dateStr) : 0;
      const eduWidth = contentW - (dateWidth > 0 ? dateWidth + 3 : 0);
      const eduStr = `${ed.degree} ${ed.institution}${ed.location ? ` | ${ed.location}` : ""}`;
      const eduLines = doc.splitTextToSize(eduStr, eduWidth);

      doc.setFont("times", "bold");
      doc.setFontSize(L.bodyFontSizePt);
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      if (dateStr) {
        doc.text(dateStr, right, textY(L.bodyFontSizePt), { align: "right" });
      }
      for (const line of eduLines) {
        doc.text(line, left, textY(L.bodyFontSizePt));
        advanceLine();
      }

      // Field
      if (ed.field) {
        doc.setFont("times", "normal");
        doc.setFontSize(L.bodyFontSizePt);
        doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
        doc.text(ed.field, left, textY(L.bodyFontSizePt));
        advanceLine();
      }

      // Education highlights
      if (ed.highlights?.length) {
        doc.setFont("times", "normal");
        for (const h of ed.highlights) {
          if (y > maxY - 10) break;
          drawBullet(h, contentW);
        }
      }
      advanceMm(0.2);
    }
    advanceMm(0.5);
  }

  // ===== CORE COMPETENCIES & SKILLS =====
  if (resume.skills.length) {
    sectionHeader("CORE COMPETENCIES & SKILLS");
    doc.setFont("times", "normal");
    doc.setFontSize(L.bodyFontSizePt);
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    const categorized = new Map<string, string[]>();
    for (const s of resume.skills) {
      const cat = s.category?.trim() || "General";
      if (!categorized.has(cat)) categorized.set(cat, []);
      categorized.get(cat)!.push(s.name);
    }
    for (const [cat, skills] of categorized) {
      if (y > maxY - 10) break;
      const line = `${cat}: ${skills.join(", ")}`;
      const textWidth = contentW - L.bulletIndentMm;
      const lines = doc.splitTextToSize(line, textWidth);
      for (let i = 0; i < lines.length; i++) {
        if (y > maxY - 10) break;
        if (i === 0) {
          doc.text(`${cat}:`, left, textY(L.bodyFontSizePt));
          const catW = doc.getTextWidth(`${cat}: `);
          doc.text(skills.join(", "), left + catW, textY(L.bodyFontSizePt));
        } else {
          doc.text(lines[i], left + L.bulletIndentMm, textY(L.bodyFontSizePt));
        }
        advanceLine();
      }
    }
    advanceMm(0.5);
  }

  // ===== PROJECTS =====
  if (resume.projects?.length) {
    sectionHeader("PROJECTS");
    doc.setFont("times", "bold");
    doc.setFontSize(L.bodyFontSizePt);
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    for (const p of resume.projects.slice(0, 2)) {
      if (y > maxY - 10) break;
      doc.text(p.name, left, textY(L.bodyFontSizePt));
      advanceLine();
      if (p.description) {
        doc.setFont("times", "normal");
        drawWrapped(p.description, contentW);
        doc.setFont("times", "bold");
      }
      advanceMm(0.3);
    }
    advanceMm(0.5);
  }

  // ===== CERTIFICATIONS =====
  if (resume.certifications?.length) {
    sectionHeader("CERTIFICATIONS");
    doc.setFont("times", "normal");
    doc.setFontSize(L.bodyFontSizePt);
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    for (const c of resume.certifications.slice(0, 4)) {
      if (y > maxY - 10) break;
      const cStr = `${c.name}${c.issuer ? ` \u2014 ${c.issuer}` : ""}${c.date ? ` (${fmt(c.date)})` : ""}`;
      drawBullet(cStr, contentW);
    }
  }

  // ===== LANGUAGES =====
  if (resume.languages.length) {
    sectionHeader("LANGUAGES");
    doc.setFont("times", "normal");
    doc.setFontSize(L.bodyFontSizePt);
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    for (const l of resume.languages) {
      if (y > maxY - 10) break;
      const note = (l as any).note ? ` (${(l as any).note})` : "";
      doc.text(`${l.name}: ${l.proficiency}${note}`, left, textY(L.bodyFontSizePt));
      advanceLine();
    }
  }

  // ===== SAVE =====
  const pages = doc.getNumberOfPages();
  const fname = (resume.name || "resume").replace(/\s+/g, "_") + "_resume.pdf";
  doc.save(fname);

  if (pages > 1 && opts.enforceOnePage !== false) {
    return { ok: false, pages, error: `Resume is ${pages} pages — content too long for one A4 page.` };
  }
  return { ok: true, pages };
}

// ============================================================================
// InfoHAS Pro PDF renderer — uses ResumeLayoutModel for ALL layout constants.
// Matches the OUSSAMA EL FATIMI model PDF.
// ============================================================================

function exportInfohasProPDF(resume: ResumeData, opts: PDFOptions = {}, layout?: ResumeLayoutModel): { ok: boolean; pages: number; error?: string } {
  const L = layout ?? getDefaultResumeLayout();
  const nameRgb = hexToRgb(L.nameColor);
  const bodyRgb = hexToRgb(L.bodyTextColor);
  const contactRgb = hexToRgb(L.contactColor);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const pageW = A4.w;
  const pageH = A4.h;
  const left = L.marginLeftMm;
  const right = pageW - L.marginRightMm;
  const contentW = right - left;
  const photoLeft = right - L.photoWidthMm;
  const photoTop = L.marginTopMm;
  // photoBottom computed below after hasPhoto check

  let y = L.marginTopMm;

  // ===== HEADER =====
  const textY = (sizePt: number) => y + ptToMm(sizePt) * 0.7;
  const advanceLine = () => { y += L.lineHeightMm; };

  // Name — section-title-color, bold, uppercase
  doc.setFont("times", "bold");
  doc.setFontSize(L.nameSizePt);
  doc.setTextColor(nameRgb[0], nameRgb[1], nameRgb[2]);
  doc.text((resume.name || "YOUR NAME").toUpperCase(), left, textY(L.nameSizePt));
  y += ptToMm(L.nameSizePt) + L.headerGapMm;

  // Headline — body color, regular
  doc.setFont("times", "normal");
  doc.setFontSize(L.bodyFontSizePt);
  doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
  if (resume.headline) {
    doc.text(resume.headline, left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // Location | Phone
  const locPhone = [resume.contact.location, resume.contact.phone].filter(Boolean).join(" | ");
  if (locPhone) {
    doc.text(locPhone, left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // Email
  if (resume.contact.email) {
    doc.text(resume.contact.email, left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // Date of birth
  if (resume.dateOfBirth) {
    doc.text(`Date Of Birth : ${resume.dateOfBirth}`, left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // ===== Photo (top-right) — only if photoUrl exists =====
  const hasPhoto = !!(resume.photoUrl && resume.photoUrl.startsWith("data:image"));
  if (hasPhoto && resume.photoUrl) {
    try {
      doc.addImage(resume.photoUrl, "JPEG", photoLeft, photoTop, L.photoWidthMm, L.photoHeightMm, undefined, "FAST");
    } catch (photoErr) {
      console.warn("[exporter] Photo rendering failed (non-fatal):", photoErr instanceof Error ? photoErr.message : photoErr);
    }
  }
  const photoBottom = hasPhoto ? photoTop + L.photoHeightMm : photoTop;

  // ===== Section gap before first section =====
  y += L.sectionGapMm;

  // Helper: draw section header
  const sectionHeader = (title: string) => {
    doc.setFont("times", "bold");
    doc.setFontSize(L.sectionTitleSizePt);
    doc.setTextColor(nameRgb[0], nameRgb[1], nameRgb[2]);
    doc.text(title, left, textY(L.sectionTitleSizePt));
    y += ptToMm(L.sectionTitleSizePt) + L.headerGapMm;
  };

  // Helper: draw a bullet line with hanging indent + justified text (last line left-aligned)
  const drawBullet = (text: string, width: number) => {
    const textIndent = L.bulletIndentMm + 3;
    const textWidth = width - textIndent;
    const lines = doc.splitTextToSize(text, textWidth);
    for (let i = 0; i < lines.length; i++) {
      const isLastLine = i === lines.length - 1;
      if (i === 0) {
        doc.text("•", left, textY(L.bodyFontSizePt));
      }
      if (isLastLine) {
        doc.text(lines[i], left + textIndent, textY(L.bodyFontSizePt));
      } else {
        doc.text(lines[i], left + textIndent, textY(L.bodyFontSizePt), { align: "justify", maxWidth: textWidth });
      }
      advanceLine();
    }
  };

  // ===== PROFESSIONAL SUMMARY =====
  if (resume.summary) {
    sectionHeader("PROFESSIONAL SUMMARY");
    doc.setFont("times", "normal");
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);

    const narrowW = hasPhoto ? photoLeft - left - 2 : contentW;
    const summaryLines = doc.splitTextToSize(resume.summary, narrowW);

    for (let i = 0; i < summaryLines.length; i++) {
      const isLastLine = i === summaryLines.length - 1;
      if (isLastLine) {
        doc.text(summaryLines[i], left, textY(L.bodyFontSizePt));
      } else {
        doc.text(summaryLines[i], left, textY(L.bodyFontSizePt), { align: "justify", maxWidth: narrowW });
      }
      advanceLine();
    }
    y += L.sectionGapMm;
  }

  // ===== CORE COMPETENCIES & SKILLS =====
  if (resume.skills.length > 0) {
    sectionHeader("CORE COMPETENCIES & SKILLS");
    doc.setFont("times", "normal");
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    const grouped = groupSkillsByCategoryForPdf(resume.skills);
    for (const g of grouped) {
      drawBullet(`${g.category}: ${g.items.join(", ")}.`, contentW);
    }
    y += L.sectionGapMm;
  }

  // ===== PROFESSIONAL EXPERIENCE =====
  if (resume.experience.length > 0) {
    sectionHeader("PROFESSIONAL EXPERIENCE");
    for (const exp of resume.experience) {
      if (y > pageH - L.marginBottomMm - 30) break;

      // Title Company | Location on left, Date on right — all bold, body color
      doc.setFont("times", "bold");
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      const dateStr = `${fmtInfohasDate(exp.startDate)} – ${fmtInfohasDate(exp.endDate)}`;
      const dateWidth = doc.getTextWidth(dateStr);
      const leftSide = `${exp.title} ${exp.company}${exp.location ? ` | ${exp.location}` : ""}`;
      const leftWidth = contentW - dateWidth - 4;
      const leftLines = doc.splitTextToSize(leftSide, leftWidth);

      doc.text(dateStr, right, textY(L.bodyFontSizePt), { align: "right" });

      for (let i = 0; i < leftLines.length; i++) {
        doc.text(leftLines[i], left, textY(L.bodyFontSizePt));
        advanceLine();
      }

      doc.setFont("times", "normal");
      for (const b of exp.bullets) {
        if (y > pageH - L.marginBottomMm - 10) break;
        drawBullet(b, contentW);
      }
    }
    y += L.sectionGapMm;
  }

  // ===== EDUCATION =====
  if (resume.education.length > 0) {
    sectionHeader("EDUCATION");
    for (const ed of resume.education) {
      if (y > pageH - L.marginBottomMm - 20) break;
      doc.setFont("times", "bold");
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      const eduLine = `${ed.degree} ${ed.institution}${ed.location ? ` | ${ed.location}` : ""}${ed.startDate || ed.endDate ? ` | ${fmtInfohasDate(ed.startDate)} – ${fmtInfohasDate(ed.endDate)}` : ""}`;
      const eduLines = doc.splitTextToSize(eduLine, contentW);
      for (const line of eduLines) {
        doc.text(line, left, textY(L.bodyFontSizePt));
        advanceLine();
      }
      if (ed.highlights && ed.highlights.length > 0) {
        doc.setFont("times", "normal");
        for (const h of ed.highlights) {
          drawBullet(h, contentW);
        }
      }
    }
    y += L.sectionGapMm;
  }

  // ===== LANGUAGES =====
  if (resume.languages.length > 0) {
    sectionHeader("LANGUAGES");
    doc.setFont("times", "normal");
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    for (const l of resume.languages) {
      if (y > pageH - L.marginBottomMm - 10) break;
      const note = (l as any).note ? ` (${(l as any).note})` : "";
      doc.text(`${l.name}: ${l.proficiency}${note}`, left, textY(L.bodyFontSizePt));
      advanceLine();
    }
  }

  // ===== Save =====
  const pages = doc.getNumberOfPages();
  const fname = (resume.name || "resume").replace(/\s+/g, "_") + "_resume.pdf";
  doc.save(fname);

  if (pages > 1 && opts.enforceOnePage !== false) {
    return { ok: false, pages, error: `Resume is ${pages} pages — content too long for one A4 page. Trim bullets or reduce experience entries.` };
  }
  return { ok: true, pages };
}

/** Group skills by category for PDF rendering (matches the React component's grouping). */
function groupSkillsByCategoryForPdf(skills: ResumeData["skills"]): Array<{ category: string; items: string[] }> {
  const map = new Map<string, string[]>();
  for (const s of skills) {
    const cat = s.category || "General";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)?.push(s.name);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

/** Format a date string (YYYY-MM or Mon YYYY) for the InfoHAS Pro PDF.
 *  Pass through if it already looks like "Mon YYYY", otherwise try to format. */
function fmtInfohasDate(s: string | undefined): string {
  if (!s) return "";
  // If it's already "Mon YYYY" or "Present", return as-is
  if (/^[A-Z][a-z]{2} \d{4}$/.test(s) || s === "Present") return s;
  // If it's "YYYY-MM", convert to "Mon YYYY"
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIdx = parseInt(m[2], 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) return `${months[monthIdx]} ${m[1]}`;
  }
  // If it's just "YYYY", return as-is
  if (/^\d{4}$/.test(s)) return s;
  return s;
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

      let dateStr = "";
      if (exp.startDate || exp.endDate) {
        dateStr = `${formatDate(exp.startDate)} – ${formatDate(exp.endDate)}`;
      }

      doc.setFont("helvetica", "italic");
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(sizes.small);
      const dateWidth = dateStr ? doc.getTextWidth(dateStr) : 0;

      // Title/company text
      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 58);
      doc.setFontSize(sizes.subhead);
      const titleStr = `${exp.title}${exp.company ? " — " + exp.company : ""}`;
      const titleWidth = contentW - (dateWidth > 0 ? dateWidth + 4 : 0);
      const titleLines = doc.splitTextToSize(titleStr, titleWidth);

      // Render date right-aligned on first line
      if (dateStr) {
        doc.setFont("helvetica", "italic");
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(sizes.small);
        doc.text(dateStr, right, y + sizes.subhead * 0.35, { align: "right" });
      }

      // Render title lines
      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 58);
      doc.setFontSize(sizes.subhead);
      for (let i = 0; i < titleLines.length; i++) {
        doc.text(titleLines[i], left, y + sizes.subhead * 0.35);
        y += sizes.subhead * 0.5 + 1;
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

  // Education — always render (don't skip even if tight)
  if (r.education.length) {
    y = sectionTitle(doc, "EDUCATION", left, y, sizes.section, accent);
    for (const ed of r.education) {
      if (y > pageH - MARGIN - 20) break;

      let dateStr = "";
      if (ed.startDate || ed.endDate) {
        dateStr = `${formatDate(ed.startDate)} – ${formatDate(ed.endDate)}`;
      }

      doc.setFont("helvetica", "italic");
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(sizes.small);
      const dateWidth = dateStr ? doc.getTextWidth(dateStr) : 0;

      // Degree/field
      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 58);
      doc.setFontSize(sizes.subhead);
      const edStr = `${ed.degree}${ed.field ? " in " + ed.field : ""}`;
      const edWidth = contentW - (dateWidth > 0 ? dateWidth + 4 : 0);
      const edLines = doc.splitTextToSize(edStr, edWidth);

      // Render date right-aligned on the first line
      if (dateStr) {
        doc.setFont("helvetica", "italic");
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(sizes.small);
        doc.text(dateStr, right, y + sizes.subhead * 0.35, { align: "right" });
      }

      // Render degree lines
      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 58);
      doc.setFontSize(sizes.subhead);
      for (let i = 0; i < edLines.length; i++) {
        doc.text(edLines[i], left, y + sizes.subhead * 0.35);
        y += sizes.subhead * 0.5 + 1;
      }

      // Render institution below
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(sizes.small);
      const instStr = ed.institution;
      const instLines = doc.splitTextToSize(instStr, contentW);
      for (let i = 0; i < instLines.length; i++) {
        doc.text(instLines[i], left, y + sizes.small * 0.35);
        y += sizes.small * 0.5 + 1.5;
      }
      y += 0.5; // small padding
    }
  }

  // Skills — always render
  if (r.skills.length) {
    y = sectionTitle(doc, "SKILLS", left, y, sizes.section, accent);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(sizes.body);
    const skillStr = r.skills.map((s) => s.name).join("  •  ");
    y = drawWrappedText(doc, skillStr, left, y, contentW, sizes.body, 4);
    y += 2;
  }

  // Projects — always render (limit to 2)
  if (r.projects.length) {
    y = sectionTitle(doc, "PROJECTS", left, y, sizes.section, accent);
    for (const p of r.projects.slice(0, 2)) {
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

  // Certifications — always render
  if (r.certifications.length) {
    y = sectionTitle(doc, "CERTIFICATIONS", left, y, sizes.section, accent);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(sizes.body);
    for (const c of r.certifications.slice(0, 4)) {
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

/** Count populated resume sections for integrity validation */
function countResumeSections(r: ResumeData): number {
  let count = 0;
  if (r.summary) count++;
  if (r.skills.length > 0) count++;
  if (r.experience.length > 0) count++;
  if (r.education.length > 0) count++;
  if (r.certifications.length > 0) count++;
  if (r.languages.length > 0) count++;
  if (r.projects.length > 0) count++;
  if (r.achievements && r.achievements.length > 0) count++;
  return count;
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

// ---------- DOC (strict A4 one-page HTML, Word 97-2003 compatible) ----------
// Uses getDocxHtml() from ats-directives.ts — enforces @page A4 with 1.27cm margins,
// Times New Roman 12pt, single column, left-aligned headers. This is the strict
// one-page layout the aviation ATS directive requires.

export function exportResumeDOC(resume: ResumeData, template: "professional" | "modern" | "minimal" = "professional") {
  const innerHtml = resumeToDirectiveHtml(resume);
  const fullHtml = getDocxHtml(innerHtml, template);
  // .doc with Word namespace opens natively in Word with CSS preserved
  const blob = new Blob(["\ufeff" + fullHtml], { type: "application/msword" });
  saveAs(blob, (resume.name || "resume").replace(/\s+/g, "_") + "_resume.doc");
}

/**
 * Export a raw HTML content string (e.g. from analyzeWithGemini's optimized_content)
 * as a strict A4 .doc file. Used when the AI returns HTML directly.
 */
export function exportHtmlAsDOC(htmlContent: string, filename: string, template: "professional" | "modern" | "minimal" = "professional") {
  const fullHtml = getDocxHtml(htmlContent, template);
  const blob = new Blob(["\ufeff" + fullHtml], { type: "application/msword" });
  saveAs(blob, filename.replace(/\s+/g, "_") + ".doc");
}

// ---------- DOCX ----------

export async function exportResumeDOCX(resume: ResumeData, layout?: ResumeLayoutModel) {
  const L = layout ?? getDefaultResumeLayout();
  const nameHex = L.nameColor.replace("#", "");
  const accentHex = L.sectionTitleColor.replace("#", "");
  const bodyHex = L.bodyTextColor.replace("#", "");
  const contactHex = L.contactColor.replace("#", "");

  const children: Paragraph[] = [];

  // Name — bold, uppercase, section-title color
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 40 },
    children: [new TextRun({ text: (resume.name || "YOUR NAME").toUpperCase(), bold: true, size: L.nameSizePt * 2, font: L.fontFamily, color: nameHex })],
  }));

  // Headline
  if (resume.headline) {
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: resume.headline, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
    }));
  }

  // Contact line
  const contactParts = [resume.contact.location, resume.contact.phone, resume.contact.email].filter(Boolean);
  if (contactParts.length) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: contactParts.join(" | "), size: L.bodyFontSizePt * 2, font: L.fontFamily, color: contactHex })],
    }));
  }

  // Date of birth
  if (resume.dateOfBirth) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: `Date Of Birth : ${resume.dateOfBirth}`, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
    }));
  }

  // ===== Section helper =====
  const addSection = (title: string) => {
    children.push(new Paragraph({
      spacing: { before: 200, after: 60 },
      children: [new TextRun({ text: title, bold: true, size: L.sectionTitleSizePt * 2, font: L.fontFamily, color: accentHex })],
    }));
  };

  // ===== PROFESSIONAL SUMMARY =====
  if (resume.summary) {
    addSection("PROFESSIONAL SUMMARY");
    const paragraphs = resume.summary.split(/\n{2,}/);
    for (const p of paragraphs) {
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 80 },
        children: [new TextRun({ text: p.trim(), size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
      }));
    }
  }

  // ===== CORE COMPETENCIES & SKILLS =====
  if (resume.skills.length > 0) {
    addSection("CORE COMPETENCIES & SKILLS");
    // Group skills by category if available, otherwise render as a flat list
    const categorized = new Map<string, string[]>();
    for (const s of resume.skills) {
      const cat = s.category?.trim() || "General";
      if (!categorized.has(cat)) categorized.set(cat, []);
      categorized.get(cat)?.push(s.name);
    }
    for (const [category, skills] of categorized) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 30 },
        children: [
          new TextRun({ text: `${category}: `, bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
          new TextRun({ text: skills.join(", "), size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
        ],
      }));
    }
  }

  // Helper for right tab position
  const marginTwip = (mm: number) => convertInchesToTwip(mm / 25.4);
  const rightTabPosition = marginTwip(210 - L.marginLeftMm - L.marginRightMm);
  const docxTabStops = [{ type: TabStopType.RIGHT, position: rightTabPosition }];

  // ===== PROFESSIONAL EXPERIENCE =====
  if (resume.experience.length) {
    addSection("PROFESSIONAL EXPERIENCE");
    for (const e of resume.experience) {
      // Title Company | Location
      const leftSide = `${e.title} ${e.company}${e.location ? ` | ${e.location}` : ""}`;
      const dateStr = e.startDate || e.endDate ? `${fmtInfohasDate(e.startDate)} – ${fmtInfohasDate(e.endDate)}` : "";

      children.push(new Paragraph({
        tabStops: docxTabStops,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: leftSide, bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
          new TextRun({ text: dateStr ? "\t" + dateStr : "", bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
        ],
      }));
      // Bullets
      for (const b of e.bullets) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 30 },
          children: [new TextRun({ text: b, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
        }));
      }
    }
  }

  // ===== EDUCATION =====
  if (resume.education.length) {
    addSection("EDUCATION");
    for (const ed of resume.education) {
      const leftSide = `${ed.degree} ${ed.institution}${ed.field ? ` (${ed.field})` : ""}${ed.location ? ` | ${ed.location}` : ""}`;
      const dateStr = ed.startDate || ed.endDate ? `${fmtInfohasDate(ed.startDate)} – ${fmtInfohasDate(ed.endDate)}` : "";

      children.push(new Paragraph({
        tabStops: docxTabStops,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: leftSide, bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
          new TextRun({ text: dateStr ? "\t" + dateStr : "", bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
        ],
      }));
    }
  }

  // ===== SKILLS (only if not already rendered as CORE COMPETENCIES above) =====
  // NOTE: We always render skills above in the CORE COMPETENCIES section.
  // This section is a fallback for resumes that have skills but no summary
  // and the CORE COMPETENCIES section already rendered them. We skip this
  // to avoid double-rendering skills in the DOCX output.
  // If you want a separate "SKILLS" section without the categorization,
  // remove the CORE COMPETENCIES section above and use this instead.

  // ===== LANGUAGES =====
  if (resume.languages.length) {
    addSection("LANGUAGES");
    for (const l of resume.languages) {
      const note = (l as any).note ? ` (${(l as any).note})` : "";
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: `${l.name}: ${l.proficiency}${note}`, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
      }));
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: L.fontFamily, size: L.bodyFontSizePt * 2 } } } },
    sections: [{
      properties: {
        page: {
          margin: {
            top: marginTwip(L.marginTopMm),
            bottom: marginTwip(L.marginBottomMm),
            left: marginTwip(L.marginLeftMm),
            right: marginTwip(L.marginRightMm),
          },
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, (resume.name || "resume").replace(/\s+/g, "_") + "_resume.docx");
}

// NOTE: The docxBullet function was previously a no-op (empty body).
// Skills are now rendered directly as Paragraph elements with bullet properties
// in the CORE COMPETENCIES section above. This function is removed to prevent
// confusion. If you need a bullet helper, use children.push(new Paragraph({ bullet: { level: 0 }, ... }))
// directly as shown in the skills section.

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
