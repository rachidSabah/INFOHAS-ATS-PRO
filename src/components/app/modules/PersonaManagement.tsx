"use client";

// ============================================================================
// Phase 8.1.5 (P8) — Persona Management (Super Admin).
// Renders the interviewer personas in an editable grid. The live list lives
// in the store and persists to D1 via the branding admin-settings blob
// (saveInterviewPersonas → PUT /api/settings/branding) so edits survive
// refresh; the view never re-implements interview logic.
// ============================================================================

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { api as cloudApi } from "@/lib/cloud-api";
import { INTERVIEW_PERSONAS, type InterviewPersona } from "@/lib/interview/personas";
import { toast } from "sonner";

export function PersonaManagement() {
  const setView = useApp((s) => s.setView);
  const savedPersonas = useApp((s) => s.interviewPersonas);
  const saveInterviewPersonas = useApp((s) => s.saveInterviewPersonas);
  // Local working copy — "Save Personas" commits it to the store + D1.
  const [personas, setPersonas] = useState<InterviewPersona[]>(savedPersonas);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(personas) !== JSON.stringify(savedPersonas);

  const update = (id: string, patch: Partial<InterviewPersona>) =>
    setPersonas((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const handleSave = async () => {
    setSaving(true);
    try {
      // Awaited PUT — the toast only shows once D1 actually has the data.
      await cloudApi.updateBranding({ interviewPersonas: personas });
      saveInterviewPersonas(personas); // store state (+ idempotent fire-and-forget sync)
      toast.success("Personas saved — they survive refresh now.");
    } catch {
      toast.error("Save failed — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setView("super-admin")} aria-label="Back">
          <Icon name="ArrowLeft" className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="font-display text-2xl font-bold">Persona Management</h1>
          <p className="text-sm text-muted-foreground">{personas.length} interviewer personas · click "Save Personas" to persist.</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="bg-brand hover:bg-brand-dark text-white gap-2"
        >
          <Icon name="Save" className="w-4 h-4" /> {saving ? "Saving…" : "Save Personas"}
        </Button>
      </div>
      {dirty && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-100/40 px-3 py-2 text-sm text-amber-800 dark:bg-amber-400/5 dark:text-amber-200">
          <Icon name="AlertTriangle" className="w-4 h-4 shrink-0" />
          You have unsaved changes. Click "Save Personas" to apply them everywhere.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {personas.map((p) => {
          const editing = editingId === p.id;
          return (
            <Card key={p.id}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${p.accent}1a`, color: p.accent }}>
                  <Icon name={p.icon as any} className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">{p.name}</CardTitle>
                  <CardDescription className="truncate">{p.role}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  <Badge>{p.category}</Badge>
                  {p.focusAreas.slice(0, 3).map((f) => <Badge key={f} variant="outline">{f}</Badge>)}
                </div>
                {editing ? (
                  <>
                    <label className="text-xs text-muted-foreground">Role</label>
                    <Input value={p.role} onChange={(e) => update(p.id, { role: e.target.value })} />
                    <label className="text-xs text-muted-foreground">Focus areas (comma separated)</label>
                    <Input
                      value={p.focusAreas.join(", ")}
                      onChange={(e) => update(p.id, { focusAreas: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                    />
                    <Button size="sm" className="w-full" onClick={() => setEditingId(null)}>Done</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setEditingId(p.id)}>
                    <Icon name="Pencil" className="w-4 h-4 mr-2" /> Edit
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
