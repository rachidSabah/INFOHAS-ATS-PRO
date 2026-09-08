// ResumeAI Pro — ResumeLayoutModel defaults (pure leaf module)
//
// Extracted from exporter.ts so that browser-only export code (jsPDF, docx,
// file-saver) never enters the module graph of server-rendered pages. The
// public /r reader reaches A4Preview → render-document → getDefaultResumeLayout;
// exporter.ts statically imports file-saver, whose module scope crashes the
// Cloudflare Pages edge runtime — so /r must be able to resolve this function
// WITHOUT evaluating exporter.ts.

import { useApp } from "./store";
import type { ResumeLayoutModel } from "./types";

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

    sectionOrder: config?.sectionOrder ?? ["summary", "experience", "education", "skills", "languages", "projects", "certifications", "additionalInfo"],
    contactSpacing: config?.contactSpacing ?? "stacked",

    bodyAlignment: config?.bodyAlignment ?? "justify",
    sectionAlignment: config?.sectionAlignment ?? {},
  };
}
