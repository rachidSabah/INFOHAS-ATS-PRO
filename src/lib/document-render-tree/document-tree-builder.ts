// ============================================================================
// DocumentTreeBuilder — ResumeData → DocumentRenderTree
// ============================================================================
// This is the SOLE entry point for converting resume data into the universal
// render tree. No renderer (Preview, DOCX, PDF) may bypass this tree.
// ============================================================================

import { buildCanonicalResume } from "../render-engine";
import { buildTheme } from "../theme-engine";
import type {
  CanonicalResume,
  CanonicalSection,
  CanonicalSectionType,
  ResumeTheme,
  ResumeTemplate,
  CanonicalSectionItem,
} from "../types-phase3";
import type {
  DocumentNode,
  DocumentNodeStyle,
  SectionRenderer,
  SectionRenderData,
  DocumentTree,
} from "./types";
import { createDefaultRenderers } from "./section-renderers";
import { layoutDocumentNodes } from "./layout-engine";
import { paginateNodes } from "./pagination-engine";
import { buildPhotoNode } from "./photo-engine";

export interface TreeBuildOptions {
  template?: string;
  themeOverrides?: Partial<ResumeTheme>;
  customRenderers?: Map<CanonicalSectionType, SectionRenderer>;
  widowsLines?: number;
  orphansLines?: number;
}

let nodeIdCounter = 0;
function nextId(prefix = "n"): string {
  return `${prefix}-${++nodeIdCounter}`;
}

function makeNode(
  type: DocumentNode["type"],
  content: string,
  parentId: string | null,
  style: Partial<DocumentNodeStyle> = {},
  sectionType?: CanonicalSectionType,
  metadata?: Record<string, unknown>,
): DocumentNode {
  return {
    id: nextId(),
    type,
    parentId,
    children: [],
    content,
    style,
    visibility: "visible" as const,
    position: null,
    sectionType,
    metadata,
  };
}

const DEFAULT_TEMPLATE: ResumeTemplate = "ats-professional";

/**
 * Build a complete DocumentRenderTree from resume data.
 *
 * Pipeline:
 * 1. ResumeData → CanonicalResume (via render-engine.ts)
 * 2. Build ResumeTheme (via theme-engine.ts)
 * 3. Render each section → DocumentNode[] (via SectionRenderers)
 * 4. Build header block (name, contact, photo)
 * 5. Collect all nodes into flat list
 * 6. Run layout + pagination
 * 7. Return DocumentTree
 */
