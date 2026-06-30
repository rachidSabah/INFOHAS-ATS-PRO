// ============================================================================
// LayoutEngine — page layout, overflow detection, positioning
// ============================================================================
// Responsibilities:
//   - Calculate page dimensions from theme
//   - Position RenderNodes within pages
//   - Detect overflow and trigger compaction
//   - Widow/orphan control for section titles

import type { RenderNode, RenderNodePosition, ResumeTheme, PageLayout, LayoutResult, RenderNodeStyle } from "./types-phase3";

/** A4 dimensions in mm */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

/** Letter dimensions in mm */
const LETTER_WIDTH_MM = 215.9;
const LETTER_HEIGHT_MM = 279.4;

/** Estimated line height contribution for one character */
const CHARS_PER_LINE = 75; // average for 10pt on A4

/**
 * Get page dimensions for a given page size.
 */
export function getPageDimensionsMm(pageSize: "A4" | "Letter"): { widthMm: number; heightMm: number } {
  return pageSize === "A4"
    ? { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM }
    : { widthMm: LETTER_WIDTH_MM, heightMm: LETTER_HEIGHT_MM };
}

/**
 * Create an initial PageLayout from theme values.
 */
export function createPageLayout(
  pageNumber: number,
  theme: ResumeTheme,
): PageLayout {
  const { widthMm, heightMm } = getPageDimensionsMm(theme.pageSize);
  return {
    pageNumber,
    widthMm,
    heightMm,
    marginTopMm: theme.marginTopMm,
    marginBottomMm: theme.marginBottomMm,
    marginLeftMm: theme.marginLeftMm,
    marginRightMm: theme.marginRightMm,
    usableWidthMm: widthMm - theme.marginLeftMm - theme.marginRightMm,
    usableHeightMm: heightMm - theme.marginTopMm - theme.marginBottomMm,
    currentY: 0,
    remainingHeightMm: heightMm - theme.marginTopMm - theme.marginBottomMm,
    overflow: false,
  };
}

/**
 * Estimate the rendered height of a RenderNode in mm.
 * Used by the layout engine to position nodes before actual rendering.
 */
export function estimateNodeHeightMm(
  node: RenderNode,
  usableWidthMm: number,
  theme: ResumeTheme,
): number {
  const lineHeightMm = theme.lineHeightMm || 4.2;
  const baseFontSize = theme.bodyFontSizePt || 10;
  const avgCharWidthMm = usableWidthMm / CHARS_PER_LINE;

  // Base size for different node types
  switch (node.type) {
    case "section-title":
      return lineHeightMm * 1.4;
    case "text-line":
    case "contact-line":
      return lineHeightMm;
    case "bullet-item": {
      const charsPerLine = Math.floor(usableWidthMm / avgCharWidthMm) - 4; // indent
      const lines = Math.ceil(node.content.length / Math.max(charsPerLine, 1));
      return lines * lineHeightMm;
    }
    case "table-row":
      return lineHeightMm;
    case "table-cell":
      return lineHeightMm;
    case "divider":
      return 1.5;
    default:
      return lineHeightMm;
  }
}

/**
 * Calculate total estimated height for a list of nodes.
 */
export function estimateTotalHeightMm(
  nodes: RenderNode[],
  usableWidthMm: number,
  theme: ResumeTheme,
): number {
  let total = 0;
  for (const node of nodes) {
    total += estimateNodeHeightMm(node, usableWidthMm, theme);
    // Add margins
    if (node.style.marginTopMm) total += node.style.marginTopMm;
    if (node.style.marginBottomMm) total += node.style.marginBottomMm;
  }
  return total;
}

/**
 * Position a list of RenderNodes across pages.
 * Assigns page number and y-offset to each node.
 */
export function layoutNodes(
  nodes: RenderNode[],
  theme: ResumeTheme,
): LayoutResult {
  const pages: PageLayout[] = [];
  let currentPage = createPageLayout(0, theme);
  pages.push(currentPage);

  const positionedNodes: RenderNode[] = [];

  for (const node of nodes) {
    const estimatedHeight = estimateNodeHeightMm(node, currentPage.usableWidthMm, theme);
    const marginTop = node.style.marginTopMm || 0;
    const marginBottom = node.style.marginBottomMm || 0;
    const totalHeight = estimatedHeight + marginTop + marginBottom;

    // Check if node fits on current page
    if (currentPage.remainingHeightMm < totalHeight && currentPage.currentY > 0) {
      // Start a new page
      currentPage = createPageLayout(pages.length, theme);
      pages.push(currentPage);
    }

    // Position the node
    const position: RenderNodePosition = {
      page: currentPage.pageNumber,
      order: currentPage.currentY > 0
        ? positionedNodes.filter((n) => n.position?.page === currentPage.pageNumber).length
        : 0,
      xMm: theme.marginLeftMm,
      yMm: theme.marginTopMm + currentPage.currentY + marginTop,
      widthMm: currentPage.usableWidthMm,
      heightMm: estimatedHeight,
    };

    currentPage.currentY += totalHeight;
    currentPage.remainingHeightMm -= totalHeight;

    const positionedNode: RenderNode = {
      ...node,
      position,
    };
    positionedNodes.push(positionedNode);
  }

  // Check overflow
  const hasOverflow = currentPage.currentY > (currentPage.heightMm - currentPage.marginTopMm - currentPage.marginBottomMm);

  return {
    pages: pages.map((p) => ({
      ...p,
      overflow: p.remainingHeightMm < 0,
    })),
    nodes: positionedNodes,
    totalPages: pages.length,
    hasOverflow,
  };
}

/**
 * Detect if content overflows a single page.
 */
export function detectOverflow(estimatedTotalMm: number, theme: ResumeTheme): boolean {
  const { heightMm } = getPageDimensionsMm(theme.pageSize);
  const usableHeight = heightMm - theme.marginTopMm - theme.marginBottomMm;
  return estimatedTotalMm > usableHeight;
}

/**
 * Suggest compression steps when content overflows.
 * Never removes content — only adjusts spacing and font sizes.
 */
export function suggestCompression(
  overflowMm: number,
  theme: ResumeTheme,
): string[] {
  const steps: string[] = [];

  // Step 1: reduce line spacing
  if (theme.lineHeightMm > 3.2) {
    steps.push("reduce-line-spacing");
  }

  // Step 2: reduce section gap
  if (theme.sectionGapMm > 1.5) {
    steps.push("reduce-section-gap");
  }

  // Step 3: reduce margins
  if (theme.marginTopMm > 4) {
    steps.push("reduce-margins");
  }

  // Step 4: reduce body font size
  if (theme.bodyFontSizePt > 9) {
    steps.push("reduce-font-size");
  }

  return steps;
}
