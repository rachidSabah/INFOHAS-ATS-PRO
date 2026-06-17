"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { ProviderManager } from "@/lib/ai/services";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, "success" | "warning" | "danger" | "outline"> = {
  success: "success",
  error: "danger",
  timeout: "warning",
  rate_limited: "warning",
};

export function ProviderLogsTable() {
  const logs = useApp((s) => s.providerLogs);
  const providers = useApp((s) => s.providers);
  const [q, setQ] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = logs.filter((l) => {
    if (providerFilter !== "all" && l.providerId !== providerFilter) return false;
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (q && !(`${l.providerName} ${l.errorMessage ?? ""} ${l.requestPreview ?? ""}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">AI Provider Logs ({filtered.length})</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="all">All providers</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="timeout">Timeout</option>
              <option value="rate_limited">Rate limited</option>
            </select>
            <div className="relative w-full sm:w-56">
              <Icon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs…" className="pl-9 h-9" />
            </div>
            <Button variant="outline" size="sm" onClick={() => { if (confirm("Clear all logs?")) { ProviderManager.clearLogs(); toast.success("Logs cleared."); } }} className="text-destructive gap-1.5">
              <Icon name="Trash2" className="w-3.5 h-3.5" /> Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-semibold">Time</th>
                <th className="px-4 py-2 font-semibold">Provider</th>
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">Model</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold text-right">Latency</th>
                <th className="px-4 py-2 font-semibold text-right">Tokens</th>
                <th className="px-4 py-2 font-semibold">Error / Response</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <>
                  <tr key={l.id} className="border-b border-border hover:bg-secondary/30 cursor-pointer" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-2 text-xs font-medium truncate max-w-[160px]">{l.providerName}</td>
                    <td className="px-4 py-2"><Badge variant="outline" className="text-[10px] capitalize">{l.requestType}</Badge></td>
                    <td className="px-4 py-2 text-xs font-mono">{l.modelName ?? "—"}</td>
                    <td className="px-4 py-2"><Badge variant={STATUS_COLORS[l.status]} className="text-[10px] capitalize">{l.status.replace("_", " ")}</Badge></td>
                    <td className="px-4 py-2 text-right text-xs font-mono">{l.latencyMs}ms</td>
                    <td className="px-4 py-2 text-right text-xs font-mono">{(l.inputTokens ?? 0) + (l.outputTokens ?? 0) > 0 ? `${l.inputTokens ?? 0}+${l.outputTokens ?? 0}` : "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[260px]">
                      {l.errorMessage ?? l.responsePreview ?? "—"}
                      <Icon name={expanded === l.id ? "ChevronUp" : "ChevronDown"} className="w-3 h-3 inline ml-1" />
                    </td>
                  </tr>
                  {expanded === l.id && (
                    <tr className="bg-secondary/20">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="grid sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <div className="font-semibold text-muted-foreground mb-1">Request preview</div>
                            <pre className="bg-card border border-border rounded p-2 whitespace-pre-wrap font-mono text-[11px] max-h-32 overflow-y-auto">{l.requestPreview ?? "(empty)"}</pre>
                          </div>
                          <div>
                            <div className="font-semibold text-muted-foreground mb-1">{l.status === "success" ? "Response preview" : "Error message"}</div>
                            <pre className={`bg-card border border-border rounded p-2 whitespace-pre-wrap font-mono text-[11px] max-h-32 overflow-y-auto ${l.status !== "success" ? "text-red-600" : ""}`}>{l.errorMessage ?? l.responsePreview ?? "(empty)"}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No logs match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
