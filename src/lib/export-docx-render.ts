/**
 * Refactored exportResumeDOCX — consumes RenderDocument (single source of truth)
 *
 * Section order, content structure, and formatting are dictated by the
 * RenderDocument, NOT by hard-coded order in this function.
 */
import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  TabStopType,
  convertInchesToTwip,
  Packer,
} from "docx";
import type {
  ResumeData,
  ResumeLayoutModel,
  RenderDocument,
  RenderContentItem,
  RenderNestedBulletList,
} from "./types";
import { getDefaultResumeLayout } from "./exporter";

type DocxTabStop = { type: typeof TabStopType; position: number };

/**
 * Export resume as DOCX using RenderDocument as single source of truth.
 */
export async function exportResumeDOCXRenderDoc(
  rd: RenderDocument,
): Promise<Blob> {
  const L = rd.layout;
  const nameHex = L.nameColor.replace("#", "");
  const accentHex = L.sectionTitleColor.replace("#", "");
  const bodyHex = L.bodyTextColor.replace("#", "");
  const contactHex = L.contactColor.replace("#", "");

  const children: Paragraph[] = [];

  const marginTwip = (mm: number) => convertInchesToTwip(mm / 25.4);
  const rightTabPosition = marginTwip(210 - L.marginLeftMm - L.marginRightMm);
  const docxTabStops = [{ type: TabStopType.RIGHT, position: rightTabPosition }];

  // ===== CONTACT BLOCK (rendered ONCE) =====
  // Name
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 40 },
    children: [new TextRun({ text: (rd.contact.name || "YOUR NAME").toUpperCase(), bold: true, size: L.nameSizePt * 2, font: L.fontFamily, color: nameHex })],
  }));

  // Headline
  if (rd.contact.headline) {
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: rd.contact.headline, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
    }));
  }

  // Contact line — single line with phone | email | location
  const contactParts: string[] = [];
  if (rd.contact.phone) contactParts.push(rd.contact.phone);
  if (rd.contact.email) contactParts.push(rd.contact.email);
  if (rd.contact.location) contactParts.push(rd.contact.location);
  if (contactParts.length) {
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: contactParts.join(" | "), size: L.bodyFontSizePt * 2, font: L.fontFamily, color: contactHex })],
    }));
  }

  // Date of birth — single line
  if (rd.contact.dateOfBirth) {
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: `Date Of Birth: ${rd.contact.dateOfBirth}`, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
    }));
  }

  // ===== SECTION HELPER =====
  const addSection = (title: string) => {
    children.push(new Paragraph({
      spacing: { before: 200, after: 60 },
      children: [new TextRun({ text: title, bold: true, size: L.sectionTitleSizePt * 2, font: L.fontFamily, color: accentHex })],
    }));
  };

  // ===== RENDER SECTIONS from RenderDocument =====
  for (const section of rd.sections) {
    addSection(section.title);

    for (const item of section.items) {
      renderContentItem(item, children, L, bodyHex, docxTabStops);
    }
  }

  // ===== BUILD DOCX =====
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

  return await Packer.toBlob(doc);
}

function renderContentItem(
  item: RenderContentItem,
  children: Paragraph[],
  L: ResumeLayoutModel,
  bodyHex: string,
  docxTabStops: any,
): void {
  switch (item.kind) {
    case "text":
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: item.text,
            size: (item.fontSizePt ?? L.bodyFontSizePt) * 2,
            font: L.fontFamily,
            color: bodyHex,
            bold: item.bold,
            italics: item.italic,
          }),
        ],
      }));
      break;

    case "bullets":
      for (const b of item.bullets) {
        children.push(new Paragraph({
          bullet: { level: item.level ?? 0 },
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 30 },
          children: [new TextRun({ text: b, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
        }));
      }
      break;

    case "nested-bullets":
      renderNestedBullets(item, children, L, bodyHex);
      break;

    case "table-row": {
      const leftText = item.cells.find(c => c.align === "left" || !c.align)?.text ?? "";
      const rightCell = item.cells.find(c => c.align === "right");
      children.push(new Paragraph({
        tabStops: docxTabStops,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: leftText, bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
          ...(rightCell?.text ? [new TextRun({ text: "\t" + rightCell.text, bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })] : []),
        ],
      }));
      break;
    }
  }
}

function renderNestedBullets(
  item: RenderNestedBulletList,
  children: Paragraph[],
  L: ResumeLayoutModel,
  bodyHex: string,
): void {
  for (const group of item.groups) {
    // First bullet: "Category: item1, item2, item3"
    const text = `${group.label}: ${group.items.join(", ")}`;
    children.push(new Paragraph({
      bullet: { level: 0 },
      spacing: { after: 30 },
      children: [
        new TextRun({ text: `${group.label}: `, bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
        new TextRun({ text: group.items.join(", "), size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
      ],
    }));
  }
}
