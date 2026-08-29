"use client";

import { recordAI, setFlightScope } from "@/lib/ai/flight-recorder";
setFlightScope({ scope: "resume-optimizer", feature: "Resume Optimizer", module: "src.components.app.modules.Optimizer" });

import { useState, useRef, useEffect, useCallback, Suspense, lazy } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Badge, Icon, ScoreRing, AICopilotPanel } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { parseResumeFile, parseResumeText } from "@/lib/parser";
import { scoreATS } from "@/lib/ats";
import { filterJunkKeywords } from "@/lib/keyword-quality";
import { analyzeATS } from "@/lib/agents/ats-analysis";
import { callAI, extractJSON } from "@/lib/ai";
import { validateResumeForExport } from "@/lib/ai-response-processor";
import { exportResumePDF, exportResumeDOCX, exportResumeTXT, exportResumeDOC, validateExportCompleteness } from "@/lib/exporter";
import { EditableA4Preview } from "@/components/resume/EditableA4Preview";
import { AIRLINE_ATS_PROFILES, AIRLINE_OPTIONS, DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/ats-directives";
import { INDUSTRY_PROFILES, INDUSTRY_OPTIONS, type IndustryAtsProfile, detectATSFromCompany, type AtsDetails } from "@/lib/industry-ats";
import { mapToIndustryMode } from "@/lib/industry-mapper";
import { runOptimizationPipeline, type PipelineResult as AgentPipelineResult, type PipelineProgress } from "@/lib/agents";
import { buildCheckpointFromResult, isCheckpointUsable, type PipelineCheckpoint } from "@/lib/agents/pipeline-checkpoint";
import { clearAllProviderCooldowns } from "@/lib/ai";
import { PipelineProgressView } from "@/components/optimizer/PipelineProgressView";
import { PipelineResults } from "@/components/optimizer/PipelineResults";
import { ATSInspectionSuite } from "@/components/optimizer/ATSInspectionSuite";
import { InterviewPrepSuite } from "@/components/interview/InterviewPrepSuite";
import { toast } from "sonner";
import type { ResumeData, JobDescription, ResumeSkill } from "@/lib/types";
import { DiffPreview } from "@/components/resume/DiffPreview";
import { ATSScoreSimulator } from "@/components/optimizer/ATSScoreSimulator";
import { OptimizationSession } from "@/lib/agents/session-memory";
import { useUndoRedo } from "@/lib/builder-hooks";

// Lazy-load the V3 Pipeline Dashboard so it doesn't bloat the initial bundle
const PipelineDashboardLazy = lazy(() =>
  import("@/components/optimizer/PipelineDashboard").then((m) => ({ default: m.PipelineDashboard })),
);

// Lazy-load the per-node trajectory panel (agentic observability)
const PipelineTrajectoryPanelLazy = lazy(() =>
  import("@/components/optimizer/PipelineTrajectoryPanel").then((m) => ({ default: m.PipelineTrajectoryPanel })),
);

type Step = "upload" | "jd" | "analyze" | "optimize" | "done";

function renderFormattedText(text: string | null | undefined): React.ReactNode {
  if (!text) return "";
  const boldRegex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(boldRegex);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx} className="font-bold text-slate-900 dark:text-slate-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <strong key={idx} className="font-bold text-slate-900 dark:text-slate-100">{part.slice(1, -1)}</strong>;
    }
    return part;
  });
}

