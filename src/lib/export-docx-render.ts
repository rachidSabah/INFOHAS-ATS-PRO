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
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from "docx";
import type {
  ResumeData,
  ResumeLayoutModel,
  RenderDocument,
  RenderContentItem,
  RenderNestedBulletList,
  TextAlignment,
} from "./types";
import { resolveSectionAlignment } from "./types";
import { getDefaultResumeLayout } from "./resume-layout";

type DocxTabStop = { type: typeof TabStopType; position: number };

/**
 * Templates whose signature design is a full-height accent sidebar carrying
 * name/contact/skills/languages/certifications (mirrors the A4Preview HTML
 * components and the PDF sidebar renderer). These are exported as a
 * borderless two-column table with a shaded sidebar cell instead of the
 * classic single-column flow — otherwise the downloaded file loses the
 * template design the user picked in the Builder.
 */
const DOCX_SIDEBAR_TEMPLATES = new Set(["modern", "creative"]);

/** Section types rendered inside the shaded sidebar cell. */
const DOCX_SIDEBAR_SECTION_TYPES = new Set(["skills", "languages", "certifications"]);

/** Borderless table/cell border set. */
const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: "auto" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
  left: { style: BorderStyle.NONE, size: 0, color: "auto" },
  right: { style: BorderStyle.NONE, size: 0, color: "auto" },
};

