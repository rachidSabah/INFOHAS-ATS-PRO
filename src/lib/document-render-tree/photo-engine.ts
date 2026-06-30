// ============================================================================
// PhotoEngine — photo cropping, resizing, placement
// ============================================================================
// Handles photo URL resolution, aspect ratio, sizing, and placement.
// No placeholder generated when photo is absent.
// ============================================================================

import type { DocumentNode, DocumentNodeStyle } from "./types";

export interface PhotoConfig {
  url?: string;
  widthMm: number;
  heightMm: number;
  crop: "circle" | "square" | "rounded";
  placement: "top-right" | "top-left" | "inline";
}

/** Default photo dimensions in mm */
export const DEFAULT_PHOTO_WIDTH_MM = 30;
export const DEFAULT_PHOTO_HEIGHT_MM = 40;

/**
 * Build a photo DocumentNode from a photo URL and config.
 * Returns null if no URL is provided (no placeholder).
 */
export function buildPhotoNode(
  url: string | undefined,
  config?: Partial<PhotoConfig>,
  parentId?: string,
): DocumentNode | null {
  if (!url?.trim()) return null;

  const pw = config?.widthMm ?? DEFAULT_PHOTO_WIDTH_MM;
  const ph = config?.heightMm ?? DEFAULT_PHOTO_HEIGHT_MM;
  const placement = config?.placement ?? "top-right";
  const crop = config?.crop ?? "square";

  const style: DocumentNodeStyle = {
    photoPlacement: placement,
    photoCrop: crop,
    photoWidthMm: pw,
    photoHeightMm: ph,
    widthMm: pw,
    heightMm: ph,
    float: placement === "top-right" ? "right" : placement === "top-left" ? "left" : "none",
  };

  return {
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "photo",
    parentId: parentId ?? null,
    children: [],
    content: url,
    style,
    visibility: "visible",
    position: null,
    metadata: { photoUrl: url, crop, placement },
  };
}

/**
 * Calculate photo position on page.
 * Top-right placement: photo positioned at right margin, header top.
 */
export function calculatePhotoPosition(
  photo: DocumentNode,
  pageWidthMm: number,
  marginRightMm: number,
  marginTopMm: number,
): { xMm: number; yMm: number } {
  const pw = photo.style.photoWidthMm ?? DEFAULT_PHOTO_WIDTH_MM;
  const ph = photo.style.photoHeightMm ?? DEFAULT_PHOTO_HEIGHT_MM;

  switch (photo.style.photoPlacement) {
    case "top-right":
      return {
        xMm: pageWidthMm - marginRightMm - pw,
        yMm: marginTopMm + 1, // small top offset
      };
    case "top-left":
      return {
        xMm: marginTopMm, // left margin
        yMm: marginTopMm + 1,
      };
    case "inline":
    default:
      return {
        xMm: marginTopMm,
        yMm: marginTopMm + 1,
      };
  }
}

/**
 * Generate an SVG data URL for a circular/square/rounded photo crop.
 * Falls back to a simple colored placeholder only if explicitly requested.
 */
export function generatePhotoDataUrl(
  url: string,
  crop: "circle" | "square" | "rounded",
  widthMm: number,
  heightMm: number,
): string {
  // For actual document export, the URL should be used directly.
  // This function provides a styled container reference.
  // For DOCX/PDF, the renderer handles crop via the style metadata.
  return url;
}
