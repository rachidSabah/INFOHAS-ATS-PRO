/**
 * ============================================================================
 * AgentConsole — Real-time streaming agentic thought viewer
 * ============================================================================
 * 
 * A premium UI component that renders AgentBrain thought streams in real-time,
 * showing the agent's reasoning, tool calls, observations, and decisions —
 * exactly like Claude's "Extended Thinking" or Gemini's "Deep Research" UI.
 * 
 * Used by: AICopilotPanel, Optimizer, Builder
 * ============================================================================
 */

"use client";

import React, { useRef, useEffect } from "react";
import { Icon } from "@/components/shared";
import type { AgentThought, AgentThoughtType } from "@/lib/agent-brain";

interface AgentConsoleProps {
  thoughts: AgentThought[];
  isRunning: boolean;
  atsScoreBefore?: number;
  atsScoreAfter?: number;
  improvements?: string[];
  compact?: boolean; // true = fits inside the copilot panel
}

const TYPE_CONFIG: Record<
  AgentThoughtType,
  { icon: string; color: string; bg: string; label: string }
> = {
  thinking:    { icon: "Brain",          color: "text-violet-400",  bg: "bg-violet-950/40 border-violet-800/40",  label: "Thinking" },
  planning:    { icon: "ListOrdered",    color: "text-blue-400",    bg: "bg-blue-950/40 border-blue-800/40",      label: "Planning" },
  tool_call:   { icon: "Wrench",         color: "text-amber-400",   bg: "bg-amber-950/40 border-amber-800/40",    label: "Tool Call" },
  observation: { icon: "Eye",            color: "text-emerald-400", bg: "bg-emerald-950/40 border-emerald-800/40",label: "Observation" },
  reflection:  { icon: "RefreshCcw",     color: "text-cyan-400",    bg: "bg-cyan-950/40 border-cyan-800/40",      label: "Reflection" },
  decision:    { icon: "GitBranch",      color: "text-orange-400",  bg: "bg-orange-950/40 border-orange-800/40",  label: "Decision" },
  patch:       { icon: "FileEdit",       color: "text-indigo-400",  bg: "bg-indigo-950/40 border-indigo-800/40",  label: "Patch Applied" },
  complete:    { icon: "CheckCircle2",   color: "text-emerald-400", bg: "bg-emerald-950/40 border-emerald-800/40",label: "Complete" },
  error:       { icon: "AlertTriangle",  color: "text-rose-400",    bg: "bg-rose-950/40 border-rose-800/40",      label: "Error" },
};

function ThoughtRow({ thought, compact }: { thought: AgentThought; compact?: boolean }) {
  const cfg = TYPE_CONFIG[thought.type] ?? TYPE_CONFIG.thinking;

  if (compact && thought.type === "thinking" && thought.text.length > 80) {
    return (
      <div className={`flex items-start gap-2 p-2 rounded-lg border text-[10px] ${cfg.bg}`}>
        <Icon name={cfg.icon} className={`w-3 h-3 shrink-0 mt-0.5 ${cfg.color}`} />
        <span className={`${cfg.color} opacity-80 leading-relaxed line-clamp-2`}>{thought.text}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg border ${cfg.bg} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
      <Icon name={cfg.icon} className={`w-3 h-3 shrink-0 mt-0.5 ${cfg.color}`} />
      <div className="flex-1 min-w-0">
        {!compact && (
          <div className={`text-[9px] font-bold uppercase tracking-wider ${cfg.color} mb-0.5`}>
            {cfg.label}{thought.toolName ? ` → ${thought.toolName}` : ""}
          </div>
        )}
        <p className="text-[10px] text-slate-300 leading-relaxed">{thought.text}</p>
      </div>
    </div>
  );
}

export function AgentConsole({
  thoughts,
  isRunning,
  atsScoreBefore,
  atsScoreAfter,
  improvements = [],
  compact = false,
}: AgentConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new thoughts arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thoughts.length]);

  if (thoughts.length === 0 && !isRunning) return null;

  const scoreGain =
    atsScoreBefore != null && atsScoreAfter != null
      ? atsScoreAfter - atsScoreBefore
      : null;

  return (
    <div className={`space-y-2 ${compact ? "" : "w-full"}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
            </span>
          ) : (
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          )}
          <span className={`${compact ? "text-[9px]" : "text-[10px]"} uppercase font-bold tracking-wider text-slate-400`}>
            {isRunning ? "Agent Thinking..." : "Agent Complete"}
          </span>
        </div>
        {scoreGain != null && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${scoreGain >= 0 ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>
            {scoreGain >= 0 ? "+" : ""}{scoreGain} ATS pts
          </span>
        )}
      </div>

      {/* Thought stream */}
      <div
        ref={scrollRef}
        className={`space-y-1 overflow-y-auto scrollbar-thin ${compact ? "max-h-[220px]" : "max-h-[400px]"}`}
      >
        {thoughts.map((t) => (
          <ThoughtRow key={t.id} thought={t} compact={compact} />
        ))}
        {isRunning && (
          <div className="flex items-center gap-2 p-2 rounded-lg border bg-violet-950/20 border-violet-800/30">
            <Icon name="Loader2" className="w-3 h-3 animate-spin text-violet-400" />
            <span className="text-[10px] text-violet-300 animate-pulse">Processing...</span>
          </div>
        )}
      </div>

      {/* Improvements summary */}
      {!isRunning && improvements.length > 0 && (
        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Applied Improvements</span>
          <ul className="space-y-0.5">
            {improvements.map((imp, i) => (
              <li key={i} className="text-[10px] text-slate-300 flex items-start gap-1.5">
                <Icon name="Check" className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                {imp}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
