"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { usePipelineContext } from "@/hooks/usePipelineContext";
import type { AgentState } from "@/lib/agents/pipeline-context";

/**
 * PipelineDashboard — visualizes the status of every agent in the Unified AI
 * Career Operating System (V3).
 *
 * Shows:
 *   - The shared context (active resume, JD, company, industry, ATS score)
 *   - Every agent's status (pending / running / completed / failed / cached / skipped)
 *   - Duration + last log line for each agent
 *   - Recent pipeline events
 *
 * This is a read-only visualization — it doesn't trigger any agents. Agents
 * are triggered by user actions (upload resume, parse JD, optimize, etc.)
 * via the Supervisor's event handlers.
 */
export function PipelineDashboard() {
  const { context, agents, events, isRunning, activeResume, activeJD } = usePipelineContext();

  const agentList = Object.values(agents);
  const completed = agentList.filter((a) => a.status === "completed" || a.status === "cached").length;
  const failed = agentList.filter((a) => a.status === "failed").length;
  const running = agentList.filter((a) => a.status === "running").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-2 border-brand/20 bg-gradient-to-br from-brand/5 to-purple-500/5 dark:from-brand/10 dark:to-purple-500/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Icon name="Cpu" className={`w-5 h-5 text-brand ${isRunning ? "animate-pulse" : ""}`} />
                AI Career Operating System
                {isRunning && <Badge variant="brand" className="text-[10px] animate-pulse">Running</Badge>}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Unified pipeline · {completed} agents completed · {running} running · {failed} failed
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {context.atsScore !== null && (
                <Badge variant="outline" className="gap-1">
                  <Icon name="ShieldCheck" className="w-3 h-3" /> ATS {context.atsScore}
                </Badge>
              )}
              {context.matchScore !== null && (
                <Badge variant="outline" className="gap-1">
                  <Icon name="Target" className="w-3 h-3" /> Match {context.matchScore}%
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Active context badges */}
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            {activeResume && <Badge variant="brand">Resume: {activeResume.name}</Badge>}
            {activeJD && <Badge variant="outline">JD: {activeJD.title}</Badge>}
            {context.companyName && <Badge variant="outline">Company: {context.companyName}</Badge>}
            {context.industry && <Badge variant="outline">Industry: {context.industry}</Badge>}
            {context.optimizedResume && <Badge variant="success">Optimized: {context.optimizedResume.name}</Badge>}
            {!activeResume && !activeJD && <span className="text-muted-foreground italic">No active context — upload a resume or parse a JD to activate the pipeline.</span>}
          </div>
        </CardContent>
      </Card>

      {/* Agent grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {agentList.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

      {/* Recent events */}
      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Activity" className="w-4 h-4 text-brand" /> Recent Pipeline Events
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {events.slice(0, 10).map((event, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[9px] shrink-0">{event.type}</Badge>
                  <span className="text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentState }) {
  const statusConfig = {
    pending: { color: "#94A3B8", bg: "bg-muted/30", icon: "Circle" },
    running: { color: "#1154A3", bg: "bg-brand/10", icon: "Loader2" },
    completed: { color: "#10B981", bg: "bg-emerald-500/10", icon: "CheckCircle2" },
    failed: { color: "#DC2626", bg: "bg-red-500/10", icon: "AlertCircle" },
    skipped: { color: "#94A3B8", bg: "bg-muted/30", icon: "MinusCircle" },
    cached: { color: "#8B5CF6", bg: "bg-purple-500/10", icon: "Database" },
  };
  const cfg = statusConfig[agent.status] ?? statusConfig.pending;

  return (
    <div className={`rounded-lg border border-border ${cfg.bg} p-3 transition-all`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon
          name={agent.status === "running" ? "Loader2" : cfg.icon}
          className={`w-3.5 h-3.5 ${agent.status === "running" ? "animate-spin" : ""}`}
          style={{ color: cfg.color }}
        />
        <span className="text-xs font-semibold truncate flex-1">{agent.name}</span>
        {agent.cached && <Badge variant="outline" className="text-[8px] px-1 py-0">cached</Badge>}
      </div>
      <div className="text-[10px] font-medium" style={{ color: cfg.color }}>
        {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
      </div>
      {agent.durationMs && (
        <div className="text-[9px] text-muted-foreground mt-0.5">{(agent.durationMs / 1000).toFixed(1)}s</div>
      )}
      {agent.log && (
        <div className="text-[9px] text-muted-foreground mt-1 line-clamp-2">{agent.log}</div>
      )}
      {agent.error && (
        <div className="text-[9px] text-red-500 mt-1 line-clamp-2">{agent.error}</div>
      )}
    </div>
  );
}
