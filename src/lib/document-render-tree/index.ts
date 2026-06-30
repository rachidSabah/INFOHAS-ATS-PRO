// ============================================================================
// Document Render Tree — Barrel Exports
// ============================================================================

// Types
export type {
  DocumentNode,
  DocumentNodeStyle,
  DocumentNodePosition,
  DocumentNodeType,
  SectionRenderer,
  SectionRenderData,
  SectionRenderItem,
  DocumentTree,
  LayoutResult,
  Phase5NodeType,
} from "./types";

// Engines
export {
  buildTypographyConfig,
  ptToMm,
  mmToPt,
  estimateLines,
  estimateTextHeightMm,
  compressTypography,
} from "./typography-engine";

export {
  layoutDocumentNodes,
  estimateNodeHeight,
  detectOverflow,
  suggestCompression,
  createPageState,
  getPageDimensions,
  A4_WIDTH_MM,
  A4_HEIGHT_MM,
} from "./layout-engine";

export {
  paginateNodes,
} from "./pagination-engine";

export {
  buildPhotoNode,
  calculatePhotoPosition,
} from "./photo-engine";

// Section Renderers
export {
  createDefaultRenderers,
  resetNodeIdCounter,
} from "./section-renderers";

// Document Tree Builder
export {
  buildDocumentTree,
} from "./document-tree-builder";
