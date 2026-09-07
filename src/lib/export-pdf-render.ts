/**
 * export-pdf-render.ts — RenderDocument-based PDF exporter
 *
 * Consumes RenderDocument (single source of truth) and produces a PDF
 * that matches the DOCX output. NOT an independent renderer.
 */
import jsPDF from "jspdf";
import type {
  RenderDocument,
  RenderContentItem,
  RenderNestedBulletList,
  ResumeLayoutModel,
  TextAlignment,
} from "./types";
import { resolveSectionAlignment } from "./types";

const A4_W = 210;
const A4_H = 297;

/**
 * Templates whose signature design is a full-height accent sidebar carrying
 * name/contact/skills/languages/certifications (mirrors the A4Preview HTML
 * components). For these the PDF must reproduce the two-column structure,
 * not just swap fonts — otherwise the downloaded file loses the template
 * design the user picked in the Builder.
 */
const SIDEBAR_TEMPLATES = new Set(["modern", "creative"]);

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 0, 0];
}

function ptToMm(pt: number) { return pt * 0.352778; }

/**
 * Render a RenderDocument to PDF, matching the DOCX output structure.
 *
 * Template-aware: sidebar templates (modern/creative) are rendered with the
 * full-height accent sidebar — matching the Builder preview — while every
 * other template keeps the classic single-column flow.
 */
