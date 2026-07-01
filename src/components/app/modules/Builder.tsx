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
import { useAutoSave, useUndoRedo, useLiveATSScore } from "@/lib/builder-hooks";
import { TEMPLATES } from "@/lib/brand";
import { SmartTextarea } from "@/components/shared/SmartTextarea";
import { SpellCheckPanel } from "@/components/shared/SpellCheckPanel";
import { useSectionCompleteness } from "@/lib/builder-extras";
import { blankResume, parseResumeFile } from "@/lib/parser";
import { exportResumePDF, exportResumeDOCX, exportResumeTXT, exportResumeDOC } from "@/lib/exporter";
import { assertResumeExportable } from "@/lib/resume-guardian-agent";
import { A4Preview } from "@/components/resume/A4Preview";
import { ATSMatchMeter } from "@/components/optimizer/ATSMatchMeter";
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
  const jobDescriptions = useApp((s) => s.jobDescriptions);

  const resume = useMemo(() => resumes.find((r) => r.id === activeId) ?? resumes[0], [resumes, activeId]);
  const autoSave = useAutoSave(resume);
  const undoRedo = useUndoRedo(resume);
  const activeJD = jobDescriptions.find(j => j.id === useApp.getState().activeJdId);
  const atsScore = useLiveATSScore(resume, activeJD);
  const sectionScores = useSectionCompleteness(resume);

  const patch = (p: Partial<ResumeData>) => updateResume(resume.id, p);
  const [tab, setTab] = useState<"basics" | "experience" | "education" | "skills" | "extra" | "design">("basics");
  const [scale, setScale] = useState(0.6);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [spellCheckOpen, setSpellCheckOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Responsive scaling — tuned for mobile readability
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w < 480) setScale(0.38);       // small phones
      else if (w < 768) setScale(0.45);  // large phones / small tablets
      else if (w < 1280) setScale(0.55); // tablets
      else setScale(0.7);                // desktop
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
    assertResumeExportable(resume);
    setExporting(true);
    await new Promise((r) => setTimeout(r, 100));
    const result = await exportResumePDF(resume, { enforceOnePage: true });
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
      assertResumeExportable(resume);
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
    assertResumeExportable(resume);
    exportResumeTXT(resume);
    incUsage("downloads");
    log({ actor: "you", action: "Exported resume (TXT)", category: "export", details: `${resume.name}_resume.txt`, severity: "info" });
    toast.success("TXT exported.");
  };
  const onExportDOC = () => {
    assertResumeExportable(resume);
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
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="FilePlus2" className="w-6 h-6 text-brand" /> Resume Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-1 hidden sm:block">Edit on the left, see the live A4 preview on the right. Always one page.</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {atsScore && (
              <Badge variant={atsScore.overall >= 60 ? "default" : atsScore.overall >= 30 ? "default" : "danger"} className="text-[10px] gap-1">
                <Icon name="Target" className="w-3 h-3" /> ATS: {atsScore.overall}%
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] gap-1">
              <Icon name="Save" className="w-3 h-3" /> Auto-saved
            </Badge>
            <button onClick={() => { const d = undoRedo.undo(); if (d) patch(d); }} disabled={!undoRedo.canUndo} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30 p-1" title="Undo">
              <Icon name="Undo2" className="w-3 h-3" />
            </button>
            <button onClick={() => { const d = undoRedo.redo(); if (d) patch(d); }} disabled={!undoRedo.canRedo} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30 p-1" title="Redo">
              <Icon name="Redo2" className="w-3 h-3" />
            </button>
            <Button
              variant={spellCheckOpen ? "default" : "outline"}
              size="sm"
              onClick={() => setSpellCheckOpen(v => !v)}
              className={`gap-1.5 h-8 text-xs ${spellCheckOpen ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
              title="Check spelling across your entire resume"
            >
              <Icon name="SpellCheck2" className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Spelling</span>
            </Button>
          </div>
        </div>
        {/* Export buttons — compact on mobile, full labels on desktop */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <select
            value={resume.id}
            onChange={(e) => setActiveResume(e.target.value)}
            className="h-8 px-2 rounded-md border border-input bg-background text-xs sm:text-sm max-w-[140px] sm:max-w-none"
          >
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {/* Import button — accepts PDF/DOCX/DOC/TXT, parses into all fields */}
          <input ref={importFileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={(e) => onImport(e.target.files)} />
          <Button variant="outline" size="sm" onClick={() => importFileRef.current?.click()} disabled={importing} className="gap-1.5 border-brand text-brand hover:bg-brand-light h-8" title="Import a resume from PDF, DOCX, or TXT — extracts all fields automatically">
            {importing ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Upload" className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Import</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onExportTXT} className="gap-1.5 h-8" title="Export as plain text">
            <Icon name="FileText" className="w-3.5 h-3.5" /> <span className="hidden sm:inline">TXT</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onExportDOC} className="gap-1.5 h-8" title="Strict A4 one-page Word document (Times New Roman 12pt)">
            <Icon name="FileText" className="w-3.5 h-3.5" /> <span className="hidden sm:inline">DOC</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onExportDOCX} disabled={exporting} className="gap-1.5 h-8">
            <Icon name="FileType" className="w-3.5 h-3.5" /> <span className="hidden sm:inline">DOCX</span>
          </Button>
          <Button size="sm" onClick={onExportPDF} disabled={exporting} className="bg-brand hover:bg-brand-dark text-white gap-1.5 h-8">
            {exporting ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Download" className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">PDF</span>
          </Button>
        </div>
      </div>

      <SpellCheckPanel
        resume={resume}
        open={spellCheckOpen}
        onToggle={() => setSpellCheckOpen(v => !v)}
      />

      <div className="grid lg:grid-cols-12 gap-4">
        {/* Editor */}
        <div className="lg:col-span-7 space-y-4">
          {/* Tab nav — horizontal scroll on mobile, full width on desktop */}
          <div className="flex gap-2 overflow-x-auto mb-2">
            {sectionScores.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 text-xs shrink-0" title={s.tips.join("; ")}>
                <Icon name={s.icon} className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium">{s.label}</span>
                <span className={s.score >= s.max ? "text-emerald-500 font-bold" : s.score > 0 ? "text-amber-500" : "text-muted-foreground"}>{s.score}/{s.max}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-1 p-1 bg-secondary rounded-lg overflow-x-auto scrollbar-thin">
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
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition whitespace-nowrap shrink-0 ${tab === k ? "bg-card shadow-sm text-brand" : "text-muted-foreground hover:text-foreground"}`}
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
                    <SmartTextarea
                      value={resume.summary ?? ""}
                      onChange={(v) => patch({ summary: v })}
                      section="summary"
                      resume={resume}
                      jobDescriptionText={activeJD?.rawText}
                      rows={4}
                      placeholder="2-3 lines highlighting years of experience, core expertise, and a measurable outcome."
                    />
                    <p className="text-xs text-muted-foreground mt-1">{((resume.summary ?? "").split(/\s+/).filter(Boolean).length)} words ({ (resume.summary ?? "").length} chars) — aim for 80-120.</p>
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
                        {e.bullets.map((bullet, bIdx) => (
                          <div key={bIdx} className="mb-1.5">
                            <SmartTextarea
                              value={bullet}
                              onChange={(v) => {
                                const newBullets = [...e.bullets];
                                newBullets[bIdx] = v;
                                updateExperience(e.id, { bullets: newBullets });
                              }}
                              section="bullet"
                              context={e.title}
                              resume={resume}
                              jobDescriptionText={activeJD?.rawText}
                              rows={2}
                              placeholder="Managed a cross-functional team, reducing delivery times by 34%"
                              className="text-sm"
                            />
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] gap-1 text-brand"
                          onClick={() => updateExperience(e.id, { bullets: [...e.bullets, ""] })}
                        >
                          <Icon name="Plus" className="w-3 h-3" /> Add bullet
                        </Button>
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
          <div className="lg:sticky lg:top-20 space-y-3">
            {/* ATS Match Meter — real-time keyword scoring */}
            <ATSMatchMeter
              resume={resume}
              jd={jobDescriptions.length > 0 ? jobDescriptions[jobDescriptions.length - 1] : null}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="Eye" className="w-4 h-4 text-brand" />
                <span className="text-sm font-semibold">Live A4 preview</span>
              </div>
              <Badge variant={onePageStatus.ok ? "success" : "warning"} className="text-[10px]">
                <Icon name={onePageStatus.ok ? "CheckCircle2" : "AlertTriangle"} className="w-3 h-3" />
                <span className="hidden sm:inline">{onePageStatus.msg}</span>
                <span className="sm:hidden">{onePageStatus.ok ? "OK" : "Tight"}</span>
              </Badge>
            </div>
            <div className="rounded-xl bg-secondary/60 p-2 sm:p-4 overflow-auto" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <div className="flex justify-center">
                <A4Preview resume={resume} scale={scale} ref={previewRef} />
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Icon name="Lock" className="w-3 h-3" />
              <span className="hidden sm:inline">Export enforces <code className="px-1 rounded bg-muted">maxPages = 1</code> — auto-compresses if needed.</span>
              <span className="sm:hidden">1-page enforced on export</span>
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
