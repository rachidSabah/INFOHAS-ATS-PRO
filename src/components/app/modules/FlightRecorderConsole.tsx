"use client";

// ============================================================================
// Phase 8.1.5 (P4) — Flight Recorder Console.
//
// Lists in-session FlightRecords (captured via the AfterPersist sink in
// store.ts), filterable/searchable with the EXISTING pure helper
// matchesFlightFilter. Detail panel replays timeline + prompt versions +
// provider/model/latency/cost/tokens + reflection/qa/validation/decision.
// PRESENTATION ONLY — no AI, no recomputation.
// ============================================================================

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { matchesFlightFilter, type FlightRecord, type FlightFilter } from "@/lib/ai/flight-recorder";
import { FlightTimeline } from "@/components/flight/FlightTimeline";

export function FlightRecorderConsole() {
  const flightRecords = useApp((s) => s.flightRecords);
  const clearFlightLog = useApp((s) => s.clearFlightLog);

  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const f: FlightFilter = {};
    if (providerFilter) f.provider = providerFilter;
    if (onlyErrors) f.hasErrors = true;
    return flightRecords
      .filter((r) => matchesFlightFilter(r, f))
      .filter((r) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          r.executionId.toLowerCase().includes(q) ||
          (r.feature ?? "").toLowerCase().includes(q) ||
          (r.module ?? "").toLowerCase().includes(q) ||
          r.provider.toLowerCase().includes(q) ||
          r.model.toLowerCase().includes(q) ||
          r.scope.toLowerCase().includes(q)
        );
      });
  }, [flightRecords, query, providerFilter, onlyErrors]);

  const selected = filtered.find((r) => r.executionId === selectedId) ?? filtered[0] ?? null;
  const providers = useMemo(() => Array.from(new Set(flightRecords.map((r) => r.provider))).sort(), [flightRecords]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Flight Recorder Console</h1>
          <p className="text-sm text-muted-foreground">{flightRecords.length} executions captured this session.</p>
        </div>
        <Button variant="outline" size="sm" onClick={clearFlightLog} disabled={!flightRecords.length}>
          <Icon name="Trash2" className="w-4 h-4 mr-2" /> Clear log
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Icon name="Search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search execution id / feature / provider / scope…"
              className="pl-9"
              aria-label="Search executions"
            />
          </div>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-card px-3 text-sm"
            aria-label="Filter by provider"
          >
            <option value="">All providers</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            Errors only
          </label>
        </CardContent>
      </Card>

      {flightRecords.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Icon name="Plane" className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No executions captured yet.</p>
            <p className="text-xs mt-1">Run any AI feature (interview, optimizer, etc.) and its Flight Record will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* List */}
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle className="text-base">Executions ({filtered.length})</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 max-h-[560px] overflow-auto">
              {filtered.map((r) => {
                const active = r.executionId === selected?.executionId;
                return (
                  <button
                    key={r.executionId}
                    onClick={() => setSelectedId(r.executionId)}
                    className={`w-full text-left p-2.5 rounded-lg border text-sm transition-colors ${
                      active ? "border-brand bg-brand/10" : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{r.feature ?? r.scope}</span>
                      {r.errors.length > 0 && <Badge className="bg-red-500/10 text-red-500 border-red-500/40">err</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{r.provider} · {r.model} · {r.latencyMs}ms</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Detail */}
          <div className="lg:col-span-2 space-y-4">
            {selected && <FlightDetail record={selected} />}
          </div>
        </div>
      )}
    </div>
  );
}

function FlightDetail({ record: r }: { record: FlightRecord }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{r.feature ?? r.scope}</CardTitle>
          <CardDescription className="font-mono text-xs">{r.executionId}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Provider" value={r.provider} />
          <Stat label="Model" value={r.model} />
          <Stat label="Latency" value={`${r.latencyMs}ms`} />
          <Stat label="Duration" value={`${r.durationMs}ms`} />
          <Stat label="Tokens" value={String(r.tokenUsage)} />
          <Stat label="Cost" value={`$${r.cost.estimatedCost.toFixed(4)}`} />
          <Stat label="Prompt ver" value={r.promptVersion} />
          <Stat label="Retries" value={String(r.retryCount)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Execution Timeline</CardTitle></CardHeader>
        <CardContent><FlightTimeline spans={r.timeline} /></CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EngineCard title="Reflection" present={!!r.reflection} rows={r.reflection && [
          ["Outcome", r.reflection.outcome], ["Score", String(r.reflection.score)],
          ["Confidence", String(r.reflection.confidence)], ["Retry", String(r.reflection.retryRecommended)],
        ]} />
        <EngineCard title="QA" present={!!r.qa} rows={r.qa && [
          ["Outcome", r.qa.outcome], ["Score", String(r.qa.score)],
          ["Findings", String(r.qa.findings?.length ?? 0)], ["Fail rec", String(r.qa.failRecommended)],
        ]} />
        <EngineCard title="Validation" present={!!r.validation} rows={r.validation && [
          ["Outcome", r.validation.outcome], ["Score", String(r.validation.score)],
          ["Critical", String(r.validation.criticalFailures)], ["Profile", r.validation.profile],
        ]} />
        <EngineCard title="Decision" present={!!r.decision} rows={r.decision && [
          ["Status", r.decision.status], ["Confidence", String(r.decision.confidence)],
          ["Rules", String(r.decision.rules.length)], ["Reason", r.decision.reason],
        ]} />
      </div>

      {(r.errors.length > 0 || r.warnings.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="text-base">Diagnostics</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {r.errors.map((e, i) => <div key={`e${i}`} className="text-red-500">✕ {e}</div>)}
            {r.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-500">⚠ {w}</div>)}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium truncate">{value}</div>
    </div>
  );
}

function EngineCard({ title, present, rows }: { title: string; present: boolean; rows?: [string, string][] | null | false }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${present ? "bg-emerald-500" : "bg-muted-foreground/40"}`} /> {title}
      </CardTitle></CardHeader>
      <CardContent>
        {present && rows ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium truncate">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Not run for this execution.</p>
        )}
      </CardContent>
    </Card>
  );
}
