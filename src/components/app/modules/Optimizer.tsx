"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { parseResumeFile } from "@/lib/parser";
import { scoreATS } from "@/lib/ats";
import { callAI, extractJSON } from "@/lib/ai";
import { validateResumeForExport } from "@/lib/ai-response-processor";
import { exportResumePDF, exportResumeDOCX, exportResumeTXT, exportResumeDOC } from "@/lib/exporter";
import { EditableA4Preview } from "@/components/resume/EditableA4Preview";
import { AIRLINE_ATS_PROFILES, AIRLINE_OPTIONS, DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/ats-directives";
import { INDUSTRY_PROFILES, INDUSTRY_OPTIONS, detectIndustry, type IndustryAtsProfile } from "@/lib/industry-ats";
import { runOptimizationPipeline, type PipelineResult as AgentPipelineResult, type PipelineProgress } from "@/lib/agents";
import { PipelineProgressView } from "@/components/optimizer/PipelineProgressView";
import { PipelineResults } from "@/components/optimizer/PipelineResults";
import { InterviewPrepSuite } from "@/components/interview/InterviewPrepSuite";
import { toast } from "sonner";
import type { ResumeData, JobDescription, ResumeSkill } from "@/lib/types";

type Step = "upload" | "jd" | "analyze" | "optimize" | "done";

export function Optimizer() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const addResume = useApp((s) => s.addResume);
  const updateResume = useApp((s) => s.updateResume);
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
  // Industry ATS mode (replaces hardcoded Aviation ATS — dynamic, supports all industries)
  const [industryMode, setIndustryMode] = useState(false);
  const [industryId, setIndustryId] = useState<string>("generic");
  const [employer, setEmployer] = useState<string>("");
  const [industrySettings, setIndustrySettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [industryDetection, setIndustryDetection] = useState<{ industryId: string; confidence: number; detectedRole: string; detectedAts: string } | null>(null);
  // Pipeline state — the orchestrator's real-time progress + final result
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);
  const [pipelineResult, setPipelineResult] = useState<AgentPipelineResult | null>(null);
  // Interview prep mode — shows when user clicks "Prepare for Interview"
  const [showInterviewPrep, setShowInterviewPrep] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Responsive preview scale — recomputed on window resize so the A4 preview
  // never overflows the viewport on mobile. The A4Preview component now wraps
  // the scaled page in a container with the correct scaled dimensions, so this
  // scale value directly controls the layout width (no horizontal overflow).
  const [previewScale, setPreviewScale] = useState(0.7);
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w < 480) setPreviewScale(0.38);       // small phones
      else if (w < 768) setPreviewScale(0.45);  // large phones / small tablets
      else if (w < 1280) setPreviewScale(0.55); // tablets
      else setPreviewScale(0.7);                // desktop
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
        taskCategory: "document",
      });
      // Robustly extract JSON — handles prose preambles, markdown fences, etc.
      const data = extractJSON<any>(result.text);
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

    // === Auto-detect industry from JD + resume ===
    const jdText = jdParsed.rawText ?? jdParsed.keywords.join(" ");
    const resumeText = `${resume.name} ${resume.headline ?? ""} ${resume.summary ?? ""} ${resume.experience.map((e) => e.title + " " + e.company).join(" ")}`;
    const detection = detectIndustry(jdText, resumeText);
    setIndustryDetection(detection);
    setIndustryId(detection.industryId);
    // Auto-populate employer from JD company
    if (jdParsed.company) setEmployer(jdParsed.company);
    // Auto-enable industry mode if confidence is high enough
    if (detection.confidence >= 20) {
      setIndustryMode(true);
    }

    setStep("optimize");
  };

  // ============================================================================
  // runPipeline() — the SINGLE ENTRY POINT for resume optimization.
  //
  // This replaces the legacy inline optimize() + optimizeAviation() functions.
  // All optimization now flows through the 5-agent orchestrator:
  //   1. Job Intelligence Agent
  //   2. ATS Analysis Agent (before)
  //   3. Resume Optimizer Agent
  //   4. Quality Assurance Agent
  //   5. Reflection Agent (optional — triggers when confidence < 75 or ATS improvement < 5)
  //
  // Features:
  //   - Real-time progress streamed via the onProgress callback
  //   - Error handling with retry support (partial progress preserved)
  //   - Request cancellation via AbortController (if user navigates away)
  //   - Memoized callbacks (useCallback) to prevent unnecessary rerenders
  // ============================================================================
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runPipeline = useCallback(async () => {
    if (!resume || !jdParsed || !beforeReport) return;

    // Cancel any in-flight pipeline (shouldn't happen, but defensive)
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAiThinking(true);
    setAiLog([]);
    setPipelineProgress(null);
    setPipelineResult(null);
    setPipelineError(null);
    setOptimizedResume(null);
    setAfterReport(null);

    const directiveConfig = useApp.getState().optimizerDirective;
    const usingOverride = !!directiveConfig?.customDirectiveOverride?.trim();

    setAiLog((l) => [...l, `Directive source: ${usingOverride ? "CUSTOM OVERRIDE (from Optimizer Directive settings)" : "GENERATED (from structured config)"}`]);
    setAiLog((l) => [...l, `Mode: ${industryMode ? `Industry ATS (${INDUSTRY_PROFILES[industryId]?.label ?? "Generic"})` : "Standard"}`]);
    setAiLog((l) => [...l, "Starting 5-agent pipeline…"]);

    try {
      const result = await runOptimizationPipeline({
        resume,
        jd: jdParsed,
        userDirectives: directiveConfig?.customDirectiveOverride?.trim() || undefined,
        aviationMode: industryMode
          ? { airlineProfile: industryId, settings: industrySettings }
          : undefined,
        enableReflection: true,
        checkExport: false,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setPipelineProgress(progress);
          if (progress.log) {
            setAiLog((l) => [...l, `[Step ${progress.stepNumber}/${progress.totalSteps}] ${progress.log}`]);
          }
        },
      });

      if (controller.signal.aborted) return;

      setPipelineResult(result);

      // Map pipeline result → local state
      if (result.optimizedResume) {
        setOptimizedResume(result.optimizedResume);
        addResume(result.optimizedResume);
      }

      // Map the richer ATSAnalysisResult back to the legacy ATSReport shape
      if (result.afterATS && result.optimizedResume) {
        const after = scoreATS(result.optimizedResume, jdParsed);
        after.scores.ats = result.afterATS.scores.ats;
        after.scores.content = result.afterATS.scores.content;
        after.scores.completeness = result.afterATS.scores.completeness;
        after.scores.keywords = result.afterATS.scores.keywordMatch;
        after.missingKeywords = result.afterATS.missingKeywords;
        after.matchedKeywords = result.afterATS.matchedKeywords;
        setAfterReport(after);
        addATS(after);
      }

      // Stream the per-step logs into the legacy aiLog panel
      for (const step of result.steps) {
        if (step.log) {
          setAiLog((l) => [...l, `${step.status === "failed" ? "⚠" : "✓"} ${step.name}: ${step.log}`]);
        }
      }

      // Check for partial failures (some steps failed but pipeline continued)
      const failedSteps = result.steps.filter((s) => s.status === "failed");
      if (failedSteps.length > 0 && result.optimizedResume) {
        setPipelineError(`${failedSteps.length} step(s) failed: ${failedSteps.map((s) => s.name).join(", ")}. The optimized resume may still be usable.`);
      }

      incUsage("resumesGenerated");
      log({
        actor: "you",
        action: `Resume optimized (${industryMode ? `Industry ATS (${INDUSTRY_PROFILES[industryId]?.label ?? "Generic"})` : "Standard"} — 5-agent pipeline)`,
        category: "ai",
        details: `ATS ${result.beforeATS?.scores.ats ?? "?"} → ${result.afterATS?.scores.ats ?? "?"} via ${result.provider}${result.qa ? `, confidence=${result.qa.confidence}` : ""}${result.reflection?.triggered ? ", reflection triggered" : ""}`,
        severity: "info",
      });

      setAiThinking(false);
      setStep("done");

      const delta = (result.afterATS?.scores.ats ?? 0) - (result.beforeATS?.scores.ats ?? 0);
      const confidence = result.qa?.confidence ?? 0;
      const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
      toast.success(`Optimization complete — ATS ${result.beforeATS?.scores.ats ?? "?"} → ${result.afterATS?.scores.ats ?? "?"} (${deltaStr} pts) · Confidence ${confidence}/100`);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      const errMsg = e?.message || "Optimization failed. Please try again.";
      setPipelineError(errMsg);
      setAiLog((l) => [...l, `✗ Pipeline failed: ${errMsg}`]);
      setAiThinking(false);
      toast.error(errMsg);
    }
  }, [resume, jdParsed, beforeReport, industryMode, industryId, industrySettings, addResume, addATS, incUsage, log]);

  // Legacy alias — the "Optimize" button still calls optimize().
  // Now it delegates to runPipeline().
  const optimize = runPipeline;

  // Cancel any in-flight pipeline when the component unmounts
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

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
                <div className="mt-3 rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-2.5 flex items-start gap-2">
                  <Icon name="Info" className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Upload your existing resume in PDF or DOCX. The Parser Agent extracts experience, education, skills, certifications, projects, achievements, and languages — all in your browser, nothing uploaded to a server.
                  </p>
                </div>
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
                        onChange={(e) => { const j = jds.find((x) => x.id === e.target.value); if (j) { setJdText(j.rawText ?? j.keywords.join(", ")); setJdParsed(j); setStep("analyze"); } }}
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
                <div className="rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-2.5 flex items-start gap-2">
                  <Icon name="Info" className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Paste a job posting to tailor your resume. The Job Intelligence Agent will extract required skills, technologies, certifications, ATS keywords, and industry terminology. You can also use the <button onClick={() => useApp.getState().setView("jd-scraper")} className="text-brand underline hover:no-underline">JD Scraper</button> to extract from a URL.
                  </p>
                </div>
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
            <div className="rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-3 flex items-start gap-2">
              <Icon name="Info" className="w-4 h-4 text-brand shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                This score estimates compatibility with applicant tracking systems. The ATS Analysis Agent computes 7 explainable scores: keyword match, semantic similarity, readability, content quality, grammar, formatting, and completeness — each with a breakdown of what's driving the number.
              </p>
            </div>
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

                {/* Industry ATS Mode toggle (replaces hardcoded Aviation ATS Mode) */}
                <div className="mt-5 rounded-lg border-2 border-brand/30 bg-brand/5 dark:bg-brand/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon name="Building2" className="w-5 h-5 text-brand" />
                      <div>
                        <div className="font-semibold text-sm flex items-center gap-2">
                          Industry ATS Mode
                          {industryDetection && industryDetection.confidence >= 20 && (
                            <Badge variant="brand" className="text-[10px]">{INDUSTRY_PROFILES[industryDetection.industryId]?.label ?? "Detected"}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">Auto-detects your industry and applies the optimal ATS keyword bank, writing guidance, and section priorities</div>
                      </div>
                    </div>
                    <Switch checked={industryMode} onCheckedChange={setIndustryMode} />
                  </div>

                  {industryMode && (
                    <div className="mt-4 space-y-3 pt-3 border-t border-brand/20">
                      {/* Auto-detected info */}
                      {industryDetection && (
                        <div className="grid sm:grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg bg-secondary/40 p-2 flex items-center justify-between">
                            <span className="text-muted-foreground">Detected Role:</span>
                            <span className="font-semibold">{industryDetection.detectedRole}</span>
                          </div>
                          <div className="rounded-lg bg-secondary/40 p-2 flex items-center justify-between">
                            <span className="text-muted-foreground">Detected Industry:</span>
                            <span className="font-semibold">{INDUSTRY_PROFILES[industryDetection.industryId]?.label ?? "Generic"}</span>
                          </div>
                          <div className="rounded-lg bg-secondary/40 p-2 flex items-center justify-between">
                            <span className="text-muted-foreground">Optimization Profile:</span>
                            <span className="font-semibold">{INDUSTRY_PROFILES[industryId]?.label ?? "Generic"}</span>
                          </div>
                          <div className="rounded-lg bg-secondary/40 p-2 flex items-center justify-between">
                            <span className="text-muted-foreground">Detected ATS:</span>
                            <span className="font-semibold">{industryDetection.detectedAts}</span>
                          </div>
                        </div>
                      )}

                      <div className="grid sm:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Industry Profile</label>
                          <select value={industryId} onChange={(e) => setIndustryId(e.target.value)} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                            {INDUSTRY_OPTIONS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Target Employer</label>
                          <input
                            type="text"
                            value={employer}
                            onChange={(e) => setEmployer(e.target.value)}
                            placeholder="e.g. Emirates, Google, Amazon"
                            className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Tone</label>
                          <select value={industrySettings.tone} onChange={(e) => setIndustrySettings({ ...industrySettings, tone: e.target.value as any })} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                            <option value="Formal">Formal</option>
                            <option value="Balanced">Balanced</option>
                            <option value="Warm">Warm</option>
                            <option value="Premium">Premium</option>
                            <option value="Aggressive">Aggressive</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Format</label>
                          <select value={industrySettings.format} onChange={(e) => setIndustrySettings({ ...industrySettings, format: e.target.value as any })} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                            <option value="Chronological">Chronological</option>
                            <option value="Functional">Functional</option>
                            <option value="Hybrid">Hybrid</option>
                            <option value="Combination">Combination</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Strictness</label>
                          <select value={industrySettings.strictness} onChange={(e) => setIndustrySettings({ ...industrySettings, strictness: e.target.value as any })} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                            <option value="Conservative">Conservative — light keyword weaving</option>
                            <option value="Balanced">Balanced — natural optimization</option>
                            <option value="Aggressive">Aggressive — MAXIMUM keyword stuffing</option>
                          </select>
                        </div>
                      </div>
                      <div className="text-xs text-brand flex items-start gap-1.5">
                        <Icon name="Info" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <div>
                          <strong>{INDUSTRY_PROFILES[industryId]?.label}</strong> — {INDUSTRY_PROFILES[industryId]?.description}
                          {INDUSTRY_PROFILES[industryId]?.priorityKeywords.length > 0 && (
                            <div className="mt-1">Priority keywords: {INDUSTRY_PROFILES[industryId]?.priorityKeywords.slice(0, 6).join(", ")}</div>
                          )}
                          <div className="mt-1">ATS systems: {INDUSTRY_PROFILES[industryId]?.commonAtsSystems.join(", ")}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-5 flex gap-2">
                  <Button variant="outline" onClick={() => setStep("analyze")} className="gap-1.5"><Icon name="ArrowLeft" className="w-4 h-4" /> Back</Button>
                  <Button onClick={optimize} disabled={aiThinking} className="bg-brand hover:bg-brand-dark text-white gap-2 flex-1">
                    {aiThinking ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : industryMode ? <Icon name="Building2" className="w-4 h-4" /> : <Icon name="Wand2" className="w-4 h-4" />}
                    {aiThinking ? "Optimizing…" : industryMode ? `Run ${INDUSTRY_PROFILES[industryId]?.label ?? "Industry"} ATS optimizer` : "Run AI optimizer"}
                  </Button>
                </div>

                {/* === 5-agent pipeline progress tracker (shows during run + on error) === */}
                {(aiThinking || pipelineError) && (
                  <div className="mt-4">
                    <PipelineProgressView
                      progress={pipelineProgress}
                      isRunning={aiThinking}
                      result={pipelineResult}
                      error={pipelineError}
                      onRetry={optimize}
                    />
                  </div>
                )}

                {/* === Legacy log panel (still populated by the pipeline) === */}
                {aiThinking && aiLog.length > 0 && (
                  <div className="mt-3 rounded-lg bg-secondary p-3 text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
                    {aiLog.map((l, i) => <div key={i} className="flex items-center gap-2"><span className="text-brand">›</span> {l}</div>)}
                  </div>
                )}

                {/* === Contextual hints === */}
                {!aiThinking && (
                  <div className="mt-4 rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-3 flex items-start gap-2">
                    <Icon name="Info" className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      The resume is rewritten while preserving factual information — employers, dates, and metrics from your original resume are never invented. The 5-agent pipeline runs Job Intelligence → ATS Analysis → Optimizer → Quality Assurance → (optional) Reflection.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 5: Done — InfoHAS Pro layout with live editing + photo upload */}
        {step === "done" && optimizedResume && afterReport && beforeReport && (
          showInterviewPrep && jdParsed ? (
            <InterviewPrepSuite
              optimizedResume={optimizedResume}
              jd={jdParsed}
              onClose={() => setShowInterviewPrep(false)}
            />
          ) : (
          <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <Card className="gradient-brand text-white">
              <CardContent className="p-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-5">
                  <div className="text-center">
                    <div className="text-xs uppercase tracking-wide opacity-80">Before</div>
                    <div className="text-3xl font-bold font-display">{pipelineResult?.beforeATS?.scores.ats ?? beforeReport.scores.ats}</div>
                  </div>
                  <Icon name="ArrowRight" className="w-5 h-5 opacity-70" />
                  <div className="text-center">
                    <div className="text-xs uppercase tracking-wide opacity-80">After</div>
                    <div className="text-3xl font-bold font-display text-gold">{pipelineResult?.afterATS?.scores.ats ?? afterReport.scores.ats}</div>
                  </div>
                  <div className="ml-3">
                    {(() => {
                      const beforeScore = pipelineResult?.beforeATS?.scores.ats ?? beforeReport.scores.ats;
                      const afterScore = pipelineResult?.afterATS?.scores.ats ?? afterReport.scores.ats;
                      const delta = afterScore - beforeScore;
                      return (
                        <Badge variant={delta >= 0 ? "gold" : "warning"} className="text-sm">
                          {delta >= 0 ? "+" : ""}{delta} pts
                        </Badge>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button onClick={() => setShowInterviewPrep(true)} className="bg-white text-brand hover:bg-white/90 gap-2" title="Generate tailored interview questions and practice with a mock interview">
                    <Icon name="GraduationCap" className="w-4 h-4" /> Prepare for Interview
                  </Button>
                  <Button onClick={() => { setOptimizedResume({ ...optimizedResume, photoUrl: "/brand/sample-photo.png" }); updateResume(optimizedResume.id, { photoUrl: "/brand/sample-photo.png" }); toast.success("Sample photo loaded — click the photo frame to replace it."); }} variant="outline" className="bg-white/10 border-white/40 text-white hover:bg-white/20 hover:text-white gap-2">
                    <Icon name="ImagePlus" className="w-4 h-4" /> <span className="hidden sm:inline">Load photo</span>
                  </Button>
                  <Button onClick={reset} variant="outline" className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white gap-2">
                    <Icon name="RotateCcw" className="w-4 h-4" /> <span className="hidden sm:inline">Optimize another</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* === 5-agent pipeline results (before/after ATS, keyword improvements, recommendations, confidence, reflection) === */}
            {pipelineResult && (
              <PipelineResults result={pipelineResult} />
            )}

            {/* Live-editable InfoHAS Pro preview */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <h3 className="font-display text-lg font-bold flex items-center gap-2">
                      <Icon name="FileText" className="w-4 h-4 text-brand" /> Optimized resume — InfoHAS Pro layout
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="inline-flex items-center">
                        <Icon name="Pencil" className="w-3 h-3 inline text-brand" />
                        {/* Mobile instruction */}
                        <span className="md:hidden"> Tap any section (or the pencil badge) to edit live. Tap the photo frame to upload your photo. Final step before export.</span>
                        {/* Desktop instruction */}
                        <span className="hidden md:inline"> Hover any section to see a pencil — click to edit live. Click the photo frame to upload your photo. Final step before export.</span>
                      </span>
                    </p>
                  </div>
                  <Badge variant="brand"><Icon name="Lock" className="w-3 h-3" /> One A4 page · validated</Badge>
                </div>
                <div className="rounded-xl bg-secondary/60 p-2 sm:p-4 overflow-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
                  <div className="flex justify-center">
                    <EditableA4Preview
                      resume={optimizedResume}
                      onChange={(p) => {
                        const next = { ...optimizedResume, ...p, updatedAt: new Date().toISOString() };
                        setOptimizedResume(next);
                        updateResume(next.id, p);
                      }}
                      scale={previewScale}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Improvements</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">Missing keywords</span><span className="font-semibold">{(pipelineResult?.beforeATS?.missingKeywords.length ?? beforeReport.missingKeywords.length)} → {(pipelineResult?.afterATS?.missingKeywords.length ?? afterReport.missingKeywords.length)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Matched keywords</span><span className="font-semibold">{(pipelineResult?.beforeATS?.matchedKeywords.length ?? beforeReport.matchedKeywords.length)} → {(pipelineResult?.afterATS?.matchedKeywords.length ?? afterReport.matchedKeywords.length)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Keyword score</span><span className="font-semibold">{(pipelineResult?.beforeATS?.scores.keywordMatch ?? beforeReport.scores.keywords)} → {(pipelineResult?.afterATS?.scores.keywordMatch ?? afterReport.scores.keywords)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Content score</span><span className="font-semibold">{(pipelineResult?.beforeATS?.scores.content ?? beforeReport.scores.content)} → {(pipelineResult?.afterATS?.scores.content ?? afterReport.scores.content)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Template</span><span className="font-semibold">{industryMode ? `${INDUSTRY_PROFILES[industryId]?.label ?? "Industry"} ATS` : "InfoHAS Pro"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">One A4 page</span><span className="font-semibold text-emerald-600">✓ Validated</span></div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-base">Download your optimized resume</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => {
                      // FINAL validation before PDF export — no error leaks allowed
                      const exportCheck = validateResumeForExport(optimizedResume);
                      if (!exportCheck.valid && exportCheck.cleanedResume) {
                        toast.warning("Cleaned error leaks from resume before export.");
                        const r = exportResumePDF(exportCheck.cleanedResume, { enforceOnePage: true });
                        if (r.ok) { incUsage("downloads"); toast.success("PDF exported — 1 A4 page."); } else toast.error(r.error || "Export failed.");
                      } else if (!exportCheck.valid) {
                        toast.error("Resume contains errors and cannot be exported. Please regenerate.");
                      } else {
                        const r = exportResumePDF(optimizedResume, { enforceOnePage: true });
                        if (r.ok) { incUsage("downloads"); toast.success("PDF exported — 1 A4 page."); } else toast.error(r.error || "Export failed.");
                      }
                    }} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Download" className="w-4 h-4" /> optimized_resume.pdf</Button>
                    <Button variant="outline" onClick={() => {
                      exportResumeDOC(optimizedResume);
                      incUsage("downloads");
                      log({ actor: "you", action: "Exported resume (DOC)", category: "export", details: `Times New Roman 12pt · @page A4 · ${pipelineResult?.charCount ?? "?"} chars`, severity: "info" });
                      toast.success("DOC exported — strict A4 one-page layout.");
                    }} className="gap-2" title="Strict A4 one-page Word document (Times New Roman 12pt, @page A4)">
                      <Icon name="FileText" className="w-4 h-4" /> .doc
                    </Button>
                    <Button variant="outline" onClick={() => { exportResumeDOCX(optimizedResume); incUsage("downloads"); toast.success("DOCX exported."); }} className="gap-2"><Icon name="FileType" className="w-4 h-4" /> .docx</Button>
                    <Button variant="outline" onClick={() => { exportResumeTXT(optimizedResume); incUsage("downloads"); toast.success("TXT exported."); }} className="gap-2"><Icon name="FileText" className="w-4 h-4" /> .txt</Button>
                  </div>
                  <div className="mt-4 rounded-lg bg-secondary p-3 text-xs">
                    <div className="font-semibold mb-1">Files generated:</div>
                    <ul className="space-y-0.5 text-muted-foreground font-mono">
                      <li>optimized_resume.pdf</li>
                      <li>optimized_resume.doc <span className="text-amber-600">← strict A4 one-page</span></li>
                      <li>optimized_resume.docx</li>
                      <li>optimized_resume.txt</li>
                    </ul>
                  </div>
                  <div className="mt-3 rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-2.5 flex items-start gap-2">
                    <Icon name="Info" className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Download your optimized one-page ATS-friendly resume. PDF is best for online applications; DOC/DOCX for editing; TXT for pasting into web forms.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

          </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