/** Map a layout alignment to a docx paragraph alignment. */
function toDocxAlignment(a: TextAlignment): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (a === "center") return AlignmentType.CENTER;
  if (a === "left") return AlignmentType.LEFT;
  return AlignmentType.JUSTIFIED;
}

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

  // ===== SIDEBAR TEMPLATES (modern / creative) =====
  // Two-column borderless table: shaded accent sidebar (name, contact,
  // skills, languages, certifications in white) + main column (all other
  // sections). Mirrors the Builder preview and the PDF sidebar renderer.
  if (DOCX_SIDEBAR_TEMPLATES.has(String(rd.template || ""))) {
    const white = "FFFFFF";
    const sidebarChildren: Paragraph[] = [];
    const mainChildren: Paragraph[] = [];

    // --- Sidebar: name + headline ---
    sidebarChildren.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: (rd.contact.name || "YOUR NAME").toUpperCase(), bold: true, size: Math.min(L.nameSizePt, 20) * 2, font: L.fontFamily, color: white })],
    }));
    if (rd.contact.headline) {
      sidebarChildren.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: rd.contact.headline, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: white })],
      }));
    }

    // --- Sidebar: contact ---
    const contactLines = [
      rd.contact.location,
      rd.contact.phone,
      rd.contact.email,
      rd.contact.dateOfBirth ? `DOB: ${rd.contact.dateOfBirth}` : "",
    ].filter(Boolean) as string[];
    if (contactLines.length) {
      sidebarChildren.push(new Paragraph({
        spacing: { before: 120, after: 60 },
        children: [new TextRun({ text: "CONTACT", bold: true, size: (L.sectionTitleSizePt || 11) * 2, font: L.fontFamily, color: white })],
      }));
      for (const line of contactLines) {
        sidebarChildren.push(new Paragraph({
          spacing: { after: 30 },
          children: [new TextRun({ text: line, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: white })],
        }));
      }
    }

    // --- Sidebar: skills / languages / certifications (white styling) ---
    for (const section of rd.sections) {
      if (!DOCX_SIDEBAR_SECTION_TYPES.has(section.type)) continue;
      sidebarChildren.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: section.title.toUpperCase(), bold: true, size: (L.sectionTitleSizePt || 11) * 2, font: L.fontFamily, color: white })],
      }));
      for (const item of section.items) {
        renderSidebarContentItem(item, sidebarChildren, L, white);
      }
    }

    // --- Main: every non-sidebar section ---
    const mainAddSection = (title: string) => {
      mainChildren.push(new Paragraph({
        spacing: { before: 120, after: 30, line: 240 },
        children: [new TextRun({ text: title, bold: true, size: (L.sectionTitleSizePt || 11.5) * 2, font: L.fontFamily, color: accentHex })],
      }));
    };
    for (const section of rd.sections) {
      if (DOCX_SIDEBAR_SECTION_TYPES.has(section.type)) continue;
      mainAddSection(section.title);
      const sectionAlign = resolveSectionAlignment(L, section.type);
      for (const item of section.items) {
        renderContentItem(item, mainChildren, L, bodyHex, docxTabStops, sectionAlign);
      }
    }

    const twoCol = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 34, type: WidthType.PERCENTAGE },
              borders: NO_BORDERS,
              shading: { fill: accentHex, type: ShadingType.CLEAR, color: "auto" },
              margins: { top: 200, bottom: 400, left: 200, right: 200 },
              children: sidebarChildren,
            }),
            new TableCell({
              width: { size: 66, type: WidthType.PERCENTAGE },
              borders: NO_BORDERS,
              margins: { top: 200, bottom: 400, left: 260, right: 120 },
              children: mainChildren,
            }),
          ],
        }),
      ],
    });

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
        children: [twoCol],
      }],
    });

    return await Packer.toBlob(doc);
  }

  // ===== CLASSIC SINGLE-COLUMN FLOW (all other templates) =====
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

  // Contact block styling (stacked vs single-line)
  if (L.contactSpacing === "single-line") {
    const contactParts: string[] = [];
    if (rd.contact.location) contactParts.push(rd.contact.location);
    if (rd.contact.phone) contactParts.push(rd.contact.phone);
    if (rd.contact.email) contactParts.push(rd.contact.email);
    if (rd.contact.dateOfBirth) contactParts.push(`DOB: ${rd.contact.dateOfBirth}`);

    if (contactParts.length) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: contactParts.join(" | "), size: L.bodyFontSizePt * 2, font: L.fontFamily, color: contactHex })],
      }));
    }
  } else {
    const locPhoneParts: string[] = [];
    if (rd.contact.location) locPhoneParts.push(rd.contact.location);
    if (rd.contact.phone) locPhoneParts.push(rd.contact.phone);
    if (locPhoneParts.length) {
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: locPhoneParts.join(" | "), size: L.bodyFontSizePt * 2, font: L.fontFamily, color: contactHex })],
      }));
    }
    if (rd.contact.email) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: rd.contact.email, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: contactHex })],
      }));
    }

    // Date of birth — single line
    if (rd.contact.dateOfBirth) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: `Date Of Birth: ${rd.contact.dateOfBirth}`, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex })],
      }));
    }
  }

  // ===== SECTION HELPER =====
  const addSection = (title: string) => {
    children.push(new Paragraph({
      spacing: { before: 120, after: 30, line: 240 },
      children: [new TextRun({ text: title, bold: true, size: (L.sectionTitleSizePt || 11.5) * 2, font: L.fontFamily, color: accentHex })],
    }));
  };

  // ===== RENDER SECTIONS from RenderDocument =====
  for (const section of rd.sections) {
    addSection(section.title);
    const sectionAlign = resolveSectionAlignment(L, section.type);

    for (const item of section.items) {
      renderContentItem(item, children, L, bodyHex, docxTabStops, sectionAlign);
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

function parseMarkdownToTextRuns(
  text: string | null | undefined,
  baseOptions: { size: number; font: string; color: string; bold?: boolean; italics?: boolean }
): TextRun[] {
  if (!text) return [];
  const boldRegex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(boldRegex);
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return new TextRun({
        ...baseOptions,
        text: part.slice(2, -2),
        bold: true,
      });
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return new TextRun({
        ...baseOptions,
        text: part.slice(1, -1),
        bold: true,
      });
    }
    return new TextRun({
      ...baseOptions,
      text: part,
    });
  }).filter(run => (run as any).text !== "");
}