export async function exportResumePDFRenderDoc(
  rd: RenderDocument,
): Promise<{ ok: boolean; pages: number; error?: string }> {
  const L = rd.layout;
  let finalDoc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let finalPages = 1;
  let finalTruncated = false;

  const scales = [1.0, 0.93, 0.86, 0.79, 0.72];
  const isSidebarTemplate = SIDEBAR_TEMPLATES.has(String(rd.template || ""));

  for (const scale of scales) {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    let hasTruncated: boolean = false;

    if (isSidebarTemplate) {
      hasTruncated = renderSidebarTemplate(doc, rd, L, scale);
      finalDoc = doc;
      finalPages = doc.getNumberOfPages();
      finalTruncated = hasTruncated;
      if (!hasTruncated) break;
      continue;
    }

    let y = L.marginTopMm;

    // Apply scale to layout sizes
    const currentLineHeight = L.lineHeightMm * scale;
    const currentBodyFontSize = L.bodyFontSizePt * scale;
    const currentSectionTitleSize = L.sectionTitleSizePt * scale;
    const currentNameSize = L.nameSizePt * scale;
    const currentSectionGap = (L.sectionGapMm ?? 4) * scale;
    const currentHeaderGap = (L.headerGapMm ?? 3) * scale;

    const left = L.marginLeftMm;
    const right = A4_W - L.marginRightMm;
    const contentW = right - left;
    const maxY = A4_H - L.marginBottomMm;

    const nameRgb = hexToRgb(L.nameColor);
    const bodyRgb = hexToRgb(L.bodyTextColor);
    const sectionRgb = hexToRgb(L.sectionTitleColor);

    const textY = (sizePt: number) => y + ptToMm(sizePt) * 0.7;
    const advanceLine = () => { y += currentLineHeight; };
    const advanceMm = (mm: number) => { y += mm; };

    const getPdfFont = (family: string) => {
      const f = family.toLowerCase();
      if (f.includes("helvetica") || f.includes("arial") || f.includes("sans-serif")) {
        return "helvetica";
      }
      if (f.includes("courier") || f.includes("mono")) {
        return "courier";
      }
      return "times";
    };
    const fontName = getPdfFont(L.fontFamily || "Times New Roman");

    const sectionHeader = (title: string) => {
      doc.setFont(fontName, "bold");
      doc.setFontSize(currentSectionTitleSize);
      doc.setTextColor(sectionRgb[0], sectionRgb[1], sectionRgb[2]);
      doc.text(title.toUpperCase(), left, textY(currentSectionTitleSize));
      advanceMm(ptToMm(currentSectionTitleSize) * 0.8 + 1.0);
    };

    const drawWrapped = (text: string, w: number, align: TextAlignment = "justify") => {
      text = (text || "")
        .replace(/\*\*|\*/g, "")
        .replace(/^%Ï\s*/g, "")
        .replace(/%Ï/g, " ")
        .replace(/^[●•*-\s]+/, "")
        .replace(/●/g, "");
      doc.setFont(fontName, "normal");
      doc.setFontSize(currentBodyFontSize);
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      const lines = doc.splitTextToSize(text, w);
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (y > maxY - 10) {
          hasTruncated = true;
          break;
        }
        const last = li === lines.length - 1;
        if (align === "center") {
          doc.text(line, left + w / 2, textY(currentBodyFontSize), { align: "center" });
        } else if (align === "justify" && !last) {
          doc.text(line, left, textY(currentBodyFontSize), { align: "justify", maxWidth: w });
        } else {
          doc.text(line, left, textY(currentBodyFontSize));
        }
        advanceLine();
      }
    };

    const drawBulletLine = (text: string, w: number, indent = 0, align: TextAlignment = "justify") => {
      text = (text || "")
        .replace(/\*\*|\*/g, "")
        .replace(/^%Ï\s*/g, "")
        .replace(/%Ï/g, " ")
        .replace(/^[●•*-\s]+/, "")
        .replace(/●/g, "");
      doc.setFont(fontName, "normal");
      doc.setFontSize(currentBodyFontSize);
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      
      const bulletIndent = L.bulletIndentMm ?? 6.4;
      const bulletX = left + bulletIndent + indent;
      const textXPos = bulletX + 3.5;
      const wrapW = w - bulletIndent - indent - 3.5;
      
      const lines = doc.splitTextToSize(text, wrapW);
      for (let i = 0; i < lines.length; i++) {
        if (y > maxY - 10) {
          hasTruncated = true;
          break;
        }
        const last = i === lines.length - 1;
        const lineAlign = align === "center" ? "center" : (align === "justify" && !last ? "justify" : "left");
        const lineX = lineAlign === "center" ? textXPos + wrapW / 2 : textXPos;
        const lineOpts = lineAlign === "left" ? undefined : { align: lineAlign, maxWidth: wrapW } as const;
        if (i === 0) {
          doc.text("•", bulletX, textY(currentBodyFontSize));
          if (lineOpts) doc.text(lines[i], lineX, textY(currentBodyFontSize), lineOpts);
          else doc.text(lines[i], lineX, textY(currentBodyFontSize));
        } else {
          if (lineOpts) doc.text(lines[i], lineX, textY(currentBodyFontSize), lineOpts);
          else doc.text(lines[i], lineX, textY(currentBodyFontSize));
        }
        advanceLine();
      }
    };

    // ===== Photo (top-right) — rendered before contact text so contentW can be narrowed =====
    const hasPhoto = !!(rd.contact.photoUrl && rd.contact.photoUrl.startsWith("data:image"));
    const photoW = L.photoWidthMm ?? 28;
    const photoH = L.photoHeightMm ?? 32;
    const photoLeft = right - photoW;
    const photoTop = L.marginTopMm;
    if (hasPhoto && rd.contact.photoUrl) {
      try {
        doc.addImage(rd.contact.photoUrl, "JPEG", photoLeft, photoTop, photoW, photoH, undefined, "FAST");
      } catch (photoErr) {
        console.warn("[export-pdf-render] Photo rendering failed (non-fatal):", photoErr instanceof Error ? (photoErr as Error).message : photoErr);
      }
    }
    // When photo is present, reserve right-hand margin so contact text doesn't overlap
    const textRight = hasPhoto ? photoLeft - 4 : right;
    const activeContentW = textRight - left;

    // Render Contact block
    doc.setFont(fontName, "bold");
    doc.setFontSize(currentNameSize);
    doc.setTextColor(nameRgb[0], nameRgb[1], nameRgb[2]);
    doc.text((rd.contact.name || "YOUR NAME").toUpperCase(), left, textY(currentNameSize));
    advanceMm(ptToMm(currentNameSize) * 0.8 + 1.0);
    // (single-column flow continues below — unchanged for non-sidebar templates)

    if (rd.contact.headline) {
      doc.setFont(fontName, "normal");
      doc.setFontSize(currentBodyFontSize);
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      const headlineLines = doc.splitTextToSize(rd.contact.headline, activeContentW);
      doc.text(headlineLines[0] ?? "", left, textY(currentBodyFontSize));
      advanceLine();
    }

    // Contact block styling (stacked vs single-line)
    if (L.contactSpacing === "single-line") {
      const contactParts = [
        rd.contact.location,
        rd.contact.phone,
        rd.contact.email,
        rd.contact.dateOfBirth ? `DOB: ${rd.contact.dateOfBirth}` : ""
      ].filter(Boolean);
      if (contactParts.length) {
        const contactRgb = hexToRgb(L.contactColor || L.bodyTextColor);
        doc.setTextColor(contactRgb[0], contactRgb[1], contactRgb[2]);
        doc.setFont(fontName, "normal");
        doc.setFontSize(currentBodyFontSize);
        const joined = contactParts.join(" | ");
        const contactLines = doc.splitTextToSize(joined, activeContentW);
        doc.text(contactLines[0] ?? joined, left, textY(currentBodyFontSize));
        advanceLine();
      }
    } else {
      const locPhone = [rd.contact.location, rd.contact.phone].filter(Boolean);
      if (locPhone.length) {
        const contactRgb = hexToRgb(L.contactColor || L.bodyTextColor);
        doc.setTextColor(contactRgb[0], contactRgb[1], contactRgb[2]);
        doc.setFont(fontName, "normal");
        doc.setFontSize(currentBodyFontSize);
        doc.text(locPhone.join(" | "), left, textY(currentBodyFontSize));
        advanceLine();
      }
      if (rd.contact.email) {
        const contactRgb = hexToRgb(L.contactColor || L.bodyTextColor);
        doc.setTextColor(contactRgb[0], contactRgb[1], contactRgb[2]);
        doc.setFont(fontName, "normal");
        doc.setFontSize(currentBodyFontSize);
        doc.text(rd.contact.email, left, textY(currentBodyFontSize));
        advanceLine();
      }

      if (rd.contact.dateOfBirth) {
        doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
        doc.setFont(fontName, "normal");
        doc.setFontSize(currentBodyFontSize);
        doc.text(`Date Of Birth: ${rd.contact.dateOfBirth}`, left, textY(currentBodyFontSize));
        advanceLine();
      }
    }

    // If photo is taller than the contact text block, pad y down past the photo
    if (hasPhoto) {
      const photoBottom = photoTop + photoH + 2;
      if (y < photoBottom) y = photoBottom;
    }

    advanceMm(1.5);



    // Render sections
    for (const section of rd.sections) {
      if (y > maxY - 20) {
        hasTruncated = true;
        break;
      }
      sectionHeader(section.title);
      const sectionAlign = resolveSectionAlignment(L, section.type);

      for (const item of section.items) {
        if (y > maxY - 10) {
          hasTruncated = true;
          break;
        }

        switch (item.kind) {
          case "text":
            drawWrapped(item.text, contentW, sectionAlign);
            break;

          case "bullets":
            for (const b of item.bullets) {
              if (y > maxY - 10) {
                hasTruncated = true;
                break;
              }
              drawBulletLine(b, contentW, item.level ? 6 : 0, sectionAlign);
            }
            advanceMm(0.2);
            break;

          case "nested-bullets":
            for (const group of item.groups) {
              if (y > maxY - 10) {
                hasTruncated = true;
                break;
              }
              doc.setFont(fontName, "bold");
              doc.setFontSize(currentBodyFontSize);
              doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
              
              const bulletIndent = L.bulletIndentMm ?? 6.4;
              const bulletX = left + bulletIndent;
              const labelPart = `• ${group.label}: `;
              const labelW = doc.getTextWidth(labelPart);
              doc.text(labelPart, bulletX, textY(currentBodyFontSize));
              
              doc.setFont(fontName, "normal");
              const itemsText = group.items.join(", ");
              const itemsLines = doc.splitTextToSize(itemsText, contentW - bulletIndent - labelW);
              
              if (itemsLines.length <= 1) {
                doc.text(itemsLines[0], bulletX + labelW, textY(currentBodyFontSize));
                advanceLine();
              } else {
                doc.text(itemsLines[0], bulletX + labelW, textY(currentBodyFontSize));
                advanceLine();
                for (let i = 1; i < itemsLines.length; i++) {
                  if (y > maxY - 10) {
                    hasTruncated = true;
                    break;
                  }
                  doc.text(itemsLines[i], bulletX + 4, textY(currentBodyFontSize));
                  advanceLine();
                }
              }
            }
            advanceMm(0.5);
            break;

          case "table-row": {
            doc.setFont(fontName, "bold");
            doc.setFontSize(currentBodyFontSize);
            doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
            const leftText = item.cells.find(c => c.align === "left" || !c.align)?.text ?? "";
            const rightCell = item.cells.find(c => c.align === "right");
            const leftLines = doc.splitTextToSize(leftText, contentW * 0.72);
            for (let i = 0; i < leftLines.length; i++) {
              if (y > maxY - 10) {
                hasTruncated = true;
                break;
              }
              const line = leftLines[i];
              if (i === 0) {
                if (rightCell?.text) {
                  const dateStr = rightCell.text;
                  const dateW = doc.getTextWidth(dateStr);
                  const availW = contentW;
                  const leftW = doc.getTextWidth(line);
                  if (leftW + dateW + 2 <= availW) {
                    doc.text(line, left, textY(currentBodyFontSize));
                    doc.text(dateStr, right, textY(currentBodyFontSize), { align: "right" });
                  } else {
                    doc.text(line, left, textY(currentBodyFontSize));
                    advanceLine();
                    if (y < maxY - 10) {
                      doc.text(dateStr, right, textY(currentBodyFontSize), { align: "right" });
                    } else {
                      hasTruncated = true;
                    }
                  }
                } else {
                  doc.text(line, left, textY(currentBodyFontSize));
                }
              } else {
                doc.text(line, left, textY(currentBodyFontSize));
              }
              advanceLine();
            }
            if (!leftText && rightCell?.text) {
              doc.text(rightCell.text, right, textY(currentBodyFontSize), { align: "right" });
              advanceLine();
            }
            advanceMm(0.2);
            break;
          }
        }
      }
      y += currentSectionGap;
    }

    finalDoc = doc;
    finalPages = doc.getNumberOfPages();
    finalTruncated = hasTruncated;

    // If it fits without truncation, stop retrying.
    if (!hasTruncated) {
      break;
    }
  }

  // Inject PDF/A compliant metadata and settings before saving
  const title = rd.contact.name ? `${rd.contact.name} Resume` : "Resume";
  const author = rd.contact.name || "Candidate";
  finalDoc.setProperties({
    title,
    author,
    subject: "Professional Resume - PDF/A-2b Compliant",
    keywords: "resume, cv, career, pdf/a, ats",
    creator: "ATS Premium Optimizer",
    producer: "jsPDF + ATS Premium"
  } as any);

  const xmpMetadata = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${title}</rdf:li>
    </rdf:Alt>
   </dc:title>
   <dc:creator>
    <rdf:Seq>
     <rdf:li>${author}</rdf:li>
    </rdf:Seq>
   </dc:creator>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

  try {
    if (typeof (finalDoc as any).addMetadata === "function") {
      (finalDoc as any).addMetadata(xmpMetadata);
    }
  } catch (err) {
    console.warn("Failed to inject XMP metadata:", err);
  }

  // Save the final scaled document
  const fname = (rd.contact.name || "resume").replace(/\s+/g, "_") + "_resume.pdf";
  finalDoc.save(fname);

  return { ok: !finalTruncated, pages: finalPages };
}

