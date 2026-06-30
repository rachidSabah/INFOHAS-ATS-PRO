// ============================================================================
// DocumentRenderTree — Phase 5 Universal Render Node Types
// ============================================================================
// Extends Phase 3 RenderNode with photo, image, footer, page-break, spacer,
// table (proper), and dynamic section support.
//
// Every renderer (Preview, DOCX, PDF) consumes ONLY DocumentNode[].
// No renderer may read ResumeData or RenderDocument directly.
// ============================================================================

import type {
  RenderNode as Phase3RenderNode,
  RenderNodeStyle,
  RenderNodePosition,
  ResumeTheme,
  CanonicalSectionType,
  PageLayout,
} from "../types-phase3";

// ── Re-export Phase 3 types used by Phase 5 ─────────────────────────────
export type {
  RenderNodeStyle,
  RenderNodePosition,
  ResumeTheme,
  CanonicalSectionType,
  PageLayout,
};

// ═══════════════════════════════════════════════════════════════════════════
// Enhanced RenderNodeType — all node types supported in Phase 5
// ═══════════════════════════════════════════════════════════════════════════

/** Additional node types added for Phase 5 beyond Phase 3 */
export type Phase5NodeType =
  | "photo"
  | "image"
  | "footer"
  | "spacer"
  | "page-break"
  | "table"
  | "table-header"
  | "table-body"
  | "table-row"
  | "table-cell"
  | "column"
  | "column-layout"
  | "dynamic-section"
  | "certification-item"
  | "project-item"
  | "achievement-item"
  | "link";

/** Complete node type universe (Phase 3 + Phase 5) */
export type DocumentNodeType =
  | Phase3RenderNode["type"]
  | Phase5NodeType;

// ═══════════════════════════════════════════════════════════════════════════
// DocumentNode — the universal render tree node
// ═══════════════════════════════════════════════════════════════════════════

export interface DocumentNode {
  /** Unique identifier */
  id: string;
  /** Node type */
  type: DocumentNodeType;
  /** Parent node ID (null for root) */
  parentId: string | null;
  /** Child nodes */
  children: DocumentNode[];
  /** Text content (may be empty for container nodes) */
  content: string;
  /** Resolved style */
  style: DocumentNodeStyle;
  /** Whether this node is visible */
  visibility: "visible" | "hidden" | "collapsed";
  /** Position within the page layout — null until layout engine runs */
  position: DocumentNodePosition | null;
  /** Section type this node belongs to (for dynamic rendering) */
  sectionType?: CanonicalSectionType;
  /** Arbitrary metadata (e.g., urls, custom data) */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Enhanced Style — Phase 3 style + Phase 5 additions
// ═══════════════════════════════════════════════════════════════════════════

export interface DocumentNodeStyle {
  // Typography
  fontFamily?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  backgroundColor?: string;
  letterSpacingPt?: number;
  lineHeight?: number; // unitless multiplier

  // Alignment
  textAlign?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";

  // Spacing
  paddingTopMm?: number;
  paddingBottomMm?: number;
  paddingLeftMm?: number;
  paddingRightMm?: number;
  marginTopMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;

  // Sizing
  widthMm?: number;
  heightMm?: number;
  minHeightMm?: number;
  maxWidthMm?: number;

  // Borders
  borderTop?: { widthPt: number; color: string; style: "solid" | "dotted" | "double" };
  borderBottom?: { widthPt: number; color: string; style: "solid" | "dotted" | "double" };
  borderLeft?: { widthPt: number; color: string; style: "solid" | "dotted" | "double" };
  borderRight?: { widthPt: number; color: string; style: "solid" | "dotted" | "double" };

  // Layout
  float?: "none" | "left" | "right";
  columnSpan?: number; // for column layouts
  widthFraction?: number; // 0-1, fraction of available width
  keepWithNext?: boolean;
  keepTogether?: boolean;

  // Photo
  photoPlacement?: "top-right" | "top-left" | "inline";
  photoCrop?: "circle" | "square" | "rounded";
  photoWidthMm?: number;
  photoHeightMm?: number;

  // List
  listStyle?: "disc" | "circle" | "square" | "none";
  listLevel?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Enhanced Position
// ═══════════════════════════════════════════════════════════════════════════

export interface DocumentNodePosition {
  page: number;
  order: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** Whether this node starts on a new page */
  pageBreakBefore?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// SectionRenderer interface
// ═══════════════════════════════════════════════════════════════════════════

export interface SectionRenderer {
  /** The section type this renderer handles */
  sectionType: CanonicalSectionType;
  /** Convert section data to DocumentNode[] */
  render(data: SectionRenderData): DocumentNode[];
}

export interface SectionRenderData {
  title: string;
  items: SectionRenderItem[];
  sectionType: CanonicalSectionType;
  metadata?: Record<string, unknown>;
}

export type SectionRenderItem =
  | { kind: "text"; text: string; bold?: boolean; italic?: boolean; fontSizePt?: number }
  | { kind: "bullets"; bullets: string[]; level?: number }
  | { kind: "table-row"; cells: Array<{ text: string; bold?: boolean; align?: "left" | "right" }> }
  | { kind: "nested-bullets"; groups: Array<{ label: string; items: string[] }> }
  | { kind: "photo"; url: string; caption?: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "spacer"; heightMm: number }
  | { kind: "certification"; name: string; issuer?: string; date?: string; url?: string }
  | { kind: "project"; name: string; description?: string; url?: string; technologies?: string[] }
  | { kind: "achievement"; title: string; description?: string; date?: string };

// ═══════════════════════════════════════════════════════════════════════════
// Full Document Tree
// ═══════════════════════════════════════════════════════════════════════════

export interface DocumentTree {
  /** The root document node */
  root: DocumentNode;
  /** Theme applied */
  theme: ResumeTheme;
  /** Section type → renderer mapping */
  renderers: Map<CanonicalSectionType, SectionRenderer>;
  /** Page layout computed by LayoutEngine */
  layout: LayoutResult;
  /** Warnings generated during tree building */
  warnings: string[];
}

export interface LayoutResult {
  pages: PageLayout[];
  totalPages: number;
  hasOverflow: boolean;
}
