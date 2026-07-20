"use client";

import React, { useRef, useState, useEffect } from "react";

import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@/components/shared";
import { renderHighlightedText, safeRender } from "@/lib/ats-highlighter";
import type { ResumeData, ResumeLanguage } from "@/lib/types";
import { uid, useApp } from "@/lib/store";
import { getA4FillPercentage, autotuneA4Density } from "@/lib/a4-autotuner";
import { toast } from "sonner";

// Imported safeRender from shared ats-highlighter helper

/**
 * Check if the resume's headline contains duplicate contact info
 * (email, phone, or location) that is already rendered separately
 * in the contact section. If so, skip rendering the headline
 * to avoid triplicate display.
 */
function headlineIsDuplicateContact(headline: string, contact: ResumeData["contact"]): boolean {
  if (!headline || !contact) return false;
  const hl = headline.toLowerCase();
  if (contact.email && hl.includes(contact.email.toLowerCase())) return true;
  if (contact.phone) {
    const phoneDigits = contact.phone.replace(/\D/g, "");
    if (phoneDigits.length >= 5 && hl.includes(phoneDigits)) return true;
  }
  if (contact.location && hl === contact.location.toLowerCase()) return true;
  return false;
}

/**
 * Detect whether the current device is a touch-only device (mobile/tablet without
 * a fine pointer). On touch devices we cannot rely on `:hover` to reveal the
 * edit pencil, so we show it persistently and also enable tap-anywhere-on-section
 * to open the editor.
 */
function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Primary signal: the CSS media query `(hover: none) and (pointer: coarse)`
    // matches phones and tablets that lack a hover-capable pointer.
    const mql = window.matchMedia("(hover: none) and (pointer: coarse)");
    const update = () => setIsTouch(mql.matches || "ontouchstart" in window);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);
  return isTouch;
}

/**
 * EditableA4Preview — InfoHAS Pro template with live inline editing.
 *
 * Every section has a pencil icon that, on click, opens an editor for that section.
 * Photo frame is also clickable — opens file picker to upload a profile photo.
 *
 * On touch devices (mobile/tablet), the pencil is always visible and the entire
 * section is tappable to open the editor (since `:hover` does not work on touch).
 *
 * Used in the Optimizer "done" step so users can refine the AI-optimized resume
 * in place before exporting.
 */

interface EditableA4PreviewProps {
  resume: ResumeData;
  onChange: (patch: Partial<ResumeData>) => void;
  scale?: number;
  className?: string;
  activeElement?: any;
  setActiveElement?: (el: any) => void;
  onOverflowChange?: (overflows: boolean) => void;
  optimizingSection?: string | null;
}

type EditTarget =
  | null
  | "header"
  | "summary"
  | "skills"
  | `experience:${string}`
  | `education:${string}`
  | "languages";

// Master layout colors — BLACK fallback
const BLACK_FALLBACK = "#000000";

// Imported renderHighlightedText from shared ats-highlighter helper