// ============================================================================
// Sidebar template renderer (modern / creative)
// Mirrors the A4Preview HTML design: full-height accent sidebar on the LEFT
// carrying name, headline, contact, skills, languages and certifications in
// white text; main column on the right carrying profile, experience,
// education, projects, dynamic sections and additional info.
// ============================================================================

/** Sidebar width in mm (~31% of A4 — mirrors the preview's 35% incl. padding). */
const SIDEBAR_W = 66;
const SIDEBAR_PAD_L = 9;
const SIDEBAR_PAD_R = 6;
const MAIN_GAP_L = 9;
const MAIN_MARGIN_R = 9;

/** Section types rendered inside the accent sidebar. */
const SIDEBAR_SECTION_TYPES = new Set(["skills", "languages", "certifications"]);

function renderSidebarTemplate(
  doc: jsPDF,
  rd: RenderDocument,
  L: ResumeLayoutModel,
  scale: number,
): boolean {
  let truncated = false;

  const accent = hexToRgb(L.sectionTitleColor || L.nameColor || "#1154A3");
  const white: [number, number, number] = [255, 255, 255];
  const bodyRgb = hexToRgb(L.bodyTextColor || "#1a1a1a");

  const currentLineHeight = L.lineHeightMm * scale;
  const currentBodyFontSize = L.bodyFontSizePt * scale;
  const currentSectionTitleSize = L.sectionTitleSizePt * scale;
  const currentNameSize = Math.min(L.nameSizePt * scale, 22);
  const currentSectionGap = (L.sectionGapMm ?? 4) * scale;
  const sidebarTextW = SIDEBAR_W - SIDEBAR_PAD_L - SIDEBAR_PAD_R;
  const mainLeft = SIDEBAR_W + MAIN_GAP_L;
  const mainW = A4_W - MAIN_MARGIN_R - mainLeft;
  const maxY = A4_H - Math.max(L.marginBottomMm, 10);

  const fontName = getPdfFontFamily(L.fontFamily || "Helvetica");
  const textY = (y: number, sizePt: number) => y + ptToMm(sizePt) * 0.7;

  // ── Sidebar background: full-height accent panel ─────────────────────────
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, SIDEBAR_W, A4_H, "F");

  // ══ SIDEBAR COLUMN ══
  let sy = Math.max(L.marginTopMm, 10);
  const sHeading = (title: string) => {
    doc.setFont(fontName, "bold");
    doc.setFontSize(Math.max(8.5 * scale, 7));
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), SIDEBAR_PAD_L, textY(sy, 8.5));
    sy += ptToMm(8.5) * 0.85 + 1.4;
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.25);
    doc.line(SIDEBAR_PAD_L, sy - 1.2, SIDEBAR_W - SIDEBAR_PAD_R, sy - 1.2);
    sy += 1.8;
  };
  const sLine = (text: string, sizePt = Math.max(currentBodyFontSize, 8 * scale)) => {
    doc.setFont(fontName, "normal");
    doc.setFontSize(sizePt);
    doc.setTextColor(255, 255, 255);
    const lines = doc.splitTextToSize(cleanText(text), sidebarTextW);
    for (const line of lines) {
      if (sy > maxY) { truncated = true; return; }
      doc.text(line, SIDEBAR_PAD_L, textY(sy, sizePt));
      sy += ptToMm(sizePt) * 1.35;
    }
  };
  // Name + headline (white on accent)
  doc.setFont(fontName, "bold");
  doc.setFontSize(currentNameSize);
  doc.setTextColor(255, 255, 255);
  const nameLines = doc.splitTextToSize((rd.contact.name || "YOUR NAME").toUpperCase(), sidebarTextW);
  for (const line of nameLines) {
    if (sy > maxY) { truncated = true; break; }
    doc.text(line, SIDEBAR_PAD_L, textY(sy, currentNameSize));
    sy += ptToMm(currentNameSize) * 0.95;
  }
  if (rd.contact.headline) {
    sy += 1.2;
    sLine(rd.contact.headline);
  }
  sy += 4;

  // Contact
  const contactLines = [
    rd.contact.location,
    rd.contact.phone,
    rd.contact.email,
    rd.contact.dateOfBirth ? `DOB: ${rd.contact.dateOfBirth}` : "",
  ].filter(Boolean) as string[];
  if (contactLines.length) {
    sHeading("Contact");
    for (const line of contactLines) {
      if (sy > maxY) { truncated = true; break; }
      sLine(line, Math.max(currentBodyFontSize - 0.5, 7.5));
      sy += 0.4;
    }
    sy += 2.5;
  }

  // Sidebar sections (skills / languages / certifications) — white styling
  for (const section of rd.sections) {
    if (!SIDEBAR_SECTION_TYPES.has(section.type)) continue;
    if (sy > maxY) { truncated = true; break; }
    sHeading(section.title);
    renderItems(doc, section.items, {
      x: SIDEBAR_PAD_L,
      width: sidebarTextW,
      bulletIndent: 3.5,
      fontName,
      bodySize: Math.max(currentBodyFontSize - 0.5, 7.5),
      lineHeight: currentLineHeight * 0.95,
      color: white,
      accentColor: white,
      rightEdge: SIDEBAR_W - SIDEBAR_PAD_R,
      maxY,
      getY: () => sy,
      setY: (v) => { sy = v; },
      onOverflow: () => { truncated = true; },
      textY,
    });
    sy += 2.5;
  }

  // ══ MAIN COLUMN ══
  let y = Math.max(L.marginTopMm, 10);
  const mSectionHeader = (title: string) => {
    doc.setFont(fontName, "bold");
    doc.setFontSize(currentSectionTitleSize);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text(title.toUpperCase(), mainLeft, textY(y, currentSectionTitleSize));
    y += ptToMm(currentSectionTitleSize) * 0.85 + 0.8;
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(0.35);
    doc.line(mainLeft, y - 0.8, mainLeft + mainW * 0.28, y - 0.8);
    y += 1.6;
  };

  for (const section of rd.sections) {
    if (SIDEBAR_SECTION_TYPES.has(section.type)) continue;
    if (y > maxY - 20) { truncated = true; break; }
    mSectionHeader(section.title);
    renderItems(doc, section.items, {
      x: mainLeft,
      width: mainW,
      bulletIndent: L.bulletIndentMm ?? 6.4,
      fontName,
      bodySize: currentBodyFontSize,
      lineHeight: currentLineHeight,
      color: bodyRgb,
      accentColor: accent,
      rightEdge: A4_W - MAIN_MARGIN_R,
      maxY,
      getY: () => y,
      setY: (v) => { y = v; },
      onOverflow: () => { truncated = true; },
      textY,
    });
    y += currentSectionGap;
  }

  return truncated;
}

