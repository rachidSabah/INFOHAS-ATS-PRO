"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI } from "@/lib/ai";
import { exportCoverLetterPDF, exportCoverLetterDOCX, exportCoverLetterTXT } from "@/lib/exporter";
import { toast } from "sonner";
import type { CoverLetter } from "@/lib/types";

const TEMPLATES = [
  { id: "modern", name: "Modern", desc: "Clean, conversational, today's default." },
  { id: "traditional", name: "Traditional", desc: "Formal, structured, classic recruiter format." },
  { id: "executive", name: "Executive", desc: "Strategic, outcomes-led, for senior roles." },
  { id: "email", name: "Short Email", desc: "180 words. Paste into the body of an email." },
] as const;

export function CoverLetter() {
  const coverLetters = useApp((s) => s.coverLetters);
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const addCoverLetter = useApp((s) => s.addCoverLetter);
  const updateCoverLetter = useApp((s) => s.updateCoverLetter);
  const removeCoverLetter = useApp((s) => s.removeCoverLetter);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const [activeId, setActiveId] = useState<string>(coverLetters[0]?.id ?? "");
  const [generating, setGenerating] = useState(false);

  const active = coverLetters.find((c) => c.id === activeId) ?? null;

  const generate = async (template: typeof TEMPLATES[number]["id"]) => {
    setGenerating(true);
    try {
      const resume = resumes[0];
      const jd = jds[0];
      const result = await callAI({
        systemPrompt: `You are an expert cover letter writer. Write a ${template === "email" ? "short email-style cover letter (~180 words)" : template === "executive" ? "executive cover letter (~300 words, strategic and outcomes-led)" : template === "traditional" ? "traditional, formal cover letter (~280 words)" : "modern, conversational cover letter (~280 words)"} for the candidate. Open with a specific, non-generic hook. Close with a confident CTA. Plain text only — no Markdown.`,
        userPrompt: `Candidate resume:\n${resume ? JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, experience: resume.experience.map(e => ({ title: e.title, company: e.company, bullets: e.bullets })) }) : "(no resume)"}\n\nJob description:\n${jd ? jd.rawText ?? JSON.stringify({ title: jd.title, company: jd.company, responsibilities: jd.responsibilities }) : "(no JD — use the candidate's resume to suggest a generic role)"}\n\nWrite the cover letter now.`,
        maxTokens: 1200,
      });

      const cl: CoverLetter = {
        id: uid("cl"),
        title: `Cover Letter — ${jd?.company ?? "Target Company"}`,
        template,
        content: result.text,
        resumeId: resume?.id,
        jdId: jd?.id,
        company: jd?.company,
        role: jd?.title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addCoverLetter(cl);
      setActiveId(cl.id);
      incUsage("coverLetters");
      log({ actor: "you", action: "Cover letter generated", category: "ai", details: `${template} template via ${result.provider}`, severity: "info" });
      toast.success(`Cover letter generated via ${result.provider}.`);
    } catch (e: any) {
      toast.error(e?.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const updateContent = (content: string) => {
    if (!active) return;
    updateCoverLetter(active.id, { content });
  };

  if (!active) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Mail" className="w-6 h-6 text-brand" /> Cover Letter Generator</h1>
          <p className="text-sm text-muted-foreground mt-1">Four templates. AI-drafted, fully editable. Export to PDF / DOCX / TXT.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {TEMPLATES.map((t) => (
            <Card key={t.id} className="hover:shadow-premium transition cursor-pointer" >
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Icon name={t.id === "email" ? "Mail" : t.id === "executive" ? "Crown" : "FileText"} className="w-4 h-4 text-brand" /> {t.name}</CardTitle>
                <CardDescription className="text-xs">{t.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => generate(t.id)} disabled={generating} className="w-full bg-brand hover:bg-brand-dark text-white gap-2">
                  {generating ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />} Generate
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Mail" className="w-6 h-6 text-brand" /> Cover Letter Generator</h1>
          <p className="text-sm text-muted-foreground mt-1">Edit the draft, then export in your preferred format.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { removeCoverLetter(active.id); setActiveId(coverLetters.find(c => c.id !== active.id)?.id ?? ""); toast.success("Deleted."); }}>
            <Icon name="Trash2" className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCoverLetterTXT(active)} className="gap-1.5"><Icon name="FileText" className="w-3.5 h-3.5" /> TXT</Button>
          <Button variant="outline" size="sm" onClick={() => { exportCoverLetterDOCX(active); incUsage("downloads"); toast.success("DOCX exported."); }} className="gap-1.5"><Icon name="FileType" className="w-3.5 h-3.5" /> DOCX</Button>
          <Button size="sm" onClick={() => { exportCoverLetterPDF(active); incUsage("downloads"); log({ actor: "you", action: "Cover letter exported (PDF)", category: "export", details: `${active.title}.pdf`, severity: "info" }); toast.success("PDF exported."); }} className="bg-brand hover:bg-brand-dark text-white gap-1.5"><Icon name="Download" className="w-3.5 h-3.5" /> PDF</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 space-y-3">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Edit</CardTitle>
                <Badge variant="outline" className="capitalize">{active.template}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Title">
                  <Input value={active.title} onChange={(e) => updateCoverLetter(active.id, { title: e.target.value })} />
                </Field>
                <Field label="Company">
                  <Input value={active.company ?? ""} onChange={(e) => updateCoverLetter(active.id, { company: e.target.value })} />
                </Field>
              </div>
              <Field label="Content">
                <Textarea
                  value={active.content}
                  onChange={(e) => updateContent(e.target.value)}
                  rows={18}
                  className="font-serif text-[15px] leading-relaxed"
                />
                <p className="text-xs text-muted-foreground mt-1">{active.content.split(/\s+/).length} words</p>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Generate another</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t) => (
                  <Button key={t.id} size="sm" variant="outline" onClick={() => generate(t.id)} disabled={generating} className="gap-1.5">
                    {generating ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Sparkles" className="w-3.5 h-3.5" />} {t.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        <div className="lg:col-span-5">
          <div className="sticky top-20">
            <div className="rounded-xl bg-secondary/60 p-4 max-h-[calc(100vh-160px)] overflow-y-auto">
              <div className="a4-page !w-full !min-h-0 !max-h-none p-[16mm]" style={{ transformOrigin: "top" }}>
                <div className="text-[10pt] leading-relaxed text-slate-800" style={{ fontFamily: active.template === "executive" ? "Georgia, serif" : "'Inter', sans-serif" }}>
                  <div className="border-b-2 pb-3 mb-4" style={{ borderColor: "#1154A3" }}>
                    <div className="text-[14pt] font-bold text-slate-900">{active.title}</div>
                    {active.role && active.company && <div className="text-[10pt] text-slate-600 mt-0.5">{active.role} at {active.company}</div>}
                    <div className="text-[9pt] text-slate-500 mt-1">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
                  </div>
                  {active.content.split(/\n\s*\n/).map((p, i) => (
                    <p key={i} className="mb-3 text-pretty">{p.trim()}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Saved letters */}
      <Card>
        <CardHeader><CardTitle className="text-base">All cover letters ({coverLetters.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {coverLetters.map((c) => (
              <button key={c.id} onClick={() => setActiveId(c.id)} className={`text-left rounded-lg border p-3 transition ${c.id === active.id ? "border-brand bg-brand-light/40" : "border-border hover:border-brand/40"}`}>
                <div className="font-semibold text-sm truncate">{c.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 capitalize">{c.template} · {c.content.split(/\s+/).length} words</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
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
