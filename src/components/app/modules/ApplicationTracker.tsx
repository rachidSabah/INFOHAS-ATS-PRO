// ============================================================================
// Application Tracker — per-user Kanban CRM for job applications.
// ============================================================================
// Replaces the old in-memory AppTracker stub (CareerTools.tsx): everything is
// now persisted through the ApplicationsSlice → Workers API → D1 with strict
// per-user isolation, crash-recovery backups (userScopedKey), status history,
// and follow-up reminders. Domain logic lives in src/lib/applications-logic.ts
// (unit-tested); this file is presentation + wiring only.

"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/shared";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import {
  APPLICATION_COLUMNS,
  APPLICATION_STATUS_LABELS,
  computeStats,
  daysSinceApplied,
  dueFollowUps,
  isFollowUpDue,
  type ApplicationRecord,
  type ApplicationStatus,
} from "@/lib/applications-logic";

// ---------------------------------------------------------------------------
// Date helpers (form <input type="date"> ↔ ISO)
// ---------------------------------------------------------------------------

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Column / card accents
// ---------------------------------------------------------------------------

const COLUMN_ACCENT: Record<ApplicationStatus, string> = {
  wishlist: "text-muted-foreground",
  applied: "text-sky-600",
  "phone-screen": "text-amber-600",
  interview: "text-violet-600",
  offer: "text-emerald-600",
  rejected: "text-rose-600",
};

const COLUMN_DOT: Record<ApplicationStatus, string> = {
  wishlist: "bg-slate-400",
  applied: "bg-sky-500",
  "phone-screen": "bg-amber-500",
  interview: "bg-violet-500",
  offer: "bg-emerald-500",
  rejected: "bg-rose-500",
};

// ---------------------------------------------------------------------------
// Form state shared by Add + Edit dialogs
// ---------------------------------------------------------------------------

interface FormState {
  company: string;
  role: string;
  status: ApplicationStatus;
  source: string;
  url: string;
  location: string;
  salary: string;
  resumeId: string;
  notes: string;
  appliedAt: string;      // yyyy-mm-dd
  nextActionAt: string;   // yyyy-mm-dd
  nextActionNote: string;
}