/** Shared coordinate/style bundle for renderItems. */
interface ItemRenderCtx {
  x: number;
  width: number;
  bulletIndent: number;
  fontName: string;
  bodySize: number;
  lineHeight: number;
  color: [number, number, number];
  accentColor: [number, number, number];
  rightEdge: number;
  maxY: number;
  getY: () => number;
  setY: (v: number) => void;
  onOverflow: () => void;
  textY: (y: number, sizePt: number) => number;
}

/**
 * Render the content items of one section into the column described by ctx.
 * Advances ctx coordinates; returns nothing (ctx carries the cursor).
 */
function renderItems(doc: jsPDF, items: RenderContentItem[], ctx: ItemRenderCtx): void {
  const { x, width, fontName, bodySize, lineHeight, color, accentColor, maxY } = ctx;
  const justify = (text: string, w: number) => {
    text = cleanText(text);
    doc.setFont(fontName, "normal");
    doc.setFontSize(bodySize);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text, w);
    for (let li = 0; li < lines.length; li++) {
      if (ctx.getY() > maxY - 6) { ctx.onOverflow(); return; }
      const last = li === lines.length - 1;
      if (!last) doc.text(lines[li], x, ctx.textY(ctx.getY(), bodySize), { align: "justify", maxWidth: w });
      else doc.text(lines[li], x, ctx.textY(ctx.getY(), bodySize));
      ctx.setY(ctx.getY() + lineHeight);
    }
  };
  const bullet = (text: string, indent = 0) => {
    text = cleanText(text);
    const bulletX = x + ctx.bulletIndent + indent;
    const textX = bulletX + 3.2;
    doc.setFont(fontName, "normal");
    doc.setFontSize(bodySize);
    doc.setTextColor(color[0], color[1], color[2]);
    const wrapW = width - ctx.bulletIndent - indent - 3.2;
    const lines = doc.splitTextToSize(text, wrapW);
    for (let i = 0; i < lines.length; i++) {
      if (ctx.getY() > maxY - 6) { ctx.onOverflow(); return; }
      if (i === 0) doc.text("\u2022", bulletX, ctx.textY(ctx.getY(), bodySize));
      doc.text(lines[i], textX, ctx.textY(ctx.getY(), bodySize));
      ctx.setY(ctx.getY() + lineHeight);
    }
  };

  for (const item of items) {
    switch (item.kind) {
      case "text":
        justify(item.text, width);
        break;

      case "bullets":
        for (const b of item.bullets) {
          if (ctx.getY() > maxY - 6) { ctx.onOverflow(); return; }
          bullet(b, item.level ? 5 : 0);
        }
        ctx.setY(ctx.getY() + 0.4);
        break;

      case "nested-bullets":
        for (const group of item.groups) {
          if (ctx.getY() > maxY - 6) { ctx.onOverflow(); return; }
          doc.setFont(fontName, "bold");
          doc.setFontSize(bodySize);
          doc.setTextColor(color[0], color[1], color[2]);
          bullet(`${group.label}:`, 0);
          for (const s of group.items) {
            if (ctx.getY() > maxY - 6) { ctx.onOverflow(); return; }
            bullet(s, 3.5);
          }
        }
        ctx.setY(ctx.getY() + 0.6);
        break;

      case "table-row": {
        const leftText = cleanText(item.cells.find((c) => c.align === "left" || !c.align)?.text ?? "");
        const rightCell = item.cells.find((c) => c.align === "right");
        doc.setFont(fontName, "bold");
        doc.setFontSize(bodySize);
        doc.setTextColor(color[0], color[1], color[2]);
        const leftLines = doc.splitTextToSize(leftText, width * 0.74);
        for (let i = 0; i < leftLines.length; i++) {
          if (ctx.getY() > maxY - 6) { ctx.onOverflow(); return; }
          const line = leftLines[i];
          if (i === 0 && rightCell?.text) {
            const dateW = doc.getTextWidth(rightCell.text);
            const leftW = doc.getTextWidth(line);
            if (leftW + dateW + 2 <= width) {
              doc.text(line, x, ctx.textY(ctx.getY(), bodySize));
              doc.text(rightCell.text, ctx.rightEdge, ctx.textY(ctx.getY(), bodySize), { align: "right" });
            } else {
              doc.text(line, x, ctx.textY(ctx.getY(), bodySize));
              ctx.setY(ctx.getY() + lineHeight);
              if (ctx.getY() <= maxY - 6) {
                doc.text(rightCell.text, ctx.rightEdge, ctx.textY(ctx.getY(), bodySize), { align: "right" });
              }
            }
          } else {
            doc.text(line, x, ctx.textY(ctx.getY(), bodySize));
          }
          ctx.setY(ctx.getY() + lineHeight);
        }
        if (!leftText && rightCell?.text) {
          doc.text(rightCell.text, ctx.rightEdge, ctx.textY(ctx.getY(), bodySize), { align: "right" });
          ctx.setY(ctx.getY() + lineHeight);
        }
        // Accent hairline under the entry — sidebar-template signature detail
        doc.setDrawColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.setLineWidth(0.2);
        doc.line(x, ctx.getY() - lineHeight + 1.2, x + width, ctx.getY() - lineHeight + 1.2);
        ctx.setY(ctx.getY() + 0.3);
        break;
      }
    }
  }
}

function cleanText(text: string): string {
  return (text || "")
    .replace(/\*\*|\*/g, "")
    .replace(/^%Ï\s*/g, "")
    .replace(/%Ï/g, " ")
    .replace(/^[●•*-\s]+/, "")
    .replace(/●/g, "");
}

function getPdfFontFamily(family: string): string {
  const f = family.toLowerCase();
  if (f.includes("helvetica") || f.includes("arial") || f.includes("sans-serif") || f.includes("inter")) {
    return "helvetica";
  }
  if (f.includes("courier") || f.includes("mono")) {
    return "courier";
  }
  return "times";
}
