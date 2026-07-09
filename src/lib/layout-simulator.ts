import { ResumeData } from "./types";

interface LayoutDimensions {
  fontFamily: string;
  bodyFontSizePt: number;
  lineHeight: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  sectionTitleSizePt: number;
  sectionSpacingMm: number;
  entrySpacingMm: number;
  bulletSpacingMm: number;
  bulletIndentMm: number;
}

const DEFAULT_DIMENSIONS: LayoutDimensions = {
  fontFamily: "Inter",
  bodyFontSizePt: 10,
  lineHeight: 1.4,
  marginTopMm: 15,
  marginBottomMm: 15,
  marginLeftMm: 15,
  marginRightMm: 15,
  sectionTitleSizePt: 12,
  sectionSpacingMm: 5,
  entrySpacingMm: 4,
  bulletSpacingMm: 2,
  bulletIndentMm: 5,
};

// Conversions
const MM_TO_PT = 2.83465;

// Approximate character width factors (relative to font size) for standard fonts
const CHAR_WIDTH_FACTORS: Record<string, number> = {
  serif: 0.38,
  "times new roman": 0.38,
  georgia: 0.4,
  sans: 0.41,
  inter: 0.41,
  roboto: 0.41,
  helvetica: 0.42,
  arial: 0.42,
  mono: 0.6,
  monospace: 0.6,
  default: 0.41,
};

function getCharWidthFactor(fontFamily: string): number {
  const normalized = fontFamily.toLowerCase();
  for (const key of Object.keys(CHAR_WIDTH_FACTORS)) {
    if (normalized.includes(key)) {
      return CHAR_WIDTH_FACTORS[key];
    }
  }
  return CHAR_WIDTH_FACTORS.default;
}

/**
 * Deterministically simulates the layout height of a resume on an A4 page (595 x 842 pt).
 */
