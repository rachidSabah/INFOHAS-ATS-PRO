"use client";

import { forwardRef, useMemo } from "react";
import type { ResumeData, RenderDocument } from "@/lib/types";
import { useApp } from "@/lib/store";
import { RenderDocumentPreview } from "./RenderDocumentPreview";

interface A4PreviewProps {
  resume: ResumeData;
  scale?: number;
  className?: string;
  /**
   * When true, uses RenderDocument (SSOT) pipeline — same data as DOCX/PDF export.
   * When false (default), uses legacy per-template rendering.
   * Set true everywhere for consistent output across all renderers.
   */
  useRenderDocument?: boolean;
}

/**
 * Pixel-accurate A4 preview rendered as a div sized 210mm × 297mm.
 * Used in the Builder, Optimizer, and Downloads modules.
 * Real PDF export uses jsPDF — this is the visual representation.
 *
 * IMPORTANT — mobile responsiveness:
 * CSS `transform: scale()` only affects visual rendering, NOT the layout box.
 * So a 210mm (794px) wide A4 page scaled to 0.4 still occupies 794px of layout
 * space, causing horizontal overflow on mobile screens. To fix this, we wrap
 * the scaled A4 page in an outer container whose width matches the SCALED
 * width (210mm × scale) and whose height matches the SCALED height (297mm × scale).
 * The inner div is then scaled with transformOrigin: 'top left' so it fills
 * the wrapper exactly. This way the parent layout sees a correctly-sized box.
 */
