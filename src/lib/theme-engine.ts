// ============================================================================
// ThemeEngine — resolves theme values from template + layout model
// ============================================================================
// Every renderer uses the resolved theme for fonts, colors, and spacing.
// No renderer may hardcode typography values.

import type { ResumeTheme, ResumeTemplate, ResumeLayoutModel } from "./types-phase3";
/** Bullet character per icon style */
function getBulletChar(iconStyle: ResumeTheme["iconStyle"]): string {
  switch (iconStyle) {
    case "bullet": return "•";
    case "checkmark": return "✓";
    case "arrow": return "→";
    default: return "•";
  }
}

/** Spacing values (in mm) per icon style */
function getBulletIndentMm(iconStyle: ResumeTheme["iconStyle"]): number {
  return 6.4; // consistent across all styles
}

const FALLBACK_COLORS = {
  nameColor: "#1a1a1a",
  headlineColor: "#333333",
  sectionTitleColor: "#2c3e50",
  bodyTextColor: "#000000",
  contactColor: "#333333",
  accentColor: "#2c5282",
  backgroundColor: "#ffffff",
  borderColor: "#cccccc",
};

const FALLBACK_SPACING = {
  sectionGapMm: 3.0,
  headerGapMm: 1.0,
  bulletIndentMm: 6.4,
  paragraphSpacingMm: 1.5,
  marginTopMm: 6.35,
  marginBottomMm: 6.35,
  marginLeftMm: 8.89,
  marginRightMm: 8.89,
};

/**
 * Build a fully resolved ResumeTheme from a template name + optional layout model.
 */
export function buildTheme(
  template: ResumeTemplate,
  accentColor?: string,
  layout?: Partial<ResumeLayoutModel>,
): ResumeTheme {
  // Merge layout override into defaults
  const L: ResumeLayoutModel = {
    pageSize: "A4",
    marginTopMm: FALLBACK_SPACING.marginTopMm,
    marginBottomMm: FALLBACK_SPACING.marginBottomMm,
    marginLeftMm: FALLBACK_SPACING.marginLeftMm,
    marginRightMm: FALLBACK_SPACING.marginRightMm,
    fontFamily: "Calibri",
    fallbackFontFamily: "Liberation Sans",
    nameSizePt: 16,
    sectionTitleSizePt: 11,
    bodyFontSizePt: 10,
    nameColor: FALLBACK_COLORS.nameColor,
    sectionTitleColor: FALLBACK_COLORS.sectionTitleColor,
    bodyTextColor: FALLBACK_COLORS.bodyTextColor,
    contactColor: FALLBACK_COLORS.contactColor,
    lineHeightMm: 4.2,
    sectionGapMm: FALLBACK_SPACING.sectionGapMm,
    headerGapMm: FALLBACK_SPACING.headerGapMm,
    bulletIndentMm: FALLBACK_SPACING.bulletIndentMm,
    paragraphSpacingMm: FALLBACK_SPACING.paragraphSpacingMm,
    photoWidthMm: 30,
    photoHeightMm: 40,
    enforceOnePage: true,
    minFontSizePt: 8,
    ...layout,
  };

  const iconStyle: ResumeTheme["iconStyle"] = (() => {
    switch (template) {
      case "modern":
      case "startup": return "checkmark";
      case "creative": return "arrow";
      default: return "bullet";
    }
  })();

  const showDividers: ResumeTheme["showDividers"] = (() => {
    switch (template) {
      case "executive":
      case "corporate":
      case "academic":
      case "consulting": return true;
      default: return false;
    }
  })();

  const borderStyle: ResumeTheme["borderStyle"] = (() => {
    switch (template) {
      case "executive": return "double";
      case "classic": return "solid";
      default: return "none";
    }
  })();

  return {
    name: template,
    fontFamily: L.fontFamily,
    fallbackFontFamily: L.fallbackFontFamily,
    nameSizePt: L.nameSizePt,
    headlineSizePt: L.nameSizePt - 2,
    sectionTitleSizePt: L.sectionTitleSizePt,
    bodyFontSizePt: L.bodyFontSizePt,
    minFontSizePt: L.minFontSizePt,
    lineHeight: 1.15,
    lineHeightMm: L.lineHeightMm,
    nameColor: L.nameColor,
    headlineColor: L.contactColor,
    sectionTitleColor: L.sectionTitleColor,
    bodyTextColor: L.bodyTextColor,
    contactColor: L.contactColor,
    accentColor: accentColor || L.sectionTitleColor,
    backgroundColor: "#ffffff",
    borderColor: "#cccccc",
    sectionGapMm: L.sectionGapMm,
    headerGapMm: L.headerGapMm,
    bulletIndentMm: getBulletIndentMm(iconStyle),
    paragraphSpacingMm: L.paragraphSpacingMm,
    marginTopMm: L.marginTopMm,
    marginBottomMm: L.marginBottomMm,
    marginLeftMm: L.marginLeftMm,
    marginRightMm: L.marginRightMm,
    pageSize: L.pageSize,
    columns: 1,
    columnGapMm: 0,
    enforceOnePage: L.enforceOnePage,
    showDividers,
    borderStyle,
    iconStyle,
  };
}

/**
 * Create a theme from a ResumeLayoutModel directly.
 */
export function themeFromLayout(layout: ResumeLayoutModel, template?: string): ResumeTheme {
  return buildTheme(
    (template as ResumeTemplate) || "ats-professional",
    undefined,
    layout,
  );
}
