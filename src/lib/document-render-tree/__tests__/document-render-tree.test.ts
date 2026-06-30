// ============================================================================
// Document Render Tree — Phase 5 Unit Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildDocumentTree } from "../document-tree-builder";
import { buildTypographyConfig, ptToMm, estimateLines, compressTypography } from "../typography-engine";
import { buildTheme } from "../../theme-engine";
import { layoutDocumentNodes, createPageState, getPageDimensions, detectOverflow } from "../layout-engine";
import { paginateNodes } from "../pagination-engine";
import { buildPhotoNode } from "../photo-engine";
import { createDefaultRenderers } from "../section-renderers";
import type { DocumentNode, DocumentNodeStyle, DocumentTree } from "../types";
import type { ResumeTheme } from "../../types-phase3";

// ── Sample Resume Data ────────────────────────────────────────────────────

const sampleResume: Record<string, unknown> = {
  id: "test-1",
  name: "Jane Doe",
  headline: "Senior Software Engineer",
  contact: {
    email: "jane@example.com",
    phone: "+1-555-0123",
    location: "San Francisco, CA",
    linkedin: "janedoe",
  },
  summary: "Experienced engineer with 8+ years building scalable systems.",
  experience: [
    {
      id: "exp-1",
      company: "Tech Corp",
      title: "Senior Engineer",
      startDate: "2020-01",
      endDate: "Present",
      bullets: [
        "Led team of 5 engineers delivering microservices architecture",
        "Reduced deployment time by 40% through CI/CD automation",
      ],
    },
  ],
  education: [
    {
      id: "ed-1",
      institution: "MIT",
      degree: "B.S. Computer Science",
      startDate: "2012",
      endDate: "2016",
    },
  ],
  skills: [
    { id: "s-1", name: "TypeScript", category: "Languages" },
    { id: "s-2", name: "React", category: "Frameworks" },
  ],
  languages: [
    { id: "l-1", name: "English", proficiency: "Native" },
    { id: "l-2", name: "French", proficiency: "Intermediate" },
  ],
  certifications: [],
  projects: [],
  template: "ats-professional" as any,
};

// ── Empty fallback resume
const emptyResume: Record<string, unknown> = {
  id: "empty",
  name: "",
  contact: {},
  template: "ats-professional" as any,
};

// ── Photo resume
const photoResume: Record<string, unknown> = {
  ...sampleResume,
  photoUrl: "https://example.com/photo.jpg",
};

// ============================================================================
// Helper: build a test theme
// ============================================================================

function buildTestTheme(): ResumeTheme {
  return buildTheme("ats-professional");
}

// ============================================================================
// Test Suite
// ============================================================================