export const A4Preview = forwardRef<HTMLDivElement, A4PreviewProps>(function A4Preview(
  { resume, scale = 1, className, useRenderDocument = false },
  ref
) {
  const accent = resume.accentColor || "#1154A3";
  const Template = TEMPLATE_MAP[resume.template] ?? ATSProfessionalTemplate;

  // Compute the scaled dimensions in mm so the wrapper occupies the correct
  // layout space (prevents horizontal overflow on mobile).
  const scaledWidthMm = 210 * scale;
  const scaledHeightMm = 297 * scale;

  // When useRenderDocument is true, convert to RenderDocument (SSOT) and render
  // from it — matching the exact same pipeline as DOCX/PDF export.
  if (useRenderDocument) {
    return <RenderDocumentA4Preview resume={resume} scale={scale} className={className} ref={ref} />;
  }

  return (
    <div
      // Outer wrapper — occupies the SCALED layout space so the parent
      // container sees a correctly-sized box (no horizontal overflow).
      style={{
        width: `${scaledWidthMm}mm`,
        height: `${scaledHeightMm}mm`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        ref={ref}
        className={`a4-page origin-top-left ${className ?? ""}`}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        <Template resume={resume} accent={accent} />
      </div>
    </div>
  );
});

/**
 * Inner A4Preview that converts ResumeData → RenderDocument and delegates
 * to RenderDocumentPreview. This uses the exact same data pipeline as
 * DOCX and PDF exports, guaranteeing consistent output.
 */
const RenderDocumentA4Preview = forwardRef<HTMLDivElement, A4PreviewProps>(function RenderDocumentA4Preview(
  { resume, scale, className },
  ref
) {
  const { toRenderDocument } = require("@/lib/render-document");
  const rd: RenderDocument = useMemo(() => toRenderDocument(resume), [resume]);
  return (
    <div ref={ref}>
      <RenderDocumentPreview rd={rd} scale={scale} className={className} />
    </div>
  );
});

const TEMPLATE_MAP: Record<string, React.FC<{ resume: ResumeData; accent: string }>> = {
  "ats-professional": ATSProfessionalTemplate,
  executive: ExecutiveTemplate,
  modern: ModernTemplate,
  corporate: ATSProfessionalTemplate,
  europass: ATSProfessionalTemplate,
  creative: ModernTemplate,
  minimal: ATSProfessionalTemplate,
  "infohas-pro": InfohasProTemplate,
  compact: CompactTemplate,
  tech: TechTemplate,
  academic: AcademicTemplate,
  consulting: ConsultingTemplate,
  startup: StartupTemplate,
  classic: ClassicTemplate,
};

// ---- InfoHAS Pro template ----
// Matches the OUSSAMA EL FATIMI reference PDF exactly:
//   - Times New Roman throughout
//   - Top-left header: NAME in dark maroon (#660033), then headline + contact lines + DOB
//   - Blue rule (#0563C1) under header text
//   - Top-right: portrait photo frame ~54×81mm (2:3 ratio)
//   - Body: single column; PROFESSIONAL SUMMARY wraps left of the photo frame
//   - Section headers: UPPERCASE, blue, bold, with blue underline
//   - Sections in order: Summary → Core Competencies & Skills → Experience → Education → Languages
function InfohasProTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  const config = useApp((s) => s.optimizerDirective);

  const L = {
    fontFamily: config?.fontFamily || "'Times New Roman', 'Georgia', 'Cambria', serif",
    bodyFontSizePt: config?.bodyFontSizePt ?? 10.5,
    lineHeight: config?.lineHeight ?? 1.2,
    marginTopMm: config?.marginTopMm ?? 6.35,
    marginBottomMm: config?.marginBottomMm ?? 6.35,
    marginLeftMm: config?.marginLeftMm ?? 8.89,
    marginRightMm: config?.marginRightMm ?? 8.89,
    nameSizePt: config?.nameSizePt ?? 14,
    sectionTitleSizePt: config?.sectionTitleSizePt ?? 12,
    nameColor: config?.nameColor || "#8B0000",
    sectionTitleColor: config?.sectionTitleColor || "#8B0000",
    bodyTextColor: config?.bodyTextColor || "#000000",
    sectionGapMm: config?.sectionGapMm ?? 3,
    bulletIndentMm: config?.bulletIndentMm ?? 6.4,
  };

  const BLACK = L.bodyTextColor;

  return (
    <div
      className="relative"
      style={{
        fontFamily: L.fontFamily,
        fontSize: `${L.bodyFontSizePt}pt`,
        lineHeight: L.lineHeight,
        padding: `${L.marginTopMm}mm ${L.marginRightMm}mm ${L.marginBottomMm}mm ${L.marginLeftMm}mm`,
        minHeight: "297mm",
        color: BLACK,
      }}
    >
      {/* ============ HEADER ============ */}
      <header className="relative" style={{ paddingRight: resume.photoUrl ? "36mm" : 0, minHeight: resume.photoUrl ? "42mm" : "auto" }}>
        {/* Photo — top-right, 30x40mm. Only render if photoUrl exists (no placeholder per master layout). */}
        {resume.photoUrl && (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: "30mm",
              height: "40mm",
              border: "0.5pt solid #999",
              background: "transparent",
              overflow: "hidden",
              boxSizing: "border-box",
            }}
          >
            <img
              src={resume.photoUrl}
              alt={resume.name}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
            />
          </div>
        )}

        {/* Name — bold, uppercase */}
        <div
          style={{
            color: L.nameColor,
            fontWeight: 700,
            fontSize: `${L.nameSizePt}pt`,
            letterSpacing: "0.3pt",
            marginBottom: "0.5mm",
            lineHeight: 1.1,
            textTransform: "uppercase",
          }}
        >
          {(resume.name || "YOUR NAME").toUpperCase()}
        </div>

        {/* Headline */}
        {resume.headline && (
          <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
            {resume.headline}
          </div>
        )}

        {/* Contact lines */}
        <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
          {[resume.contact.location, resume.contact.phone].filter(Boolean).join(" | ")}
        </div>
        {resume.contact.email && (
          <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
            {resume.contact.email}
          </div>
        )}
        {resume.dateOfBirth && (
          <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
            Date Of Birth : {resume.dateOfBirth}
          </div>
        )}
      </header>

      {/* ============ BODY ============ */}
      <div style={{ marginTop: "3mm" }}>
        {/* PROFESSIONAL PROFILE (matching target format) */}
        {resume.summary && (
          <InfohasSection title="PROFESSIONAL PROFILE" titleColor={L.sectionTitleColor} titleSize={`${L.sectionTitleSizePt}pt`} gap={`${L.sectionGapMm}mm`}>
            <p style={{ margin: 0, textAlign: "justify", color: BLACK }}>{resume.summary}</p>
          </InfohasSection>
        )}

        {/* PROFESSIONAL EXPERIENCE */}
        {resume.experience.length > 0 && (
          <InfohasSection title="PROFESSIONAL EXPERIENCE" titleColor={L.sectionTitleColor} titleSize={`${L.sectionTitleSizePt}pt`} gap={`${L.sectionGapMm}mm`}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2mm" }}>
              {resume.experience.map((e) => (
                <div key={e.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5mm", gap: "2mm" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: BLACK }}>{e.title}</span>{" "}
                      <span style={{ color: BLACK }}>{e.company}</span>
                      {e.location && <span style={{ color: BLACK }}> | {e.location}</span>}
                    </div>
                    <span style={{ color: BLACK, whiteSpace: "nowrap", flexShrink: 0 }}>{fmtDateInfohas(e.startDate)} – {fmtDateInfohas(e.endDate)}</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•" }}>
                    {e.bullets.map((b, i) => (
                      <li key={i} style={{ marginBottom: "0.5mm", color: BLACK, textAlign: "justify" }}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </InfohasSection>
        )}

        {/* EDUCATION */}
        {resume.education.length > 0 && (
          <InfohasSection title="EDUCATION" titleColor={L.sectionTitleColor} titleSize={`${L.sectionTitleSizePt}pt`} gap={`${L.sectionGapMm}mm`}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5mm" }}>
              {resume.education.map((ed) => (
                <div key={ed.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5mm", gap: "2mm" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: BLACK }}>{ed.degree}</span>
                      {ed.institution && <span style={{ color: BLACK }}> | {ed.institution}</span>}
                      {ed.location && <span style={{ color: BLACK }}> | {ed.location}</span>}
                    </div>
                    {(ed.startDate || ed.endDate) && (
                      <span style={{ color: BLACK, whiteSpace: "nowrap", flexShrink: 0 }}>
                        {fmtDateInfohas(ed.startDate)} – {fmtDateInfohas(ed.endDate)}
                      </span>
                    )}
                  </div>
                  {ed.highlights && ed.highlights.length > 0 && (
                    <ul style={{ margin: "0.5mm 0 0 0", paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•" }}>
                      {ed.highlights.map((h, i) => (
                        <li key={i} style={{ color: BLACK }}>{h}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </InfohasSection>
        )}

        {/* KEY COMPETENCIES (moved after Education to match target format) */}
        {resume.skills.length > 0 && (
          <InfohasSection title="KEY COMPETENCIES" titleColor={L.sectionTitleColor} titleSize={`${L.sectionTitleSizePt}pt`} gap={`${L.sectionGapMm}mm`}>
            <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•" }}>
              {groupSkillsByCategory(resume.skills).map((g, i) => (
                <li key={i} style={{ marginBottom: "1mm", color: BLACK }}>
                  <span style={{ fontWeight: 700 }}>{g.category}:</span>{" "}
                  <span>{g.items.join(", ")}.</span>
                </li>
              ))}
            </ul>
          </InfohasSection>
        )}

        {/* LANGUAGES */}
        {resume.languages.length > 0 && (
          <InfohasSection title="LANGUAGES" titleColor={L.sectionTitleColor} titleSize={`${L.sectionTitleSizePt}pt`} gap={`${L.sectionGapMm}mm`}>
            <div style={{ color: BLACK }}>
              • {resume.languages.map((l) => l.name).join(", ")}
            </div>
          </InfohasSection>
        )}

        {/* DYNAMIC SECTIONS */}
        {(resume.dynamicSections || []).map((ds) => (
          <InfohasSection key={ds.id} title={ds.title} titleColor={L.sectionTitleColor} titleSize={`${L.sectionTitleSizePt}pt`} gap={`${L.sectionGapMm}mm`}>
            <div style={{ color: BLACK }}>
              {ds.content && <p style={{ margin: "0 0 1mm 0", textAlign: "justify" }}>{ds.content}</p>}
              {ds.bullets && ds.bullets.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•" }}>
                  {ds.bullets.map((b, i) => (
                    <li key={i} style={{ marginBottom: "0.5mm", textAlign: "justify" }}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          </InfohasSection>
        ))}

        {/* ADDITIONAL INFORMATION */}
        {resume.additionalInfo && (
          <InfohasSection title="ADDITIONAL INFORMATION" titleColor={L.sectionTitleColor} titleSize={`${L.sectionTitleSizePt}pt`} gap={`${L.sectionGapMm}mm`}>
            <div style={{ color: BLACK, whiteSpace: "pre-wrap", textAlign: "justify" }}>
              {resume.additionalInfo}
            </div>
          </InfohasSection>
        )}
      </div>
    </div>
  );
}

/** Infohas section header - per master layout:
 * 12pt BOLD UPPERCASE configured color, no underline, compact spacing. */
function InfohasSection({
  title,
  titleColor,
  titleSize,
  gap,
  children,
}: {
  title: string;
  titleColor: string;
  titleSize: string;
  gap: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: gap }}>
      <h2
        style={{
          color: titleColor,
          fontWeight: 700,
          fontSize: titleSize,
          letterSpacing: "0.3pt",
          margin: "0 0 1mm 0",
          paddingBottom: 0,
          borderBottom: "none",
          textTransform: "uppercase",
          lineHeight: 1.2,
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: "inherit", lineHeight: "inherit" }}>{children}</div>
    </section>
  );
}

function groupSkillsByCategory(skills: ResumeData["skills"]): { category: string; items: string[] }[] {
  const map = new Map<string, string[]>();
  for (const s of skills) {
    const cat = s.category || "General";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(s.name);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

function fmtDateInfohas(d?: string): string {
  if (!d) return "";
  if (/present/i.test(d)) return "Present";
  // "2024-05" → "May 2024"
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(m[2]) - 1] ?? m[2]} ${m[1]}`;
  }
  // "2024" alone
  if (/^\d{4}$/.test(d)) return d;
  return d;
}

function fmtDate(d?: string) {
  if (!d) return "";
  if (/present/i.test(d)) return "Present";
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(m[2]) - 1] ?? m[2]} ${m[1]}`;
  }
  return d;
}

function ATSProfessionalTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="p-[14mm] text-[10pt] leading-snug text-slate-800" style={{ fontFamily: "'Inter', 'Helvetica', sans-serif" }}>
      <header className="mb-3">
        <h1 className="text-[22pt] font-bold text-slate-900 leading-tight">{resume.name}</h1>
        {resume.headline && <div className="text-[11pt] mt-0.5" style={{ color: accent }}>{resume.headline}</div>}
        <div className="text-[8.5pt] text-slate-500 mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
          {resume.contact.email && <span>{resume.contact.email}</span>}
          {resume.contact.phone && <span>• {resume.contact.phone}</span>}
          {resume.contact.location && <span>• {resume.contact.location}</span>}
          {resume.contact.linkedin && <span>• {resume.contact.linkedin}</span>}
          {resume.contact.github && <span>• {resume.contact.github}</span>}
          {resume.contact.website && <span>• {resume.contact.website}</span>}
        </div>
        <div className="mt-2 h-px" style={{ background: accent }} />
      </header>

      {resume.summary && (
        <Section title="PROFESSIONAL SUMMARY" accent={accent}>
          <p className="text-[9.5pt] text-slate-700">{resume.summary}</p>
        </Section>
      )}

      {resume.experience.length > 0 && (
        <Section title="PROFESSIONAL EXPERIENCE" accent={accent}>
          <div className="space-y-2">
            {resume.experience.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-semibold text-[10pt] text-slate-900 flex-1 min-w-0">
                    {e.title}{e.company && <span className="font-normal text-slate-700"> — {e.company}</span>}
                  </div>
                  <div className="text-[8.5pt] text-slate-500 italic shrink-0 whitespace-nowrap">{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {e.bullets.map((b, i) => (
                    <li key={i} className="text-[9.5pt] text-slate-700 pl-3 relative">
                      <span className="absolute left-0 top-2 w-1 h-1 rounded-full" style={{ background: accent }} />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {resume.education.length > 0 && (
        <Section title="EDUCATION" accent={accent}>
          <div className="space-y-1.5">
            {resume.education.map((ed) => (
              <div key={ed.id} className="flex justify-between items-baseline gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[10pt] text-slate-900 truncate">
                    {ed.degree}{ed.field && <span className="font-normal text-slate-700"> in {ed.field}</span>}
                  </div>
                  <div className="text-[9pt] text-slate-600 truncate">{ed.institution}</div>
                </div>
                <div className="text-[8.5pt] text-slate-500 italic shrink-0 whitespace-nowrap">{fmtDate(ed.startDate)} – {fmtDate(ed.endDate)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {resume.skills.length > 0 && (
        <Section title="SKILLS" accent={accent}>
          <div className="text-[9.5pt] text-slate-700 flex flex-wrap gap-x-2 gap-y-1">
            {resume.skills.map((s, i) => (
              <span key={s.id}>
                {s.name}{i < resume.skills.length - 1 && <span className="text-slate-400"> •</span>}
              </span>
            ))}
          </div>
        </Section>
      )}

      {resume.projects.length > 0 && (
        <Section title="PROJECTS" accent={accent}>
          <div className="space-y-1">
            {resume.projects.slice(0, 2).map((p) => (
              <div key={p.id}>
                <div className="font-semibold text-[10pt] text-slate-900">{p.name}</div>
                {p.description && <div className="text-[9pt] text-slate-600">{p.description}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {resume.certifications.length > 0 && (
        <Section title="CERTIFICATIONS" accent={accent}>
          <ul className="space-y-0.5">
            {resume.certifications.slice(0, 4).map((c) => (
              <li key={c.id} className="text-[9.5pt] text-slate-700 pl-3 relative">
                <span className="absolute left-0 top-2 w-1 h-1 rounded-full" style={{ background: accent }} />
                {c.name}{c.issuer && <span className="text-slate-500"> — {c.issuer}</span>}{c.date && <span className="text-slate-500"> ({fmtDate(c.date)})</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ExecutiveTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="p-[16mm] text-[10.5pt] leading-snug text-slate-800" style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}>
      <header className="text-center mb-4">
        <h1 className="text-[26pt] font-bold text-slate-900 tracking-wide uppercase">{resume.name}</h1>
        {resume.headline && <div className="text-[11pt] mt-1 italic" style={{ color: accent }}>{resume.headline}</div>}
        <div className="text-[9pt] text-slate-600 mt-2 flex flex-wrap justify-center gap-x-2 gap-y-0.5">
          {resume.contact.email && <span>{resume.contact.email}</span>}
          {resume.contact.phone && <span>• {resume.contact.phone}</span>}
          {resume.contact.location && <span>• {resume.contact.location}</span>}
        </div>
        <div className="mt-2 h-0.5" style={{ background: accent }} />
      </header>

      {resume.summary && (
        <Section title="SUMMARY" accent={accent} center>
          <p className="text-[10pt] text-slate-700 text-center italic">{resume.summary}</p>
        </Section>
      )}

      {resume.experience.length > 0 && (
        <Section title="PROFESSIONAL EXPERIENCE" accent={accent} center>
          <div className="space-y-3 mt-2">
            {resume.experience.map((e) => (
              <div key={e.id} className="text-center">
                <div className="font-bold text-[11pt] text-slate-900">{e.company}</div>
                <div className="text-[10pt] italic" style={{ color: accent }}>{e.title} · {fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
                <ul className="mt-1 space-y-0.5 text-left max-w-prose mx-auto">
                  {e.bullets.map((b, i) => (
                    <li key={i} className="text-[9.5pt] text-slate-700">• {b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {resume.skills.length > 0 && (
        <Section title="SKILLS" accent={accent} center>
          <div className="text-center text-[10pt] text-slate-700">{resume.skills.map((s) => s.name).join(" · ")}</div>
        </Section>
      )}
    </div>
  );
}

function ModernTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="flex text-[10pt] leading-snug text-slate-800" style={{ fontFamily: "'Inter', sans-serif", minHeight: "297mm" }}>
      {/* Sidebar */}
      <aside className="w-[35%] p-[10mm] text-white" style={{ background: accent }}>
        <h1 className="text-[20pt] font-bold leading-tight">{resume.name}</h1>
        {resume.headline && <div className="text-[10pt] opacity-90 mt-1">{resume.headline}</div>}

        <div className="mt-6">
          <div className="text-[9pt] uppercase tracking-wider opacity-70 font-semibold mb-2">Contact</div>
          <div className="space-y-1 text-[9pt]">
            {resume.contact.email && <div className="flex items-start gap-1.5"><span className="opacity-70">✉</span><span className="break-all">{resume.contact.email}</span></div>}
            {resume.contact.phone && <div className="flex items-start gap-1.5"><span className="opacity-70">☎</span>{resume.contact.phone}</div>}
            {resume.contact.location && <div className="flex items-start gap-1.5"><span className="opacity-70">⌖</span>{resume.contact.location}</div>}
            {resume.contact.linkedin && <div className="flex items-start gap-1.5"><span className="opacity-70">in</span>{resume.contact.linkedin}</div>}
            {resume.contact.github && <div className="flex items-start gap-1.5"><span className="opacity-70">⚙</span>{resume.contact.github}</div>}
          </div>
        </div>

        {resume.skills.length > 0 && (
          <div className="mt-6">
            <div className="text-[9pt] uppercase tracking-wider opacity-70 font-semibold mb-2">Skills</div>
            <div className="flex flex-wrap gap-1">
              {resume.skills.map((s) => (
                <span key={s.id} className="text-[8.5pt] px-1.5 py-0.5 rounded bg-white/15">{s.name}</span>
              ))}
            </div>
          </div>
        )}

        {resume.languages.length > 0 && (
          <div className="mt-6">
            <div className="text-[9pt] uppercase tracking-wider opacity-70 font-semibold mb-2">Languages</div>
            <div className="space-y-0.5 text-[9pt]">
              {resume.languages.map((l) => (
                <div key={l.id} className="flex justify-between"><span>{l.name}</span><span className="opacity-70 capitalize">{l.proficiency}</span></div>
              ))}
            </div>
          </div>
        )}

        {resume.certifications.length > 0 && (
          <div className="mt-6">
            <div className="text-[9pt] uppercase tracking-wider opacity-70 font-semibold mb-2">Certifications</div>
            <div className="space-y-1 text-[8.5pt]">
              {resume.certifications.slice(0, 4).map((c) => (
                <div key={c.id}>
                  <div className="font-semibold">{c.name}</div>
                  {c.issuer && <div className="opacity-70">{c.issuer}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 p-[10mm]">
        {resume.summary && (
          <ModernSection title="Profile" accent={accent}>
            <p className="text-[9.5pt] text-slate-700">{resume.summary}</p>
          </ModernSection>
        )}

        {resume.experience.length > 0 && (
          <ModernSection title="Experience" accent={accent}>
            <div className="space-y-3">
              {resume.experience.map((e) => (
                <div key={e.id}>
                  <div className="flex justify-between items-baseline gap-2">
                    <div className="font-bold text-[10.5pt] text-slate-900 flex-1 min-w-0">{e.title}</div>
                    <div className="text-[8.5pt] text-slate-500 shrink-0 whitespace-nowrap">{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
                  </div>
                  <div className="text-[9.5pt] font-medium" style={{ color: accent }}>{e.company}</div>
                  <ul className="mt-1 space-y-0.5">
                    {e.bullets.map((b, i) => (
                      <li key={i} className="text-[9.5pt] text-slate-700 pl-3 relative">
                        <span className="absolute left-0 top-2 w-1 h-1 rounded-full" style={{ background: accent }} />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </ModernSection>
        )}

        {resume.education.length > 0 && (
          <ModernSection title="Education" accent={accent}>
            <div className="space-y-1.5">
              {resume.education.map((ed) => (
                <div key={ed.id}>
                  <div className="font-bold text-[10pt] text-slate-900">{ed.degree}{ed.field && ` in ${ed.field}`}</div>
                  <div className="text-[9pt] text-slate-600">{ed.institution} · {fmtDate(ed.startDate)} – {fmtDate(ed.endDate)}</div>
                </div>
              ))}
            </div>
          </ModernSection>
        )}

        {resume.projects.length > 0 && (
          <ModernSection title="Projects" accent={accent}>
            <div className="space-y-1.5">
              {resume.projects.slice(0, 3).map((p) => (
                <div key={p.id}>
                  <div className="font-bold text-[10pt] text-slate-900">{p.name}</div>
                  {p.description && <div className="text-[9pt] text-slate-600">{p.description}</div>}
                </div>
              ))}
            </div>
          </ModernSection>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// 6 NEW TEMPLATES (added 2026-06-19)
// ============================================================================

// ---- Compact template ----
// Tight 9.5pt layout for maximum content per page. Ideal for experienced
// candidates who need to fit 5+ roles on a single A4 page without cutting content.
function CompactTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="p-[10mm] text-[9.5pt] leading-[1.3] text-slate-800" style={{ fontFamily: "'Inter', 'Helvetica', sans-serif" }}>
      <header className="mb-2 pb-2 border-b-2" style={{ borderColor: accent }}>
        <h1 className="text-[18pt] font-bold text-slate-900 leading-tight">{resume.name}</h1>
        {resume.headline && <div className="text-[10pt] mt-0.5" style={{ color: accent }}>{resume.headline}</div>}
        <div className="text-[8.5pt] text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          {resume.contact.email && <span>{resume.contact.email}</span>}
          {resume.contact.phone && <span>• {resume.contact.phone}</span>}
          {resume.contact.location && <span>• {resume.contact.location}</span>}
          {resume.contact.linkedin && <span>• {resume.contact.linkedin}</span>}
          {resume.contact.github && <span>• {resume.contact.github}</span>}
        </div>
      </header>

      {resume.summary && (
        <section className="mb-2">
          <h2 className="text-[9.5pt] font-bold uppercase tracking-wider mb-0.5" style={{ color: accent }}>Summary</h2>
          <p className="text-[9pt] text-slate-700 text-justify">{resume.summary}</p>
        </section>
      )}

      {resume.experience.length > 0 && (
        <section className="mb-2">
          <h2 className="text-[9.5pt] font-bold uppercase tracking-wider mb-1" style={{ color: accent }}>Experience</h2>
          <div className="space-y-1.5">
            {resume.experience.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-semibold text-[9.5pt] text-slate-900 flex-1 min-w-0">
                    {e.title}{e.company && <span className="font-normal text-slate-600"> · {e.company}</span>}
                  </div>
                  <div className="text-[8pt] text-slate-500 shrink-0 whitespace-nowrap">{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
                </div>
                <ul className="mt-0.5 space-y-0">
                  {e.bullets.map((b, i) => (
                    <li key={i} className="text-[9pt] text-slate-700 pl-3 text-justify">• {b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        {resume.education.length > 0 && (
          <section>
            <h2 className="text-[9.5pt] font-bold uppercase tracking-wider mb-1" style={{ color: accent }}>Education</h2>
            <div className="space-y-0.5">
              {resume.education.map((ed) => (
                <div key={ed.id} className="text-[8.5pt]">
                  <div className="font-semibold text-slate-900">{ed.degree}{ed.field && ` in ${ed.field}`}</div>
                  <div className="text-slate-600">{ed.institution} · {fmtDate(ed.startDate)} – {fmtDate(ed.endDate)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {resume.skills.length > 0 && (
          <section>
            <h2 className="text-[9.5pt] font-bold uppercase tracking-wider mb-1" style={{ color: accent }}>Skills</h2>
            <div className="text-[8.5pt] text-slate-700">{resume.skills.map((s) => s.name).join(" · ")}</div>
          </section>
        )}
      </div>

      {resume.languages.length > 0 && (
        <section className="mt-2">
          <h2 className="text-[9.5pt] font-bold uppercase tracking-wider mb-0.5" style={{ color: accent }}>Languages</h2>
          <div className="text-[8.5pt] text-slate-700">{resume.languages.map((l) => `${l.name}: ${l.proficiency}`).join(" · ")}</div>
        </section>
      )}
    </div>
  );
}

// ---- Tech / Engineering template ----
// Monospace accents for job titles/dates, skills in a grid, GitHub-friendly aesthetic.
function TechTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="p-[12mm] text-[10pt] leading-snug text-slate-800" style={{ fontFamily: "'Inter', 'Helvetica', sans-serif" }}>
      <header className="mb-3 pb-2 border-b" style={{ borderColor: `${accent}44` }}>
        <h1 className="text-[22pt] font-bold text-slate-900 leading-tight" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', 'Courier New', monospace" }}>{resume.name}</h1>
        {resume.headline && <div className="text-[11pt] mt-0.5 font-medium" style={{ color: accent }}>{resume.headline}</div>}
        <div className="text-[9pt] text-slate-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', 'Courier New', monospace" }}>
          {resume.contact.email && <span>{resume.contact.email}</span>}
          {resume.contact.phone && <span>• {resume.contact.phone}</span>}
          {resume.contact.location && <span>• {resume.contact.location}</span>}
          {resume.contact.github && <span>• github.com/{resume.contact.github?.replace(/^.*\//, "")}</span>}
          {resume.contact.website && <span>• {resume.contact.website}</span>}
        </div>
      </header>

      {resume.summary && (
        <section className="mb-3">
          <h2 className="text-[10pt] font-bold uppercase tracking-wider mb-1" style={{ color: accent }}>{"// Profile"}</h2>
          <p className="text-[9.5pt] text-slate-700 text-justify">{resume.summary}</p>
        </section>
      )}

      {resume.skills.length > 0 && (
        <section className="mb-3">
          <h2 className="text-[10pt] font-bold uppercase tracking-wider mb-1" style={{ color: accent }}>{"// Tech Stack"}</h2>
          <div className="grid grid-cols-3 gap-1.5 text-[9pt]">
            {resume.skills.map((s) => (
              <div key={s.id} className="px-2 py-1 rounded border" style={{ borderColor: `${accent}33`, background: `${accent}08` }}>
                <span className="font-medium text-slate-800">{s.name}</span>
                {s.category && <span className="text-[8pt] text-slate-500 block">{s.category}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {resume.experience.length > 0 && (
        <section className="mb-3">
          <h2 className="text-[10pt] font-bold uppercase tracking-wider mb-1" style={{ color: accent }}>{"// Experience"}</h2>
          <div className="space-y-2.5">
            {resume.experience.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-bold text-[10.5pt] text-slate-900 flex-1 min-w-0">{e.title}</div>
                  <div className="text-[8.5pt] text-slate-500 shrink-0 whitespace-nowrap" style={{ fontFamily: "'Geist Mono', monospace" }}>{fmtDate(e.startDate)} → {fmtDate(e.endDate)}</div>
                </div>
                <div className="text-[9.5pt] font-medium mb-0.5" style={{ color: accent }}>{e.company}{e.location && ` · ${e.location}`}</div>
                <ul className="space-y-0.5">
                  {e.bullets.map((b, i) => (
                    <li key={i} className="text-[9.5pt] text-slate-700 pl-4 relative text-justify">
                      <span className="absolute left-0 text-slate-400" style={{ fontFamily: "monospace" }}>-</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        {resume.education.length > 0 && (
          <section>
            <h2 className="text-[10pt] font-bold uppercase tracking-wider mb-1" style={{ color: accent }}>{"// Education"}</h2>
            <div className="space-y-0.5">
              {resume.education.map((ed) => (
                <div key={ed.id} className="text-[9pt]">
                  <div className="font-semibold text-slate-900">{ed.degree}{ed.field && ` in ${ed.field}`}</div>
                  <div className="text-slate-600">{ed.institution}</div>
                  <div className="text-[8pt] text-slate-500" style={{ fontFamily: "monospace" }}>{fmtDate(ed.startDate)} → {fmtDate(ed.endDate)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {resume.projects.length > 0 && (
          <section>
            <h2 className="text-[10pt] font-bold uppercase tracking-wider mb-1" style={{ color: accent }}>{"// Projects"}</h2>
            <div className="space-y-0.5">
              {resume.projects.slice(0, 3).map((p) => (
                <div key={p.id} className="text-[9pt]">
                  <div className="font-semibold text-slate-900">{p.name}</div>
                  {p.description && <div className="text-slate-600 text-[8.5pt]">{p.description}</div>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---- Academic template ----
// CV-style with publications, research interests, teaching experience.
// Uses Garamond serif, numbered citations, formal academic tone.
function AcademicTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="p-[16mm] text-[10.5pt] leading-[1.35] text-slate-800" style={{ fontFamily: "'Garamond', 'Georgia', 'Times New Roman', serif" }}>
      <header className="text-center mb-4">
        <h1 className="text-[24pt] font-bold text-slate-900 tracking-wide">{resume.name}</h1>
        {resume.headline && <div className="text-[12pt] mt-1 italic" style={{ color: accent }}>{resume.headline}</div>}
        <div className="text-[10pt] text-slate-600 mt-1.5">
          {resume.contact.email && <span>{resume.contact.email}</span>}
          {resume.contact.location && <span> · {resume.contact.location}</span>}
          {resume.contact.phone && <span> · {resume.contact.phone}</span>}
        </div>
        {resume.contact.website && <div className="text-[10pt] mt-0.5" style={{ color: accent }}>{resume.contact.website}</div>}
        <div className="mt-2 h-px" style={{ background: `${accent}66` }} />
      </header>

      {resume.summary && (
        <section className="mb-3">
          <h2 className="text-[11pt] font-bold uppercase tracking-wide mb-1 pb-0.5 border-b" style={{ color: accent, borderColor: `${accent}44` }}>Research Interests</h2>
          <p className="text-[10pt] text-slate-700 text-justify">{resume.summary}</p>
        </section>
      )}

      {resume.experience.length > 0 && (
        <section className="mb-3">
          <h2 className="text-[11pt] font-bold uppercase tracking-wide mb-1 pb-0.5 border-b" style={{ color: accent, borderColor: `${accent}44` }}>Academic Appointments</h2>
          <div className="space-y-2">
            {resume.experience.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-bold text-[10.5pt] text-slate-900 flex-1 min-w-0">{e.title}, <span className="italic">{e.company}</span></div>
                  <div className="text-[9.5pt] text-slate-600 shrink-0 whitespace-nowrap">{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
                </div>
                {e.location && <div className="text-[9.5pt] text-slate-600 italic">{e.location}</div>}
                <ul className="mt-0.5 space-y-0">
                  {e.bullets.map((b, i) => (
                    <li key={i} className="text-[9.5pt] text-slate-700 pl-4 text-justify">• {b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {resume.education.length > 0 && (
        <section className="mb-3">
          <h2 className="text-[11pt] font-bold uppercase tracking-wide mb-1 pb-0.5 border-b" style={{ color: accent, borderColor: `${accent}44` }}>Education</h2>
          <div className="space-y-1">
            {resume.education.map((ed) => (
              <div key={ed.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-bold text-[10.5pt] text-slate-900 flex-1 min-w-0">{ed.degree}{ed.field && ` in ${ed.field}`}, <span className="italic">{ed.institution}</span></div>
                  <div className="text-[9.5pt] text-slate-600 shrink-0 whitespace-nowrap">{fmtDate(ed.startDate)} – {fmtDate(ed.endDate)}</div>
                </div>
                {ed.highlights && ed.highlights.length > 0 && (
                  <div className="text-[9.5pt] text-slate-600 italic mt-0.5">{ed.highlights.join("; ")}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {resume.projects.length > 0 && (
        <section className="mb-3">
          <h2 className="text-[11pt] font-bold uppercase tracking-wide mb-1 pb-0.5 border-b" style={{ color: accent, borderColor: `${accent}44` }}>Selected Publications</h2>
          <div className="space-y-1">
            {resume.projects.map((p, i) => (
              <div key={p.id} className="text-[9.5pt] text-slate-700 text-justify">
                <span className="font-bold">[{i + 1}]</span> {p.name}{p.description && `. ${p.description}`}
              </div>
            ))}
          </div>
        </section>
      )}

      {resume.skills.length > 0 && (
        <section className="mb-3">
          <h2 className="text-[11pt] font-bold uppercase tracking-wide mb-1 pb-0.5 border-b" style={{ color: accent, borderColor: `${accent}44` }}>Skills & Methods</h2>
          <div className="text-[9.5pt] text-slate-700 text-justify">{resume.skills.map((s) => s.name).join(" · ")}</div>
        </section>
      )}

      {resume.languages.length > 0 && (
        <section>
          <h2 className="text-[11pt] font-bold uppercase tracking-wide mb-1 pb-0.5 border-b" style={{ color: accent, borderColor: `${accent}44` }}>Languages</h2>
          <div className="text-[9.5pt] text-slate-700">{resume.languages.map((l) => `${l.name} (${l.proficiency})`).join(" · ")}</div>
        </section>
      )}
    </div>
  );
}

// ---- Consulting template ----
// Case-style bullets, impact-first framing, top-tier firm aesthetic (McKinsey/BCG/Bain).
// Clean sans-serif, strong horizontal rules, quantified achievements front and center.
function ConsultingTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="p-[14mm] text-[10pt] leading-snug text-slate-800" style={{ fontFamily: "'Inter', 'Helvetica', sans-serif" }}>
      <header className="mb-4 pb-3" style={{ borderBottom: `2.5pt solid ${accent}` }}>
        <h1 className="text-[24pt] font-bold text-slate-900 leading-tight uppercase tracking-tight">{resume.name}</h1>
        {resume.headline && <div className="text-[12pt] mt-1 font-medium text-slate-700">{resume.headline}</div>}
        <div className="text-[9pt] text-slate-600 mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
          {resume.contact.email && <span>{resume.contact.email}</span>}
          {resume.contact.phone && <span>• {resume.contact.phone}</span>}
          {resume.contact.location && <span>• {resume.contact.location}</span>}
          {resume.contact.linkedin && <span>• {resume.contact.linkedin}</span>}
        </div>
      </header>

      {resume.summary && (
        <section className="mb-4">
          <p className="text-[10pt] text-slate-700 text-justify leading-relaxed">{resume.summary}</p>
        </section>
      )}

      {resume.experience.length > 0 && (
        <section className="mb-4">
          <h2 className="text-[11pt] font-bold uppercase tracking-wider mb-2 pb-1 border-b border-slate-300" style={{ color: accent }}>Professional Experience</h2>
          <div className="space-y-3">
            {resume.experience.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-bold text-[11pt] text-slate-900 flex-1 min-w-0">{e.title}</div>
                  <div className="text-[9pt] text-slate-500 font-medium shrink-0 whitespace-nowrap">{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
                </div>
                <div className="text-[10pt] font-medium mb-1" style={{ color: accent }}>{e.company}{e.location && ` | ${e.location}`}</div>
                <ul className="space-y-1">
                  {e.bullets.map((b, i) => (
                    <li key={i} className="text-[9.5pt] text-slate-700 pl-5 relative text-justify">
                      <span className="absolute left-0 font-bold" style={{ color: accent }}>▸</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4">
        {resume.education.length > 0 && (
          <section>
            <h2 className="text-[11pt] font-bold uppercase tracking-wider mb-2 pb-1 border-b border-slate-300" style={{ color: accent }}>Education</h2>
            <div className="space-y-1">
              {resume.education.map((ed) => (
                <div key={ed.id}>
                  <div className="font-bold text-[10pt] text-slate-900">{ed.degree}{ed.field && ` in ${ed.field}`}</div>
                  <div className="text-[9pt] text-slate-600">{ed.institution}</div>
                  <div className="text-[8.5pt] text-slate-500">{fmtDate(ed.startDate)} – {fmtDate(ed.endDate)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {resume.skills.length > 0 && (
          <section>
            <h2 className="text-[11pt] font-bold uppercase tracking-wider mb-2 pb-1 border-b border-slate-300" style={{ color: accent }}>Core Skills</h2>
            <div className="space-y-0.5 text-[9pt] text-slate-700">
              {groupSkillsByCategory(resume.skills).map((g, i) => (
                <div key={i}>
                  <span className="font-semibold">{g.category}:</span> {g.items.join(", ")}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {resume.certifications.length > 0 && (
        <section className="mt-4">
          <h2 className="text-[11pt] font-bold uppercase tracking-wider mb-2 pb-1 border-b border-slate-300" style={{ color: accent }}>Certifications</h2>
          <div className="text-[9pt] text-slate-700">{resume.certifications.map((c) => `${c.name}${c.issuer ? ` (${c.issuer})` : ""}`).join(" · ")}</div>
        </section>
      )}
    </div>
  );
}

// ---- Startup template ----
// Bold sans-serif, growth-metric callouts, entrepreneurial energy. Ideal for
// founders, growth roles, and startup-adjacent positions. Uses accent color blocks.
function StartupTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="text-[10pt] leading-snug text-slate-800" style={{ fontFamily: "'Inter', 'Helvetica', sans-serif" }}>
      {/* Bold colored header block */}
      <header className="px-[12mm] py-[8mm] text-white" style={{ background: accent }}>
        <h1 className="text-[28pt] font-bold leading-tight">{resume.name}</h1>
        {resume.headline && <div className="text-[13pt] mt-1 opacity-90">{resume.headline}</div>}
        <div className="text-[9.5pt] mt-2 flex flex-wrap gap-x-3 gap-y-0.5 opacity-90">
          {resume.contact.email && <span>{resume.contact.email}</span>}
          {resume.contact.phone && <span>• {resume.contact.phone}</span>}
          {resume.contact.location && <span>• {resume.contact.location}</span>}
          {resume.contact.linkedin && <span>• {resume.contact.linkedin}</span>}
          {resume.contact.github && <span>• {resume.contact.github}</span>}
        </div>
      </header>

      <div className="p-[12mm]">
        {resume.summary && (
          <section className="mb-4">
            <h2 className="text-[13pt] font-bold mb-1" style={{ color: accent }}>About</h2>
            <p className="text-[10pt] text-slate-700 text-justify">{resume.summary}</p>
          </section>
        )}

        {resume.experience.length > 0 && (
          <section className="mb-4">
            <h2 className="text-[13pt] font-bold mb-2" style={{ color: accent }}>Experience</h2>
            <div className="space-y-3">
              {resume.experience.map((e) => (
                <div key={e.id} className="pl-3 border-l-2" style={{ borderColor: accent }}>
                  <div className="flex justify-between items-baseline gap-2">
                    <div className="font-bold text-[11pt] text-slate-900 flex-1 min-w-0">{e.title}</div>
                    <div className="text-[9pt] text-slate-500 font-medium px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap" style={{ background: `${accent}15`, color: accent }}>{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
                  </div>
                  <div className="text-[10pt] font-medium mb-1 text-slate-600">{e.company}{e.location && ` · ${e.location}`}</div>
                  <ul className="space-y-0.5">
                    {e.bullets.map((b, i) => (
                      <li key={i} className="text-[9.5pt] text-slate-700 pl-3 relative text-justify">
                        <span className="absolute left-0 top-1.5 w-1 h-1 rounded-full" style={{ background: accent }} />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {resume.skills.length > 0 && (
          <section className="mb-4">
            <h2 className="text-[13pt] font-bold mb-2" style={{ color: accent }}>Skills</h2>
            <div className="flex flex-wrap gap-1.5">
              {resume.skills.map((s) => (
                <span key={s.id} className="text-[9pt] px-2.5 py-1 rounded-full font-medium" style={{ background: `${accent}12`, color: accent, border: `1px solid ${accent}33` }}>
                  {s.name}
                </span>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-4">
          {resume.education.length > 0 && (
            <section>
              <h2 className="text-[13pt] font-bold mb-1" style={{ color: accent }}>Education</h2>
              <div className="space-y-1">
                {resume.education.map((ed) => (
                  <div key={ed.id} className="text-[9pt]">
                    <div className="font-bold text-slate-900">{ed.degree}{ed.field && ` in ${ed.field}`}</div>
                    <div className="text-slate-600">{ed.institution} · {fmtDate(ed.startDate)}–{fmtDate(ed.endDate)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {resume.projects.length > 0 && (
            <section>
              <h2 className="text-[13pt] font-bold mb-1" style={{ color: accent }}>Projects</h2>
              <div className="space-y-1">
                {resume.projects.slice(0, 3).map((p) => (
                  <div key={p.id} className="text-[9pt]">
                    <div className="font-bold text-slate-900">{p.name}</div>
                    {p.description && <div className="text-slate-600">{p.description}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Classic template ----
// Traditional Garamond serif, centered header, timeless formal aesthetic.
// Ideal for law, finance, academia, and traditional industries.
function ClassicTemplate({ resume, accent }: { resume: ResumeData; accent: string }) {
  return (
    <div className="p-[18mm] text-[10.5pt] leading-[1.4] text-slate-800" style={{ fontFamily: "'Garamond', 'Georgia', 'Times New Roman', serif" }}>
      <header className="text-center mb-4">
        <h1 className="text-[26pt] font-bold text-slate-900 tracking-wide">{resume.name}</h1>
        {resume.headline && <div className="text-[12pt] mt-1 italic text-slate-700">{resume.headline}</div>}
        <div className="text-[9.5pt] text-slate-600 mt-2">
          {resume.contact.email && <span>{resume.contact.email}</span>}
          {resume.contact.phone && <span> · {resume.contact.phone}</span>}
          {resume.contact.location && <span> · {resume.contact.location}</span>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-px" style={{ background: `${accent}66` }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
          <div className="flex-1 h-px" style={{ background: `${accent}66` }} />
        </div>
      </header>

      {resume.summary && (
        <section className="mb-3">
          <h2 className="text-[11pt] font-bold text-center uppercase tracking-widest mb-1.5" style={{ color: accent }}>Professional Summary</h2>
          <p className="text-[10pt] text-slate-700 text-justify px-2">{resume.summary}</p>
        </section>
      )}

      {resume.experience.length > 0 && (
        <section className="mb-3">
          <h2 className="text-[11pt] font-bold text-center uppercase tracking-widest mb-2" style={{ color: accent }}>Professional Experience</h2>
          <div className="space-y-2.5">
            {resume.experience.map((e) => (
              <div key={e.id}>
                <div className="text-center">
                  <div className="font-bold text-[10.5pt] text-slate-900">{e.company}</div>
                  <div className="text-[10pt] italic text-slate-700">{e.title}{e.location && ` · ${e.location}`}</div>
                  <div className="text-[9pt] text-slate-500">{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
                </div>
                <ul className="mt-1 space-y-0.5 max-w-[90%] mx-auto">
                  {e.bullets.map((b, i) => (
                    <li key={i} className="text-[9.5pt] text-slate-700 pl-3 text-justify">• {b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {resume.education.length > 0 && (
        <section className="mb-3">
          <h2 className="text-[11pt] font-bold text-center uppercase tracking-widest mb-1.5" style={{ color: accent }}>Education</h2>
          <div className="space-y-1 text-center">
            {resume.education.map((ed) => (
              <div key={ed.id}>
                <div className="font-bold text-[10pt] text-slate-900">{ed.degree}{ed.field && ` in ${ed.field}`}</div>
                <div className="text-[9.5pt] text-slate-700 italic">{ed.institution}</div>
                <div className="text-[9pt] text-slate-500">{fmtDate(ed.startDate)} – {fmtDate(ed.endDate)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4">
        {resume.skills.length > 0 && (
          <section>
            <h2 className="text-[11pt] font-bold text-center uppercase tracking-widest mb-1" style={{ color: accent }}>Skills</h2>
            <div className="text-[9.5pt] text-slate-700 text-center">{resume.skills.map((s) => s.name).join(" · ")}</div>
          </section>
        )}

        {resume.languages.length > 0 && (
          <section>
            <h2 className="text-[11pt] font-bold text-center uppercase tracking-widest mb-1" style={{ color: accent }}>Languages</h2>
            <div className="text-[9.5pt] text-slate-700 text-center">{resume.languages.map((l) => `${l.name}: ${l.proficiency}`).join(" · ")}</div>
          </section>
        )}
      </div>
    </div>
  );
}

function Section({ title, accent, children, center = false }: { title: string; accent: string; children: React.ReactNode; center?: boolean }) {
  return (
    <section className="mb-3">
      <h2 className={`text-[10pt] font-bold uppercase tracking-wider mb-1.5 pb-1 border-b ${center ? "text-center" : ""}`} style={{ color: accent, borderColor: `${accent}33` }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ModernSection({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-[12pt] font-bold mb-2 pb-1 border-b-2" style={{ color: accent, borderColor: `${accent}33` }}>
        {title}
      </h2>
      {children}
    </section>
  );
}
