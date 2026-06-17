"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { toast } from "sonner";
import type { PromptTemplate } from "@/lib/types";

const CATEGORIES = [
  { id: "resume", label: "Resume", icon: "FileText", color: "#1154A3" },
  { id: "ats", label: "ATS", icon: "ScanText", color: "#10B981" },
  { id: "rewrite", label: "Rewrite", icon: "RefreshCcw", color: "#F59E0B" },
  { id: "translation", label: "Translation", icon: "Languages", color: "#0EA5E9" },
  { id: "cover-letter", label: "Cover Letter", icon: "Mail", color: "#8B5CF6" },
  { id: "interview", label: "Interview", icon: "MessagesSquare", color: "#EC4899" },
  { id: "summary", label: "Summary", icon: "AlignLeft", color: "#1154A3" },
  { id: "bullets", label: "Bullets", icon: "List", color: "#F59E0B" },
  { id: "keywords", label: "Keywords", icon: "KeyRound", color: "#10B981" },
] as const;

export function Prompts() {
  const prompts = useApp((s) => s.prompts);
  const addPrompt = useApp((s) => s.addPrompt);
  const updatePrompt = useApp((s) => s.updatePrompt);
  const removePrompt = useApp((s) => s.removePrompt);
  const log = useApp((s) => s.log);

  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? prompts : prompts.filter((p) => p.category === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Brain" className="w-6 h-6 text-brand" /> Prompt Library</h1>
          <p className="text-sm text-muted-foreground mt-1">Versioned prompt templates for every AI feature. Edit, version, and activate.</p>
        </div>
        <Button onClick={() => setEditing({ id: uid("pt"), name: "", category: "resume", content: "", version: 1, isActive: true, variables: [] })} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name="Plus" className="w-4 h-4" /> New prompt
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter("all")} className={`px-3 py-1.5 rounded-full text-xs font-medium ${filter === "all" ? "bg-brand text-white" : "bg-secondary text-muted-foreground hover:bg-secondary/70"}`}>All ({prompts.length})</button>
        {CATEGORIES.map((c) => {
          const n = prompts.filter((p) => p.category === c.id).length;
          if (!n) return null;
          return (
            <button key={c.id} onClick={() => setFilter(c.id)} className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 ${filter === c.id ? "bg-brand text-white" : "bg-secondary text-muted-foreground hover:bg-secondary/70"}`}>
              <Icon name={c.icon} className="w-3 h-3" /> {c.label} ({n})
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {filtered.map((p) => {
          const cat = CATEGORIES.find((c) => c.id === p.category);
          return (
            <Card key={p.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${cat?.color ?? "#1154A3"}15`, color: cat?.color ?? "#1154A3" }}>
                      <Icon name={cat?.icon ?? "FileText"} className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{p.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{p.category} · v{p.version}</div>
                    </div>
                  </div>
                  {p.isActive && <Badge variant="success" className="text-[10px]"><Icon name="CheckCircle2" className="w-2.5 h-2.5" /> Active</Badge>}
                </div>
                <pre className="text-xs text-muted-foreground bg-secondary/50 p-3 rounded-md max-h-32 overflow-y-auto whitespace-pre-wrap font-sans">{p.content.slice(0, 300)}{p.content.length > 300 ? "…" : ""}</pre>
                {p.variables.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.variables.map((v) => <Badge key={v} variant="outline" className="text-[10px]">{`{{${v}}}`}</Badge>)}
                  </div>
                )}
                <div className="mt-3 flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)} className="gap-1.5"><Icon name="Pencil" className="w-3.5 h-3.5" /> Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => { updatePrompt(p.id, { isActive: !p.isActive }); toast.success(p.isActive ? "Deactivated" : "Activated"); }} className="gap-1.5"><Icon name={p.isActive ? "Power" : "Power"} className="w-3.5 h-3.5" /> {p.isActive ? "Deactivate" : "Activate"}</Button>
                  <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => { removePrompt(p.id); toast.success("Deleted."); }}><Icon name="Trash2" className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editing && (
        <PromptEditor
          prompt={editing}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            if (prompts.find((x) => x.id === editing.id)) {
              updatePrompt(editing.id, p);
              log({ actor: "you", action: `Updated prompt: ${p.name}`, category: "admin", details: `v${(editing.version + 1)}`, severity: "info" });
              toast.success("Prompt updated.");
            } else {
              addPrompt({ ...editing, ...p });
              log({ actor: "you", action: `Added prompt: ${p.name}`, category: "admin", details: p.category, severity: "info" });
              toast.success("Prompt added.");
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PromptEditor({ prompt, onClose, onSave }: { prompt: PromptTemplate; onClose: () => void; onSave: (p: Partial<PromptTemplate>) => void }) {
  const [form, setForm] = useState({
    name: prompt.name,
    category: prompt.category,
    content: prompt.content,
    variables: prompt.variables.join(", "),
    isActive: prompt.isActive,
  });
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-premium w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <h3 className="font-display font-bold text-lg">{prompt.name ? "Edit prompt" : "New prompt"}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><Icon name="X" className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ATS Resume Rewrite" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Category</Label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as any })} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm">
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Prompt content (use {"{{variable}}"} placeholders)</Label>
            <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={10} className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Variables (comma-separated)</Label>
            <Input value={form.variables} onChange={(e) => setForm({ ...form, variables: e.target.value })} placeholder="keywords, resume" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="prompt-active" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            <Label htmlFor="prompt-active" className="text-sm">Active (will be used by the AI)</Label>
          </div>
        </div>
        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave({ ...form, variables: form.variables.split(",").map((v) => v.trim()).filter(Boolean) })} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Save" className="w-4 h-4" /> Save prompt</Button>
        </div>
      </div>
    </div>
  );
}