export function buildDocumentTree(
  resumeData: Record<string, unknown>,
  options: TreeBuildOptions = {},
): DocumentTree {
  const template = (options.template ?? "ats-professional") as ResumeTemplate;

  // 1. Build CanonicalResume
  let canonical: CanonicalResume | null = null;
  try {
    canonical = buildCanonicalResume(resumeData as any);
  } catch {
    // buildCanonicalResume may throw if resume data is too minimal
    return createEmptyTree("Failed to build canonical resume");
  }
  if (!canonical) {
    return createEmptyTree("Failed to build canonical resume");
  }

  // 2. Build theme
  const theme = options.themeOverrides
    ? { ...buildTheme(template), ...options.themeOverrides }
    : buildTheme(template);

  // 3. Prepare section renderers
  const renderers = options.customRenderers ?? createDefaultRenderers();
  const allNodes: DocumentNode[] = [];

  // 4. Build header block
  const photo = buildPhotoNode(
    (resumeData as any)?.photoUrl ?? (resumeData as any)?.photo ?? canonical.photoUrl,
  );

  // Name
  allNodes.push(makeNode("text-line", canonical.name || "YOUR NAME", null, {
    fontSizePt: theme.nameSizePt,
    bold: true,
    color: theme.nameColor,
    marginBottomMm: 2,
  }));

  // Headline
  if (canonical.headline) {
    allNodes.push(makeNode("text-line", canonical.headline, null, {
      fontSizePt: theme.headlineSizePt ?? theme.bodyFontSizePt,
      color: theme.headlineColor ?? theme.bodyTextColor,
      marginBottomMm: theme.lineHeightMm * 0.5,
    }));
  }

  // Contact line
  const contactParts: string[] = [];
  if (canonical.contact?.phone) contactParts.push(canonical.contact.phone);
  if (canonical.contact?.email) contactParts.push(canonical.contact.email);
  if (canonical.contact?.location) contactParts.push(canonical.contact.location);
  if (contactParts.length) {
    allNodes.push(makeNode("contact-line", contactParts.join(" | "), null, {
      fontSizePt: Math.max(theme.minFontSizePt, theme.bodyFontSizePt - 1),
      color: theme.contactColor,
      marginBottomMm: 1,
    }));
  }

  // Date of birth (from raw resume data)
  const dateOfBirth = (resumeData as any)?.dateOfBirth;
  if (dateOfBirth) {
    allNodes.push(makeNode("contact-line", `Date Of Birth: ${dateOfBirth}`, null, {
      fontSizePt: Math.max(theme.minFontSizePt, theme.bodyFontSizePt - 1),
      color: theme.contactColor,
      marginBottomMm: 3,
    }));
  } else {
    allNodes.push(makeNode("spacer", "", null, { heightMm: 3 }));
  }

  // 5. Render each canonical section
  for (const section of canonical.sections) {
    const renderer = renderers.get(section.type);
    if (!renderer) continue;

    // Section divider
    if (theme.showDividers !== false) {
      allNodes.push(makeNode("divider", "", null, {
        borderBottom: { widthPt: 0.5, color: theme.sectionTitleColor, style: "solid" },
        marginBottomMm: 2,
      }));
    }

    // Section title
    allNodes.push(makeNode("section-title", section.title.toUpperCase(), null, {
      fontSizePt: theme.sectionTitleSizePt,
      bold: true,
      color: theme.sectionTitleColor,
      marginTopMm: theme.sectionGapMm,
      marginBottomMm: theme.lineHeightMm * 0.5,
      keepWithNext: true,
    }, section.type));

    // Section content via renderer
    const renderData: SectionRenderData = {
      title: section.title,
      items: mapSectionItems(section.items, theme),
      sectionType: section.type,
    };
    const sectionNodes = renderer.render(renderData);
    allNodes.push(...sectionNodes);
  }

  // Add photo node if present (floats top-right)
  if (photo) {
    allNodes.unshift(photo);
  }

  // 6. Run layout + pagination
  const layoutResult = layoutDocumentNodes(allNodes, theme, {
    widowsLines: options.widowsLines,
    orphansLines: options.orphansLines,
  });

  // 7. Build tree structure
  const root: DocumentNode = {
    id: "document-root",
    type: "document" as any,
    parentId: null,
    children: allNodes,
    content: "",
    style: {
      fontFamily: theme.fontFamily,
      fontSizePt: theme.bodyFontSizePt,
      color: theme.bodyTextColor,
      marginTopMm: theme.marginTopMm,
      marginBottomMm: theme.marginBottomMm,
      marginLeftMm: theme.marginLeftMm,
      marginRightMm: theme.marginRightMm,
    },
    visibility: "visible" as const,
    position: null,
  };

  return {
    root,
    theme,
    renderers,
    layout: layoutResult,
    warnings: layoutResult.hasOverflow
      ? ["Content exceeds available space — consider compression"]
      : [],
  };
}

/**
 * Map CanonicalSectionItem[] to SectionRenderItem[] for section renderers.
 */
function mapSectionItems(
  items: CanonicalSectionItem[],
  theme: ResumeTheme,
): SectionRenderData["items"] {
  return items.map((item: any) => {
    switch (item.kind) {
      case "text":
        return { kind: "text", text: item.text, bold: item.bold, italic: item.italic };
      case "bullets":
        return { kind: "bullets", bullets: item.bullets, level: item.level };
      case "table-row":
        return {
          kind: "table-row",
          cells: item.cells.map((c: any) => ({
            text: c.text,
            bold: c.bold,
            align: c.align as "left" | "right" | undefined,
          })),
        };
      case "nested-bullets":
        return {
          kind: "nested-bullets",
          groups: item.groups.map((g: any) => ({
            label: g.label,
            items: g.items,
          })),
        };
      case "photo":
        return { kind: "photo", url: item.url };
      case "link":
        return { kind: "link", text: item.text, url: item.url ?? "" };
      case "spacer":
        return { kind: "spacer", heightMm: item.heightMm ?? 2 };
      default:
        return { kind: "text", text: (item as any).text ?? "" };
    }
  });
}

function createEmptyTree(warning: string): DocumentTree {
  const emptyTheme = buildTheme(DEFAULT_TEMPLATE);
  return {
    root: {
      id: "document-root",
      type: "document" as any,
      parentId: null,
      children: [],
      content: "",
      style: {},
      visibility: "visible" as const,
      position: null,
    },
    theme: emptyTheme,
    renderers: new Map(),
    layout: { pages: [], totalPages: 0, hasOverflow: false },
    warnings: [warning],
  };
}
