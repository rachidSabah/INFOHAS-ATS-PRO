// Auto Shrink to Fit (1 Page) — preview-side shrink computation.
//
// WHY THIS EXISTS
// The Builder's "Auto Shrink to Fit (1 Page)" button incrementally lowers
// the optimizer directive's bodyFontSizePt. The PDF/DOCX exporters honor
// that knob via applyUserLayoutOverrides (user-changed value beats the
// template hardcode). But 9 of the 10 Builder preview templates
// (ats-professional, executive, modern, … — everything except infohas-pro)
// render hardcoded Tailwind pt classes and never read the directive, so the
// preview never changed and the button appeared dead.
//
// HOW IT WORKS
// Instead of threading the directive into ~80 text nodes across 9 templates
// (high regression risk), the preview translates the directive's font knob
// into a uniform CSS zoom on the page content. zoom scales fonts, line
// boxes, paddings, margins, and section gaps proportionally — exactly the
// "scales fonts, line height, margins, and gaps incrementally" contract of
// the button. The wrapper width is compensated (100 / zoom %) so text
// reflows at the same effective measure as the unscaled layout, keeping the
// line-wrapping visually identical to the exported document.
//
// CONSISTENCY WITH EXPORT
// Export body text = directive bodyFontSizePt (when the user changed it
// away from the seed). Preview effective body font = designed body pt ×
// zoom = directive bodyFontSizePt. Same number — preview and downloaded
// document agree on the body size. Name/section-title sizes keep their
// template design in the export while the preview scales them with the
// same factor; that divergence is deliberate (preserves hierarchy) and
// only exists while a shrink is actively applied.
//
// ZERO-REGRESSION GUARANTEE
// When the directive is untouched (bodyFontSizePt absent or equal to the
// seed), the zoom is exactly 1 and A4Preview renders NO wrapper style at
// all — pixel-identical to the pre-feature output.

import { SEED_OPTIMIZER_DIRECTIVE } from "./mock-data";

/**
 * Root body font size (pt) each Builder preview template is DESIGNED at.
 * Derived from each template's root `text-[Xpt]` class in A4Preview.tsx.
 * Aliases that share another template's component (corporate/europass/minimal
 * → ATSProfessionalTemplate, creative → ModernTemplate) inherit that
 * component's design size.
 */
const DESIGNED_BODY_PT: Record<string, number> = {
  "ats-professional": 10,
  corporate: 10,
  europass: 10,
  minimal: 10,
  executive: 10.5,
  modern: 10,
  creative: 10,
  compact: 9.5,
  tech: 10,
  academic: 10.5,
  consulting: 10,
  startup: 10,
  classic: 10.5,
};

/** Fallback for templates not in the map (and future additions). */
export const DESIGNED_BODY_PT_DEFAULT = 10;

export function designedBodyPtFor(template: string): number {
  return DESIGNED_BODY_PT[template] ?? DESIGNED_BODY_PT_DEFAULT;
}

/**
 * Compute the preview shrink zoom for a template given the optimizer
 * directive. Returns exactly 1 when the directive is untouched (no
 * bodyFontSizePt, non-finite, or equal to the seed value) so callers can
 * skip rendering the zoom wrapper entirely.
 *
 * Templates that natively consume the directive (infohas-pro, and the
 * RenderDocument SSOT pipeline) must NOT apply this zoom — the caller gates
 * on those cases.
 */
export function computeShrinkZoom(
  config: { bodyFontSizePt?: number } | null | undefined,
  template: string
): number {
  const designed = designedBodyPtFor(template);
  const v = config?.bodyFontSizePt;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 1;
  if (v === SEED_OPTIMIZER_DIRECTIVE.bodyFontSizePt) return 1;
  const zoom = v / designed;
  // Clamp to a sane envelope: 0.55 keeps text marginally legible in print,
  // 1.6 prevents an accidental directive value from blowing up the page.
  return Math.min(1.6, Math.max(0.55, zoom));
}
