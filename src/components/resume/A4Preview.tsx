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
 */
export const A4Preview = forwardRef<HTMLDivElement, A4PreviewProps>(function A4Preview(
  { resume, scale = 1, className },
  ref
) {
  const accent = resume.accentColor || "#1154A3";
  const Template = TEMPLATE_MAP[resume.template] ?? ATSProfessionalTemplate;

  return (
    <div
      ref={ref}
      className={`a4-page origin-top ${className ?? ""}`}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "top center",
      }}
    >
      <Template resume={resume} accent={accent} />
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
};

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