function renderContentItem(
  item: RenderContentItem,
  children: Paragraph[],
  L: ResumeLayoutModel,
  bodyHex: string,
  docxTabStops: any,
  align: TextAlignment = "justify",
): void {
  const paraAlign = toDocxAlignment(align);
  switch (item.kind) {
    case "text":
      children.push(new Paragraph({
        alignment: paraAlign,
        spacing: { before: 0, after: 30, line: 240 },
        children: parseMarkdownToTextRuns(item.text, {
          size: (item.fontSizePt ?? L.bodyFontSizePt) * 2,
          font: L.fontFamily,
          color: bodyHex,
          bold: item.bold,
          italics: item.italic,
        }),
      }));
      break;

    case "bullets":
      for (const b of item.bullets) {
        children.push(new Paragraph({
          bullet: { level: item.level ?? 0 },
          alignment: paraAlign,
          spacing: { before: 0, after: 15, line: 230 },
          children: parseMarkdownToTextRuns(b, {
            size: L.bodyFontSizePt * 2,
            font: L.fontFamily,
            color: bodyHex,
          }),
        }));
      }
      break;

    case "nested-bullets":
      renderNestedBullets(item, children, L, bodyHex, paraAlign);
      break;

    case "table-row": {
      const leftText = item.cells.find(c => c.align === "left" || !c.align)?.text ?? "";
      const rightCell = item.cells.find(c => c.align === "right");
      children.push(new Paragraph({
        tabStops: docxTabStops,
        spacing: { before: 40, after: 15, line: 240 },
        children: [
          ...parseMarkdownToTextRuns(leftText, {
            size: L.bodyFontSizePt * 2,
            font: L.fontFamily,
            color: bodyHex,
            bold: true,
          }),
          ...(rightCell?.text
            ? parseMarkdownToTextRuns("\t" + rightCell.text, {
                size: L.bodyFontSizePt * 2,
                font: L.fontFamily,
                color: bodyHex,
                bold: true,
              })
            : []),
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
  paraAlign: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.JUSTIFIED,
): void {
  for (const group of item.groups) {
    children.push(new Paragraph({
      bullet: { level: 0 },
      alignment: paraAlign,
      spacing: { before: 0, after: 15, line: 230 },
      children: [
        new TextRun({ text: `${group.label}: `, bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: bodyHex }),
        ...parseMarkdownToTextRuns(group.items.join(", "), {
          size: L.bodyFontSizePt * 2,
          font: L.fontFamily,
          color: bodyHex,
        }),
      ],
    }));
  }
}

/**
 * Sidebar variant of renderContentItem — renders items in white text without
 * bullets markers heavier than plain dots, for the shaded sidebar cell.
 */
function renderSidebarContentItem(
  item: RenderContentItem,
  children: Paragraph[],
  L: ResumeLayoutModel,
  whiteHex: string,
): void {
  switch (item.kind) {
    case "text":
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: parseMarkdownToTextRuns(item.text, {
          size: L.bodyFontSizePt * 2,
          font: L.fontFamily,
          color: whiteHex,
        }),
      }));
      break;

    case "bullets":
      for (const b of item.bullets) {
        children.push(new Paragraph({
          spacing: { after: 20 },
          children: parseMarkdownToTextRuns(`\u2022 ${b.replace(/^[\u2022\u25CF\u2023\u2043\u2219\u00B7*\-\s]+/, "")}`, {
            size: L.bodyFontSizePt * 2,
            font: L.fontFamily,
            color: whiteHex,
          }),
        }));
      }
      break;

    case "nested-bullets":
      for (const group of item.groups) {
        children.push(new Paragraph({
          spacing: { after: 20 },
          children: [
            new TextRun({ text: `${group.label}: `, bold: true, size: L.bodyFontSizePt * 2, font: L.fontFamily, color: whiteHex }),
            ...parseMarkdownToTextRuns(group.items.join(", "), {
              size: L.bodyFontSizePt * 2,
              font: L.fontFamily,
              color: whiteHex,
            }),
          ],
        }));
      }
      break;

    case "table-row": {
      const leftText = item.cells.find((c) => c.align === "left" || !c.align)?.text ?? "";
      const rightCell = item.cells.find((c) => c.align === "right");
      children.push(new Paragraph({
        spacing: { after: 20 },
        children: [
          ...parseMarkdownToTextRuns(leftText, { size: L.bodyFontSizePt * 2, font: L.fontFamily, color: whiteHex, bold: true }),
          ...(rightCell?.text ? parseMarkdownToTextRuns(` \u00B7 ${rightCell.text}`, { size: L.bodyFontSizePt * 2, font: L.fontFamily, color: whiteHex }) : []),
        ],
      }));
      break;
    }
  }
}
