// ============================================================================
// Phase 3 — Canonical Resume Rendering Engine types
// Added to the existing types.ts under this marker block
// ============================================================================

import type {
  ResumeData,
  ResumeTemplate,
  ResumeLayoutModel,
  PreservationSnapshot,
} from "./types";

// Re-export base types needed by Phase 3 modules
export type { ResumeData, ResumeTemplate, ResumeLayoutModel };

// ═══════════════════════════════════════════════════════════════════════════
// RenderNode — universal render tree node consumed by EVERY renderer
// ═══════════════════════════════════════════════════════════════════════════

/** Known node types in the render tree */
export type RenderNodeType =
  | "document"
  | "page"
  | "header"
  | "contact-line"
  | "section"
  | "section-title"
  | "text-line"
  | "bullet-list"
  | "bullet-item"
  | "table-row"
  | "table-cell"
  | "nested-group"
  | "nested-group-label"
  | "nested-group-item"
  | "divider"
  | "page-break";

/** Resolved style attributes for a RenderNode */
export interface RenderNodeStyle {
  fontFamily?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  paddingTopMm?: number;
  paddingBottomMm?: number;
  paddingLeftMm?: number;
  paddingRightMm?: number;
  marginTopMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
}

/** Position within a page layout */
export interface RenderNodePosition {
  page: number;            // 0-indexed page number
  order: number;           // rendering order within page
  xMm: number;             // left edge from page left margin
  yMm: number;             // top edge from page top margin
  widthMm: number;         // computed width
  heightMm: number;        // computed height (may be 0 for auto-height)
}

/** A single node in the immutable render tree */
export interface RenderNode {
  id: string;
  type: RenderNodeType;
  parentId: string | null;
  children: RenderNode[];
  content: string;
  style: RenderNodeStyle;
  visibility: "visible" | "hidden" | "collapsed";
  position: RenderNodePosition | null;  // null until layout engine runs
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Theme — resolved theme values consumed by the render engine
// ═══════════════════════════════════════════════════════════════════════════

export interface ResumeTheme {
  name: string;

  // Typography
  fontFamily: string;
  fallbackFontFamily: string;
  nameSizePt: number;
  headlineSizePt: number;
  sectionTitleSizePt: number;
  bodyFontSizePt: number;
  minFontSizePt: number;
  lineHeight: number;
  lineHeightMm: number;

  // Colors
  nameColor: string;
  headlineColor: string;
  sectionTitleColor: string;
  bodyTextColor: string;
  contactColor: string;
  accentColor: string;
  backgroundColor: string;
  borderColor: string;

  // Spacing
  sectionGapMm: number;
  headerGapMm: number;
  bulletIndentMm: number;
  paragraphSpacingMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;

  // Layout
  pageSize: "A4" | "Letter";
  columns: number;
  columnGapMm: number;
  enforceOnePage: boolean;

  // Visual
  showDividers: boolean;
  borderStyle: "none" | "solid" | "double" | "dotted";
  iconStyle: "none" | "bullet" | "checkmark" | "arrow";
}

// ═══════════════════════════════════════════════════════════════════════════
// CanonicalResume — Single Source of Truth
// ═══════════════════════════════════════════════════════════════════════════

export interface CanonicalResume {
  // Metadata
  id: string;
  createdAt: string;
  updatedAt: string;
  source: ResumeData["source"];
  fileName?: string;

  // Header
  name: string;
  headline?: string;
  contact: {
    email?: string;
    phone?: string;
    location?: string;
    website?: string;
    linkedin?: string;
    github?: string;
    personalDetails?: Record<string, string>;
  };
  photoUrl?: string;

  // Canonical sections — in display order
  sections: CanonicalSection[];

  // Theme & layout
  theme: ResumeTheme;
  template: ResumeTemplate;

  // Preservation snapshot (Phase 2)
  snapshot?: PreservationSnapshot;

  // Validation result
  isValid: boolean;
  validationErrors: string[];
}

export interface CanonicalSection {
  id: string;
  type: CanonicalSectionType;
  title: string;
  order: number;
  items: CanonicalSectionItem[];
  metadata?: Record<string, unknown>;

  // Preservation data
  originalEntityCount: number;
  originalBulletCount: number;
  isDynamic: boolean;
}

export type CanonicalSectionType =
  | "professionalProfile"
  | "professionalExperience"
  | "education"
  | "skills"
  | "languages"
  | "projects"
  | "certifications"
  | "achievements"
  | "awards"
  | "volunteer"
  | "additionalInformation"
  | "dynamicSections";

export type CanonicalSectionItem =
  | { kind: "text"; text: string; bold?: boolean; italic?: boolean }
  | { kind: "bullets"; bullets: string[]; level?: number }
  | { kind: "table-row"; cells: Array<{ text: string; bold?: boolean; align?: "left" | "right" }> }
  | { kind: "nested-bullets"; groups: Array<{ label: string; items: string[] }> };

// ═══════════════════════════════════════════════════════════════════════════
// Layout Engine types
// ═══════════════════════════════════════════════════════════════════════════

export interface PageLayout {
  pageNumber: number;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  usableWidthMm: number;
  usableHeightMm: number;
  currentY: number;    // current cursor position from top of page
  remainingHeightMm: number;
  overflow: boolean;
}

export interface LayoutResult {
  pages: PageLayout[];
  nodes: RenderNode[];
  totalPages: number;
  hasOverflow: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// OnePageValidator types
// ═══════════════════════════════════════════════════════════════════════════

export interface CompressionResult {
  originalChars: number;
  compressedChars: number;
  compressionRatio: number;
  stepsApplied: string[];  // e.g. ["reduced-line-spacing", "reduced-margins", "reduced-font"]
  fitsOnOnePage: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Render Engine types
// ═══════════════════════════════════════════════════════════════════════════

export interface RenderEngineResult {
  canonicalResume: CanonicalResume;
  renderTree: RenderNode[];
  layout: LayoutResult;
  theme: ResumeTheme;
  warnings: string[];
}
