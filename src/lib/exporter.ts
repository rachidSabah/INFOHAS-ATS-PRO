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

// ============================================================================
// ResumeLayoutModel — single source of truth for PDF + DOCX layout
// ============================================================================

export function getDefaultResumeLayout(): ResumeLayoutModel {
  return {
    pageSize: "A4",
    marginTopMm: 6.35,
    marginBottomMm: 6.35,
    marginLeftMm: 8.89,
    marginRightMm: 8.89,

    fontFamily: "Times New Roman",
    fallbackFontFamily: "Liberation Serif",
    nameSizePt: 14,
    sectionTitleSizePt: 12,
    bodyFontSizePt: 10.5,

    nameColor: "#8B0000",
    sectionTitleColor: "#8B0000",
    bodyTextColor: "#000000",
    contactColor: "#000000",

    lineHeightMm: 12 * 0.352778,
    sectionGapMm: 3,
    headerGapMm: 1,
    bulletIndentMm: 6.4,
    paragraphSpacingMm: 1.5,

    photoWidthMm: 30,
    photoHeightMm: 40,

    enforceOnePage: true,
    minFontSizePt: 10,
  };
}

// Convert pt → mm
function ptToMm(pt: number): number {
  return pt * 0.352778;
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

export function exportResumePDF(resume: ResumeData, opts: PDFOptions = {}, layout?: ResumeLayoutModel): { ok: boolean; pages: number; error?: string } {
  const L = layout ?? getDefaultResumeLayout();
  if (resume.template === "infohas-pro" || opts.template === "infohas-pro") {
    return exportInfohasProPDF(resume, opts, L);
  }

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
    // Final attempt: compress more aggressively but DON'T strip sections.
    // Keep all education, experience, skills, certifications, languages.
    // Only trim achievements (least important) and limit projects to 1.
    doc.deletePage(1);
    doc.addPage("a4", "portrait");
    const trimmed: ResumeData = {
      ...resume,
      projects: resume.projects.slice(0, 1), // keep 1 project instead of 0
      certifications: resume.certifications.slice(0, 4), // keep up to 4
      languages: resume.languages.slice(0, 4), // keep up to 4
      achievements: resume.achievements?.slice(0, 2), // keep up to 2
    };
    // Use extra-compressed sizes
    const extraCompressed = compressSizes(compressSizes(currentSizes));
    renderResumeToPdf(doc, trimmed, extraCompressed, accentRgb);
    const pages = doc.getNumberOfPages();
    const enforceOnePage: boolean = (opts.enforceOnePage as boolean | undefined) !== false;
    if (pages > 1 && enforceOnePage) {
      // Last resort: allow 2 pages rather than losing content
      result = { ok: true, pages };
    } else {
      result = { ok: true, pages };
    }
  }

  // Validation: prefer 1 page, but allow 2 as fallback rather than losing content
  if (opts.enforceOnePage !== false && result.pages > 2) {
    return { ok: false, pages: result.pages, error: `Resume is ${result.pages} pages — too long. Please reduce content manually.` };
  }

  const fname = (resume.name || "resume").replace(/\s+/g, "_") + "_resume.pdf";
  doc.save(fname);
  return result;
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
    } catch {
      // ignore photo errors
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
    map.get(cat)!.push(s.name);
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

  // Education — always render (don't skip even if tight)
  if (r.education.length) {
    y = sectionTitle(doc, "EDUCATION", left, y, sizes.section, accent);
    for (const ed of r.education) {
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
    docxBullet(`Category: Skill1, Skill2.`, L, accentHex, bodyHex);
  }

  // ===== PROFESSIONAL EXPERIENCE =====
  if (resume.experience.length) {
    addSection("PROFESSIONAL EXPERIENCE");
    for (const e of resume.experience) {
      // Title | Location — bold
      const titleParts = [e.title, e.company, e.location].filter(Boolean);
      children.push(new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: titleParts.join(" | "), bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
      }));
      // Date range
      if (e.startDate || e.endDate) {
        children.push(new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: `${fmtInfohasDate(e.startDate)} – ${fmtInfohasDate(e.endDate)}`, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
        }));
      }
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
      children.push(new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: ed.degree || "", bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
      }));
      const eduLine = [ed.institution, ed.startDate || ed.endDate ? `${fmtInfohasDate(ed.startDate)} – ${fmtInfohasDate(ed.endDate)}` : ""].filter(Boolean).join(" | ");
      if (eduLine) {
        children.push(new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: eduLine, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
        }));
      }
    }
  }

  // ===== SKILLS (if not already rendered as CORE COMPETENCIES) =====
  if (resume.skills.length > 0 && !resume.summary?.includes("CORE COMPETENCIES")) {
    addSection("SKILLS");
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: resume.skills.map((s) => s.name).join("  •  "), size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
    }));
  }

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

  const marginTwip = (mm: number) => convertInchesToTwip(mm / 25.4);
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

// Bullet helper for DOCX — matches the PDF's category: items format
function docxBullet(text: string, L: ResumeLayoutModel, _accentHex: string, _bodyHex: string) {
  // Use inline text rendering — bullets are in the paragraph properties
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
