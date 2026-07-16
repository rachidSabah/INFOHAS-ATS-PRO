"use client";

// ============================================================================
// Phase 8.1.5 (P3) — Recruiter Intelligence Dashboard.
//
// PRESENTATION ONLY. Consumes the existing read-model:
//   buildCandidateIntelligence(input) + buildRecruiterDashboard(ci)
// under src/lib/recruiter/. No AI, no scoring, no competency recomputation.
// ============================================================================

import { useApp } from "@/lib/store";
import { buildRecruiterDashboard } from "@/lib/recruiter/candidate-intelligence";
import type { HiringRecommendation } from "@/lib/recruiter/recruiter-types";
import { CompetencyRadar } from "@/components/analytics/CompetencyRadar";
import { BehaviorBars } from "@/components/analytics/BehaviorBars";
import { ExplainabilityTree } from "@/components/explainability/ExplainabilityTree";
import { useSessionIntelligence } from "@/components/recruiter/useSessionIntelligence";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Icon } from "@/components/shared";

const RECO_COLOR: Record<HiringRecommendation, string> = {
  strong_hire: "#10B981",
  hire: "#22C55E",
  lean_hire: "#84CC16",
  hold: "#F59E0B",
  reject: "#DC2626",
};

export function RecruiterIntelligence() {
  const setView = useApp((s) => s.setView);
  const { sessions, selectedId, setSelectedId, activeSession, ci } = useSessionIntelligence();

  if (sessions.length === 0) {
    return (
      <div className="space-y-6">
        <Header onBack={() => setView("interview")} />
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Icon name="Inbox" className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No completed interviews yet.</p>
            <p className="text-xs mt-1">Run an interview session — its scored memory will appear here for recruiter review.</p>
            <Button className="mt-4" onClick={() => setView("interview")}>
              <Icon name="MessagesSquare" className="w-4 h-4 mr-2" /> Go to Interview Prep
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ci || !activeSession) {
    return (
      <div className="space-y-6">
        <Header onBack={() => setView("interview")} />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const dash = buildRecruiterDashboard(ci);
  const reco = dash.hiringRecommendation;

  return (
    <div className="space-y-6">
      <Header onBack={() => setView("interview")} />

      {/* Candidate list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidates ({sessions.length})</CardTitle>
          <CardDescription>Completed interview sessions with scored memory.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {sessions.map((s) => {
            const active = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`px-3 py-2 rounded-xl border text-left text-sm transition-colors ${
                  active ? "border-brand bg-brand/10" : "border-border hover:bg-accent/50"
                }`}
              >
                <div className="font-medium">{s.role ?? s.company ?? "Candidate"}</div>
                <div className="text-xs text-muted-foreground">{s.company ?? "—"}</div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* Top-line dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-display text-xl font-bold">{ci.candidate.name ?? activeSession?.role ?? "Candidate"}</h2>
                <p className="text-sm text-muted-foreground">
                  {ci.candidate.role ?? activeSession?.role} · {ci.candidate.company ?? activeSession?.company ?? "—"}
                </p>
              </div>
              <span
                className="px-2.5 py-1 rounded-full text-xs font-semibold border"
                style={{ background: `${RECO_COLOR[reco]}1a`, color: RECO_COLOR[reco], borderColor: `${RECO_COLOR[reco]}55` }}
              >
                {reco.replace("_", " ").toUpperCase()}
              </span>
            </div>
            <p className="text-sm mt-3 text-pretty">{dash.candidateOverview}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
              <Metric label="Overall" value={ci.overall} suffix="/100" />
              <Metric label="Interview" value={dash.interviewScore} suffix="/100" />
              <Metric label="Resume" value={dash.resumeScore} suffix="/100" />
              <Metric label="ATS Match" value={dash.atsMatch} suffix="/100" />
              <Metric label="Company" value={dash.companyMatch} suffix="/100" />
              <Metric label="Confidence" value={dash.hiringConfidence} suffix="%" />
              <Metric label="Risk" value={dash.overallRisk} suffix="/100" />
              <Metric label="Employer Pass" value={ci.employerPassLikelihood} suffix="/100" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DecisionPill status={ci.decision.status} />
            <div className="text-xs text-muted-foreground">
              <div>Confidence: {(ci.decision.confidence != null ? Math.round(ci.decision.confidence * 100) : 0)}%</div>
              <div className="mt-1">{ci.decision.reason || "No decision recorded."}</div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setView("explainability")}>
              <Icon name="ScanSearch" className="w-4 h-4 mr-2" /> Explainability
            </Button>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setView("interview-reports")}>
              <Icon name="FileText" className="w-4 h-4 mr-2" /> Executive Report
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Detail tabs */}
      <Tabs defaultValue="competencies">
        <TabsList className="flex-wrap">
          <TabsTrigger value="competencies">Competencies</TabsTrigger>
          <TabsTrigger value="behavior">Behavior</TabsTrigger>
          <TabsTrigger value="match">Company / ATS</TabsTrigger>
          <TabsTrigger value="explain">Explainability</TabsTrigger>
        </TabsList>

        <TabsContent value="competencies" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Competency Radar</CardTitle></CardHeader>
              <CardContent><CompetencyRadar ci={ci} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Competency Detail</CardTitle></CardHeader>
              <CardContent className="space-y-2 max-h-[360px] overflow-auto">
                {Object.entries(ci.competencySummary).map(([key, c]) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-40 text-sm truncate">{key}</div>
                    <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${c.score}%` }} />
                    </div>
                    <div className="w-10 text-right text-sm font-medium">{c.score}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="behavior" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Behavioral Intelligence (16 dimensions)</CardTitle></CardHeader>
            <CardContent><BehaviorBars behavior={ci.behavior} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="match" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Company Match</CardTitle></CardHeader>
              <CardContent>
                {ci.companyMatch ? (
                  <div className="space-y-2">
                    <div className="text-2xl font-bold">{ci.companyMatch.overallCompanyReadiness}/100</div>
                    <div className="text-sm text-muted-foreground">{ci.companyMatch.reasoning}</div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No company profile supplied.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">ATS Match</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{ci.ats.atsScore ?? ci.ats.jdMatchPercent ?? 0}/100</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {ci.ats.weakSections.length
                    ? `Weak sections: ${ci.ats.weakSections.join(", ")}`
                    : "No weak sections flagged."}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="explain" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Evidence & Explainability</CardTitle></CardHeader>
            <CardContent><ExplainabilityTree ci={ci} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to interview">
        <Icon name="ArrowLeft" className="w-4 h-4" />
      </Button>
      <div>
        <h1 className="font-display text-2xl font-bold">Recruiter Intelligence</h1>
        <p className="text-sm text-muted-foreground">Candidate read-model · built from interview execution data.</p>
      </div>
    </div>
  );
}

function Metric({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}{suffix}</div>
    </div>
  );
}

function DecisionPill({ status }: { status?: string }) {
  const color = status === "accept" ? "#10B981" : status === "reject" || status === "escalate" ? "#DC2626" : status === "retry" ? "#F59E0B" : "#6B7280";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color }}>
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {status ? status.toUpperCase() : "NO DECISION"}
    </span>
  );
}
