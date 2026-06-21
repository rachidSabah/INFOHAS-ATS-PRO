"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { usePipelineContext } from "@/hooks/usePipelineContext";
import type { AgentState } from "@/lib/agents/pipeline-context";
import { loadTimeline, loadMetrics, getPipelineSuccessRate, getAveragePipelineDuration, type TimelineEntry, type MetricsMap } from "@/lib/agents/persistence";
import { useState, useEffect } from "react";

/**
 * PipelineDashboard — visualizes the status of every agent in the Unified AI
 * Career Operating System (V3).
 *
 * Shows:
 *   - The shared context (active resume, JD, company, industry, ATS score)
 *   - Every agent's status (pending / running / completed / failed / cached / skipped)
 *   - Duration + last log line for each agent
 *   - Recent pipeline events
 *   - Execution timeline (start/complete/retry/fail/recover events)
 *   - Aggregate metrics (success rate, avg duration, retry count, failure count)
 *   - Recovery indicator (if the pipeline was restored from a snapshot)
 */
export function PipelineDashboard() {
  const { context, agents, events, isRunning, activeResume, activeJD } = usePipelineContext();
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricsMap>({});

  // Load timeline + metrics from localStorage on mount + every 2s while running
  useEffect(() => {
    const refresh = () => {
      setTimeline(loadTimeline());
      setMetrics(loadMetrics());
    };
    refresh();
    if (isRunning) {
      const interval = setInterval(refresh, 2000);
      return () => clearInterval(interval);
    }
  }, [isRunning]);

  const agentList = Object.values(agents);
  const completed = agentList.filter((a) => a.status === "completed" || a.status === "cached").length;
  const failed = agentList.filter((a) => a.status === "failed").length;
  const running = agentList.filter((a) => a.status === "running").length;
  const successRate = getPipelineSuccessRate(metrics);
  const avgDuration = getAveragePipelineDuration(metrics);
  const totalRetries = Object.values(metrics).reduce((sum, m) => sum + m.retries, 0);
  const totalFailures = Object.values(metrics).reduce((sum, m) => sum + m.failures, 0);

  // Check if any agent was recovered (has "Recovered from snapshot" in its log)
  const recoveredAgents = agentList.filter((a) => a.log?.includes("Recovered from snapshot"));

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-2 border-brand/20 bg-gradient-to-br from-brand/5 to-emerald-500/5 dark:from-brand/10 dark:to-emerald-500/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Icon name="Cpu" className={`w-5 h-5 text-brand ${isRunning ? "animate-pulse" : ""}`} />
                AI Career Operating System
                {isRunning && <Badge variant="brand" className="text-[10px] animate-pulse">Running</Badge>}
                {recoveredAgents.length > 0 && (
                  <Badge variant="warning" className="text-[10px] gap-1">
                    <Icon name="RefreshCw" className="w-3 h-3" /> Recovered
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Unified pipeline · {completed} completed · {running} running · {failed} failed
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
          {/* Recovery notice */}
          {recoveredAgents.length > 0 && (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-2 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
              <Icon name="Info" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <strong>Pipeline recovered from snapshot.</strong> {recoveredAgents.length} agent(s) were running when the page was refreshed and have been reset to Pending. Re-run the optimizer to resume.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metrics row */}
      {(successRate > 0 || avgDuration > 0 || totalRetries > 0 || totalFailures > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard icon="TrendingUp" label="Success Rate" value={`${successRate}%`} color={successRate >= 80 ? "#10B981" : successRate >= 50 ? "#F59E0B" : "#DC2626"} />
          <MetricCard icon="Clock" label="Avg Duration" value={avgDuration > 0 ? `${(avgDuration / 1000).toFixed(1)}s` : "—"} color="#1154A3" />
          <MetricCard icon="RefreshCw" label="Total Retries" value={String(totalRetries)} color={totalRetries > 0 ? "#F59E0B" : "#10B981"} />
          <MetricCard icon="AlertCircle" label="Total Failures" value={String(totalFailures)} color={totalFailures > 0 ? "#DC2626" : "#10B981"} />
        </div>
      )}

      {/* Agent grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {agentList.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

      {/* Execution timeline */}
      {timeline.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Activity" className="w-4 h-4 text-brand" /> Execution Timeline
              <Badge variant="outline" className="text-[9px] ml-auto">{timeline.length} events</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {timeline.slice(-30).reverse().map((entry, i) => (
                <TimelineRow key={i} entry={entry} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent events */}
      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Zap" className="w-4 h-4 text-brand" /> Recent Pipeline Events
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

function MetricCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        <Icon name={icon} className="w-4 h-4 shrink-0" style={{ color }} />
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
          <div className="text-sm font-bold" style={{ color }}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const eventConfig: Record<string, { color: string; icon: string }> = {
    start: { color: "#1154A3", icon: "Play" },
    complete: { color: "#10B981", icon: "CheckCircle2" },
    retry: { color: "#F59E0B", icon: "RefreshCw" },
    fail: { color: "#DC2626", icon: "AlertCircle" },
    recover: { color: "#8B5CF6", icon: "RotateCcw" },
    "cache-hit": { color: "#6B7280", icon: "Database" },
  };
  const cfg = eventConfig[entry.event] ?? eventConfig.start;
  return (
    <div className="flex items-start gap-2 text-[11px] py-1 border-b border-border/50 last:border-0">
      <Icon name={cfg.icon} className="w-3 h-3 shrink-0 mt-0.5" style={{ color: cfg.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{entry.agentName}</span>
          <span className="text-[9px] uppercase shrink-0" style={{ color: cfg.color }}>{entry.event}</span>
          {entry.durationMs && <span className="text-muted-foreground text-[9px] shrink-0">{(entry.durationMs / 1000).toFixed(1)}s</span>}
        </div>
        <div className="text-muted-foreground truncate">{entry.message}</div>
      </div>
      <span className="text-muted-foreground text-[9px] shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
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
