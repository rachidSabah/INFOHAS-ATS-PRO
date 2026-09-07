// Auto Shrink to Fit (1 Page) — preview shrink zoom computation tests.
//
// Contract under test (src/lib/preview-shrink.ts):
//  1. Untouched directive (no bodyFontSizePt / seed value / invalid) → zoom
//     exactly 1 → A4Preview renders NO zoom wrapper (zero visual change).
//  2. User-shrunk bodyFontSizePt → zoom = value / template-designed body pt,
//     so the preview's effective body font equals the exported document's
//     body font (export honors the same knob via applyUserLayoutOverrides).
//  3. Aliased templates (corporate/europass/minimal → ATS design,
//     creative → Modern design) resolve to their shared component's design.
//  4. Pathological directive values are clamped to a sane envelope.

import { describe, it, expect } from "vitest";
import { computeShrinkZoom, designedBodyPtFor, DESIGNED_BODY_PT_DEFAULT } from "./preview-shrink";
import { SEED_OPTIMIZER_DIRECTIVE } from "./mock-data";

describe("computeShrinkZoom — untouched directive", () => {
  it("returns exactly 1 when the directive is absent", () => {
    expect(computeShrinkZoom(null, "ats-professional")).toBe(1);
    expect(computeShrinkZoom(undefined, "modern")).toBe(1);
  });

  it("returns exactly 1 when bodyFontSizePt equals the seed default", () => {
    expect(computeShrinkZoom({ bodyFontSizePt: SEED_OPTIMIZER_DIRECTIVE.bodyFontSizePt }, "ats-professional")).toBe(1);
    expect(computeShrinkZoom({ bodyFontSizePt: SEED_OPTIMIZER_DIRECTIVE.bodyFontSizePt }, "executive")).toBe(1);
  });

  it("returns exactly 1 for non-finite or non-positive values", () => {
    expect(computeShrinkZoom({ bodyFontSizePt: NaN }, "tech")).toBe(1);
    expect(computeShrinkZoom({ bodyFontSizePt: 0 }, "tech")).toBe(1);
    expect(computeShrinkZoom({ bodyFontSizePt: -4 }, "tech")).toBe(1);
  });
});

describe("computeShrinkZoom — user-shrunk directive", () => {
  it("scales relative to the template's designed body size", () => {
    // ATS professional preview is designed at 10pt root body.
    expect(computeShrinkZoom({ bodyFontSizePt: 9 }, "ats-professional")).toBeCloseTo(0.9, 10);
    // Executive preview is designed at 10.5pt root body.
    expect(computeShrinkZoom({ bodyFontSizePt: 9 }, "executive")).toBeCloseTo(9 / 10.5, 10);
    // Compact preview is designed at 9.5pt root body.
    expect(computeShrinkZoom({ bodyFontSizePt: 8 }, "compact")).toBeCloseTo(8 / 9.5, 10);
  });

  it("yields zoom 1 when the user picks a size equal to the design even if it differs from the seed", () => {
    // 10pt differs from the 10.5pt seed but matches the ATS design exactly.
    expect(computeShrinkZoom({ bodyFontSizePt: 10 }, "ats-professional")).toBe(1);
  });

  it("enlarges the preview proportionally when the user raises the font", () => {
    expect(computeShrinkZoom({ bodyFontSizePt: 12 }, "ats-professional")).toBeCloseTo(1.2, 10);
  });
});

describe("computeShrinkZoom — template aliases and unknowns", () => {
  it("resolves aliased templates to their shared component's design size", () => {
    expect(designedBodyPtFor("corporate")).toBe(designedBodyPtFor("ats-professional"));
    expect(designedBodyPtFor("europass")).toBe(designedBodyPtFor("ats-professional"));
    expect(designedBodyPtFor("minimal")).toBe(designedBodyPtFor("ats-professional"));
    expect(designedBodyPtFor("creative")).toBe(designedBodyPtFor("modern"));
  });

  it("falls back to the default design for unknown templates", () => {
    expect(designedBodyPtFor("does-not-exist")).toBe(DESIGNED_BODY_PT_DEFAULT);
    expect(computeShrinkZoom({ bodyFontSizePt: 9 }, "does-not-exist")).toBeCloseTo(0.9, 10);
  });
});

describe("computeShrinkZoom — clamping", () => {
  it("clamps extreme enlarge values to 1.6", () => {
    expect(computeShrinkZoom({ bodyFontSizePt: 40 }, "ats-professional")).toBe(1.6);
  });

  it("clamps extreme shrink values to 0.55", () => {
    expect(computeShrinkZoom({ bodyFontSizePt: 1 }, "ats-professional")).toBe(0.55);
  });
});