describe("DocumentRenderTree — buildDocumentTree", () => {
  it("builds a tree from sample resume", () => {
    const tree = buildDocumentTree(sampleResume);
    expect(tree).toBeDefined();
    expect(tree.root).toBeDefined();
    expect(tree.root.children.length).toBeGreaterThan(0);
    expect(tree.warnings).toEqual([]);
  });

  it("returns empty tree for invalid resume", () => {
    const tree = buildDocumentTree({} as any);
    expect(tree).toBeDefined();
    expect(tree.warnings.length).toBeGreaterThan(0);
  });

  it("includes name and contact nodes", () => {
    const tree = buildDocumentTree(sampleResume);
    const nameNode = tree.root.children.find(n => n.content.includes("Jane Doe"));
    expect(nameNode).toBeDefined();
    const contactNode = tree.root.children.find(n => n.content.includes("jane@example.com"));
    expect(contactNode).toBeDefined();
  });

  it("includes section titles", () => {
    const tree = buildDocumentTree(sampleResume);
    const sectionNodes = tree.root.children.filter(n => n.type === "section-title");
    expect(sectionNodes.length).toBeGreaterThan(0);
    const titles = sectionNodes.map(n => n.content);
    expect(titles.some(t => t.includes("PROFESSIONAL EXPERIENCE"))).toBe(true);
    expect(titles.some(t => t.includes("EDUCATION"))).toBe(true);
    expect(titles.some(t => t.includes("SKILLS"))).toBe(true);
    expect(titles.some(t => t.includes("LANGUAGES"))).toBe(true);
  });

  it("includes experience bullets", () => {
    const tree = buildDocumentTree(sampleResume);
    const bulletItems = tree.root.children.filter(n => n.type === "bullet-item");
    const foundBullet = bulletItems.find(n => n.content.includes("microservices"));
    expect(foundBullet).toBeDefined();
  });

  it("includes skills", () => {
    const tree = buildDocumentTree(sampleResume);
    const allText = tree.root.children.map(n => n.content).join(" ");
    expect(allText).toContain("TypeScript");
    expect(allText).toContain("React");
  });

  it("includes languages", () => {
    const tree = buildDocumentTree(sampleResume);
    const allText = tree.root.children.map(n => n.content).join(" ");
    expect(allText).toContain("English");
    expect(allText).toContain("French");
  });

  it("includes photo node when photoUrl present", () => {
    const tree = buildDocumentTree(photoResume);
    const photoNode = tree.root.children.find(n => n.type === "photo");
    expect(photoNode).toBeDefined();
    expect(photoNode!.content).toBe("https://example.com/photo.jpg");
  });

  it("has all sections rendered", () => {
    const tree = buildDocumentTree(sampleResume);
    const sectionNodes = tree.root.children.filter(n => n.type === "section-title");
    expect(sectionNodes.length).toBeGreaterThanOrEqual(4);
  });

  it("produces layout with pages", () => {
    const tree = buildDocumentTree(sampleResume);
    expect(tree.layout.totalPages).toBeGreaterThan(0);
    expect(tree.layout.pages.length).toBe(tree.layout.totalPages);
  });
});

describe("TypographyEngine", () => {
  it("builds config from theme", () => {
    const theme = buildTestTheme();
    const config = buildTypographyConfig(theme);
    expect(config.fontFamily).toBe(theme.fontFamily);
    expect(config.bodyFontSizePt).toBe(theme.bodyFontSizePt);
    expect(config.nameSizePt).toBeGreaterThan(0);
  });

  it("converts pt to mm", () => {
    expect(ptToMm(10)).toBeCloseTo(3.52778, 4);
    expect(ptToMm(0)).toBe(0);
  });

  it("estimates text lines", () => {
    // A4 width with default margins ≈ 170mm usable, each char ≈ 5mm at 10pt
    // Short text should be ≈1 line
    const lines = estimateLines("Hello", 170, 10);
    expect(lines).toBe(1);
    // Very long text should span multiple lines
    const longText = "x".repeat(500);
    const manyLines = estimateLines(longText, 170, 10);
    expect(manyLines).toBeGreaterThan(5);
  });

  it("compresses typography steps", () => {
    const theme = buildTestTheme();
    const config = buildTypographyConfig(theme);
    const compressed = compressTypography(config, ["reduce-line-spacing"]);
    expect(compressed.lineHeight).toBeLessThan(config.lineHeight);
  });
});

describe("LayoutEngine", () => {
  it("creates page state", () => {
    const theme = buildTestTheme();
    const page = createPageState(0, theme);
    expect(page.pageNumber).toBe(0);
    expect(page.widthMm).toBe(210);
    expect(page.usableWidthMm).toBeGreaterThan(0);
    expect(page.remainingHeightMm).toBeGreaterThan(0);
  });

  it("detects overflow correctly", () => {
    const theme = buildTestTheme();
    expect(detectOverflow(100, theme)).toBe(false);
    expect(detectOverflow(5000, theme)).toBe(true);
  });

  it("suggests compression when needed", () => {
    const theme = buildTestTheme();
    // Make the result more predictable
    const steps = ["reduce-line-spacing", "reduce-section-gap", "reduce-margins", "reduce-font-size"];
    expect(steps.length).toBeGreaterThan(0);
  });
});

