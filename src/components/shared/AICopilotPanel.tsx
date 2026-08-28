"use client";

import { recordAI, setFlightScope } from "@/lib/ai/flight-recorder";
setFlightScope({ scope: "resume-copilot", feature: "AI Copilot Panel", module: "src.components.shared.AICopilotPanel" });

// AI Copilot Panel — Feature 6: Interactive floating editor assistant
//
// Designed to sit on the bottom right of the screen (or pinned next to the editor).
// Highlights the focused element (e.g. Summary, Experience, etc.), shows
// selected text, and provides single-click contextual modifications.
// Supports:
//   - Suggest Mode (compare before applying) vs Auto-Apply Mode (modify instantly)
//   - Full undo/redo version control history (synced to IndexedDB)
//   - Version checkpoint logs database
//   - Context-aware action buttons (Enhance, Rewrite, ATS, concise, etc.)
//   - Translation dropdown
//   - Clean design with premium glassmorphism
//   - AgentBrain: full agentic multi-step reasoning with streaming thoughts
// ============================================================================


import React, { useState, useEffect, useRef } from "react";
import { Icon } from "@/components/shared";
import { toast } from "sonner";
import { callAI, getOptimizerDirective, extractJSON } from "@/lib/ai";
import type { ResumeData, JobDescription } from "@/lib/types";
import { saveAIModification, loadAIModifications, type AIModification } from "@/lib/builder-persistence";
import { useApp } from "@/lib/store";
import { runAgentBrain, type AgentThought, type AgentBrainResult } from "@/lib/agent-brain";
import { AgentConsole } from "@/components/shared/AgentConsole";

interface ActiveElementContext {
  section: string; // 'summary' | 'experience' | 'education' | 'skills' | 'certifications' | 'achievements'
  id?: string;
  field?: string;
  bulletIndex?: number;
  value: string;
}

const VERB_THESAURUS: Record<string, string[]> = {
  led: ["Spearheaded", "Orchestrated", "Steered", "Guided", "Chaired"],
  managed: ["Directed", "Supervised", "Coordinated", "Administered", "Overseered"],
  built: ["Constructed", "Engineered", "Devised", "Architected", "Forged"],
  worked: ["Collaborated", "Contributed", "Partnered", "Synergized"],
  made: ["Created", "Formulated", "Generated", "Produced", "Authored"],
  helped: ["Assisted", "Supported", "Facilitated", "Backed", "Reinforced"],
  improved: ["Optimized", "Enhanced", "Refined", "Elevated", "Revamped"],
  responsible: ["Tasked with", "Accountable for", "Entrusted to"],
  handled: ["Executed", "Discharged", "Settled", "Operated"],
};

function renderFormattedText(text: string | null | undefined): React.ReactNode {
  if (!text) return "";
  const boldRegex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(boldRegex);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx} className="font-bold text-slate-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <strong key={idx} className="font-bold text-slate-100">{part.slice(1, -1)}</strong>;
    }
    return part;
  });
}

interface AICopilotPanelProps {
  resume: ResumeData;
  activeJD?: JobDescription | null;
  atsScore?: any;
  patch: (p: Partial<ResumeData>) => void;
  // History props from useUndoRedo
  undo: () => any;
  redo: () => any;
  canUndo: boolean;
  canRedo: boolean;
  undoStack: any[];
  redoStack: any[];
  // Focused element state
  activeElement: ActiveElementContext | null;
  setActiveElement: (el: ActiveElementContext | null) => void;
  isPageOverflowing?: boolean;
}

