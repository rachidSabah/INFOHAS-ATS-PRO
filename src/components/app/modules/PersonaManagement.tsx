"use client";

// ============================================================================
// Phase 8.1.5 (P8) — Persona Management (Super Admin).
// Renders the existing INTERVIEW_PERSONAS in an editable grid. Edits live in
// local state (persistence into the store/config is a follow-up); the view
// consumes the existing persona data and never re-implements interview logic.
// ============================================================================

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { INTERVIEW_PERSONAS, type InterviewPersona } from "@/lib/interview/personas";

export function PersonaManagement() {
  const setView = useApp((s) => s.setView);
  const [personas, setPersonas] = useState<InterviewPersona[]>(() => INTERVIEW_PERSONAS.map((p) => ({ ...p })));
  const [editingId, setEditingId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<InterviewPersona>) =>
    setPersonas((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setView("super-admin")} aria-label="Back">
          <Icon name="ArrowLeft" className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="font-display text-2xl font-bold">Persona Management</h1>
          <p className="text-sm text-muted-foreground">{personas.length} interviewer personas · edits are session-local.</p>
        </div>
      </div>

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
