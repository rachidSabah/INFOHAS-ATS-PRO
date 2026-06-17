"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";

const CATEGORIES = ["auth", "ai", "resume", "admin", "system", "export"] as const;
const SEVERITIES = ["info", "warning", "error"] as const;

export function Logs() {
  const logs = useApp((s) => s.logs);
  const clearLogs = useApp((s) => s.clearLogs);

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [sev, setSev] = useState<string>("all");

  const filtered = logs.filter((l) => {
    if (cat !== "all" && l.category !== cat) return false;
    if (sev !== "all" && l.severity !== sev) return false;
    if (q && !(`${l.action} ${l.details} ${l.actor}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="ScrollText" className="w-6 h-6 text-brand" /> Audit Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">Full audit trail. Last 500 events kept in browser storage.</p>
        </div>
        <Button variant="outline" onClick={() => { if (confirm("Clear all logs?")) { clearLogs(); toast.success("Logs cleared."); } }} className="text-destructive gap-2">
          <Icon name="Trash2" className="w-4 h-4" /> Clear all
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Icon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs…" className="pl-9 h-9" />
            </div>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </select>
            <select value={sev} onChange={(e) => setSev(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="all">All severities</option>
              {SEVERITIES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{filtered.length} events</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Time</th>
                  <th className="px-4 py-2 font-semibold">Severity</th>
                  <th className="px-4 py-2 font-semibold">Category</th>
                  <th className="px-4 py-2 font-semibold">Actor</th>
                  <th className="px-4 py-2 font-semibold">Action</th>
                  <th className="px-4 py-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const sevColor = l.severity === "info" ? "brand" : l.severity === "warning" ? "warning" : "danger";
                  return (
                    <tr key={l.id} className="border-b border-border hover:bg-secondary/30">
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                      <td className="px-4 py-2"><Badge variant={sevColor as any} className="text-[10px] capitalize">{l.severity}</Badge></td>
                      <td className="px-4 py-2 text-xs capitalize">{l.category}</td>
                      <td className="px-4 py-2 text-xs">{l.actor}</td>
                      <td className="px-4 py-2 text-xs font-medium">{l.action}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{l.details}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">No matching logs.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
