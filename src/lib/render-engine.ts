// ============================================================================
// ResumeRenderEngine — CanonicalResume → RenderNode[]
// ============================================================================
// This is the ONLY place where RenderNode trees are created. Every renderer
// (Preview, DOCX, PDF, HTML, TXT) consumes RenderNode[] as their input.
// No renderer may reconstruct or modify resume content.

import type {
  ResumeData,
  CanonicalResume,
  CanonicalSection,
  CanonicalSectionItem,
  CanonicalSectionType,
  RenderNode,
  RenderNodeStyle,
  ResumeTheme,
  RenderEngineResult,
} from "./types-phase3";
import { buildTheme } from "./theme-engine";
import { layoutNodes, createPageLayout } from "./layout-engine";
import { compressToOnePage, applyCompression } from "./one-page-validator";
import { computeSectionHash } from "./section-hash";

// ── Utility ────────────────────────────────────────────────────────────────

let nodeIdCounter = 0;
function nextNodeId(): string {
  return `rn-${++nodeIdCounter}`;
}

function makeNode(
  type: RenderNode["type"],
  content: string,
  parentId: string | null,
  style: Partial<RenderNodeStyle> = {},
): RenderNode {
  return {
    id: nextNodeId(),
    type,
    parentId,
    children: [],
    content,
    style,
    visibility: "visible",
    position: null,
  };
}

// ── Section Builders ────────────────────────────────────────────────────────

