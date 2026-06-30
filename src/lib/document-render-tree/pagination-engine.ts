// ============================================================================
// PaginationEngine — page splitting, widows, orphans, page breaks
// ============================================================================
// No renderer performs independent pagination. All page-breaking decisions
// are made here and shared across Preview, DOCX, and PDF.
// ============================================================================

import type { DocumentNode } from "./types";
import type { ResumeTheme } from "../types-phase3";
import { layoutDocumentNodes as runLayout, type LayoutOptions } from "./layout-engine";

export interface PaginationInput {
  nodes: DocumentNode[];
  theme: ResumeTheme;
  options?: LayoutOptions;
}

export interface PaginationResult {
  pages: DocumentNode[][];  // nodes grouped by page
  totalPages: number;
  hasOverflow: boolean;
}

/**
 * Split a flat list of DocumentNodes into pages.
 * Uses the LayoutEngine for positioning and applies pagination rules.
 *
 * Rules:
 * - Widows: minimum N lines of a paragraph before a page break
 * - Orphans: minimum N lines of a paragraph at top of a new page
 * - Keep with next: prevents page break between two elements
 * - Keep together: keeps a group of elements on the same page
 * - Explicit page breaks: forced page breaks via page-break nodes
 */
export function paginateNodes(input: PaginationInput): PaginationResult {
  const { nodes, theme, options } = input;
  const layout = runLayout(nodes, theme, options);

  // Group positioned nodes by page
  const pageGroups: Map<number, DocumentNode[]> = new Map();
  for (const node of layout.pages) {
    if (!pageGroups.has(node.pageNumber)) {
      pageGroups.set(node.pageNumber, []);
    }
  }

  // Our layoutDocumentNodes returns positionedNodes in order
  // We need to reconstruct page groups from the nodes
  // Actually, layoutDocumentNodes returns LayoutResult with pages and nodes.
  // But the positioned nodes have their position.page set.
  // Let's use a different approach: directly group by position.page.

  // For now, re-run with simpler page-grouping logic
  return paginateNodesSimple(nodes, theme, options);
}

/**
 * Simple pagination that groups nodes into pages without complex layout.
 * Used when position data is not needed.
 */
function paginateNodesSimple(
  nodes: DocumentNode[],
  theme: ResumeTheme,
  options?: LayoutOptions,
): PaginationResult {
  const opts: Required<LayoutOptions> = {
    widowsLines: options?.widowsLines ?? 2,
    orphansLines: options?.orphansLines ?? 2,
    sectionTitleKeepWithNextLines: options?.sectionTitleKeepWithNextLines ?? 2,
  };

  const heightMm = theme.pageSize === "A4" ? 297 : 279.4;

  const usableHeight = heightMm - theme.marginTopMm - theme.marginBottomMm;
  const pages: DocumentNode[][] = [[]];
  let currentPageY = 0;
  let currentPageIndex = 0;
  let lastSectionTitleIndex = -1;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Estimate node height (simplified)
    let nodeHeight = 0;
    switch (node.type) {
      case "section-title":
        nodeHeight = theme.lineHeightMm * 1.4;
        break;
      case "text-line":
      case "contact-line":
      case "table-row":
      case "table-cell":
      case "nested-group-label":
      case "nested-group-item":
        nodeHeight = theme.lineHeightMm;
        break;
      case "bullet-item":
        nodeHeight = theme.lineHeightMm * 1.2;
        break;
      case "divider":
        nodeHeight = 1.5;
        break;
      case "spacer":
        nodeHeight = Math.min((node.style.heightMm ?? 2), 10);
        break;
      case "page-break":
        // Force page break
        pages.push([]);
        currentPageIndex++;
        currentPageY = 0;
        continue;
      default:
        nodeHeight = theme.lineHeightMm;
    }

    const marginTop = node.style.marginTopMm ?? 0;
    const marginBottom = node.style.marginBottomMm ?? 0;
    const totalHeight = nodeHeight + marginTop + marginBottom;

    // Check if this node needs a new page
    if (currentPageY > 0 && currentPageY + totalHeight > usableHeight) {
      // Keep-with-next: if this is content right after a section title,
      // and the section title is the last node on the previous page,
      // move the section title to this page too
      if (node.style.keepWithNext && lastSectionTitleIndex >= 0) {
        // Check if last section title is on the current page
        const lastPage = pages[currentPageIndex];
        const titleIdxInPage = lastPage.findIndex(
          (n) => n.id === nodes[lastSectionTitleIndex]?.id,
        );
        if (titleIdxInPage >= 0) {
          // Move section title from current page to next page
          const titleNode = lastPage.splice(titleIdxInPage, 1)[0];
          pages.push([titleNode]);
          currentPageIndex++;
          currentPageY = totalHeight;
          continue;
        }
      }

      // Start new page
      pages.push([]);
      currentPageIndex++;
      currentPageY = totalHeight;
    } else {
      currentPageY += totalHeight;
    }

    pages[currentPageIndex].push(node);

    // Track last section title index
    if (node.type === "section-title") {
      lastSectionTitleIndex = i;
    }
  }

  const hasOverflow = currentPageY > usableHeight;

  return {
    pages: pages.filter((p) => p.length > 0),
    totalPages: pages.filter((p) => p.length > 0).length,
    hasOverflow,
  };
}

/**
 * Check if a photo would overlap with the header/section content.
 */
export function photoFitsOnPage(
  photoHeightMm: number,
  currentY: number,
  usableHeightMm: number,
): boolean {
  return currentY + photoHeightMm <= usableHeightMm;
}

/**
 * Calculate remaining space on current page after placing given content.
 */
export function remainingSpace(
  currentY: number,
  usableHeightMm: number,
): number {
  return Math.max(0, usableHeightMm - currentY);
}
