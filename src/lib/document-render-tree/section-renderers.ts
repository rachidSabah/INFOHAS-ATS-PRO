// ============================================================================
// Section Renderers — each section type → DocumentNode[]
// ============================================================================
// Each renderer outputs DocumentNode[], never raw DOCX or PDF.
// Renderers are registered by section type and called by the DocumentTreeBuilder.
// ============================================================================

import type { ResumeTheme } from "../types-phase3";
import type {
  DocumentNode,
  DocumentNodeStyle,
  SectionRenderer,
  SectionRenderData,
  CanonicalSectionType,
} from "./types";

// ── Shared Helpers ───────────────────────────────────────────────────────

let nodeIdCounter = 0;

export function resetNodeIdCounter(): void {
  nodeIdCounter = 0;
}

function nextId(): string {
  return `rn-${++nodeIdCounter}`;
}

function makeNode(
  type: DocumentNode["type"],
  content: string,
  parentId: string | null,
  style: Partial<DocumentNodeStyle> = {},
  sectionType?: CanonicalSectionType,
): DocumentNode {
  return {
    id: nextId(),
    type,
    parentId,
    children: [],
    content,
    style,
    visibility: "visible",
    position: null,
    sectionType,
  };
}

function baseStyle(theme: ResumeTheme): Partial<DocumentNodeStyle> {
  return {
    fontFamily: theme.fontFamily,
    fontSizePt: theme.bodyFontSizePt,
    color: theme.bodyTextColor,
  };
}

// ── Base Section Renderer (shared logic) ─────────────────────────────────

abstract class BaseSectionRenderer implements SectionRenderer {
  abstract sectionType: CanonicalSectionType;

  render(data: SectionRenderData): DocumentNode[] {
    // Use a minimal theme object for rendering — the section type provides
    // enough context for the base renderer
    const theme = (data as any)._theme || {};
    return this.renderItems(data.items, theme, "");
  }

  protected renderItems(
    items: SectionRenderData["items"],
    theme: ResumeTheme,
    parentId: string,
  ): DocumentNode[] {
    const nodes: DocumentNode[] = [];
    const bs = baseStyle(theme);

    for (const item of items) {
      switch (item.kind) {
        case "text":
          nodes.push(makeNode("text-line", item.text, parentId, {
            ...bs,
            bold: item.bold,
            italic: item.italic,
            fontSizePt: item.fontSizePt,
            marginBottomMm: theme.paragraphSpacingMm,
          }));
          break;

        case "bullets":
          for (const b of item.bullets) {
            nodes.push(makeNode("bullet-item", b, parentId, {
              ...bs,
              paddingLeftMm: theme.bulletIndentMm + ((item.level ?? 0) * 4),
              marginBottomMm: theme.paragraphSpacingMm * 0.5,
            }));
          }
          break;

        case "table-row": {
          for (const cell of item.cells) {
            nodes.push(makeNode("table-cell", cell.text, parentId, {
              ...bs,
              bold: cell.bold,
              textAlign: cell.align || "left",
              marginBottomMm: 0.5,
            }));
          }
          break;
        }

        case "nested-bullets":
          for (const group of item.groups) {
            nodes.push(makeNode("nested-group-label", group.label, parentId, {
              ...bs,
              bold: true,
              marginTopMm: theme.paragraphSpacingMm,
              marginBottomMm: theme.paragraphSpacingMm * 0.5,
            }));
            for (const gi of group.items) {
              nodes.push(makeNode("nested-group-item", gi, parentId, {
                ...bs,
                paddingLeftMm: theme.bulletIndentMm,
                marginBottomMm: theme.paragraphSpacingMm * 0.3,
              }));
            }
          }
          break;

        case "photo":
          nodes.push(makeNode("photo", item.url, parentId, {
            photoWidthMm: 30,
            photoHeightMm: 40,
            photoPlacement: "top-right",
            photoCrop: "square",
            float: "right",
          }));
          break;

        case "link":
          nodes.push(makeNode("text-line", item.text, parentId, {
            ...bs,
            color: theme.accentColor || "#0000EE",
            metadata: { url: item.url },
          } as any));
          break;

        case "spacer":
          nodes.push(makeNode("spacer", "", parentId, {
            heightMm: item.heightMm,
          }));
          break;

        case "certification":
          nodes.push(makeNode("text-line", item.name, parentId, {
            ...bs,
            bold: true,
            marginBottomMm: theme.paragraphSpacingMm * 0.3,
          }));
          if (item.issuer) {
            nodes.push(makeNode("text-line", item.issuer, parentId, {
              ...bs,
              marginBottomMm: theme.paragraphSpacingMm * 0.3,
            }));
          }
          break;

        case "project":
          nodes.push(makeNode("text-line", item.name, parentId, {
            ...bs,
            bold: true,
            marginBottomMm: theme.paragraphSpacingMm * 0.3,
          }));
          if (item.description) {
            nodes.push(makeNode("text-line", item.description, parentId, {
              ...bs,
              marginBottomMm: theme.paragraphSpacingMm * 0.3,
            }));
          }
          if (item.technologies?.length) {
            nodes.push(makeNode("text-line", item.technologies.join(", "), parentId, {
              ...bs,
              italic: true,
              marginBottomMm: theme.paragraphSpacingMm * 0.3,
            }));
          }
          break;

        case "achievement":
          nodes.push(makeNode("text-line", item.title, parentId, {
            ...bs,
            bold: true,
            marginBottomMm: theme.paragraphSpacingMm * 0.3,
          }));
          if (item.description) {
            nodes.push(makeNode("text-line", item.description, parentId, {
              ...bs,
              marginBottomMm: theme.paragraphSpacingMm * 0.3,
            }));
          }
          break;
      }
    }

    return nodes;
  }
}

// ── Section: Professional Profile ────────────────────────────────────────

class ProfileRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "professionalProfile";

  render(data: SectionRenderData): DocumentNode[] {
    return this.renderItems(data.items, {} as ResumeTheme, "");
  }
}

// ── Section: Professional Experience ─────────────────────────────────────

class ExperienceRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "professionalExperience";
}

// ── Section: Education ───────────────────────────────────────────────────

class EducationRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "education";
}

// ── Section: Skills ──────────────────────────────────────────────────────

class SkillsRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "skills";
}

// ── Section: Languages ───────────────────────────────────────────────────

class LanguagesRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "languages";
}

// ── Section: Certifications ──────────────────────────────────────────────

class CertificationsRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "certifications";
}

// ── Section: Projects ────────────────────────────────────────────────────

class ProjectsRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "projects";
}

// ── Section: Achievements ────────────────────────────────────────────────

class AchievementsRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "achievements";
}

// ── Section: Additional Information ──────────────────────────────────────

class AdditionalInfoRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "additionalInformation";
}

// ── Dynamic Section Renderer ─────────────────────────────────────────────

class DynamicSectionRenderer extends BaseSectionRenderer {
  sectionType: CanonicalSectionType = "dynamicSections";
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createDefaultRenderers(): Map<CanonicalSectionType, SectionRenderer> {
  const map = new Map<CanonicalSectionType, SectionRenderer>();

  const renderers: SectionRenderer[] = [
    new ProfileRenderer(),
    new ExperienceRenderer(),
    new EducationRenderer(),
    new SkillsRenderer(),
    new LanguagesRenderer(),
    new CertificationsRenderer(),
    new ProjectsRenderer(),
    new AchievementsRenderer(),
    new AdditionalInfoRenderer(),
    new DynamicSectionRenderer(),
  ];

  for (const r of renderers) {
    map.set(r.sectionType, r);
  }

  return map;
}