function fmtDate(d?: string): string {
  if (!d) return "";
  if (/present/i.test(d)) return "Present";
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(m[2]) - 1] ?? m[2]} ${m[1]}`;
  }
  if (/^\d{4}$/.test(d)) return d;
  return d;
}

function resumeDataToCanonicalSections(
  resume: ResumeData,
  theme: ResumeTheme,
): CanonicalSection[] {
  const sections: CanonicalSection[] = [];
  let order = 0;

  // 1. Professional Profile
  if (resume.summary) {
    sections.push({
      id: "sec-professional-profile",
      type: "professionalProfile",
      title: "PROFESSIONAL SUMMARY",
      order: order++,
      items: [{ kind: "text", text: resume.summary }],
      originalEntityCount: 1,
      originalBulletCount: 0,
      isDynamic: false,
    });
  }

  // 2. Professional Experience
  if (resume.experience?.length) {
    const expItems: CanonicalSectionItem[] = [];
    for (const exp of resume.experience) {
      const leftSide = [
        exp.title,
        exp.company && ` | ${exp.company}`,
        exp.location && ` | ${exp.location}`,
      ].filter(Boolean).join("");
      const dateStr = exp.startDate || exp.endDate
        ? `${fmtDate(exp.startDate)} – ${fmtDate(exp.endDate)}`
        : "";
      expItems.push({
        kind: "table-row",
        cells: [
          { text: leftSide, bold: true, align: "left" },
          { text: dateStr, bold: true, align: "right" },
        ],
      });
      if (exp.bullets?.length) {
        expItems.push({ kind: "bullets", bullets: exp.bullets });
      }
    }
    sections.push({
      id: "sec-experience",
      type: "professionalExperience",
      title: "PROFESSIONAL EXPERIENCE",
      order: order++,
      items: expItems,
      originalEntityCount: resume.experience.length,
      originalBulletCount: resume.experience.reduce((s, e) => s + (e.bullets?.length || 0), 0),
      isDynamic: false,
    });
  }

  // 3. Education
  if (resume.education?.length) {
    const edItems: CanonicalSectionItem[] = [];
    for (const ed of resume.education) {
      const leftSide = [
        ed.degree,
        ed.field && ` in ${ed.field}`,
        ed.institution && ` | ${ed.institution}`,
        ed.location && ` | ${ed.location}`,
      ].filter(Boolean).join("");
      const dateStr = ed.startDate || ed.endDate
        ? `${fmtDate(ed.startDate)} – ${fmtDate(ed.endDate)}`
        : "";
      edItems.push({
        kind: "table-row",
        cells: [
          { text: leftSide, bold: true, align: "left" },
          { text: dateStr, bold: true, align: "right" },
        ],
      });
      if (ed.highlights?.length) {
        edItems.push({ kind: "bullets", bullets: ed.highlights });
      }
    }
    sections.push({
      id: "sec-education",
      type: "education",
      title: "EDUCATION",
      order: order++,
      items: edItems,
      originalEntityCount: resume.education.length,
      originalBulletCount: resume.education.reduce((s, e) => s + (e.highlights?.length || 0), 0),
      isDynamic: false,
    });
  }

  // 4. Skills
  if (resume.skills?.length) {
    const categorized = new Map<string, string[]>();
    for (const s of resume.skills) {
      let cat = s.category?.trim();
      let name = s.name;
      if (!cat) {
        const colonIdx = name.indexOf(":");
        if (colonIdx > 0 && colonIdx < 35) {
          cat = name.slice(0, colonIdx).trim();
          name = name.slice(colonIdx + 1).trim();
        } else {
          cat = "General";
        }
      }
      if (!categorized.has(cat)) categorized.set(cat, []);
      categorized.get(cat)!.push(name);
    }
    const groups = Array.from(categorized.entries()).map(([label, items]) => ({ label, items }));
    sections.push({
      id: "sec-skills",
      type: "skills",
      title: "CORE COMPETENCIES & SKILLS",
      order: order++,
      items: [{ kind: "nested-bullets", groups }],
      originalEntityCount: resume.skills.length,
      originalBulletCount: 0,
      isDynamic: false,
    });
  }

  // 5. Languages
  if (resume.languages?.length) {
    const langItems: CanonicalSectionItem[] = [];
    for (const l of resume.languages) {
      const note = (l as any).note ? ` (${(l as any).note})` : "";
      langItems.push({ kind: "text", text: `${l.name} – ${l.proficiency}${note}` });
    }
    sections.push({
      id: "sec-languages",
      type: "languages",
      title: "LANGUAGES",
      order: order++,
      items: langItems,
      originalEntityCount: resume.languages.length,
      originalBulletCount: 0,
      isDynamic: false,
    });
  }

  // 6. Additional Information
  const pd = resume.contact?.personalDetails;
  const addInfoItems: CanonicalSectionItem[] = [];
  if (pd && Object.keys(pd).length > 0) {
    for (const [label, value] of Object.entries(pd)) {
      if (value?.trim()) {
        addInfoItems.push({
          kind: "text",
          text: `${label.charAt(0).toUpperCase() + label.slice(1)} : ${value}`,
        });
      }
    }
  }
  if (resume.additionalInfo) {
    const paragraphs = resume.additionalInfo.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const p of paragraphs) {
      addInfoItems.push({ kind: "text", text: p });
    }
  }
  if (addInfoItems.length > 0) {
    sections.push({
      id: "sec-additional-info",
      type: "additionalInformation",
      title: "Additional Information",
      order: order++,
      items: addInfoItems,
      originalEntityCount: addInfoItems.length,
      originalBulletCount: 0,
      isDynamic: false,
    });
  }

  // 7. Dynamic sections (in order)
  const dynamicSections = resume.dynamicSections || [];
  for (const ds of dynamicSections) {
    const dynItems: CanonicalSectionItem[] = [];
    dynItems.push({ kind: "text", text: ds.title, bold: true });
    if (ds.bullets.length === 1 && ds.bullets[0].length > 60) {
      dynItems.push({ kind: "text", text: ds.bullets[0] });
    } else {
      const bulletItems = ds.bullets.filter((b) => b.trim().length > 0);
      if (bulletItems.length > 0) {
        dynItems.push({ kind: "bullets", bullets: bulletItems });
      }
    }
    sections.push({
      id: `sec-dynamic-${ds.id}`,
      type: "dynamicSections",
      title: ds.title.toUpperCase(),
      order: order++,
      items: dynItems,
      originalEntityCount: 1,
      originalBulletCount: ds.bullets.length,
      isDynamic: true,
      metadata: { normalizedTitle: ds.normalizedTitle },
    });
  }

  return sections;
}

function canonicalSectionToRenderNodes(
  section: CanonicalSection,
  theme: ResumeTheme,
  sectionStyle: Partial<RenderNodeStyle>,
  parentId: string,
): RenderNode[] {
  const nodes: RenderNode[] = [];

  // Section divider
  if (theme.showDividers) {
    nodes.push(makeNode("divider", "", parentId, {
      marginTopMm: theme.sectionGapMm / 2,
      marginBottomMm: theme.sectionGapMm / 2,
    }));
  }

  // Section title
  if (section.title) {
    nodes.push(makeNode("section-title", section.title, parentId, {
      fontFamily: theme.fontFamily,
      fontSizePt: theme.sectionTitleSizePt,
      bold: true,
      color: theme.sectionTitleColor,
      marginTopMm: theme.sectionGapMm,
      marginBottomMm: theme.headerGapMm,
    }));
  }

  // Section items
  for (const item of section.items) {
    const itemNodes = canonicalItemToRenderNodes(item, theme, sectionStyle, parentId);
    nodes.push(...itemNodes);
  }

  return nodes;
}

function canonicalItemToRenderNodes(
  item: CanonicalSectionItem,
  theme: ResumeTheme,
  style: Partial<RenderNodeStyle>,
  parentId: string,
): RenderNode[] {
  const nodes: RenderNode[] = [];
  const baseStyle: Partial<RenderNodeStyle> = {
    fontFamily: theme.fontFamily,
    fontSizePt: theme.bodyFontSizePt,
    color: theme.bodyTextColor,
    ...style,
  };

  switch (item.kind) {
    case "text":
      nodes.push(makeNode("text-line", item.text, parentId, {
        ...baseStyle,
        bold: item.bold,
        italic: item.italic,
        marginBottomMm: theme.paragraphSpacingMm,
      }));
      break;

    case "bullets": {
      const indent = theme.bulletIndentMm;
      for (const bullet of item.bullets) {
        nodes.push(makeNode("bullet-item", bullet, parentId, {
          ...baseStyle,
          paddingLeftMm: indent + ((item.level || 0) * 4),
          marginBottomMm: theme.paragraphSpacingMm * 0.5,
        }));
      }
      break;
    }

    case "table-row": {
      const cellStyle: Partial<RenderNodeStyle> = {
        ...baseStyle,
        marginBottomMm: 0.5,
      };
      for (const cell of item.cells) {
        nodes.push(makeNode("table-cell", cell.text, parentId, {
          ...cellStyle,
          bold: cell.bold,
          textAlign: cell.align || "left",
        }));
      }
      break;
    }

    case "nested-bullets": {
      for (const group of item.groups) {
        nodes.push(makeNode("nested-group-label", group.label, parentId, {
          ...baseStyle,
          bold: true,
          marginTopMm: theme.paragraphSpacingMm,
          marginBottomMm: theme.paragraphSpacingMm * 0.5,
        }));
        for (const item of group.items) {
          nodes.push(makeNode("nested-group-item", item, parentId, {
            ...baseStyle,
            paddingLeftMm: theme.bulletIndentMm,
            marginBottomMm: theme.paragraphSpacingMm * 0.3,
          }));
        }
      }
      break;
    }
  }

  return nodes;
}

// ── Public Engine API ──────────────────────────────────────────────────────

/**
 * Build a CanonicalResume from ResumeData.
 * This is the SINGLE creation point for the canonical form.
 */
export function buildCanonicalResume(
  resume: ResumeData,
  layout?: Partial<ResumeTheme>,
): CanonicalResume {
  const theme: ResumeTheme = buildTheme(
    resume.template || "ats-professional",
    resume.accentColor,
    layout as any,
  );

  const sections = resumeDataToCanonicalSections(resume, theme);

  const validationErrors: string[] = [];

  // Validate
  if (!resume.name?.trim()) validationErrors.push("Name is required");
  if (!resume.id) validationErrors.push("Resume ID is required");

  return {
    id: resume.id,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
    source: resume.source,
    fileName: resume.fileName,
    name: resume.name,
    headline: resume.headline,
    contact: {
      email: resume.contact.email,
      phone: resume.contact.phone,
      location: resume.contact.location,
      website: resume.contact.website,
      linkedin: resume.contact.linkedin,
      github: resume.contact.github,
      personalDetails: resume.contact.personalDetails,
    },
    photoUrl: resume.photoUrl,
    sections,
    theme,
    template: resume.template || "ats-professional",
    isValid: validationErrors.length === 0,
    validationErrors,
  };
}

/**
 * Convert a CanonicalResume to an ordered array of RenderNode[].
 * This is the ONLY place RenderNode[] are created.
 */
export function canonicalResumeToRenderTree(
  canonical: CanonicalResume,
): RenderNode[] {
  nodeIdCounter = 0;

  const tree: RenderNode[] = [];

  // ── Document root ──
  const docRoot = makeNode("document", canonical.name, null, {
    fontFamily: canonical.theme.fontFamily,
    fontSizePt: canonical.theme.bodyFontSizePt,
    color: canonical.theme.bodyTextColor,
    backgroundColor: canonical.theme.backgroundColor,
    marginTopMm: canonical.theme.marginTopMm,
    marginBottomMm: canonical.theme.marginBottomMm,
    marginLeftMm: canonical.theme.marginLeftMm,
    marginRightMm: canonical.theme.marginRightMm,
  });
  tree.push(docRoot);

  // ── Header nodes ──
  const headerStyle: Partial<RenderNodeStyle> = {
    fontFamily: canonical.theme.fontFamily,
    color: canonical.theme.contactColor,
    marginBottomMm: 0.5,
  };

  if (canonical.name) {
    tree.push(makeNode("contact-line", canonical.name, docRoot.id, {
      ...headerStyle,
      fontSizePt: canonical.theme.nameSizePt,
      bold: true,
      color: canonical.theme.nameColor,
      marginTopMm: 0,
      marginBottomMm: 1,
    }));
  }

  if (canonical.headline) {
    tree.push(makeNode("contact-line", canonical.headline, docRoot.id, {
      ...headerStyle,
      fontSizePt: canonical.theme.headlineSizePt,
      color: canonical.theme.headlineColor,
      marginBottomMm: 1,
    }));
  }

  // Contact info line
  const contactParts: string[] = [];
  if (canonical.contact.phone) contactParts.push(canonical.contact.phone);
  if (canonical.contact.email) contactParts.push(canonical.contact.email);
  if (canonical.contact.location) contactParts.push(canonical.contact.location);
  if (contactParts.length > 0) {
    tree.push(makeNode("contact-line", contactParts.join(" | "), docRoot.id, {
      ...headerStyle,
      fontSizePt: canonical.theme.bodyFontSizePt,
      marginBottomMm: canonical.theme.headerGapMm,
    }));
  }

  // ── Section nodes ──
  for (const section of canonical.sections) {
    const sectionNodes = canonicalSectionToRenderNodes(
      section,
      canonical.theme,
      {},
      docRoot.id,
    );
    tree.push(...sectionNodes);
  }

  return tree;
}

/**
 * Full pipeline: ResumeData → RenderEngineResult
 * Validates, builds canonical, applies theme, compresses if needed,
 * builds render tree, and layouts across pages.
 */
export function renderResume(
  resume: ResumeData,
  themeOverrides?: Partial<ResumeTheme>,
): RenderEngineResult {
  const warnings: string[] = [];

  // 1. Build canonical resume
  const canonical = buildCanonicalResume(resume, themeOverrides);
  if (!canonical.isValid) {
    warnings.push(...canonical.validationErrors.map((e) => `Validation: ${e}`));
  }

  // 2. Check one-page constraint
  let theme = canonical.theme;
  if (theme.enforceOnePage) {
    const totalChars = canonical.sections.reduce((sum, s) => {
      let chars = 0;
      for (const item of s.items) {
        if (item.kind === "text") chars += item.text.length;
        else if (item.kind === "bullets") chars += item.bullets.join(" ").length;
        else if (item.kind === "table-row") chars += item.cells.map((c) => c.text).join(" ").length;
        else if (item.kind === "nested-bullets") {
          for (const g of item.groups) chars += g.label.length + g.items.join(", ").length;
        }
      }
      return sum + chars;
    }, 0);

    const compression = compressToOnePage(totalChars, theme);
    if (compression.stepsApplied.length > 0) {
      theme = applyCompression(theme, compression);
      warnings.push(`One-page compression applied: ${compression.stepsApplied.join(", ")}`);
      warnings.push(compression.fitsOnOnePage
        ? "Content fits on one page after compression"
        : "Warning: content may still overflow one page",
      );
    }
  }

  // Update canonical theme with compressed values
  const compressedCanonical: CanonicalResume = { ...canonical, theme };

  // 3. Build render tree
  const renderTree = canonicalResumeToRenderTree(compressedCanonical);

  // 4. Layout pages
  const layout = layoutNodes(renderTree, theme);

  return {
    canonicalResume: compressedCanonical,
    renderTree,
    layout,
    theme,
    warnings,
  };
}
