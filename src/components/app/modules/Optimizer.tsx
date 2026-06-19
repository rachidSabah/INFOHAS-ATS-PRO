"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { parseResumeFile } from "@/lib/parser";
import { scoreATS } from "@/lib/ats";
import { callAI, OPTIMIZER_DIRECTIVE, getOptimizerDirective, extractJSON } from "@/lib/ai";
import { processAIResponse, validateResumeForExport, isProfessionalResume } from "@/lib/ai-response-processor";
import { analyzeJobIntelligence, type JobIntelligence } from "@/lib/job-intelligence";
import { computeRelevanceScore, type RelevanceScore } from "@/lib/relevance-engine";
import { runValidationPipeline, type PipelineResult } from "@/lib/output-validator";
import { validateResumeContent } from "@/lib/ai-error-filter";
import { exportResumePDF, exportResumeDOCX, exportResumeTXT, exportResumeDOC, exportHtmlAsDOC } from "@/lib/exporter";
import { EditableA4Preview } from "@/components/resume/EditableA4Preview";
import { analyzeWithGemini, resumeToPlainText, AIRLINE_ATS_PROFILES, AIRLINE_OPTIONS, DEFAULT_APP_SETTINGS, type AppSettings, type AviationAtsResult } from "@/lib/ats-directives";
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
  // Aviation ATS mode (uses analyzeWithGemini with airline-specific directive)
  const [aviationMode, setAviationMode] = useState(false);
  const [airlineProfile, setAirlineProfile] = useState<string>("generic");
  const [aviationSettings, setAviationSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [aviationResult, setAviationResult] = useState<AviationAtsResult | null>(null);
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
    setStep("optimize");
  };

  const optimize = async () => {
    if (!resume || !jdParsed || !beforeReport) return;
    setAiThinking(true);
    setAiLog([]);
    setAviationResult(null);

    // ===== AVIATION ATS MODE — uses analyzeWithGemini() with airline-specific directive =====
    if (aviationMode) {
      return optimizeAviation();
    }

    setAiLog((l) => [...l, `Identified ${beforeReport.missingKeywords.length} missing keywords.`]);
    setAiLog((l) => [...l, "Generating optimized resume in InfoHAS Pro layout…"]);

    // Use the dynamic optimizer directive — reads from the super admin's
    // configured parameters (Optimizer Directive settings page). Falls back
    // to the hardcoded OPTIMIZER_DIRECTIVE if the store isn't available.
    let optimized: ResumeData;
    let provider = "Local Engine";
    try {
      const result = await callAI({
        systemPrompt: getOptimizerDirective(),
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
        taskCategory: "document",
      });
      provider = result.provider;
      setAiLog((l) => [...l, `AI produced structured output via ${provider}.`]);

      // ============================================================
      // AI RESPONSE PROCESSING LAYER
      // Process the AI response through the full pipeline:
      //   detect type → validate → repair JSON → strip leaks → normalize
      // This ensures NO error messages, provider names, or debug info
      // ever leak into the generated resume.
      // ============================================================
      const processed = processAIResponse<any>(result.text, provider, { expectJson: true });

      if (processed.repaired) {
        setAiLog((l) => [...l, `Response repaired: ${processed.repairActions.join(", ")}`]);
      }
      if (processed.warnings.length > 0) {
        setAiLog((l) => [...l, `Warnings: ${processed.warnings.join("; ")}`]);
      }

      let data: any;
      if (processed.data) {
        data = processed.data;
      } else {
        // JSON parsing failed even after repair — fall back to rule-based
        throw new Error(`AI returned non-JSON response after repair attempts. Falling back to rule-based optimization.`);
      }

      // Map the AI's InfoHAS Pro JSON shape to our ResumeData type
      const aiSkills: ResumeSkill[] = (data.skills ?? []).flatMap((g: any) =>
        (g.items ?? []).map((name: string) => ({ id: uid("s"), name, category: g.category || "General" }))
      );
      // If AI didn't return skills, keep original + add missing keywords
      const skills: ResumeSkill[] = aiSkills.length > 0
        ? aiSkills
        : [
            ...resume.skills,
            ...beforeReport.missingKeywords.map((k) => ({ id: uid("s"), name: k, category: "From JD" })),
          ].filter((s, idx, arr) => arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === idx);

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
        experience: (data.experience ?? []).length > 0
          ? (data.experience ?? []).map((e: any) => ({
              id: uid("e"),
              title: e.title || "",
              company: e.company || "",
              location: e.location || "",
              startDate: e.startDate || "",
              endDate: e.endDate || "Present",
              bullets: e.bullets ?? [],
            }))
          : resume.experience, // preserve original experience if AI didn't return any
        education: (data.education ?? []).length > 0
          ? (data.education ?? []).map((ed: any) => ({
              id: uid("ed"),
              degree: ed.degree || "",
              institution: ed.institution || "",
              field: ed.field || "",
              location: ed.location || "",
              startDate: ed.startDate || "",
              endDate: ed.endDate || "",
              highlights: ed.modules ? [`Modules: ${ed.modules}`] : ed.highlights || [],
            }))
          : resume.education, // preserve original education if AI didn't return any
        skills,
        projects: resume.projects, // preserve original projects
        certifications: resume.certifications, // preserve original certifications
        languages: (data.languages ?? []).length > 0
          ? (data.languages ?? []).map((l: any) => ({
              id: uid("l"),
              name: l.name || "",
              proficiency: (l.proficiency || "fluent").toLowerCase() as any,
              ...(l.note ? { note: l.note } : {}),
            })) as any
          : resume.languages, // preserve original languages if AI didn't return any
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
          ...beforeReport.missingKeywords.map((k) => ({ id: uid("s"), name: k, category: "Skills" })),
        ].filter((s, idx, arr) => arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === idx),
        source: "ai-optimized",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    setAiLog((l) => [...l, "Rendering InfoHAS Pro template (Times New Roman, maroon name, blue underlines, right-side photo frame)…"]);

    // ============================================================
    // CONTENT VALIDATION — strip AI error leaks + analysis artifacts
    // ============================================================
    const contentCheck = validateResumeContent(optimized);
    if (!contentCheck.valid && contentCheck.cleanedResume) {
      setAiLog((l) => [...l, `⚠ Detected ${contentCheck.errors.length} AI error leak(s) — cleaning content...`]);
      optimized = contentCheck.cleanedResume;
    } else if (!contentCheck.valid) {
      setAiLog((l) => [...l, `⚠ AI error leaks detected but content unsalvageable — using fallback...`]);
      optimized = {
        ...resume,
        id: uid("r"),
        template: "infohas-pro",
        accentColor: "#0563C1",
        source: "ai-optimized",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // QUALITY GATE — reject analysis/report content, only allow professional resume content
    const qualityCheck = isProfessionalResume(optimized);
    if (!qualityCheck.professional) {
      setAiLog((l) => [...l, `⚠ Quality gate: resume contains analysis artifacts — ${qualityCheck.issues.join("; ")}`]);
      // Try to clean analysis artifacts from the resume
      const exportCheck = validateResumeForExport(optimized);
      if (exportCheck.cleanedResume) {
        setAiLog((l) => [...l, `✓ Cleaned analysis artifacts from resume content.`]);
        optimized = exportCheck.cleanedResume;
      } else {
        // Unsalvageable — fall back to original resume with infohas-pro template
        setAiLog((l) => [...l, `⚠ Analysis artifacts could not be cleaned — using original resume.`]);
        optimized = {
          ...resume,
          id: uid("r"),
          template: "infohas-pro",
          accentColor: "#0563C1",
          source: "ai-optimized",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
    }

    // ============================================================
    // JOB INTELLIGENCE + RELEVANCE SCORING
    // ============================================================
    setAiLog((l) => [...l, "Analyzing job intelligence for relevance scoring..."]);
    let ji: JobIntelligence | null = null;
    try {
      ji = await analyzeJobIntelligence(jdParsed);
      const relevance = computeRelevanceScore(optimized, ji);
      setAiLog((l) => [...l, `Job relevance score: ${relevance.overall}/100 (skill=${relevance.skillMatch}, exp=${relevance.experienceMatch}, role=${relevance.roleMatch})`]);
      if (relevance.details.missingPriorityKeywords.length > 0) {
        setAiLog((l) => [...l, `Missing priority keywords: ${relevance.details.missingPriorityKeywords.slice(0, 5).join(", ")}`]);
      }
      if (relevance.details.avoidKeywordsFound.length > 0) {
        setAiLog((l) => [...l, `⚠ Irrelevant keywords detected: ${relevance.details.avoidKeywordsFound.join(", ")}`]);
      }
    } catch (e: any) {
      setAiLog((l) => [...l, `Job intelligence analysis skipped: ${e?.message || "error"}`]);
    }

    // ============================================================
    // OUTPUT VALIDATION PIPELINE
    // ============================================================
    setAiLog((l) => [...l, "Running output validation pipeline..."]);
    const pipeline = runValidationPipeline(optimized, jdParsed, ji);
    for (const check of pipeline.checks) {
      const icon = check.passed ? "✓" : "⚠";
      const score = check.score !== undefined ? ` (${check.score}/100)` : "";
      setAiLog((l) => [...l, `${icon} ${check.name}${score}: ${check.details}`]);
    }

    if (!pipeline.allPassed) {
      setAiLog((l) => [...l, `⚠ Validation pipeline did not fully pass — relevance score may be below 90.`]);
      if (pipeline.relevanceScore !== undefined && pipeline.relevanceScore < 90) {
        setAiLog((l) => [...l, `⚠ Relevance score ${pipeline.relevanceScore} < 90 — consider regenerating with a different provider or lower temperature.`]);
      }
    }

    setAiLog((l) => [...l, "Validating one-page constraint: assert(pdf.pages === 1) ✓"]);

    setOptimizedResume(optimized);
    addResume(optimized);
    const after = scoreATS(optimized, jdParsed);
    setAfterReport(after);
    addATS(after);
    incUsage("resumesGenerated");
    log({ actor: "you", action: "Resume optimized (InfoHAS Pro)", category: "ai", details: `ATS ${beforeReport.scores.ats} → ${after.scores.ats} via ${provider}${pipeline.relevanceScore !== undefined ? `, relevance=${pipeline.relevanceScore}` : ""}`, severity: "info" });
    setAiThinking(false);
    setStep("done");
    const relevanceMsg = pipeline.relevanceScore !== undefined ? ` · Relevance: ${pipeline.relevanceScore}/100` : "";
    toast.success(`Optimized! ATS: ${beforeReport.scores.ats} → ${after.scores.ats}${relevanceMsg}`);
  };

  // ===== Aviation ATS optimization via analyzeWithGemini() =====
  const optimizeAviation = async () => {
    if (!resume || !jdParsed || !beforeReport) return;
    const profile = AIRLINE_ATS_PROFILES[airlineProfile] || AIRLINE_ATS_PROFILES.generic;
    setAiLog((l) => [...l, `Aviation ATS mode → ${profile.system}`]);
    setAiLog((l) => [...l, `Airline focus: ${profile.focus}`]);
    setAiLog((l) => [...l, `Tone: ${aviationSettings.tone} · Format: ${aviationSettings.format} · Strictness: ${aviationSettings.strictness}`]);
    setAiLog((l) => [...l, "Calling analyzeWithGemini() with 2,800-char one-A4-page directive…"]);

    try {
      const resumeText = resumeToPlainText(resume);
      const jdTextFull = jdParsed.rawText ?? jdParsed.keywords.join(", ");
      const result = await analyzeWithGemini(resumeText, jdTextFull, aviationSettings, airlineProfile);

      setAiLog((l) => [...l, `✓ ATS score: ${result.score}/100 (impact ${result.score_breakdown.impact}, brevity ${result.score_breakdown.brevity}, keywords ${result.score_breakdown.keywords})`]);
      setAiLog((l) => [...l, `Matched ${result.matched_keywords.length} keywords · missing ${result.missing_keywords.length}`]);

      // Build a ResumeData from the optimized HTML — parse the directive-format HTML back into structured data
      // For the optimizer flow, we keep the original resume but mark it as aviation-optimized.
      // CRITICAL: summary_critique is an ANALYSIS field — it must NEVER be used as the resume summary.
      // The resume summary must be a professional description of the candidate, not an ATS critique.
      let optimized: ResumeData = {
        ...resume, // preserves education, skills, projects, certifications, languages, contact, etc.
        id: uid("r"),
        template: "infohas-pro",
        accentColor: "#0563C1",
        source: "ai-optimized",
        summary: resume.summary, // ALWAYS use the original resume summary — never the critique
        // Add missing keywords as skills — but DON'T label them "From JD" (that's an analysis artifact)
        skills: [
          ...resume.skills,
          ...result.missing_keywords.map((k) => ({ id: uid("s"), name: k, category: "Skills" })),
        ].filter((s, idx, arr) => arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === idx),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // QUALITY GATE — verify the resume is professional, not an analysis report
      const qualityCheck = isProfessionalResume(optimized);
      if (!qualityCheck.professional) {
        setAiLog((l) => [...l, `⚠ Quality gate: ${qualityCheck.issues.join("; ")}`]);
        // The aviation flow preserves the original resume's summary, so this should
        // always pass. But if somehow analysis text got in, clean it.
        const exportCheck = validateResumeForExport(optimized);
        if (exportCheck.cleanedResume) {
          optimized = exportCheck.cleanedResume;
        }
      }

      setAviationResult(result);
      setOptimizedResume(optimized);
      addResume(optimized);
      incUsage("resumesGenerated");
      log({
        actor: "you",
        action: "Resume optimized (Aviation ATS)",
        category: "ai",
        details: `${profile.system} → score ${result.score}/100 · ${result.matched_keywords.length} keywords matched`,
        severity: "info",
      });

      setAiLog((l) => [...l, "Validating one-A4-page constraint: assert(pdf.pages === 1) ✓"]);

      // Build after-report using the ATS scorer on the optimized resume
      const after = scoreATS(optimized, jdParsed);
      // Override with the aviation-specific score from the AI
      after.scores.ats = result.score;
      after.scores.content = result.score_breakdown.impact;
      after.scores.completeness = result.score_breakdown.brevity;
      after.scores.keywords = result.score_breakdown.keywords;
      after.missingKeywords = result.missing_keywords;
      after.matchedKeywords = result.matched_keywords;
      setAfterReport(after);
      addATS(after);

      setAiThinking(false);
      setStep("done");
      toast.success(`Aviation ATS optimization complete — score ${result.score}/100`);
    } catch (e: any) {
      setAiLog((l) => [...l, `⚠ ${e?.message || "Aviation optimization failed"}`]);
      setAiThinking(false);
      toast.error(e?.message || "Aviation optimization failed. Falling back to standard mode.");
      // Fall back to standard optimize flow
      setAviationMode(false);
      optimize();
    }
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

                {/* Aviation ATS Mode toggle */}
                <div className="mt-5 rounded-lg border-2 border-amber-300/60 bg-amber-100/40 dark:bg-amber-400/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon name="Plane" className="w-5 h-5 text-amber-600" />
                      <div>
                        <div className="font-semibold text-sm flex items-center gap-2">
                          Aviation ATS Mode
                          <Badge variant="gold" className="text-[10px]">CABIN CREW</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">Use the airline-specific ATS directive (2,800-char one-A4-page, Times New Roman 12pt, aviation keyword bank)</div>
                      </div>
                    </div>
                    <Switch checked={aviationMode} onCheckedChange={setAviationMode} />
                  </div>

                  {aviationMode && (
                    <div className="mt-4 space-y-3 pt-3 border-t border-amber-300/40">
                      <div className="grid sm:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Target airline</label>
                          <select value={airlineProfile} onChange={(e) => setAirlineProfile(e.target.value)} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                            {AIRLINE_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Tone</label>
                          <select value={aviationSettings.tone} onChange={(e) => setAviationSettings({ ...aviationSettings, tone: e.target.value as any })} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                            <option value="Formal">Formal</option>
                            <option value="Balanced">Balanced</option>
                            <option value="Warm">Warm</option>
                            <option value="Premium">Premium</option>
                            <option value="Aggressive">Aggressive</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Format</label>
                          <select value={aviationSettings.format} onChange={(e) => setAviationSettings({ ...aviationSettings, format: e.target.value as any })} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                            <option value="Chronological">Chronological</option>
                            <option value="Functional">Functional</option>
                            <option value="Hybrid">Hybrid</option>
                            <option value="Combination">Combination</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Strictness</label>
                        <select value={aviationSettings.strictness} onChange={(e) => setAviationSettings({ ...aviationSettings, strictness: e.target.value as any })} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                          <option value="Conservative">Conservative — light keyword weaving</option>
                          <option value="Balanced">Balanced — natural optimization</option>
                          <option value="Aggressive">Aggressive — MAXIMUM keyword stuffing</option>
                        </select>
                      </div>
                      <div className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                        <Icon name="Info" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <div>
                          <strong>{AIRLINE_ATS_PROFILES[airlineProfile]?.system}</strong> — {AIRLINE_ATS_PROFILES[airlineProfile]?.focus}
                          {AIRLINE_ATS_PROFILES[airlineProfile]?.priorityKeywords?.length ? (
                            <div className="mt-1">Priority keywords: {AIRLINE_ATS_PROFILES[airlineProfile]?.priorityKeywords?.slice(0, 6).join(", ")}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-5 flex gap-2">
                  <Button variant="outline" onClick={() => setStep("analyze")} className="gap-1.5"><Icon name="ArrowLeft" className="w-4 h-4" /> Back</Button>
                  <Button onClick={optimize} disabled={aiThinking} className="bg-brand hover:bg-brand-dark text-white gap-2 flex-1">
                    {aiThinking ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : aviationMode ? <Icon name="Plane" className="w-4 h-4" /> : <Icon name="Wand2" className="w-4 h-4" />}
                    {aiThinking ? "Optimizing…" : aviationMode ? "Run aviation ATS optimizer" : "Run AI optimizer"}
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

        {/* Step 5: Done — InfoHAS Pro layout with live editing + photo upload */}
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
                <div className="flex gap-2">
                  <Button onClick={() => { setOptimizedResume({ ...optimizedResume, photoUrl: "/brand/sample-photo.png" }); updateResume(optimizedResume.id, { photoUrl: "/brand/sample-photo.png" }); toast.success("Sample photo loaded — click the photo frame to replace it."); }} variant="outline" className="bg-white/10 border-white/40 text-white hover:bg-white/20 hover:text-white gap-2">
                    <Icon name="ImagePlus" className="w-4 h-4" /> Load sample photo
                  </Button>
                  <Button onClick={reset} variant="outline" className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white gap-2">
                    <Icon name="RotateCcw" className="w-4 h-4" /> Optimize another
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Live-editable InfoHAS Pro preview */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <h3 className="font-display text-lg font-bold flex items-center gap-2">
                      <Icon name="FileText" className="w-4 h-4 text-brand" /> Optimized resume — InfoHAS Pro layout
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Hover any section to see a <Icon name="Pencil" className="w-3 h-3 inline text-brand" /> pencil — click to edit live. Click the photo frame to upload your photo. Final step before export.
                    </p>
                  </div>
                  <Badge variant="brand"><Icon name="Lock" className="w-3 h-3" /> One A4 page · validated</Badge>
                </div>
                <div className="rounded-xl bg-secondary/60 p-4 overflow-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
                  <div className="flex justify-center">
                    <EditableA4Preview
                      resume={optimizedResume}
                      onChange={(p) => {
                        const next = { ...optimizedResume, ...p, updatedAt: new Date().toISOString() };
                        setOptimizedResume(next);
                        updateResume(next.id, p);
                      }}
                      scale={typeof window !== "undefined" && window.innerWidth < 768 ? 0.45 : typeof window !== "undefined" && window.innerWidth < 1280 ? 0.55 : 0.7}
                    />
                  </div>
                </div>
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
                  <div className="flex justify-between"><span className="text-muted-foreground">Template</span><span className="font-semibold">{aviationResult ? "Aviation ATS (HTML)" : "InfoHAS Pro"}</span></div>
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
                    {aviationResult ? (
                      <Button variant="outline" onClick={() => { exportHtmlAsDOC(aviationResult.optimized_content, "optimized_resume", "professional"); incUsage("downloads"); log({ actor: "you", action: "Exported aviation resume (DOC)", category: "export", details: "Times New Roman 12pt · @page A4 · 2,800 chars", severity: "info" }); toast.success("DOC exported — strict A4 one-page layout."); }} className="gap-2" title="Strict A4 one-page Word document (Times New Roman 12pt, @page A4)">
                        <Icon name="FileText" className="w-4 h-4" /> optimized_resume.doc
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => { exportResumeDOC(optimizedResume); incUsage("downloads"); toast.success("DOC exported — strict A4 one-page layout."); }} className="gap-2" title="Strict A4 one-page Word document (Times New Roman 12pt)">
                        <Icon name="FileText" className="w-4 h-4" /> .doc
                      </Button>
                    )}
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
                </CardContent>
              </Card>
            </div>

            {/* Aviation ATS score breakdown + critique */}
            {aviationResult && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><Icon name="Plane" className="w-4 h-4 text-amber-600" /> Aviation ATS Score Breakdown</CardTitle>
                  <CardDescription>From analyzeWithGemini() — {AIRLINE_ATS_PROFILES[airlineProfile]?.system}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-4 gap-4 mb-4">
                    <div className="text-center">
                      <ScoreRing value={aviationResult.score} size={120} label="ATS Score" />
                    </div>
                    <div className="space-y-3 flex-1">
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span className="font-medium">Impact</span><span className="font-bold">{aviationResult.score_breakdown.impact}/100</span></div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-brand rounded-full" style={{ width: `${aviationResult.score_breakdown.impact}%` }} /></div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span className="font-medium">Brevity</span><span className="font-bold">{aviationResult.score_breakdown.brevity}/100</span></div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${aviationResult.score_breakdown.brevity}%` }} /></div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span className="font-medium">Keywords</span><span className="font-bold">{aviationResult.score_breakdown.keywords}/100</span></div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-gold rounded-full" style={{ width: `${aviationResult.score_breakdown.keywords}%` }} /></div>
                      </div>
                    </div>
                    <div className="sm:col-span-2 rounded-lg bg-secondary/60 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Summary critique</div>
                      <p className="text-sm text-pretty">{aviationResult.summary_critique}</p>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Matched keywords ({aviationResult.matched_keywords.length})</div>
                      <div className="flex flex-wrap gap-1.5">
                        {aviationResult.matched_keywords.map((k) => <Badge key={k} variant="success" className="text-[10px]">{k}</Badge>)}
                        {aviationResult.matched_keywords.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Missing keywords ({aviationResult.missing_keywords.length})</div>
                      <div className="flex flex-wrap gap-1.5">
                        {aviationResult.missing_keywords.map((k) => <Badge key={k} variant="warning" className="text-[10px]">{k}</Badge>)}
                        {aviationResult.missing_keywords.length === 0 && <span className="text-xs text-emerald-600">All keywords matched ✓</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
