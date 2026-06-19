"use client";

import { forwardRef } from "react";
import type { ResumeData } from "@/lib/types";

interface A4PreviewProps {
  resume: ResumeData;
  scale?: number;
  className?: string;
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
  { resume, scale = 1, className },
  ref
) {
  const accent = resume.accentColor || "#1154A3";
  const Template = TEMPLATE_MAP[resume.template] ?? ATSProfessionalTemplate;

  // Compute the scaled dimensions in mm so the wrapper occupies the correct
  // layout space (prevents horizontal overflow on mobile).
  const scaledWidthMm = 210 * scale;
  const scaledHeightMm = 297 * scale;

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

const TEMPLATE_MAP: Record<string, React.FC<{ resume: ResumeData; accent: string }>> = {
  "ats-professional": ATSProfessionalTemplate,
  executive: ExecutiveTemplate,
  modern: ModernTemplate,
  corporate: ATSProfessionalTemplate,
  europass: ATSProfessionalTemplate,
  creative: ModernTemplate,
  minimal: ATSProfessionalTemplate,
  "infohas-pro": InfohasProTemplate,
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
  const DARK_RED = "#8B0000";
  const BLACK = "#000000";
  // Photo frame: 54mm × 81mm portrait, positioned top-right
  // Page is 210mm wide, photo ends ~6mm from right edge → starts at x = 210 - 6 - 54 = 150mm
  // We position it absolutely in a header zone ~0..92mm tall
  return (
    <div
      className="relative text-slate-800"
      style={{
        fontFamily: "'Times New Roman', 'Georgia', 'Cambria', serif",
        fontSize: "10.5pt", // body 10-11pt per master layout
        lineHeight: 1.2, // compact single-spacing
        padding: "6.35mm 8.89mm", // 0.25" top/bottom, 0.35" left/right
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

        {/* Name — maroon, bold, 13pt, uppercase (matches model) */}
        <div
          style={{
            color: DARK_RED,
            fontWeight: 700,
            fontSize: "14pt",
            letterSpacing: "0.3pt",
            marginBottom: "0.5mm",
            lineHeight: 1.1,
            textTransform: "uppercase",
          }}
        >
          {(resume.name || "YOUR NAME").toUpperCase()}
        </div>

        {/* Headline — black, 13pt */}
        {resume.headline && (
          <div style={{ fontSize: "10.5pt", color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
            {resume.headline}
          </div>
        )}

        {/* Contact lines — black, 13pt */}
        <div style={{ fontSize: "10.5pt", color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
          {[resume.contact.location, resume.contact.phone].filter(Boolean).join(" | ")}
        </div>
        {resume.contact.email && (
          <div style={{ fontSize: "10.5pt", color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
            {resume.contact.email}
          </div>
        )}
        {resume.dateOfBirth && (
          <div style={{ fontSize: "10.5pt", color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
            Date Of Birth : {resume.dateOfBirth}
          </div>
        )}

        {/* No blue rule under header — the model PDF has none */}
      </header>

      {/* ============ BODY ============ */}
      {/* 27pt gap from header to first section header (matches model PDF) */}
      <div style={{ marginTop: "3mm" }}>
        {/* PROFESSIONAL SUMMARY */}
        {resume.summary && (
          <InfohasSection title="PROFESSIONAL SUMMARY">
            <p style={{ margin: 0, textAlign: "justify", color: "#000" }}>{resume.summary}</p>
          </InfohasSection>
        )}

        {/* CORE COMPETENCIES & SKILLS */}
        {resume.skills.length > 0 && (
          <InfohasSection title="CORE COMPETENCIES & SKILLS">
            <ul style={{ margin: 0, paddingLeft: "5mm", listStyleType: "•" }}>
              {groupSkillsByCategory(resume.skills).map((g, i) => (
                <li key={i} style={{ marginBottom: "1mm", color: "#000" }}>
                  <span style={{ fontWeight: 700 }}>{g.category}:</span>{" "}
                  <span>{g.items.join(", ")}.</span>
                </li>
              ))}
            </ul>
          </InfohasSection>
        )}

        {/* PROFESSIONAL EXPERIENCE */}
        {resume.experience.length > 0 && (
          <InfohasSection title="PROFESSIONAL EXPERIENCE">
            <div style={{ display: "flex", flexDirection: "column", gap: "2mm" }}>
              {resume.experience.map((e) => (
                <div key={e.id}>
                  <div style={{ marginBottom: "0.5mm" }}>
                    <span style={{ fontWeight: 700, color: "#000" }}>{e.title}</span>{" "}
                    <span style={{ color: "#000" }}>{e.company}</span>
                    {e.location && <span style={{ color: "#000" }}> | {e.location}</span>}
                    {"  "}
                    <span style={{ color: "#000" }}>{fmtDateInfohas(e.startDate)} – {fmtDateInfohas(e.endDate)}</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "5mm", listStyleType: "•" }}>
                    {e.bullets.map((b, i) => (
                      <li key={i} style={{ marginBottom: "0.5mm", color: "#000", textAlign: "justify" }}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </InfohasSection>
        )}

        {/* EDUCATION */}
        {resume.education.length > 0 && (
          <InfohasSection title="EDUCATION">
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5mm" }}>
              {resume.education.map((ed) => (
                <div key={ed.id}>
                  <div>
                    <span style={{ fontWeight: 700, color: "#000" }}>{ed.degree}</span>{" "}
                    <span style={{ color: "#000" }}>{ed.institution}</span>
                    {(ed.location || ed.startDate || ed.endDate) && (
                      <span style={{ color: "#000" }}>
                        {" | "}
                        {[ed.location, ed.startDate && ed.endDate ? `${fmtDateInfohas(ed.startDate)} – ${fmtDateInfohas(ed.endDate)}` : ed.startDate || ed.endDate].filter(Boolean).join(" | ")}
                      </span>
                    )}
                  </div>
                  {ed.highlights && ed.highlights.length > 0 && (
                    <ul style={{ margin: "0.5mm 0 0 0", paddingLeft: "5mm", listStyleType: "•" }}>
                      {ed.highlights.map((h, i) => (
                        <li key={i} style={{ color: "#000" }}>{h}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </InfohasSection>
        )}

        {/* LANGUAGES */}
        {resume.languages.length > 0 && (
          <InfohasSection title="LANGUAGES">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
              {resume.languages.map((l) => (
                <div key={l.id} style={{ color: "#000" }}>
                  <span style={{ fontWeight: 700 }}>{l.name}:</span>{" "}
                  <span style={{ textTransform: "capitalize" }}>{l.proficiency}</span>
                  {(l as any).note ? <span> ({(l as any).note})</span> : null}
                </div>
              ))}
            </div>
          </InfohasSection>
        )}
      </div>
    </div>
  );
}

/** Infohas section header - per master layout:
 * 12pt BOLD UPPERCASE DARK RED (#8B0000), no underline, compact spacing. */
function InfohasSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "3mm" }}>
      <h2
        style={{
          color: "#8B0000",
          fontWeight: 700,
          fontSize: "12pt",
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
      <div style={{ fontSize: "10.5pt", lineHeight: 1.2 }}>{children}</div>
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
                <div className="flex justify-between items-baseline">
                  <div className="font-semibold text-[10pt] text-slate-900">
                    {e.title}{e.company && <span className="font-normal text-slate-700"> — {e.company}</span>}
                  </div>
                  <div className="text-[8.5pt] text-slate-500 italic">{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
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
              <div key={ed.id} className="flex justify-between items-baseline">
                <div>
                  <div className="font-semibold text-[10pt] text-slate-900">
                    {ed.degree}{ed.field && <span className="font-normal text-slate-700"> in {ed.field}</span>}
                  </div>
                  <div className="text-[9pt] text-slate-600">{ed.institution}</div>
                </div>
                <div className="text-[8.5pt] text-slate-500 italic">{fmtDate(ed.startDate)} – {fmtDate(ed.endDate)}</div>
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
                  <div className="flex justify-between items-baseline">
                    <div className="font-bold text-[10.5pt] text-slate-900">{e.title}</div>
                    <div className="text-[8.5pt] text-slate-500">{fmtDate(e.startDate)} – {fmtDate(e.endDate)}</div>
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
