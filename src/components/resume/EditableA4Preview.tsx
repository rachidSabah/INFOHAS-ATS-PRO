"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@/components/shared";
import type { ResumeData, ResumeLanguage } from "@/lib/types";
import { uid, useApp } from "@/lib/store";

/**
 * Safely render any value as a string. Prevents React error #31
 * ("Objects are not valid as a React child") when the AI returns an
 * object (e.g. { city: "Doha", country: "Qatar" }) where a string is
 * expected.
 */
function safeRender(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => safeRender(x)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const values = Object.values(v).filter((x) => x !== null && x !== undefined && x !== "");
    if (values.length > 0) return values.map((x) => safeRender(x)).join(", ");
    return "";
  }
  return String(v);
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

export function EditableA4Preview({ resume, onChange, scale = 0.7, className }: EditableA4PreviewProps) {
  const [editing, setEditing] = useState<EditTarget>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isTouch = useIsTouchDevice();
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
          <EditableBlock isEditing={editing === "header"} onEdit={() => setEditing("header")} label="Edit header" isTouch={isTouch}>
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
              {resume.headline && <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.5mm", lineHeight: 1.2 }}>{safeRender(resume.headline)}</div>}
              <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>
                {[safeRender(resume.contact.location), safeRender(resume.contact.phone)].filter(Boolean).join(" | ")}
              </div>
              {resume.contact.email && <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>{safeRender(resume.contact.email)}</div>}
              {resume.dateOfBirth && <div style={{ fontSize: `${L.bodyFontSizePt}pt`, color: BLACK, marginBottom: "0.3mm", lineHeight: 1.2 }}>Date of Birth: {safeRender(resume.dateOfBirth)}</div>}
            </header>
          </EditableBlock>

          {/* ============ BODY ============ */}
          {/* Compact gap from header to first section */}
          <div style={{ marginTop: "3mm" }}>
            {/* SUMMARY */}
            {resume.summary && (
              <EditableBlock isEditing={editing === "summary"} onEdit={() => setEditing("summary")} label="Edit summary" isTouch={isTouch}>
                <InfohasSection title="PROFESSIONAL PROFILE">
                  <p style={{ margin: 0, textAlign: "justify", color: BLACK, lineHeight: 1.2 }}>{safeRender(resume.summary)}</p>
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
                    onEdit={() => setEditing(`experience:${e.id}`)}
                    label="Edit experience"
                    isTouch={isTouch}
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
                          <li key={i} style={{ marginBottom: 0, color: BLACK, textAlign: "justify", lineHeight: 1.2 }}>{safeRender(b)}</li>
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
                <SectionDividerInline title="EDUCATION" />
                {resume.education.slice(0, 3).map((ed) => (
                  <EditableBlock
                    key={ed.id}
                    isEditing={editing === `education:${ed.id}`}
                    onEdit={() => setEditing(`education:${ed.id}`)}
                    label="Edit education"
                    isTouch={isTouch}
                  >
                    <div style={{ marginBottom: "1mm", lineHeight: 1.2 }}>
                      <div style={{ lineHeight: 1.2, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "2mm" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 700, color: BLACK }}>{safeRender(ed.degree)}</span>
                          {ed.institution && <span style={{ color: BLACK }}> | {safeRender(ed.institution)}</span>}
                          {ed.location && <span style={{ color: BLACK }}> | {safeRender(ed.location)}</span>}
                        </span>
                        {(ed.startDate || ed.endDate) && (
                          <span style={{ color: BLACK, whiteSpace: "nowrap", flexShrink: 0 }}>
                            {fmtDateInfohas(ed.startDate)} – {fmtDateInfohas(ed.endDate)}
                          </span>
                        )}
                      </div>
                  {ed.highlights && ed.highlights.length > 0 && (
                    <ul style={{ margin: "0.3mm 0 0 0", paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                      {ed.highlights.map((h, i) => (
                        <li key={i} style={{ color: BLACK, lineHeight: 1.2, textAlign: "justify" }}>{safeRender(h)}</li>
                      ))}
                    </ul>
                  )}
                    </div>
                  </EditableBlock>
                ))}
              </>
            )}

            {/* KEY COMPETENCIES (moved after Education to match target format) */}
            {resume.skills.length > 0 && (
              <EditableBlock isEditing={editing === "skills"} onEdit={() => setEditing("skills")} label="Edit skills" isTouch={isTouch}>
                <InfohasSection title="KEY COMPETENCIES">
                  <ul style={{ margin: 0, paddingLeft: `${L.bulletIndentMm}mm`, listStyleType: "•", lineHeight: 1.2 }}>
                    {groupSkillsByCategory(resume.skills).slice(0, 4).map((g, i) => (
                      <li key={i} style={{ marginBottom: 0, color: BLACK, lineHeight: 1.2, textAlign: "justify" }}>
                        <span style={{ fontWeight: 700 }}>{safeRender(g.category)}:</span> <span>{g.items.map((item: any) => safeRender(item)).join(", ")}.</span>
                      </li>
                    ))}
                  </ul>
                </InfohasSection>
              </EditableBlock>
            )}

            {/* LANGUAGES — single line format */}
            {resume.languages.length > 0 && (
              <EditableBlock isEditing={editing === "languages"} onEdit={() => setEditing("languages")} label="Edit languages" isTouch={isTouch}>
                <InfohasSection title="LANGUAGES">
                  <div style={{ color: BLACK, lineHeight: 1.2 }}>
                    • {resume.languages.map((l) => safeRender(l.name)).join(", ")}
                  </div>
                </InfohasSection>
              </EditableBlock>
            )}
          </div>
        </div>
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
}: {
  isEditing: boolean;
  onEdit: () => void;
  label: string;
  children: React.ReactNode;
  isTouch?: boolean;
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
      onClick={isTouch && !isEditing ? onEdit : undefined}
    >
      {children}
      {/* Pencil FAB — hidden only while editing (the editor modal takes over).
          On touch devices it is always visible; on desktop it appears on hover. */}
      {!isEditing && (
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

/** Inline editor drawer — slides up from bottom on desktop, full-screen on mobile */
function EditorDrawer({ target, resume, onClose, onCommit }: {
  target: EditTarget;
  resume: ResumeData;
  onClose: () => void;
  onCommit: (p: Partial<ResumeData>) => void;
}) {
  // local form state — keyed by target so it resets when target changes (controlled via key prop from parent)
  const [form, setForm] = useState<ResumeData>(resume);

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
                <Field label="Full name"><Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
                <Field label="Headline"><Input value={form.headline ?? ""} onChange={(v) => setForm({ ...form, headline: v })} /></Field>
                <Field label="Location"><Input value={form.contact.location ?? ""} onChange={(v) => setForm({ ...form, contact: { ...form.contact, location: v } })} /></Field>
                <Field label="Phone"><Input value={form.contact.phone ?? ""} onChange={(v) => setForm({ ...form, contact: { ...form.contact, phone: v } })} /></Field>
                <Field label="Email"><Input value={form.contact.email ?? ""} onChange={(v) => setForm({ ...form, contact: { ...form.contact, email: v } })} /></Field>
                <Field label="Date of birth (DD/MM/YYYY)"><Input value={form.dateOfBirth ?? ""} onChange={(v) => setForm({ ...form, dateOfBirth: v })} placeholder="10/01/2005" /></Field>
              </div>
            </div>
          )}

          {target === "summary" && (
            <Field label="Professional summary (60-90 words)">
              <TextArea
                value={form.summary ?? ""}
                onChange={(v) => setForm({ ...form, summary: v })}
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
                  <Field label="Job title"><Input value={e.title} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, title: v } : x) })} /></Field>
                  <Field label="Company"><Input value={e.company} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, company: v } : x) })} /></Field>
                  <Field label="Location"><Input value={e.location ?? ""} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, location: v } : x) })} /></Field>
                  <Field label="Start (Mon YYYY)"><Input value={e.startDate} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, startDate: v } : x) })} placeholder="May 2024" /></Field>
                  <Field label="End"><Input value={e.endDate} onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, endDate: v } : x) })} placeholder="Oct 2024 or Present" /></Field>
                </div>
                <Field label="Achievement bullets (one per line — start with action verbs)">
                  <TextArea
                    value={e.bullets.join("\n")}
                    onChange={(v) => setForm({ ...form, experience: form.experience.map((x) => x.id === id ? { ...x, bullets: v.split("\n") } : x) })}
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
                  <Field label="Degree"><Input value={ed.degree} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, degree: v } : x) })} /></Field>
                  <Field label="Institution"><Input value={ed.institution} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, institution: v } : x) })} /></Field>
                  <Field label="Location"><Input value={ed.location ?? ""} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, location: v } : x) })} /></Field>
                  <Field label="Start"><Input value={ed.startDate} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, startDate: v } : x) })} placeholder="2024" /></Field>
                  <Field label="End"><Input value={ed.endDate} onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, endDate: v } : x) })} placeholder="2025" /></Field>
                </div>
                <Field label="Modules (one line, comma-separated)">
                  <Input
                    value={(ed.highlights ?? []).join(", ").replace(/^Modules: /, "")}
                    onChange={(v) => setForm({ ...form, education: form.education.map((x) => x.id === id ? { ...x, highlights: v.trim() ? [`Modules: ${v.replace(/^Modules: /, "")}`] : [] } : x) })}
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
function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
function TextArea({ value, onChange, rows, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows ?? 4}
      placeholder={placeholder}
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
    const cat = s.category || "General";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(s.name);
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
