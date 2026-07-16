"use client";

// ============================================================================
// Phase 8.1.5 (P5) — Interview Analytics Visualizations.
// Consumes CandidateIntelligence + benchmarkCandidates + computeDecisionMetrics.
// Pure presentation — all numbers come from src/lib/recruiter + src/lib/ai/*.
// ============================================================================

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { buildCompetencyAnalytics } from "@/lib/recruiter/competency-analytics";
import { benchmarkCandidates } from "@/lib/recruiter/benchmark";
import { computeDecisionMetrics } from "@/lib/ai/decision-metrics";
import { CompetencyRadar } from "@/components/analytics/CompetencyRadar";
import { CompetencyHeatmap } from "@/components/analytics/CompetencyHeatmap";
import { DecisionDistribution } from "@/components/analytics/DecisionDistribution";
import { BenchmarkChart } from "@/components/analytics/BenchmarkChart";
import { useSessionIntelligence } from "@/components/recruiter/useSessionIntelligence";

export function InterviewAnalytics() {
  const setView = useApp((s) => s.setView);
  const flightRecords = useApp((s) => s.flightRecords);
  const { sessions, selectedId, setSelectedId, activeSession, ci } = useSessionIntelligence();

  const analytics = useMemo(() => (ci ? buildCompetencyAnalytics(ci) : null), [ci]);
  const benchmark = useMemo(
    () => (ci ? benchmarkCandidates([ci], "company") : null),
    [ci],
  );
  const metrics = useMemo(() => computeDecisionMetrics(flightRecords), [flightRecords]);

  if (sessions.length === 0 || !ci) {
    return (
      <div className="space-y-6">
        <Header onBack={() => setView("recruiter")} />
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Icon name="BarChart3" className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No interview data to visualize yet.</p>
            <Button className="mt-4" onClick={() => setView("interview")}>
              <Icon name="MessagesSquare" className="w-4 h-4 mr-2" /> Go to Interview Prep
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header onBack={() => setView("recruiter")} />

      {sessions.length > 1 && (
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`px-3 py-1.5 rounded-lg border text-sm ${s.id === selectedId ? "border-brand bg-brand/10" : "border-border hover:bg-accent/50"}`}
              >
                {s.role ?? s.company ?? "Candidate"}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Competency Radar</CardTitle></CardHeader>
          <CardContent><CompetencyRadar ci={ci} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Competency Heatmap</CardTitle></CardHeader>
          <CardContent><CompetencyHeatmap ci={ci} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Decision Distribution (session)</CardTitle><CardDescription>{metrics.totalDecisions} executions</CardDescription></CardHeader>
          <CardContent><DecisionDistribution metrics={metrics} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Benchmark vs Cohort</CardTitle><CardDescription>Grouped by company</CardDescription></CardHeader>
          <CardContent>{benchmark && <BenchmarkChart result={benchmark} />}</CardContent>
        </Card>
      </div>

      {analytics && (
        <Card>
          <CardHeader><CardTitle className="text-base">Score Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              {analytics.scoreDistribution.map((b, i) => (
                <div key={i} className="rounded-lg border border-border px-3 py-2 text-center">
                  <div className="text-lg font-bold">{b}</div>
                  <div className="text-xs text-muted-foreground">{(i * 20) + 1}–{(i + 1) * 20}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Strongest: {analytics.strongest.join(", ") || "—"} · Weakest: {analytics.weakest.join(", ") || "—"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to recruiter">
        <Icon name="ArrowLeft" className="w-4 h-4" />
      </Button>
      <div>
        <h1 className="font-display text-2xl font-bold">Competency Analytics</h1>
        <p className="text-sm text-muted-foreground">Interview intelligence visualizations.</p>
      </div>
    </div>
  );
}
