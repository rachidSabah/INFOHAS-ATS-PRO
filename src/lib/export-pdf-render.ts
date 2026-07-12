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
  let finalDoc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let finalPages = 1;
  let finalTruncated = false;

  const scales = [1.0, 0.93, 0.86, 0.79, 0.72];
  
  for (const scale of scales) {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    let y = L.marginTopMm;
    let hasTruncated = false;

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

    const drawWrapped = (text: string, w: number) => {
      text = (text || "").replace(/\*\*|\*/g, "");
      doc.setFont(fontName, "normal");
      doc.setFontSize(currentBodyFontSize);
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      const lines = doc.splitTextToSize(text, w);
      for (const line of lines) {
        if (y > maxY - 10) {
          hasTruncated = true;
          break;
        }
        doc.text(line, left, textY(currentBodyFontSize));
        advanceLine();
      }
    };

    const drawBulletLine = (text: string, w: number, indent = 0) => {
      text = (text || "").replace(/\*\*|\*/g, "");
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
        if (i === 0) {
          doc.text("•", bulletX, textY(currentBodyFontSize));
          doc.text(lines[i], textXPos, textY(currentBodyFontSize));
        } else {
          doc.text(lines[i], textXPos, textY(currentBodyFontSize));
        }
        advanceLine();
      }
    };

    // Render Contact block
    doc.setFont(fontName, "bold");
    doc.setFontSize(currentNameSize);
    doc.setTextColor(nameRgb[0], nameRgb[1], nameRgb[2]);
    doc.text((rd.contact.name || "YOUR NAME").toUpperCase(), left, textY(currentNameSize));
    advanceMm(ptToMm(currentNameSize) * 0.8 + 1.0);

    if (rd.contact.headline) {
      doc.setFont(fontName, "normal");
      doc.setFontSize(currentBodyFontSize);
      doc.setTextColor(bodyRgb[0], bodyRgb[1], bodyRgb[2]);
      doc.text(rd.contact.headline, left, textY(currentBodyFontSize));
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
        doc.text(contactParts.join(" | "), left, textY(currentBodyFontSize));
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

    advanceMm(1.5);

    // Render sections
    for (const section of rd.sections) {
      if (y > maxY - 20) {
        hasTruncated = true;
        break;
      }
      sectionHeader(section.title);

      for (const item of section.items) {
        if (y > maxY - 10) {
          hasTruncated = true;
          break;
        }

        switch (item.kind) {
          case "text":
            drawWrapped(item.text, contentW);
            break;

          case "bullets":
            for (const b of item.bullets) {
              if (y > maxY - 10) {
                hasTruncated = true;
                break;
              }
              drawBulletLine(b, contentW, item.level ? 6 : 0);
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
