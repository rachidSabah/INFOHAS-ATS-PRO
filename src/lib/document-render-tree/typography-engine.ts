// ============================================================================
// TypographyEngine — Single Source of Truth for Font & Spacing
// ============================================================================
// No renderer may define typography independently. All font families, sizes,
// colors, line heights, and spacing values are resolved here.
// ============================================================================

import type { ResumeTheme } from "../types-phase3";

export interface TypographyConfig {
  // Font
  fontFamily: string;
  fallbackFontFamily: string;

  // Sizes (pt)
  nameSizePt: number;
  headlineSizePt: number;
  sectionTitleSizePt: number;
  bodyFontSizePt: number;
  minFontSizePt: number;

  // Colors
  nameColor: string;
  headlineColor: string;
  sectionTitleColor: string;
  bodyTextColor: string;
  contactColor: string;
  accentColor: string;
  backgroundColor: string;
  borderColor: string;

  // Spacing (mm)
  lineHeightMm: number;
  sectionGapMm: number;
  headerGapMm: number;
  bulletIndentMm: number;
  paragraphSpacingMm: number;
  bulletSpacingMm: number;
  headingSpacingMm: number;

  // Line height multiplier
  lineHeight: number;
}

/**
 * Build TypographyConfig from a ResumeTheme (which already has these values).
 * This resolves the theme's typography values into a stable config.
 * Future: support dynamic font loading, custom fonts, ligatures.
 */
export function buildTypographyConfig(theme: ResumeTheme): TypographyConfig {
  return {
    fontFamily: theme.fontFamily,
    fallbackFontFamily: theme.fallbackFontFamily,
    nameSizePt: theme.nameSizePt,
    headlineSizePt: theme.headlineSizePt,
    sectionTitleSizePt: theme.sectionTitleSizePt,
    bodyFontSizePt: theme.bodyFontSizePt,
    minFontSizePt: theme.minFontSizePt,
    nameColor: theme.nameColor,
    headlineColor: theme.headlineColor,
    sectionTitleColor: theme.sectionTitleColor,
    bodyTextColor: theme.bodyTextColor,
    contactColor: theme.contactColor,
    accentColor: theme.accentColor,
    backgroundColor: theme.backgroundColor,
    borderColor: theme.borderColor,
    lineHeightMm: theme.lineHeightMm,
    sectionGapMm: theme.sectionGapMm,
    headerGapMm: theme.headerGapMm,
    bulletIndentMm: theme.bulletIndentMm,
    paragraphSpacingMm: theme.paragraphSpacingMm,
    bulletSpacingMm: theme.paragraphSpacingMm * 0.5,
    headingSpacingMm: theme.sectionGapMm,
    lineHeight: theme.lineHeight,
  };
}

/**
 * Convert pt to mm.
 */
export function ptToMm(pt: number): number {
  return pt * 0.352778;
}

/**
 * Convert mm to pt.
 */
export function mmToPt(mm: number): number {
  return mm / 0.352778;
}

/**
 * Get the visual line height for a given font size, in mm.
 */
export function lineHeightMm(fontSizePt: number, lineHeightRatio: number): number {
  return ptToMm(fontSizePt) * lineHeightRatio;
}

/**
 * Estimate the number of rendered lines for text given available width.
 * Rough approximation — assumes avg char width ≈ fontPt * 0.5 in mm.
 */
export function estimateLines(text: string, availableWidthMm: number, fontSizePt: number): number {
  if (!text || availableWidthMm <= 0) return 0;
  const avgCharWidthMm = ptToMm(fontSizePt) * 0.5;
  const charsPerLine = Math.max(1, Math.floor(availableWidthMm / avgCharWidthMm));
  return Math.ceil(text.length / charsPerLine);
}

/**
 * Estimate rendered height for a piece of text in mm.
 */
export function estimateTextHeightMm(
  text: string,
  availableWidthMm: number,
  fontSizePt: number,
  lineHeightRatio: number,
): number {
  const lines = estimateLines(text, availableWidthMm, fontSizePt);
  return lines * lineHeightMm(fontSizePt, lineHeightRatio);
}

/**
 * Apply compression to typography when content overflows.
 * Adjusts spacing and font sizes while respecting minimums.
 */
export function compressTypography(
  config: TypographyConfig,
  steps: string[],
): TypographyConfig {
  let result = { ...config };

  for (const step of steps) {
    switch (step) {
      case "reduce-line-spacing":
        result.lineHeight = Math.max(1.0, result.lineHeight - 0.1);
        result.lineHeightMm = lineHeightMm(result.bodyFontSizePt, result.lineHeight);
        break;
      case "reduce-section-gap":
        result.sectionGapMm = Math.max(1.0, result.sectionGapMm - 0.5);
        result.headingSpacingMm = result.sectionGapMm;
        break;
      case "reduce-margins":
        // Margins are handled by layout, not typography
        break;
      case "reduce-font-size":
        result.bodyFontSizePt = Math.max(result.minFontSizePt, result.bodyFontSizePt - 0.5);
        result.lineHeightMm = lineHeightMm(result.bodyFontSizePt, result.lineHeight);
        break;
    }
  }

  return result;
}
