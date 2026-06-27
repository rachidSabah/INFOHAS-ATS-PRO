"use client";

import { useState, useRef, useCallback } from "react";
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

export function SmartTextarea({ value, onChange, section, placeholder, className, resume, jobDescriptionText, context, rows=3, disabled }: SmartTextareaProps) {
  const [suggestion, setSuggestion] = useState("");
  const [status, setStatus] = useState<SuggestStatus>("idle");
  const debRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const callAI = async (prompt: string) => {
    try {
      const { ProviderRouter } = await import("@/lib/ai/services/router");
      const r = await ProviderRouter.chat({
        messages: [
          { role: "system", content: "You are a professional resume writer. Return ONLY the requested text." },
          { role: "user", content: prompt },
        ], maxTokens: 150, temperature: 0.7,
      }, { agentTask: "summary" });
      return (r.text||"").replace(/^["']|["']$/g,"").trim();
    } catch { return ""; }
  };

  const onType = useCallback((text: string) => {
    onChange(text); setSuggestion("");
    if (debRef.current) clearTimeout(debRef.current);
    if (text.length < 15) return;
    debRef.current = setTimeout(async () => {
      setStatus("loading");
      const prompt = section === "summary"
        ? 'Complete this resume summary: "' + text + '". Add 10-20 more words. Return ONLY the completion.'
        : section === "bullet"
        ? 'Complete this achievement bullet: "' + text + '". Add a metric. Return ONLY the completion.'
        : 'Suggest completion for: "' + text + '". Return ONLY the completion.';
      const sug = await callAI(prompt);
      if (sug && sug !== text) { setSuggestion(sug); setStatus("idle"); }
      else setStatus("idle");
    }, 1200);
  }, [onChange, section]);

  const acceptSug = () => { if (suggestion) { onChange(suggestion); setSuggestion(""); }};

  const onGenerate = async () => {
    setStatus("loading");
    const ctx = resume ? 'Name: '+(resume.name||'')+'. Role: '+(resume.experience?.[0]?.title||'') : '';
    const prompt = section === "summary"
      ? 'Generate a professional resume summary (60-80 words). ' + ctx + '. Return ONLY the summary.'
      : section === "bullet"
      ? 'Generate an achievement bullet for: ' + (context||'') + '. Start with action verb. 10-20 words.'
      : 'Generate content for ' + section + '. ' + ctx + '. Return ONLY the text.';
    const gen = await callAI(prompt);
    if (gen) { onChange(gen); toast.success(sectionLabel(section)+' generated'); }
    setStatus("idle");
  };

  const onRegen = async () => {
    if (!value) return;
    setStatus("loading");
    const prompt = 'Rewrite this to be more impactful: "' + value + '". Keep same length. Return ONLY the rewritten text.';
    const regen = await callAI(prompt);
    if (regen) { onChange(regen); toast.success(sectionLabel(section)+' regenerated'); }
    setStatus("idle");
  };

  return (
    <div className="relative group">
      <Textarea value={value} onChange={e => onType(e.target.value)} onKeyDown={e => { if (e.key==='Tab'&&suggestion){ e.preventDefault(); acceptSug(); }}}
        placeholder={placeholder||''} rows={rows} disabled={disabled} className={className} />
      {suggestion && status==="idle" && (
        <div className="absolute bottom-2 left-0 right-0 px-3 pointer-events-none flex items-center gap-2">
          <span className="text-muted-foreground/40 text-sm truncate">{suggestion}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">Tab to accept</Badge>
        </div>
      )}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!value && <Button variant="ghost" size="sm" onClick={onGenerate} disabled={status==="loading"}
          className="h-6 px-2 text-[10px] gap-1 text-brand" title="AI generate">
          {status==="loading"?<Icon name="Loader2" className="w-3 h-3 animate-spin"/>:<Icon name="Sparkles" className="w-3 h-3"/>}Generate</Button>}
        {value && <Button variant="ghost" size="sm" onClick={onRegen} disabled={status==="loading"}
          className="h-6 px-2 text-[10px] gap-1" title="Regenerate">
          <Icon name="RefreshCw" className="w-3 h-3"/></Button>}
      </div>
    </div>
  );
}