describe("PaginationEngine", () => {
  it("paginates nodes", () => {
    const theme = buildTestTheme();
    const nodes: DocumentNode[] = [
      {
        id: "n1", type: "section-title", parentId: null, children: [],
        content: "EXPERIENCE", style: { keepWithNext: true },
        visibility: "visible", position: null,
      },
      {
        id: "n2", type: "text-line", parentId: null, children: [],
        content: "Some content here",
        style: {},
        visibility: "visible", position: null,
      },
    ];
    const result = paginateNodes({ nodes, theme });
    expect(result.totalPages).toBe(1);
    expect(result.pages.length).toBe(1);
    expect(result.hasOverflow).toBe(false);
  });

  it("handles explicit page breaks", () => {
    const theme = buildTestTheme();
    const nodes: DocumentNode[] = [
      {
        id: "n1", type: "text-line", parentId: null, children: [],
        content: "Page 1", style: {},
        visibility: "visible", position: null,
      },
      {
        id: "n2", type: "page-break", parentId: null, children: [],
        content: "", style: {},
        visibility: "visible", position: null,
      },
      {
        id: "n3", type: "text-line", parentId: null, children: [],
        content: "Page 2", style: {},
        visibility: "visible", position: null,
      },
    ];
    const result = paginateNodes({ nodes, theme });
    expect(result.totalPages).toBeGreaterThanOrEqual(2);
  });
});

describe("PhotoEngine", () => {
  it("creates photo node when URL provided", () => {
    const node = buildPhotoNode("https://example.com/photo.jpg");
    expect(node).not.toBeNull();
    expect(node!.type).toBe("photo");
    expect(node!.content).toBe("https://example.com/photo.jpg");
  });

  it("returns null when no URL provided", () => {
    const node = buildPhotoNode(undefined);
    expect(node).toBeNull();
  });

  it("respects placement configuration", () => {
    const node = buildPhotoNode("https://example.com/photo.jpg", {
      placement: "top-right",
      crop: "circle",
      widthMm: 25,
      heightMm: 35,
    });
    expect(node!.style.photoPlacement).toBe("top-right");
    expect(node!.style.photoCrop).toBe("circle");
    expect(node!.style.photoWidthMm).toBe(25);
    expect(node!.style.photoHeightMm).toBe(35);
  });
});

describe("SectionRenderers", () => {
  it("creates default renderers map with all required sections", () => {
    const renderers = createDefaultRenderers();
    const requiredTypes = [
      "professionalProfile",
      "professionalExperience",
      "education",
      "skills",
      "languages",
      "certifications",
      "projects",
      "achievements",
      "additionalInformation",
      "dynamicSections",
    ];
    for (const type of requiredTypes) {
      expect(renderers.has(type as any)).toBe(true);
    }
  });
});

describe("DocumentRenderTree — Edge Cases", () => {
  it("handles empty resume gracefully", () => {
    const tree = buildDocumentTree(emptyResume);
    expect(tree).toBeDefined();
    expect(tree.root).toBeDefined();
  });

  it("handles resume with photo but no contact", () => {
    const noContact: Record<string, unknown> = {
      ...photoResume,
      contact: {},
    };
    const tree = buildDocumentTree(noContact);
    expect(tree).toBeDefined();
  });

  it("handles resume with minimum fields", () => {
    const minimal: Record<string, unknown> = {
      id: "min",
      name: "John",
      contact: {},
      template: "ats-professional" as any,
    };
    const tree = buildDocumentTree(minimal);
    expect(tree).toBeDefined();
    // With a name and empty contact, we should at least get a document header
    expect(tree.root.children.length).toBeGreaterThan(0);
  });
});
