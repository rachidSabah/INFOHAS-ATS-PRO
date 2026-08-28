"use client";

// ============================================================================
// Pipeline Trajectory Panel — per-node agentic observability (item #10).
//
// Shows the live agent/pipeline event stream from the global event bus:
// every pipeline node (optimizer / output-validator / assembler / guardian /
// a4-layout-gate / progressive stages), healing events and agent actions,
// each with a status chip, duration, and expandable metadata.
//
// Visual language mirrors ProviderHealthPanel (chips with colored dots,
// brand-tinted card, collapsible rows) so the surfaces read as one system.
// ============================================================================

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/shared";
import { Icon } from "@/components/shared";
import { useTrajectory, useClearTrajectory } from "@/hooks/useTrajectory";
import type { AgentEvent } from "@/lib/agent-event-bus";

const CHIP_SUCCESS = "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
const CHIP_FAILURE = "bg-red-500/10 text-red-600 border-red-500/30";
const CHIP_NEUTRAL = "bg-sky-500/10 text-sky-600 border-sky-500/30";

function chipForEvent(e: AgentEvent): { label: string; cls: string } {
  if (e.success === false) return { label: "FAILED", cls: CHIP_FAILURE };
  const a = e.action || "";
  if (a.includes("failed")) return { label: "FAILED", cls: CHIP_FAILURE };
  if (a.includes("salvage") || a.includes("recovered") || a.includes("repair")) return { label: "RECOVERED", cls: CHIP_NEUTRAL };
  if (a.includes("started")) return { label: "RUNNING", cls: CHIP_NEUTRAL };
  return { label: "OK", cls: CHIP_SUCCESS };
}

function fmtDuration(e: AgentEvent): string {
  const d = e.duration ?? 0;
  if (!d) return "—";
  return d >= 1000 ? `${(d / 1000).toFixed(1)}s` : `${d}ms`;
}

export function PipelineTrajectoryPanel() {
  const { eventsNewestFirst, stats } = useTrajectory(80);
  const clear = useClearTrajectory();
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const failureRate = stats.totalEvents > 0 ? Math.round(((stats.totalEvents - stats.successfulEvents) / stats.totalEvents) * 100) : 0;

  return (
    <Card className="border-brand/20" data-trajectory-panel>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icon name="Waypoints" className="w-4 h-4 text-brand" /> Pipeline Trajectory — per-node observability
        </CardTitle>
        <CardDescription className="text-xs">
          Live agent trace: every pipeline node, healing round and progressive stage with status, duration and metadata — the same trajectory the engine logs, readable while it runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">{stats.totalEvents} events</Badge>
          <Badge variant="outline" className="text-[10px]">{stats.successfulEvents} ok</Badge>
          <Badge variant="outline" className="text-[10px]">{stats.totalEvents - stats.successfulEvents} failed</Badge>
          <Badge variant="outline" className="text-[10px]">failure rate {failureRate}%</Badge>
          <button className="ml-auto text-[10px] text-muted-foreground underline" onClick={clear}>Clear trace</button>
        </div>

        {eventsNewestFirst.length === 0 ? (
          <div className="rounded-lg border border-border/60 px-2.5 py-2 text-[11px] text-muted-foreground">
            No events yet — run an optimization to see the per-node trajectory here.
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 divide-y divide-border/60 max-h-72 overflow-y-auto">
            {eventsNewestFirst.map((e, i) => {
              const chip = chipForEvent(e);
              const meta = e.metadata && Object.keys(e.metadata).length > 0 ? e.metadata : null;
              return (
                <div key={`${e.timestamp}-${i}`} className="px-2.5 py-1.5 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${chip.cls}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" /> {chip.label}
                    </span>
                    <span className="font-semibold">{e.agent}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{e.action}</span>
                    <span className="text-[10px] text-muted-foreground">{fmtDuration(e)}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ""}</span>
                  </div>
                  {meta && (
                    <div>
                      <button
                        className="text-[10px] text-muted-foreground underline flex items-center gap-1"
                        onClick={() => setExpanded((s) => ({ ...s, [i]: !s[i] }))}
                      >
                        <Icon name={expanded[i] ? "ChevronDown" : "ChevronRight"} className="w-3 h-3" /> Details
                      </button>
                      {expanded[i] && (
                        <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-slate-900 text-slate-100 p-2 font-mono text-[10px] max-h-24 overflow-y-auto">
                          {JSON.stringify(meta, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