export function EditableA4Preview({ resume, onChange, scale = 0.7, className, activeElement, setActiveElement, onOverflowChange, optimizingSection }: EditableA4PreviewProps) {
  const [editing, setEditing] = useState<EditTarget>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isTouch = useIsTouchDevice();
  const config = useApp((s) => s.optimizerDirective);

  const [overflows, setOverflows] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const checkHeight = () => {
      const a4HeightPx = 297 * 3.7795275591;
      const actualHeight = el.scrollHeight || el.clientHeight || el.offsetHeight;
      const hasOverflow = actualHeight > a4HeightPx + 2;
      setOverflows(hasOverflow);
      if (onOverflowChange) onOverflowChange(hasOverflow);
    };

    checkHeight();
    const observer = new MutationObserver(checkHeight);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [resume, onOverflowChange]);

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
    contactSpacing: config?.contactSpacing ?? "stacked",
  };

  const BLACK = L.bodyTextColor;

  const atsReports = useApp((s) => s.atsReports);
  const latestReport = atsReports.find((r) => r.resumeId === resume.id);
  const [heatmapMode, setHeatmapMode] = useState(false);

  const renderHText = (textVal: any) => {
    const raw = safeRender(textVal);
    if (!heatmapMode) return raw;
    return renderHighlightedText(raw, true, latestReport?.matchedKeywords || [], latestReport?.detectedCliches || []) as any;
  };

  // No local draft — the parent owns the state. Edits call onChange() directly,
  // which updates the parent's `resume` prop, which re-renders this component.
  const patch = (p: Partial<ResumeData>) => {
    onChange(p);
  };

  // Commit a draft (close editor)
  const commit = (p: Partial<ResumeData>) => {
    patch(p);
    setEditing(null);
  };

  const [isAutotuning, setIsAutotuning] = useState(false);
  const fillPercent = getA4FillPercentage(resume);

  const handleAutotune = async () => {
    if (isAutotuning) return;
    setIsAutotuning(true);
    const toastId = toast.loading("⚡ Autotuning A4 page density to 100%...");
    try {
      const res = await autotuneA4Density(resume, activeJD ?? null, (msg) => {
        toast.loading(msg, { id: toastId });
      });
      patch(res.resume);
      toast.success(`✅ A4 Page Density autotuned: ${res.initialFillPercent}% → ${res.finalFillPercent}%!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Autotune error: ${err.message}`, { id: toastId });
    } finally {
      setIsAutotuning(false);
    }
  };

  /**
   * openSection — COPILOT FIX (Phase C)
   *
   * Root cause: previously `setEditing(target)` opened the drawer but left
   * `activeElement` as null. The Copilot's action buttons are all gated on
   * `!activeElement`, so they remained disabled until the user manually focused
   * a field inside the drawer. Most users never did this, making Copilot appear broken.
   *
   * Fix: simultaneously set the editing target AND pre-populate `activeElement`
   * with the primary field of the section being opened, so Copilot is immediately
   * active when the drawer appears — no manual field click required.
   */
  const openSection = (target: EditTarget) => {
    setEditing(target);
    if (!setActiveElement || !target) return;
    if (target === "summary") {
      setActiveElement({ section: "summary", field: "summary", value: resume.summary ?? "" });
    } else if (target === "header") {
      setActiveElement({ section: "basics", field: "name", value: resume.name ?? "" });
    } else if (target === "skills") {
      setActiveElement({ section: "skills", field: "skills", value: (resume.skills ?? []).map(s => s.name).join(", ") });
    } else if (target === "languages") {
      setActiveElement({ section: "languages", field: "languages", value: (resume.languages ?? []).map(l => l.name).join(", ") });
    } else if (target.startsWith("experience:")) {
      const id = target.replace("experience:", "");
      const exp = resume.experience?.find(e => e.id === id);
      if (exp) {
        setActiveElement({ section: "experience", id, field: "bullets", value: (exp.bullets ?? []).join("\n") });
      }
    } else if (target.startsWith("education:")) {
      const id = target.replace("education:", "");
      const edu = resume.education?.find(e => e.id === id);
      if (edu) {
        setActiveElement({ section: "education", id, field: "degree", value: edu.degree ?? "" });
      }
    }
  };


  const onPhotoUpload = (files: FileList | null) => {
    if (!files?.[0]) return;
    const file = files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert("Photo too large. Maximum 5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      patch({ photoUrl: reader.result as string });
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className={className}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onPhotoUpload(e.target.files)} />

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 bg-slate-900/40 p-2 rounded-xl border border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          {/* Visual Density Badge */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-bold text-[11px] ${
            fillPercent >= 95 && fillPercent <= 100
              ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-400"
              : fillPercent < 95
              ? "bg-amber-950/40 border-amber-800/40 text-amber-400"
              : "bg-rose-950/40 border-rose-800/40 text-rose-400"
          }`}>
            <Icon name="Maximize2" className="w-3.5 h-3.5" />
            <span>A4 Density: {fillPercent}%</span>
            <span className="text-[9px] font-normal opacity-80">
              ({fillPercent >= 95 && fillPercent <= 100 ? "100% Optimal" : fillPercent < 95 ? "Underfilled" : "Overflowing"})
            </span>
          </div>

          {latestReport && (
            <div className="hidden sm:flex items-center gap-1.5 text-slate-400">
              <Icon name="Activity" className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[11px]">ATS: {latestReport.scores.ats}/100</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 1-Click Autotune Button */}
          <button
            onClick={handleAutotune}
            disabled={isAutotuning}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-[11px] transition shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isAutotuning ? (
              <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Icon name="Zap" className="w-3.5 h-3.5 text-amber-300" />
            )}
            <span>{isAutotuning ? "Autotuning..." : "⚡ Fill Page 100%"}</span>
          </button>

          {latestReport && (
            <button
              onClick={() => setHeatmapMode(!heatmapMode)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                heatmapMode 
                  ? "bg-indigo-600 text-white shadow-sm" 
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              }`}
            >
              <Icon name="Flame" className={`w-3.5 h-3.5 ${heatmapMode ? "text-amber-300 animate-pulse" : ""}`} />
              {heatmapMode ? "Hide Heatmap" : "ATS Heatmap"}
            </button>
          )}
        </div>
      </div>

      {/* Outer wrapper — occupies the SCALED layout space (210mm × scale × 297mm × scale)
          so the parent container sees a correctly-sized box. Without this, CSS transform: scale()
          only affects visual rendering, not layout, causing horizontal overflow on mobile. */}
      <div
        style={{
          width: `${210 * scale}mm`,
          height: `${297 * scale}mm`,
          position: "relative",
          overflow: "hidden",
          margin: "0 auto",
        }}
      >
        <div
          ref={innerRef}
          className="a4-page origin-top-left relative"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
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
          {/* ============ HEADER (editable) — two-column: 70% left, 30% right photo ============ */}
          <EditableBlock isEditing={editing === "header"} onEdit={() => openSection("header")} label="Edit header" isTouch={isTouch} isOptimizing={optimizingSection === "all" || optimizingSection === "header"}>
            <header className="relative" style={{ paddingRight: resume.photoUrl ? "36mm" : 0, minHeight: resume.photoUrl ? "42mm" : "auto" }}>
              {/* Photo — top-right, 30×40mm.
                  - If a photo exists: render it, tappable to replace.
                  - If NO photo exists: render a visible "Upload Photo" placeholder button
                    so mobile users have a clear tap target (the strict layout directive
                    forbids placeholder boxes in the final PDF, but this is the live editing
                    preview — the placeholder is hidden on export).
                  - On touch devices, the photo pencil is always visible; on desktop, hover-reveal. */}
              {resume.photoUrl ? (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="group"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    width: "30mm",
                    height: "40mm",
                    border: "0.5pt solid #999",
                    background: "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    cursor: "pointer",
                    boxSizing: "border-box",
                    padding: 0,
                  }}
                  title="Tap to change photo"
                >
                  <img src={resume.photoUrl} alt={resume.name} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
                  <div
                    className={"absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center transition " + (isTouch ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    style={{ pointerEvents: "none" }}
                  >
                    <Icon name="Pencil" className="w-2.5 h-2.5" />
                  </div>
                </button>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  type="button"
                  className="group"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    width: "30mm",
                    height: "40mm",
                    border: "1pt dashed #999",
                    background: "#f5f5f5",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    cursor: "pointer",
                    boxSizing: "border-box",
                    padding: "2mm",
                    gap: "1mm",
                  }}
                  title="Tap to upload photo"
                >
                  <Icon name="User" className="w-5 h-5 text-muted-foreground" />
                  <span style={{ fontSize: "7pt", color: "#666", textAlign: "center", lineHeight: 1.1 }}>Upload Photo</span>
                </button>
              )}

              {/* LEFT COLUMN — name, headline, contact, DOB (70% width, left-aligned, compact) */}
              <div style={{ color: L.nameColor, fontWeight: 700, fontSize: `${L.nameSizePt}pt`, letterSpacing: "0.3pt", marginBottom: "0.5mm", lineHeight: 1.1, textTransform: "uppercase" }}>
                {(resume.name || "YOUR NAME").toUpperCase()}
              </div>
              {resume.headline && !headlineIsDuplicateContact(resume.headline, resume.contact) && <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.5mm", lineHeight: 1.2 }}>{safeRender(resume.headline)}</div>}
              {L.contactSpacing === "single-line" ? (
                <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
                  {[
                    safeRender(resume.contact.location),
                    safeRender(resume.contact.phone),
                    safeRender(resume.contact.email),
                    resume.dateOfBirth ? `DOB: ${safeRender(resume.dateOfBirth)}` : ""
                  ].filter(Boolean).join(" | ")}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
                    {[safeRender(resume.contact.location), safeRender(resume.contact.phone)].filter(Boolean).join(" | ")}
                  </div>
                  {resume.contact.email && <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>{safeRender(resume.contact.email)}</div>}
                  {resume.dateOfBirth && <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>Date of Birth: {safeRender(resume.dateOfBirth)}</div>}
                </>
              )}
            </header>
          </EditableBlock>

          {/* ============ BODY ============ */}
          {/* Compact gap from header to first section */}
          <div style={{ marginTop: "3mm" }}>
            {/* SUMMARY */}
            {resume.summary && (
              <EditableBlock isEditing={editing === "summary"} onEdit={() => openSection("summary")} label="Edit summary" isTouch={isTouch} isOptimizing={optimizingSection === "all" || optimizingSection === "summary"}>
                <InfohasSection title="PROFESSIONAL SUMMARY">
                  <p style={{ margin: 0, textAlign: "justify", color: BLACK, lineHeight: 1.2 }}>{renderHText(resume.summary)}</p>
                </InfohasSection>
              </EditableBlock>
            )}

            {/* EXPERIENCE — section header once, then all entries */}
            {resume.experience.length > 0 && (
              <>
                <SectionDividerInline title="PROFESSIONAL EXPERIENCE" />
                {resume.experience.map((e) => (
                  <EditableBlock
                    key={e.id}
                    isEditing={editing === `experience:${e.id}`}
                    onEdit={() => openSection(`experience:${e.id}`)}

                    label="Edit experience"
                    isTouch={isTouch}
                    isOptimizing={optimizingSection === "all" || optimizingSection === "experience" || optimizingSection === `experience:${e.id}`}
                  >
                    <div style={{ marginBottom: "1mm" }}>
                      <div style={{ marginBottom: "0.3mm", lineHeight: 1.2, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "2mm" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 700, color: BLACK }}>{String(e.title || "")}</span>
                          {e.company && <span style={{ color: BLACK }}> | {String(e.company)}</span>}
                          {e.location && <span style={{ color: BLACK }}> | {safeRender(e.location)}</span>}
                        </span>
                        <span style={{ color: BLACK, whiteSpace: "nowrap", flexShrink: 0 }}>{fmtDateInfohas(e.startDate)}{e.endDate ? ` – ${fmtDateInfohas(e.endDate)}` : ""}</span>
                      </div>
                      <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                        {e.bullets.map((b, i) => (
                          <li key={i} style={{ marginBottom: 0, color: BLACK, textAlign: "justify", lineHeight: 1.2 }}>{renderHText(b)}</li>
                        ))}
                      </ul>
                    </div>
                  </EditableBlock>
                ))}
              </>
            )}

            {/* EDUCATION — section header once, then all entries */}
            {resume.education.length > 0 && (
              <>
                <SectionDividerInline title="EDUCATION & PROFESSIONAL DEVELOPMENT" />
                {resume.education.slice(0, 3).map((ed) => (
                  <EditableBlock
                    key={ed.id}
                    isEditing={editing === `education:${ed.id}`}
                    onEdit={() => openSection(`education:${ed.id}`)}

                    label="Edit education"
                    isTouch={isTouch}
                    isOptimizing={optimizingSection === "all" || optimizingSection === "education" || optimizingSection === `education:${ed.id}`}
                  >
                    <div style={{ marginBottom: "1mm", lineHeight: 1.2 }}>
                      <div style={{ lineHeight: 1.2, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "2mm" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 700, color: BLACK }}>
                            {safeRender(ed.degree)}
                            {ed.field ? ` in ${safeRender(ed.field)}` : ""}
                          </span>
                          {ed.institution && <span style={{ color: BLACK }}> | {safeRender(ed.institution)}</span>}
                          {ed.location && <span style={{ color: BLACK }}> | {safeRender(ed.location)}</span>}
                        </span>
                        {(ed.startDate || ed.endDate) && (
                          <span style={{ color: BLACK, whiteSpace: "nowrap", flexShrink: 0 }}>
                            {fmtDateInfohas(ed.startDate)} – {fmtDateInfohas(ed.endDate)}
                          </span>
                        )}
                      </div>
                  {ed.highlights && ed.highlights.length > 0 && (() => {
                    // Parse highlights: if any item starts with "Modules:" or is a comma-separated list,
                    // split it into individual bullet items so each module gets its own bullet point.
                    const allBullets: string[] = [];
                    for (const h of ed.highlights) {
                      const cleaned = h.replace(/^Modules:\s*/i, "").trim();
                      if (cleaned.includes(",")) {
                        cleaned.split(",").map(s => s.trim()).filter(Boolean).forEach(m => allBullets.push(m));
                      } else if (cleaned) {
                        allBullets.push(cleaned);
                      }
                    }
                    if (allBullets.length === 0) return null;
                    return (
                      <ul style={{ margin: "0.3mm 0 0 0", paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                        {allBullets.map((m, i) => (
                          <li key={i} style={{ color: BLACK, lineHeight: 1.2, textAlign: "justify" }}>{renderHText(m)}</li>
                        ))}
                      </ul>
                    );
                  })()}
                    </div>
                  </EditableBlock>
                ))}
              </>
            )}

            {/* KEY COMPETENCIES (moved after Education to match target format) */}
            {resume.skills.length > 0 && (
              <EditableBlock isEditing={editing === "skills"} onEdit={() => openSection("skills")} label="Edit skills" isTouch={isTouch} isOptimizing={optimizingSection === "all" || optimizingSection === "skills"}>
                <InfohasSection title="CORE COMPETENCIES & SKILLS">
                  <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                    {groupSkillsByCategory(resume.skills).slice(0, 4).map((g, i) => (
                      <li key={i} style={{ marginBottom: 0, color: BLACK, lineHeight: 1.2, textAlign: "justify" }}>
                        <span style={{ fontWeight: 700 }}>{safeRender(g.category)}:</span> <span>{g.items.length > 0 ? g.items.map((item: any) => renderHText(item)).reduce((prev: any, curr: any) => [prev, ", ", curr]) : ""}.</span>
                      </li>
                    ))}
                  </ul>
                </InfohasSection>
              </EditableBlock>
            )}

            {/* LANGUAGES — bullet list with proficiency */}
            {resume.languages.length > 0 && (
              <EditableBlock isEditing={editing === "languages"} onEdit={() => openSection("languages")} label="Edit languages" isTouch={isTouch} isOptimizing={optimizingSection === "all" || optimizingSection === "languages"}>
                <InfohasSection title="LANGUAGES">
                  <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                    {resume.languages.map((l) => (
                      <li key={l.id} style={{ color: BLACK, lineHeight: 1.2 }}>
                        {safeRender(l.name)}{l.proficiency ? ` (${safeRender(l.proficiency)})` : ""}
                      </li>
                    ))}
                  </ul>
                </InfohasSection>
              </EditableBlock>
            )}

            {/* CERTIFICATIONS */}
            {resume.certifications && resume.certifications.length > 0 && (
              <InfohasSection title="CERTIFICATIONS">
                <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                  {resume.certifications.map((cert) => (
                    <li key={cert.id} style={{ color: BLACK, lineHeight: 1.2 }}>
                      {renderHText(cert.name)}{cert.issuer ? ` — ${renderHText(cert.issuer)}` : ""}{cert.date ? ` (${cert.date})` : ""}
                    </li>
                  ))}
                </ul>
              </InfohasSection>
            )}

            {/* PROJECTS */}
            {resume.projects && resume.projects.length > 0 && (
              <InfohasSection title="PROJECTS">
                {resume.projects.slice(0, 3).map((proj) => (
                  <div key={proj.id} style={{ marginBottom: "0.5mm" }}>
                    <div style={{ fontWeight: 700, color: BLACK, lineHeight: 1.2 }}>
                      {safeRender(proj.name)}
                    </div>
                    {proj.description && (
                      <p style={{ margin: "0.2mm 0", color: BLACK, lineHeight: 1.2, textAlign: "justify" }}>
                        {renderHText(proj.description)}
                      </p>
                    )}
                    {proj.bullets && proj.bullets.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                        {proj.bullets.map((b, i) => (
                          <li key={i} style={{ color: BLACK, lineHeight: 1.2 }}>{renderHText(b)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </InfohasSection>
            )}

            {/* DYNAMIC SECTIONS — renders any section type not covered by static fields above.
                 Skips sections whose title overlaps with structured fields (same logic as render-document.ts)
                 to prevent content duplication and A4 overflow. */}
            {resume.dynamicSections && resume.dynamicSections.length > 0 && (() => {
              // Set of normalized titles that have already been rendered by structured sections
              const STRUCTURED_SECTION_TITLES_PREVIEW = new Set([
                "professional summary", "summary", "professional profile",
                "professional experience", "experience", "work experience",
                "education", "vocational training", "academic background",
                "core competencies & skills", "skills", "core competencies",
                "key competencies", "key skills", "technical skills", "competencies",
                "languages", "additional information", "certifications",
                "projects", "personal information", "personal details",
                "contact", "contact information", "personal",
                "date of birth", "nationality",
              ]);
              const normalizeTitle = (t: string) =>
                t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

              return resume.dynamicSections
                .filter((ds) => {
                  const normTitle = normalizeTitle(ds.title);
                  if (!normTitle) return false;
                  // Skip if it matches a known structured section
                  if (STRUCTURED_SECTION_TITLES_PREVIEW.has(normTitle)) return false;
                  // Skip if it's a subset or superset of any known structured section
                  const isOverlap = Array.from(STRUCTURED_SECTION_TITLES_PREVIEW).some(
                    (t) => normTitle.includes(t) || t.includes(normTitle)
                  );
                  if (isOverlap) return false;
                  // Skip if content contains contact / personal info already in the header
                  const PERSONAL_RE = /date\s*of\s*birth|dob\s*:|[\w.+-]+@[\w-]+\.[\w.-]+|[+]?\d{8,}/i;
                  if (PERSONAL_RE.test(ds.content || "") || PERSONAL_RE.test(ds.title)) return false;
                  return true;
                })
                .map((ds) => (
                  <InfohasSection key={ds.id} title={ds.title.toUpperCase()}>
                    {ds.content && (
                      <p style={{ margin: 0, color: BLACK, lineHeight: 1.2, textAlign: "justify" }}>
                        {renderHText(ds.content)}
                      </p>
                    )}
                    {ds.bullets && ds.bullets.length > 0 && (
                      <ul style={{ margin: "0.3mm 0 0 0", paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                        {ds.bullets.map((b, i) => (
                          <li key={i} style={{ color: BLACK, lineHeight: 1.2 }}>{renderHText(b)}</li>
                        ))}
                      </ul>
                    )}
                  </InfohasSection>
                ));
            })()}

            {/* ADDITIONAL INFORMATION */}
            {resume.additionalInfo && (
              <InfohasSection title="ADDITIONAL INFORMATION">
                {resume.additionalInfo.split("\n").map((line, i) => (
                  line.trim() ? (
                    <p key={i} style={{ margin: 0, color: BLACK, lineHeight: 1.2, textAlign: "justify" }}>
                      {safeRender(line.trim())}
                    </p>
                  ) : null
                ))}
              </InfohasSection>
            )}
            {/* ============ Page-Break Indicator Line ============ */}
            {overflows && (
              <div
                style={{
                  position: "absolute",
                  top: "297mm",
                  left: 0,
                  width: "100%",
                  borderTop: "2px dashed #EF4444",
                  zIndex: 49,
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        </div>
        {/* ============ Interactive Overflows Warning Badge ============ */}
        {overflows && (
          <div
            style={{
              position: "absolute",
              bottom: "8px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "rgba(239, 68, 68, 0.9)",
              color: "#ffffff",
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: "bold",
              zIndex: 50,
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              whiteSpace: "nowrap"
            }}
          >
            <Icon name="AlertTriangle" className="w-3.5 h-3.5 animate-bounce" />
            Content overflows A4 page! Try shortening it.
          </div>
        )}
        </div>
      </div>

      {/* ============ EDITOR DRAWER ============ */}
      <AnimatePresence>
        {editing && (
          <EditorDrawer
            key={editing}
            target={editing}
            resume={resume}
            onClose={() => setEditing(null)}
            onCommit={commit}
            activeElement={activeElement}
            setActiveElement={setActiveElement}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Wrapper that shows a pencil on hover (desktop) or persistently (touch) and toggles editing.
 *  On touch devices, tapping anywhere inside the section also opens the editor. */
function EditableBlock({
  isEditing,
  onEdit,
  label,
  children,
  isTouch = false,
  isOptimizing = false,
}: {
  isEditing: boolean;
  onEdit: () => void;
  label: string;
  children: React.ReactNode;
  isTouch?: boolean;
  isOptimizing?: boolean;
}) {
  return (
    <div
      className="group relative"
      style={{
        outline: isEditing ? "1pt dashed #0563C1" : isTouch ? "1pt dashed transparent" : "none",
        outlineOffset: "1mm",
        transition: "outline 0.15s",
        cursor: isTouch ? "pointer" : "default",
      }}
      // On touch devices, tapping anywhere in the block opens the editor.
      // On desktop, we keep the click target limited to the pencil FAB so users
      // can still select/copy text from the resume body.
      onClick={isTouch && !isEditing && !isOptimizing ? onEdit : undefined}
    >
      {children}

      {/* Ghost-Loading Shimmer Overlay */}
      {isOptimizing && (
        <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 backdrop-blur-[1px] flex flex-col items-center justify-center z-20 pointer-events-auto rounded transition-all duration-300">
          <div className="absolute inset-0 bg-slate-150/40 dark:bg-slate-800/40 animate-pulse" />
          <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 shadow-sm">
            <Icon name="Sparkles" className="w-3.5 h-3.5 text-brand animate-spin" />
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 tracking-wider uppercase animate-pulse">AI Enhancing...</span>
          </div>
        </div>
      )}

      {/* Pencil FAB — hidden only while editing or optimizing (the editor modal takes over).
          On touch devices it is always visible; on desktop it appears on hover. */}
      {!isEditing && !isOptimizing && (
        <button
          onClick={(e) => {
            // Stop propagation so the touch-mode parent onClick doesn't fire twice.
            e.stopPropagation();
            onEdit();
          }}
          title={label}
          aria-label={label}
          className={
            "absolute top-0 right-0 w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center transition shadow-glow hover:scale-110 z-10 " +
            (isTouch
              ? "opacity-100" // always visible on mobile
              : "opacity-0 group-hover:opacity-100") // hover-reveal on desktop
          }
          style={{ transform: "translate(35%, -35%)" }}
        >
          <Icon name="Pencil" className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** Infohas section header - per master layout:
 * Configured BOLD UPPERCASE color, no underline, compact spacing. */
function InfohasSection({ title, children }: { title: string; children: React.ReactNode }) {
  const config = useApp((s) => s.optimizerDirective);
  const titleColor = config?.sectionTitleColor || "#8B0000";
  const fontSize = config?.sectionTitleSizePt ? `${config.sectionTitleSizePt}pt` : "12pt";
  const sectionGap = config?.sectionGapMm ? `${config.sectionGapMm}mm` : "3mm";

  return (
    <section style={{ marginBottom: sectionGap }}>
      <h2
        style={{
          color: titleColor,
          fontWeight: 700,
          fontSize: fontSize,
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
      <div style={{ fontSize: "inherit", lineHeight: 1.2 }}>{children}</div>
    </section>
  );
}

/** Section header for grouped experience/education entries - Configured bold UPPERCASE color */
function SectionDividerInline({ title }: { title: string }) {
  const config = useApp((s) => s.optimizerDirective);
  const titleColor = config?.sectionTitleColor || "#8B0000";
  const fontSize = config?.sectionTitleSizePt ? `${config.sectionTitleSizePt}pt` : "12pt";
  const sectionGap = config?.sectionGapMm ? `${config.sectionGapMm}mm` : "3mm";

  return (
    <h2
      style={{
        color: titleColor,
        fontWeight: 700,
        fontSize: fontSize,
        letterSpacing: "0.3pt",
        margin: `${sectionGap} 0 1mm 0` /* compact gap */,
        paddingBottom: 0,
        borderBottom: "none",
        textTransform: "uppercase",
        lineHeight: 1.2,
      }}
    >
      {title}
    </h2>
  );
}

function getFieldValue(resume: ResumeData, activeElement: any): string {
  if (!activeElement) return "";
  const { section, id, field, bulletIndex } = activeElement;
  if (section === "basics") {
    if (field === "name") return resume.name || "";
    if (field === "headline") return resume.headline || "";
    if (field === "location") return resume.contact?.location || "";
    if (field === "phone") return resume.contact?.phone || "";
    if (field === "email") return resume.contact?.email || "";
    if (field === "dateOfBirth") return resume.dateOfBirth || "";
  }
  if (section === "summary") {
    return resume.summary || "";
  }
  if (section === "experience" && id) {
    const exp = resume.experience?.find((e) => e.id === id);
    if (exp) {
      if (field === "bullets" && bulletIndex !== undefined) {
        return exp.bullets?.[bulletIndex] || "";
      }
      if (field === "bullets") {
        return exp.bullets?.join("\n") || "";
      }
      return (exp as any)[field] || "";
    }
  }
  if (section === "education" && id) {
    const edu = resume.education?.find((e) => e.id === id);
    if (edu) {
      if (field === "highlights") {
        return (edu.highlights ?? []).join(", ").replace(/^Modules: /, "");
      }
      return (edu as any)[field] || "";
    }
  }
  if (section === "skills" && id) {
    const s = resume.skills?.find((sk) => sk.id === id);
    if (s) return s.name || "";
  }
  if (section === "languages" && id) {
    const l = resume.languages?.find((lg) => lg.id === id);
    if (l) {
      return (l as any)[field] || "";
    }
  }
  return "";
}

/** Inline editor drawer — slides up from bottom on desktop, full-screen on mobile */
function EditorDrawer({ target, resume, onClose, onCommit, activeElement, setActiveElement }: {
  target: EditTarget;
  resume: ResumeData;
  onClose: () => void;
  onCommit: (p: Partial<ResumeData>) => void;
  activeElement?: any;
  setActiveElement?: (el: any) => void;
}) {
  // local form state — keyed by target so it resets when target changes (controlled via key prop from parent)
  const [form, setForm] = useState<ResumeData>(resume);

  // Sync form state when resume prop changes (e.g., from AI Copilot patches)
  useEffect(() => {
    setForm(resume);
  }, [resume]);

  // Whenever local form state changes, sync the activeElement value to the Copilot.
  // LOOP FIX: `activeElement` is an object — including it directly in deps caused an infinite
  // loop because `setActiveElement` creates a new object reference each call, which re-triggers
  // the effect. Instead, we key on `section+id+field` (stable strings) and use a ref to detect
  // changes to the field identity, then read from the latest activeElement via a ref.
  const activeElementRef = React.useRef<any>(null);
  const fieldKey = activeElement ? `${activeElement.section}:${activeElement.id ?? ""}:${activeElement.field ?? ""}` : "";

  useEffect(() => {
    activeElementRef.current = activeElement;
  }, [activeElement]);


  useEffect(() => {
    if (!activeElementRef.current || !setActiveElement) return;
    const liveVal = getFieldValue(form, activeElementRef.current);
    if (liveVal !== activeElementRef.current.value) {
      setActiveElement({ ...activeElementRef.current, value: liveVal });
    }
  }, [form, fieldKey]); // fieldKey changes when user focuses a different field; form changes on edit



  const save = () => {
    if (target === "header") {
      onCommit({
        name: form.name,
        headline: form.headline,
        dateOfBirth: form.dateOfBirth,
        contact: { ...form.contact },
      });
    } else if (target === "summary") {
      onCommit({ summary: form.summary });
    } else if (target === "skills") {
      onCommit({ skills: form.skills });
    } else if (target?.startsWith("experience:")) {
      onCommit({ experience: form.experience });
    } else if (target?.startsWith("education:")) {
      onCommit({ education: form.education });
    } else if (target === "languages") {
      onCommit({ languages: form.languages });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-premium w-full sm:max-w-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <h3 className="font-display font-bold text-lg flex items-center gap-2">
            <Icon name="Pencil" className="w-4 h-4 text-brand" />
            {target === "header" && "Edit header & contact"}
            {target === "summary" && "Edit professional summary"}
            {target === "skills" && "Edit core competencies & skills"}
            {target === "languages" && "Edit languages"}
            {target?.startsWith("experience:") && "Edit experience entry"}
            {target?.startsWith("education:") && "Edit education entry"}
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-secondary flex items-center justify-center" aria-label="Close">
            <Icon name="X" className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {target === "header" && (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Full name"><Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} onFocus={() => setActiveElement && setActiveElement({ section: "basics", field: "name", value: form.name })} /></Field>
                <Field label="Headline"><Input value={form.headline ?? ""} onChange={(v) => setForm({ ...form, headline: v })} onFocus={() => setActiveElement && setActiveElement({ section: "basics", field: "headline", value: form.headline ?? "" })} /></Field>
                <Field label="Location"><Input value={form.contact.location ?? ""} onChange={(v) => setForm({ ...form, contact: { ...form.contact, location: v } })} onFocus={() => setActiveElement && setActiveElement({ section: "basics", field: "location", value: form.contact.location ?? "" })} /></Field>
                <Field label="Phone"><Input value={form.contact.phone ?? ""} onChange={(v) => setForm({ ...form, contact: { ...form.contact, phone: v } })} onFocus={() => setActiveElement && setActiveElement({ section: "basics", field: "phone", value: form.contact.phone ?? "" })} /></Field>
                <Field label="Email"><Input value={form.contact.email ?? ""} onChange={(v) => setForm({ ...form, contact: { ...form.contact, email: v } })} onFocus={() => setActiveElement && setActiveElement({ section: "basics", field: "email", value: form.contact.email ?? "" })} /></Field>
                <Field label="Date of birth (DD/MM/YYYY)"><Input value={form.dateOfBirth ?? ""} onChange={(v) => setForm({ ...form, dateOfBirth: v })} onFocus={() => setActiveElement && setActiveElement({ section: "basics", field: "dateOfBirth", value: form.dateOfBirth ?? "" })} placeholder="10/01/2005" /></Field>
              </div>
            </div>
          )}

          {target === "summary" && (
            <Field label="Professional summary (60-90 words)">
              <TextArea
                value={form.summary ?? ""}
                onChange={(v) => setForm({ ...form, summary: v })}
                onFocus={() => setActiveElement && setActiveElement({ section: "summary", field: "summary", value: form.summary ?? "" })}
                rows={8}
                placeholder="Ambitious Retail Sales Professional with..."
              />
              <p className="text-xs text-muted-foreground mt-1">{(form.summary ?? "").split(/\s+/).filter(Boolean).length} words</p>
            </Field>
          )}

          {target === "skills" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase text-muted-foreground">Skill groups (Category | comma-separated skills)</Label>
                <button
                  onClick={() => setForm({ ...form, skills: [...form.skills, { id: uid("s"), name: "New skill", category: "New category" }] })}
                  className="text-xs px-2 py-1 rounded bg-brand text-white hover:bg-brand-dark flex items-center gap-1"
                >
                  <Icon name="Plus" className="w-3 h-3" /> Add skill
                </button>
              </div>
              {groupSkillsByCategory(form.skills).map((g, gi) => (
                <div key={gi} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={g.category}
                      onChange={(v) => {
                        const next = form.skills.map((s) => s.category === g.category ? { ...s, category: v } : s);
                        setForm({ ...form, skills: next });
                      }}
                      placeholder="Category"
                    />
                    <button
                      onClick={() => setForm({ ...form, skills: form.skills.filter((s) => s.category !== g.category) })}
                      className="text-destructive hover:bg-destructive/10 px-2 rounded"
                    >
                      <Icon name="Trash2" className="w-4 h-4" />
                    </button>
                  </div>
                  <Input
                    value={g.items.join(", ")}
                    onChange={(v) => {
                      const items = v.split(",").map((x) => x.trim()).filter(Boolean);
                      // Replace this category's items: remove all old, add new
                      const others = form.skills.filter((s) => s.category !== g.category);
                      const newSkills = items.map((name) => ({ id: uid("s"), name, category: g.category }));
                      setForm({ ...form, skills: [...others, ...newSkills] });
                    }}
                    placeholder="Skill 1, Skill 2, Skill 3"
                  />
                </div>
              ))}
            </div>
          )}

          {target?.startsWith("experience:") && (() => {
            const id = target.split(":")[1];
            const e = form.experience.find((x) => x.id === id);
            if (!e) return null;
            return (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Job title"><Input value={e.title} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, title: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "experience", id, field: "title", value: e.title })} /></Field>
                  <Field label="Company"><Input value={e.company} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, company: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "experience", id, field: "company", value: e.company })} /></Field>
                  <Field label="Location"><Input value={e.location ?? ""} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, location: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "experience", id, field: "location", value: e.location ?? "" })} /></Field>
                  <Field label="Start (Mon YYYY)"><Input value={e.startDate} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, startDate: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "experience", id, field: "startDate", value: e.startDate })} placeholder="May 2024" /></Field>
                  <Field label="End"><Input value={e.endDate} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, endDate: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "experience", id, field: "endDate", value: e.endDate })} placeholder="Oct 2024 or Present" /></Field>
                </div>
                <Field label="Achievement bullets (one per line — start with action verbs)">
                  <TextArea
                    value={e.bullets.join("\n")}
                    onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, bullets: v.split("\n") } : x) })}
                    onFocus={() => setActiveElement && setActiveElement({ section: "experience", id, field: "bullets", value: e.bullets.join("\n") })}
                    rows={6}
                  />
                </Field>
              </div>
            );
          })()}

          {target?.startsWith("education:") && (() => {
            const id = target.split(":")[1];
            const ed = form.education.find((x) => x.id === id);
            if (!ed) return null;
            return (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Degree"><Input value={ed.degree} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, degree: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "education", id, field: "degree", value: ed.degree })} /></Field>
                  <Field label="Institution"><Input value={ed.institution} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, institution: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "education", id, field: "institution", value: ed.institution })} /></Field>
                  <Field label="Location"><Input value={ed.location ?? ""} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, location: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "education", id, field: "location", value: ed.location ?? "" })} /></Field>
                  <Field label="Start"><Input value={ed.startDate} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, startDate: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "education", id, field: "startDate", value: ed.startDate })} placeholder="2024" /></Field>
                  <Field label="End"><Input value={ed.endDate} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, endDate: v } : x) })} onFocus={() => setActiveElement && setActiveElement({ section: "education", id, field: "endDate", value: ed.endDate })} placeholder="2025" /></Field>
                </div>
                <Field label="Modules (one line, comma-separated)">
                  <Input
                    value={(ed.highlights ?? []).join(", ").replace(/^Modules: /, "")}
                    onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, highlights: v.trim() ? [`Modules: ${v.replace(/^Modules: /, "")}`] : [] } : x) })}
                    onFocus={() => setActiveElement && setActiveElement({ section: "education", id, field: "highlights", value: (ed.highlights ?? []).join(", ").replace(/^Modules: /, "") })}
                    placeholder="Customer Service, CRM, Communication"
                  />
                </Field>
              </div>
            );
          })()}

          {target === "languages" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase text-muted-foreground">Languages</Label>
                <button
                  onClick={() => setForm({ ...form, languages: [...form.languages, { id: uid("l"), name: "New language", proficiency: "fluent" } as ResumeLanguage & { note?: string }] })}
                  className="text-xs px-2 py-1 rounded bg-brand text-white hover:bg-brand-dark flex items-center gap-1"
                >
                  <Icon name="Plus" className="w-3 h-3" /> Add
                </button>
              </div>
              {form.languages.map((l, i) => (
                <div key={l.id} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2">
                  <Input
                    value={l.name}
                    onChange={(v) => setForm({ ...form, languages: form.languages.map((x, j) => j === i ? { ...x, name: v } : x) })}
                    placeholder="English"
                  />
                  <select
                    value={l.proficiency}
                    onChange={(e) => setForm({ ...form, languages: form.languages.map((x, j) => j === i ? { ...x, proficiency: e.target.value as any } : x) })}
                    className="h-9 px-2 rounded-md border border-input bg-background text-sm"
                  >
                    <option value="basic">Basic</option>
                    <option value="conversational">Conversational</option>
                    <option value="fluent">Fluent</option>
                    <option value="native">Native</option>
                  </select>
                  <Input
                    value={(l as any).note ?? ""}
                    onChange={(v) => setForm({ ...form, languages: form.languages.map((x, j) => j === i ? { ...x, ...({ note: v } as any) } : x) })}
                    placeholder="Optional note (e.g. 'Effective written communication')"
                  />
                  <button
                    onClick={() => setForm({ ...form, languages: form.languages.filter((_, j) => j !== i) })}
                    className="text-destructive hover:bg-destructive/10 px-2 rounded"
                  >
                    <Icon name="Trash2" className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-end gap-2">
          <Button onClick={onClose} variant="outline">Cancel</Button>
          <Button onClick={save} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name="Save" className="w-4 h-4" /> Save changes
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Lightweight styled input + textarea primitives (avoid shadcn import juggling here) */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <label className={`block font-medium ${className ?? ""}`}>{children}</label>;
}
function Input({ value, onChange, placeholder, onFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; onFocus?: () => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onFocus={onFocus}
      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
function TextArea({ value, onChange, rows, placeholder, onFocus }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; onFocus?: () => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows ?? 4}
      placeholder={placeholder}
      onFocus={onFocus}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
function Button({ children, onClick, variant, className }: { children: React.ReactNode; onClick?: () => void; variant?: "outline" | "default"; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 h-9 rounded-md text-sm font-medium transition ${
        variant === "outline"
          ? "border border-border bg-card hover:bg-secondary"
          : "bg-brand text-white hover:bg-brand-dark"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

function groupSkillsByCategory(skills: ResumeData["skills"]): { category: string; items: string[] }[] {
  const map = new Map<string, string[]>();
  for (const s of skills) {
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
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(name);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

function fmtDateInfohas(d?: string): string {
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