export function simulateLayoutHeight(resume: ResumeData, dimensions: Partial<LayoutDimensions> = {}): {
  totalHeightPt: number;
  contentHeightPt: number;
  pageHeightPt: number;
  marginHeightPt: number;
  overflows: boolean;
  scaleFactor: number;
  recommendation: string;
} {
  const d = { ...DEFAULT_DIMENSIONS, ...dimensions };
  const pageHeightPt = 842;
  const pageWidthPt = 595;

  const topMarginPt = d.marginTopMm * MM_TO_PT;
  const bottomMarginPt = d.marginBottomMm * MM_TO_PT;
  const leftMarginPt = d.marginLeftMm * MM_TO_PT;
  const rightMarginPt = d.marginRightMm * MM_TO_PT;
  const marginHeightPt = topMarginPt + bottomMarginPt;
  const printableWidthPt = pageWidthPt - (leftMarginPt + rightMarginPt);
  const printableHeightPt = pageHeightPt - marginHeightPt;

  const charFactor = getCharWidthFactor(d.fontFamily);
  const avgCharWidthPt = d.bodyFontSizePt * charFactor;

  let currentY = 0;

  // 1. Header (Name, contact details)
  // Name
  currentY += d.bodyFontSizePt * 2.2; // roughly 22pt height for large name
  currentY += 6; // Spacing after name
  
  // Contact line
  const contactText = [resume.contact?.email, resume.contact?.phone, resume.contact?.location, resume.dateOfBirth].filter(Boolean).join("  |  ");
  const contactLines = Math.ceil((contactText.length * avgCharWidthPt) / printableWidthPt);
  currentY += contactLines * d.bodyFontSizePt * 1.2 + 8; // spacing

  // Helper to wrap text and add height
  const addTextHeight = (text: string, fontSize: number, spacingAfter: number = 0) => {
    const textWidthFactor = fontSize * charFactor;
    const charsPerLine = Math.floor(printableWidthPt / textWidthFactor);
    // Simple line wrap simulation based on word boundaries
    const words = text.split(/\s+/);
    let linesCount = 1;
    let currentLineLength = 0;
    for (const word of words) {
      if (currentLineLength + word.length + 1 > charsPerLine) {
        linesCount++;
        currentLineLength = word.length;
      } else {
        currentLineLength += word.length + 1;
      }
    }
    currentY += linesCount * fontSize * d.lineHeight + spacingAfter;
  };

  // Helper to add section title height
  const addSectionTitleHeight = () => {
    currentY += d.sectionSpacingMm * MM_TO_PT;
    currentY += d.sectionTitleSizePt * 1.3; // Section title text height
    currentY += 4; // spacing below title
  };

  // 2. Summary
  if (resume.summary) {
    addSectionTitleHeight();
    addTextHeight(resume.summary, d.bodyFontSizePt, 8);
  }

  // 3. Experience
  if (resume.experience && resume.experience.length > 0) {
    addSectionTitleHeight();
    for (const exp of resume.experience) {
      // Role Title & Company header line
      const headerText = `${exp.title} - ${exp.company} (${exp.startDate} - ${exp.endDate})`;
      addTextHeight(headerText, d.bodyFontSizePt, 4);

      // Bullets
      if (exp.bullets && exp.bullets.length > 0) {
        const bulletWidthPt = printableWidthPt - (d.bulletIndentMm * MM_TO_PT);
        for (const bullet of exp.bullets) {
          const bulletCharsPerLine = Math.floor(bulletWidthPt / avgCharWidthPt);
          const lines = Math.ceil(bullet.length / bulletCharsPerLine) || 1;
          currentY += lines * d.bodyFontSizePt * d.lineHeight + (d.bulletSpacingMm * MM_TO_PT);
        }
      }
      currentY += d.entrySpacingMm * MM_TO_PT;
    }
  }

  // 4. Skills
  if (resume.skills && resume.skills.length > 0) {
    addSectionTitleHeight();
    // Group skills by category
    const categories: Record<string, string[]> = {};
    for (const s of resume.skills) {
      const cat = s.category || "General";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(s.name);
    }

    for (const [cat, items] of Object.entries(categories)) {
      const skillLineText = `${cat}: ${items.join(", ")}`;
      addTextHeight(skillLineText, d.bodyFontSizePt, 3);
    }
  }

  // 5. Education
  if (resume.education && resume.education.length > 0) {
    addSectionTitleHeight();
    for (const edu of resume.education) {
      const eduText = `${edu.degree} in ${edu.field || ""} - ${edu.institution} (${edu.startDate} - ${edu.endDate})`;
      addTextHeight(eduText, d.bodyFontSizePt, 4);
      if (edu.highlights && edu.highlights.length > 0) {
        for (const h of edu.highlights) {
          addTextHeight(`• ${h}`, d.bodyFontSizePt, 2);
        }
      }
      currentY += d.entrySpacingMm * MM_TO_PT;
    }
  }

  // 6. Languages
  if (resume.languages && resume.languages.length > 0) {
    addSectionTitleHeight();
    const langText = resume.languages.map(l => `${l.name} (${l.proficiency})`).join(", ");
    addTextHeight(langText, d.bodyFontSizePt, 4);
  }

  // 7. Certifications
  if (resume.certifications && resume.certifications.length > 0) {
    addSectionTitleHeight();
    for (const cert of resume.certifications) {
      const certText = `${cert.name} - ${cert.issuer} (${cert.date || ""})`;
      addTextHeight(certText, d.bodyFontSizePt, 3);
    }
  }

  const contentHeightPt = currentY;
  const totalHeightPt = contentHeightPt + marginHeightPt;
  const overflows = totalHeightPt > pageHeightPt;

  // Recommend a scale factor to fit exactly 1 page
  const scaleFactor = Number((printableHeightPt / contentHeightPt).toFixed(2));

  let recommendation = "Layout is perfectly balanced for a single page.";
  if (overflows) {
    recommendation = `Reduce font size, line spacing, or margins to scale layout down to ${Math.round(scaleFactor * 100)}% to fit A4.`;
  } else if (totalHeightPt < 700) {
    recommendation = `Increase font size, line spacing, or margins to scale layout up to ${Math.round(scaleFactor * 100)}% to fill the page beautifully.`;
  }

  return {
    totalHeightPt,
    contentHeightPt,
    pageHeightPt,
    marginHeightPt,
    overflows,
    scaleFactor,
    recommendation,
  };
}