function toFormState(a: ApplicationRecord | null): FormState {
  return {
    company: a?.company ?? "",
    role: a?.role ?? "",
    status: a?.status ?? "wishlist",
    source: a?.source ?? "",
    url: a?.url ?? "",
    location: a?.location ?? "",
    salary: a?.salary ?? "",
    resumeId: a?.resumeId ?? "",
    notes: a?.notes ?? "",
    appliedAt: isoToDateInput(a?.appliedAt ?? null),
    nextActionAt: isoToDateInput(a?.nextActionAt ?? null),
    nextActionNote: a?.nextActionNote ?? "",
  };
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export function ApplicationTracker() {
  const applications = useApp((s) => s.applications);
  const addApplication = useApp((s) => s.addApplication);
  const updateApplication = useApp((s) => s.updateApplication);
  const moveApplication = useApp((s) => s.moveApplication);
  const removeApplication = useApp((s) => s.removeApplication);
  const dismissFollowUp = useApp((s) => s.dismissFollowUp);
  const resumes = useApp((s) => s.resumes);
  const jobDescriptions = useApp((s) => s.jobDescriptions);
  const log = useApp((s) => s.log);

  const [query, setQuery] = useState("");
  const [dragOverCol, setDragOverCol] = useState<ApplicationStatus | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const stats = useMemo(() => computeStats(applications), [applications]);
  const followUps = useMemo(() => dueFollowUps(applications), [applications]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter((a) =>
      [a.company, a.role, a.location, a.source, a.notes].some((f) => f.toLowerCase().includes(q))
    );
  }, [applications, query]);

  const addDialogOpen = addOpen || editingId !== null;
  const editing = editingId ? applications.find((a) => a.id === editingId) ?? null : null;
  const closeDialog = () => { setAddOpen(false); setEditingId(null); };

  const handleSubmit = (form: FormState) => {
    if (!form.company.trim() || !form.role.trim()) {
      toast.error("Company and role are required.");
      return;
    }
    const payload = {
      company: form.company.trim(),
      role: form.role.trim(),
      status: form.status,
      source: form.source.trim(),
      url: form.url.trim(),
      location: form.location.trim(),
      salary: form.salary.trim(),
      resumeId: form.resumeId || null,
      notes: form.notes,
      appliedAt: dateInputToIso(form.appliedAt),
      nextActionAt: dateInputToIso(form.nextActionAt),
      nextActionNote: form.nextActionNote.trim(),
    };
    if (editingId) {
      const before = editing?.status;
      updateApplication(editingId, payload);
      if (before && before !== form.status) {
        log({ actor: "you", action: "Application status changed", category: "resume", details: `${payload.role} @ ${payload.company}: ${APPLICATION_STATUS_LABELS[before]} → ${APPLICATION_STATUS_LABELS[form.status]}`, severity: "info" });
      } else {
        log({ actor: "you", action: "Application updated", category: "resume", details: `${payload.role} @ ${payload.company}`, severity: "info" });
      }
      toast.success("Application updated");
    } else {
      addApplication(payload);
      log({ actor: "you", action: "Application tracked", category: "resume", details: `${payload.role} @ ${payload.company}`, severity: "info" });
      toast.success("Application added to your pipeline");
    }
    closeDialog();
  };

  const handleDelete = (id: string) => {
    const app = applications.find((a) => a.id === id);
    removeApplication(id);
    log({ actor: "you", action: "Application deleted", category: "resume", details: app ? `${app.role} @ ${app.company}` : id, severity: "warning" });
    toast.success("Application removed");
    closeDialog();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="KanbanSquare" className="w-6 h-6 text-brand" /> Application Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your pipeline from wishlist to offer — drag cards between columns, set follow-up reminders, and never lose track of an application.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name="Plus" className="w-4 h-4" /> Add application
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon="Layers" label="Total" value={stats.total} hint={`${stats.wishlist} in wishlist`} />
        <StatCard icon="Send" label="Active" value={stats.active} hint="applied / screening / interviewing" />
        <StatCard icon="MessagesSquare" label="Interviews" value={stats.interviews} hint="stage reached" />
        <StatCard icon="Trophy" label="Offers" value={stats.offers} hint={`${Math.round(stats.offerRate * 100)}% of sent`} />
        <StatCard icon="Activity" label="Response rate" value={`${Math.round(stats.responseRate * 100)}%`} hint="employers that replied" />
      </div>

      {/* Follow-ups due */}
      {followUps.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
            <Icon name="BellRing" className="w-4 h-4" />
            {followUps.length} follow-up{followUps.length > 1 ? "s" : ""} due
          </div>
          <ul className="mt-2 space-y-1.5">
            {followUps.slice(0, 4).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm text-amber-900 dark:text-amber-100">
                <button className="underline-offset-2 hover:underline font-medium" onClick={() => setEditingId(a.id)}>
                  {a.role} @ {a.company}
                </button>
                <span className="text-xs opacity-80">
                  {a.nextActionNote || "Follow up"} · due {fmtDate(a.nextActionAt)}
                </span>
                <span className="flex-1" />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingId(a.id)}>Open</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { dismissFollowUp(a.id); toast.success("Follow-up cleared"); }}>Done</Button>
              </li>
            ))}
          </ul>
          {followUps.length > 4 && (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">+{followUps.length - 4} more — open the cards on the board.</p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Icon name="Search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company, role, notes…"
          className="pl-9"
          aria-label="Search applications"
        />
      </div>

      {/* Kanban board */}
      {applications.length === 0 ? (
        <EmptyBoard onAdd={() => setAddOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {APPLICATION_COLUMNS.map((col) => {
            const cards = filtered.filter((a) => a.status === col);
            return (
              <div
                key={col}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col); }}
                onDragLeave={() => setDragOverCol((c) => (c === col ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) moveApplication(id, col);
                }}
                className={`rounded-xl border p-2 min-h-[140px] transition-colors ${
                  dragOverCol === col ? "border-brand bg-brand/5" : "border-border bg-muted/30"
                }`}
                aria-label={`${APPLICATION_STATUS_LABELS[col]} column`}
              >
                <div className="flex items-center gap-1.5 px-1 pb-2">
                  <span className={`w-2 h-2 rounded-full ${COLUMN_DOT[col]}`} />
                  <span className={`text-xs font-semibold uppercase tracking-wide ${COLUMN_ACCENT[col]}`}>
                    {APPLICATION_STATUS_LABELS[col]}
                  </span>
                  <span className="text-xs text-muted-foreground">({cards.length})</span>
                </div>
                <div className="space-y-2">
                  {cards.map((app) => (
                    <ApplicationCard
                      key={app.id}
                      app={app}
                      onOpen={() => setEditingId(app.id)}
                      onMove={(status) => moveApplication(app.id, status)}
                    />
                  ))}
                  {cards.length === 0 && (
                    <p className="text-[11px] text-muted-foreground px-1 py-3 text-center italic">Drop cards here</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit dialog */}
      <ApplicationDialog
        open={addDialogOpen}
        editing={editing}
        resumes={resumes}
        jobDescriptions={jobDescriptions}
        onSubmit={handleSubmit}
        onDelete={editingId ? () => handleDelete(editingId) : undefined}
        onClose={closeDialog}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ icon, label, value, hint }: { icon: string; label: string; value: number | string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon name={icon} className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ApplicationCard({ app, onOpen, onMove }: { app: ApplicationRecord; onOpen: () => void; onMove: (s: ApplicationStatus) => void }) {
  const due = isFollowUpDue(app);
  const days = daysSinceApplied(app);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", app.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      role="button"
      tabIndex={0}
      className={`rounded-lg border bg-background p-2.5 cursor-pointer transition-shadow hover:shadow-md ${
        due ? "border-amber-400 ring-1 ring-amber-300" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" title={app.role}>{app.role || "Untitled role"}</div>
          <div className="text-xs text-muted-foreground truncate" title={app.company}>{app.company || "—"}</div>
        </div>
        {due && <Icon name="BellRing" className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />}
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {app.location && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{app.location}</Badge>}
        {app.source && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{app.source}</Badge>}
        {days >= 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{days}d since applied</Badge>}
      </div>
      {/* Touch/keyboard-friendly status switch (drag is desktop-only) */}
      <select
        value={app.status}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onMove(e.target.value as ApplicationStatus)}
        aria-label={`Change status for ${app.role} at ${app.company}`}
        className="w-full h-7 px-2 rounded-md border border-input bg-background text-xs mt-2"
      >
        {APPLICATION_COLUMNS.map((c) => (
          <option key={c} value={c}>{APPLICATION_STATUS_LABELS[c]}</option>
        ))}
      </select>
    </div>
  );
}

function EmptyBoard({ onAdd }: { onAdd: () => void }) {
  return (
    <Card>
      <CardContent className="p-10 text-center space-y-3">
        <Icon name="KanbanSquare" className="w-12 h-12 mx-auto text-muted-foreground/40" />
        <h3 className="font-semibold">No applications yet</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Track every role you're interested in — save it to your wishlist now, then drag it across the pipeline as you apply, screen, and interview. Set follow-up reminders so no application goes cold.
        </p>
        <Button onClick={onAdd} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name="Plus" className="w-4 h-4" /> Add your first application
        </Button>
      </CardContent>
    </Card>
  );
}

function ApplicationDialog({
  open, editing, resumes, jobDescriptions, onSubmit, onDelete, onClose,
}: {
  open: boolean;
  editing: ApplicationRecord | null;
  resumes: Array<{ id: string; name?: string; title?: string }>;
  jobDescriptions: Array<{ id: string; title?: string; company?: string; url?: string; location?: string; salary?: string }>;
  onSubmit: (form: FormState) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(editing));
  const [prefillJdId, setPrefillJdId] = useState<string>("");

  // Re-seed the form whenever the dialog opens for a different target.
  const [lastKey, setLastKey] = useState<string>("");
  const openKey = editing?.id ?? (open ? "new" : "closed");
  if (open && openKey !== lastKey) {
    setLastKey(openKey);
    setForm(toFormState(editing));
    setPrefillJdId("");
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const applyJdPrefill = (jdId: string) => {
    setPrefillJdId(jdId);
    const jd = jobDescriptions.find((j) => j.id === jdId);
    if (!jd) return;
    setForm((f) => ({
      ...f,
      role: jd.title || f.role,
      company: jd.company || f.company,
      url: jd.url || f.url,
      location: jd.location || f.location,
      salary: jd.salary || f.salary,
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit application" : "Track an application"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update details, move it through the pipeline, or adjust the follow-up reminder."
              : "Save a role you're targeting. You can drag it across the board as it progresses."}
          </DialogDescription>
        </DialogHeader>

        {!editing && jobDescriptions.length > 0 && (
          <div className="space-y-1.5">
            <Label>Pre-fill from a saved job description</Label>
            <Select value={prefillJdId} onValueChange={applyJdPrefill}>
              <SelectTrigger><SelectValue placeholder="Choose a saved JD (optional)" /></SelectTrigger>
              <SelectContent>
                {jobDescriptions.slice(0, 50).map((jd) => (
                  <SelectItem key={jd.id} value={jd.id}>
                    {jd.title || "Untitled role"}{jd.company ? ` — ${jd.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Company *</Label>
            <Input value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="Acme Corp" />
          </div>
          <div className="space-y-1.5">
            <Label>Role *</Label>
            <Input value={form.role} onChange={(e) => set("role", e.target.value)} placeholder="Senior Frontend Engineer" />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v as ApplicationStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {APPLICATION_COLUMNS.map((c) => (
                  <SelectItem key={c} value={c}>{APPLICATION_STATUS_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Input value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="LinkedIn, referral, Bayt…" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Job posting URL</Label>
            <Input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" type="url" />
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Dubai, UAE" />
          </div>
          <div className="space-y-1.5">
            <Label>Salary</Label>
            <Input value={form.salary} onChange={(e) => set("salary", e.target.value)} placeholder="25k AED / month" />
          </div>
          <div className="space-y-1.5">
            <Label>Applied on</Label>
            <Input type="date" value={form.appliedAt} onChange={(e) => set("appliedAt", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Resume sent</Label>
            <Select value={form.resumeId || "none"} onValueChange={(v) => set("resumeId", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {resumes.slice(0, 50).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name || r.title || r.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Follow-up reminder</Label>
            <Input type="date" value={form.nextActionAt} onChange={(e) => set("nextActionAt", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Follow-up note</Label>
            <Input value={form.nextActionNote} onChange={(e) => set("nextActionNote", e.target.value)} placeholder="Chase HR for feedback" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Interviewer names, tech stack, recruiter contact, next steps…"
              rows={3}
            />
          </div>
        </div>

        {editing && editing.history.length > 0 && (
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Status history</div>
            <ol className="space-y-1 text-xs text-muted-foreground">
              {editing.history.slice(-6).reverse().map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex items-center gap-2">
                  <Icon name="Clock" className="w-3 h-3" />
                  {fmtDate(h.at)} — {h.from ? `${APPLICATION_STATUS_LABELS[h.from]} → ` : ""}
                  <span className="font-medium text-foreground">{APPLICATION_STATUS_LABELS[h.to]}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {onDelete ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive gap-1.5" onClick={onDelete}>
              <Icon name="Trash2" className="w-4 h-4" /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-brand hover:bg-brand-dark text-white" onClick={() => onSubmit(form)}>
              {editing ? "Save changes" : "Add application"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
