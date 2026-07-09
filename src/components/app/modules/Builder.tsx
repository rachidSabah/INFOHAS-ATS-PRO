"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";

// ── Lightweight inline Markdown → JSX renderer for Copilot chat ────────────
// Handles: **bold**, *italic*, `code`, # h1-h3, - bullets, ```code blocks```, \n newlines.
// Zero dependencies — no remark/rehype added to the bundle.
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split("\n");
  let key = 0;

  const renderInline = (line: string): React.ReactNode => {
    // Process bold (**...**), italic (*...*), and inline code (`...`)
    const parts: React.ReactNode[] = [];
    const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(<strong key={key++} className="font-semibold">{match[2]}</strong>);
      } else if (match[3]) {
        parts.push(<em key={key++}>{match[3]}</em>);
      } else if (match[4]) {
        parts.push(<code key={key++} className="bg-slate-100 dark:bg-slate-800 rounded px-0.5 font-mono text-[0.85em]">{match[4]}</code>);
      }
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < line.length) parts.push(line.slice(lastIndex));
    return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
  };

  let inList = false;
  const listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (inList && listItems.length) {
      nodes.push(<ul key={key++} className="list-disc pl-4 space-y-0.5 my-1">{listItems.splice(0)}</ul>);
      inList = false;
    }
  };

  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      flushList();
      if (inCodeBlock) {
        nodes.push(
          <pre key={key++} className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-2 my-1.5 font-mono text-[0.8rem] overflow-x-auto whitespace-pre">
            <code>{codeBlockLines.join("\n")}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      flushList();
      const level = hMatch[1].length;
      const cls = level === 1 ? "font-bold text-sm mt-2 mb-1" : level === 2 ? "font-semibold text-[0.8rem] mt-1.5 mb-0.5" : "font-medium text-[0.75rem] mt-1";
      nodes.push(<div key={key++} className={cls}>{renderInline(hMatch[2])}</div>);
      continue;
    }
    // Bullet list item
    const liMatch = line.match(/^[-*]\s+(.+)/);
    if (liMatch) {
      inList = true;
      listItems.push(<li key={key++}>{renderInline(liMatch[1])}</li>);
      continue;
    }
    // Numbered list
    const numMatch = line.match(/^\d+\.\s+(.+)/);
    if (numMatch) {
      flushList();
      nodes.push(<div key={key++} className="pl-3">{renderInline(numMatch[1])}</div>);
      continue;
    }
    // Empty line — paragraph break
    if (line.trim() === "") {
      flushList();
      nodes.push(<div key={key++} className="h-1.5" />);
      continue;
    }
    // Normal paragraph line
    flushList();
    nodes.push(<div key={key++}>{renderInline(line)}</div>);
  }

  if (inCodeBlock && codeBlockLines.length) {
    nodes.push(
      <pre key={key++} className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-2 my-1.5 font-mono text-[0.8rem] overflow-x-auto whitespace-pre">
        <code>{codeBlockLines.join("\n")}</code>
      </pre>
    );
  }

  flushList();
  return nodes;
}

import { useApp, uid } from "@/lib/store";
import { useAutoSave, useUndoRedo, useLiveATSScore } from "@/lib/builder-hooks";
import { TEMPLATES } from "@/lib/brand";
import { SmartTextarea } from "@/components/shared/SmartTextarea";
import { SpellCheckPanel } from "@/components/shared/SpellCheckPanel";
import { scanResume, totalMisspelled } from "@/lib/spellchecker";
import { UndoRedoPanel } from "@/components/shared/UndoRedoPanel";
import { ATSScoreInline } from "@/components/shared/ATSScorePreview";
import { useSectionCompleteness } from "@/lib/builder-extras";
import { blankResume, parseResumeFile } from "@/lib/parser";
import { exportResumePDF, exportResumeDOCX, exportResumeTXT, exportResumeDOC } from "@/lib/exporter";
import { assertResumeExportable } from "@/lib/resume-guardian-agent";
import { A4Preview } from "@/components/resume/A4Preview";
import { ATSMatchMeter } from "@/components/optimizer/ATSMatchMeter";
import { toast } from "sonner";
import { extractJSON } from "@/lib/ai";
import type { ResumeData, ResumeExperience, ResumeEducation, ResumeSkill, ResumeTemplate } from "@/lib/types";

const ACCENT_PRESETS = ["#1154A3", "#0B1F3A", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#0EA5E9", "#DC2626"];

const cleanStringField = (val: any): string | undefined => {
  if (val === null || val === undefined) return undefined;
  if (Array.isArray(val)) {
    val = val.join("\n");
  }
  if (typeof val === "string") {
    let str = val.trim();
    // Handle cases where the LLM wrapped the string in a JSON array string e.g. ["text"]
    if (str.startsWith("[") && str.endsWith("]")) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) {
          return parsed.map(s => String(s)).join("\n");
        }
      } catch {}
      // Fallback: strip brackets and surrounding quotes if JSON parsing failed
      str = str.slice(1, -1).trim();
      if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
        str = str.slice(1, -1).trim();
      }
    }
    // Strip any markdown bold/italic tags
    return str.replace(/\*\*|\*/g, "");
  }
  return String(val);
};

