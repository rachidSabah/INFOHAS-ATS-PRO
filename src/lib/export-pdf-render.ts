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
} from "./types";

const A4_W = 210;
const A4_H = 297;

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 0, 0];
}

function ptToMm(pt: number) { return pt * 0.352778; }

/**
 * Render a RenderDocument to PDF, matching the DOCX output structure.
 */
export async function exportResumePDFRenderDoc(
  rd: RenderDocument,
): Promise<{ ok: boolean; pages: number; error?: string }> {
  const L = rd.layout;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageH = A4_H;

  const left = L.marginLeftMm;
  const right = A4_W - L.marginRightMm;
  const contentW = right - left;
  const maxY = pageH - L.marginBottomMm;

  const nameRgb = hexToRgb(L.nameColor);
  const bodyRgb = hexToRgb(L.bodyTextColor);
  const sectionRgb = hexToRgb(L.sectionTitleColor);

  let y = L.marginTopMm;

  const textY = (sizePt: number) => y + ptToMm(sizePt) * 0.7;
  const advanceLine = () => { y += L.lineHeightMm; };
  const advanceMm = (mm: number) => { y += mm; };

  // ===== Helpers =====
  const sectionHeader = (title: string) => {
    doc.setDrawColor(sectionRgb[0], sectionRgb[1], sectionRgb[2]);
    doc.setLineWidth(0.15);
    doc.line(left, y, right, y);
    advanceMm(0.3);
    doc.setFont("times", "bold");
    doc.setFontSize(L.sectionTitleSizePt);
    doc.setTextColor(sectionRgb[0], sectionRgb[1], sectionRgb[2]);
    doc.text(title.toUpperCase(), left, textY(L.sectionTitleSizePt));
    advanceMm(ptToMm(L.sectionTitleSizePt) * 0.6 + 0.3);
  };

  const drawWrapped = (text: string, w: number) => {
    doc.setFont("times", "normal");
    doc.setFontSize(L.bodyFontSizePt);
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    const lines = doc.splitTextToSize(text, w);
    for (const line of lines) {
      if (y > maxY - 10) break;
      doc.text(line, left, textY(L.bodyFontSizePt));
      advanceLine();
    }
  };

  const drawBulletLine = (text: string, w: number, indent = 0) => {
    doc.setFont("times", "normal");
    doc.setFontSize(L.bodyFontSizePt);
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    const bulletX = left + indent;
    const wrapW = w - indent;
    const lines = doc.splitTextToSize(text, wrapW);
    for (let i = 0; i < lines.length; i++) {
      if (y > maxY - 10) break;
      if (i === 0) {
        doc.text("•", bulletX, textY(L.bodyFontSizePt));
        doc.text(lines[i], bulletX + 3, textY(L.bodyFontSizePt));
      } else {
        doc.text(lines[i], bulletX + 3, textY(L.bodyFontSizePt));
      }
      advanceLine();
    }
  };

  // ===== CONTACT BLOCK =====
  // Name
  doc.setFont("times", "bold");
  doc.setFontSize(L.nameSizePt);
  doc.setTextColor(nameRgb[0], nameRgb[1], nameRgb[2]);
  doc.text((rd.contact.name || "YOUR NAME").toUpperCase(), left, textY(L.nameSizePt));
  advanceMm(ptToMm(L.nameSizePt) * 0.8);

  // Headline
  if (rd.contact.headline) {
    doc.setFont("times", "normal");
    doc.setFontSize(L.bodyFontSizePt);
    doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
    doc.text(rd.contact.headline, left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // Contact — single line: Phone | Email | Location
  const contactParts: string[] = [];
  if (rd.contact.phone) contactParts.push(rd.contact.phone);
  if (rd.contact.email) contactParts.push(rd.contact.email);
  if (rd.contact.location) contactParts.push(rd.contact.location);
  if (contactParts.length) {
    doc.setTextColor(100, 100, 100);
    doc.text(contactParts.join(" | "), left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // Date of birth
  if (rd.contact.dateOfBirth) {
    doc.setTextColor(100, 100, 100);
    doc.text(`Date Of Birth: ${rd.contact.dateOfBirth}`, left, textY(L.bodyFontSizePt));
    advanceLine();
  }

  // Thin separator
  advanceMm(0.3);
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.15);
  doc.line(left, y, right, y);
  advanceMm(1.5);

  // ===== RENDER SECTIONS from RenderDocument =====
  for (const section of rd.sections) {
    if (y > maxY - 20) break;
    sectionHeader(section.title);

    for (const item of section.items) {
      if (y > maxY - 10) break;

      switch (item.kind) {
        case "text":
          drawWrapped(item.text, contentW);
          break;

        case "bullets":
          for (const b of item.bullets) {
            if (y > maxY - 10) break;
            drawBulletLine(b, contentW, item.level ? 6 : 0);
          }
          advanceMm(0.2);
          break;

        case "nested-bullets":
          for (const group of item.groups) {
            if (y > maxY - 10) break;
            // Bold category label + normal items on same line
            doc.setFont("times", "bold");
            doc.setFontSize(L.bodyFontSizePt);
            doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
            const labelPart = `• ${group.label}: `;
            const labelW = doc.getTextWidth(labelPart);
            doc.text(labelPart, left, textY(L.bodyFontSizePt));
            doc.setFont("times", "normal");
            const itemsText = group.items.join(", ");
            const itemsLines = doc.splitTextToSize(itemsText, contentW - labelW);
            if (itemsLines.length <= 1) {
              doc.text(itemsLines[0], left + labelW, textY(L.bodyFontSizePt));
              advanceLine();
            } else {
              doc.text(itemsLines[0], left + labelW, textY(L.bodyFontSizePt));
              advanceLine();
              for (let i = 1; i < itemsLines.length; i++) {
                if (y > maxY - 10) break;
                doc.text(itemsLines[i], left + 4, textY(L.bodyFontSizePt));
                advanceLine();
              }
            }
          }
          advanceMm(0.5);
          break;

        case "table-row": {
          doc.setFont("times", "bold");
          doc.setFontSize(L.bodyFontSizePt);
          doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
          const leftText = item.cells.find(c => c.align === "left" || !c.align)?.text ?? "";
          const rightCell = item.cells.find(c => c.align === "right");
          const leftLines = doc.splitTextToSize(leftText, contentW * 0.72);
          for (let i = 0; i < leftLines.length; i++) {
            if (y > maxY - 10) break;
            const line = leftLines[i];
            if (i === 0) {
              // Append date on first line
              if (rightCell?.text) {
                const dateStr = rightCell.text;
                const dateW = doc.getTextWidth(dateStr);
                const availW = contentW;
                // If left text + date fits on one line, render both
                const leftW = doc.getTextWidth(line);
                if (leftW + dateW + 2 <= availW) {
                  doc.text(line, left, textY(L.bodyFontSizePt));
                  doc.text(dateStr, right, textY(L.bodyFontSizePt), { align: "right" });
                } else {
                  doc.text(line, left, textY(L.bodyFontSizePt));
                  advanceLine();
                  if (y < maxY - 10) {
                    doc.text(dateStr, right, textY(L.bodyFontSizePt), { align: "right" });
                  }
                }
              } else {
                doc.text(line, left, textY(L.bodyFontSizePt));
              }
            } else {
              doc.text(line, left, textY(L.bodyFontSizePt));
            }
            advanceLine();
          }
          // If no left text but there is a date
          if (!leftText && rightCell?.text) {
            doc.text(rightCell.text, right, textY(L.bodyFontSizePt), { align: "right" });
            advanceLine();
          }
          advanceMm(0.2);
          break;
        }
      }
    }
  }

  // ===== SAVE =====
  const pages = doc.getNumberOfPages();
  const fname = (rd.contact.name || "resume").replace(/\s+/g, "_") + "_resume.pdf";
  doc.save(fname);

  return { ok: true, pages, error: undefined };
}
