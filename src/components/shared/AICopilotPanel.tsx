// ============================================================================
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
// ============================================================================

"use client";

import React, { useState, useEffect, useRef } from "react";
import { Icon } from "@/components/shared";
import { toast } from "sonner";
import { callAI } from "@/lib/ai";
import type { ResumeData, JobDescription } from "@/lib/types";
import { saveAIModification, loadAIModifications, type AIModification } from "@/lib/builder-persistence";
import { useApp } from "@/lib/store";

interface ActiveElementContext {
  section: string; // 'summary' | 'experience' | 'education' | 'skills' | 'certifications' | 'achievements'
  id?: string;
  field?: string;
  bulletIndex?: number;
  value: string;
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
}: AICopilotPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"suggest" | "auto">("suggest");
  const [loading, setLoading] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [translateLang, setTranslateLang] = useState("fr");
  const [showHistory, setShowHistory] = useState(false);
  const [modHistory, setModHistory] = useState<AIModification[]>([]);

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
        instruction = "Rephrase this content to improve the writing quality, professional tone, and lexical variety.";
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

    return `You are a professional AI Resume Copilot.
Section Context: ${sectionName}
Target Job: ${jdContext}

Original Resume Text:
"${text}"

Instruction:
${instruction}

Guidelines:
1. Do NOT invent dates, names, or fake stats.
2. Return ONLY the optimized text. No preamble, no quotes, no markdown wrappers.
3. Keep the output length similar to or slightly shorter than the original, unless asked otherwise.`;
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
      const res = await callAI({
        systemPrompt: "You are a professional resume writer. Return ONLY the requested text.",
        userPrompt: prompt,
        maxTokens: 500,
        temperature: 0.3,
        taskCategory: "document",
      });

      const cleanedText = (res.text || "").replace(/^["']|["']$/g, "").trim();

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
    } else if (section === "experience" && id) {
      nextResume.experience = nextResume.experience.map((exp) => {
        if (exp.id === id) {
          if (field === "bullets" && bulletIndex !== undefined) {
            const nextBullets = [...exp.bullets];
            nextBullets[bulletIndex] = textToApply;
            return { ...exp, bullets: nextBullets };
          } else if (field === "title") {
            return { ...exp, title: textToApply };
          } else if (field === "company") {
            return { ...exp, company: textToApply };
          }
        }
        return exp;
      });
      patch({ experience: nextResume.experience });
    } else if (section === "education" && id) {
      nextResume.education = nextResume.education.map((edu) => {
        if (edu.id === id) {
          if (field === "institution") return { ...edu, institution: textToApply };
          if (field === "degree") return { ...edu, degree: textToApply };
        }
        return edu;
      });
      patch({ education: nextResume.education });
    } else if (section === "skills" && id) {
      nextResume.skills = nextResume.skills.map((s) => {
        if (s.id === id) {
          return { ...s, name: textToApply };
        }
        return s;
      });
      patch({ skills: nextResume.skills });
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

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end" ref={panelRef}>
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

                {/* Selected Text / Value Display */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500">Focused Text</label>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-serif leading-relaxed text-slate-300 max-h-[100px] overflow-y-auto select-all">
                    {activeElement?.value || "No focused field. Click or focus inside a summary or work bullet above to edit it."}
                  </div>
                </div>

                {/* Main AI Generation Proposal Diff (Suggest Mode) */}
                {improvedText && (
                  <div className="p-3 rounded-xl bg-slate-900 border border-indigo-500/20 text-xs space-y-2.5 animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-[9px] uppercase font-bold text-indigo-400 tracking-wider">AI Proposed Wording</span>
                      <span className="text-[9px] text-slate-500">Mode: Suggestion</span>
                    </div>
                    <div className="text-slate-200 leading-relaxed font-serif">{improvedText}</div>
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