export function Builder() {
  const resumes = useApp((s) => s.resumes);
  const activeId = useApp((s) => s.activeResumeId);
  const updateResume = useApp((s) => s.updateResume);
  const addResume = useApp((s) => s.addResume);
  const setActiveResume = useApp((s) => s.setActiveResume);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);
  const jobDescriptions = useApp((s) => s.jobDescriptions);
  const activeJdId = useApp((s) => s.activeJdId);
  const setActiveJD = useApp((s) => s.setActiveJD);

  const resume = useMemo(() => resumes.find((r) => r.id === activeId) ?? resumes[0], [resumes, activeId]);
  const autoSave = useAutoSave(resume);
  const undoRedo = useUndoRedo(resume);
  const activeJD = useMemo(() => jobDescriptions.find(j => j.id === activeJdId), [jobDescriptions, activeJdId]);
  const atsScore = useLiveATSScore(resume, activeJD);
  const sectionScores = useSectionCompleteness(resume);

  // Real-time keyword alignment checks
  const keywordsList = useMemo(() => {
    if (!activeJD || !resume) return [];
    const resumeSkillNames = resume.skills.map((s) => s.name.toLowerCase().trim());
    const resumeTextLower = [
      resume.summary,
      ...resume.experience.map(e => [e.title, e.company, ...e.bullets].join(" ")),
      ...resume.skills.map(s => s.name),
    ].join(" ").toLowerCase();

    return (activeJD.keywords || []).map((kw) => {
      const kwLower = kw.toLowerCase().trim();
      const matched = resumeSkillNames.includes(kwLower) || resumeTextLower.includes(kwLower);
      return { keyword: kw, matched };
    });
  }, [resume, activeJD]);

  const patch = (p: Partial<ResumeData>) => resume && updateResume(resume.id, p);

  const updateOptimizerDirective = useApp((s) => s.updateOptimizerDirective);

  const [tab, setTab] = useState<"basics" | "experience" | "education" | "skills" | "extra" | "design" | "copilot">("basics");
  const [scale, setScale] = useState(0.6);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [spellCheckOpen, setSpellCheckOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { saveCount, restoreEntry, dismissRestore, triggerSave } = useAutoSave(resume);
  const { snapshot, undo, redo, jumpTo, canUndo, canRedo, undoStack, totalUndos, totalRedos } = useUndoRedo(resume);
  const previewRef = useRef<HTMLDivElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [shrinking, setShrinking] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"preview" | "copilot" | "audit">("preview");
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [translateLang, setTranslateLang] = useState("en");
  const [translating, setTranslating] = useState(false);
  const [fixingIssueId, setFixingIssueId] = useState<string | null>(null);

  const translateResume = async () => {
    setTranslating(true);
    const toastId = toast.loading("Translating resume with AI...");
    try {
      const { ProviderRouter } = await import("@/lib/ai/services/router");
      const targetLangName = ({ en: "English", fr: "French", es: "Spanish", de: "German", ar: "Arabic" } as any)[translateLang] || "English";
      
      const payload = {
        headline: resume.headline,
        summary: resume.summary,
        experience: resume.experience.map((e) => ({ id: e.id, title: e.title, company: e.company, bullets: e.bullets })),
        skills: resume.skills.map((s) => ({ id: s.id, name: s.name, category: s.category })),
        education: resume.education.map((ed) => ({ id: ed.id, degree: ed.degree, institution: ed.institution, highlights: ed.highlights })),
      };

      const prompt = `You are a professional translator. Translate all text fields in this resume payload into ${targetLangName}:
${JSON.stringify(payload)}

Guidelines:
1. Translate titles, descriptions, categories, degrees, and bullets accurately.
2. Keep all 'id' fields identical (do not change or translate the IDs).
3. Preserve the exact structure. Return ONLY valid JSON matching the payload format.`;

      const res = await ProviderRouter.chat({
        messages: [{ role: "user", content: prompt }], maxTokens: 1500, temperature: 0.3
      }, { agentTask: "summary" });

      const parsed = JSON.parse(res.text.trim());
      if (parsed) {
        const next = { ...resume };
        if (parsed.headline) next.headline = parsed.headline;
        if (parsed.summary) next.summary = parsed.summary;
        if (Array.isArray(parsed.experience)) {
          next.experience = resume.experience.map((e) => {
            const match = parsed.experience.find((pe: any) => pe.id === e.id);
            return match ? { ...e, title: match.title, company: match.company, bullets: match.bullets } : e;
          });
        }
        if (Array.isArray(parsed.skills)) {
          next.skills = resume.skills.map((s) => {
            const match = parsed.skills.find((ps: any) => ps.id === s.id);
            return match ? { ...s, name: match.name, category: match.category } : s;
          });
        }
        if (Array.isArray(parsed.education)) {
          next.education = resume.education.map((ed) => {
            const match = parsed.education.find((ped: any) => ped.id === ed.id);
            return match ? { ...ed, degree: match.degree, institution: match.institution, highlights: match.highlights } : ed;
          });
        }
        patch(next);
        toast.success(`Resume translated to ${targetLangName}!`, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Translation failed: ${err?.message}`, { id: toastId });
    } finally {
      setTranslating(false);
    }
  };

  const auditIssues = useMemo(() => {
    const issues: Array<{
      id: string;
      title: string;
      description: string;
      type: "summary" | "experience" | "skills";
      severity: "warning" | "info" | "success";
      actionLabel?: string;
      meta?: any;
    }> = [];

    if (!resume) return issues;

    // 1. Summary Check
    const summaryWords = (resume.summary ?? "").split(/\s+/).filter(Boolean).length;
    if (summaryWords < 50) {
      issues.push({
        id: "summary_short",
        title: "Summary is too short",
        description: `Your professional summary is only ${summaryWords} words. Aim for 80-120 words to highlight your expertise.`,
        type: "summary",
        severity: "warning",
        actionLabel: "Optimize Summary",
      });
    } else if (summaryWords > 150) {
      issues.push({
        id: "summary_long",
        title: "Summary is too long",
        description: `Your summary has ${summaryWords} words, which can crowd a 1-page A4 layout. Try to condense it.`,
        type: "summary",
        severity: "info",
        actionLabel: "Condense Summary",
      });
    } else if (resume.summary) {
      issues.push({
        id: "summary_ok",
        title: "Summary length is ideal",
        description: `Great! Your summary is ${summaryWords} words, fitting the standard resume density guidelines.`,
        type: "summary",
        severity: "success",
      });
    }

    // 2. Metrics check in experiences
    const experiencesWithoutMetrics = resume.experience.filter((e) => {
      return e.bullets.length > 0 && !e.bullets.some((b) => /\d+/.test(b));
    });
    experiencesWithoutMetrics.forEach((e) => {
      issues.push({
        id: `exp_metric_${e.id}`,
        title: `Add metrics to ${e.company || "Experience"}`,
        description: `None of the bullet points for "${e.title}" contain measurable metrics. Recruiters look for specific outcomes (%, $, numbers).`,
        type: "experience",
        severity: "warning",
        actionLabel: "Add AI Metrics",
        meta: { expId: e.id },
      });
    });

    // 3. Skill gap check
    if (activeJD) {
      const resumeSkillNames = resume.skills.map((s) => s.name.toLowerCase());
      const missingSkills = (activeJD.keywords || []).filter((kw) => !resumeSkillNames.includes(kw.toLowerCase())).slice(0, 8);
      
      missingSkills.forEach((skill) => {
        issues.push({
          id: `skill_gap_${skill}`,
          title: `Missing keyword: "${skill}"`,
          description: `This target keyword from the job description is missing in your resume skills and experiences.`,
          type: "skills",
          severity: "info",
          actionLabel: "Weave Keyword",
          meta: { skill },
        });
      });
    }

    return issues;
  }, [resume, activeJD]);

  const fixIssue = async (issue: any) => {
    setFixingIssueId(issue.id);
    const toastId = toast.loading(`AI is fixing: "${issue.title}"...`);
    try {
      const { ProviderRouter } = await import("@/lib/ai/services/router");
      if (issue.type === "summary") {
        const prompt = `Rewrite this resume summary to be highly professional, impactful, and about 90 words: "${resume.summary ?? ""}". ` +
          (activeJD ? `Ensure you align it with the target job: "${activeJD.title} at ${activeJD.company || 'Target Employer'}". ` : "") +
          `Return ONLY the summary text. Do NOT use any asterisks or markdown bold formatting.`;
        const res = await ProviderRouter.chat({
          messages: [{ role: "user", content: prompt }], maxTokens: 250, temperature: 0.6
        }, { agentTask: "summary" });
        if (res.text) {
          const cleanSummary = cleanStringField(res.text) || "";
          patch({ summary: cleanSummary });
          toast.success("Summary optimized successfully!", { id: toastId });
        }
      } else if (issue.type === "experience") {
        const exp = resume.experience.find((e) => e.id === issue.meta.expId);
        if (exp) {
          const prompt = `Rewrite the bullet points for the role "${exp.title} at ${exp.company}" to include realistic metrics and measurable achievements (e.g. increase efficiency by X%, save hours, grow revenue):
${JSON.stringify(exp.bullets)}
Return ONLY a valid JSON array of string bullets, NO formatting, NO markdown, NO asterisks.`;
          const res = await ProviderRouter.chat({
            messages: [{ role: "user", content: prompt }], maxTokens: 400, temperature: 0.7
          }, { agentTask: "experience" });
          try {
            const parsedBullets = extractJSON<any>(res.text);
            if (Array.isArray(parsedBullets)) {
              const cleanBullets = parsedBullets.map((b) => cleanStringField(b) || "");
              patch({
                experience: resume.experience.map((e) => e.id === exp.id ? { ...e, bullets: cleanBullets } : e)
              });
              toast.success("Metrics added successfully!", { id: toastId });
            }
          } catch {
            toast.error("Failed to parse AI metrics.", { id: toastId });
          }
        }
      } else if (issue.type === "skills") {
        const cleanSkillName = cleanStringField(issue.meta.skill) || "";
        const newSkills = [...resume.skills, { id: uid("s"), name: cleanSkillName, category: "Core Competencies" }];
        patch({ skills: newSkills });
        toast.success(`Weaved "${cleanSkillName}" into your skills list!`, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Failed to apply fix: ${err?.message}`, { id: toastId });
    } finally {
      setFixingIssueId(null);
    }
  };
  const fixKeywordWithAI = async (keyword: string, target: "summary" | "experience") => {
    if (!resume) return;
    const toastId = toast.loading(`AI is weaving "${keyword}" into your ${target}...`);
    try {
      const { ProviderRouter } = await import("@/lib/ai/services/router");
      const cleanKeyword = cleanStringField(keyword) || "";

      if (target === "summary") {
        const prompt = `Rewrite this resume summary to naturally incorporate the keyword "${cleanKeyword}". Ensure it is highly professional, impactful, and about 90 words: "${resume.summary ?? ""}". Return ONLY the summary text. Do NOT use any asterisks or markdown bold formatting.`;
        const res = await ProviderRouter.chat({
          messages: [{ role: "user", content: prompt }], maxTokens: 250, temperature: 0.6
        }, { agentTask: "summary" });
        if (res.text) {
          const cleanSummary = cleanStringField(res.text) || "";
          patch({ summary: cleanSummary });
          toast.success(`Weaved "${cleanKeyword}" into Summary!`, { id: toastId });
        }
      } else {
        const exp = resume.experience[0];
        if (!exp) {
          toast.error("Add an experience entry first to weave keywords into experience.", { id: toastId });
          return;
        }
        const prompt = `Rewrite the bullet points for the role "${exp.title} at ${exp.company}" to naturally incorporate the keyword/phrase "${cleanKeyword}". Keep the achievements measurable and professional:
${JSON.stringify(exp.bullets)}
Return ONLY a valid JSON array of string bullets, NO formatting, NO markdown, NO asterisks.`;
        const res = await ProviderRouter.chat({
          messages: [{ role: "user", content: prompt }], maxTokens: 400, temperature: 0.7
        }, { agentTask: "experience" });
        try {
          const parsedBullets = extractJSON<any>(res.text);
          if (Array.isArray(parsedBullets)) {
            const cleanBullets = parsedBullets.map((b) => cleanStringField(b) || "");
            patch({
              experience: resume.experience.map((e) => e.id === exp.id ? { ...e, bullets: cleanBullets } : e)
            });
            toast.success(`Weaved "${cleanKeyword}" into "${exp.company}" bullets!`, { id: toastId });
          }
        } catch {
          toast.error("Failed to parse AI experience bullets.", { id: toastId });
        }
      }
    } catch (err: any) {
      toast.error(`Failed to apply keyword fix: ${err?.message}`, { id: toastId });
    }
  };

  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: "Hi! I am your AI Resume Copilot. Ask me to rewrite your summary, polish experience bullet points, or optimize sections for your target job!",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const renderCopilotChat = (heightClass: string) => {
    const suggestions = [
      { text: "📈 Improve ATS score", prompt: "improve ats score" },
      { text: "💼 Target Qatar Duty Free", prompt: "optimize for Sales Assistant role at Qatar Duty Free" },
      { text: "✍️ Polish summary", prompt: "rewrite the professional summary to sound more punchy and outcome-focused" },
      { text: "🎯 Highlight metrics", prompt: "rewrite my experience bullets to include quantified metrics and achievements" },
    ];

    return (
      <div className={`flex flex-col ${heightClass} border border-border dark:border-slate-800 rounded-xl bg-gradient-to-b from-card to-background shadow-md overflow-hidden relative group`}>
        {/* Suggestion Chips */}
        {messages.length <= 1 && (
          <div className="p-3 border-b border-border/50 bg-slate-500/5 space-y-1.5 shrink-0">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
              <Icon name="Lightbulb" className="w-3.5 h-3.5 text-amber-500" /> Quick Suggestions
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    sendMessage(s.prompt);
                  }}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-brand hover:text-brand dark:hover:border-brand dark:hover:text-brand font-medium shadow-sm transition active:scale-95 cursor-pointer"
                >
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        <div className="flex-1 p-3 overflow-y-auto space-y-3.5 scrollbar-thin">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-start gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {/* Avatar */}
              {msg.role === "user" ? (
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 shrink-0">
                  U
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-violet-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-sm shrink-0">
                  <Icon name="Sparkles" className="w-3 h-3 text-white" />
                </div>
              )}

              {/* Bubble */}
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2.5 text-xs leading-relaxed shadow-sm ${
                  msg.role === "user"
                    ? "bg-slate-900 dark:bg-slate-800 text-slate-100 rounded-tr-sm border border-slate-800 whitespace-pre-wrap"
                    : "bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-sm"
                }`}
              >
                {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
              </div>
            </div>
          ))}

          {sendingMessage && (
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-violet-500 via-indigo-500 to-cyan-500 flex items-center justify-center shrink-0 animate-pulse">
                <Icon name="Sparkles" className="w-3 h-3 text-white" />
              </div>
              <div className="flex-1 space-y-2 max-w-[80%] py-1">
                <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-slate-200/80 dark:bg-slate-800/80 rounded animate-pulse w-1/2" />
              </div>
            </div>
          )}
        </div>

        {/* Input box */}
        <div className="p-2 border-t border-border flex gap-2 bg-slate-50/50 dark:bg-slate-900/40 relative">
          {sendingMessage && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-400 animate-pulse" />
          )}
          <Input
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask AI to optimize, write or polish..."
            className="text-xs h-9 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus-visible:ring-1 focus-visible:ring-violet-500"
            disabled={sendingMessage}
          />
          <Button
            size="sm"
            onClick={() => sendMessage()}
            disabled={sendingMessage || !inputMessage.trim()}
            className="h-9 px-3 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-medium shadow-sm transition active:scale-95 shrink-0"
          >
            <Icon name="Send" className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  const sendMessage = async (overrideText?: string) => {
    const textToSend = overrideText || inputMessage;
    if (!textToSend.trim() || sendingMessage) return;
    const userText = textToSend;
    setInputMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setSendingMessage(true);

    try {
      const { ProviderRouter } = await import("@/lib/ai/services/router");
      const systemPrompt = `You are a professional AI Resume Copilot.
Your job is to help the candidate optimize their resume for their target job.
You can suggest changes to their resume. If you decide to make updates to the resume fields, you MUST append a special [PATCH] block at the very end of your response, followed by a valid JSON object representing a partial ResumeData structure.

Example 1 (updating professional summary):
I have updated your professional summary to emphasize your leadership skills.
[PATCH]
{
  "summary": "Strategic and outcomes-driven manager with..."
}

Example 2 (updating experience bullets):
I have polished your experience bullet points to be more impact-oriented.
[PATCH]
{
  "experience": [
    {
      "id": "e_1", // You MUST use the correct experience entry ID from the context
      "bullets": [
        "Spearheaded cloud migration of 12 critical services, improving availability to 99.99%.",
        "Managed a team of 4 engineers to deliver the product v2 2 weeks ahead of schedule."
      ]
    }
  ]
}

Example 3 (updating skills):
I've updated your skills list to include key missing technical proficiencies.
[PATCH]
{
  "skills": [
    { "id": "s_1", "name": "React", "category": "Frontend" },
    { "id": "s_2", "name": "TypeScript", "category": "Languages" }
  ]
}

Guidelines:
1. Do NOT invent false experiences, employers, dates, or credentials.
2. Maintain clean, professional language with absolute zero grammatical or spelling errors.
3. When referencing experience or skills, ensure you map them using the exact 'id' values provided in the current resume.
4. Keep the text concise and suitable for a 1-page A4 format.
5. CRITICAL — when the candidate's summary is marked as "(empty — user has not written a summary yet)", do NOT fabricate a generic summary (e.g. 'Results-driven professional with a passion for...'). Instead, ask the user to share their actual background so you can write something real and personalised.
6. ALWAYS append a [PATCH] block containing the updated fields automatically at the end of your response whenever you suggest or generate any edits. Do NOT wait for the user to ask you to "insert" or "apply" it. CRITICAL RULE: You MUST append a [PATCH] block containing a valid JSON object at the very end of your response if you make or suggest ANY edits. If you do not include the [PATCH] block, the system cannot apply your changes to the resume editor and the user's data will not be updated.
7. CRITICAL — Do NOT use markdown bold/italic formatting (e.g. **word** or *word*) inside any fields in the [PATCH] block or inside your text suggestions. All resume fields must contain plain text only without asterisks, as the system does not support inline markdown formatting.
8. WRITING STYLE & PREMIUM AGENT CAPABILITIES:
   - Use active voice only (e.g. 'Spearheaded', 'Engineered', 'Optimized' instead of passive forms like 'Responsible for' or 'Was managing').
   - Integrate natural transition words to ensure high readability and flow.
   - Choose bullet points for structured lists (achievements, core tasks) and unified paragraphs for summaries.
   - For emphasis, place key metrics, action words, or credentials at the beginning of bullet points/sentences rather than using markdown formatting.
9. ATS OPTIMIZATION & JOB DESCRIPTION BUCKLE:
   - Carefully analyze the provided TARGET JOB description (title, company, keywords).
   - Calibrate all generated resume fields (summary, experience bullets, skills) to incorporate key phrases, required methodologies, and matching keywords from the job description.
   - Seamlessly weave these keywords into the content to achieve a high ATS compatibility score without keyword stuffing.`;

      // Detect placeholder / demo summaries — covers blankResume defaults, quality-gate clichés, and any AI-generated filler
      const PLACEHOLDER_PATTERNS = [
        "write a 2-3 line",
        "revise and enhance",
        "maximise clarity",
        "maximize clarity",
        "results-driven professional",
        "passionate professional",
        "results-oriented professional",
        "dynamic professional",
        "highly motivated professional",
        "dedicated professional",
        "optimizing processes, enhancing clarity",
        "maximizing impact",
        "your professional title",
        "your name",
        "company name",
        "job title",
      ];
      const summaryLower = (resume?.summary ?? "").toLowerCase().trim();
      const isPlaceholderSummary = !resume?.summary ||
        summaryLower.length < 30 ||
        PLACEHOLDER_PATTERNS.some(p => summaryLower.includes(p));

      const resumeContext = resume ? JSON.stringify({
        name: resume.name,
        headline: resume.headline,
        summary: isPlaceholderSummary ? "(empty — user has not written a summary yet)" : resume.summary,
        experience: resume.experience.map(e => ({
          id: e.id,
          company: e.company,
          title: e.title,
          location: e.location || "",
          startDate: e.startDate || "",
          endDate: e.endDate || "",
          bullets: e.bullets
        })),
        skills: resume.skills,
        education: resume.education.map(ed => ({
          id: ed.id,
          institution: ed.institution,
          degree: ed.degree,
          field: ed.field || "",
          location: ed.location || "",
          startDate: ed.startDate || "",
          endDate: ed.endDate || "",
          highlights: ed.highlights || []
        })),
        languages: resume.languages,
      }, null, 2) : "{}";

      const fullSystemPrompt = `${systemPrompt}

---
CANDIDATE CONTEXT (use this as the source of truth — do NOT invent facts):

TARGET JOB:
${activeJD ? JSON.stringify({ title: activeJD.title, company: activeJD.company, keywords: activeJD.keywords }) : "General Optimization (No specific job target selected)"}

CURRENT RESUME DATA:
${resumeContext}
---`;

      const response = await ProviderRouter.chat({
        messages: [
          { role: "system", content: fullSystemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userText }
        ],
        maxTokens: 1000,
        temperature: 0.65
      }, { agentTask: "summary" });

      const reply = response.text || "";
      let cleanReply = reply;
      let patchData: any = null;

      if (reply.includes("[PATCH]")) {
        const parts = reply.split("[PATCH]");
        cleanReply = parts[0].trim();
        const jsonStr = parts[1].trim();
        try {
          patchData = JSON.parse(jsonStr.replace(/```json/gi, "").replace(/```/g, "").trim());
        } catch (err) {
          console.warn("[Copilot] Failed to parse patch JSON after [PATCH]:", err);
          try {
            patchData = extractJSON(jsonStr);
          } catch {}
        }
      } else {
        // Fallback: try to extract JSON from anywhere in the response if [PATCH] tag is missing
        try {
          patchData = extractJSON(reply);
          // If JSON was found in the text, let's remove it from the chat bubble cleanReply so it doesn't clutter the UI
          const firstBrace = reply.indexOf("{");
          if (firstBrace !== -1) {
            cleanReply = reply.slice(0, firstBrace).trim();
          }
        } catch {
          // No JSON found, which is fine
        }
      }

      // Cleanup trailing markdown fences or patches in cleanReply
      cleanReply = cleanReply
        .replace(/\[PATCH\]\s*$/i, "")
        .replace(/```json\s*$/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      setMessages((prev) => [...prev, { role: "assistant", content: cleanReply }]);

      if (patchData) {
        // Programmatic helper to recursively strip asterisks from patch strings
        const stripAst = (val: any): any => {
          if (typeof val === "string") {
            return val.replace(/\*\*|\*/g, "");
          }
          if (Array.isArray(val)) {
            return val.map(stripAst);
          }
          if (val !== null && typeof val === "object") {
            const res: any = {};
            for (const k of Object.keys(val)) {
              res[k] = stripAst(val[k]);
            }
            return res;
          }
          return val;
        };

        const cleanedPatch = stripAst(patchData);
        console.log("[Copilot] Raw patch data:", patchData);
        console.log("[Copilot] Cleaned patch data:", cleanedPatch);

        const updatedResume: Partial<ResumeData> = {};
        
        // 1. Core Profile Fields
        const nameVal = cleanStringField(cleanedPatch.name);
        if (nameVal !== undefined) {
          updatedResume.name = nameVal;
        }

        const headlineVal = cleanStringField(cleanedPatch.headline);
        if (headlineVal !== undefined) {
          updatedResume.headline = headlineVal;
        }

        const summaryVal = cleanStringField(cleanedPatch.summary);
        if (summaryVal !== undefined) {
          updatedResume.summary = summaryVal;
        }

        const dobVal = cleanStringField(cleanedPatch.dateOfBirth);
        if (dobVal !== undefined) {
          updatedResume.dateOfBirth = dobVal;
        }

        // 2. Nested Contact Info
        if (cleanedPatch.contact !== undefined && cleanedPatch.contact !== null) {
          updatedResume.contact = {
            ...resume.contact,
            email: cleanedPatch.contact.email !== undefined ? cleanStringField(cleanedPatch.contact.email) || resume.contact.email : resume.contact.email,
            phone: cleanedPatch.contact.phone !== undefined ? cleanStringField(cleanedPatch.contact.phone) || resume.contact.phone : resume.contact.phone,
            location: cleanedPatch.contact.location !== undefined ? cleanStringField(cleanedPatch.contact.location) || resume.contact.location : resume.contact.location,
            website: cleanedPatch.contact.website !== undefined ? cleanStringField(cleanedPatch.contact.website) : resume.contact.website,
            linkedin: cleanedPatch.contact.linkedin !== undefined ? cleanStringField(cleanedPatch.contact.linkedin) : resume.contact.linkedin,
            github: cleanedPatch.contact.github !== undefined ? cleanStringField(cleanedPatch.contact.github) : resume.contact.github,
          };
        }

        // 3. Skills Array
        if (Array.isArray(cleanedPatch.skills)) {
          updatedResume.skills = cleanedPatch.skills.map((s: any) => {
            if (typeof s === "string") {
              const name = cleanStringField(s) || "";
              return { id: uid("s"), name, category: "" };
            }
            const name = cleanStringField(s.name) || "";
            const category = cleanStringField(s.category) || "";
            return {
              id: s.id || uid("s"),
              name,
              category
            };
          });
        }

        // 4. Experience Array (Smart Match)
        if (Array.isArray(cleanedPatch.experience)) {
          updatedResume.experience = resume.experience.map((e, idx) => {
            // Find match by exact id
            let match = cleanedPatch.experience.find((pe: any) => pe.id === e.id);
            
            // Try matching by mock ID suffix (e.g. e_1 or exp-1 matching index 0)
            if (!match) {
              match = cleanedPatch.experience.find((pe: any) => {
                if (typeof pe.id === "string") {
                  const numMatch = pe.id.match(/\d+/);
                  if (numMatch) {
                    const mockIdx = parseInt(numMatch[0], 10) - 1;
                    return mockIdx === idx;
                  }
                }
                return false;
              });
            }

            // Fuzzy match by company/title similarity
            if (!match) {
              match = cleanedPatch.experience.find((pe: any) => {
                const peCompany = (pe.company || "").toLowerCase().trim();
                const peTitle = (pe.title || "").toLowerCase().trim();
                const eCompany = (e.company || "").toLowerCase().trim();
                const eTitle = (e.title || "").toLowerCase().trim();
                return (peCompany && eCompany && peCompany === eCompany) || 
                       (peTitle && eTitle && peTitle === eTitle);
              });
            }

            // Safe fallback to index only if array lengths are identical
            if (!match && cleanedPatch.experience.length === resume.experience.length && cleanedPatch.experience[idx]) {
              match = cleanedPatch.experience[idx];
            }

            if (match) {
              const expTitle = cleanStringField(match.title);
              const expCompany = cleanStringField(match.company);
              const expLocation = cleanStringField(match.location);
              const expStartDate = cleanStringField(match.startDate);
              const expEndDate = cleanStringField(match.endDate);

              let expBullets = e.bullets;
              if (match.bullets !== undefined) {
                if (Array.isArray(match.bullets)) {
                  expBullets = match.bullets.map(b => cleanStringField(b) || "");
                } else if (typeof match.bullets === "string") {
                  const cleanedB = cleanStringField(match.bullets);
                  if (cleanedB) {
                    if (cleanedB.startsWith("[") && cleanedB.endsWith("]")) {
                      try {
                        const parsedB = JSON.parse(cleanedB);
                        if (Array.isArray(parsedB)) {
                          expBullets = parsedB.map(b => String(b));
                        } else {
                          expBullets = [cleanedB];
                        }
                      } catch {
                        expBullets = [cleanedB];
                      }
                    } else {
                      expBullets = cleanedB.split("\n");
                    }
                  }
                }
              }

              return {
                ...e,
                bullets: expBullets,
                title: expTitle !== undefined ? expTitle : e.title,
                company: expCompany !== undefined ? expCompany : e.company,
                location: expLocation !== undefined ? expLocation : e.location,
                startDate: expStartDate !== undefined ? expStartDate : e.startDate,
                endDate: expEndDate !== undefined ? expEndDate : e.endDate,
              };
            }
            return e;
          });
        }

        // 5. Education Array (Smart Match)
        if (Array.isArray(cleanedPatch.education)) {
          updatedResume.education = resume.education.map((ed, idx) => {
            // Find match by exact id
            let match = cleanedPatch.education.find((ped: any) => ped.id === ed.id);

            // Try matching by mock ID suffix (e.g. ed_1 or edu-1 matching index 0)
            if (!match) {
              match = cleanedPatch.education.find((ped: any) => {
                if (typeof ped.id === "string") {
                  const numMatch = ped.id.match(/\d+/);
                  if (numMatch) {
                    const mockIdx = parseInt(numMatch[0], 10) - 1;
                    return mockIdx === idx;
                  }
                }
                return false;
              });
            }

            // Fuzzy match by institution similarity
            if (!match) {
              match = cleanedPatch.education.find((ped: any) => {
                const pedInst = (ped.institution || "").toLowerCase().trim();
                const edInst = (ed.institution || "").toLowerCase().trim();
                return pedInst && edInst && pedInst === edInst;
              });
            }

            // Safe fallback to index only if array lengths are identical
            if (!match && cleanedPatch.education.length === resume.education.length && cleanedPatch.education[idx]) {
              match = cleanedPatch.education[idx];
            }

            if (match) {
              const edInst = cleanStringField(match.institution);
              const edDegree = cleanStringField(match.degree);
              const edField = cleanStringField(match.field);
              const edLoc = cleanStringField(match.location);
              const edStart = cleanStringField(match.startDate);
              const edEnd = cleanStringField(match.endDate);
              
              let edHighlights = ed.highlights;
              if (match.highlights !== undefined) {
                if (Array.isArray(match.highlights)) {
                  edHighlights = match.highlights.map(h => cleanStringField(h) || "");
                } else if (typeof match.highlights === "string") {
                  const cleanedH = cleanStringField(match.highlights);
                  if (cleanedH) {
                    if (cleanedH.startsWith("[") && cleanedH.endsWith("]")) {
                      try {
                        const parsedH = JSON.parse(cleanedH);
                        if (Array.isArray(parsedH)) {
                          edHighlights = parsedH.map(h => String(h));
                        } else {
                          edHighlights = [cleanedH];
                        }
                      } catch {
                        edHighlights = [cleanedH];
                      }
                    } else {
                      edHighlights = cleanedH.split("\n");
                    }
                  }
                }
              }

              return {
                ...ed,
                institution: edInst !== undefined ? edInst : ed.institution,
                degree: edDegree !== undefined ? edDegree : ed.degree,
                field: edField !== undefined ? edField : ed.field,
                location: edLoc !== undefined ? edLoc : ed.location,
                startDate: edStart !== undefined ? edStart : ed.startDate,
                endDate: edEnd !== undefined ? edEnd : ed.endDate,
                highlights: edHighlights,
              };
            }
            return ed;
          });
        }

        // 6. Languages Array
        if (Array.isArray(cleanedPatch.languages)) {
          updatedResume.languages = cleanedPatch.languages.map((l: any) => {
            if (typeof l === "string") {
              return { id: uid("l"), name: cleanStringField(l) || "", proficiency: "fluent" };
            }
            return {
              id: l.id || uid("l"),
              name: cleanStringField(l.name) || "",
              proficiency: l.proficiency || "fluent"
            };
          });
        }

        // 7. Projects Array
        if (Array.isArray(cleanedPatch.projects)) {
          updatedResume.projects = cleanedPatch.projects.map((p: any) => {
            if (typeof p === "string") {
              return { id: uid("p"), name: cleanStringField(p) || "", description: "", role: "", date: "" };
            }
            return {
              id: p.id || uid("p"),
              name: cleanStringField(p.name) || "",
              description: cleanStringField(p.description) || "",
              role: cleanStringField(p.role) || "",
              date: cleanStringField(p.date) || ""
            };
          });
        }

        // 8. Certifications Array
        if (Array.isArray(cleanedPatch.certifications)) {
          updatedResume.certifications = cleanedPatch.certifications.map((c: any) => {
            if (typeof c === "string") {
              return { id: uid("c"), name: cleanStringField(c) || "", date: "", authority: "" };
            }
            return {
              id: c.id || uid("c"),
              name: cleanStringField(c.name) || "",
              date: cleanStringField(c.date) || "",
              authority: cleanStringField(c.authority) || ""
            };
          });
        }

        // 9. Additional Info / Achievements
        const addInfoVal = cleanStringField(cleanedPatch.additionalInfo);
        if (addInfoVal !== undefined) {
          updatedResume.additionalInfo = addInfoVal;
        }

        if (Array.isArray(cleanedPatch.achievements)) {
          updatedResume.achievements = cleanedPatch.achievements.map(a => cleanStringField(a) || "");
        }

        console.log("[Copilot] Applying updated resume fields:", updatedResume);
        patch(updatedResume);
        toast.success("AI Copilot updated your resume!");
      }
    } catch (err: any) {
      // Error is surfaced to the user via the chat UI \u2014 use warn not error to avoid
      // polluting error telemetry with non-fatal copilot request failures.
      console.warn("[Copilot] Chat request failed:", err instanceof Error ? err.message : err);
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I encountered an error trying to process your request. Please try again." }]);
    } finally {
      setSendingMessage(false);
    }
  };
  const handleAutoShrink = () => {
    setShrinking(true);
    let attempts = 0;
    const runStep = () => {
      const el = previewRef.current;
      if (!el || attempts >= 10) {
        setShrinking(false);
        return;
      }
      const a4HeightPx = 297 * 3.7795275591;
      const actualHeight = el.scrollHeight || el.clientHeight || el.offsetHeight;
      
      if (actualHeight > a4HeightPx + 2) {
        const directive = useApp.getState().optimizerDirective;
        const currentFontSize = directive.bodyFontSizePt ?? 10.5;
        const currentLineHeight = directive.lineHeight ?? 1.2;
        const currentSectionGap = directive.sectionGapMm ?? 3;
        const currentMarginTop = directive.marginTopMm ?? 6.35;
        const currentMarginBottom = directive.marginBottomMm ?? 6.35;
        const currentMarginLeft = directive.marginLeftMm ?? 8.89;
        const currentMarginRight = directive.marginRightMm ?? 8.89;
        
        let changed = false;
        const nextPatch: any = {};
        if (currentFontSize > 9) {
          nextPatch.bodyFontSizePt = Math.max(9, currentFontSize - 0.5);
          changed = true;
        }
        if (currentLineHeight > 1.05) {
          nextPatch.lineHeight = Math.max(1.05, currentLineHeight - 0.05);
          changed = true;
        }
        if (currentSectionGap > 1.5) {
          nextPatch.sectionGapMm = Math.max(1.5, currentSectionGap - 0.5);
          changed = true;
        }
        if (currentMarginTop > 4.5) {
          nextPatch.marginTopMm = Math.max(4.5, currentMarginTop - 0.5);
          nextPatch.marginBottomMm = Math.max(4.5, currentMarginBottom - 0.5);
          nextPatch.marginLeftMm = Math.max(6.35, currentMarginLeft - 0.5);
          nextPatch.marginRightMm = Math.max(6.35, currentMarginRight - 0.5);
          changed = true;
        }
        
        if (changed) {
          updateOptimizerDirective(nextPatch);
          attempts++;
          setTimeout(runStep, 80); // Wait for React render cycle
        } else {
          setShrinking(false);
        }
      } else {
        setShrinking(false);
        toast.success("Resume shrunk to fit one page successfully!");
      }
    };
    runStep();
  };

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

  const handleFixWord = useCallback((path: string, oldWord: string, newWord: string) => {
    const parts = path.split(".");
    const section = parts[0];
    
    if (section === "summary") {
      const current = resume.summary ?? "";
      const regex = new RegExp(`\\b${oldWord}\\b`, "g");
      const updated = current.replace(regex, newWord);
      patch({ summary: updated });
      toast.success(`Corrected "${oldWord}" to "${newWord}"`);
    } else if (section === "headline") {
      const current = resume.headline ?? "";
      const regex = new RegExp(`\\b${oldWord}\\b`, "g");
      const updated = current.replace(regex, newWord);
      patch({ headline: updated });
      toast.success(`Corrected "${oldWord}" to "${newWord}"`);
    } else if (section === "experience") {
      const idx = parseInt(parts[1], 10);
      const subfield = parts[2];
      const exp = resume.experience[idx];
      if (exp) {
        if (subfield === "bullets") {
          const bulletIdx = parseInt(parts[3], 10);
          const current = exp.bullets[bulletIdx] ?? "";
          const regex = new RegExp(`\\b${oldWord}\\b`, "g");
          const updated = current.replace(regex, newWord);
          const newBullets = [...exp.bullets];
          newBullets[bulletIdx] = updated;
          updateExperience(exp.id, { bullets: newBullets });
          toast.success(`Corrected "${oldWord}" to "${newWord}"`);
        } else if (subfield === "title") {
          const current = exp.title ?? "";
          const regex = new RegExp(`\\b${oldWord}\\b`, "g");
          const updated = current.replace(regex, newWord);
          updateExperience(exp.id, { title: updated });
          toast.success(`Corrected "${oldWord}" to "${newWord}"`);
        } else if (subfield === "company") {
          const current = exp.company ?? "";
          const regex = new RegExp(`\\b${oldWord}\\b`, "g");
          const updated = current.replace(regex, newWord);
          updateExperience(exp.id, { company: updated });
          toast.success(`Corrected "${oldWord}" to "${newWord}"`);
        }
      }
    }
  }, [resume, patch, updateExperience]);

  const spellingIssuesCount = useMemo(() => {
    if (!resume) return 0;
    try {
      return totalMisspelled(scanResume(resume));
    } catch {
      return 0;
    }
  }, [resume]);

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
  const contentLen = resume ? ((resume.summary?.length || 0) +
    resume.experience.reduce((n, e) => n + e.bullets.join(" ").length, 0) +
    resume.skills.length * 8) : 0;
  const onePageStatus = contentLen < 2200 ? { ok: true, msg: "Comfortably fits one A4 page" } :
    contentLen < 3000 ? { ok: true, msg: "Fits one A4 page (tight)" } :
    { ok: false, msg: "May overflow — auto-compress will activate on export" };

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[200px] flex-1">
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
              <Icon name="Save" className="w-3 h-3" /> Saved {saveCount > 0 ? `(${saveCount})` : "now"}
            </Badge>
            <Button
              variant="outline"
              onClick={async () => {
                const ok = await triggerSave();
                if (ok) {
                  toast.success("Resume saved successfully!");
                } else {
                  toast.error("Failed to save resume.");
                }
              }}
              className="h-5 px-1.5 text-[9px] gap-1 border-emerald-500/30 hover:bg-emerald-50/50 hover:text-emerald-700 text-emerald-600 bg-emerald-50/10 font-semibold flex items-center"
              title="Save Changes Now"
            >
              <Icon name="Save" className="w-2.5 h-2.5" />
              Save Now
            </Button>
            <button onClick={() => { const d = undo(); if (d) patch(d); }} disabled={!canUndo} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30 p-1" title="Undo (Ctrl+Z)">
              <Icon name="Undo2" className="w-3 h-3" />
            </button>
            <button onClick={() => { const d = redo(); if (d) patch(d); }} disabled={!canRedo} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30 p-1" title="Redo (Ctrl+Shift+Z)">
              <Icon name="Redo2" className="w-3 h-3" />
            </button>
            <Button
              variant={spellingIssuesCount > 0 ? "outline" : "ghost"}
              size="sm"
              onClick={() => setSpellCheckOpen(v => !v)}
              className={`gap-1.5 h-8 relative ${spellingIssuesCount > 0 ? "border-amber-400 text-amber-600 hover:bg-amber-50" : ""}`}
              title={spellingIssuesCount > 0 ? `${spellingIssuesCount} spelling issues found` : "No spelling issues found"}
            >
              <Icon name="SpellCheck2" className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Spelling</span>
              {spellingIssuesCount > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-white text-[10px] font-bold leading-none">
                  {spellingIssuesCount}
                </span>
              )}
              {spellingIssuesCount === 0 && (
                <Icon name="Check" className="w-3 h-3 text-emerald-500" />
              )}
            </Button>
            <button
              onClick={() => setHistoryOpen(v => !v)}
              className={`text-[10px] p-1 ${historyOpen ? "text-brand" : "text-muted-foreground hover:text-foreground"}`}
              title="Edit History (Ctrl+H)"
            >
              <Icon name="History" className="w-3 h-3" />
            </button>
          </div>
        </div>
        {/* Export buttons — compact on mobile, full labels on desktop */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <select
            value={resume.id}
            onChange={(e) => setActiveResume(e.target.value)}
            className="h-8 px-2 rounded-md border border-input bg-background text-xs sm:text-sm max-w-[140px] sm:max-w-none font-semibold text-brand"
          >
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <select
            value={activeJdId || ""}
            onChange={(e) => setActiveJD(e.target.value || null)}
            className="h-8 px-2 rounded-md border border-input bg-background text-xs sm:text-sm max-w-[150px] sm:max-w-none font-semibold text-muted-foreground"
          >
            <option value="">🎯 General (No Job Target)</option>
            {jobDescriptions.map((j) => (
              <option key={j.id} value={j.id}>
                🎯 {j.company ? `${j.company} - ` : ""}{j.title}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 border border-border rounded-md px-1.5 bg-secondary/35 h-8">
            <select
              value={translateLang}
              onChange={(e) => setTranslateLang(e.target.value)}
              className="h-6 px-1 rounded bg-transparent text-[11px] font-semibold text-muted-foreground focus:outline-none"
            >
              <option value="en">🇺🇸 English</option>
              <option value="fr">🇫🇷 French</option>
              <option value="es">🇪🇸 Spanish</option>
              <option value="de">🇩🇪 German</option>
              <option value="ar">🇲🇦 Arabic</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={translateResume}
              disabled={translating}
              className="h-6 px-1.5 text-[10px] gap-1 text-brand hover:bg-brand-light"
              title="Translate entire resume with AI"
            >
              {translating ? <Icon name="Loader2" className="w-3 h-3 animate-spin" /> : <Icon name="Languages" className="w-3 h-3" />}
              Translate
            </Button>
          </div>
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

      {spellCheckOpen && (
        <SpellCheckPanel
          resume={resume}
          open={true}
          onToggle={() => setSpellCheckOpen(false)}
          onFixWord={handleFixWord}
        />
      )}

      <UndoRedoPanel
        undoStack={undoStack}
        canUndo={canUndo}
        canRedo={canRedo}
        totalUndos={totalUndos}
        totalRedos={totalRedos}
        onUndo={() => { const d = undo(); if (d) { patch(d); return true; } return false; }}
        onRedo={() => { const d = redo(); if (d) { patch(d); return true; } return false; }}
        onSnapshot={(label) => snapshot(label)}
        onJump={(i) => { const d = jumpTo(i); if (d) { patch(d); return true; } return false; }}
        open={historyOpen}
        onToggle={() => setHistoryOpen(v => !v)}
      />

      <ATSScoreInline
        resume={resume}
        jd={activeJD || null}
        onAddKeyword={(keyword, section) => {
          toast.info(`Consider adding "${keyword}" to ${section}`);
        }}
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
              ["copilot", "AI Copilot", "Sparkles"],
              ["design", "Design", "Palette"],
            ].map(([k, label, icon]) => (
              <button
                key={k}
                onClick={() => {
                  setTab(k as any);
                  if (k === "copilot") {
                    setRightPanelTab("copilot");
                  } else {
                    setRightPanelTab("preview");
                  }
                }}
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
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] gap-1 text-brand"
                            onClick={() => updateExperience(e.id, { bullets: [...e.bullets, ""] })}
                          >
                            <Icon name="Plus" className="w-3 h-3" /> Add bullet
                          </Button>
                          {e.bullets.length > 2 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                              onClick={async () => {
                                const toastId = toast.loading("AI is trimming and consolidating bullets...");
                                try {
                                  const { trimExperienceBullets } = await import("@/lib/agents/content-expansion-agent");
                                  const trimmed = await trimExperienceBullets(e, 3);
                                  updateExperience(e.id, { bullets: trimmed });
                                  toast.success("Bullets consolidated to 3 entries!", { id: toastId });
                                } catch (err) {
                                  toast.error("Failed to trim bullets.", { id: toastId });
                                }
                              }}
                            >
                              <Icon name="Scissors" className="w-3 h-3" /> AI Trim to 3 Bullets
                            </Button>
                          )}
                        </div>
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

              {tab === "copilot" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Icon name="Sparkles" className="w-4 h-4 text-brand animate-pulse" /> AI Resume Copilot
                    </h3>
                  </div>
                  {renderCopilotChat("h-[450px]")}
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

                  {/* Page Fit Optimizer Control */}
                  <div className="pt-4 border-t border-border">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">Page Fit Optimizer</Label>
                    <Button 
                      onClick={handleAutoShrink}
                      disabled={shrinking}
                      variant="outline"
                      className="w-full gap-2 text-xs py-1.5 h-auto hover:bg-brand/5 hover:text-brand border-dashed hover:border-brand/40"
                    >
                      <Icon name={shrinking ? "Loader2" : "Sparkles"} className={`w-3.5 h-3.5 text-brand ${shrinking ? "animate-spin" : ""}`} />
                      {shrinking ? "Shrinking to fit..." : "Auto Shrink to Fit (1 Page)"}
                    </Button>
                    <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                      Automatically scales fonts, line height, margins, and gaps incrementally until the resume fits on exactly one A4 page.
                    </p>
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
              jd={activeJD || null}
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-1 bg-secondary p-0.5 rounded-lg">
                <button
                  onClick={() => setRightPanelTab("preview")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                    rightPanelTab === "preview"
                      ? "bg-card shadow-sm text-brand"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon name="Eye" className="w-3.5 h-3.5" /> Preview
                </button>
                <button
                  onClick={() => setRightPanelTab("copilot")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                    rightPanelTab === "copilot"
                      ? "bg-card shadow-sm text-brand"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon name="Sparkles" className="w-3.5 h-3.5" /> AI Copilot
                </button>
                <button
                  onClick={() => setRightPanelTab("audit")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                    rightPanelTab === "audit"
                      ? "bg-card shadow-sm text-brand"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon name="CheckSquare" className="w-3.5 h-3.5" /> ATS Audit
                </button>
              </div>
              {rightPanelTab === "preview" && (
                <Badge variant={onePageStatus.ok ? "success" : "warning"} className="text-[10px]">
                  <Icon name={onePageStatus.ok ? "CheckCircle2" : "AlertTriangle"} className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{onePageStatus.msg}</span>
                  <span className="sm:hidden">{onePageStatus.ok ? "OK" : "Tight"}</span>
                </Badge>
              )}
            </div>

            {rightPanelTab === "preview" ? (
              <>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2 text-xs bg-secondary p-2 rounded-lg border border-border">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium select-none text-[10px]">
                      <input
                        type="checkbox"
                        checked={showHeatmap}
                        onChange={(e) => setShowHeatmap(e.target.checked)}
                        className="rounded border-input text-brand focus:ring-brand w-3.5 h-3.5"
                      />
                      <span>👁️ Visual Heatmap Overlay</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">Zoom:</span>
                    <button onClick={() => setScale(Math.max(0.4, scale - 0.05))} className="px-1.5 py-0.5 rounded border bg-background hover:bg-secondary">-</button>
                    <span className="font-mono text-[10px]">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(Math.min(1.0, scale + 0.05))} className="px-1.5 py-0.5 rounded border bg-background hover:bg-secondary">+</button>
                  </div>
                </div>
                <div className="rounded-xl bg-secondary/60 p-2 sm:p-4 overflow-auto" style={{ maxHeight: "calc(100vh - 160px)" }}>
                  <div className="relative" style={{ transform: `scale(${scale})`, transformOrigin: "top center", width: "100%", height: "fit-content" }}>
                    <A4Preview resume={resume} scale={scale} ref={previewRef} />
                    {showHeatmap && (
                      <div
                        className="absolute inset-0 pointer-events-none rounded-sm"
                        style={{
                          background: "radial-gradient(circle at 20% 15%, rgba(239, 68, 68, 0.45) 0%, rgba(239, 68, 68, 0.25) 15%, rgba(245, 158, 11, 0.15) 30%, transparent 60%), radial-gradient(circle at 15% 45%, rgba(239, 68, 68, 0.35) 0%, rgba(245, 158, 11, 0.2) 20%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(59, 130, 246, 0.15) 0%, transparent 40%)",
                          mixBlendMode: "multiply",
                        }}
                      />
                    )}
                  </div>
                </div>
                <div className="mt-2 text-center text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                  <Icon name="Info" className="w-3.5 h-3.5 text-brand shrink-0" />
                  <span className="hidden sm:inline">Export enforces <code className="px-1 rounded bg-muted">maxPages = 1</code> — auto-compresses if needed.</span>
                  <span className="sm:hidden">1-page enforced on export</span>
                </div>
              </>
            ) : rightPanelTab === "copilot" ? (
              renderCopilotChat("h-[calc(100vh-220px)]")
            ) : (
              /* ATS Audit panel UI */
              <div className="flex flex-col h-[calc(100vh-220px)] border border-border rounded-xl bg-card p-4 overflow-y-auto space-y-4 scrollbar-thin">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Icon name="AlertCircle" className="w-4 h-4 text-brand" /> ATS Recommendation Center
                  </span>
                  <Badge variant="outline" className="text-[10px] text-brand font-mono">
                    {auditIssues.filter(i => i.severity === "warning").length} Warnings
                  </Badge>
                </div>

                {!activeJD ? (
                  <div className="rounded-xl border border-dashed border-border p-5 text-center space-y-3 bg-secondary/20">
                    <Icon name="Briefcase" className="w-8 h-8 text-muted-foreground/50 mx-auto" />
                    <div className="text-xs font-bold text-foreground">No Target Job Selected</div>
                    <p className="text-[10px] text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
                      Select or scrape a job description to audit your resume for critical skill gaps and key ATS terms.
                    </p>
                    <div className="space-y-2">
                      <select
                        value={activeJdId || ""}
                        onChange={(e) => setActiveJD(e.target.value || null)}
                        className="w-full h-8 px-2 rounded border border-input bg-background text-xs"
                      >
                        <option value="">Select a saved job...</option>
                        {jobDescriptions.map((j) => (
                          <option key={j.id} value={j.id}>{j.title} {j.company ? `— ${j.company}` : ""}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const setView = useApp.getState().setView;
                          setView("jd-scraper");
                        }}
                        className="w-full h-8 text-[11px] gap-1"
                      >
                        <Icon name="Search" className="w-3 h-3" /> Scrape New Job
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Keyword Density / Checklist */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-foreground">
                        <span className="flex items-center gap-1.5">
                          <Icon name="KeyRound" className="w-3.5 h-3.5 text-brand" /> Target Job Keywords
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded">
                          {keywordsList.filter(k => k.matched).length}/{keywordsList.length} Matched
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 max-h-[160px] overflow-y-auto p-1 border border-border rounded-lg bg-secondary/10 scrollbar-thin">
                        {keywordsList.map(({ keyword, matched }) => (
                          <div
                            key={keyword}
                            className={`flex items-center justify-between p-1.5 rounded border text-[10px] transition ${
                              matched
                                ? "bg-emerald-50/30 border-emerald-100/50 text-emerald-800 dark:text-emerald-300"
                                : "bg-background border-border text-muted-foreground"
                            }`}
                          >
                            <span className="truncate pr-1 font-medium" title={keyword}>{keyword}</span>
                            {matched ? (
                              <Icon name="Check" className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => fixIssue({ type: "skills", meta: { skill: keyword } })}
                                  className="text-brand hover:text-brand-dark cursor-pointer p-0.5 rounded hover:bg-brand/10 transition shrink-0"
                                  title="Add keyword as Skill"
                                >
                                  <Icon name="Plus" className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => fixKeywordWithAI(keyword, "summary")}
                                  className="text-amber-500 hover:text-amber-600 cursor-pointer p-0.5 rounded hover:bg-amber-500/10 transition shrink-0"
                                  title="Weave into Summary via AI"
                                >
                                  <Icon name="Sparkles" className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => fixKeywordWithAI(keyword, "experience")}
                                  className="text-blue-500 hover:text-blue-600 cursor-pointer p-0.5 rounded hover:bg-blue-500/10 transition shrink-0"
                                  title="Weave into Experience via AI"
                                >
                                  <Icon name="Briefcase" className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Recommendation Cards */}
                    <div className="space-y-2.5">
                      <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-2">
                        Audit Recommendations
                      </div>
                      {auditIssues.map((issue) => (
                        <div
                          key={issue.id}
                          className={`p-3 rounded-lg border text-xs flex flex-col gap-2 transition ${
                            issue.severity === "warning"
                              ? "bg-amber-50/40 border-amber-200 dark:bg-amber-950/10 dark:border-amber-900/30"
                              : issue.severity === "success"
                              ? "bg-emerald-50/40 border-emerald-200 dark:bg-emerald-950/10 dark:border-emerald-900/30"
                              : "bg-secondary/40 border-border"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="font-semibold text-foreground flex items-center gap-1">
                                {issue.severity === "success" ? (
                                  <Icon name="Check" className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                ) : issue.severity === "warning" ? (
                                  <Icon name="AlertTriangle" className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                ) : (
                                  <Icon name="Info" className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                )}
                                {issue.title}
                              </div>
                              <div className="text-muted-foreground text-[10px] mt-1 leading-relaxed">
                                {issue.description}
                              </div>
                            </div>
                            {issue.actionLabel && (
                              <Button
                                size="sm"
                                disabled={fixingIssueId === issue.id}
                                onClick={() => fixIssue(issue)}
                                className="bg-brand hover:bg-brand-dark text-white text-[10px] h-7 px-2 shrink-0 gap-1"
                              >
                                {fixingIssueId === issue.id ? (
                                  <Icon name="Loader2" className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Icon name="Sparkles" className="w-3 h-3" />
                                )}
                                <span>{issue.actionLabel}</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {auditIssues.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground text-xs font-semibold">
                          ✓ No issues found. Your resume structure and keyword density are optimal!
                        </div>
                      )}
                    </div>

                    {/* Action Verbs Injector Panel */}
                    <div className="space-y-2 border-t border-border pt-3 mt-3">
                      <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Action Verb Upgrades
                      </div>
                      {(() => {
                        // Scan experience bullets for weak verbs
                        const weakVerbsMap = [
                          { weak: "responsible for", strong: "Spearheaded", suggestion: "Spearheaded check-in operations" },
                          { weak: "helped", strong: "Facilitated", suggestion: "Facilitated passenger transition" },
                          { weak: "managed", strong: "Coordinated", suggestion: "Coordinated team roster updates" },
                          { weak: "worked", strong: "Collaborated with", suggestion: "Collaborated on international sectors" },
                          { weak: "did", strong: "Executed", suggestion: "Executed pre-flight cabin safety checks" },
                          { weak: "checked", strong: "Audited", suggestion: "Audited safety and emergency gear" }
                        ];

                        const upgrades: { expId: string; bulletIdx: number; weakText: string; replacement: string; original: string }[] = [];
                        resume.experience.forEach((exp) => {
                          exp.bullets.forEach((bullet, bIdx) => {
                            for (const map of weakVerbsMap) {
                              if (bullet.toLowerCase().includes(map.weak)) {
                                // Build a replacement replacing the weak verb with the strong one
                                const regex = new RegExp(map.weak, "i");
                                const replacement = bullet.replace(regex, map.strong);
                                upgrades.push({
                                  expId: exp.id,
                                  bulletIdx: bIdx,
                                  weakText: map.weak,
                                  replacement,
                                  original: bullet
                                });
                                break;
                              }
                            }
                          });
                        });

                        if (upgrades.length === 0) {
                          return (
                            <div className="text-[10px] text-muted-foreground bg-secondary/20 p-3 rounded-lg text-center">
                              No weak action verbs detected in your experiences. Excellent work!
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 text-left">
                            {upgrades.map((upg, idx) => (
                              <div key={idx} className="p-2.5 rounded-lg border border-border bg-background space-y-1.5 text-[11px]">
                                <div className="text-[9px] uppercase tracking-wide text-amber-600 font-bold">Weak phrase: "{upg.weakText}"</div>
                                <p className="text-muted-foreground line-through italic text-[10px]">{upg.original}</p>
                                <p className="text-foreground font-medium">✨ {upg.replacement}</p>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    const updatedExp = resume.experience.map((e) => {
                                      if (e.id === upg.expId) {
                                        const bullets = [...e.bullets];
                                        bullets[upg.bulletIdx] = upg.replacement;
                                        return { ...e, bullets };
                                      }
                                      return e;
                                    });
                                    updateResume(resume.id, { ...resume, experience: updatedExp });
                                    toast.success("Bullet point upgraded to airline-grade action verb!");
                                  }}
                                  className="w-full h-7 bg-brand hover:bg-brand-dark text-white text-[10px] flex items-center justify-center"
                                >
                                  Upgrade Action Verb
                                </Button>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}
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
