"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { TEMPLATES } from "@/lib/brand";
import { A4Preview } from "@/components/resume/A4Preview";
import { exportResumePDF, exportResumeDOCX, exportResumeTXT, exportResumeDOC } from "@/lib/exporter";
import { blankResume, parseResumeFile } from "@/lib/parser";
import { toast } from "sonner";
import type { ResumeData, ResumeExperience, ResumeEducation, ResumeSkill, ResumeTemplate } from "@/lib/types";

const ACCENT_PRESETS = ["#1154A3", "#0B1F3A", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#0EA5E9", "#DC2626"];

export function Builder() {
  const resumes = useApp((s) => s.resumes);
  const activeId = useApp((s) => s.activeResumeId);
  const updateResume = useApp((s) => s.updateResume);
  const addResume = useApp((s) => s.addResume);
  const setActiveResume = useApp((s) => s.setActiveResume);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const resume = useMemo(() => resumes.find((r) => r.id === activeId) ?? resumes[0], [resumes, activeId]);

  const [tab, setTab] = useState<"basics" | "experience" | "education" | "skills" | "extra" | "design">("basics");
  const [scale, setScale] = useState(0.6);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Responsive scaling
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w < 768) setScale(0.45);
      else if (w < 1280) setScale(0.55);
      else setScale(0.7);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!resume) {
    return (
      <div className="text-center py-20">
        <Icon name="FileText" className="w-12 h-12 text-muted-foreground/40 mx-auto" />
        <h2 className="mt-3 text-lg font-semibold">No resume selected</h2>
        <p className="text-sm text-muted-foreground mt-1">Start a new resume to begin.</p>
        <Button className="mt-4 bg-brand hover:bg-brand-dark text-white gap-2" onClick={() => { const r = blankResume(); addResume(r); setActiveResume(r.id); }}>
          <Icon name="Plus" className="w-4 h-4" /> New resume
        </Button>
      </div>
    );
  }

  const patch = (p: Partial<ResumeData>) => updateResume(resume.id, p);

  const addExperience = () => patch({
    experience: [...resume.experience, { id: uid("e"), company: "", title: "", startDate: "", endDate: "Present", bullets: [""] }],
  });
  const updateExperience = (id: string, p: Partial<ResumeExperience>) =>
    patch({ experience: resume.experience.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const removeExperience = (id: string) => patch({ experience: resume.experience.filter((e) => e.id !== id) });

  const addEducation = () => patch({
    education: [...resume.education, { id: uid("ed"), institution: "", degree: "", startDate: "", endDate: "" }],
  });
  const updateEducation = (id: string, p: Partial<ResumeEducation>) =>
    patch({ education: resume.education.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const removeEducation = (id: string) => patch({ education: resume.education.filter((e) => e.id !== id) });

  const addSkill = () => patch({ skills: [...resume.skills, { id: uid("s"), name: "", category: "" }] });
  const updateSkill = (id: string, p: Partial<ResumeSkill>) =>
    patch({ skills: resume.skills.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const removeSkill = (id: string) => patch({ skills: resume.skills.filter((s) => s.id !== id) });

  const onExportPDF = async () => {
    setExporting(true);
    await new Promise((r) => setTimeout(r, 100));
    const result = exportResumePDF(resume, { enforceOnePage: true });
    setExporting(false);
    if (result.ok) {
      incUsage("downloads");
      log({ actor: "you", action: "Exported resume (PDF)", category: "export", details: `${resume.name}_resume.pdf · 1 page`, severity: "info" });
      toast.success("PDF exported. Validated: 1 A4 page.");
    } else {
      toast.error(result.error || "Export failed.");
    }
  };
  const onExportDOCX = async () => {
    setExporting(true);
    try {
      await exportResumeDOCX(resume);
      incUsage("downloads");
      log({ actor: "you", action: "Exported resume (DOCX)", category: "export", details: `${resume.name}_resume.docx`, severity: "info" });
      toast.success("DOCX exported.");
    } catch (e: any) {
      toast.error(e?.message || "DOCX export failed.");
    } finally {
      setExporting(false);
    }
  };
  const onExportTXT = () => {
    exportResumeTXT(resume);
    incUsage("downloads");
    log({ actor: "you", action: "Exported resume (TXT)", category: "export", details: `${resume.name}_resume.txt`, severity: "info" });
    toast.success("TXT exported.");
  };
  const onExportDOC = () => {
    const template = resume.template === "modern" ? "modern" : resume.template === "minimal" || resume.template === "ats-professional" ? "minimal" : "professional";
    exportResumeDOC(resume, template as any);
    incUsage("downloads");
    log({ actor: "you", action: "Exported resume (DOC — strict A4)", category: "export", details: `${resume.name}_resume.doc · Times New Roman 12pt · @page A4`, severity: "info" });
    toast.success("DOC exported — strict A4 one-page layout.");
  };

  // === Import resume from file ===
  const onImport = async (files: FileList | null) => {
    if (!files?.[0]) return;
    const file = files[0];
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large. Maximum 20MB.");
      return;
    }
    setImporting(true);
    try {
      const parsed = await parseResumeFile(file);
      // Patch all fields into the current resume
      updateResume(resume.id, {
        name: parsed.name,
        headline: parsed.headline,
        contact: parsed.contact,
        summary: parsed.summary,
        experience: parsed.experience,
        education: parsed.education,
        skills: parsed.skills,
        projects: parsed.projects,
        certifications: parsed.certifications,
        languages: parsed.languages,
        dateOfBirth: parsed.dateOfBirth,
        source: "upload",
        fileName: file.name,
      });
      setTab("basics"); // Switch to Basics tab so user can review
      toast.success(`Imported "${file.name}" — ${parsed.experience.length} experiences, ${parsed.skills.length} skills, ${parsed.education.length} education entries extracted.`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to parse file.");
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  // Rough one-page estimate based on content volume
  const contentLen = (resume.summary?.length || 0) +
    resume.experience.reduce((n, e) => n + e.bullets.join(" ").length, 0) +
    resume.skills.length * 8;
  const onePageStatus = contentLen < 2200 ? { ok: true, msg: "Comfortably fits one A4 page" } :
    contentLen < 3000 ? { ok: true, msg: "Fits one A4 page (tight)" } :
    { ok: false, msg: "May overflow — auto-compress will activate on export" };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="FilePlus2" className="w-6 h-6 text-brand" /> Resume Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Edit on the left, see the live A4 preview on the right. Always one page.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={resume.id}
            onChange={(e) => setActiveResume(e.target.value)}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
          >
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {/* Import button — accepts PDF/DOCX/DOC/TXT, parses into all fields */}
          <input ref={importFileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={(e) => onImport(e.target.files)} />
          <Button variant="outline" size="sm" onClick={() => importFileRef.current?.click()} disabled={importing} className="gap-1.5 border-brand text-brand hover:bg-brand-light" title="Import a resume from PDF, DOCX, or TXT — extracts all fields automatically">
            {importing ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Upload" className="w-3.5 h-3.5" />} Import
          </Button>
          <Button variant="outline" size="sm" onClick={onExportTXT} className="gap-1.5">
            <Icon name="FileText" className="w-3.5 h-3.5" /> TXT
          </Button>
          <Button variant="outline" size="sm" onClick={onExportDOC} className="gap-1.5" title="Strict A4 one-page Word document (Times New Roman 12pt)">
            <Icon name="FileText" className="w-3.5 h-3.5" /> DOC
          </Button>
          <Button variant="outline" size="sm" onClick={onExportDOCX} disabled={exporting} className="gap-1.5">
            <Icon name="FileType" className="w-3.5 h-3.5" /> DOCX
          </Button>
          <Button size="sm" onClick={onExportPDF} disabled={exporting} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
            {exporting ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Download" className="w-3.5 h-3.5" />} PDF
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        {/* Editor */}
        <div className="lg:col-span-7 space-y-4">
          {/* Tab nav */}
          <div className="flex flex-wrap gap-1 p-1 bg-secondary rounded-lg">
            {[
              ["basics", "Basics", "User"],
              ["experience", "Experience", "Briefcase"],
              ["education", "Education", "GraduationCap"],
              ["skills", "Skills", "Wrench"],
              ["extra", "Extra", "Sparkles"],
              ["design", "Design", "Palette"],
            ].map(([k, label, icon]) => (
              <button
                key={k}
                onClick={() => setTab(k as any)}
                className={`flex-1 min-w-[80px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition ${tab === k ? "bg-card shadow-sm text-brand" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon name={icon} className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="p-5">
              {tab === "basics" && (
                <div className="space-y-4">
                  <h3 className="font-semibold flex items-center gap-2"><Icon name="User" className="w-4 h-4 text-brand" /> Basic info</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Full name"><Input value={resume.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
                    <Field label="Headline / target role"><Input value={resume.headline ?? ""} onChange={(e) => patch({ headline: e.target.value })} placeholder="Senior Frontend Engineer" /></Field>
                    <Field label="Email"><Input value={resume.contact.email ?? ""} onChange={(e) => patch({ contact: { ...resume.contact, email: e.target.value } })} /></Field>
                    <Field label="Phone"><Input value={resume.contact.phone ?? ""} onChange={(e) => patch({ contact: { ...resume.contact, phone: e.target.value } })} placeholder="+1-415-555-0182" /></Field>
                    <Field label="Location"><Input value={resume.contact.location ?? ""} onChange={(e) => patch({ contact: { ...resume.contact, location: e.target.value } })} placeholder="San Francisco, CA" /></Field>
                    <Field label="Website"><Input value={resume.contact.website ?? ""} onChange={(e) => patch({ contact: { ...resume.contact, website: e.target.value } })} placeholder="alexmorgan.dev" /></Field>
                    <Field label="LinkedIn"><Input value={resume.contact.linkedin ?? ""} onChange={(e) => patch({ contact: { ...resume.contact, linkedin: e.target.value } })} placeholder="linkedin.com/in/..." /></Field>
                    <Field label="GitHub"><Input value={resume.contact.github ?? ""} onChange={(e) => patch({ contact: { ...resume.contact, github: e.target.value } })} placeholder="github.com/..." /></Field>
                  </div>
                  <Field label="Professional summary">
                    <Textarea
                      value={resume.summary ?? ""}
                      onChange={(e) => patch({ summary: e.target.value })}
                      rows={4}
                      placeholder="2-3 lines highlighting years of experience, core expertise, and a measurable outcome."
                    />
                    <p className="text-xs text-muted-foreground mt-1">{(resume.summary ?? "").length} chars — aim for under 500.</p>
                  </Field>
                </div>
              )}

              {tab === "experience" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2"><Icon name="Briefcase" className="w-4 h-4 text-brand" /> Experience</h3>
                    <Button size="sm" variant="outline" onClick={addExperience} className="gap-1.5"><Icon name="Plus" className="w-3.5 h-3.5" /> Add</Button>
                  </div>
                  {resume.experience.map((e, idx) => (
                    <div key={e.id} className="rounded-xl border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">#{idx + 1}</span>
                        <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={() => removeExperience(e.id)}>
                          <Icon name="Trash2" className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Title"><Input value={e.title} onChange={(ev) => updateExperience(e.id, { title: ev.target.value })} placeholder="Senior Engineer" /></Field>
                        <Field label="Company"><Input value={e.company} onChange={(ev) => updateExperience(e.id, { company: ev.target.value })} placeholder="Acme Inc." /></Field>
                        <Field label="Start (YYYY-MM)"><Input value={e.startDate} onChange={(ev) => updateExperience(e.id, { startDate: ev.target.value })} placeholder="2022-03" /></Field>
                        <Field label="End"><Input value={e.endDate} onChange={(ev) => updateExperience(e.id, { endDate: ev.target.value })} placeholder="Present or 2024-08" /></Field>
                      </div>
                      <Field label="Bullets (one per line — start with an action verb and a number)">
                        <Textarea
                          value={e.bullets.join("\n")}
                          onChange={(ev) => updateExperience(e.id, { bullets: ev.target.value.split("\n") })}
                          rows={4}
                          placeholder={"Led migration to Next.js, cutting build times by 62%\nShipped design system used by 28 engineers"}
                        />
                      </Field>
                    </div>
                  ))}
                  {resume.experience.length === 0 && <EmptyState icon="Briefcase" label="No experience yet" />}
                </div>
              )}

              {tab === "education" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2"><Icon name="GraduationCap" className="w-4 h-4 text-brand" /> Education</h3>
                    <Button size="sm" variant="outline" onClick={addEducation} className="gap-1.5"><Icon name="Plus" className="w-3.5 h-3.5" /> Add</Button>
                  </div>
                  {resume.education.map((ed) => (
                    <div key={ed.id} className="rounded-xl border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">{ed.institution || "Untitled"}</span>
                        <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={() => removeEducation(ed.id)}>
                          <Icon name="Trash2" className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Institution"><Input value={ed.institution} onChange={(ev) => updateEducation(ed.id, { institution: ev.target.value })} /></Field>
                        <Field label="Degree"><Input value={ed.degree} onChange={(ev) => updateEducation(ed.id, { degree: ev.target.value })} placeholder="B.S." /></Field>
                        <Field label="Field"><Input value={ed.field ?? ""} onChange={(ev) => updateEducation(ed.id, { field: ev.target.value })} placeholder="Computer Science" /></Field>
                        <Field label="GPA (optional)"><Input value={ed.gpa ?? ""} onChange={(ev) => updateEducation(ed.id, { gpa: ev.target.value })} placeholder="3.8" /></Field>
                        <Field label="Start"><Input value={ed.startDate} onChange={(ev) => updateEducation(ed.id, { startDate: ev.target.value })} placeholder="2014-09" /></Field>
                        <Field label="End"><Input value={ed.endDate} onChange={(ev) => updateEducation(ed.id, { endDate: ev.target.value })} placeholder="2018-05" /></Field>
                      </div>
                    </div>
                  ))}
                  {resume.education.length === 0 && <EmptyState icon="GraduationCap" label="No education yet" />}
                </div>
              )}

              {tab === "skills" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2"><Icon name="Wrench" className="w-4 h-4 text-brand" /> Skills</h3>
                    <Button size="sm" variant="outline" onClick={addSkill} className="gap-1.5"><Icon name="Plus" className="w-3.5 h-3.5" /> Add</Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {resume.skills.map((s) => (
                      <div key={s.id} className="flex gap-2">
                        <Input value={s.name} onChange={(ev) => updateSkill(s.id, { name: ev.target.value })} placeholder="React" />
                        <Input value={s.category ?? ""} onChange={(ev) => updateSkill(s.id, { category: ev.target.value })} placeholder="Frontend" className="w-32" />
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeSkill(s.id)}>
                          <Icon name="X" className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  {resume.skills.length === 0 && <EmptyState icon="Wrench" label="No skills yet" />}
                </div>
              )}

              {tab === "extra" && (
                <div className="space-y-4">
                  <h3 className="font-semibold flex items-center gap-2"><Icon name="Sparkles" className="w-4 h-4 text-brand" /> Projects, certifications, languages</h3>
                  <Field label="Projects (one per line: Name — Description)">
                    <Textarea
                      value={resume.projects.map((p) => `${p.name} — ${p.description ?? ""}`).join("\n")}
                      onChange={(e) => patch({
                        projects: e.target.value.split("\n").filter(Boolean).map((line) => {
                          const [name, ...rest] = line.split("—");
                          return { id: uid("p"), name: name?.trim() ?? "", description: rest.join("—").trim(), bullets: [] };
                        }),
                      })}
                      rows={3}
                      placeholder="OpenResumeKit — Open-source ATS-friendly resume library"
                    />
                  </Field>
                  <Field label="Certifications (one per line: Name — Issuer — YYYY-MM)">
                    <Textarea
                      value={resume.certifications.map((c) => `${c.name}${c.issuer ? " — " + c.issuer : ""}${c.date ? " — " + c.date : ""}`).join("\n")}
                      onChange={(e) => patch({
                        certifications: e.target.value.split("\n").filter(Boolean).map((line) => {
                          const [name, issuer, date] = line.split("—").map((s) => s?.trim());
                          return { id: uid("c"), name: name ?? "", issuer, date };
                        }),
                      })}
                      rows={3}
                      placeholder="AWS Certified — Amazon — 2023-08"
                    />
                  </Field>
                  <Field label="Languages (one per line: Name — proficiency)">
                    <Textarea
                      value={resume.languages.map((l) => `${l.name} — ${l.proficiency}`).join("\n")}
                      onChange={(e) => patch({
                        languages: e.target.value.split("\n").filter(Boolean).map((line) => {
                          const [name, prof] = line.split("—").map((s) => s?.trim());
                          return { id: uid("l"), name: name ?? "", proficiency: (prof as any) ?? "fluent" };
                        }),
                      })}
                      rows={2}
                      placeholder="English — native&#10;Spanish — conversational"
                    />
                  </Field>
                </div>
              )}

              {tab === "design" && (
                <div className="space-y-5">
                  <h3 className="font-semibold flex items-center gap-2"><Icon name="Palette" className="w-4 h-4 text-brand" /> Template & design</h3>
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Template</Label>
                    <div className="grid sm:grid-cols-2 gap-2 mt-2">
                      {TEMPLATES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => patch({ template: t.id as ResumeTemplate })}
                          className={`text-left rounded-lg border p-3 transition ${resume.template === t.id ? "border-brand bg-brand-light/40" : "border-border hover:border-brand/40"}`}
                        >
                          <div className="font-semibold text-sm">{t.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Accent color</Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {ACCENT_PRESETS.map((c) => (
                        <button
                          key={c}
                          onClick={() => patch({ accentColor: c })}
                          className={`w-8 h-8 rounded-full border-2 transition ${resume.accentColor === c ? "border-foreground scale-110" : "border-transparent"}`}
                          style={{ background: c }}
                          aria-label={`Accent ${c}`}
                        />
                      ))}
                      <label className="w-8 h-8 rounded-full border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-brand">
                        <input
                          type="color"
                          value={resume.accentColor ?? "#1154A3"}
                          onChange={(e) => patch({ accentColor: e.target.value })}
                          className="opacity-0 absolute w-0 h-0"
                        />
                        <Icon name="Pipette" className="w-3.5 h-3.5 text-muted-foreground" />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        <div className="lg:col-span-5">
          <div className="sticky top-20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="Eye" className="w-4 h-4 text-brand" />
                <span className="text-sm font-semibold">Live A4 preview</span>
              </div>
              <Badge variant={onePageStatus.ok ? "success" : "warning"} className="text-[10px]">
                <Icon name={onePageStatus.ok ? "CheckCircle2" : "AlertTriangle"} className="w-3 h-3" />
                {onePageStatus.msg}
              </Badge>
            </div>
            <div className="rounded-xl bg-secondary/60 p-4 overflow-auto" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <div className="flex justify-center">
                <A4Preview resume={resume} scale={scale} ref={previewRef} />
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Icon name="Lock" className="w-3 h-3" />
              Export enforces <code className="px-1 rounded bg-muted">maxPages = 1</code> — auto-compresses if needed.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function EmptyState({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="text-center py-8 rounded-xl border border-dashed border-border">
      <Icon name={icon} className="w-8 h-8 text-muted-foreground/40 mx-auto" />
      <p className="text-sm text-muted-foreground mt-2">{label}</p>
    </div>
  );
}
