"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";
import type { ResumeData } from "@/lib/types";

interface SmartTextareaProps {
  value: string;
  onChange: (value: string) => void;
  section: "summary" | "bullet" | "skill" | "education" | "language";
  placeholder?: string;
  className?: string;
  resume?: ResumeData | null;
  jobDescriptionText?: string;
  context?: string;
  rows?: number;
  disabled?: boolean;
}

type SuggestStatus = "idle" | "loading" | "error";

function sectionLabel(s: string) {
  const m: Record<string,string> = { summary:"Summary", bullet:"Bullet", skill:"Skill", education:"Education", language:"Language" };
  return m[s]||s;
}

/**
 * Build a context snippet for AI prompts — resume name, current role, JD keywords.
 */
function buildContext(resume?: ResumeData | null, jdText?: string): string {
  const parts: string[] = [];
  if (resume?.name) parts.push(`Candidate: ${resume.name}`);
  if (resume?.headline) parts.push(`Target role: ${resume.headline}`);
  if (resume?.summary) parts.push(`Current summary (context): ${resume.summary.slice(0, 200)}`);
  if (resume?.experience?.[0]) {
    const e = resume.experience[0];
    parts.push(`Recent role: ${e.title} at ${e.company}`);
    if (e.bullets.length > 0) parts.push(`Existing bullets: ${e.bullets.slice(0, 3).join(" | ")}`);
  }
  if (jdText) parts.push(`Job description keywords: ${jdText.slice(0, 300)}`);
  return parts.join("\n");
}

