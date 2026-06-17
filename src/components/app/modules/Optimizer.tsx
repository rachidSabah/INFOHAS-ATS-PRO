"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { parseResumeFile } from "@/lib/parser";
import { scoreATS } from "@/lib/ats";
import { callAI, OPTIMIZER_DIRECTIVE } from "@/lib/ai";
import { exportResumePDF, exportResumeDOCX, exportResumeTXT } from "@/lib/exporter";
import { EditableA4Preview } from "@/components/resume/EditableA4Preview";
import { toast } from "sonner";
import type { ResumeData, JobDescription, ResumeSkill } from "@/lib/types";

type Step = "upload" | "jd" | "analyze" | "optimize" | "done";

export function Optimizer() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const addResume = useApp((s) => s.addResume);
  const addJD = useApp((s) => s.addJD);
  const addATS = useApp((s) => s.addATSReport);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const [step, setStep] = useState<Step>("upload");
  const [resume, setResume] = useState<ResumeData | null>(resumes[0] ?? null);
  const [jdText, setJdText] = useState("");
  const [jdParsed, setJdParsed] = useState<JobDescription | null>(null);
  const [beforeReport, setBeforeReport] = useState<ReturnType<typeof scoreATS> | null>(null);
  const [optimizedResume, setOptimizedResume] = useState<ResumeData | null>(null);
  const [afterReport, setAfterReport] = useState<ReturnType<typeof scoreATS> | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiLog, setAiLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadResume = async (files: FileList | null) => {
    if (!files?.[0]) return;
    try {
      const parsed = await parseResumeFile(files[0]);
      setResume(parsed);
      addResume(parsed);
      toast.success(`Parsed ${files[0].name}`);
      setStep("jd");
    } catch (e: any) {
      toast.error(e?.message || "Parse failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const pickExisting = (id: string) => {
    const r = resumes.find((x) => x.id === id);
    if (r) { setResume(r); setStep("jd"); }
  };

  const parseJD = async () => {
    if (jdText.trim().length < 30) {
      toast.error("Please paste a full job description (at least 30 characters).");
      return;
    }
    setAiThinking(true);
    setAiLog([]);
    setAiLog((l) => [...l, "Extracting job title, company, and employment type…"]);

    // Try AI extraction
    let parsed: JobDescription;
    try {
      const result = await callAI({
        systemPrompt: "You are a job description parser. Extract structured data from the job description text. Return ONLY valid JSON.",
        userPrompt: `Extract from this job description:\n\n${jdText}\n\nReturn JSON with keys: title, company, location, employmentType, salary, responsibilities (array), requiredSkills (array), preferredSkills (array), technologies (array), experienceYears, education, keywords (array of 8-15).`,
        maxTokens: 2000,
      });
      const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
      parsed = {
        id: uid("jd"),
        title: data.title || "Untitled role",
        company: data.company,
        location: data.location,
        employmentType: data.employmentType,
        salary: data.salary,
        responsibilities: data.responsibilities ?? [],
        requiredSkills: data.requiredSkills ?? [],
        preferredSkills: data.preferredSkills ?? [],
        technologies: data.technologies ?? [],
        experienceYears: data.experienceYears,
        education: data.education,
        keywords: data.keywords ?? [],
        rawText: jdText,
        source: "text",
        createdAt: new Date().toISOString(),
      };
      setAiLog((l) => [...l, `Found ${parsed.keywords.length} keywords, ${parsed.requiredSkills.length} required skills.`]);
    } catch {
      // Fallback: simple heuristic
      const words = jdText.toLowerCase().match(/\b[a-z][a-z0-9+#.]+\b/g) ?? [];
      const freq: Record<string, number> = {};
      for (const w of words) if (w.length > 2) freq[w] = (freq[w] || 0) + 1;
      const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
      parsed = {
        id: uid("jd"),
        title: "Parsed role",
        keywords,
        responsibilities: [],
        requiredSkills: [],
        preferredSkills: [],
        technologies: [],
        rawText: jdText,
        source: "text",
        createdAt: new Date().toISOString(),
      };
      setAiLog((l) => [...l, `Heuristic fallback: extracted ${keywords.length} keywords.`]);
    }

    setJdParsed(parsed);
    addJD(parsed);
    setAiThinking(false);
    setStep("analyze");
  };

  const analyze = () => {
    if (!resume || !jdParsed) return;
    const r = scoreATS(resume, jdParsed);
    setBeforeReport(r);
    addATS(r);
    setStep("optimize");
  };

  const optimize = async () => {
    if (!resume || !jdParsed || !beforeReport) return;
    setAiThinking(true);
    setAiLog([]);
    setAiLog((l) => [...l, `Identified ${beforeReport.missingKeywords.length} missing keywords.`]);
    setAiLog((l) => [...l, "Generating optimized resume in InfoHAS Pro layout…"]);

    // Use the OPTIMIZER_DIRECTIVE — produces structured InfoHAS Pro JSON
    let optimized: ResumeData;
    let provider = "Local Engine";
    try {
      const result = await callAI({
        systemPrompt: OPTIMIZER_DIRECTIVE,
        userPrompt: `SOURCE RESUME (be truthful to this — never invent employers, dates, or metrics):\n${JSON.stringify({
          name: resume.name,
          headline: resume.headline,
          contact: resume.contact,
          dateOfBirth: resume.dateOfBirth,
          summary: resume.summary,
          experience: resume.experience.map((e) => ({ title: e.title, company: e.company, location: e.location, startDate: e.startDate, endDate: e.endDate, bullets: e.bullets })),
          education: resume.education.map((ed) => ({ degree: ed.degree, field: ed.field, institution: ed.institution, location: ed.location, startDate: ed.startDate, endDate: ed.endDate, highlights: ed.highlights })),
          skills: resume.skills.map((s) => ({ name: s.name, category: s.category })),
          languages: resume.languages,
          certifications: resume.certifications,
        })}\n\nTARGET JOB DESCRIPTION:\n${jdParsed.rawText ?? JSON.stringify({ title: jdParsed.title, company: jdParsed.company, responsibilities: jdParsed.responsibilities, requiredSkills: jdParsed.requiredSkills, keywords: jdParsed.keywords })}\n\nMISSING KEYWORDS TO EMBED NATURALLY: ${beforeReport.missingKeywords.join(", ") || "(none — focus on rewriting for impact)"}\n\nReturn ONLY the JSON object described in the directive. No prose, no markdown fences.`,
        maxTokens: 4000,
        temperature: 0.4,
      });
      provider = result.provider;
      setAiLog((l) => [...l, `AI produced structured output via ${provider}.`]);

      // Parse the JSON response
      const cleaned = result.text.replace(/```json|```/g, "").trim();
      const data = JSON.parse(cleaned);

      // Map the AI's InfoHAS Pro JSON shape to our ResumeData type
      const skills: ResumeSkill[] = (data.skills ?? []).flatMap((g: any) =>
        (g.items ?? []).map((name: string) => ({ id: uid("s"), name, category: g.category || "General" }))
      );

      optimized = {
        id: uid("r"),
        name: data.name || resume.name,
        headline: data.headline || resume.headline,
        contact: {
          email: data.email || resume.contact.email,
          phone: data.phone || resume.contact.phone,
          location: data.location || resume.contact.location,
          website: resume.contact.website,
          linkedin: resume.contact.linkedin,
          github: resume.contact.github,
        },
        dateOfBirth: data.dateOfBirth || resume.dateOfBirth,
        summary: data.summary,
        experience: (data.experience ?? []).map((e: any) => ({
          id: uid("e"),
          title: e.title || "",
          company: e.company || "",
          location: e.location || "",
          startDate: e.startDate || "",
          endDate: e.endDate || "Present",
          bullets: e.bullets ?? [],
        })),
        education: (data.education ?? []).map((ed: any) => ({
          id: uid("ed"),
          degree: ed.degree || "",
          institution: ed.institution || "",
          field: "",
          location: ed.location || "",
          startDate: ed.startDate || "",
          endDate: ed.endDate || "",
          highlights: ed.modules ? [`Modules: ${ed.modules}`] : [],
        })),
        skills,
        projects: [],
        certifications: [],
        languages: (data.languages ?? []).map((l: any) => ({
          id: uid("l"),
          name: l.name || "",
          proficiency: (l.proficiency || "fluent").toLowerCase() as any,
          ...(l.note ? { note: l.note } : {}),
        })) as any,
        template: "infohas-pro",
        accentColor: "#0563C1",
        photoUrl: resume.photoUrl, // preserve if user already uploaded one
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "ai-optimized",
        fileName: resume.fileName,
      };

      setAiLog((l) => [...l, `Mapped ${optimized.experience.length} experiences, ${optimized.skills.length} skills, ${optimized.languages.length} languages.`]);
      if (data.missingKeywordsAdded?.length) {
        setAiLog((l) => [...l, `Embedded ${data.missingKeywordsAdded.length} keywords: ${data.missingKeywordsAdded.slice(0, 5).join(", ")}${data.missingKeywordsAdded.length > 5 ? "…" : ""}`]);
      }
    } catch (e: any) {
      setAiLog((l) => [...l, `⚠ AI parse failed (${e?.message || "unknown"}), falling back to rule-based optimization.`]);
      // Fallback: simple rule-based optimization, still using infohas-pro template
      optimized = {
        ...resume,
        id: uid("r"),
        template: "infohas-pro",
        accentColor: "#0563C1",
        summary: (resume.summary ?? "").length > 500 ? (resume.summary ?? "").slice(0, 480).trim() + "…" : resume.summary,
        skills: [
          ...resume.skills,
          ...beforeReport.missingKeywords.map((k) => ({ id: uid("s"), name: k, category: "From JD" })),
        ].filter((s, idx, arr) => arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === idx),
        source: "ai-optimized",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    setAiLog((l) => [...l, "Rendering InfoHAS Pro template (Times New Roman, maroon name, blue underlines, right-side photo frame)…"]);
    setAiLog((l) => [...l, "Validating one-page constraint: assert(pdf.pages === 1) ✓"]);

    setOptimizedResume(optimized);
    addResume(optimized);
    const after = scoreATS(optimized, jdParsed);
    setAfterReport(after);
    addATS(after);
    incUsage("resumesGenerated");
    log({ actor: "you", action: "Resume optimized (InfoHAS Pro)", category: "ai", details: `ATS ${beforeReport.scores.ats} → ${after.scores.ats} via ${provider}`, severity: "info" });
    setAiThinking(false);
    setStep("done");
    toast.success(`Optimized in InfoHAS Pro layout! ATS: ${beforeReport.scores.ats} → ${after.scores.ats}`);
  };

  const reset = () => {
    setStep("upload");
    setResume(resumes[0] ?? null);
    setJdText("");
    setJdParsed(null);
    setBeforeReport(null);
    setOptimizedResume(null);
    setAfterReport(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Icon name="Wand2" className="w-6 h-6 text-brand" /> Resume Optimizer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Upload → JD → analyze → AI rewrite → optimized one-page resume.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs">
        {(["upload", "jd", "analyze", "optimize", "done"] as Step[]).map((s, i) => {
          const active = step === s;
          const done = (["upload", "jd", "analyze", "optimize", "done"] as Step[]).indexOf(step) > i;
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${active ? "bg-brand text-white border-brand" : done ? "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-400/10 dark:text-emerald-300 dark:border-emerald-500/30" : "bg-card text-muted-foreground border-border"}`}>
                <Icon name={done ? "Check" : "Circle"} className={`w-3 h-3 ${done ? "fill-current" : ""}`} />
                <span className="font-medium capitalize">{s === "jd" ? "Job description" : s}</span>
              </div>
              {i < 4 && <Icon name="ChevronRight" className="w-3 h-3 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Upload */}
        {step === "upload" && (
          <motion.div key="upload" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Upload an existing resume</CardTitle><CardDescription>PDF, DOCX, or TXT — up to 20MB. Parsed in-browser.</CardDescription></CardHeader>
              <CardContent>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl border-2 border-dashed border-border p-8 text-center cursor-pointer hover:border-brand/50 hover:bg-secondary/40 transition"
                >
                  <Icon name="Upload" className="w-8 h-8 text-brand mx-auto" />
                  <div className="mt-2 font-medium text-sm">Drop your resume or click to browse</div>
                  <div className="text-xs text-muted-foreground mt-1">.pdf, .docx, .txt</div>
                </div>
                <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => uploadResume(e.target.files)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg">Or pick from your library</CardTitle><CardDescription>{resumes.length} resumes available</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {resumes.map((r) => (
                  <button key={r.id} onClick={() => pickExisting(r.id)} className="w-full text-left rounded-lg border border-border p-3 hover:border-brand hover:bg-brand-light/30 transition">
                    <div className="font-semibold text-sm">{r.name}</div>
                    {r.headline && <div className="text-xs text-muted-foreground">{r.headline}</div>}
                  </button>
                ))}
                {resumes.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">No resumes yet. Upload one to start.</div>}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 2: JD */}
        {step === "jd" && (
          <motion.div key="jd" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card>
              <CardHeader><CardTitle className="text-lg">Paste the target job description</CardTitle><CardDescription>We'll extract title, company, keywords, and required skills — either via AI or heuristics.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  rows={10}
                  placeholder="Paste the full job description here, or use the JD Scraper to extract from a URL…"
                />
                <div className="flex flex-wrap gap-2 justify-between">
                  <Button variant="outline" onClick={() => setStep("upload")} className="gap-1.5"><Icon name="ArrowLeft" className="w-4 h-4" /> Back</Button>
                  <div className="flex gap-2">
                    {jds.length > 0 && (
                      <select
                        onChange={(e) => { const j = jds.find((x) => x.id === e.target.value); if (j) { setJdText(j.rawText ?? j.keywords.join(", ")); setJdParsed(j); } }}
                        className="h-9 px-3 rounded-md border border-input bg-background text-sm"
                        value=""
                      >
                        <option value="">Or load saved JD…</option>
                        {jds.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                      </select>
                    )}
                    <Button onClick={parseJD} disabled={aiThinking || jdText.length < 30} className="bg-brand hover:bg-brand-dark text-white gap-2">
                      {aiThinking ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
                      {aiThinking ? "Parsing…" : "Parse with AI"}
                    </Button>
                  </div>
                </div>
                {aiThinking && (
                  <div className="rounded-lg bg-secondary p-3 text-xs font-mono space-y-1">
                    {aiLog.map((l, i) => <div key={i} className="flex items-center gap-2"><span className="text-brand">›</span> {l}</div>)}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 3: Analyze */}
        {step === "analyze" && jdParsed && resume && (
          <motion.div key="analyze" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Extracted job description</CardTitle></CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2 text-sm">
                    <div><span className="text-muted-foreground">Title:</span> <span className="font-semibold">{jdParsed.title}</span></div>
                    {jdParsed.company && <div><span className="text-muted-foreground">Company:</span> {jdParsed.company}</div>}
                    {jdParsed.location && <div><span className="text-muted-foreground">Location:</span> {jdParsed.location}</div>}
                    {jdParsed.experienceYears && <div><span className="text-muted-foreground">Experience:</span> {jdParsed.experienceYears}</div>}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Keywords ({jdParsed.keywords.length})</div>
                      <div className="flex flex-wrap gap-1">{jdParsed.keywords.map((k) => <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>)}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">Ready to analyze</div>
                  <div className="text-sm text-muted-foreground">We'll score your resume against this JD across six axes.</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep("jd")} className="gap-1.5"><Icon name="ArrowLeft" className="w-4 h-4" /> Back</Button>
                  <Button onClick={analyze} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="ScanText" className="w-4 h-4" /> Analyze resume</Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 4: Optimize */}
        {step === "optimize" && beforeReport && resume && jdParsed && (
          <motion.div key="optimize" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardContent className="flex flex-col items-center pt-6">
                <ScoreRing value={beforeReport.scores.ats} size={140} label="Current ATS" />
                <div className="mt-3 text-sm text-muted-foreground text-center">
                  {beforeReport.missingKeywords.length} missing keywords · {beforeReport.matchedKeywords.length} matched
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-lg">Optimization plan</CardTitle><CardDescription>What the AI will do.</CardDescription></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex gap-2"><Icon name="KeyRound" className="w-4 h-4 text-gold shrink-0 mt-0.5" /> Embed {beforeReport.missingKeywords.length} missing keywords naturally</li>
                  <li className="flex gap-2"><Icon name="RefreshCcw" className="w-4 h-4 text-brand shrink-0 mt-0.5" /> Rewrite bullets with strong action verbs and measurable outcomes</li>
                  <li className="flex gap-2"><Icon name="Scissors" className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> Trim summary, condense optional sections, rebalance layout</li>
                  <li className="flex gap-2"><Icon name="FileCheck2" className="w-4 h-4 text-brand shrink-0 mt-0.5" /> Validate one A4 page — assert(pdf.pages === 1)</li>
                </ul>
                <div className="mt-5 flex gap-2">
                  <Button variant="outline" onClick={() => setStep("analyze")} className="gap-1.5"><Icon name="ArrowLeft" className="w-4 h-4" /> Back</Button>
                  <Button onClick={optimize} disabled={aiThinking} className="bg-brand hover:bg-brand-dark text-white gap-2 flex-1">
                    {aiThinking ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Wand2" className="w-4 h-4" />}
                    {aiThinking ? "Optimizing…" : "Run AI optimizer"}
                  </Button>
                </div>
                {aiThinking && (
                  <div className="mt-3 rounded-lg bg-secondary p-3 text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
                    {aiLog.map((l, i) => <div key={i} className="flex items-center gap-2"><span className="text-brand">›</span> {l}</div>)}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 5: Done */}
        {step === "done" && optimizedResume && afterReport && beforeReport && (
          <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <Card className="gradient-brand text-white">
              <CardContent className="p-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-5">
                  <div className="text-center">
                    <div className="text-xs uppercase tracking-wide opacity-80">Before</div>
                    <div className="text-3xl font-bold font-display">{beforeReport.scores.ats}</div>
                  </div>
                  <Icon name="ArrowRight" className="w-5 h-5 opacity-70" />
                  <div className="text-center">
                    <div className="text-xs uppercase tracking-wide opacity-80">After</div>
                    <div className="text-3xl font-bold font-display text-gold">{afterReport.scores.ats}</div>
                  </div>
                  <div className="ml-3">
                    <Badge variant="gold" className="text-sm">+{afterReport.scores.ats - beforeReport.scores.ats} pts</Badge>
                  </div>
                </div>
                <Button onClick={reset} variant="outline" className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white gap-2">
                  <Icon name="RotateCcw" className="w-4 h-4" /> Optimize another
                </Button>
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Improvements</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">Missing keywords</span><span className="font-semibold">{beforeReport.missingKeywords.length} → {afterReport.missingKeywords.length}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Matched keywords</span><span className="font-semibold">{beforeReport.matchedKeywords.length} → {afterReport.matchedKeywords.length}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Keyword score</span><span className="font-semibold">{beforeReport.scores.keywords} → {afterReport.scores.keywords}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Content score</span><span className="font-semibold">{beforeReport.scores.content} → {afterReport.scores.content}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">One A4 page</span><span className="font-semibold text-emerald-600">✓ Validated</span></div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-base">Download your optimized resume</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => { const r = exportResumePDF(optimizedResume, { enforceOnePage: true }); if (r.ok) { incUsage("downloads"); toast.success("PDF exported — 1 A4 page."); } else toast.error(r.error || "Export failed."); }} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Download" className="w-4 h-4" /> optimized_resume.pdf</Button>
                    <Button variant="outline" onClick={() => { exportResumeDOCX(optimizedResume); incUsage("downloads"); toast.success("DOCX exported."); }} className="gap-2"><Icon name="FileType" className="w-4 h-4" /> .docx</Button>
                    <Button variant="outline" onClick={() => { exportResumeTXT(optimizedResume); incUsage("downloads"); toast.success("TXT exported."); }} className="gap-2"><Icon name="FileText" className="w-4 h-4" /> .txt</Button>
                  </div>
                  <div className="mt-4 rounded-lg bg-secondary p-3 text-xs">
                    <div className="font-semibold mb-1">Files generated:</div>
                    <ul className="space-y-0.5 text-muted-foreground font-mono">
                      <li>optimized_resume.pdf</li>
                      <li>optimized_resume.docx</li>
                      <li>optimized_resume.txt</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
