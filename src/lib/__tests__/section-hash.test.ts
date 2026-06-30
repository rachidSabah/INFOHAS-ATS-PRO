// ============================================================================
// Section Hash — Unit Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import type { RenderDocument, RenderContentItem } from "../types";
import {
  computeSectionHash,
  computeSectionHashes,
  compareSectionHashes,
  serializeContentItem,
} from "../section-hash";

// ═══════════════════════════════════════════════════════════════════════════
// serializeContentItem
// ═══════════════════════════════════════════════════════════════════════════
describe("serializeContentItem", () => {
  it("serializes text items", () => {
    const item: RenderContentItem = { kind: "text", text: "Hello World" };
    expect(serializeContentItem(item)).toBe("Hello World");
  });

  it("serializes text items with bold flag", () => {
    const item: RenderContentItem = { kind: "text", text: "Bold text", bold: true };
    expect(serializeContentItem(item)).toBe("Bold text");
  });

  it("serializes bullet items", () => {
    const item: RenderContentItem = {
      kind: "bullets",
      bullets: ["Bullet 1", "Bullet 2"],
      level: 0,
    };
    expect(serializeContentItem(item)).toBe("Bullet 1\nBullet 2");
  });

  it("serializes table-row items", () => {
    const item: RenderContentItem = {
      kind: "table-row",
      cells: [
        { text: "Left", bold: true, align: "left" },
        { text: "Right", bold: false, align: "right" },
      ],
    };
    expect(serializeContentItem(item)).toBe("Left Right");
  });

  it("serializes nested-bullets items", () => {
    const item: RenderContentItem = {
      kind: "nested-bullets",
      groups: [
        { label: "Category 1", items: ["A", "B"] },
        { label: "Category 2", items: ["C"] },
      ],
    };
    expect(serializeContentItem(item)).toBe("Category 1: A, B\nCategory 2: C");
  });

  it("handles unknown item kinds gracefully", () => {
    const item = { kind: "unknown" } as unknown as RenderContentItem;
    expect(serializeContentItem(item)).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeSectionHash
// ═══════════════════════════════════════════════════════════════════════════
describe("computeSectionHash", () => {
  it("produces deterministic hash for same input", () => {
    const h1 = computeSectionHash("Hello World");
    const h2 = computeSectionHash("Hello World");
    expect(h1).toBe(h2);
  });

  it("produces different hash for different input", () => {
    const h1 = computeSectionHash("Hello World");
    const h2 = computeSectionHash("Hello World!");
    expect(h1).not.toBe(h2);
  });

  it("produces different hash for different capitalization", () => {
    const h1 = computeSectionHash("hello world");
    const h2 = computeSectionHash("Hello World");
    expect(h1).not.toBe(h2);
  });

  it("produces same hash for empty string", () => {
    expect(computeSectionHash("")).toBe("00000000");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeSectionHashes
// ═══════════════════════════════════════════════════════════════════════════
function makeRenderDocument(overrides?: Partial<RenderDocument>): RenderDocument {
  return {
    template: "ats-professional",
    layout: {
      pageSize: "A4",
      marginTopMm: 6.35,
      marginBottomMm: 6.35,
      marginLeftMm: 8.89,
      marginRightMm: 8.89,
      fontFamily: "Times New Roman",
      fallbackFontFamily: "Liberation Serif",
      nameSizePt: 14,
      sectionTitleSizePt: 12,
      bodyFontSizePt: 10.5,
      nameColor: "#8B0000",
      sectionTitleColor: "#8B0000",
      bodyTextColor: "#000000",
      contactColor: "#000000",
      lineHeightMm: 3.7,
      sectionGapMm: 3,
      headerGapMm: 1,
      bulletIndentMm: 6.4,
      paragraphSpacingMm: 1.5,
      photoWidthMm: 30,
      photoHeightMm: 40,
      enforceOnePage: true,
      minFontSizePt: 8,
    },
    contact: {
      name: "John Doe",
      headline: "Senior Developer",
      phone: "+1234567890",
      email: "john@example.com",
      location: "New York",
    },
    sections: [
      {
        type: "professionalProfile",
        title: "PROFESSIONAL SUMMARY",
        items: [
          { kind: "text", text: "Experienced developer with 10+ years in full-stack development." },
        ],
      },
      {
        type: "professionalExperience",
        title: "PROFESSIONAL EXPERIENCE",
        items: [
          {
            kind: "table-row",
            cells: [
              { text: "Senior Developer | Acme Corp | New York", bold: true, align: "left" },
              { text: "Jan 2020 – Present", bold: true, align: "right" },
            ],
          },
          {
            kind: "bullets",
            bullets: ["Led team of 5 developers", "Improved deployment speed by 40%"],
            level: 0,
          },
        ],
      },
    ],
    totalChars: 200,
    hasAdditionalInfo: false,
    ...overrides,
  };
}

describe("computeSectionHashes", () => {
  it("computes hashes for all sections", () => {
    const rd = makeRenderDocument();
    const hashes = computeSectionHashes(rd);

    expect(hashes).toHaveLength(2);
    expect(hashes[0].type).toBe("professionalProfile");
    expect(hashes[1].type).toBe("professionalExperience");
  });

  it("includes text from bullets in hash", () => {
    const rd = makeRenderDocument();
    const hashes = computeSectionHashes(rd);

    expect(hashes[0].charCount).toBeGreaterThan(0);
    expect(hashes[1].charCount).toBeGreaterThan(0);
  });

  it("bullet order changes hash", () => {
    const rd1 = makeRenderDocument();
    const rd2 = makeRenderDocument({
      sections: [
        ...rd1.sections.slice(0, 1),
        {
          ...rd1.sections[1],
          items: [
            rd1.sections[1].items[0],
            {
              kind: "bullets",
              bullets: ["Improved deployment speed by 40%", "Led team of 5 developers"],
              level: 0,
            },
          ],
        },
      ],
    });

    const h1 = computeSectionHashes(rd1);
    const h2 = computeSectionHashes(rd2);
    expect(h1[1].hash).not.toBe(h2[1].hash);
  });

  it("different section count produces different hashes", () => {
    const rd1 = makeRenderDocument();
    const rd2 = makeRenderDocument({
      sections: rd1.sections.slice(0, 1),
    });

    const h1 = computeSectionHashes(rd1);
    const h2 = computeSectionHashes(rd2);
    expect(h1).toHaveLength(2);
    expect(h2).toHaveLength(1);
  });

  it("empty sections produce predictable hash", () => {
    const rd = makeRenderDocument({ sections: [] });
    const hashes = computeSectionHashes(rd);
    expect(hashes).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// compareSectionHashes
// ═══════════════════════════════════════════════════════════════════════════
describe("compareSectionHashes", () => {
  it("returns match=true for identical hashes", () => {
    const rd = makeRenderDocument();
    const hashes = computeSectionHashes(rd);
    const result = compareSectionHashes(hashes, [...hashes]);

    expect(result.match).toBe(true);
    expect(result.diffs).toHaveLength(0);
  });

  it("detects section count mismatch", () => {
    const rd = makeRenderDocument();
    const full = computeSectionHashes(rd);
    const partial = full.slice(0, 1);

    const result = compareSectionHashes(full, partial);
    expect(result.match).toBe(false);
    expect(result.diffs.some((d) => d.includes("Section count mismatch"))).toBe(true);
  });

  it("detects content hash mismatch", () => {
    const rd1 = makeRenderDocument();
    const rd2 = makeRenderDocument({
      sections: rd1.sections.map((s) => ({
        ...s,
        items: s.items.map((item) =>
          item.kind === "text" ? { ...item, text: (item as any).text + " (modified)" } : item
        ),
      })),
    });

    const h1 = computeSectionHashes(rd1);
    const h2 = computeSectionHashes(rd2);

    const result = compareSectionHashes(h1, h2);
    expect(result.match).toBe(false);
    expect(result.diffs.some((d) => d.includes("hash mismatch"))).toBe(true);
  });

  it("detects missing sections", () => {
    const rd = makeRenderDocument();
    const full = computeSectionHashes(rd);
    const partial = computeSectionHashes(makeRenderDocument({ sections: rd.sections.slice(0, 1) }));

    const result = compareSectionHashes(full, partial);
    expect(result.match).toBe(false);
    expect(result.diffs.some((d) => d.includes("missing"))).toBe(true);
  });
});