export function SmartTextarea({ value, onChange, section, placeholder, className, resume, jobDescriptionText, context, rows=3, disabled }: SmartTextareaProps) {
  const [suggestion, setSuggestion] = useState("");
  const [variants, setVariants] = useState<string[]>([]);
  const [currentVariant, setCurrentVariant] = useState(0);
  const [status, setStatus] = useState<SuggestStatus>("idle");
  const [showPopover, setShowPopover] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Build full context for AI prompts
  const ctxMemo = buildContext(resume, jobDescriptionText);

  const callAI = async (prompt: string) => {
    try {
      const { ProviderRouter } = await import("@/lib/ai/services/router");
      const r = await ProviderRouter.chat({
        messages: [
          { role: "system", content: "You are a professional resume writer. Return ONLY the requested text." },
          { role: "user", content: prompt },
        ], maxTokens: 200, temperature: 0.7,
      }, { agentTask: "summary" });
      return (r.text||"").replace(/^["']|["']$/g,"").trim();
    } catch { return ""; }
  };

  /**
   * Fetch multiple suggestion variants from the AI.
   */
  const fetchVariants = useCallback(async (text: string, count = 3): Promise<string[]> => {
    const prompt = ctxMemo
      ? `Context:\n${ctxMemo}\n\n`
      : "";
    if (section === "summary") {
      return callAI(
        prompt + `I need to complete this resume summary: "${text}". ` +
        `Suggest ${count} different completions (15-25 words each) that are impactful and keyword-rich. ` +
        `Return as a JSON array of strings, NO markdown, NO numbering.`
      ).then(r => {
        try { const arr = JSON.parse(r); return Array.isArray(arr) ? arr.slice(0, count) : [r]; }
        catch { return r ? [r] : []; }
      });
    }
    if (section === "bullet") {
      return callAI(
        prompt + `I need to complete this resume bullet point: "${text}". ` +
        `Suggest ${count} different completions (10-20 words each) starting with an action verb. ` +
        `Return as a JSON array of strings, NO markdown, NO numbering.`
      ).then(r => {
        try { const arr = JSON.parse(r); return Array.isArray(arr) ? arr.slice(0, count) : [r]; }
        catch { return r ? [r] : []; }
      });
    }
    return callAI(
      `Complete this ${section} entry: "${text}". ` +
      `Suggest ${count} short completions. ` +
      `Return as a JSON array of strings, NO markdown.`
    ).then(r => {
      try { const arr = JSON.parse(r); return Array.isArray(arr) ? arr.slice(0, count) : [r]; }
      catch { return r ? [r] : []; }
    });
  }, [section, ctxMemo]);

  /**
   * Auto-complete: debounced, context-aware, multi-variant.
   */
  const onType = useCallback((text: string) => {
    onChange(text);
    setSuggestion("");
    setVariants([]);
    setShowPopover(false);
    if (debRef.current) clearTimeout(debRef.current);
    if (text.length < 15) return;
    debRef.current = setTimeout(async () => {
      setStatus("loading");
      const sug = await callAI(
        (ctxMemo ? `Context:\n${ctxMemo}\n\n` : "") +
        (section === "summary"
          ? `Complete this resume summary: "${text}". Add 10-20 more words. Return ONLY the completion.`
          : section === "bullet"
          ? `Complete this achievement bullet: "${text}". Add an action verb continuation with a metric. Return ONLY the completion.`
          : `Suggest completion for: "${text}". Return ONLY the completion.`)
      );
      if (sug && sug !== text) {
        setSuggestion(sug);
        setStatus("idle");
      } else {
        setStatus("idle");
      }
    }, 1200);
  }, [onChange, section, ctxMemo]);

  const acceptSug = () => {
    if (suggestion) {
      onChange(suggestion);
      setSuggestion("");
      setVariants([]);
      setShowPopover(false);
    }
  };

  const acceptVariant = (v: string) => {
    onChange(v);
    setSuggestion("");
    setVariants([]);
    setShowPopover(false);
  };

  /**
   * Generate new content from scratch (context-aware).
   */
  const onGenerate = async () => {
    setStatus("loading");
    const ctx = ctxMemo || (resume ? `Name: ${resume.name||''}. Role: ${resume.experience?.[0]?.title||''}` : '');
    if (section === "summary") {
      const gen = await callAI(
        (ctx ? `Context:\n${ctx}\n\n` : "") +
        `Generate a professional resume summary (60-80 words) for the candidate. ` +
        `Highlight years of experience, key skills, and measurable outcomes. Return ONLY the summary.`
      );
      if (gen) { onChange(gen); toast.success("Summary generated"); }
    } else if (section === "bullet") {
      const gen = await callAI(
        (ctx ? `Context:\n${ctx}\n\n` : "") +
        `Generate an achievement bullet for: "${context||''}". ` +
        `Start with a strong action verb, include a specific metric, 10-20 words. Return ONLY the bullet.`
      );
      if (gen) { onChange(gen); toast.success("Bullet generated"); }
    } else {
      const gen = await callAI(
        `Generate content for ${section} section. ${ctx}. Return ONLY the text.`
      );
      if (gen) { onChange(gen); toast.success(`${sectionLabel(section)} generated`); }
    }
    setStatus("idle");
  };

  /**
   * Regenerate with a fresh AI call (context-aware).
   */
  const onRegen = async () => {
    if (!value) return;
    setStatus("loading");
    const gen = await callAI(
      (ctxMemo ? `Context:\n${ctxMemo}\n\n` : "") +
      `Rewrite this to be more impactful and ATS-friendly: "${value}". ` +
      `Keep same length. Use active voice and specific metrics. Return ONLY the rewritten text.`
    );
    if (gen) { onChange(gen); toast.success(`${sectionLabel(section)} regenerated`); }
    setStatus("idle");
  };

  /**
   * Show suggestion popover with variants.
   */
  const onShowSuggestions = async () => {
    if (!value || value.length < 10) {
      toast.info("Type at least 10 characters for suggestions");
      return;
    }
    if (showPopover) { setShowPopover(false); return; }
    setStatus("loading");
    const vs = await fetchVariants(value);
    if (vs.length > 0) {
      setVariants(vs);
      setCurrentVariant(0);
      setShowPopover(true);
      setStatus("idle");
    } else {
      setStatus("idle");
      toast.error("No suggestions generated");
    }
  };

  // Keyboard handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab → accept auto-complete suggestion
    if (e.key === "Tab" && suggestion) {
      e.preventDefault();
      acceptSug();
      return;
    }
    // Escape → dismiss popover/suggestion
    if (e.key === "Escape") {
      if (showPopover) { setShowPopover(false); return; }
      if (suggestion) { setSuggestion(""); return; }
    }
    // Ctrl+Space → show suggestions popover
    if (e.key === " " && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onShowSuggestions();
      return;
    }
  };

  // Close popover on outside click
  useEffect(() => {
    if (!showPopover) return;
    const handler = (e: MouseEvent) => {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        // Check if click was inside popover
        const popover = document.getElementById("smart-textarea-popover");
        if (popover && !popover.contains(e.target as Node)) {
          setShowPopover(false);
        }
      }
    };
    // Delay to avoid immediate close from trigger button
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [showPopover]);

  return (
    <div className="relative group" ref={textareaRef}>
      <Textarea
        value={value}
        onChange={e => onType(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || ''}
        rows={rows}
        disabled={disabled}
        className={className}
      />

      {/* Auto-complete suggestion hint (inline, below text) */}
      {suggestion && status === "idle" && !showPopover && (
        <div
          className="absolute bottom-2 left-3 right-12 flex items-center gap-2 cursor-pointer z-10"
          onClick={acceptSug}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter") acceptSug(); }}
        >
          <span className="text-muted-foreground/50 text-sm truncate italic">{suggestion}</span>
          <Badge variant="outline" className="text-[9px] shrink-0">Tab ↵</Badge>
        </div>
      )}

      {/* Suggestion popover with multiple variants */}
      {showPopover && variants.length > 0 && (
        <div
          id="smart-textarea-popover"
          className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
        >
          <div className="p-2 space-y-1">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-[9px] uppercase text-muted-foreground font-semibold">
                Suggestions ({currentVariant + 1}/{variants.length})
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  disabled={currentVariant === 0}
                  onClick={() => setCurrentVariant(v => Math.max(0, v - 1))}
                >
                  <Icon name="ChevronLeft" className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  disabled={currentVariant === variants.length - 1}
                  onClick={() => setCurrentVariant(v => Math.min(variants.length - 1, v + 1))}
                >
                  <Icon name="ChevronRight" className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <div className="rounded-md bg-muted/50 p-2 text-xs text-foreground/90 leading-relaxed">
              {variants[currentVariant]}
            </div>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => setShowPopover(false)}
              >
                Dismiss
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={() => acceptVariant(variants[currentVariant])}
              >
                <Icon name="Check" className="w-3 h-3" /> Accept
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons (top-right corner) */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Smart suggestions trigger */}
        {value && value.length >= 10 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onShowSuggestions}
            disabled={status === "loading"}
            className="h-6 px-1.5 text-[10px] gap-1"
            title="Suggestions (Ctrl+Space)"
          >
            <Icon name="Lightbulb" className="w-3 h-3" />
          </Button>
        )}
        {/* Generate (when empty) */}
        {!value && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onGenerate}
            disabled={status === "loading"}
            className="h-6 px-2 text-[10px] gap-1 text-brand"
            title="AI generate"
          >
            {status === "loading"
              ? <Icon name="Loader2" className="w-3 h-3 animate-spin" />
              : <Icon name="Sparkles" className="w-3 h-3" />
            }
            Generate
          </Button>
        )}
        {/* Regenerate (when has value) */}
        {value && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRegen}
            disabled={status === "loading"}
            className="h-6 px-1.5 text-[10px] gap-1"
            title="Regenerate"
          >
            {status === "loading"
              ? <Icon name="Loader2" className="w-3 h-3 animate-spin" />
              : <Icon name="RefreshCw" className="w-3 h-3" />
            }
          </Button>
        )}
      </div>
    </div>
  );
}
