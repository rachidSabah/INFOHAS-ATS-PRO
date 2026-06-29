/**
 * render-document.ts — ResumeData → RenderDocument converter
 *
 * Converts the internal ResumeData into a canonical RenderDocument that all
 * renderers (Preview, DOCX, PDF) consume identically. This ensures section
 * order, content structure, and formatting are SINGLE SOURCE OF TRUTH.
 */
import type {
  ResumeData,
  RenderDocument,
  RenderDocumentSection,
  RenderContentItem,
  RenderSectionType,
  ResumeLayoutModel,
} from "./types";
import { getDefaultResumeLayout } from "./exporter";

/** Map from ResumeData's field names to canonical section types */
function detectSectionType(field: string): RenderSectionType {
  switch (field) {
    case "summary":
    case "professionalProfile":
      return "professionalProfile";
    case "experience":
      return "professionalExperience";
    case "education":
      return "education";
    case "skills":
      return "skills";
    case "languages":
      return "languages";
    case "additionalInfo":
      return "additionalInformation";
    case "projects":
      return "projects";
    case "certifications":
      return "certifications";
    default:
      return "skills";
  }
}

/** Section title overrides for rendered output */
const SECTION_TITLES: Record<RenderSectionType, string> = {
  personalInformation: "PERSONAL INFORMATION",
  professionalProfile: "PROFESSIONAL SUMMARY",
  professionalExperience: "PROFESSIONAL EXPERIENCE",
  education: "EDUCATION",
  skills: "CORE COMPETENCIES & SKILLS",
  languages: "LANGUAGES",
  additionalInformation: "ADDITIONAL INFORMATION",
  projects: "PROJECTS",
  certifications: "CERTIFICATIONS",
};

function buildContactBlock(resume: ResumeData): RenderDocument["contact"] {
  // Sanitize headline: if it contains contact info (PHONE:, Email:, @, | ) clear it
  const rawHeadline = resume.headline || "";
  const hasContactPattern = /PHONE:|Email:|@|^\s*\+?\d{8,}|\s*\|\s*/.test(rawHeadline);
  const headline = hasContactPattern ? "" : rawHeadline;

  return {
    name: resume.name || "",
    headline,
    phone: resume.contact.phone,
    email: resume.contact.email,
    location: resume.contact.location,
    dateOfBirth: resume.dateOfBirth,
  };
}

function buildProfessionalProfile(resume: ResumeData): RenderDocumentSection | null {
  if (!resume.summary) return null;
  return {
    type: "professionalProfile",
    title: SECTION_TITLES.professionalProfile,
    items: [
      { kind: "text", text: resume.summary },
    ],
  };
}

function buildExperienceSection(resume: ResumeData): RenderDocumentSection | null {
  if (!resume.experience?.length) return null;
  const items: RenderContentItem[] = [];
  for (const exp of resume.experience) {
    // Title line with company, location, dates
    const leftSide = `${exp.title}${exp.company ? ` | ${exp.company}` : ""}${exp.location ? ` | ${exp.location}` : ""}`;
    const dateStr = exp.startDate || exp.endDate ? `${fmtInfohasRenderDate(exp.startDate)} – ${fmtInfohasRenderDate(exp.endDate)}` : "";
    items.push({
      kind: "table-row",
      cells: [
        { text: leftSide, bold: true, align: "left" },
        { text: dateStr, bold: true, align: "right" },
      ],
    });
    // Bullets
    if (exp.bullets?.length) {
      items.push({
        kind: "bullets",
        bullets: exp.bullets,
        level: 0,
      });
    }
  }
  return {
    type: "professionalExperience",
    title: SECTION_TITLES.professionalExperience,
    items,
  };
}

function buildEducationSection(resume: ResumeData): RenderDocumentSection | null {
  if (!resume.education?.length) return null;
  const items: RenderContentItem[] = [];
  for (const ed of resume.education) {
    const leftSide = `${ed.degree}${ed.field ? ` in ${ed.field}` : ""}${ed.institution ? ` | ${ed.institution}` : ""}${ed.location ? ` | ${ed.location}` : ""}`;
    const dateStr = ed.startDate || ed.endDate ? `${fmtInfohasRenderDate(ed.startDate)} – ${fmtInfohasRenderDate(ed.endDate)}` : "";
    items.push({
      kind: "table-row",
      cells: [
        { text: leftSide, bold: true, align: "left" },
        { text: dateStr, bold: true, align: "right" },
      ],
    });
    // Education highlights as bullets
    if (ed.highlights?.length) {
      items.push({
        kind: "bullets",
        bullets: ed.highlights,
        level: 0,
      });
    }
  }
  return {
    type: "education",
    title: SECTION_TITLES.education,
    items,
  };
}