export function Optimizer() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const addResume = useApp((s) => s.addResume);
  const updateResume = useApp((s) => s.updateResume);
  const addJD = useApp((s) => s.addJD);
  const addATS = useApp((s) => s.addATSReport);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const config = useApp((s) => s.optimizerDirective);
  const updateOptimizerDirective = useApp((s) => s.updateOptimizerDirective);
  // Task 7 — Pipeline Profiles are LIVE: show the active profile in the AI Engine dashboard.
  const activePipelineProfileName = useApp((s) =>
    s.pipelineProfiles?.find((p) => p.id === s.selectedProfileId)?.name
    ?? s.pipelineProfiles?.find((p) => p.isDefault)?.name
    ?? undefined,
  );

  const [step, setStep] = useState<Step>("upload");
  // Honor the active resume / JD from the store so navigation from
  // AI Resume Review (or any other module that sets activeResumeId/
  // activeJdId) pre-loads the right data.
  const activeResumeId = useApp((s) => s.activeResumeId);
  const activeJdId = useApp((s) => s.activeJdId);
  const [resume, setResume] = useState<ResumeData | null>(
    resumes.find((r) => r.id === activeResumeId) ?? resumes[0] ?? null
  );
  const [jdText, setJdText] = useState("");
  const [jdParsed, setJdParsed] = useState<JobDescription | null>(null);
  const [beforeReport, setBeforeReport] = useState<ReturnType<typeof scoreATS> | null>(null);
  // === UNIFIED SCORING ===
  // beforeAnalyzed is the V2 analyzeATS() result (richer scorer with semantic
  // + readability). We compute it alongside the legacy scoreATS() so the
  // "optimize" step and the "done" step show the SAME "before" score.
  // Without this, the optimize step showed 84 (legacy) while the done step
  // showed 67 (V2) — confusing the user.
  const [beforeAnalyzed, setBeforeAnalyzed] = useState<ReturnType<typeof analyzeATS> | null>(null);
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
  // S4 — checkpoint from the last RECOVERABLE run: completed AI intelligence
  // artifacts preserved so the retry resumes instead of re-calling them.
  const [pipelineCheckpoint, setPipelineCheckpoint] = useState<PipelineCheckpoint | null>(null);
  // Interview prep mode — shows when user clicks "Prepare for Interview"
  const [showInterviewPrep, setShowInterviewPrep] = useState(false);
  const [deepAgenticMode, setDeepAgenticMode] = useState(false);
  // === MODEL VARIANT ARENA ===
  const [arenaMode, setArenaMode] = useState(false);
  const [arenaProviderIds, setArenaProviderIds] = useState<string[]>([]);
  const [variantResults, setVariantResults] = useState<Record<string, AgentPipelineResult>>({});
  const [arenaRunning, setArenaRunning] = useState(false);
  // === CAREER RAG STATES ===
  const careerMaterials = useApp((s) => s.careerMaterials);
  const addCareerMaterial = useApp((s) => s.addCareerMaterial);
  const deleteCareerMaterial = useApp((s) => s.deleteCareerMaterial);
  const fetchCareerMaterials = useApp((s) => s.fetchCareerMaterials);
  const [ragDraftTitle, setRagDraftTitle] = useState("");
  const [ragDraftContent, setRagDraftContent] = useState("");
  const [ragDraftCategory, setRagDraftCategory] = useState<"resume" | "cover_letter" | "certificate" | "project">("certificate");
  const allProviders = useApp((s) => s.providers);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pasteText, setPasteText] = useState("");
  const [parsingText, setParsingText] = useState(false);
  const [jdUrl, setJdUrl] = useState("");
  const [scrapingJdUrl, setScrapingJdUrl] = useState(false);

  // === KEYWORD INJECTION & COPILOT STATES ===
  const [injectingKeyword, setInjectingKeyword] = useState<string | null>(null);
  const [copilotMessages, setCopilotMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: "Hi! I am your AI Optimizer Copilot. Ask me to make specific tweaks to this optimized resume, adjust the tone of a section, add missing keywords, or change work bullet points to highlight different achievements!"
    }
  ]);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [activeElement, setActiveElement] = useState<any>(null);
  const [isPageOverflowing, setIsPageOverflowing] = useState(false);
  const [bypassModal, setBypassModal] = useState<{
    open: boolean;
    format: "pdf" | "docx" | "doc" | "txt";
    errors: string[];
  } | null>(null);

  const triggerExport = async (format: "pdf" | "docx" | "doc" | "txt") => {
    if (!optimizedResume) return;

    // 1. Run the clean check
    const exportCheck = validateResumeForExport(optimizedResume);
    if (!exportCheck.valid && !exportCheck.cleanedResume) {
      toast.error("Resume contains errors and cannot be exported. Please regenerate.");
      return;
    }
    const r = exportCheck.cleanedResume || optimizedResume;

    // 2. Validate quality gates
    const gateResult = validateExportCompleteness(resume, r);
    if (!gateResult.ok) {
      setBypassModal({
        open: true,
        format,
        errors: gateResult.errors,
      });
      return;
    }

    // 3. If gates pass, execute normal export
    try {
      if (format === "pdf") {
        const res = await exportResumePDF(r, { enforceOnePage: true }, undefined, resume);
        if (res.ok) {
          incUsage("downloads");
          toast.success("PDF exported — 1 A4 page.");
        } else {
          toast.error(res.error || "Export failed.");
        }
      } else if (format === "doc") {
        exportResumeDOC(r, "professional", resume);
        incUsage("downloads");
        log({ actor: "you", action: "Exported resume (DOC)", category: "export", details: `Times New Roman 12pt · @page A4 · ${pipelineResult?.charCount ?? "?"} chars`, severity: "info" });
        toast.success("DOC exported — strict A4 one-page layout.");
        if (exportCheck.cleanedResume) toast.warning("Cleaned error leaks from resume before export.");
      } else if (format === "docx") {
        await exportResumeDOCX(r, undefined, resume);
        incUsage("downloads");
        toast.success("DOCX exported.");
        if (exportCheck.cleanedResume) toast.warning("Cleaned error leaks from resume before export.");
      } else if (format === "txt") {
        exportResumeTXT(r, resume);
        incUsage("downloads");
        toast.success("TXT exported.");
        if (exportCheck.cleanedResume) toast.warning("Cleaned error leaks from resume before export.");
      }
    } catch (e: any) {
      toast.error(e.message || "Export failed.");
    }
  };

  const handleBypassExport = async () => {
    if (!bypassModal || !optimizedResume) return;
    const format = bypassModal.format;
    setBypassModal(null);

    const exportCheck = validateResumeForExport(optimizedResume);
    const r = exportCheck.cleanedResume || optimizedResume;

    try {
      if (format === "pdf") {
        const res = await exportResumePDF(r, { enforceOnePage: true }, undefined, resume, true);
        if (res.ok) {
          incUsage("downloads");
          toast.success("PDF exported anyway.");
        } else {
          toast.error(res.error || "Export failed.");
        }
      } else if (format === "doc") {
        exportResumeDOC(r, "professional", resume, true);
        incUsage("downloads");
        log({ actor: "you", action: "Exported resume (DOC)", category: "export", details: `Times New Roman 12pt · @page A4 · ${pipelineResult?.charCount ?? "?"} chars`, severity: "info" });
        toast.success("DOC exported anyway.");
        if (exportCheck.cleanedResume) toast.warning("Cleaned error leaks from resume before export.");
      } else if (format === "docx") {
        await exportResumeDOCX(r, undefined, resume, true);
        incUsage("downloads");
        toast.success("DOCX exported anyway.");
        if (exportCheck.cleanedResume) toast.warning("Cleaned error leaks from resume before export.");
      } else if (format === "txt") {
        exportResumeTXT(r, resume, true);
        incUsage("downloads");
        toast.success("TXT exported anyway.");
        if (exportCheck.cleanedResume) toast.warning("Cleaned error leaks from resume before export.");
      }
    } catch (e: any) {
      toast.error(e.message || "Export failed.");
    }
  };

  const { snapshot, undo, redo, canUndo, canRedo, undoStack, redoStack } = useUndoRedo(optimizedResume ?? undefined);

  const patchOptimizedResume = (p: Partial<ResumeData>) => {
    if (!optimizedResume) return;
    const next = { ...optimizedResume, ...p };
    setOptimizedResume(next);
    updateResume(next.id, next);
  };

  const detectedAtsDetails = jdParsed ? detectATSFromCompany(jdParsed.company || employer || "", jdParsed.url || "") : null;

  const handleInjectKeyword = async (keyword: string) => {
    if (!optimizedResume || !jdParsed) return;
    setInjectingKeyword(keyword);
    toast.info(`Injecting keyword "${keyword}"...`);
    try {
      const result = await recordAI({
        systemPrompt: `You are an expert ATS resume writer. Inject the target keyword naturally into the resume summary or a relevant experience bullet point, or add it to core skills.
Return ONLY a valid JSON object matching this schema:
{
  "summary": "enhanced professional summary with the keyword...",
  "updatedBullet": {
    "experienceId": "id of the experience entry",
    "bulletIndex": 0,
    "bulletText": "enhanced bullet text with keyword..."
  },
  "skill": "skill name to add if applicable"
}`,
        userPrompt: `Target Keyword to inject: "${keyword}"
Job Title: ${jdParsed.title}
Company: ${jdParsed.company || "Target Employer"}

Current Resume Context:
- Professional Summary: "${optimizedResume.summary || ""}"
- Experience Entries:
${(optimizedResume.experience || []).map((e) => `  ID: ${e.id} | ${e.title} at ${e.company}\n  Bullets:\n${(e.bullets || []).map((b, i) => `    [${i}] ${b}`).join("\n")}`).join("\n\n")}
- Core Skills: ${(optimizedResume.skills || []).map((s) => s.name).join(", ")}

Return ONLY JSON.`,
        maxTokens: 1200,
        temperature: 0.3,
        taskCategory: "document",
      });

      let data: any = null;
      try {
        data = extractJSON(result.text || "{}");
      } catch {
        const jsonMatch = (result.text || "").match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            data = JSON.parse(jsonMatch[0]);
          } catch {}
        }
      }

      let updatedResume: ResumeData = {
        ...optimizedResume,
        experience: [...(optimizedResume.experience || [])],
        skills: [...(optimizedResume.skills || [])],
        updatedAt: new Date().toISOString(),
      };
      let applied = false;

      if (data && typeof data === "object") {
        // 1. If updatedBullet provided
        if (data.updatedBullet?.experienceId && data.updatedBullet?.bulletText) {
          const expId = data.updatedBullet.experienceId;
          const bIdx = typeof data.updatedBullet.bulletIndex === "number" ? data.updatedBullet.bulletIndex : 0;
          const bText = String(data.updatedBullet.bulletText).replace(/\*\*([^*]+)\*\*/g, "$1").trim();
          updatedResume.experience = updatedResume.experience.map((exp, idx) => {
            if (exp.id === expId || (!expId && idx === 0)) {
              const nextBullets = [...(exp.bullets || [])];
              if (bIdx >= 0 && bIdx < nextBullets.length) {
                nextBullets[bIdx] = bText;
              } else {
                nextBullets.push(bText);
              }
              applied = true;
              return { ...exp, bullets: nextBullets };
            }
            return exp;
          });
        }

        // 2. If updated summary provided
        if (data.summary && typeof data.summary === "string" && data.summary.trim()) {
          const cleanSummary = data.summary.replace(/\*\*([^*]+)\*\*/g, "$1").trim();
          if (cleanSummary.toLowerCase().includes(keyword.toLowerCase())) {
            updatedResume.summary = cleanSummary;
            applied = true;
          }
        }

        // 3. If skill provided
        if (data.skill && typeof data.skill === "string" && data.skill.trim()) {
          const skillName = data.skill.trim();
          if (!updatedResume.skills.some((s) => s.name.toLowerCase() === skillName.toLowerCase())) {
            updatedResume.skills = [
              ...updatedResume.skills,
              { id: `s_kw_${Date.now()}`, name: skillName, category: "Core Competencies" },
            ];
            applied = true;
          }
        }
      }

      // Fallback if AI returned unstructured text with the keyword
      if (!applied) {
        const raw = (result.text || "").replace(/```json|```/g, "").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
        if (raw.toLowerCase().includes(keyword.toLowerCase()) && raw.length > 20 && raw.length < 400 && !raw.startsWith("{")) {
          if (updatedResume.experience?.[0]?.bullets?.length) {
            const nextExp = [...updatedResume.experience];
            nextExp[0] = { ...nextExp[0], bullets: [...nextExp[0].bullets, raw] };
            updatedResume.experience = nextExp;
            applied = true;
          }
        }
      }

      // Final deterministic guarantee: inject keyword into skills or summary so operation ALWAYS succeeds
      if (!applied || !JSON.stringify(updatedResume).toLowerCase().includes(keyword.toLowerCase())) {
        const titleCased = keyword.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        if (!updatedResume.skills.some((s) => s.name.toLowerCase() === keyword.toLowerCase())) {
          updatedResume.skills = [
            ...updatedResume.skills,
            { id: `s_kw_${Date.now()}`, name: titleCased, category: "Core Competencies" },
          ];
        }
        if (updatedResume.summary && !updatedResume.summary.toLowerCase().includes(keyword.toLowerCase())) {
          updatedResume.summary = `${updatedResume.summary.replace(/\.\s*$/, "")}, with proven ${keyword.toLowerCase()} capabilities.`;
        }
      }

      // Update state and store
      setOptimizedResume(updatedResume);
      updateResume(updatedResume.id, updatedResume);

      // Re-calculate local report
      const after = scoreATS(updatedResume, jdParsed);

      // Update pipelineResult if it exists so everything stays synced
      if (pipelineResult) {
        const nextResult = {
          ...pipelineResult,
          afterATS: pipelineResult.afterATS
            ? {
                ...pipelineResult.afterATS,
                scores: { ...pipelineResult.afterATS.scores },
                missingKeywords: [...(pipelineResult.afterATS.missingKeywords ?? [])],
                matchedKeywords: [...(pipelineResult.afterATS.matchedKeywords ?? [])],
              }
            : null,
        };
        if (nextResult.afterATS) {
          nextResult.afterATS.scores.ats = after.scores.ats;
          nextResult.afterATS.scores.keywordMatch = after.scores.keywords;
          // Move keyword from missing to matched
          nextResult.afterATS.missingKeywords = nextResult.afterATS.missingKeywords.filter(
            (k) => k.toLowerCase() !== keyword.toLowerCase()
          );
          if (!nextResult.afterATS.matchedKeywords.some((k) => k.toLowerCase() === keyword.toLowerCase())) {
            nextResult.afterATS.matchedKeywords.push(keyword);
          }
        }
        setPipelineResult(nextResult);
      }

      setAfterReport(after);
      addATS(after);

      toast.success(`Keyword "${keyword}" injected successfully!`);
    } catch (e: any) {
      toast.error(e?.message || `Failed to inject keyword "${keyword}"`);
    } finally {
      setInjectingKeyword(null);
    }
  };

  const sendCopilotMessage = async (overrideText?: string) => {
    const textToSend = overrideText || copilotInput;
    if (!textToSend.trim() || copilotLoading || !optimizedResume) return;

    setCopilotInput("");
    const newMessages = [...copilotMessages, { role: "user" as const, content: textToSend }];
    setCopilotMessages(newMessages);
    setCopilotLoading(true);

    try {
      const systemPrompt = `You are a professional AI Resume Optimizer Copilot.
Your job is to help the candidate refine their optimized resume.
You have the candidate's optimized resume and the job description they are targeting.
You can suggest changes to their resume. If you decide to make updates to the resume fields, you MUST append a special [PATCH] block at the very end of your response, followed by a valid JSON object representing a partial ResumeData structure.

Example 1 (updating summary):
I have updated your summary to sound more punchy.
[PATCH]
{
  "summary": "Results-driven engineer..."
}

Example 2 (updating experience bullets):
I have updated the bullet points for your first role.
[PATCH]
{
  "experience": [
    {
      "id": "e_1", // Use the correct ID from the experience list
      "bullets": [
        "Led team of 5 engineers to deliver key dashboard, improving user engagement by 20%.",
        "Optimized database queries, reducing latency by 45%."
      ]
    }
  ]
}

Guidelines:
1. Do NOT invent fake facts, companies, or dates.
2. Maintain clean, professional language with no grammatical errors.
3. Keep the text concise and suitable for a 1-page A4 format.
4. ALWAYS append a [PATCH] block containing the updated fields automatically at the end of your response whenever you make any edits. Do NOT wait for the user to ask you to "insert" or "apply" it.
5. Do NOT use markdown formatting (e.g. **word**) inside the [PATCH] block fields. Plain text only.
`;

      const { callAIStreamed } = await import("@/lib/ai");

      // Insert placeholder for assistant response to stream into
      setCopilotMessages((prev) => [...prev, { role: "assistant" as const, content: "" }]);

      let accumulatedText = "";
      const response = await callAIStreamed({
        systemPrompt: `${systemPrompt}\n\nTARGET JOB:\n${jdParsed ? JSON.stringify({ title: jdParsed.title, company: jdParsed.company, keywords: jdParsed.keywords }) : "None"}\n\nCURRENT OPTIMIZED RESUME:\n${JSON.stringify(optimizedResume, null, 2)}`,
        userPrompt: textToSend,
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\n\nTARGET JOB:\n${jdParsed ? JSON.stringify({ title: jdParsed.title, company: jdParsed.company, keywords: jdParsed.keywords }) : "None"}\n\nCURRENT OPTIMIZED RESUME:\n${JSON.stringify(optimizedResume, null, 2)}`,
          },
          ...newMessages.map((m) => ({ role: m.role, content: m.content })),
        ],
        maxTokens: 1500,
        temperature: 0.65,
        taskCategory: "document"
      }, (chunk) => {
        accumulatedText += chunk;
        let visibleText = accumulatedText;
        if (visibleText.includes("[PATCH]")) {
          visibleText = visibleText.split("[PATCH]")[0];
        }
        visibleText = visibleText
          .replace(/\[PATCH\]\s*$/i, "")
          .replace(/```json\s*$/i, "")
          .replace(/```\s*$/i, "")
          .trim();

        setCopilotMessages((prev) => {
          const next = [...prev];
          if (next.length > 0) {
            next[next.length - 1] = {
              role: "assistant",
              content: visibleText
            };
          }
          return next;
        });
      });

      const reply = response.text || "";
      let cleanReply = reply;
      let patchData: any = null;

      if (reply.includes("[PATCH]")) {
        const parts = reply.split("[PATCH]");
        cleanReply = parts[0].trim();
        const jsonStr = parts[1].trim();
        try {
          patchData = JSON.parse(jsonStr.replace(/```json/gi, "").replace(/```/g, "").trim());
        } catch {
          try {
            patchData = extractJSON(jsonStr);
          } catch {}
        }
      } else {
        try {
          patchData = extractJSON(reply);
          const firstBrace = reply.indexOf("{");
          if (firstBrace !== -1) {
            cleanReply = reply.slice(0, firstBrace).trim();
          }
        } catch {}
      }

      cleanReply = cleanReply
        .replace(/\[PATCH\]\s*$/i, "")
        .replace(/```json\s*$/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      setCopilotMessages((prev) => {
        const next = [...prev];
        if (next.length > 0) {
          next[next.length - 1] = { role: "assistant" as const, content: cleanReply };
        }
        return next;
      });

      if (patchData) {
        const nextResume = { ...optimizedResume };
        
        if (patchData.summary !== undefined) nextResume.summary = patchData.summary;
        if (patchData.headline !== undefined) nextResume.headline = patchData.headline;
        if (patchData.name !== undefined) nextResume.name = patchData.name;
        
        if (Array.isArray(patchData.skills)) {
          nextResume.skills = patchData.skills;
        }
        
        if (Array.isArray(patchData.languages)) {
          nextResume.languages = patchData.languages;
        }

        if (Array.isArray(patchData.experience)) {
          nextResume.experience = nextResume.experience.map((exp) => {
            const match = patchData.experience.find((x: any) => x.id === exp.id);
            if (match) {
              return {
                ...exp,
                company: match.company !== undefined ? match.company : exp.company,
                title: match.title !== undefined ? match.title : exp.title,
                bullets: Array.isArray(match.bullets) ? match.bullets : exp.bullets,
              };
            }
            return exp;
          });
        }

        if (Array.isArray(patchData.education)) {
          nextResume.education = nextResume.education.map((edu) => {
            const match = patchData.education.find((x: any) => x.id === edu.id);
            if (match) {
              return {
                ...edu,
                institution: match.institution !== undefined ? match.institution : edu.institution,
                degree: match.degree !== undefined ? match.degree : edu.degree,
              };
            }
            return edu;
          });
        }

        nextResume.updatedAt = new Date().toISOString();
        setOptimizedResume(nextResume);
        updateResume(nextResume.id, nextResume);
        
        if (jdParsed) {
          const after = scoreATS(nextResume, jdParsed);
          setAfterReport(after);
          addATS(after);
          
          if (pipelineResult) {
            // Deep-clone afterATS and its nested scores to avoid mutating the frozen Zustand state
            const nextResult = {
              ...pipelineResult,
              afterATS: pipelineResult.afterATS
                ? {
                    ...pipelineResult.afterATS,
                    scores: { ...pipelineResult.afterATS.scores },
                    missingKeywords: [...after.missingKeywords],
                    matchedKeywords: [...after.matchedKeywords],
                  }
                : null,
            };
            if (nextResult.afterATS) {
              nextResult.afterATS.scores.ats = after.scores.ats;
              nextResult.afterATS.scores.keywordMatch = after.scores.keywords;
            }
            setPipelineResult(nextResult);
          }
        }
        toast.success("AI Copilot updated your optimized resume!");
      }
    } catch (err: any) {
      console.warn("[Optimizer Copilot] Chat request failed:", err);
      toast.error("Failed to get response from AI Copilot.");
    } finally {
      setCopilotLoading(false);
    }
  };


  const scrapeJdUrl = async () => {
    if (!jdUrl || !/^https?:\/\//.test(jdUrl)) {
      toast.error("Please enter a valid URL (including https://).");
      return;
    }
    setScrapingJdUrl(true);
    setAiLog([]);
    setAiLog((l) => [...l, `Scraping job description from ${jdUrl}…`]);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch("/api/jd-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jdUrl }),
        signal: controller.signal,
      });

      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned a non-JSON response (${res.status} ${res.statusText}).`);
      }

      if (!res.ok) throw new Error(data.error || `Fetch failed (${res.status})`);

      if (!data.text || data.text.trim().length < 30) {
        throw new Error("No readable text was found on the page. Please paste the JD manually.");
      }

      setJdText(data.text);
      toast.success(`Scraped job description successfully!`);
      setAiLog((l) => [...l, "✓ Scraped text successfully.", "Now extracting job details via AI..."]);
      
      setAiThinking(true);
      const parseResult = await recordAI({
        systemPrompt: "You are a job description parser. Extract structured data. Return ONLY valid JSON.",
        userPrompt: `Extract from this job description:\n\n${data.text}\n\nReturn JSON with keys: title, company, location, employmentType, salary, responsibilities (array), requiredSkills (array), preferredSkills (array), technologies (array), experienceYears, education, keywords (array of 8-15).`,
        maxTokens: 2000,
        taskCategory: "document",
      });

      let parsedData: any;
      try {
        parsedData = extractJSON<any>(parseResult.text);
      } catch {
        parsedData = { title: "Parsed role", keywords: [] };
      }

      const flattenLoc = (v: any): string | undefined => {
        if (!v) return undefined;
        if (typeof v === "string") return v;
        if (typeof v === "object") {
          const parts = [v.city, v.state, v.region, v.country, v.address].filter((x: any) => x && typeof x === "string");
          if (parts.length > 0) return parts.join(", ");
          return Object.values(v).filter(Boolean).join(", ");
        }
        return String(v);
      };
      const flattenStr = (v: any): string | undefined => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === "string") return v;
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
      };
      const flattenArray = (v: any): string[] => {
        if (!Array.isArray(v)) return [];
        return v.map((x: any) => typeof x === "string" ? x : (typeof x === "object" ? JSON.stringify(x) : String(x))).filter(Boolean);
      };

      const parsedJd: JobDescription = {
        id: uid("jd"),
        title: flattenStr(parsedData.title) || "Untitled role",
        company: flattenStr(parsedData.company),
        location: flattenLoc(parsedData.location),
        employmentType: flattenStr(parsedData.employmentType),
        salary: flattenStr(parsedData.salary),
        responsibilities: flattenArray(parsedData.responsibilities),
        requiredSkills: flattenArray(parsedData.requiredSkills),
        preferredSkills: flattenArray(parsedData.preferredSkills),
        technologies: flattenArray(parsedData.technologies),
        experienceYears: flattenStr(parsedData.experienceYears),
        education: flattenStr(parsedData.education),
        keywords: flattenArray(parsedData.keywords),
        rawText: data.text,
        source: "url",
        url: jdUrl,
        createdAt: new Date().toISOString(),
      };

      setJdParsed(parsedJd);
      addJD(parsedJd);
      toast.success(`Extracted: ${parsedJd.title}`);
      setStep("analyze");
    } catch (e: any) {
      const msg = e?.name === "AbortError"
        ? "The fetch timed out. Please paste the JD text manually."
        : (e?.message || "Unknown error");
      toast.error(msg);
      setAiLog((l) => [...l, `⚠ Error: ${msg}`]);
    } finally {
      clearTimeout(timeout);
      setScrapingJdUrl(false);
      setAiThinking(false);
    }
  };

  const handlePasteResume = async () => {
    if (pasteText.trim().length < 30) {
      toast.error("Please paste your resume text (at least 30 characters).");
      return;
    }
    setParsingText(true);
    try {
      const parsed = await parseResumeText(pasteText);
      setResume(parsed);
      addResume(parsed);
      toast.success("Parsed pasted resume successfully");
      setStep("jd");
    } catch (e: any) {
      toast.error(e?.message || "Parse failed");
    } finally {
      setParsingText(false);
    }
  };

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

  useEffect(() => {
    fetchCareerMaterials();
  }, [fetchCareerMaterials]);

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
      const result = await recordAI({
        systemPrompt: "You are a job description parser. Extract structured data from the job description text. Return ONLY valid JSON.",
        userPrompt: `Extract from this job description:\n\n${jdText}\n\nReturn JSON with keys: title, company, location, employmentType, salary, responsibilities (array), requiredSkills (array), preferredSkills (array), technologies (array), experienceYears, education, keywords (array of 8-15).`,
        maxTokens: 2000,
        taskCategory: "document",
      });

      // === DIAGNOSTICS ===
      console.group("Optimizer JD Parsing");
      console.log("Provider:", result.provider);
      console.log("JD Text Length:", jdText.length);
      console.log("AI Response Length:", result.text?.length ?? 0);
      console.log("AI Response Preview:", result.text?.slice(0, 200) ?? "(empty)");
      console.groupEnd();

      // Robustly extract JSON — handles prose preambles, markdown fences, etc.
      let data: any;
      try {
        data = extractJSON<any>(result.text);
      } catch {
        console.warn("[Optimizer] JD parsing: extractJSON failed. Using heuristic fallback.");
        data = { title: "Parsed role", keywords: [] };
      }

      // === MORE DIAGNOSTICS ===
      console.log("Parsed JD:", data);
      console.log("Keywords Extracted:", data?.keywords?.length ?? 0);
      console.log("Title:", data?.title ?? "N/A");
      console.log("Company:", data?.company ?? "N/A");

      // === NORMALIZE: flatten any object values to strings ===
      const flattenLoc = (v: any): string | undefined => {
        if (!v) return undefined;
        if (typeof v === "string") return v;
        if (typeof v === "object") {
          const parts = [v.city, v.state, v.region, v.country, v.address].filter((x: any) => x && typeof x === "string");
          if (parts.length > 0) return parts.join(", ");
          return Object.values(v).filter(Boolean).join(", ");
        }
        return String(v);
      };
      const flattenStr = (v: any): string | undefined => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === "string") return v;
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
      };
      const flattenArray = (v: any): string[] => {
        if (!Array.isArray(v)) return [];
        return v.map((x: any) => typeof x === "string" ? x : (typeof x === "object" ? JSON.stringify(x) : String(x))).filter(Boolean);
      };

      parsed = {
        id: uid("jd"),
        title: flattenStr(data.title) || "Untitled role",
        company: flattenStr(data.company),
        location: flattenLoc(data.location),
        employmentType: flattenStr(data.employmentType),
        salary: flattenStr(data.salary),
        responsibilities: flattenArray(data.responsibilities),
        requiredSkills: flattenArray(data.requiredSkills),
        preferredSkills: flattenArray(data.preferredSkills),
        technologies: flattenArray(data.technologies),
        experienceYears: flattenStr(data.experienceYears),
        education: flattenStr(data.education),
        keywords: flattenArray(data.keywords),
        rawText: jdText,
        source: "text",
        createdAt: new Date().toISOString(),
      };
      // KEYWORD QUALITY FIX: AI parsers sometimes return junk tokens ("Go",
      // "Basic", "Job", "Company"...) as keywords. Filter them ONCE at parse
      // time so ATS scoring, missing-keyword panels, and optimization prompts
      // all operate on a clean list downstream.
      parsed.keywords = filterJunkKeywords(parsed.keywords);
      setAiLog((l) => [...l, `Found ${parsed.keywords.length} keywords, ${parsed.requiredSkills.length} required skills.`]);
    } catch {
      // Fallback: simple heuristic
      const words = jdText.toLowerCase().match(/\b[a-z][a-z0-9+#.]+\b/g) ?? [];
      const freq: Record<string, number> = {};
      for (const w of words) if (w.length > 2) freq[w] = (freq[w] || 0) + 1;
      // KEYWORD QUALITY FIX: apply the shared junk filter (the old heuristic
      // only checked length > 2, letting "job", "company", "ensure"... through).
      const keywords = filterJunkKeywords(
        Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k]) => k),
      ).slice(0, 12);
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
    console.log("[Optimizer] analyze() called. resume:", !!resume, "jdParsed:", !!jdParsed);
    if (!resume || !jdParsed) {
      console.warn("[Optimizer] analyze() aborted due to missing resume or jdParsed!");
      return;
    }
    // Defensive: clone the JD with normalized array fields so scoreATS and
    // detectIndustry never throw on undefined.length / undefined.join.
    const safeJd = {
      ...jdParsed,
      keywords: Array.isArray(jdParsed.keywords) ? jdParsed.keywords : [],
      requiredSkills: Array.isArray(jdParsed.requiredSkills) ? jdParsed.requiredSkills : [],
      preferredSkills: Array.isArray(jdParsed.preferredSkills) ? jdParsed.preferredSkills : [],
      technologies: Array.isArray(jdParsed.technologies) ? jdParsed.technologies : [],
      responsibilities: Array.isArray(jdParsed.responsibilities) ? jdParsed.responsibilities : [],
      rawText: typeof jdParsed.rawText === "string" ? jdParsed.rawText : "",
    };
    setJdParsed(safeJd);
    const r = scoreATS(resume, safeJd);
    setBeforeReport(r);
    addATS(r);
    // === Also compute the V2 analyzeATS() score so the "optimize" step
    // shows the SAME number the "done" step will show. ===
    const analyzed = analyzeATS(resume, safeJd);
    setBeforeAnalyzed(analyzed);

    // === Auto-detect industry from JD + resume ===
    const jdText = safeJd.rawText || safeJd.keywords.join(" ");
    const resumeText = `${resume.name} ${resume.headline ?? ""} ${resume.summary ?? ""} ${resume.experience.map((e) => e.title + " " + e.company).join(" ")}`;
    const mapperResult = mapToIndustryMode(jdText, resumeText);
    setIndustryDetection(mapperResult.detection);
    setIndustryId(mapperResult.detection.industryId);
    setIndustrySettings(mapperResult.suggestedSettings);
    // Auto-enable industry mode only for aviation-adjacent industries
    // (all others use the standard optimizer path with Job Intelligence)
    setIndustryMode(mapperResult.aviationMode !== undefined);
    // Auto-populate employer from JD company
    if (safeJd.company) setEmployer(safeJd.company);

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
  // === AI ENGINE DASHBOARD (directives #39, #40) — live snapshot of the locked
  // AI configuration for the running job, incl. supervisor failovers. ===
  const [aiEngineLock, setAiEngineLock] = useState<{
    providerName: string; model: string; readiness: number; latencyMs: number;
    fallback: string | null; lockedAt: string;
  } | null>(null);
  const [aiEngineLive, setAiEngineLive] = useState<{ failovers: number; activeProvider: string; activeModel: string; lastEvent: string | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // P1 FIX: Pipeline version token — prevents stale results from being
  // committed to React state. Each runPipeline call increments this counter.
  // After the async result arrives, we check if the version still matches.
  // If it doesn't, the result is from an older run and is discarded.
  const pipelineVersionRef = useRef(0);

  const runPipeline = useCallback(async () => {
    if (!resume || !jdParsed || !beforeReport) return;

    // Cancel any in-flight pipeline (shouldn't happen, but defensive)
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // P1 FIX: Increment the version token for this run. Any result that
    // arrives with a different version is stale and must be discarded.
    pipelineVersionRef.current++;
    const myVersion = pipelineVersionRef.current;

    setAiThinking(true);
    setAiLog([]);
    setPipelineProgress(null);
    setPipelineResult(null);
    setPipelineError(null);
    setOptimizedResume(null);
    setAfterReport(null);
    // Clear all per-provider cooldowns so a fresh optimization attempt
    // gets a clean slate and tries all providers from scratch.
    clearAllProviderCooldowns();

    const directiveConfig = useApp.getState().optimizerDirective;
    const usingOverride = !!directiveConfig?.customDirectiveOverride?.trim();

    setAiLog((l) => [...l, `Directive source: ${usingOverride ? "CUSTOM OVERRIDE (from Optimizer Directive settings)" : "GENERATED (from structured config)"}`]);
    setAiLog((l) => [...l, `Mode: ${industryMode ? `Industry ATS (${INDUSTRY_PROFILES[industryId]?.label ?? "Generic"})` : "Standard"}`]);
    setAiLog((l) => [...l, "Starting 6-agent pipeline (V2) + post-optimization agents (V3)…"]);

    // Start session memory round (reset first to prevent cross-session bleed)
    OptimizationSession.reset();
    const session = OptimizationSession.getInstance();
    session.startRound(resume.id, {
      industryMode,
      industryId,
      employer,
      usingOverride,
    });

    try {
      // === AI READINESS GATE (directives #24–#46): TEST FIRST → SELECT BEST → LOCK ===
      // A REAL preflight request per candidate provider+model. Optimization
      // NEVER begins unless at least one provider/model passed validation.
      // The selected configuration is locked for this job — every agent
      // inherits it through the single raw call path (no unvalidated
      // failovers, no per-agent model picking).
      setAiLog((l) => [...l, "🧪 AI readiness gate: running REAL preflight requests against candidate providers…"]);
      const { runReadinessGate } = await import("@/lib/ai/readiness/preflight");
      const gate = await runReadinessGate({ jobId: `opt_${Date.now()}`, maxCandidates: 6 });
      setAiLog((l) => [...l, `🧪 ${gate.summary}`]);
      if (gate.healed) {
        setAiLog((l) => [...l, "🔧 Auto-Heal repaired one or more providers during the readiness gate — preflight re-run completed."]);
      }
      if (!gate.lock) {
        // ABSOLUTE RULE #46: no validated provider+model → optimization MUST NOT start.
        const errMsg = gate.summary;
        setPipelineError(errMsg);
        setAiLog((l) => [...l, "✗ AI readiness gate failed — optimization cannot start. Open AI Models → HEAL PROVIDERS."]);
        setAiThinking(false);
        toast.error("AI readiness check failed — no validated AI engine. Open AI Models and click HEAL PROVIDERS.", { duration: 8000 });
        OptimizationSession.getInstance().completeRound({
          beforeATS: 0,
          afterATS: 0,
          strategies: [],
          successes: [],
          failures: ["AI readiness gate: no validated provider"],
        });
        return;
      }
      setAiEngineLock({ providerName: gate.lock.primary.providerName, model: gate.lock.primary.model, readiness: gate.lock.primary.readinessScore, latencyMs: gate.lock.primary.latencyMs ?? 0, fallback: gate.lock.fallbacks[0] ? `${gate.lock.fallbacks[0].providerName} — ${gate.lock.fallbacks[0].model}` : null, lockedAt: gate.lock.lockedAt });

      // === V3: Delegate to the Supervisor, which wraps the existing V2
      // pipeline AND triggers post-optimization agents (CoverLetter,
      // Interview, CareerCoach) in parallel after optimization completes.
      // The Supervisor also caches results + manages the shared context. ===
      const { handleOptimizationRequested } = await import("@/lib/agents/supervisor");
      // S4 — pass a usable checkpoint (same JD, < 24h old) once, then clear:
      // if this run also ends recoverable, the handler captures a fresh one.
      const checkpointToPass = isCheckpointUsable(pipelineCheckpoint, jdParsed) ? pipelineCheckpoint : undefined;
      if (pipelineCheckpoint) setPipelineCheckpoint(null);
      if (checkpointToPass) {
        setAiLog((l) => [...l, "↻ Checkpoint resume — previously completed analyses (Job/Company Intelligence, Skill Gap) will be restored, only the failed optimizer re-runs."]);
      }
      const result = await handleOptimizationRequested({
        resume,
        jd: jdParsed,
        userDirectives: directiveConfig?.customDirectiveOverride?.trim() || undefined,
        aviationMode: industryMode
          ? { airlineProfile: industryId, settings: industrySettings }
          : undefined,
        enableReflection: true,
        deepAgenticMode,
        checkpoint: checkpointToPass ?? undefined,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setPipelineProgress(progress);
          if (progress.log) {
            setAiLog((l) => [...l, `[Step ${progress.stepNumber}/${progress.totalSteps}] ${progress.log}`]);
          }
        },
      });

      if (controller.signal.aborted) return;
      // P1 FIX: Stale state detector — if a newer run started while we were
      // waiting, discard this result entirely. This prevents the old run's
      // ATS scores, optimized resume, and toast from appearing on top of
      // (or after) the newer run's results.
      if (myVersion !== pipelineVersionRef.current) {
        console.warn("[Optimizer] Stale result discarded — pipeline version mismatch.");
        return;
      }
      if (!result) {
        // Supervisor returned null — optimization failed
        setPipelineError("Optimization failed. Please try again.");
        setAiLog((l) => [...l, "✗ Pipeline failed."]);
        setAiThinking(false);
        return;
      }

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
          setAiLog((l) => [...l, `${step.status === "failed" ? "⚠" : step.status === "recoverable_error" ? "↻" : "✓"} ${step.name}: ${step.log}`]);
        }
      }

      // === FATAL FAILURE HANDLING ===
      // The orchestrator returns status:"failed" (instead of throwing) when
      // a fatal step (Step 2 ATS-Before or Step 3 Optimizer) fails. We must
      // NOT show a success toast or transition to "done" — that would lie to
      // the user and charge a usage credit for nothing.
      if (result.status === "failed" || !result.optimizedResume) {
        const failedStepsFatal = result.steps.filter((s) => s.status === "failed");
        const fatalStep = failedStepsFatal.find((s) => s.error) || failedStepsFatal[0];
        const errMsg = fatalStep?.error || fatalStep?.log || "Optimization pipeline failed. Please try again.";
        setPipelineError(errMsg);
        setAiLog((l) => [...l, `✗ Pipeline failed: ${errMsg}`]);
        setAiThinking(false);
        // Stay on the optimize step so the user can retry
        toast.error(`Optimization failed: ${errMsg.slice(0, 120)}`);
        OptimizationSession.getInstance().completeRound({
          beforeATS: 0,
          afterATS: 0,
          strategies: [],
          successes: [],
          failures: [errMsg],
        });
        return;
      }

      // === RECOVERABLE ERROR HANDLING (directive §36–§39) ===
      // All validated optimizer attempts + auto-heal + fallbacks failed. The
      // pipeline NEVER substituted the original resume as the "optimized"
      // result. Show an honest RECOVERABLE state — no success toast, no usage
      // credit, no fake resume — and keep the job retryable in place.
      if (result.status === "recoverable_error") {
        const cov = result.keywordCoverage;
        // S4 — capture the completed intelligence artifacts so the retry
        // RESUMES (skips Job/Company Intelligence + Skill Gap AI calls).
        const cp = buildCheckpointFromResult(result, jdParsed);
        if (cp) setPipelineCheckpoint(cp);
        setPipelineError(
          "Optimization INCOMPLETE (recoverable): every validated AI attempt failed after retries, auto-heal and fallbacks. " +
          "Your completed analyses and snapshots are preserved and the original resume was NOT substituted as a result. " +
          "Use AI Providers → HEAL PROVIDERS, then retry — no re-upload needed."
        );
        setAiLog((l) => [
          ...l,
          "↻ Supervisor RECOVERING — Optimizer AI provider failure detected. Pipeline state preserved.",
          `↻ Recovery exhausted: validated retries + auto-heal + fallback${cov ? ` (keyword coverage at failure: ${cov.integrated} integrated / ${cov.total} JD keywords)` : ""}.`,
          "STATUS: RECOVERABLE_ERROR — optimization NOT completed. The original resume remains the SOURCE snapshot, never the result.",
        ]);
        setAiThinking(false);
        // Stay on the optimize step so the user can retry in place
        toast.warning("Optimization incomplete — AI providers unavailable. State preserved; original resume NOT substituted. Retry when providers recover.", { duration: 9000 });
        OptimizationSession.getInstance().completeRound({
          beforeATS: result.beforeATS?.scores.ats ?? 0,
          afterATS: 0, // No after-score — optimization did not complete
          strategies: result.steps.map((s) => s.name),
          successes: result.steps.filter((s) => s.status === "completed").map((s) => s.name),
          failures: result.steps.filter((s) => s.status === "recoverable_error" || s.status === "degraded" || s.status === "failed").map((s) => s.name),
        });
        return;
      }

      // === P0 FIX: Handle degraded status ===
      // The optimizer returned the original resume (no AI optimization happened).
      // Don't show a success toast — show a warning instead.
      if (result.status === "degraded") {
        setPipelineError("AI optimization was degraded — all AI providers failed. The original resume was returned unchanged. Please retry when AI providers recover.");
        setAiLog((l) => [...l, "⚠ Optimization degraded — original resume returned. No AI improvement applied."]);
        // REGRESSION FIX (P0 follow-up): result.afterATS is intentionally null in
        // degraded runs, but the "done" screen render guard requires `afterReport`.
        // Without it the results view never mounts — the pipeline appears to
        // finish while the screen stays blank ("optimization never completes").
        // Compute the ATS report locally from the returned (original) resume so
        // the done view renders; the header shows the After score as "N/A" for
        // degraded runs instead of a misleading BEFORE=AFTER number.
        if (!result.afterATS) {
          const degradedAfter = scoreATS(result.optimizedResume, jdParsed);
          setAfterReport(degradedAfter);
        }
        setAiThinking(false);
        setStep("done");
        toast.warning("Optimization degraded — AI providers unavailable. Original resume returned. Please retry later.", { duration: 8000 });
        OptimizationSession.getInstance().completeRound({
          beforeATS: result.beforeATS?.scores.ats ?? 0,
          afterATS: 0, // No after-score — optimization was degraded
          strategies: result.steps.map((s) => s.name),
          successes: result.steps.filter((s) => s.status === "completed").map((s) => s.name),
          failures: result.steps.filter((s) => s.status === "degraded" || s.status === "failed").map((s) => s.name),
        });
        return;
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

      // Job finished — release the AI configuration lock (directives #30).
      import("@/lib/ai/readiness/config-lock").then(({ clearJobAILock }) => clearJobAILock()).catch(() => {});

      const delta = (result.afterATS?.scores.ats ?? 0) - (result.beforeATS?.scores.ats ?? 0);
      const confidence = result.qa?.confidence ?? 0;
      const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
      toast.success(`Optimization complete — ATS ${result.beforeATS?.scores.ats ?? "?"} → ${result.afterATS?.scores.ats ?? "?"} (${deltaStr} pts) · Confidence ${confidence}/100`);

      // Record session memory round
      OptimizationSession.getInstance().completeRound({
        beforeATS: result.beforeATS?.scores.ats ?? 0,
        afterATS: result.afterATS?.scores.ats ?? 0,
        strategies: result.steps.map((s) => s.name),
        successes: result.steps.filter((s) => s.status === "completed").map((s) => s.name),
        failures: result.steps.filter((s) => s.status === "failed").map((s) => s.name),
      });
    } catch (e: any) {
      if (controller.signal.aborted) return;
      // Check for provider authentication errors — surface them specifically
      if (e?.name === "ProviderAuthenticationError" || e?.code === "auth_required" || e?.code === "session_expired") {
        const authMsg = e?.message || "Authentication required. Please sign in from Provider Settings.";
        setPipelineError(authMsg);
        setAiLog((l) => [...l, `✗ Authentication required: ${authMsg}`]);
        setAiThinking(false);
        toast.error(`Authentication required: ${authMsg.slice(0, 120)}`);
        return;
      }
      const errMsg = e?.message || "Optimization failed. Please try again.";
      setPipelineError(errMsg);
      setAiLog((l) => [...l, `✗ Pipeline failed: ${errMsg}`]);
      setAiThinking(false);
      toast.error(errMsg);
      // Job ended — release the AI configuration lock.
      import("@/lib/ai/readiness/config-lock").then(({ clearJobAILock }) => clearJobAILock()).catch(() => {});
    }
  }, [resume, jdParsed, beforeReport, industryMode, industryId, industrySettings, addResume, addATS, incUsage, log, pipelineCheckpoint]);

  // Legacy alias — the "Optimize" button still calls optimize().
  // Now it delegates to runPipeline().
  const optimize = runPipeline;

  // ============================================================================
  // runArena() — Model Variant Arena
  //
  // Runs runOptimizationPipeline in parallel for each selected provider,
  // storing the results in variantResults keyed by providerId.
  // The main pipeline result (pipelineResult) is still set from the first
  // provider to succeed (so the "done" step renders normally).
  // ============================================================================
  const runArena = useCallback(async () => {
    if (!resume || !jdParsed || !beforeReport || arenaProviderIds.length === 0) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setArenaRunning(true);
    setAiThinking(true);
    setAiLog([]);
    setPipelineProgress(null);
    setPipelineResult(null);
    setPipelineError(null);
    setOptimizedResume(null);
    setAfterReport(null);
    setVariantResults({});
    clearAllProviderCooldowns();

    setAiLog((l) => [...l, `🏟️ Model Variant Arena: running ${arenaProviderIds.length} providers in parallel…`]);

    const directiveConfig = useApp.getState().optimizerDirective;
    const baseInput = {
      resume,
      jd: jdParsed,
      userDirectives: directiveConfig?.customDirectiveOverride?.trim() || undefined,
      enableReflection: false, // skip reflection in Arena to keep runs fast
      deepAgenticMode: false,
      onProgress: undefined as any,
    };

    // Run all providers concurrently
    const settled = await Promise.allSettled(
      arenaProviderIds.map((pid) =>
        runOptimizationPipeline({ ...baseInput, providerId: pid })
          .then((r) => ({ pid, result: r }))
          .catch((e) => ({ pid, error: String(e) }))
      )
    );

    if (controller.signal.aborted) { setArenaRunning(false); setAiThinking(false); return; }

    const newVariants: Record<string, AgentPipelineResult> = {};
    let firstSuccess: AgentPipelineResult | null = null;
    let bestScore = -1;

    for (const s of settled) {
      if (s.status === "fulfilled") {
        const { pid, result, error } = s.value as any;
        if (result && result.status !== "failed") {
          newVariants[pid] = result;
          setAiLog((l) => [
            ...l,
            `✓ ${allProviders.find((p) => p.id === pid)?.name ?? pid}: ATS ${result.afterATS?.scores.ats ?? "?"}`,
          ]);
        } else {
          setAiLog((l) => [
            ...l,
            `✗ ${allProviders.find((p) => p.id === pid)?.name ?? pid}: ${error ?? result?.error ?? "failed"}`,
          ]);
        }
      }
    }

    // DETERMINISTIC JUDGE: the arena winner is the variant with the HIGHEST
    // ATS score (from the pipeline's own afterATS) — not merely the first to
    // succeed. Ties resolve to the earlier provider in the list.
    for (const pid of arenaProviderIds) {
      const v = newVariants[pid];
      const score = v?.afterATS?.scores?.ats ?? -1;
      if (v && score > bestScore) {
        bestScore = score;
        firstSuccess = v;
      }
    }

    setVariantResults(newVariants);

    if (firstSuccess) {
      setPipelineResult(firstSuccess);
      if (firstSuccess.optimizedResume) {
        setOptimizedResume(firstSuccess.optimizedResume);
        addResume(firstSuccess.optimizedResume);
      }
      if (firstSuccess.afterATS && firstSuccess.optimizedResume) {
        const after = scoreATS(firstSuccess.optimizedResume, jdParsed);
        after.scores.ats = firstSuccess.afterATS.scores.ats;
        after.scores.keywords = firstSuccess.afterATS.scores.keywordMatch;
        setAfterReport(after);
        addATS(after);
      }
      incUsage("resumesGenerated");
      setStep("done");
      toast.success(`Arena complete — best variant selected (ATS ${bestScore}/100 of ${Object.keys(newVariants).length}).`);
    } else {
      setPipelineError("All Arena providers failed. Please check your API keys and try again.");
      toast.error("Arena: all providers failed.");
    }

    setArenaRunning(false);
    setAiThinking(false);
  }, [resume, jdParsed, beforeReport, arenaProviderIds, allProviders, addResume, addATS, incUsage]);

  // Cancel any in-flight pipeline when the component unmounts
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // === AI ENGINE DASHBOARD live polling (directives #39, #43) ===
  // While the pipeline runs, poll the job lock for failovers/health so the
  // user sees the active engine, failover count and last supervisor event.
  useEffect(() => {
    if (!aiThinking || !aiEngineLock) { setAiEngineLive(null); return; }
    let alive = true;
    const tick = async () => {
      try {
        const { getJobAILock, getActiveJobModel } = await import("@/lib/ai/readiness/config-lock");
        const lock = getJobAILock();
        if (!alive || !lock) return;
        const active = getActiveJobModel();
        const lastEv = lock.events[lock.events.length - 1];
        setAiEngineLive({
          failovers: lock.failoverCount,
          activeProvider: active?.providerName ?? lock.primary.providerName,
          activeModel: active?.model ?? lock.primary.model,
          lastEvent: lastEv ? `${lastEv.type}: ${lastEv.note}` : null,
        });
      } catch { /* lock module unavailable */ }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [aiThinking, aiEngineLock]);

  // === Auto-load active JD when arriving from AI Resume Review ===
  // If the user navigated here with an activeJdId set (e.g. from the
  // "Optimize Resume" CTA in AI Resume Review), pre-populate the JD
  // text and skip straight to the JD step so they don't have to re-paste.
  useEffect(() => {
    if (activeJdId && !jdText && !jdParsed) {
      const activeJd = jds.find((j) => j.id === activeJdId);
      if (activeJd) {
        const jdRaw = Array.isArray(activeJd.keywords) ? activeJd.keywords : [];
        const text = typeof activeJd.rawText === "string" && activeJd.rawText.length > 30
          ? activeJd.rawText
          : jdRaw.join(", ");
        if (text && text.length >= 30) {
          setJdText(text);
          // Auto-select the resume if activeResumeId is set
          if (activeResumeId) {
            const r = resumes.find((x) => x.id === activeResumeId);
            if (r) setResume(r);
          }
          setStep("jd");
        }
      }
    }
  }, [activeJdId]);

  const reset = () => {
    setStep("upload");
    setResume(resumes[0] ?? null);
    setJdText("");
    setJdParsed(null);
    setBeforeReport(null);
    setBeforeAnalyzed(null);
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
            <Card className="flex flex-col">
              <Tabs defaultValue="file" className="w-full flex-1 flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Add your resume</CardTitle>
                    <TabsList className="grid w-[200px] grid-cols-2">
                      <TabsTrigger value="file">File Upload</TabsTrigger>
                      <TabsTrigger value="text">Paste Text</TabsTrigger>
                    </TabsList>
                  </div>
                  <CardDescription>Upload a file or paste your resume text to get started.</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col pt-0">
                  <TabsContent value="file" className="space-y-3 mt-2 flex-1 flex flex-col justify-between">
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="rounded-xl border-2 border-dashed border-border p-8 text-center cursor-pointer hover:border-brand/50 hover:bg-secondary/40 transition flex-1 flex flex-col items-center justify-center min-h-[160px]"
                    >
                      <Icon name="Upload" className="w-8 h-8 text-brand mx-auto" />
                      <div className="mt-2 font-medium text-sm">Drop your resume or click to browse</div>
                      <div className="text-xs text-muted-foreground mt-1">.pdf, .docx, .txt</div>
                    </div>
                    <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => uploadResume(e.target.files)} />
                    <div className="rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-2.5 flex items-start gap-2">
                      <Icon name="Info" className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">
                        Upload your existing resume in PDF or DOCX. The Parser Agent extracts experience, education, skills, certifications, projects, achievements, and languages — all in your browser.
                      </p>
                    </div>
                  </TabsContent>
                  <TabsContent value="text" className="space-y-3 mt-2 flex-1 flex flex-col justify-between">
                    <div className="flex-1 min-h-[160px] flex flex-col">
                      <Textarea
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder="Paste your plain text resume here (including summary, work experience, education, languages)..."
                        className="flex-1 min-h-[140px] text-xs resize-none"
                      />
                    </div>
                    <Button 
                      onClick={handlePasteResume} 
                      disabled={parsingText || pasteText.trim().length < 30} 
                      className="w-full bg-brand hover:bg-brand-dark text-white gap-2 mt-2"
                    >
                      {parsingText ? (
                        <>
                          <Icon name="Loader2" className="w-4 h-4 animate-spin" />
                          Parsing resume text...
                        </>
                      ) : (
                        <>
                          <Icon name="FileText" className="w-4 h-4" />
                          Parse resume text
                        </>
                      )}
                    </Button>
                  </TabsContent>
                </CardContent>
              </Tabs>
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
            <Card className="flex flex-col">
              <Tabs defaultValue="url" className="w-full flex-1 flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Target job description</CardTitle>
                    <TabsList className="grid w-[240px] grid-cols-2">
                      <TabsTrigger value="url">Fetch from URL</TabsTrigger>
                      <TabsTrigger value="text">Paste Text</TabsTrigger>
                    </TabsList>
                  </div>
                  <CardDescription>Enter a job listing URL or paste the job description text below.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <TabsContent value="url" className="space-y-3 mt-2">
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={jdUrl}
                        onChange={(e) => setJdUrl(e.target.value)}
                        placeholder="https://example.com/careers/job-listing-url"
                        className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
                      />
                      <Button onClick={scrapeJdUrl} disabled={scrapingJdUrl || aiThinking} className="bg-brand hover:bg-brand-dark text-white gap-2">
                        {scrapingJdUrl || aiThinking ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Globe" className="w-4 h-4" />}
                        {scrapingJdUrl ? "Scraping..." : aiThinking ? "Parsing..." : "Fetch & Parse"}
                      </Button>
                    </div>
                    {jdText && (
                      <div className="mt-3">
                        <label className="text-xs font-semibold text-muted-foreground uppercase mb-1">Scraped text preview:</label>
                        <Textarea
                          value={jdText}
                          readOnly
                          rows={6}
                          className="text-xs bg-secondary/30"
                        />
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="text" className="space-y-3 mt-2">
                    <Textarea
                      value={jdText}
                      onChange={(e) => setJdText(e.target.value)}
                      rows={10}
                      placeholder="Paste the full job description here…"
                    />
                    <div className="flex justify-end">
                      <Button onClick={parseJD} disabled={aiThinking || jdText.length < 30} className="bg-brand hover:bg-brand-dark text-white gap-2">
                        {aiThinking ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
                        {aiThinking ? "Parsing…" : "Parse with AI"}
                      </Button>
                    </div>
                  </TabsContent>

                  <div className="flex flex-wrap gap-2 justify-between mt-3 pt-3 border-t border-border">
                    <Button variant="outline" onClick={() => setStep("upload")} className="gap-1.5"><Icon name="ArrowLeft" className="w-4 h-4" /> Back</Button>
                    {jds.length > 0 && (
                      <select
                        onChange={(e) => {
                          const j = jds.find((x) => x.id === e.target.value);
                          if (j) {
                            const kws = Array.isArray(j.keywords) ? j.keywords : [];
                            const raw = typeof j.rawText === "string" ? j.rawText : "";
                            setJdText(raw || kws.join(", "));
                            setJdParsed(j);
                            setStep("analyze");
                          }
                        }}
                        className="h-9 px-3 rounded-md border border-input bg-background text-sm"
                        value=""
                      >
                        <option value="">Or load saved JD…</option>
                        {jds.map((j) => <option key={j.id} value={j.id}>{j.title || "Untitled role"}</option>)}
                      </select>
                    )}
                  </div>

                  {(aiThinking || scrapingJdUrl) && (
                    <div className="rounded-lg bg-secondary p-3 text-xs font-mono space-y-1 mt-3">
                      {aiLog.map((l, i) => <div key={i} className="flex items-center gap-2"><span className="text-brand">›</span> {l}</div>)}
                    </div>
                  )}
                  <div className="rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-2.5 flex items-start gap-2 mt-3">
                    <Icon name="Info" className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Paste a job posting or provide a job listing link to tailor your resume. The Job Intelligence Agent will extract required skills, technologies, certifications, ATS keywords, and industry terminology.
                    </p>
                  </div>
                </CardContent>
              </Tabs>
            </Card>

            {/* Career Context Indexer (RAG) Card */}
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Icon name="Database" className="w-4 h-4 text-brand" /> Career Context RAG Indexer
                </CardTitle>
                <CardDescription className="text-xs">
                  Index past career materials (resumes, cover letters, certs, projects) to automatically bridge skills gaps during optimization.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0 text-xs">
                {/* Add new career material */}
                <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2.5">
                  <div className="font-semibold text-xs">Index New Career Document / Certificate</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="rag-title" className="text-[10px] text-muted-foreground">Title</Label>
                      <Input
                        id="rag-title"
                        placeholder="e.g. AWS Solutions Architect Cert"
                        value={ragDraftTitle}
                        onChange={(e) => setRagDraftTitle(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="rag-category" className="text-[10px] text-muted-foreground">Category</Label>
                      <select
                        id="rag-category"
                        value={ragDraftCategory}
                        onChange={(e) => setRagDraftCategory(e.target.value as any)}
                        className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
                      >
                        <option value="certificate">Certificate</option>
                        <option value="project">Project / Case Study</option>
                        <option value="resume">Past Resume Version</option>
                        <option value="cover_letter">Past Cover Letter</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rag-content" className="text-[10px] text-muted-foreground">Document Details / Body Text</Label>
                    <Textarea
                      id="rag-content"
                      placeholder="Paste achievements, project descriptions, technologies used, or certificate details..."
                      value={ragDraftContent}
                      onChange={(e) => setRagDraftContent(e.target.value)}
                      className="min-h-[60px] text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!ragDraftTitle || !ragDraftContent) {
                        toast.error("Please fill in both title and content.");
                        return;
                      }
                      addCareerMaterial(ragDraftTitle, ragDraftContent, ragDraftCategory);
                      setRagDraftTitle("");
                      setRagDraftContent("");
                      toast.success("Document indexed successfully!");
                    }}
                    className="w-full h-8"
                  >
                    <Icon name="Plus" className="w-3.5 h-3.5 mr-1" /> Index Document
                  </Button>
                </div>

                {/* List of indexed materials */}
                <div className="space-y-2">
                  <div className="font-semibold text-xs flex items-center justify-between">
                    <span>Currently Indexed Materials ({careerMaterials.length})</span>
                    {careerMaterials.length > 0 && <span className="text-[10px] text-emerald-600 font-medium">Active & ready for RAG matching</span>}
                  </div>
                  {careerMaterials.length === 0 ? (
                    <div className="text-center py-4 border border-dashed rounded text-muted-foreground bg-secondary/10">
                      No career materials indexed yet. Add some achievements or past projects to help the AI.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                      {careerMaterials.map((mat) => (
                        <div key={mat.id} className="flex items-center justify-between p-2 bg-secondary/30 rounded border border-border/50">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate flex items-center gap-1.5">
                              <Badge variant="outline" className="text-[9px] uppercase px-1">
                                {mat.category}
                              </Badge>
                              <span className="truncate">{mat.title}</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate mt-0.5">{mat.contentText}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              deleteCareerMaterial(mat.id);
                              toast.success("Material deleted from index.");
                            }}
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-500/10"
                          >
                            <Icon name="Trash" className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
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
                    <div><span className="text-muted-foreground">Title:</span> <span className="font-semibold">{String(jdParsed.title || "Untitled role")}</span></div>
                    {jdParsed.company && <div><span className="text-muted-foreground">Company:</span> {String(jdParsed.company)}</div>}
                    {jdParsed.location && <div><span className="text-muted-foreground">Location:</span> {String(jdParsed.location)}</div>}
                    {jdParsed.experienceYears && <div><span className="text-muted-foreground">Experience:</span> {String(jdParsed.experienceYears)}</div>}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Keywords ({(jdParsed.keywords ?? []).length})</div>
                      <div className="flex flex-wrap gap-1">{(jdParsed.keywords ?? []).map((k, i) => <Badge key={`${k}-${i}`} variant="outline" className="text-[10px]">{String(k)}</Badge>)}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* === ATS Score Simulator — keyword density + section completeness gauge === */}
            {resume && (
              <ATSScoreSimulator resume={resume} jd={jdParsed} />
            )}

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
            <div className="lg:col-span-1 space-y-4">
              <Card>
                <CardContent className="flex flex-col items-center pt-6">
                  {/* === UNIFIED SCORING ===
                      Use the V2 analyzeATS() score (beforeAnalyzed) so the
                      "optimize" step shows the SAME number the "done" step
                      will show. Falls back to legacy scoreATS() if analyzeATS
                      hasn't been computed yet. */}
                  <ScoreRing value={beforeAnalyzed?.scores.ats ?? beforeReport.scores.ats} size={140} label="Current ATS" />
                  <div className="mt-3 text-sm text-muted-foreground text-center">
                    {beforeReport.missingKeywords.length} missing keywords · {beforeReport.matchedKeywords.length} matched
                  </div>
                </CardContent>
              </Card>

              {/* Detected ATS System Info card */}
              {detectedAtsDetails && (
                <Card className="border-brand/35 bg-brand/5 dark:bg-brand/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                      <Icon name="Activity" className="w-4 h-4 text-brand" />
                      Target ATS: {detectedAtsDetails.name}
                    </CardTitle>
                    <CardDescription className="text-[11px]">
                      Based on company and job description details.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    <div className="text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400 p-2 rounded border border-amber-500/20 font-medium">
                      ⚠️ {detectedAtsDetails.warning}
                    </div>
                    <div>
                      <div className="font-semibold text-muted-foreground uppercase text-[10px] mb-1.5 tracking-wider">
                        Known Quirks:
                      </div>
                      <ul className="space-y-1 list-disc pl-4 text-muted-foreground leading-relaxed">
                        {detectedAtsDetails.quirks.map((q, idx) => (
                          <li key={idx}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* === Pre-optimization ATS gauge (compact) === */}
            {resume && (
              <ATSScoreSimulator resume={resume} jd={jdParsed} compact />
            )}

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
                          {industryMode && (
                            <Badge variant="brand" className="text-[10px]">{INDUSTRY_PROFILES[industryId]?.label ?? "Generic"}</Badge>
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
                            <span className="font-semibold">{INDUSTRY_PROFILES[industryDetection.industryId]?.label ?? "Generic"} {industryDetection.confidence < 30 && <span className="text-amber-500 text-[9px]">(low confidence)</span>}</span>
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

                {/* === Deep Agentic Mode Toggle === */}
                <div className="mt-4 flex items-center justify-between p-3 rounded-lg border border-input bg-card/50">
                  <div className="flex gap-2">
                    <Icon name="Sparkles" className="w-5 h-5 text-brand shrink-0" />
                    <div>
                      <div className="text-xs font-semibold">Deep Agentic Mode</div>
                      <div className="text-[10px] text-muted-foreground">Runs autonomous self-correction loops to maximize QA score and factual integrity.</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={deepAgenticMode}
                    onChange={(e) => setDeepAgenticMode(e.target.checked)}
                    className="w-4 h-4 rounded text-brand focus:ring-brand border-input bg-background"
                  />
                </div>

                {/* === Model Variant Arena Toggle === */}
                <div className="mt-3 rounded-lg border border-input bg-card/50 overflow-hidden">
                  <div className="flex items-center justify-between p-3">
                    <div className="flex gap-2">
                      <Icon name="Trophy" className="w-5 h-5 text-amber-500 shrink-0" />
                      <div>
                        <div className="text-xs font-semibold">Model Variant Arena</div>
                        <div className="text-[10px] text-muted-foreground">Run multiple AI providers in parallel and compare ATS scores side-by-side.</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={arenaMode}
                      onChange={(e) => { setArenaMode(e.target.checked); if (!e.target.checked) setArenaProviderIds([]); }}
                      className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400 border-input bg-background"
                    />
                  </div>
                  {arenaMode && (
                    <div className="px-3 pb-3 border-t border-input/50 pt-2">
                      <div className="text-[10px] text-muted-foreground mb-2 font-semibold uppercase tracking-wide">Select providers to compare (up to 3)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {allProviders
                          .filter((p) => p.isActive)
                          .slice(0, 8)
                          .map((p) => {
                            const selected = arenaProviderIds.includes(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setArenaProviderIds((prev) =>
                                    selected
                                      ? prev.filter((id) => id !== p.id)
                                      : prev.length < 3
                                      ? [...prev, p.id]
                                      : prev
                                  );
                                }}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all duration-150 ${
                                  selected
                                    ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                                    : "bg-secondary text-secondary-foreground border-input hover:border-amber-400 hover:text-amber-600"
                                } ${!selected && arenaProviderIds.length >= 3 ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                              >
                                {p.name}
                              </button>
                            );
                          })}
                      </div>
                      {arenaProviderIds.length === 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1.5 italic">Select at least one provider to enable Arena mode.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-5 flex gap-2">
                  <Button variant="outline" onClick={() => setStep("analyze")} className="gap-1.5"><Icon name="ArrowLeft" className="w-4 h-4" /> Back</Button>
                  {arenaMode && arenaProviderIds.length > 0 ? (
                    <Button onClick={runArena} disabled={aiThinking || arenaRunning} className="bg-amber-500 hover:bg-amber-600 text-white gap-2 flex-1">
                      {arenaRunning ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Trophy" className="w-4 h-4" />}
                      {arenaRunning ? `Arena running (${arenaProviderIds.length} providers)…` : `Run Arena (${arenaProviderIds.length} provider${arenaProviderIds.length > 1 ? "s" : ""})`}
                    </Button>
                  ) : (
                    <Button onClick={optimize} disabled={aiThinking} className="bg-brand hover:bg-brand-dark text-white gap-2 flex-1">
                      {aiThinking ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : industryMode ? <Icon name="Building2" className="w-4 h-4" /> : <Icon name="Wand2" className="w-4 h-4" />}
                      {aiThinking ? "Optimizing…" : industryMode ? `Run ${INDUSTRY_PROFILES[industryId]?.label ?? "Industry"} ATS optimizer` : "Run AI optimizer"}
                    </Button>
                  )}
                </div>

                {/* === AI ENGINE DASHBOARD (directive #39) === */}
                {aiThinking && aiEngineLock && (
                  <div className="mt-4 rounded-lg border border-brand/25 bg-brand/5 dark:bg-brand/10 p-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                      <span className="font-semibold flex items-center gap-1.5"><Icon name="Cpu" className="w-4 h-4 text-brand" /> AI ENGINE</span>
                      <span className="text-muted-foreground">Primary:</span>
                      <span className="font-medium">{aiEngineLock.providerName} — <span className="font-mono">{aiEngineLock.model}</span></span>
                      {aiEngineLive && (aiEngineLive.activeProvider !== aiEngineLock.providerName || aiEngineLive.failovers > 0) ? (
                        <Badge variant="warning"><Icon name="Shuffle" className="w-3 h-3 mr-0.5" /> FAILOVER {aiEngineLive.failovers} — now on {aiEngineLive.activeProvider}</Badge>
                      ) : (
                        <Badge variant="success">● HEALTHY</Badge>
                      )}
                      <Badge variant="outline">Readiness {aiEngineLock.readiness}/100</Badge>
                      <Badge variant="outline">{aiEngineLock.latencyMs}ms</Badge>
                      {activePipelineProfileName && <Badge variant="outline"><Icon name="Workflow" className="w-3 h-3 mr-0.5" /> {activePipelineProfileName}</Badge>}
                      {aiEngineLock.fallback && <span className="text-[10px] text-muted-foreground">Fallback: {aiEngineLock.fallback}</span>}
                      <Badge variant="outline" className="ml-auto"><Icon name="ShieldCheck" className="w-3 h-3 mr-0.5" /> Supervisor: FAILOVER PROTECTED</Badge>
                    </div>
                    {aiEngineLive?.lastEvent && (
                      <div className="mt-1.5 text-[10px] text-muted-foreground font-mono truncate">{aiEngineLive.lastEvent}</div>
                    )}
                  </div>
                )}

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
                    {/* DEGRADED FIX: result.afterATS is null for degraded runs — show N/A instead of a misleading BEFORE=AFTER score. */}
                    <div className="text-3xl font-bold font-display text-gold">{pipelineResult?.status === "degraded" ? "N/A" : (pipelineResult?.afterATS?.scores.ats ?? afterReport.scores.ats)}</div>
                  </div>
                  <div className="ml-3">
                    {(() => {
                      // DEGRADED FIX: no delta claim when the run was degraded — no AI optimization happened.
                      if (pipelineResult?.status === "degraded") {
                        return (
                          <Badge variant="warning" className="text-sm">
                            ⚠ Degraded — no AI optimization applied
                          </Badge>
                        );
                      }
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

            {/* === Resume Preview Panel — before/after comparison === */}
            {resume && optimizedResume && (
              <DiffPreview original={resume} optimized={optimizedResume} />
            )}

            {/* === 5-agent pipeline results (before/after ATS, keyword improvements, recommendations, confidence, reflection) === */}
            {pipelineResult && (
              <PipelineResults result={pipelineResult} />
            )}

            {pipelineResult && jdParsed && resume && optimizedResume && (
              <ATSInspectionSuite
                resume={resume}
                optimized={optimizedResume}
                jd={jdParsed}
                missingKeywords={pipelineResult.keywordFeedback?.missingKeywords ?? []}
                onUpdateResume={(updated) => {
                  setOptimizedResume(updated);
                  updateResume(updated.id, updated);
                }}
              />
            )}

            {/* === MODEL VARIANT ARENA RESULTS === */}
            {Object.keys(variantResults).length > 1 && (
              <Card className="border-amber-300 dark:border-amber-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon name="Trophy" className="w-4 h-4 text-amber-500" />
                    Model Variant Arena — Side-by-Side Comparison
                    <Badge variant="outline" className="ml-auto text-amber-600 border-amber-400 text-[10px]">
                      {Object.keys(variantResults).length} variants
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Each provider optimized your resume independently. Pick the best result to export.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Score leaderboard */}
                  <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${Object.keys(variantResults).length}, minmax(0,1fr))` }}>
                    {Object.entries(variantResults)
                      .sort(([, a], [, b]) => (b.afterATS?.scores.ats ?? 0) - (a.afterATS?.scores.ats ?? 0))
                      .map(([pid, res], idx) => {
                        const pName = allProviders.find((p) => p.id === pid)?.name ?? pid;
                        const atsScore = res.afterATS?.scores.ats ?? 0;
                        const beforeScore = res.beforeATS?.scores.ats ?? (beforeReport?.scores.ats ?? 0);
                        const delta = atsScore - beforeScore;
                        const isWinner = idx === 0;
                        return (
                          <div
                            key={pid}
                            className={`relative rounded-xl p-4 border text-center transition-all ${
                              isWinner
                                ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30 shadow-md"
                                : "border-input bg-card/60"
                            }`}
                          >
                            {isWinner && (
                              <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
                                🏆 BEST
                              </div>
                            )}
                            <div className={`text-[11px] font-semibold mb-2 truncate ${isWinner ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                              {pName}
                            </div>
                            <div className={`text-4xl font-bold font-display mb-1 ${isWinner ? "text-amber-600" : ""}`}>
                              {atsScore}
                            </div>
                            <div className="text-[10px] text-muted-foreground mb-2">ATS Score</div>
                            <Badge
                              variant={delta >= 0 ? "outline" : "warning"}
                              className={`text-[10px] ${
                                isWinner ? "border-amber-400 text-amber-700" : ""
                              }`}
                            >
                              {delta >= 0 ? "+" : ""}{delta} pts vs original
                            </Badge>
                            {res.optimizedResume && (
                              <Button
                                size="sm"
                                variant="outline"
                                className={`mt-3 w-full text-[11px] h-7 ${
                                  isWinner ? "border-amber-400 text-amber-700 hover:bg-amber-100" : ""
                                }`}
                                onClick={() => {
                                  if (res.optimizedResume) {
                                    setOptimizedResume(res.optimizedResume);
                                    toast.success(`Switched to ${pName} variant.`);
                                  }
                                }}
                              >
                                <Icon name="Check" className="w-3 h-3 mr-1" /> Use this version
                              </Button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                  {/* Keyword comparison table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-separate border-spacing-0">
                      <thead>
                        <tr>
                          <th className="text-left text-muted-foreground font-semibold px-3 py-2 bg-secondary/50 rounded-tl-lg">Metric</th>
                          {Object.entries(variantResults)
                            .sort(([, a], [, b]) => (b.afterATS?.scores.ats ?? 0) - (a.afterATS?.scores.ats ?? 0))
                            .map(([pid], idx) => (
                              <th key={pid} className={`text-center px-3 py-2 font-semibold ${
                                idx === 0 ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700" : "bg-secondary/50 text-muted-foreground"
                              } ${idx === Object.keys(variantResults).length - 1 ? "rounded-tr-lg" : ""}`}>
                                {allProviders.find((p) => p.id === pid)?.name ?? pid}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: "Keyword Match", fn: (r: AgentPipelineResult) => r.afterATS?.scores.keywordMatch ?? "—" },
                          { label: "Content Score", fn: (r: AgentPipelineResult) => r.afterATS?.scores.content ?? "—" },
                          { label: "Matched Keywords", fn: (r: AgentPipelineResult) => r.afterATS?.matchedKeywords.length ?? "—" },
                          { label: "Missing Keywords", fn: (r: AgentPipelineResult) => r.afterATS?.missingKeywords.length ?? "—" },
                          { label: "Provider Used", fn: (r: AgentPipelineResult) => r.provider ?? "—" },
                        ].map((row, ri) => (
                          <tr key={row.label} className={ri % 2 === 0 ? "bg-secondary/20" : ""}>
                            <td className="px-3 py-1.5 text-muted-foreground font-medium">{row.label}</td>
                            {Object.entries(variantResults)
                              .sort(([, a], [, b]) => (b.afterATS?.scores.ats ?? 0) - (a.afterATS?.scores.ats ?? 0))
                              .map(([pid, res], idx) => (
                                <td key={pid} className={`px-3 py-1.5 text-center font-semibold ${
                                  idx === 0 ? "text-amber-700 dark:text-amber-400" : ""
                                }`}>
                                  {String(row.fn(res))}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* === V3: Pipeline Dashboard — shows ALL agent statuses (Supervisor, Memory, CoverLetter, Interview, CareerCoach, etc.) === */}
            {pipelineResult && (
              <Suspense fallback={null}>
                <PipelineDashboardLazy />
              </Suspense>
            )}

            {/* === Per-node trajectory (agentic observability) — live during runs and after completion === */}
            {(aiThinking || pipelineResult) && (
              <Suspense fallback={null}>
                <PipelineTrajectoryPanelLazy />
              </Suspense>
            )}

            {/* Live-editable InfoHAS Pro preview + Copilot chat side-by-side */}
            <div className="grid lg:grid-cols-3 gap-6 items-start">
              {/* Preview column */}
              <Card className="lg:col-span-2">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      <h3 className="font-display text-lg font-bold flex items-center gap-2">
                        <Icon name="FileText" className="w-4 h-4 text-brand" /> Optimized resume
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="inline-flex items-center">
                          <Icon name="Pencil" className="w-3 h-3 inline text-brand" />
                          <span className="md:hidden"> Tap any section (or the pencil badge) to edit live. Tap the photo frame to upload your photo. Final step before export.</span>
                          <span className="hidden md:inline"> Hover any section to see a pencil — click to edit live. Click the photo frame to upload your photo. Final step before export.</span>
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground font-semibold">Template:</label>
                      <select
                        value={optimizedResume.template || "infohas-pro"}
                        onChange={(e) => {
                          const newTemplate = e.target.value as any;
                          const next = { ...optimizedResume, template: newTemplate, updatedAt: new Date().toISOString() };
                          setOptimizedResume(next);
                          updateResume(next.id, { template: newTemplate });
                        }}
                        className="h-8 px-2 rounded-md border border-input bg-background text-xs font-semibold"
                      >
                        <option value="infohas-pro">InfoHAS Pro Layout</option>
                        <option value="ats-professional">ATS Professional Layout</option>
                        <option value="executive">Executive Layout</option>
                        <option value="modern">Modern Layout</option>
                        <option value="minimal">Minimal Layout</option>
                        <option value="corporate">Corporate Layout</option>
                        <option value="tech">Tech Layout</option>
                      </select>
                      <Badge variant="brand"><Icon name="Lock" className="w-3 h-3" /> One A4 page · validated</Badge>
                    </div>
                  </div>
                  <div className="rounded-xl bg-secondary/60 p-2 sm:p-4 overflow-auto" style={{ maxHeight: "calc(100vh - 120px)" }}>
                    <div className="flex justify-center">
                      <EditableA4Preview
                        resume={optimizedResume}
                        onChange={(p) => {
                          const next = { ...optimizedResume, ...p, updatedAt: new Date().toISOString() };
                          setOptimizedResume(next);
                          updateResume(next.id, p);
                        }}
                        scale={previewScale}
                        activeElement={activeElement}
                        setActiveElement={setActiveElement}
                        onOverflowChange={setIsPageOverflowing}
                        optimizingSection={copilotLoading ? activeElement?.section || "all" : aiThinking ? "all" : null}
                      />
                    </div>
                  </div>

                  {/* Manual Layout Precision Tuning Panel */}
                  <Card className="mt-4 border-brand/20 bg-secondary/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-brand">
                        <Icon name="Settings" className="w-3.5 h-3.5" />
                        Manual Layout Precision Tuning
                      </CardTitle>
                      <CardDescription className="text-[10px]">
                        Override page margins, sizing, and line spacing to achieve the perfect fit.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0 text-[11px]">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {/* Font Size */}
                        <div className="space-y-1">
                          <div className="flex justify-between font-medium">
                            <span>Font Size</span>
                            <span className="text-brand font-semibold">{config?.bodyFontSizePt ?? 10.5} pt</span>
                          </div>
                          <input
                            type="range"
                            min="9"
                            max="12"
                            step="0.1"
                            value={config?.bodyFontSizePt ?? 10.5}
                            onChange={(e) => updateOptimizerDirective({ bodyFontSizePt: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-brand"
                          />
                        </div>

                        {/* Line Height */}
                        <div className="space-y-1">
                          <div className="flex justify-between font-medium">
                            <span>Line Height</span>
                            <span className="text-brand font-semibold">{config?.lineHeight ?? 1.2}</span>
                          </div>
                          <input
                            type="range"
                            min="1.0"
                            max="1.5"
                            step="0.05"
                            value={config?.lineHeight ?? 1.2}
                            onChange={(e) => updateOptimizerDirective({ lineHeight: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-brand"
                          />
                        </div>

                        {/* Margins Top/Bottom */}
                        <div className="space-y-1">
                          <div className="flex justify-between font-medium">
                            <span>Top/Bottom Margins</span>
                            <span className="text-brand font-semibold">{config?.marginTopMm ?? 6.35} mm</span>
                          </div>
                          <input
                            type="range"
                            min="4"
                            max="15"
                            step="0.5"
                            value={config?.marginTopMm ?? 6.35}
                            onChange={(e) => updateOptimizerDirective({
                              marginTopMm: parseFloat(e.target.value),
                              marginBottomMm: parseFloat(e.target.value)
                            })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-brand"
                          />
                        </div>

                        {/* Margins Left/Right */}
                        <div className="space-y-1">
                          <div className="flex justify-between font-medium">
                            <span>Side Margins</span>
                            <span className="text-brand font-semibold">{config?.marginLeftMm ?? 8.89} mm</span>
                          </div>
                          <input
                            type="range"
                            min="6"
                            max="18"
                            step="0.5"
                            value={config?.marginLeftMm ?? 8.89}
                            onChange={(e) => updateOptimizerDirective({
                              marginLeftMm: parseFloat(e.target.value),
                              marginRightMm: parseFloat(e.target.value)
                            })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-brand"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {/* Section Gap */}
                        <div className="space-y-1">
                          <div className="flex justify-between font-medium">
                            <span>Section Gap</span>
                            <span className="text-brand font-semibold">{config?.sectionGapMm ?? 3} mm</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="8"
                            step="0.5"
                            value={config?.sectionGapMm ?? 3}
                            onChange={(e) => updateOptimizerDirective({ sectionGapMm: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-brand"
                          />
                        </div>

                        {/* Bullet Indent */}
                        <div className="space-y-1">
                          <div className="flex justify-between font-medium">
                            <span>Bullet Indent</span>
                            <span className="text-brand font-semibold">{config?.bulletIndentMm ?? 6.4} mm</span>
                          </div>
                          <input
                            type="range"
                            min="4"
                            max="12"
                            step="0.5"
                            value={config?.bulletIndentMm ?? 6.4}
                            onChange={(e) => updateOptimizerDirective({ bulletIndentMm: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-brand"
                          />
                        </div>

                        {/* Contact Spacing */}
                        <div className="space-y-1">
                          <div className="flex justify-between font-medium">
                            <span>Contact Layout</span>
                          </div>
                          <select
                            value={config?.contactSpacing || "stacked"}
                            onChange={(e) => updateOptimizerDirective({ contactSpacing: e.target.value as any })}
                            className="w-full h-7 px-2 rounded border border-input bg-background text-[11px]"
                          >
                            <option value="stacked">Stacked Rows (Default)</option>
                            <option value="single-line">Single Inline Row</option>
                          </select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </CardContent>
              </Card>

              {/* Copilot column */}
              <div className="lg:col-span-1 space-y-4">
                {/* Detected ATS Warning inside the sidebar */}
                {detectedAtsDetails && (
                  <Card className="border-amber-300 dark:border-amber-700 bg-amber-500/5">
                    <CardHeader className="pb-1.5 pt-3 px-4">
                      <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                        <Icon name="AlertTriangle" className="w-3.5 h-3.5" />
                        Target: {detectedAtsDetails.name} System
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3 pt-0 text-[11px] text-muted-foreground leading-normal">
                      {detectedAtsDetails.warning}
                    </CardContent>
                  </Card>
                )}

                {/* Copilot Chat Box */}
                <Card className="flex flex-col border border-border shadow-sm overflow-hidden h-[540px]">
                  <CardHeader className="p-3 border-b border-border/80 bg-gradient-to-r from-violet-600/5 to-indigo-600/5 shrink-0">
                    <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                      <Icon name="Sparkles" className="w-4 h-4 text-violet-600 animate-pulse" />
                      AI Optimizer Copilot
                    </CardTitle>
                    <CardDescription className="text-[10px]">
                      Ask AI to refine, expand, or adjust your optimized resume.
                    </CardDescription>
                  </CardHeader>

                  {/* Suggestions list when chat is empty or fresh */}
                  {copilotMessages.length <= 1 && (
                    <div className="p-2.5 border-b border-border/40 bg-slate-500/5 space-y-1 shrink-0">
                      <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
                        <Icon name="Lightbulb" className="w-3 h-3 text-amber-500" /> Suggestions
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {[
                          { text: "✍️ Shorten summary", prompt: "shorten the summary to be under 3 sentences" },
                          { text: "💼 Highlight leadership", prompt: "rewrite the first job experience bullet points to focus on leadership" },
                          { text: "💪 Add technical metrics", prompt: "make my experience bullet points contain more quantified metrics" },
                        ].map((s, idx) => (
                          <button
                            key={idx}
                            onClick={() => sendCopilotMessage(s.prompt)}
                            className="text-[9px] px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:border-brand hover:text-brand font-medium transition cursor-pointer"
                          >
                            {s.text}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Messages list */}
                  <div className="flex-1 p-3 overflow-y-auto space-y-3 scrollbar-thin">
                    {copilotMessages.map((msg, idx) => (
                      <div key={idx} className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                          msg.role === "user" ? "bg-slate-200 dark:bg-slate-800 text-slate-700" : "bg-gradient-to-tr from-violet-600 to-indigo-600 text-white"
                        }`}>
                          {msg.role === "user" ? "U" : <Icon name="Sparkles" className="w-2.5 h-2.5" />}
                        </div>
                        <div className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs leading-normal shadow-sm ${
                          msg.role === "user"
                            ? "bg-slate-900 dark:bg-slate-800 text-slate-100 rounded-tr-none border border-slate-800"
                            : "bg-secondary/40 border border-border text-foreground rounded-tl-none prose prose-xs dark:prose-invert"
                        }`}>
                          {msg.role === "assistant" ? (
                            <div className="[&_p]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-1 font-sans">
                              {/* Simple paragraph/bullet renderer */}
                              {msg.content.split("\n").map((line, li) => {
                                if (line.trim().startsWith("-") || line.trim().startsWith("*")) {
                                  return <li key={li}>{renderFormattedText(line.trim().substring(1).trim())}</li>;
                                }
                                return <p key={li} className="mb-1">{renderFormattedText(line)}</p>;
                              })}
                            </div>
                          ) : (
                            msg.content
                          )}
                        </div>
                      </div>
                    ))}

                    {copilotLoading && (
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-violet-500 to-indigo-500 flex items-center justify-center shrink-0 animate-pulse">
                          <Icon name="Sparkles" className="w-2.5 h-2.5 text-white" />
                        </div>
                        <div className="flex-1 space-y-1.5 max-w-[80%] py-0.5">
                          <div className="h-2.5 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-3/4" />
                          <div className="h-2.5 bg-slate-200/80 dark:bg-slate-800/80 rounded animate-pulse w-1/2" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Floating Quick Actions */}
                  <div className="px-2 pt-2 flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0 border-t border-border/40 bg-slate-50/20 dark:bg-slate-900/10">
                    <span className="text-[9px] uppercase font-bold text-muted-foreground shrink-0 pl-1 mr-1 flex items-center gap-0.5">
                      <Icon name="Wand2" className="w-2.5 h-2.5 text-brand" /> Quick:
                    </span>
                    <div className="flex items-center gap-1.5 pb-2">
                      <button
                        onClick={() => sendCopilotMessage("Rewrite the professional summary or experience bullets to make them highly punchy, action-oriented, and outcome-focused.")}
                        className="text-[10px] whitespace-nowrap px-2.5 py-1 rounded-full border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950/50 font-medium shadow-sm transition active:scale-95 cursor-pointer flex items-center gap-1"
                      >
                        <span>🚀 Make it Punchy</span>
                      </button>
                      <button
                        onClick={() => sendCopilotMessage("Analyze my experience bullets and rewrite them to include placeholders [X%] or [Y] where metrics can be added.")}
                        className="text-[10px] whitespace-nowrap px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 font-medium shadow-sm transition active:scale-95 cursor-pointer flex items-center gap-1"
                      >
                        <span>📈 Add Metrics</span>
                      </button>
                      <button
                        onClick={() => sendCopilotMessage("Polish my resume summary and experience bullet points specifically for a Cabin Crew / Luxury Hospitality role, emphasizing safety, premium guest experience, and presentation standards.")}
                        className="text-[10px] whitespace-nowrap px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 font-medium shadow-sm transition active:scale-95 cursor-pointer flex items-center gap-1"
                      >
                        <span>✈️ Cabin Crew Polish</span>
                      </button>
                      <button
                        onClick={() => sendCopilotMessage("Condense my resume text to make it extremely concise and fit neatly onto a single A4 page.")}
                        className="text-[10px] whitespace-nowrap px-2.5 py-1 rounded-full border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:rose-950/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/50 font-medium shadow-sm transition active:scale-95 cursor-pointer flex items-center gap-1"
                      >
                        <span>🔍 Trim Fluff</span>
                      </button>
                    </div>
                  </div>

                  {/* Input box */}
                  <div className="p-2 border-t border-border flex gap-1.5 bg-slate-50/50 dark:bg-slate-900/40 shrink-0">
                    <Input
                      value={copilotInput}
                      onChange={(e) => setCopilotInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendCopilotMessage();
                        }
                      }}
                      placeholder="Ask copilot to tweak..."
                      className="text-xs h-8 bg-white dark:bg-slate-950"
                      disabled={copilotLoading}
                    />
                    <Button
                      size="sm"
                      onClick={() => sendCopilotMessage()}
                      disabled={copilotLoading || !copilotInput.trim()}
                      className="h-8 w-8 p-0 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-sm shrink-0"
                    >
                      <Icon name="Send" className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </Card>
              </div>
            </div>

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
                    <Button onClick={() => triggerExport("pdf")} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Download" className="w-4 h-4" /> optimized_resume.pdf</Button>
                    <Button variant="outline" onClick={() => triggerExport("doc")} className="gap-2" title="Strict A4 one-page Word document (Times New Roman 12pt, @page A4)">
                      <Icon name="FileText" className="w-4 h-4" /> .doc
                    </Button>
                    <Button variant="outline" onClick={() => triggerExport("docx")} className="gap-2"><Icon name="FileType" className="w-4 h-4" /> .docx</Button>
                    <Button variant="outline" onClick={() => triggerExport("txt")} className="gap-2"><Icon name="FileText" className="w-4 h-4" /> .txt</Button>
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

            {/* === ATS Keyword Audit & Optimization Panel === */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Icon name="CheckSquare" className="w-4 h-4 text-brand" /> ATS Keyword Audit & Optimization Panel
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-2">
                      MATCHED KEYWORDS ({(pipelineResult?.afterATS?.matchedKeywords.length ?? afterReport.matchedKeywords.length)})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {((pipelineResult?.afterATS?.matchedKeywords ?? afterReport.matchedKeywords) || []).map((kw: string) => (
                        <Badge key={kw} variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 text-xs py-0.5 px-2">
                          <Icon name="Check" className="w-3 h-3" /> {kw}
                        </Badge>
                      ))}
                      {((pipelineResult?.afterATS?.matchedKeywords ?? afterReport.matchedKeywords) || []).length === 0 && (
                        <div className="text-xs text-muted-foreground">No matched keywords found yet. Try refining your content.</div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-2">
                      MISSING KEYWORDS ({(pipelineResult?.afterATS?.missingKeywords.length ?? afterReport.missingKeywords.length)}) — Click keyword to inject automatically
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {((pipelineResult?.afterATS?.missingKeywords ?? afterReport.missingKeywords) || []).map((kw: string) => {
                        const isInjecting = injectingKeyword === kw;
                        return (
                          <button
                            key={kw}
                            disabled={!!injectingKeyword}
                            className={`inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-semibold gap-1.5 transition-all duration-200 ${
                              isInjecting 
                                ? "bg-brand/20 border-brand/50 text-brand animate-pulse cursor-wait"
                                : "bg-secondary text-secondary-foreground hover:bg-brand/10 hover:border-brand/30 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            }`}
                            onClick={() => handleInjectKeyword(kw)}
                          >
                            {isInjecting ? (
                              <Icon name="Loader2" className="w-3 h-3 animate-spin text-brand" />
                            ) : (
                              <Icon name="Sparkles" className="w-3 h-3 text-brand" />
                            )}
                            {kw}
                          </button>
                        );
                      })}
                      {((pipelineResult?.afterATS?.missingKeywords ?? afterReport.missingKeywords) || []).length === 0 && (
                        <div className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                          <Icon name="CheckCircle2" className="w-3.5 h-3.5" /> ✓ Perfect match! All job description keywords are present in the optimized resume.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

          </motion.div>
          )
        )}
      </AnimatePresence>
      {optimizedResume && (
        <AICopilotPanel
          resume={optimizedResume}
          activeJD={jdParsed}
          atsScore={afterReport}
          patch={patchOptimizedResume}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          undoStack={undoStack}
          redoStack={redoStack}
          activeElement={activeElement}
          setActiveElement={setActiveElement}
          isPageOverflowing={isPageOverflowing}
        />
      )}

      <AnimatePresence>
        {bypassModal && bypassModal.open && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start gap-4">
                <div className="p-3 bg-amber-500/10 rounded-full text-amber-500 shrink-0">
                  <Icon name="AlertTriangle" className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Quality Gate Verification</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Your optimized resume does not meet some target quality metrics. Review the details below:
                  </p>
                </div>
              </div>

              <div className="p-6 max-h-[300px] overflow-y-auto space-y-3 bg-slate-50/50 dark:bg-slate-950/20">
                {bypassModal.errors.map((error, idx) => (
                  <div key={idx} className="flex gap-2.5 items-start text-sm text-slate-700 dark:text-slate-300">
                    <Icon name="AlertCircle" className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                ))}
              </div>

              <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-white dark:bg-slate-900">
                <Button
                  variant="outline"
                  onClick={() => setBypassModal(null)}
                  className="text-slate-700 dark:text-slate-300"
                >
                  Close & Optimize
                </Button>
                <Button
                  onClick={handleBypassExport}
                  className="bg-amber-600 hover:bg-amber-700 text-white shadow-md gap-2"
                >
                  <Icon name="Download" className="w-4 h-4" />
                  Dismiss & Download Anyway
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
