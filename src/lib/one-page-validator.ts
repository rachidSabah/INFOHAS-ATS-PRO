// ============================================================================
// OnePageValidator — compress content to fit one page, never remove content
// ============================================================================

import type { ResumeTheme, CompressionResult } from "./types-phase3";
import { getPageDimensionsMm } from "./layout-engine";

interface CompressionLevel {
  lineHeightMm: number;
  sectionGapMm: number;
  paragraphSpacingMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  bodyFontSizePt: number;
}

/**
 * Progressive compression levels.
 * Each level reduces spacing/font more aggressively but NEVER removes content.
 */
const COMPRESSION_LEVELS: CompressionLevel[] = [
  // Level 0 — default / no compression
  { lineHeightMm: 4.2, sectionGapMm: 3.0, paragraphSpacingMm: 1.5, marginTopMm: 6.35, marginBottomMm: 6.35, marginLeftMm: 8.89, marginRightMm: 8.89, bodyFontSizePt: 10 },
  // Level 1 — reduce line spacing
  { lineHeightMm: 3.7, sectionGapMm: 2.5, paragraphSpacingMm: 1.2, marginTopMm: 6.35, marginBottomMm: 6.35, marginLeftMm: 8.89, marginRightMm: 8.89, bodyFontSizePt: 10 },
  // Level 2 — reduce gaps
  { lineHeightMm: 3.5, sectionGapMm: 2.0, paragraphSpacingMm: 1.0, marginTopMm: 5.0, marginBottomMm: 5.0, marginLeftMm: 7.0, marginRightMm: 7.0, bodyFontSizePt: 9.5 },
  // Level 3 — tighter margins
  { lineHeightMm: 3.3, sectionGapMm: 1.5, paragraphSpacingMm: 0.8, marginTopMm: 4.0, marginBottomMm: 4.0, marginLeftMm: 6.0, marginRightMm: 6.0, bodyFontSizePt: 9 },
  // Level 4 — smallest font within limits
  { lineHeightMm: 3.0, sectionGapMm: 1.0, paragraphSpacingMm: 0.5, marginTopMm: 3.0, marginBottomMm: 3.0, marginLeftMm: 5.0, marginRightMm: 5.0, bodyFontSizePt: 8 },
];

/**
 * Estimate total character count that fits on one page at a given compression level.
 */
function estimatePageCapacity(level: CompressionLevel, pageSize: "A4" | "Letter"): number {
  const { widthMm, heightMm } = getPageDimensionsMm(pageSize);
  const usableW = widthMm - level.marginLeftMm - level.marginRightMm;
  const usableH = heightMm - level.marginTopMm - level.marginBottomMm;

  const avgFontSize = level.bodyFontSizePt;
  const avgCharWidth = (usableW / (avgFontSize * 0.35)) * 0.9; // ~90% utilization
  const charsPerLine = Math.max(Math.floor(avgCharWidth), 30);
  const linesPerPage = Math.floor(usableH / level.lineHeightMm);

  return charsPerLine * linesPerPage;
}

/**
 * Estimate total height for a given character count at a given compression level.
 */
function estimateHeight(chars: number, level: CompressionLevel, pageSize: "A4" | "Letter"): number {
  const { widthMm } = getPageDimensionsMm(pageSize);
  const usableW = widthMm - level.marginLeftMm - level.marginRightMm;
  const avgFontSize = level.bodyFontSizePt;
  const avgCharWidth = (usableW / (avgFontSize * 0.35)) * 0.9;
  const charsPerLine = Math.max(Math.floor(avgCharWidth), 30);
  const lines = Math.ceil(chars / charsPerLine);
  return lines * level.lineHeightMm + level.sectionGapMm * 0.5; // partial section gaps
}

/**
 * Compress content to fit on one page.
 * Returns the theme adjustments needed without modifying content.
 */
export function compressToOnePage(
  totalChars: number,
  theme: ResumeTheme,
): CompressionResult {
  const steps: string[] = [];
  let currentLevelIdx = 0;
  let currentLevel = COMPRESSION_LEVELS[0];

  // Try each compression level until content fits or we run out of levels
  for (let i = 0; i < COMPRESSION_LEVELS.length; i++) {
    const level = COMPRESSION_LEVELS[i];
    const capacity = estimatePageCapacity(level, theme.pageSize);

    if (totalChars <= capacity || i === COMPRESSION_LEVELS.length - 1) {
      currentLevel = level;
      currentLevelIdx = i;
      break;
    }
  }

  // Record which steps were applied
  if (currentLevelIdx >= 1) steps.push("reduced-line-spacing");
  if (currentLevelIdx >= 2) steps.push("reduced-section-gaps");
  if (currentLevelIdx >= 3) steps.push("reduced-margins");
  if (currentLevelIdx >= 4) steps.push("reduced-font-size");

  // Estimate final height
  const estimatedHeight = estimateHeight(totalChars, currentLevel, theme.pageSize);
  const { heightMm } = getPageDimensionsMm(theme.pageSize);
  const usableHeight = heightMm - currentLevel.marginTopMm - currentLevel.marginBottomMm;
  const fitsOnOnePage = estimatedHeight <= usableHeight;

  return {
    originalChars: totalChars,
    compressedChars: totalChars, // content unchanged, only spacing
    compressionRatio: 1.0, // no content removed
    stepsApplied: steps,
    fitsOnOnePage,
  };
}

/**
 * Apply compression to a theme and return the adjusted theme.
 */
export function applyCompression(
  theme: ResumeTheme,
  result: CompressionResult,
): ResumeTheme {
  if (result.stepsApplied.length === 0) return theme;

  // Determine which compression level matches the applied steps
  let levelIdx = 0;
  if (result.stepsApplied.includes("reduced-line-spacing")) levelIdx = Math.max(levelIdx, 1);
  if (result.stepsApplied.includes("reduced-section-gaps")) levelIdx = Math.max(levelIdx, 2);
  if (result.stepsApplied.includes("reduced-margins")) levelIdx = Math.max(levelIdx, 3);
  if (result.stepsApplied.includes("reduced-font-size")) levelIdx = Math.max(levelIdx, 4);

  const level = COMPRESSION_LEVELS[levelIdx];

  return {
    ...theme,
    lineHeightMm: level.lineHeightMm,
    sectionGapMm: level.sectionGapMm,
    paragraphSpacingMm: level.paragraphSpacingMm,
    marginTopMm: level.marginTopMm,
    marginBottomMm: level.marginBottomMm,
    marginLeftMm: level.marginLeftMm,
    marginRightMm: level.marginRightMm,
    bodyFontSizePt: level.bodyFontSizePt,
  };
}
