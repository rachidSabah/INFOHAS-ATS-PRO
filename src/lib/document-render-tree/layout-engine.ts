// ============================================================================
// LayoutEngine — Page layout, margins, columns, shared calculations
// ============================================================================
// The Preview, DOCX, and PDF renderers MUST use the SAME layout calculations.
// ============================================================================

import type { ResumeTheme } from "../types-phase3";
import type { DocumentNode, DocumentNodeStyle, DocumentNodePosition, LayoutResult } from "./types";
import { ptToMm, estimateLines, estimateTextHeightMm } from "./typography-engine";

/** A4 dimensions in mm */
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/** Letter dimensions in mm */
export const LETTER_WIDTH_MM = 215.9;
export const LETTER_HEIGHT_MM = 279.4;

export interface PageDimensions {
  widthMm: number;
  heightMm: number;
}

export interface PageLayoutState {
  pageNumber: number;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  usableWidthMm: number;
  usableHeightMm: number;
  currentY: number;
  remainingHeightMm: number;
  overflow: boolean;
}

export interface NodeHeightEstimate {
  heightMm: number;
  lines: number;
  marginTopMm: number;
  marginBottomMm: number;
}

export interface LayoutOptions {
  widowsLines?: number;       // minimum lines before page break (default: 2)
  orphansLines?: number;      // minimum lines at top of new page (default: 2)
  sectionTitleKeepWithNextLines?: number; // lines of next content to keep with section title
}

const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  widowsLines: 2,
  orphansLines: 2,
  sectionTitleKeepWithNextLines: 2,
};

/**
 * Get page dimensions for a given page size.
 */
export function getPageDimensions(pageSize: "A4" | "Letter"): PageDimensions {
  return pageSize === "A4"
    ? { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM }
    : { widthMm: LETTER_WIDTH_MM, heightMm: LETTER_HEIGHT_MM };
}

/**
 * Create a layout state for a page.
 */
