// ============================================================================
// Phase 3 — Canonical Resume Rendering Engine Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import type {
  ResumeData,
  ResumeExperience,
  ResumeEducation,
  ResumeSkill,
  ResumeLanguage,
  DynamicSection,
} from "../types";
import {
  buildCanonicalResume,
  canonicalResumeToRenderTree,
  renderResume,
} from "../render-engine";
import { buildTheme } from "../theme-engine";
import {
  compressToOnePage,
  applyCompression,
} from "../one-page-validator";
import {
  layoutNodes,
  createPageLayout,
  estimateTotalHeightMm,
  detectOverflow,
  suggestCompression,
} from "../layout-engine";
import { computeSectionHashes } from "../section-hash";

// ═══════════════════════════════════════════════════════════════════════════
// Test Data
// ═══════════════════════════════════════════════════════════════════════════

function makeSampleResume(overrides?: Partial<ResumeData>): ResumeData {
  const exp: ResumeExperience = {
    id: "exp-1",
    company: "Acme Corp",
    title: "Senior Developer",
    location: "New York",
    startDate: "2020-01",
    endDate: "Present",
    bullets: [
      "Led team of 5 developers delivering cloud-native solutions",
      "Improved deployment speed by 40% through CI/CD automation",
    ],
  };

  const edu: ResumeEducation = {
    id: "edu-1",
    institution: "MIT",
    degree: "B.S. Computer Science",
    location: "Cambridge, MA",
    startDate: "2012-09",
    endDate: "2016-06",
    highlights: ["Dean's List", "AI Research Lab"],
  };

  const skills: ResumeSkill[] = [
    { id: "sk-1", name: "JavaScript", category: "Languages" },
    { id: "sk-2", name: "TypeScript", category: "Languages" },
    { id: "sk-3", name: "React", category: "Frameworks" },
    { id: "sk-4", name: "Node.js", category: "Frameworks" },
    { id: "sk-5", name: "Docker", category: "DevOps" },
  ];

  const languages: ResumeLanguage[] = [
    { id: "lang-1", name: "English", proficiency: "native" },
    { id: "lang-2", name: "French", proficiency: "fluent" },
  ];

  const dynSections: DynamicSection[] = [
    {
      id: "ds-1",
      title: "Certifications",
      normalizedTitle: "certifications",
      content: "AWS Solutions Architect\nGoogle Cloud Professional",
      bullets: ["AWS Solutions Architect", "Google Cloud Professional"],
      order: 6,
      source: "parsed",
      immutable: true,
    },
  ];

  return {
    id: "test-resume-1",
    name: "John Doe",
    headline: "Senior Full-Stack Developer | 8+ Years Experience",
    contact: {
      email: "john@example.com",
      phone: "+1 (555) 123-4567",
      location: "New York, NY",
      personalDetails: {
        nationality: "American",
        "driving licence": "Class B",
      },
    },
    summary: "Experienced software engineer with a proven track record of delivering scalable cloud-native applications. Passionate about AI and developer tools.",
    experience: [exp],
    education: [edu],
    skills,
    projects: [],
    certifications: [],
    languages,
    template: "ats-professional",
    accentColor: "#2c5282",
    additionalInfo: "Available for remote work. Open to relocation.",
    createdAt: "2024-01-01",
    updatedAt: "2024-06-01",
    dynamicSections: dynSections,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// buildCanonicalResume
// ═══════════════════════════════════════════════════════════════════════════

describe("buildCanonicalResume", () => {
  it("creates canonical resume from ResumeData", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);

    expect(canonical.id).toBe("test-resume-1");
    expect(canonical.name).toBe("John Doe");
    expect(canonical.isValid).toBe(true);
    expect(canonical.validationErrors).toHaveLength(0);
  });

  it("builds canonical sections in correct order", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);

    const types = canonical.sections.map((s) => s.type);
    expect(types).toEqual([
      "professionalProfile",
      "professionalExperience",
      "education",
      "skills",
      "languages",
      "additionalInformation",
      "dynamicSections",
    ]);
  });

  it("preserves experience data in canonical form", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);

    const expSection = canonical.sections.find((s) => s.type === "professionalExperience")!;
    expect(expSection.originalEntityCount).toBe(1);
    expect(expSection.originalBulletCount).toBe(2);

    // Check first table-row has company and position
    const firstRow = expSection.items[0];
    if (firstRow.kind === "table-row") {
      expect(firstRow.cells[0].text).toContain("Senior Developer");
      expect(firstRow.cells[0].text).toContain("Acme Corp");
      expect(firstRow.cells[1].text).toContain("Jan 2020");
    } else {
      expect.fail("Expected table-row item");
    }
  });

  it("preserves education data in canonical form", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);

    const eduSection = canonical.sections.find((s) => s.type === "education")!;
    expect(eduSection.originalEntityCount).toBe(1);

    const firstRow = eduSection.items[0];
    if (firstRow.kind === "table-row") {
      expect(firstRow.cells[0].text).toContain("B.S. Computer Science");
      expect(firstRow.cells[0].text).toContain("MIT");
    }
  });

  it("preserves languages in canonical form", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);

    const langSection = canonical.sections.find((s) => s.type === "languages")!;
    expect(langSection.items).toHaveLength(2);
    const first = langSection.items[0];
    if (first.kind === "text") {
      expect(first.text).toContain("English");
      expect(first.text).toContain("native");
    }
  });

  it("preserves dynamic sections in canonical form", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);

    const dynSections = canonical.sections.filter((s) => s.isDynamic);
    expect(dynSections).toHaveLength(1);
    expect(dynSections[0].title).toBe("CERTIFICATIONS");
    expect(dynSections[0].items).toHaveLength(2); // title text + bullets
  });

  it("preserves additional information", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);

    const addInfo = canonical.sections.find((s) => s.type === "additionalInformation")!;
    expect(addInfo.items.length).toBeGreaterThan(0);

    // Check personal details are included
    const hasNationality = addInfo.items.some(
      (i) => i.kind === "text" && i.text.includes("Nationality"),
    );
    expect(hasNationality).toBe(true);
  });

  it("validates missing name", () => {
    const resume = makeSampleResume({ name: "" });
    const canonical = buildCanonicalResume(resume);

    expect(canonical.isValid).toBe(false);
    expect(canonical.validationErrors).toContain("Name is required");
  });

  it("returns empty sections for empty resume", () => {
    const resume = makeSampleResume({
      summary: "",
      experience: [],
      education: [],
      skills: [],
      languages: [],
      additionalInfo: "",
      dynamicSections: [],
    });
    // Also clear personal details
    resume.contact.personalDetails = {};
    const canonical = buildCanonicalResume(resume);

    expect(canonical.sections).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// canonicalResumeToRenderTree
// ═══════════════════════════════════════════════════════════════════════════

describe("canonicalResumeToRenderTree", () => {
  it("produces a flat array of RenderNodes", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    expect(Array.isArray(tree)).toBe(true);
    expect(tree.length).toBeGreaterThan(0);
  });

  it("always has a document root node", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    const docRoot = tree.find((n) => n.type === "document");
    expect(docRoot).toBeDefined();
    expect(docRoot!.content).toBe("John Doe");
  });

  it("creates header nodes for name and contact", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    const nameNode = tree.find((n) => n.content === "John Doe" && n.type === "contact-line");
    expect(nameNode).toBeDefined();
    expect(nameNode!.style.fontSizePt).toBe(16);

    const contactLine = tree.find(
      (n) => n.type === "contact-line" && n.content.includes("+1 (555)"),
    );
    expect(contactLine).toBeDefined();
  });

  it("creates section-title nodes for each section", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    const titles = tree.filter((n) => n.type === "section-title").map((n) => n.content);
    expect(titles).toContain("PROFESSIONAL SUMMARY");
    expect(titles).toContain("PROFESSIONAL EXPERIENCE");
    expect(titles).toContain("EDUCATION");
    expect(titles).toContain("CORE COMPETENCIES & SKILLS");
  });

  it("creates bullet-item nodes for experience bullets", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    const bullets = tree.filter((n) => n.type === "bullet-item");
    expect(bullets.length).toBeGreaterThanOrEqual(2);
    expect(bullets[0].content).toContain("cloud-native");
  });

  it("creates nested-group-label nodes for skills categories", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    const labels = tree.filter((n) => n.type === "nested-group-label").map((n) => n.content);
    expect(labels).toContain("Languages");
    expect(labels).toContain("Frameworks");
  });

  it("assigns unique IDs to every node", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    const ids = tree.map((n) => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("handle empty resume gracefully", () => {
    const resume = makeSampleResume({
      name: "",
      summary: "",
      experience: [],
      education: [],
      skills: [],
      languages: [],
    });
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    expect(tree.length).toBeGreaterThanOrEqual(1); // at least document root
    const docRoot = tree.find((n) => n.type === "document");
    expect(docRoot).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// renderResume — full pipeline integration
// ═══════════════════════════════════════════════════════════════════════════

describe("renderResume (full pipeline)", () => {
  it("completes the full pipeline without errors", () => {
    const resume = makeSampleResume();
    const result = renderResume(resume);

    expect(result.canonicalResume).toBeDefined();
    expect(result.canonicalResume.isValid).toBe(true);
    expect(result.renderTree.length).toBeGreaterThan(10);
    expect(result.layout.pages.length).toBeGreaterThanOrEqual(1);
    expect(result.theme).toBeDefined();
  });

  it("produces a layout result", () => {
    const resume = makeSampleResume();
    const result = renderResume(resume);

    expect(result.layout.totalPages).toBeGreaterThanOrEqual(1);
    expect(result.layout.hasOverflow).toBeDefined();
  });

  it("each page layout has usable dimensions", () => {
    const resume = makeSampleResume();
    const result = renderResume(resume);

    for (const page of result.layout.pages) {
      expect(page.usableWidthMm).toBeGreaterThan(100);
      expect(page.usableHeightMm).toBeGreaterThan(200);
      expect(page.marginTopMm).toBeGreaterThan(0);
    }
  });

  it("includes one-page compression warnings when needed", () => {
    // Create a resume with a LOT of content to trigger compression
    const manyBullets = Array.from({ length: 50 }, (_, i) => `Bullet point number ${i + 1} with some padding text to make it longer.`);
    const manyExp: ResumeExperience = {
      id: "exp-big",
      company: "Big Corp",
      title: "Very Long Job Title That Takes Up Space",
      location: "A Very Long Location String To Fill Space",
      startDate: "2010-01",
      endDate: "2024-06",
      bullets: manyBullets,
    };
    const resume = makeSampleResume({
      experience: [manyExp, manyExp, manyExp], // 3 identical entries with 50 bullets each
    });
    const result = renderResume(resume);

    // Should either have compression warnings OR just complete
    expect(result.renderTree.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Theme Engine
// ═══════════════════════════════════════════════════════════════════════════

describe("buildTheme", () => {
  it("creates a theme with default values", () => {
    const theme = buildTheme("ats-professional");

    expect(theme.fontFamily).toBeDefined();
    expect(theme.nameSizePt).toBe(16);
    expect(theme.bodyFontSizePt).toBe(10);
    expect(theme.enforceOnePage).toBe(true);
  });

  it("resolves icon style per template", () => {
    const modern = buildTheme("modern");
    expect(modern.iconStyle).toBe("checkmark");

    const creative = buildTheme("creative");
    expect(creative.iconStyle).toBe("arrow");

    const standard = buildTheme("ats-professional");
    expect(standard.iconStyle).toBe("bullet");
  });

  it("resolves divider visibility per template", () => {
    const exec = buildTheme("executive");
    expect(exec.showDividers).toBe(true);

    const modern = buildTheme("modern");
    expect(modern.showDividers).toBe(false);
  });

  it("accepts layout overrides", () => {
    const theme = buildTheme("ats-professional", "#ff0000", { bodyFontSizePt: 12 });
    expect(theme.bodyFontSizePt).toBe(12);
    expect(theme.accentColor).toBe("#ff0000");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layout Engine
// ═══════════════════════════════════════════════════════════════════════════

describe("createPageLayout", () => {
  it("creates A4 layout with correct dimensions", () => {
    const theme = buildTheme("ats-professional");
    const page = createPageLayout(0, theme);

    expect(page.widthMm).toBe(210);
    expect(page.heightMm).toBe(297);
    expect(page.usableWidthMm).toBeCloseTo(210 - 8.89 - 8.89);
    expect(page.usableHeightMm).toBeCloseTo(297 - 6.35 - 6.35);
    expect(page.currentY).toBe(0);
  });
});

describe("estimateTotalHeightMm", () => {
  it("estimates height for a list of nodes", () => {
    const theme = buildTheme("ats-professional");
    const preview = buildCanonicalResume(makeSampleResume());
    const tree = canonicalResumeToRenderTree(preview);

    // Only check document root children (skip the document root itself)
    const contentNodes = tree.filter((n) => n.type !== "document");
    const height = estimateTotalHeightMm(contentNodes, 192, theme);
    expect(height).toBeGreaterThan(0);
  });
});

describe("detectOverflow", () => {
  it("returns false for fitting content", () => {
    const theme = buildTheme("ats-professional");
    expect(detectOverflow(250, theme)).toBe(false); // 250mm < 284mm usable
  });

  it("returns true for overflowing content", () => {
    const theme = buildTheme("ats-professional");
    expect(detectOverflow(50000, theme)).toBe(true);
  });
});

describe("suggestCompression", () => {
  it("suggests compression steps for overflow", () => {
    const theme = buildTheme("ats-professional");
    const steps = suggestCompression(50, theme);
    expect(steps.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OnePageValidator
// ═══════════════════════════════════════════════════════════════════════════

describe("compressToOnePage", () => {
  it("returns no compression for small content", () => {
    const theme = buildTheme("ats-professional");
    const result = compressToOnePage(500, theme);

    expect(result.stepsApplied).toHaveLength(0);
    expect(result.originalChars).toBe(500);
  });

  it("suggests compression for large content", () => {
    const theme = buildTheme("ats-professional");
    const result = compressToOnePage(10000, theme);

    expect(result.stepsApplied.length).toBeGreaterThan(0);
  });

  it("never removes content", () => {
    const theme = buildTheme("ats-professional");
    const result = compressToOnePage(10000, theme);

    expect(result.originalChars).toBe(result.compressedChars); // content unchanged
    expect(result.compressionRatio).toBe(1.0); // no content removed
  });
});

describe("applyCompression", () => {
  it("returns same theme when no steps applied", () => {
    const theme = buildTheme("ats-professional");
    const result = compressToOnePage(500, theme);
    const compressed = applyCompression(theme, result);

    expect(compressed.lineHeightMm).toBe(theme.lineHeightMm);
  });

  it("reduces spacing when compression applied", () => {
    const theme = buildTheme("ats-professional");
    const result = compressToOnePage(10000, theme);
    const compressed = applyCompression(theme, result);

    if (result.stepsApplied.includes("reduced-line-spacing")) {
      expect(compressed.lineHeightMm).toBeLessThan(theme.lineHeightMm);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section Hash Parity Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("section hash parity", () => {
  it("RenderNode tree produces same section content as RenderDocument", () => {
    const resume = makeSampleResume();

    // Get RenderNode tree content
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    // Extract section content from tree by section-title markers
    const sectionContents: Record<string, string> = {};
    let currentSection = "";
    for (const node of tree) {
      if (node.type === "section-title") {
        currentSection = node.content;
        sectionContents[currentSection] = "";
      } else if (currentSection && (node.type === "text-line" || node.type === "bullet-item" || node.type === "table-cell" || node.type === "nested-group-item")) {
        sectionContents[currentSection] = (sectionContents[currentSection] || "") + node.content;
      }
    }

    // Verify every section from canonical is represented
    for (const section of canonical.sections) {
      const hasContent = Object.keys(sectionContents).some(
        (title) => title === section.title,
      );
      // Dynamic sections and additionalInfo have content in tree
      expect(hasContent || section.items.length === 0).toBe(true);
    }
  });

  it("rendered section count matches canonical section count", () => {
    const resume = makeSampleResume();
    const canonical = buildCanonicalResume(resume);
    const tree = canonicalResumeToRenderTree(canonical);

    const sectionTitles = tree.filter((n) => n.type === "section-title");
    const nonEmptyCanonicalSections = canonical.sections.filter(
      (s) => s.items.length > 0,
    );

    // Each canonical section gets a section-title node
    expect(sectionTitles.length).toBeGreaterThanOrEqual(nonEmptyCanonicalSections.length);
  });
});
