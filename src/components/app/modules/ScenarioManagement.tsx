"use client";

// ============================================================================
// Phase 8.1.5 (P8) — Scenario Management (Super Admin).
// Manages interview scenarios in session-local state (there is no scenario
// store yet — persistence is a follow-up). A scenario groups a role/company +
// difficulty + persona mix used to drive an interview. No interview logic here.
// ============================================================================

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { INTERVIEW_PERSONAS } from "@/lib/interview/personas";

interface Scenario {
  id: string;
  name: string;
  company: string;
  role: string;
  difficulty: "easy" | "medium" | "hard";
  personaIds: string[];
}

const SEED: Scenario[] = [
  { id: "sc-cabin-crew", name: "Cabin Crew — Emirates", company: "Emirates", role: "Cabin Crew", difficulty: "medium", personaIds: ["hr", "cabin-crew-manager", "safety-trainer"] },
  { id: "sc-swe", name: "Senior SWE — Big Tech", company: "Big Tech", role: "Senior Software Engineer", difficulty: "hard", personaIds: ["hr", "hiring-manager"] },
];

export function ScenarioManagement() {
  const setView = useApp((s) => s.setView);
  const [scenarios, setScenarios] = useState<Scenario[]>(SEED);
  const [draft, setDraft] = useState<Scenario | null>(null);

  const save = () => {
    if (!draft) return;
    setScenarios((s) => {
      const exists = s.some((x) => x.id === draft.id);
      return exists ? s.map((x) => (x.id === draft.id ? draft : x)) : [draft, ...s];
    });
    setDraft(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setView("super-admin")} aria-label="Back">
            <Icon name="ArrowLeft" className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-bold">Scenario Management</h1>
            <p className="text-sm text-muted-foreground">{scenarios.length} scenarios · edits are session-local.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setDraft({ id: uid("sc"), name: "", company: "", role: "", difficulty: "medium", personaIds: [] })}>
          <Icon name="Plus" className="w-4 h-4 mr-2" /> New scenario
        </Button>
      </div>

      {draft && (
        <Card>
          <CardHeader><CardTitle className="text-base">Edit scenario</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground">Name</label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><label className="text-xs text-muted-foreground">Company</label><Input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></div>
            <div><label className="text-xs text-muted-foreground">Role</label><Input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} /></div>
            <div>
              <label className="text-xs text-muted-foreground">Difficulty</label>
              <select value={draft.difficulty} onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as Scenario["difficulty"] })} className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                <option value="easy">easy</option><option value="medium">medium</option><option value="hard">hard</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Personas</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {INTERVIEW_PERSONAS.map((p) => {
                  const on = draft.personaIds.includes(p.id);
                  return (
                    <button key={p.id} onClick={() => setDraft({ ...draft, personaIds: on ? draft.personaIds.filter((x) => x !== p.id) : [...draft.personaIds, p.id] })}
                      className={`px-2.5 py-1 rounded-lg border text-xs ${on ? "border-brand bg-brand/10" : "border-border"}`}>
                      {p.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <Button size="sm" onClick={save}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scenarios.map((sc) => (
          <Card key={sc.id}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">{sc.name || "Untitled"}</CardTitle>
                <CardDescription>{sc.company} · {sc.role}</CardDescription>
              </div>
              <Badge>{sc.difficulty}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {sc.personaIds.map((id) => <Badge key={id} variant="outline">{id}</Badge>)}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraft(sc)}><Icon name="Pencil" className="w-4 h-4 mr-2" /> Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setScenarios((s) => s.filter((x) => x.id !== sc.id))}><Icon name="Trash2" className="w-4 h-4" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