function buildSkillsSection(resume: ResumeData): RenderDocumentSection | null {
  if (!resume.skills?.length) return null;
  // Group by category
  const categorized = new Map<string, string[]>();
  for (const s of resume.skills) {
    let cat = s.category?.trim();
    let name = s.name;
    // Fallback: if no explicit category, detect "Category: skill" pattern in name
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
  // Rename "General" category to the first non-General category if it only has one item
  // and that item looks like a category header
  const groups: { label: string; items: string[] }[] = [];
  for (const [category, skillNames] of categorized) {
    groups.push({ label: category, items: skillNames });
  }
  return {
    type: "skills",
    title: SECTION_TITLES.skills,
    items: [
      { kind: "nested-bullets", groups },
    ],
  };
}

function buildLanguagesSection(resume: ResumeData): RenderDocumentSection | null {
  if (!resume.languages?.length) return null;
  const items: RenderContentItem[] = [];
  for (const l of resume.languages) {
    const note = (l as any).note ? ` (${(l as any).note})` : "";
    items.push({
      kind: "text",
      text: `${l.name} – ${l.proficiency}${note}`,
    });
  }
  // Also render as a single bullet line if prefer compact
  return {
    type: "languages",
    title: SECTION_TITLES.languages,
    items: [
      {
        kind: "bullets",
        bullets: resume.languages.map(l => `${l.name} (${l.proficiency})`),
        level: 0,
      },
    ],
  };
}

function buildAdditionalInfoSection(resume: ResumeData): RenderDocumentSection | null {
  if (!resume.additionalInfo) return null;
  const paragraphs = resume.additionalInfo.split("\n").map(l => l.trim()).filter(Boolean);
  if (!paragraphs.length) return null;
  return {
    type: "additionalInformation",
    title: SECTION_TITLES.additionalInformation,
    items: paragraphs.map(p => ({ kind: "text" as const, text: p })),
  };
}

function fmtInfohasRenderDate(d?: string): string {
  if (!d) return "";
  if (/present/i.test(d)) return "Present";
  // "2024-05" → "May 2024"
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(m[2]) - 1] ?? m[2]} ${m[1]}`;
  }
  if (/^\d{4}$/.test(d)) return d;
  return d;
}

/**
 * Convert ResumeData → RenderDocument (single source of truth for all renderers)
 */
export function toRenderDocument(
  resume: ResumeData,
  layout?: ResumeLayoutModel,
): RenderDocument {
  const L = layout ?? getDefaultResumeLayout();

  const sectionBuilders: Array<() => RenderDocumentSection | null> = [
    () => buildProfessionalProfile(resume),
    () => buildExperienceSection(resume),
    () => buildEducationSection(resume),
    () => buildSkillsSection(resume),
    () => buildLanguagesSection(resume),
    () => buildAdditionalInfoSection(resume),
    ...((resume.dynamicSections || []).map((ds) => () => {
      const items: RenderContentItem[] = [];
      if (ds.bullets && ds.bullets.length > 0) {
        items.push({ kind: "bullets", bullets: ds.bullets, level: 0 });
      } else if (ds.content) {
        items.push({ kind: "text", text: ds.content });
      }
      if (items.length === 0) return null;
      return {
        type: "skills" as RenderSectionType, // fallback type
        title: ds.title.toUpperCase(),
        items,
      };
    })),
  ];

  const sections: RenderDocumentSection[] = [];
  for (const builder of sectionBuilders) {
    const section = builder();
    if (section) sections.push(section);
  }

  // Estimate total chars
  let totalChars = 0;
  for (const s of sections) {
    for (const item of s.items) {
      if (item.kind === "text") totalChars += item.text.length;
      else if (item.kind === "bullets") totalChars += item.bullets.join(" ").length;
      else if (item.kind === "nested-bullets") {
        for (const g of item.groups) {
          totalChars += g.label.length + g.items.join(", ").length;
        }
      }
    }
  }

  return {
    template: resume.template,
    layout: L,
    contact: buildContactBlock(resume),
    sections,
    totalChars,
    hasAdditionalInfo: !!resume.additionalInfo,
  };
}
