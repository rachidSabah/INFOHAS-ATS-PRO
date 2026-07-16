"use client";

// ============================================================================
// Phase 8.1.5 (P6) — Explainability UI.
// Renders buildExplainability(ci) evidence tree + the Decision trace from
// buildDecisionAnalytics. Read-only; no regeneration.
// ============================================================================

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { buildDecisionAnalytics } from "@/lib/recruiter/decision-analytics";
import { ExplainabilityTree } from "@/components/explainability/ExplainabilityTree";
import { useSessionIntelligence } from "@/components/recruiter/useSessionIntelligence";

export function Explainability() {
  const setView = useApp((s) => s.setView);
  const { sessions, selectedId, setSelectedId, ci } = useSessionIntelligence();

  if (sessions.length === 0 || !ci) {
    return (
      <div className="space-y-6">
        <Header onBack={() => setView("recruiter")} />
        <Card><CardContent className="p-10 text-center text-muted-foreground">
          <Icon name="ScanSearch" className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No interview to explain yet.</p>
        </CardContent></Card>
      </div>
    );
  }

  const decision = buildDecisionAnalytics({ ci });

  return (
    <div className="space-y-6">
      <Header onBack={() => setView("recruiter")} />

      {sessions.length > 1 && (
        <Card><CardContent className="p-4 flex flex-wrap gap-2">
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
              className={`px-3 py-1.5 rounded-lg border text-sm ${s.id === selectedId ? "border-brand bg-brand/10" : "border-border hover:bg-accent/50"}`}>
              {s.role ?? s.company ?? "Candidate"}
            </button>
          ))}
        </CardContent></Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Evidence Tree</CardTitle><CardDescription>Why every recommendation is made.</CardDescription></CardHeader>
          <CardContent><ExplainabilityTree ci={ci} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Decision Trace</CardTitle><CardDescription>{decision.reason}</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {decision.trace.length === 0 && <p className="text-sm text-muted-foreground">No decision trace recorded.</p>}
            {decision.trace.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${t.triggered ? "bg-brand" : "bg-muted-foreground/40"}`} />
                <span className="font-mono text-xs">{t.ruleId}</span>
                <span className="text-xs text-muted-foreground ml-auto uppercase">{t.status}</span>
              </div>
            ))}
            {decision.rules.length > 0 && (
              <div className="pt-2 mt-2 border-t border-border space-y-1">
                {decision.rules.map((r) => (
                  <div key={r.ruleId} className="text-xs">
                    <span className="font-medium">{r.ruleId}</span> · {r.reason}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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
        <h1 className="font-display text-2xl font-bold">Explainability</h1>
        <p className="text-sm text-muted-foreground">Evidence, decision trace & supporting data.</p>
      </div>
    </div>
  );
}
