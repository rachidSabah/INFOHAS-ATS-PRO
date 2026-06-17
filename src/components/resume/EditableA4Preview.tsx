"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@/components/shared";
import type { ResumeData, ResumeExperience, ResumeEducation, ResumeLanguage } from "@/lib/types";
import { uid } from "@/lib/store";

/**
 * EditableA4Preview — InfoHAS Pro template with live inline editing.
 *
 * Every section has a pencil icon that, on click, opens an editor for that section.
 * Photo frame is also clickable — opens file picker to upload a profile photo.
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

const MAROON = "#660033";
const BLUE = "#0563C1";

export function EditableA4Preview({ resume, onChange, scale = 0.7, className }: EditableA4PreviewProps) {
  const [editing, setEditing] = useState<EditTarget>(null);
  const [draft, setDraft] = useState<ResumeData>(resume);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(resume), [resume]);

  const patch = (p: Partial<ResumeData>) => {
    const next = { ...draft, ...p, updatedAt: new Date().toISOString() };
    setDraft(next);
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

      <div
        className="a4-page origin-top relative"
        style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
      >
        <div
          className="relative text-slate-800"
          style={{
            fontFamily: "'Times New Roman', 'Georgia', serif",
            fontSize: "10.5pt",
            lineHeight: 1.32,
            padding: "12mm 12mm",
            minHeight: "297mm",
          }}
        >
          {/* ============ HEADER (editable) ============ */}
          <EditableBlock isEditing={editing === "header"} onEdit={() => setEditing("header")} label="Edit header">
            <header className="relative" style={{ minHeight: "82mm", paddingRight: "60mm" }}>
              {/* Photo frame */}
              <button
                onClick={() => fileRef.current?.click()}
                className="group"
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  width: "54mm",
                  height: "81mm",
                  border: `1.2pt solid ${BLUE}`,
                  background: draft.photoUrl ? "transparent" : "#F8FAFC",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  cursor: "pointer",
                  boxSizing: "border-box",
                  padding: 0,
                }}
                title="Click to upload profile photo"
              >
                {draft.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.photoUrl} alt={draft.name} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
                ) : (
                  <div style={{ textAlign: "center", color: "#94A3B8", fontSize: "8pt", padding: "4mm" }} className="group-hover:text-brand">
                    <div style={{ fontSize: "18pt", marginBottom: "2mm" }}>👤</div>
                    <div className="font-medium">Click to add photo</div>
                    <div className="text-[7pt] opacity-70 mt-1">54 × 81 mm portrait</div>
                  </div>
                )}
                {/* Pencil overlay */}
                <div
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  style={{ pointerEvents: "none" }}
                >
                  <Icon name="Pencil" className="w-3 h-3" />
                </div>
              </button>

              <div style={{ color: MAROON, fontWeight: 700, fontSize: "16pt", letterSpacing: "0.3pt", marginBottom: "1.5mm", lineHeight: 1.1 }}>
                {(draft.name || "YOUR NAME").toUpperCase()}
              </div>
              {draft.headline && <div style={{ fontSize: "11pt", color: "#1F2937", marginBottom: "2mm" }}>{draft.headline}</div>}
              <div style={{ fontSize: "10pt", color: "#374151", marginBottom: "0.5mm" }}>
                {[draft.contact.location, draft.contact.phone].filter(Boolean).join(" | ")}
              </div>
              {draft.contact.email && <div style={{ fontSize: "10pt", color: "#374151", marginBottom: "0.5mm" }}>{draft.contact.email}</div>}
              {draft.dateOfBirth && <div style={{ fontSize: "10pt", color: "#374151", marginBottom: "0.5mm" }}>Date Of Birth : {draft.dateOfBirth}</div>}
              <div style={{ marginTop: "1.5mm", width: "52mm", height: "1pt", background: BLUE }} />
            </header>
          </EditableBlock>

          {/* ============ BODY ============ */}
          <div style={{ marginTop: "4mm" }}>
            {/* SUMMARY */}
            {draft.summary && (
              <EditableBlock isEditing={editing === "summary"} onEdit={() => setEditing("summary")} label="Edit summary">
                <InfohasSection title="PROFESSIONAL SUMMARY" blue={BLUE}>
                  <p style={{ margin: 0, textAlign: "justify", color: "#1F2937" }}>{draft.summary}</p>
                </InfohasSection>
              </EditableBlock>
            )}

            {/* SKILLS */}
            {draft.skills.length > 0 && (
              <EditableBlock isEditing={editing === "skills"} onEdit={() => setEditing("skills")} label="Edit skills">
                <InfohasSection title="CORE COMPETENCIES & SKILLS" blue={BLUE}>
                  <ul style={{ margin: 0, paddingLeft: "5mm", listStyleType: "•" }}>
                    {groupSkillsByCategory(draft.skills).map((g, i) => (
                      <li key={i} style={{ marginBottom: "1mm", color: "#1F2937" }}>
                        <span style={{ fontWeight: 700 }}>{g.category}:</span> <span>{g.items.join(", ")}.</span>
                      </li>
                    ))}
                  </ul>
                </InfohasSection>
              </EditableBlock>
            )}

            {/* EXPERIENCE — section header once, then all entries */}
            {draft.experience.length > 0 && (
              <>
                <SectionDividerInline title="PROFESSIONAL EXPERIENCE" blue={BLUE} />
                {draft.experience.map((e) => (
                  <EditableBlock
                    key={e.id}
                    isEditing={editing === `experience:${e.id}`}
                    onEdit={() => setEditing(`experience:${e.id}`)}
                    label="Edit experience"
                  >
                    <div style={{ marginBottom: "2mm" }}>
                      <div style={{ marginBottom: "0.5mm" }}>
                        <span style={{ fontWeight: 700, color: "#1F2937" }}>{e.title}</span>{" "}
                        <span style={{ color: "#1F2937" }}>{e.company}</span>
                        {e.location && <span style={{ color: "#1F2937" }}> | {e.location}</span>}
                        {"  "}
                        <span style={{ color: "#1F2937" }}>{fmtDateInfohas(e.startDate)} – {fmtDateInfohas(e.endDate)}</span>
                      </div>
                      <ul style={{ margin: 0, paddingLeft: "5mm", listStyleType: "•" }}>
                        {e.bullets.map((b, i) => (
                          <li key={i} style={{ marginBottom: "0.5mm", color: "#1F2937", textAlign: "justify" }}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  </EditableBlock>
                ))}
              </>
            )}

            {/* EDUCATION — section header once, then all entries */}
            {draft.education.length > 0 && (
              <>
                <SectionDividerInline title="EDUCATION" blue={BLUE} />
                {draft.education.map((ed) => (
                  <EditableBlock
                    key={ed.id}
                    isEditing={editing === `education:${ed.id}`}
                    onEdit={() => setEditing(`education:${ed.id}`)}
                    label="Edit education"
                  >
                    <div style={{ marginBottom: "1.5mm" }}>
                      <div>
                        <span style={{ fontWeight: 700, color: "#1F2937" }}>{ed.degree}</span>{" "}
                        <span style={{ color: "#1F2937" }}>{ed.institution}</span>
                        {(ed.location || ed.startDate || ed.endDate) && (
                          <span style={{ color: "#1F2937" }}>
                            {" | "}
                            {[ed.location, ed.startDate && ed.endDate ? `${fmtDateInfohas(ed.startDate)} – ${fmtDateInfohas(ed.endDate)}` : ed.startDate || ed.endDate].filter(Boolean).join(" | ")}
                          </span>
                        )}
                      </div>
                  {ed.highlights && ed.highlights.length > 0 && (
                    <ul style={{ margin: "0.5mm 0 0 0", paddingLeft: "5mm", listStyleType: "•" }}>
                      {ed.highlights.map((h, i) => (
                        <li key={i} style={{ color: "#1F2937" }}>{h}</li>
                      ))}
                    </ul>
                  )}
                    </div>
                  </EditableBlock>
                ))}
              </>
            )}

            {/* LANGUAGES */}
            {draft.languages.length > 0 && (
              <EditableBlock isEditing={editing === "languages"} onEdit={() => setEditing("languages")} label="Edit languages">
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                  {draft.languages.map((l) => (
                    <div key={l.id} style={{ color: "#1F2937" }}>
                      <span style={{ fontWeight: 700 }}>{l.name}:</span>{" "}
                      <span style={{ textTransform: "capitalize" }}>{l.proficiency}</span>
                      {(l as any).note ? <span> ({(l as any).note})</span> : null}
                    </div>
                  ))}
                </div>
              </EditableBlock>
            )}
          </div>
        </div>
      </div>

      {/* ============ EDITOR DRAWER ============ */}
      <AnimatePresence>
        {editing && (
          <EditorDrawer
            target={editing}
            resume={draft}
            onClose={() => setEditing(null)}
            onCommit={commit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Wrapper that shows a pencil on hover and toggles editing */
function EditableBlock({ isEditing, onEdit, label, children }: { isEditing: boolean; onEdit: () => void; label: string; children: React.ReactNode }) {
  return (
    <div
      className="group relative"
      style={{ outline: isEditing ? "1pt dashed #0563C1" : "none", outlineOffset: "1mm", transition: "outline 0.15s" }}
    >
      {children}
      {/* Pencil FAB */}
      <button
        onClick={onEdit}
        title={label}
        aria-label={label}
        className="absolute top-0 right-0 w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-glow hover:scale-110 z-10"
        style={{ transform: "translate(35%, -35%)" }}
      >
        <Icon name="Pencil" className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Infohas section header (shared with A4Preview) */
function InfohasSection({ title, blue, children }: { title: string; blue: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "3mm" }}>
      <h2
        style={{
          color: blue,
          fontWeight: 700,
          fontSize: "11pt",
          letterSpacing: "0.4pt",
          margin: "0 0 1.5mm 0",
          paddingBottom: "0.8mm",
          borderBottom: `0.8pt solid ${blue}`,
          textTransform: "uppercase",
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: "10.5pt" }}>{children}</div>
    </section>
  );
}

/** Section header for grouped experience/education entries */
function SectionDividerInline({ title, blue }: { title: string; blue: string }) {
  return (
    <h2
      style={{
        color: blue,
        fontWeight: 700,
        fontSize: "11pt",
        letterSpacing: "0.4pt",
        margin: "3mm 0 1.5mm 0",
        paddingBottom: "0.8mm",
        borderBottom: `0.8pt solid ${blue}`,
        textTransform: "uppercase",
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
  // local form state
  const [form, setForm] = useState<ResumeData>(resume);

  useEffect(() => setForm(resume), [resume]);

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