export function createPageState(
  pageNumber: number,
  theme: ResumeTheme,
): PageLayoutState {
  const { widthMm, heightMm } = getPageDimensions(theme.pageSize);
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
 * Estimate the rendered height of a DocumentNode in mm.
 * Uses actual text measurement (line wrapping approximation).
 */
export function estimateNodeHeight(
  node: DocumentNode,
  usableWidthMm: number,
  theme: ResumeTheme,
): NodeHeightEstimate {
  const style = node.style;
  const fontSize = style.fontSizePt ?? theme.bodyFontSizePt;
  const lineHeight = style.lineHeight ?? theme.lineHeight;
  const lineHeightMmVal = ptToMm(fontSize) * lineHeight;

  let heightMm = 0;
  let lines = 0;

  switch (node.type) {
    case "section-title":
      heightMm = lineHeightMmVal * 1.4;
      lines = 1;
      break;

    case "text-line":
    case "contact-line":
      lines = estimateLines(node.content, usableWidthMm, fontSize);
      heightMm = lines * lineHeightMmVal;
      break;

    case "bullet-item": {
      const indent = (style.paddingLeftMm || 0) + 4; // bullet character indent
      const availWidth = usableWidthMm - indent;
      lines = estimateLines(node.content, availWidth, fontSize);
      heightMm = lines * lineHeightMmVal;
      break;
    }

    case "table-row":
    case "table-cell":
      lines = estimateLines(node.content, usableWidthMm, fontSize);
      heightMm = Math.max(lineHeightMmVal, lines * lineHeightMmVal);
      break;

    case "nested-group-label":
      heightMm = lineHeightMmVal;
      lines = 1;
      break;

    case "nested-group-item":
      lines = estimateLines(node.content, usableWidthMm, fontSize);
      heightMm = lines * lineHeightMmVal;
      break;

    case "divider":
      heightMm = 1.5;
      lines = 0;
      break;

    case "spacer":
      heightMm = style.heightMm ?? 2;
      lines = 0;
      break;

    case "photo": {
      const pw = style.photoWidthMm ?? 30;
      const ph = style.photoHeightMm ?? 40;
      heightMm = ph;
      lines = 0;
      break;
    }

    case "page-break":
      heightMm = 0;
      lines = 0;
      break;

    default:
      heightMm = lineHeightMmVal;
      lines = 1;
  }

  // Apply margin contributions
  const marginTop = style.marginTopMm ?? 0;
  const marginBottom = style.marginBottomMm ?? 0;

  return {
    heightMm,
    lines,
    marginTopMm: marginTop,
    marginBottomMm: marginBottom,
  };
}

/**
 * Layout a flat list of DocumentNodes across pages.
 * Applies widows, orphans, keep-with-next, and keep-together rules.
 */
export function layoutDocumentNodes(
  nodes: DocumentNode[],
  theme: ResumeTheme,
  options?: LayoutOptions,
): LayoutResult {
  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const pages: PageLayoutState[] = [];
  let currentPage = createPageState(0, theme);
  pages.push(currentPage);

  const positionedNodes: DocumentNode[] = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];
    const estimate = estimateNodeHeight(node, currentPage.usableWidthMm, theme);
    const totalHeight = estimate.heightMm + estimate.marginTopMm + estimate.marginBottomMm;

    // Handle explicit page breaks
    if (node.type === "page-break") {
      currentPage = createPageState(pages.length, theme);
      pages.push(currentPage);
      i++;
      continue;
    }

    // Check if this node needs a new page
    const needsNewPage =
      currentPage.currentY > 0 &&
      currentPage.remainingHeightMm < totalHeight;

    if (needsNewPage) {
      // Widows/orphans check: if this is a "keep-with-next" section title
      // and the remaining content is less than `sectionTitleKeepWithNextLines`,
      // also push the section title to the next page.
      if (node.style.keepWithNext && i - 1 >= 0) {
        const prevNode = positionedNodes[positionedNodes.length - 1];
        if (prevNode && prevNode.type === "section-title") {
          // Remove the section title from current page and prepend to next
          positionedNodes.pop();
          currentPage.currentY -= (
            estimateNodeHeight(prevNode, currentPage.usableWidthMm, theme).heightMm +
            (prevNode.style.marginBottomMm ?? 0)
          );
          currentPage.remainingHeightMm += (
            estimateNodeHeight(prevNode, currentPage.usableWidthMm, theme).heightMm +
            (prevNode.style.marginBottomMm ?? 0)
          );
          nodes = [...nodes.slice(0, i - 1), prevNode, ...nodes.slice(i)];
          continue;
        }
      }

      currentPage = createPageState(pages.length, theme);
      pages.push(currentPage);
    }

    // Position the node
    const position: DocumentNodePosition = {
      page: currentPage.pageNumber,
      order: positionedNodes.filter((n) => n.position?.page === currentPage.pageNumber).length,
      xMm: theme.marginLeftMm + estimate.marginTopMm, // account for padding
      yMm: theme.marginTopMm + currentPage.currentY + estimate.marginTopMm,
      widthMm: currentPage.usableWidthMm,
      heightMm: estimate.heightMm,
      pageBreakBefore: needsNewPage,
    };

    currentPage.currentY += totalHeight;
    currentPage.remainingHeightMm -= totalHeight;

    const positionedNode: DocumentNode = {
      ...node,
      position,
    };
    positionedNodes.push(positionedNode);
    i++;
  }

  const hasOverflow = currentPage.currentY > (currentPage.heightMm - currentPage.marginTopMm - currentPage.marginBottomMm);
  const totalPages = pages.length;

  return {
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
      marginTopMm: p.marginTopMm,
      marginBottomMm: p.marginBottomMm,
      marginLeftMm: p.marginLeftMm,
      marginRightMm: p.marginRightMm,
      usableWidthMm: p.usableWidthMm,
      usableHeightMm: p.usableHeightMm,
      currentY: p.currentY,
      remainingHeightMm: p.remainingHeightMm,
      overflow: p.overflow || p.remainingHeightMm < 0,
    })),
    totalPages,
    hasOverflow,
  };
}

/**
 * Detect if content overflows a single page.
 */
export function detectOverflow(
  estimatedTotalMm: number,
  theme: ResumeTheme,
): boolean {
  const { heightMm } = getPageDimensions(theme.pageSize);
  const usableHeight = heightMm - theme.marginTopMm - theme.marginBottomMm;
  return estimatedTotalMm > usableHeight;
}

/**
 * Suggest compression steps when content overflows.
 */
export function suggestCompression(
  overflowMm: number,
  theme: ResumeTheme,
): string[] {
  const steps: string[] = [];

  if (theme.lineHeightMm > 3.2) {
    steps.push("reduce-line-spacing");
  }
  if (theme.sectionGapMm > 1.5) {
    steps.push("reduce-section-gap");
  }
  if (theme.marginTopMm > 4) {
    steps.push("reduce-margins");
  }
  if (theme.bodyFontSizePt > 9) {
    steps.push("reduce-font-size");
  }

  return steps;
}