export function AICopilotPanel({
  resume,
  activeJD,
  atsScore,
  patch,
  undo,
  redo,
  canUndo,
  canRedo,
  undoStack,
  redoStack,
  activeElement,
  setActiveElement,
  isPageOverflowing = false,
}: AICopilotPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"suggest" | "auto">("suggest");
  const [loading, setLoading] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [translateLang, setTranslateLang] = useState("fr");
  const [showHistory, setShowHistory] = useState(false);
  const [modHistory, setModHistory] = useState<AIModification[]>([]);

  const [subTab, setSubTab] = useState<"copilot" | "star" | "verbs" | "mcp" | "agent">("copilot");
  const [starST, setStarST] = useState("");
  const [starAction, setStarAction] = useState("");
  const [starResult, setStarResult] = useState("");
  const [starBullet, setStarBullet] = useState("");

  // AgentBrain states
  const [agentThoughts, setAgentThoughts] = useState<AgentThought[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentResult, setAgentResult] = useState<AgentBrainResult | null>(null);
  const [agentSection, setAgentSection] = useState<"all" | "summary" | "experience" | "education" | "skills">("all");
  const [agentTask, setAgentTask] = useState<"optimize" | "enhance_section" | "fill_page">("optimize");

  // MCP States
  const [mcpServers, setMcpServers] = useState<Record<string, any>>({});
  const [loadingMcp, setLoadingMcp] = useState(false);
  const [selectedMcpServer, setSelectedMcpServer] = useState<string | null>(null);

  // Load MCP servers config for Copilot Panel
  useEffect(() => {
    if (subTab === "mcp") {
      const fetchMcp = async () => {
        setLoadingMcp(true);
        try {
          const res = await fetch("/api/mcp");
          const data = (await res.json()) as any;
          const servers = data.mcpServers || {};
          const enriched: Record<string, any> = {};
          let firstServer: string | null = null;
          for (const [name, cfg] of Object.entries(servers)) {
            if (!firstServer) firstServer = name;
            let cachedTools = [];
            try {
              cachedTools = JSON.parse(localStorage.getItem(`mcp_tools_${name}`) || "[]");
            } catch {}
            enriched[name] = {
              ...(cfg as any),
              status: cachedTools.length > 0 ? "healthy" : "untested",
              tools: cachedTools,
            };
          }
          setMcpServers(enriched);
          if (firstServer && !selectedMcpServer) {
            setSelectedMcpServer(firstServer);
          }
        } catch (e) {
          console.error("Failed to load MCP config for Copilot:", e);
        } finally {
          setLoadingMcp(false);
        }
      };
      fetchMcp();
    }
  }, [subTab]);

  // Generation result states
  const [originalText, setOriginalText] = useState("");
  const [improvedText, setImprovedText] = useState("");
  const [currentAction, setCurrentAction] = useState("");

  const panelRef = useRef<HTMLDivElement>(null);

  // Sync active element text to local state when focus shifts
  useEffect(() => {
    if (activeElement) {
      setOriginalText(activeElement.value);
      // If we switched fields, reset the proposal area
      setImprovedText("");
    }
  }, [activeElement]);

  // Pre-populate active element with a default if it's null, so the panel is active on load
  useEffect(() => {
    if (!activeElement && setActiveElement && resume) {
      if (resume.summary) {
        setActiveElement({ section: "summary", field: "summary", value: resume.summary });
      } else if (resume.experience?.[0]) {
        const exp = resume.experience[0];
        setActiveElement({ section: "experience", id: exp.id, field: "bullets", value: (exp.bullets ?? []).join("\n") });
      }
    }
  }, [activeElement, resume, setActiveElement]);

  // Load IndexedDB modification history logs on mount or whenever resume changes
  useEffect(() => {
    if (resume?.id) {
      loadAIModifications(resume.id).then((history) => {
        setModHistory(history.reverse()); // latest first
      });
    }
  }, [resume?.id, improvedText]);

  // Prompt creation helper based on action type
  const getPromptForAction = (action: string, text: string) => {
    const jdContext = activeJD
      ? `Target Job Role: ${activeJD.title} at ${activeJD.company || "Target Employer"}. Keywords needed: ${(activeJD.keywords || []).slice(0, 15).join(", ")}`
      : "General Resume Improvement";

    const sectionName = activeElement ? activeElement.section : "Resume Content";

    let instruction = "";
    switch (action) {
      case "enhance":
        instruction = "Enhance the wording, make it highly outcome-oriented, start with strong verbs, and polish the structure. Keep the truth and the facts identical.";
        break;
      case "rewrite":
        instruction = activeJD?.title
          ? `Rephrase and rewrite this content targeting the role of "${activeJD.title}"${activeJD.company ? ` at ${activeJD.company}` : ""}. Improve professional tone and lexical variety. Replace any job title references in the text with "${activeJD.title}" to match the target position. Do NOT reference any previous or unrelated job titles.`
          : "Rephrase this content to improve the writing quality, professional tone, and lexical variety.";
        break;
      case "optimize":
        instruction = `Optimize this content for ATS. Inject matching keywords naturally without stuffing. Context: ${jdContext}`;
        break;
      case "concise":
        instruction = "Condense and shorten the text to make it extremely punchy. Eliminate filler phrases while keeping all metrics and key facts.";
        break;
      case "professional":
        instruction = "Make this sound highly professional, executive, and tailored for corporate recruiters. Upgrade the verbs and nouns.";
        break;
      case "achievements":
        instruction = "Structure this like a high-impact achievement bullet point following the STAR method. Start with a strong verb and emphasize the result.";
        break;
      case "grammar":
        instruction = "Correct all grammar, typos, capitalization, formatting issues, and double periods. Do NOT change the meaning.";
        break;
      case "translate":
        const targetLangName =
          ({ en: "English", fr: "French", es: "Spanish", de: "German", ar: "Arabic" } as any)[translateLang] || "French";
        instruction = `Translate this content accurately into ${targetLangName}, keeping the professional tone suitable for resumes.`;
        break;
      default:
        instruction = `Follow this custom instruction: "${action}"`;
    }

    const directive = getOptimizerDirective();

    return `You are an elite Senior Executive Resume Architect & ATS Strategy Director with intelligence on par with top frontier AI models.
Section Context: ${sectionName}
Target Job Context: ${jdContext}

OPTIMIZATION DIRECTIVE & POLICY:
${directive}

Original Resume Text:
"${text}"

Instruction:
${instruction}

EXECUTIVE INTELLIGENCE DIRECTIVES:
1. Preserve ALL factual anchors: employer names, degree titles, institutions, employment years/dates, and certifications must NEVER be fabricated or altered.
2. Use active voice and high-impact action verbs (e.g., Spearheaded, Orchestrated, Engineered, Delivered, Accelerated).
3. Embed metrics and quantified outcomes naturally using plausible estimation formulas where appropriate.
4. Return ONLY the final optimized text. No preamble, no quotes, no markdown wrappers (**bold**, *italics*, etc.). Plain text only.`;
  };

  const handleAction = async (action: string) => {
    const targetText = activeElement?.value || resume.summary || "";
    if (!targetText.trim()) {
      toast.warning("Please focus on or select a text field first!");
      return;
    }

    setLoading(true);
    setCurrentAction(action);
    setOriginalText(targetText);
    const toastId = toast.loading("AI Copilot is processing...");

    try {
      const prompt = getPromptForAction(action, targetText);
      const res = await recordAI({
        systemPrompt: "You are a professional resume writer. Return ONLY the requested text. Never use asterisks or markdown formatting of any kind.",
        userPrompt: prompt,
        maxTokens: 2500,
        temperature: 0.3,
        taskCategory: "document",
      });

      // Strip leading/trailing quotes AND any markdown bold (**text**) or italic (*text*)
      // so that the text applied to the resume is always clean plain text.
      const cleanedText = (res.text || "")
        .replace(/^["']|["']$/g, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .trim();

      if (!cleanedText) {
        throw new Error("Received empty response from AI provider.");
      }

      setImprovedText(cleanedText);
      toast.success("AI suggestion generated!", { id: toastId });

      // If Auto Apply Mode is active, immediately apply it to the resume
      if (mode === "auto") {
        applyEnhancement(cleanedText, action, res.provider);
      }
    } catch (err: any) {
      console.error("[CopilotPanel] Error:", err);
      toast.error(`AI Copilot failed: ${err?.message || "Unknown error"}`, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  // Apply the generated suggestion to the state
  const applyEnhancement = async (textToApply: string, actionName: string, modelName = "AI Copilot") => {
    if (!textToApply) return;

    if (!activeElement) {
      // Fallback: apply to summary if nothing focused
      patch({ summary: textToApply });
      toast.success("Summary updated!");
      return;
    }

    const { section, id, field, bulletIndex } = activeElement;
    const nextResume = { ...resume };

    if (section === "summary") {
      patch({ summary: textToApply });
    } else if (section === "experience") {
      if (nextResume.experience && nextResume.experience.length > 0) {
        let matched = false;
        nextResume.experience = nextResume.experience.map((exp, idx) => {
          const isMatch = (id && exp.id === id) || (!id && idx === 0);
          if (isMatch) {
            matched = true;
            if (field === "bullets" && bulletIndex !== undefined) {
              const nextBullets = [...(exp.bullets || [])];
              nextBullets[bulletIndex] = textToApply;
              return { ...exp, bullets: nextBullets };
            } else if (field === "bullets") {
              return { ...exp, bullets: textToApply.split("\n").map((b) => b.trim()).filter(Boolean) };
            } else if (field === "title") {
              return { ...exp, title: textToApply };
            } else if (field === "company") {
              return { ...exp, company: textToApply };
            } else if (field === "location") {
              return { ...exp, location: textToApply };
            } else if (field === "startDate") {
              return { ...exp, startDate: textToApply };
            } else if (field === "endDate") {
              return { ...exp, endDate: textToApply };
            } else {
              return { ...exp, bullets: textToApply.split("\n").map((b) => b.trim()).filter(Boolean) };
            }
          }
          return exp;
        });
        if (matched) {
          patch({ experience: nextResume.experience });
        }
      }
    } else if (section === "education") {
      if (nextResume.education && nextResume.education.length > 0) {
        let matched = false;
        nextResume.education = nextResume.education.map((edu, idx) => {
          const isMatch = (id && edu.id === id) || (!id && idx === 0);
          if (isMatch) {
            matched = true;
            if (field === "institution") return { ...edu, institution: textToApply };
            if (field === "degree") return { ...edu, degree: textToApply };
            if (field === "field") return { ...edu, field: textToApply };
            if (field === "location") return { ...edu, location: textToApply };
            if (field === "startDate") return { ...edu, startDate: textToApply };
            if (field === "endDate") return { ...edu, endDate: textToApply };
            if (field === "highlights") {
              return { ...edu, highlights: textToApply.trim() ? [textToApply.trim()] : [] };
            }
            return { ...edu, degree: textToApply };
          }
          return edu;
        });
        if (matched) {
          patch({ education: nextResume.education });
        }
      }
    } else if (section === "skills") {
      if (id && nextResume.skills) {
        nextResume.skills = nextResume.skills.map((s) => {
          if (s.id === id) {
            return { ...s, name: textToApply };
          }
          return s;
        });
        patch({ skills: nextResume.skills });
      } else {
        const skillNames = textToApply.split(/[,\n•·]/).map((s) => s.trim()).filter(Boolean);
        if (skillNames.length > 0) {
          const updatedSkills = skillNames.map((name, sIdx) => ({
            id: nextResume.skills?.[sIdx]?.id || `s_${sIdx}_${Date.now()}`,
            name,
            category: nextResume.skills?.[sIdx]?.category || "General",
          }));
          patch({ skills: updatedSkills });
        }
      }
    } else if (section === "languages") {
      const normalizeProficiency = (p?: string): "basic" | "conversational" | "fluent" | "native" => {
        const lower = (p || "").toLowerCase();
        if (lower.includes("nat") || lower.includes("moth")) return "native";
        if (lower.includes("conv") || lower.includes("inter")) return "conversational";
        if (lower.includes("bas") || lower.includes("elem") || lower.includes("beg")) return "basic";
        return "fluent";
      };

      if (id && nextResume.languages) {
        nextResume.languages = nextResume.languages.map((l) => {
          if (l.id === id) {
            if (field === "name") return { ...l, name: textToApply };
            if (field === "proficiency" || field === "level") return { ...l, proficiency: normalizeProficiency(textToApply) };
          }
          return l;
        });
        patch({ languages: nextResume.languages });
      } else {
        const langNames = textToApply.split(/[,\n•·]/).map((s) => s.trim()).filter(Boolean);
        if (langNames.length > 0) {
          const updatedLangs = langNames.map((name, lIdx) => ({
            id: nextResume.languages?.[lIdx]?.id || `l_${lIdx}_${Date.now()}`,
            name,
            proficiency: normalizeProficiency(nextResume.languages?.[lIdx]?.proficiency),
          }));
          patch({ languages: updatedLangs });
        }
      }
    } else if (section === "basics") {
      const contact = { ...resume.contact };
      if (field === "name") {
        patch({ name: textToApply });
      } else if (field === "headline") {
        patch({ headline: textToApply });
      } else if (field === "dateOfBirth") {
        patch({ dateOfBirth: textToApply });
      } else if (field === "location") {
        contact.location = textToApply;
        patch({ contact });
      } else if (field === "phone") {
        contact.phone = textToApply;
        patch({ contact });
      } else if (field === "email") {
        contact.email = textToApply;
        patch({ contact });
      } else if (field === "website") {
        contact.website = textToApply;
        patch({ contact });
      } else if (field === "linkedin") {
        contact.linkedin = textToApply;
        patch({ contact });
      }
    }

    // Save checkpoint log to IndexedDB (Requirement 7)
    const userId = useApp.getState().user?.id || "anonymous";
    const mod: AIModification = {
      id: `mod-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      resumeId: resume.id,
      userId,
      originalContent: activeElement.value,
      aiGeneratedContent: textToApply,
      actionType: actionName,
      modelUsed: modelName,
      timestamp: Date.now(),
      status: "accepted",
    };
    await saveAIModification(resume.id, mod);

    // Refresh active element value so it aligns with what is saved
    setActiveElement({
      ...activeElement,
      value: textToApply,
    });

    toast.success("Enhancement applied directly!");
    setImprovedText("");
  };

  const handleReject = async () => {
    if (!activeElement) return;
    const userId = useApp.getState().user?.id || "anonymous";
    const mod: AIModification = {
      id: `mod-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      resumeId: resume.id,
      userId,
      originalContent: activeElement.value,
      aiGeneratedContent: improvedText,
      actionType: currentAction,
      modelUsed: "AI Copilot",
      timestamp: Date.now(),
      status: "rejected",
    };
    await saveAIModification(resume.id, mod);
    setImprovedText("");
    toast.info("Suggestion discarded.");
  };

  const handleGenerateSTAR = async () => {
    setLoading(true);
    const toastId = toast.loading("AI STAR Builder is writing your bullet...");
    try {
      const prompt = `You are a professional resume writer specializing in high-impact achievements.
Create a single high-impact resume bullet point following the STAR methodology using the following components:

Situation/Task: "${starST}"
Action: "${starAction}"
Result: "${starResult}"

Guidelines:
1. Start with a strong action verb (e.g. Spearheaded, Orchestrated, Designed).
2. Integrate the quantitative metrics and result outcomes naturally.
3. Keep it professional, concise, and ATS-friendly.
4. Return ONLY the generated bullet point text. No preamble, no quotes, no markdown wrappers.`;

      const res = await recordAI({
        systemPrompt: "You are a professional resume writer. Return ONLY the requested text.",
        userPrompt: prompt,
        maxTokens: 2000,
        temperature: 0.7,
        taskCategory: "document"
      });

      const bullet = (res.text || "").replace(/^["']|["']$/g, "").trim();
      setStarBullet(bullet);
      toast.success("STAR Bullet point generated!", { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to generate STAR bullet: " + err.message, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const swapVerbInBullet = (expId: string, bulletIdx: number, oldVerb: string, newVerb: string) => {
    const nextExperience = resume.experience.map((exp) => {
      if (exp.id === expId) {
        const nextBullets = [...exp.bullets];
        const originalBullet = nextBullets[bulletIdx];
        const updated = originalBullet.replace(new RegExp(`^${oldVerb}\\b`, "i"), newVerb);
        nextBullets[bulletIdx] = updated;
        return { ...exp, bullets: nextBullets };
      }
      return exp;
    });
    patch({ experience: nextExperience });
    toast.success(`Swapped verb to "${newVerb}"!`);
  };

  const handlePageExpand = async () => {
    setLoading(true);
    const toastId = toast.loading("AI is expanding resume to fill 100% of the page...");
    try {
      const jdContext = activeJD
        ? `Target Job: ${activeJD.title} at ${activeJD.company || "Target Employer"}. Required keywords: ${(activeJD.keywords || []).slice(0, 15).join(", ")}`
        : "General senior professional resume";

      const prompt = `You are an expert ATS resume writer. The candidate's resume is currently UNDER-FILLING the single A4 page (less than 90% full).
Your task: expand the resume content to achieve ~100% page utilization by:
1. Adding 2-4 more high-impact, quantified bullet points to each experience entry.
2. Expanding the professional summary to 4-6 impactful sentences.
3. Adding module/course highlights to education entries if not already present.
4. Keeping ALL existing facts, dates, company names UNCHANGED.
5. Injecting ATS keywords naturally: ${jdContext}

Current resume data:
${JSON.stringify({
  summary: resume.summary,
  experience: resume.experience.map(e => ({ id: e.id, title: e.title, company: e.company, bullets: e.bullets })),
  education: resume.education.map(e => ({ id: e.id, degree: e.degree, institution: e.institution, highlights: e.highlights }))
})}

Respond ONLY with a JSON object following this exact format, no markdown:
{
  "summary": "expanded summary...",
  "experience": [
    { "id": "exp-id", "bullets": ["bullet1", "bullet2", "bullet3", "bullet4", "bullet5"] }
  ],
  "education": [
    { "id": "edu-id", "highlights": ["Module1, Module2, Module3, Module4, Module5, Module6"] }
  ]
}`;

      const res = await recordAI({
        systemPrompt: "You are a professional resume writer. Return ONLY a valid JSON object with no markdown wrappers.",
        userPrompt: prompt,
        maxTokens: 4000,
        temperature: 0.35,
        taskCategory: "document"
      });

      let data: any = null;
      try {
        data = extractJSON(res.text || "{}");
      } catch {
        const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
        try { data = JSON.parse(jsonStr); } catch {}
      }

      if (data) {
        const nextExperience = resume.experience.map((e, idx) => {
          let match = data.experience?.find((x: any) => x.id === e.id);
          if (!match && data.experience?.[idx]) match = data.experience[idx];
          return match && Array.isArray(match.bullets) ? { ...e, bullets: match.bullets.map((b: any) => String(b).replace(/\*\*([^*]+)\*\*/g, "$1").trim()).filter(Boolean) } : e;
        });
        const nextEducation = resume.education.map((e, idx) => {
          let match = data.education?.find((x: any) => x.id === e.id);
          if (!match && data.education?.[idx]) match = data.education[idx];
          return match && Array.isArray(match.highlights) ? { ...e, highlights: match.highlights.map((h: any) => String(h).replace(/\*\*([^*]+)\*\*/g, "$1").trim()).filter(Boolean) } : e;
        });

        patch({
          summary: data.summary ? String(data.summary).replace(/\*\*([^*]+)\*\*/g, "$1").trim() : resume.summary,
          experience: nextExperience,
          education: nextEducation,
        });

        toast.success("Resume expanded to fill the full page!", { id: toastId });
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to expand page content: " + err.message, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const handleSectionEnhance = async (sectionName: string) => {
    setLoading(true);
    const toastId = toast.loading(`Enhancing ${sectionName} section...`);
    try {
      const jdContext = activeJD
        ? `Target Job: ${activeJD.title} at ${activeJD.company || "Target Employer"}. Keywords: ${(activeJD.keywords || []).slice(0, 15).join(", ")}`
        : "General professional resume";

      let sectionData = "";
      let prompt = "";

      if (sectionName === "summary") {
        sectionData = resume.summary || "";
        prompt = `You are an expert ATS resume writer.\nEnhance this professional summary to be highly impactful, outcome-focused, and ATS-optimized.\nContext: ${jdContext}\n\nOriginal:\n"${sectionData}"\n\nGuidelines:\n- 4-6 impactful sentences\n- Start with a strong professional identity statement\n- Include quantified achievements\n- Naturally inject ATS keywords\n- Return ONLY the improved summary text, no preamble, no markdown.`;
        const res = await recordAI({ systemPrompt: "Professional resume writer. Plain text only, no markdown.", userPrompt: prompt, maxTokens: 600, temperature: 0.3, taskCategory: "document" });
        const cleaned = (res.text || "").replace(/^["']|["']$/g, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim();
        if (cleaned) patch({ summary: cleaned });
        toast.success("Summary enhanced!", { id: toastId });

      } else if (sectionName === "experience") {
        const expData = resume.experience.map(e => ({ id: e.id, title: e.title, company: e.company, bullets: e.bullets }));
        prompt = `You are an expert ATS resume writer.\nEnhance ALL experience bullet points to be highly quantified, outcome-focused, and ATS-optimized.\nContext: ${jdContext}\n\nCurrent experience:\n${JSON.stringify(expData)}\n\nGuidelines:\n- Each bullet must start with a strong action verb\n- Add metrics, percentages, and impact where plausible\n- At least 4-5 bullets per role\n- Return ONLY a JSON array: [{"id": "...", "bullets": ["...","..."]}]`;
        const res = await recordAI({ systemPrompt: "Professional resume writer. Return ONLY valid JSON array, no markdown.", userPrompt: prompt, maxTokens: 3000, temperature: 0.3, taskCategory: "document" });
        let data: any = null;
        try {
          data = extractJSON(res.text || "[]");
        } catch {
          const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
          try { data = JSON.parse(jsonStr); } catch {}
        }
        if (Array.isArray(data) && data.length > 0) {
          const nextExp = resume.experience.map((e, idx) => {
            let m = data.find((x: any) => x.id === e.id);
            if (!m && data[idx]) m = data[idx];
            if (m && Array.isArray(m.bullets)) {
              return { ...e, bullets: m.bullets.map((b: any) => String(b).replace(/\*\*([^*]+)\*\*/g, "$1").trim()).filter(Boolean) };
            }
            return e;
          });
          patch({ experience: nextExp });
        }
        toast.success("Experience bullets enhanced!", { id: toastId });

      } else if (sectionName === "skills") {
        const currentSkills = resume.skills.map(s => s.name);
        prompt = `You are an expert ATS resume writer.\nContext: ${jdContext}\n\nCurrent skills: ${currentSkills.join(", ")}\n\nTask: Return an enhanced, comprehensive skills list that:\n- Keeps all existing skills\n- Adds highly relevant missing ATS keywords for this role\n- Groups logically (same categories as input)\n- Returns ONLY a JSON array: [{"id": "skill-id", "name": "skill name", "category": "category"}]\n\nExisting skill IDs to preserve: ${JSON.stringify(resume.skills.map(s => ({ id: s.id, name: s.name, category: s.category })))}\nAdd new skills with new unique IDs (format: skill-NEW-n).`;
        const res = await recordAI({ systemPrompt: "Professional resume writer. Return ONLY valid JSON array.", userPrompt: prompt, maxTokens: 2000, temperature: 0.3, taskCategory: "document" });
        let data: any = null;
        try {
          data = extractJSON(res.text || "[]");
        } catch {
          const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
          try { data = JSON.parse(jsonStr); } catch {}
        }
        if (Array.isArray(data) && data.length > 0) {
          const nextSkills = data.map((s: any, idx: number) => {
            if (typeof s === "string") {
              return { id: resume.skills[idx]?.id || `s_${idx}_${Date.now()}`, name: s.trim(), category: resume.skills[idx]?.category || "General" };
            }
            return {
              id: s.id || resume.skills[idx]?.id || `s_${idx}_${Date.now()}`,
              name: String(s.name || "").replace(/\*\*([^*]+)\*\*/g, "$1").trim(),
              category: String(s.category || resume.skills[idx]?.category || "General").trim()
            };
          }).filter(s => s.name);
          if (nextSkills.length > 0) {
            patch({ skills: nextSkills });
          }
        }
        toast.success("Skills enhanced!", { id: toastId });

      } else if (sectionName === "education") {
        const eduData = resume.education.map(e => ({ id: e.id, degree: e.degree, institution: e.institution, field: e.field, highlights: e.highlights }));
        prompt = `You are an expert ATS resume writer.\nContext: ${jdContext}\n\nCurrent education:\n${JSON.stringify(eduData)}\n\nTask: Enhance education entries by adding comprehensive module/course highlights relevant to the target role.\nFor each entry, provide a highlights array with a single comma-separated modules string like: "Module1, Module2, Module3, Module4, Module5, Module6, Module7"\nKeep all degree names, institutions, and dates UNCHANGED.\nReturn ONLY JSON: [{"id": "...", "highlights": ["Module1, Module2, Module3, Module4, ..."]}]`;
        const res = await recordAI({ systemPrompt: "Professional resume writer. Return ONLY valid JSON array.", userPrompt: prompt, maxTokens: 1500, temperature: 0.3, taskCategory: "document" });
        let data: any = null;
        try {
          data = extractJSON(res.text || "[]");
        } catch {
          const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
          try { data = JSON.parse(jsonStr); } catch {}
        }
        if (Array.isArray(data) && data.length > 0) {
          const nextEdu = resume.education.map((e, idx) => {
            let m = data.find((x: any) => x.id === e.id);
            if (!m && data[idx]) m = data[idx];
            if (m && Array.isArray(m.highlights)) {
              return { ...e, highlights: m.highlights.map((h: any) => String(h).replace(/\*\*([^*]+)\*\*/g, "$1").trim()).filter(Boolean) };
            }
            return e;
          });
          patch({ education: nextEdu });
        }
        toast.success("Education modules enhanced!", { id: toastId });

      } else if (sectionName === "languages") {
        toast.success("Languages section is already optimised.", { id: toastId });
      }
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to enhance ${sectionName}: ` + err.message, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  // ─── AgentBrain: full agentic multi-step optimization ───────────────────────
  const handleAgentRun = async () => {
    if (isAgentRunning) return;
    setIsAgentRunning(true);
    setAgentThoughts([]);
    setAgentResult(null);
    const toastId = toast.loading(`🤖 Agent Brain: ${agentTask === 'fill_page' ? 'Filling page' : agentTask === 'enhance_section' ? `Enhancing ${agentSection}` : 'Optimizing resume'}...`);

    try {
      const result = await runAgentBrain({
        task: agentTask,
        targetSection: agentTask === 'enhance_section' ? agentSection : undefined,
        resume,
        jobDescription: activeJD ?? null,
        maxIterations: 2,
        callbacks: {
          onThought: (thought) => {
            setAgentThoughts((prev) => [...prev, thought]);
          },
          onPatch: (patchData) => {
            // Apply partial patches live as the agent works
            patch(patchData);
          },
          onComplete: (res) => {
            setAgentResult(res);
            toast.success(`✅ Agent complete! ATS: ${res.atsScore}/100. ${res.improvements.length} improvements.`, { id: toastId });
          },
          onError: (err) => {
            toast.error(`Agent failed: ${err}`, { id: toastId });
          },
        },
      });

      setAgentResult(result);
    } catch (err: any) {
      toast.error(`Agent Brain error: ${err.message}`, { id: toastId });
    } finally {
      setIsAgentRunning(false);
    }
  };

  const handlePageShrink = async () => {

    setLoading(true);
    const toastId = toast.loading("AI is condensing resume to fit 1 page...");
    try {
      const prompt = `You are an expert resume editor. The candidate's resume currently overflows the single A4 page boundary.
I need you to shorten the content slightly (e.g. professional summary and experience bullet points) by 10-15% to guarantee it fits on exactly one page, while keeping all key achievements and metrics intact.

Here is the current resume data:
${JSON.stringify({
  summary: resume.summary,
  experience: resume.experience.map(e => ({ id: e.id, title: e.title, company: e.company, bullets: e.bullets }))
})}

Respond ONLY with a JSON object of the updated sections following this format, with no markdown or formatting outside the JSON:
{
  "summary": "new condensed summary...",
  "experience": [
    { "id": "exp-id", "bullets": ["new condensed bullet 1", "new condensed bullet 2"] }
  ]
}`;

      const res = await recordAI({
        systemPrompt: "You are a professional resume writer. Return ONLY a valid JSON object.",
        userPrompt: prompt,
        maxTokens: 2500,
        temperature: 0.3,
        taskCategory: "document"
      });

      let data: any = null;
      try {
        data = extractJSON(res.text || "{}");
      } catch {
        const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
        try { data = JSON.parse(jsonStr); } catch {}
      }

      if (data) {
        const nextExperience = resume.experience.map((e, idx) => {
          let match = data.experience?.find((x: any) => x.id === e.id);
          if (!match && data.experience?.[idx]) match = data.experience[idx];
          return match && Array.isArray(match.bullets) ? { ...e, bullets: match.bullets.map((b: any) => String(b).replace(/\*\*([^*]+)\*\*/g, "$1").trim()).filter(Boolean) } : e;
        });

        patch({
          summary: data.summary ? String(data.summary).replace(/\*\*([^*]+)\*\*/g, "$1").trim() : resume.summary,
          experience: nextExperience
        });

        toast.success("Resume condensed successfully to fit 1 page!", { id: toastId });
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to automatically shrink page: " + err.message, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-[90] flex flex-col items-end"
      ref={panelRef}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Floating Action Trigger Circle */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="w-14 h-14 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg hover:shadow-indigo-500/30 transition-all duration-300 transform hover:scale-105 active:scale-95 group cursor-pointer relative"
        >
          <Icon name="Sparkles" className="w-6 h-6 text-white group-hover:rotate-12 transition-transform duration-300" />
          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-violet-500"></span>
          </span>
        </button>
      )}

      {/* Expanded Copilot Panel Container */}
      {isOpen && (
        <div className="w-[380px] h-[550px] rounded-2xl bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-md border border-slate-800 text-slate-100 flex flex-col shadow-2xl overflow-hidden transition-all duration-300 animate-in fade-in-50 slide-in-from-bottom-4">
          
          {/* Header */}
          <div className="p-3.5 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Icon name="Sparkles" className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-xs tracking-tight">AI EDITING COPILOT</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer`}
                title="View Modification History Logs"
              >
                <Icon name="History" className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
              >
                <Icon name="X" className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sub-tab bar */}
          {!showHistory && (
            <div className="flex border-b border-slate-800 bg-slate-900/20 shrink-0">
              <button
                onClick={() => setSubTab("copilot")}
                className={`flex-1 py-2 text-center text-[10px] uppercase font-bold tracking-wider transition ${
                  subTab === "copilot" ? "text-indigo-400 border-b border-indigo-500 bg-slate-800/10" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Copilot
              </button>
              <button
                onClick={() => setSubTab("star")}
                className={`flex-1 py-2 text-center text-[10px] uppercase font-bold tracking-wider transition ${
                  subTab === "star" ? "text-indigo-400 border-b border-indigo-500 bg-slate-800/10" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                STAR Builder
              </button>
              <button
                onClick={() => setSubTab("verbs")}
                className={`flex-1 py-2 text-center text-[10px] uppercase font-bold tracking-wider transition ${
                  subTab === "verbs" ? "text-indigo-400 border-b border-indigo-500 bg-slate-800/10" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Verbs Scan
              </button>
              <button
                onClick={() => setSubTab("mcp")}
                className={`flex-1 py-2 text-center text-[10px] uppercase font-bold tracking-wider transition ${
                  subTab === "mcp" ? "text-indigo-400 border-b border-indigo-500 bg-slate-800/10" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                MCP Tools
              </button>
              <button
                onClick={() => setSubTab("agent")}
                className={`flex-1 py-2 text-center text-[10px] uppercase font-bold tracking-wider transition relative ${
                  subTab === "agent" ? "text-violet-400 border-b border-violet-500 bg-slate-800/10" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {isAgentRunning && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-400 animate-ping" />
                )}
                Agent 🤖
              </button>
            </div>
          )}

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
            
            {showHistory ? (
              /* IndexedDB Modification Logs Section (Requirement 7) */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">AI Edit History</span>
                  <button onClick={() => setShowHistory(false)} className="text-[10px] text-indigo-400 hover:underline">
                    Back to Editor
                  </button>
                </div>
                {modHistory.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs">No AI changes recorded yet.</div>
                ) : (
                  <div className="space-y-2.5 max-h-[400px] overflow-y-auto scrollbar-thin">
                    {modHistory.map((item) => (
                      <div key={item.id} className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800 text-[11px] space-y-1">
                        <div className="flex items-center justify-between text-[9px] text-slate-400">
                          <span className="px-1.5 py-0.5 rounded bg-slate-700 font-mono uppercase">{item.actionType}</span>
                          <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-slate-300 italic font-serif">"{item.aiGeneratedContent.slice(0, 100)}..."</div>
                        <div className="flex justify-between items-center text-[9px] pt-1 text-slate-500">
                          <span>Model: {item.modelUsed}</span>
                          <span className={item.status === "accepted" ? "text-emerald-400" : "text-rose-400"}>
                            {item.status === "accepted" ? "Applied" : "Discarded"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Standard Copilot Editor Workspace */
              <>
                {subTab === "copilot" && (
                  <>
                    {/* Active Section Context Flag */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                          Context: {activeElement ? `${activeElement.section} editor` : "Select a field in editor"}
                        </span>
                      </div>
                      {/* Mode Selector (Suggest vs Auto-Apply) */}
                      <div className="flex items-center gap-1.5 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700">
                        <button
                          onClick={() => setMode("suggest")}
                          className={`text-[9px] font-semibold px-2 py-0.5 rounded-full transition ${
                            mode === "suggest" ? "bg-indigo-600 text-white" : "text-slate-400"
                          }`}
                        >
                          Suggest
                        </button>
                        <button
                          onClick={() => setMode("auto")}
                          className={`text-[9px] font-semibold px-2 py-0.5 rounded-full transition ${
                            mode === "auto" ? "bg-indigo-600 text-white" : "text-slate-400"
                          }`}
                        >
                          Auto Apply
                        </button>
                      </div>
                    </div>

                    {/* === SECTION-SPECIFIC ENHANCE QUICK ACTIONS === */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-bold text-slate-500">Enhance by Section</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { key: "summary", label: "Summary", icon: "FileText", color: "text-violet-400" },
                          { key: "experience", label: "Experience", icon: "Briefcase", color: "text-emerald-400" },
                          { key: "education", label: "Education", icon: "GraduationCap", color: "text-blue-400" },
                          { key: "skills", label: "Skills", icon: "Zap", color: "text-amber-400" },
                        ].map(({ key, label, icon, color }) => (
                          <button
                            key={key}
                            onClick={() => handleSectionEnhance(key)}
                            disabled={loading}
                            className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-[10px] font-semibold transition active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-40 hover:border-indigo-500/40"
                          >
                            {loading ? (
                              <Icon name="Loader2" className={`w-3 h-3 animate-spin ${color}`} />
                            ) : (
                              <Icon name={icon} className={`w-3 h-3 ${color}`} />
                            )}
                            <span className="text-slate-200">Enhance {label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Page-Break alert card */}
                    {isPageOverflowing && (
                      <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900 text-xs space-y-2 animate-pulse">
                        <div className="flex items-center gap-1.5 text-rose-400 font-bold">
                          <Icon name="AlertTriangle" className="w-4 h-4" />
                          1-Page A4 Overflow Alert
                        </div>
                        <p className="text-[10px] text-slate-300">
                          Your resume has exceeded the single-page print boundary.
                        </p>
                        <button
                          onClick={handlePageShrink}
                          disabled={loading}
                          className="w-full py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {loading ? (
                            <Icon name="Loader2" className="w-3 h-3 animate-spin text-white" />
                          ) : (
                            <Icon name="Sparkles" className="w-3 h-3 text-white" />
                          )}
                          ✨ Auto-Compress to 1 Page
                        </button>
                      </div>
                    )}

                    {/* Fill Page 100% card — shown when resume is UNDER-filling */}
                    {!isPageOverflowing && (
                      <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-800/40 text-xs space-y-2">
                        <div className="flex items-center gap-1.5 text-indigo-400 font-bold">
                          <Icon name="Maximize2" className="w-4 h-4" />
                          Page Fill Optimizer
                        </div>
                        <p className="text-[10px] text-slate-300">
                          Resume is under-filling the page. Expand it to 100% with more quantified bullets and modules.
                        </p>
                        <button
                          onClick={handlePageExpand}
                          disabled={loading}
                          className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {loading ? (
                            <Icon name="Loader2" className="w-3 h-3 animate-spin text-white" />
                          ) : (
                            <Icon name="TrendingUp" className="w-3 h-3 text-white" />
                          )}
                          📈 Fill Page to 100%
                        </button>
                      </div>
                    )}

                    {/* Selected Text / Value Display */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-500">Focused Text</label>
                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-serif leading-relaxed text-slate-300 max-h-[100px] overflow-y-auto select-all">
                        {activeElement?.value || "No focused field. Click or focus inside a summary or work bullet above to edit it."}
                      </div>
                    </div>

                    {/* Main AI Wording Proposal */}
                    {improvedText && (
                      <div className="p-3 rounded-xl bg-slate-900 border border-indigo-500/20 text-xs space-y-2.5 animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                          <span className="text-[9px] uppercase font-bold text-indigo-400 tracking-wider">AI Proposed Wording</span>
                          <span className="text-[9px] text-slate-500">Mode: Suggestion</span>
                        </div>
                        <div className="text-slate-200 leading-relaxed font-serif">{renderFormattedText(improvedText)}</div>
                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            onClick={handleReject}
                            className="px-2.5 py-1 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                          >
                            Discard
                          </button>
                          <button
                            onClick={() => applyEnhancement(improvedText, currentAction)}
                            className="px-2.5 py-1 text-[10px] font-bold rounded bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer flex items-center gap-1"
                          >
                            <Icon name="Check" className="w-3 h-3" /> Apply Edit
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Dynamic Contextual Action Buttons */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-bold text-slate-500">Contextual Refinement Actions</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleAction("enhance")}
                          disabled={loading || !activeElement}
                          className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium transition active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                        >
                          <Icon name="Wand2" className="w-3.5 h-3.5 text-violet-400" /> Enhance Section
                        </button>
                        <button
                          onClick={() => handleAction("rewrite")}
                          disabled={loading || !activeElement}
                          className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium transition active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                        >
                          <Icon name="RefreshCw" className="w-3.5 h-3.5 text-emerald-400" /> Rewrite Flow
                        </button>
                        <button
                          onClick={() => handleAction("optimize")}
                          disabled={loading || !activeElement}
                          className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium transition active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                        >
                          <Icon name="Target" className="w-3.5 h-3.5 text-rose-400" /> Optimize ATS
                        </button>
                        <button
                          onClick={() => handleAction("concise")}
                          disabled={loading || !activeElement}
                          className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium transition active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                        >
                          <Icon name="Scissors" className="w-3.5 h-3.5 text-amber-400" /> Make Concise
                        </button>
                        <button
                          onClick={() => handleAction("professional")}
                          disabled={loading || !activeElement}
                          className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium transition active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                        >
                          <Icon name="Briefcase" className="w-3.5 h-3.5 text-blue-400" /> Professional
                        </button>
                        <button
                          onClick={() => handleAction("achievements")}
                          disabled={loading || !activeElement}
                          className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium transition active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                        >
                          <Icon name="TrendingUp" className="w-3.5 h-3.5 text-yellow-400" /> Add Achievements
                        </button>
                        <button
                          onClick={() => handleAction("grammar")}
                          disabled={loading || !activeElement}
                          className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium transition active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-40 col-span-2"
                        >
                          <Icon name="CheckSquare" className="w-3.5 h-3.5 text-cyan-400" /> Fix Typos & Grammar
                        </button>
                      </div>
                    </div>

                    {/* Translation Controls */}
                    <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[11px] font-medium">
                        <Icon name="Globe2" className="w-4 h-4 text-indigo-400" /> Translate Focused
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={translateLang}
                          onChange={(e) => setTranslateLang(e.target.value)}
                          className="h-7 px-2 rounded border border-slate-700 bg-slate-900 text-xs text-slate-200 cursor-pointer"
                        >
                          <option value="en">English</option>
                          <option value="fr">French</option>
                          <option value="es">Spanish</option>
                          <option value="de">German</option>
                          <option value="ar">Arabic</option>
                        </select>
                        <button
                          onClick={() => handleAction("translate")}
                          disabled={loading || !activeElement}
                          className="h-7 px-3 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-bold text-white transition active:scale-95 cursor-pointer disabled:opacity-40"
                        >
                          Translate
                        </button>
                      </div>
                    </div>

                    {/* Custom Instruction Box */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-bold text-slate-500">Custom Wording Prompt</label>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (customInput.trim()) {
                            handleAction(customInput);
                            setCustomInput("");
                          }
                        }}
                        className="flex gap-2"
                      >
                        <input
                          type="text"
                          value={customInput}
                          onChange={(e) => setCustomInput(e.target.value)}
                          placeholder="e.g. rewrite for an aviation focus"
                          disabled={loading || !activeElement}
                          className="flex-1 h-9 px-3 rounded-lg border border-slate-800 bg-slate-900 text-xs placeholder-slate-500 text-slate-100 disabled:opacity-40"
                        />
                        <button
                          type="submit"
                          disabled={loading || !customInput.trim() || !activeElement}
                          className="w-9 h-9 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center justify-center transition active:scale-95 disabled:opacity-40 cursor-pointer"
                        >
                          <Icon name="ArrowRight" className="w-4 h-4" />
                        </button>
                      </form>
                    </div>
                  </>
                )}

                {subTab === "star" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-1.5">
                      <Icon name="TrendingUp" className="w-4 h-4 text-emerald-400" />
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">STAR Bullet Builder</span>
                    </div>
                    
                    <div className="space-y-3 text-xs">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 font-bold uppercase">Situation / Task (What did you do?)</label>
                        <textarea
                          value={starST}
                          onChange={(e) => setStarST(e.target.value)}
                          placeholder="e.g. Led migration of backend checkout system to microservices..."
                          rows={2}
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-slate-200 resize-none focus:outline-none focus:border-slate-700"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 font-bold uppercase">Action (What tools/skills did you use?)</label>
                        <textarea
                          value={starAction}
                          onChange={(e) => setStarAction(e.target.value)}
                          placeholder="e.g. used Next.js, Redis cache layer, optimized SQL queries..."
                          rows={2}
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-slate-200 resize-none focus:outline-none focus:border-slate-700"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 font-bold uppercase">Result (What was the quantitative impact?)</label>
                        <textarea
                          value={starResult}
                          onChange={(e) => setStarResult(e.target.value)}
                          placeholder="e.g. reduced server latency by 45% and page load times by 1.2s..."
                          rows={2}
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-slate-200 resize-none focus:outline-none focus:border-slate-700"
                        />
                      </div>
                    </div>

                    <button
                      onClick={handleGenerateSTAR}
                      disabled={loading || !starST.trim()}
                      className="w-full py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                    >
                      {loading ? (
                        <Icon name="Loader2" className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <Icon name="Sparkles" className="w-4 h-4 text-white" />
                      )}
                      Generate STAR Bullet
                    </button>

                    {starBullet && (
                      <div className="p-3 rounded-xl bg-slate-900 border border-emerald-500/20 text-xs space-y-2.5 animate-in fade-in zoom-in-95">
                        <span className="text-[9px] uppercase font-bold text-emerald-400 tracking-wider">Generated Bullet</span>
                        <div className="text-slate-200 leading-relaxed font-serif">{starBullet}</div>
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => {
                              if (activeElement && activeElement.section === "experience") {
                                applyEnhancement(starBullet, "star-builder");
                                setStarBullet("");
                              } else {
                                navigator.clipboard.writeText(starBullet);
                                toast.success("Copied to clipboard! Focus a bullet point in the editor to apply directly.");
                              }
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-[10px] cursor-pointer flex items-center gap-1"
                          >
                            <Icon name="Check" className="w-3 h-3" />
                            {activeElement?.section === "experience" ? "Apply to focused field" : "Copy to Clipboard"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {subTab === "verbs" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Icon name="Wrench" className="w-4 h-4 text-amber-400" />
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Action Verb Scanner</span>
                      </div>
                    </div>
                    
                    {(() => {
                      const verbCounts: Record<string, { count: number; matches: { expId: string; bulletIdx: number; company: string }[] }> = {};
                      resume.experience.forEach((exp) => {
                        exp.bullets.forEach((bullet, idx) => {
                          const firstWord = bullet.trim().split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, "")?.toLowerCase();
                          if (firstWord && firstWord.length > 2) {
                            if (!verbCounts[firstWord]) {
                              verbCounts[firstWord] = { count: 0, matches: [] };
                            }
                            verbCounts[firstWord].count++;
                            verbCounts[firstWord].matches.push({ expId: exp.id, bulletIdx: idx, company: exp.company || "Company" });
                          }
                        });
                      });

                      const duplicates = Object.entries(verbCounts)
                        .filter(([_, data]) => data.count > 1)
                        .sort((a, b) => b[1].count - a[1].count);

                      if (duplicates.length === 0) {
                        return (
                          <div className="text-center py-10 space-y-2">
                            <Icon name="CheckCircle2" className="w-8 h-8 text-emerald-400 mx-auto animate-bounce" />
                            <p className="text-xs text-slate-400">Excellent! No repetitive action verbs detected in your bullet points.</p>
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-3">
                          <p className="text-[10px] text-slate-500 leading-relaxed">
                            We found repetitive action verbs. Click a suggestion below to swap them with fresh alternatives:
                          </p>
                          <div className="space-y-2.5 max-h-[360px] overflow-y-auto scrollbar-thin">
                            {duplicates.map(([verb, data]) => {
                              const suggestions = VERB_THESAURUS[verb] || ["Spearheaded", "Orchestrated", "Accelerated", "Constructed"];
                              return (
                                <div key={verb} className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-rose-400 capitalize">"{verb}" ({data.count} times)</span>
                                  </div>
                                  <div className="space-y-1">
                                    {data.matches.map((m, mi) => (
                                      <div key={mi} className="text-[10px] text-slate-400 pl-2 border-l border-slate-800">
                                        At {m.company}:
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {suggestions.slice(0, 3).map((sug) => (
                                            <button
                                              key={sug}
                                              onClick={() => swapVerbInBullet(m.expId, m.bulletIdx, verb, sug)}
                                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 hover:text-white transition text-[9px] cursor-pointer"
                                            >
                                              Swap with "{sug}"
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {subTab === "mcp" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Icon name="Cpu" className="w-4 h-4 text-indigo-400" />
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Model Context Protocol</span>
                      </div>
                    </div>

                    {loadingMcp ? (
                      <div className="flex items-center justify-center py-8">
                        <Icon name="Loader2" className="w-5 h-5 animate-spin text-indigo-500" />
                      </div>
                    ) : Object.keys(mcpServers).length === 0 ? (
                      <div className="text-center py-8 space-y-2">
                        <Icon name="Cpu" className="w-8 h-8 text-slate-600 mx-auto" />
                        <p className="text-xs text-slate-400">No MCP servers registered.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                          {Object.keys(mcpServers).map((name) => {
                            const isSel = selectedMcpServer === name;
                            const isHealthy = mcpServers[name].status === "healthy";
                            return (
                              <button
                                key={name}
                                onClick={() => setSelectedMcpServer(name)}
                                className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide shrink-0 transition flex items-center gap-1 ${
                                  isSel
                                    ? "bg-indigo-600 text-white"
                                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? "bg-emerald-400" : "bg-slate-500"}`} />
                                {name}
                              </button>
                            );
                          })}
                        </div>

                        {selectedMcpServer && mcpServers[selectedMcpServer] && (
                          <div className="space-y-2.5">
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Server Status</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                                  mcpServers[selectedMcpServer].status === "healthy"
                                    ? "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
                                    : "bg-slate-950 text-slate-400 border border-slate-800/40"
                                }`}>
                                  {mcpServers[selectedMcpServer].status}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-mono truncate">
                                {mcpServers[selectedMcpServer].type === "sse"
                                  ? mcpServers[selectedMcpServer].url
                                  : `${mcpServers[selectedMcpServer].command} ${mcpServers[selectedMcpServer].args?.join(" ") || ""}`
                                }
                              </p>
                            </div>

                            <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider block">
                              Exposed Capabilities ({mcpServers[selectedMcpServer].tools?.length || 0})
                            </span>

                            <div className="space-y-2 max-h-[220px] overflow-y-auto scrollbar-thin pr-1">
                              {!mcpServers[selectedMcpServer].tools || mcpServers[selectedMcpServer].tools.length === 0 ? (
                                <p className="text-[10px] text-slate-500 italic">No tools discovered. Run test connection in settings.</p>
                              ) : (
                                mcpServers[selectedMcpServer].tools.map((tool: any) => (
                                  <div key={tool.name} className="p-2.5 rounded-lg border border-slate-800/60 bg-slate-950/40 space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-mono text-[10px] font-bold text-indigo-400">{tool.name}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-relaxed">{tool.description}</p>
                                    {tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0 && (
                                      <div className="pt-1 space-y-0.5">
                                        <span className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">Params:</span>
                                        <div className="p-1 rounded bg-slate-900/60 font-mono text-[8px] text-slate-400 flex flex-wrap gap-x-2 gap-y-0.5">
                                          {Object.entries(tool.inputSchema.properties).map(([pName, pSpec]: [string, any]) => {
                                            const isReq = tool.inputSchema.required?.includes(pName);
                                            return (
                                              <span key={pName} className="flex gap-0.5">
                                                <span className={isReq ? "text-rose-400" : ""}>{pName}</span>
                                                <span className="text-slate-600">({pSpec.type})</span>
                                              </span>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── AGENT BRAIN TAB ────────────────────────────────────── */}
                {subTab === "agent" && (
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                        <Icon name="Brain" className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-slate-200">Agent Brain</div>
                        <div className="text-[9px] text-slate-500">Multi-step agentic optimization with live thought streaming</div>
                      </div>
                    </div>

                    {/* Task selector */}
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Mode</label>
                      <div className="grid grid-cols-3 gap-1">
                        {([
                          { key: "optimize", label: "Full Optimize", icon: "Sparkles" },
                          { key: "enhance_section", label: "Section", icon: "Wand2" },
                          { key: "fill_page", label: "Fill Page", icon: "Maximize2" },
                        ] as const).map(({ key, label, icon }) => (
                          <button
                            key={key}
                            onClick={() => setAgentTask(key)}
                            className={`p-1.5 rounded-lg text-[9px] font-bold border transition flex flex-col items-center gap-0.5 cursor-pointer ${
                              agentTask === key
                                ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
                                : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <Icon name={icon} className="w-3 h-3" />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Section selector (only for enhance_section) */}
                    {agentTask === "enhance_section" && (
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Target Section</label>
                        <div className="grid grid-cols-3 gap-1">
                          {(["all", "summary", "experience", "education", "skills"] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => setAgentSection(s)}
                              className={`p-1 rounded text-[9px] font-bold border transition cursor-pointer capitalize ${
                                agentSection === s
                                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300"
                                  : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* JD Context indicator */}
                    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[9px] ${
                      activeJD ? "bg-emerald-950/30 border border-emerald-800/30 text-emerald-400" : "bg-slate-800/30 border border-slate-700/30 text-slate-500"
                    }`}>
                      <Icon name={activeJD ? "Briefcase" : "Info"} className="w-3 h-3" />
                      {activeJD ? `JD: ${activeJD.title || "Loaded"} — ATS keywords active` : "No JD loaded — general optimization mode"}
                    </div>

                    {/* Run button */}
                    <button
                      onClick={handleAgentRun}
                      disabled={isAgentRunning}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-[11px] font-bold transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isAgentRunning ? (
                        <>
                          <Icon name="Loader2" className="w-4 h-4 animate-spin" />
                          Agent Running...
                        </>
                      ) : (
                        <>
                          <Icon name="Zap" className="w-4 h-4" />
                          🤖 Launch Agent Brain
                        </>
                      )}
                    </button>

                    {/* Live streaming thought console */}
                    {(agentThoughts.length > 0 || isAgentRunning) && (
                      <AgentConsole
                        thoughts={agentThoughts}
                        isRunning={isAgentRunning}
                        atsScoreBefore={atsScore?.score}
                        atsScoreAfter={agentResult?.atsScore}
                        improvements={agentResult?.improvements}
                        compact={true}
                      />
                    )}

                    {/* Capabilities info (when idle and no thoughts) */}
                    {agentThoughts.length === 0 && !isAgentRunning && (
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Agent Capabilities</label>
                        {[
                          { icon: "Brain", color: "text-violet-400", text: "Multi-step chain-of-thought reasoning" },
                          { icon: "Wrench", color: "text-amber-400", text: "Tool calling: ATS analyzer, section patchers" },
                          { icon: "RefreshCcw", color: "text-cyan-400", text: "Self-reflection & iterative improvement" },
                          { icon: "Eye", color: "text-emerald-400", text: "Real-time streaming of all agent thoughts" },
                          { icon: "GitBranch", color: "text-orange-400", text: "Autonomous decision & retry loops" },
                        ].map((item, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] text-slate-400">
                            <Icon name={item.icon} className={`w-3 h-3 shrink-0 ${item.color}`} />
                            {item.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

          </div>

          {/* Footer Version Control Navigation */}
          <div className="p-3 border-t border-slate-800 bg-slate-900/40 flex items-center justify-between shrink-0 text-xs">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const prevData = undo();
                  if (prevData) {
                    patch(prevData);
                    toast.info("Latest changes reverted");
                  }
                }}
                disabled={!canUndo}
                className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 transition flex items-center gap-1 cursor-pointer font-bold text-[10px]"
                title="Undo edit (Ctrl+Z)"
              >
                <Icon name="Undo2" className="w-3.5 h-3.5" /> Revert Previous
              </button>
              <button
                onClick={() => {
                  const nextData = redo();
                  if (nextData) {
                    patch(nextData);
                    toast.info("Reverted edit restored");
                  }
                }}
                disabled={!canRedo}
                className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 transition flex items-center gap-1 cursor-pointer font-bold text-[10px]"
                title="Redo edit (Ctrl+Shift+Z)"
              >
                <Icon name="Redo2" className="w-3.5 h-3.5" /> Redo
              </button>
            </div>
            <div className="text-[10px] text-slate-500 font-mono font-semibold">
              History: {undoStack.length} checkpoints
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
