"use client";

// ============================================================================
// Provider Health Panel — Auto-Heal + Manual Heal UI (directives #7–#20).
//
// Shared, self-contained surface mounted on BOTH the "AI Providers" page and
// the "AI Models" page so the healing controls are ALWAYS visible where
// providers are managed:
//   [Run Benchmark Ping] [HEAL PROVIDERS] [AUTO-HEAL PROVIDERS toggle]
//   + per-provider health strip (status chip incl. COOLDOWN countdown,
//     per-provider [HEALTH CHECK] / [HEAL])
//   + provider-aware benchmark results (resolved model per provider,
//     Technical Details expandable)
//   + heal report (Problem / Diagnosis / Action / Result) + heal history.
// ============================================================================

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import { runProviderAwareBenchmark, type BenchmarkReport, type BenchmarkRow } from "@/lib/ai/healing/benchmark";
import { ProviderHealer, providerInCooldown, cooldownRemainingSeconds, type HealReportEntry } from "@/lib/ai/healing/provider-healer";
import { getHealHistory, clearHealHistory, type HealEvent } from "@/lib/ai/healing/heal-history";
import { classifyProviderFailure } from "@/lib/ai/healing/error-classifier";

export function ProviderHealthPanel() {
  const providers = useApp((s) => s.providers);
  const providerSettings = useApp((s) => s.providerSettings);
  const updateProviderSettings = useApp((s) => s.updateProviderSettings);
  const autoHealOn = providerSettings?.autoHealProviders !== false;

  const [benchmarking, setBenchmarking] = useState(false);
  const [benchReport, setBenchReport] = useState<BenchmarkReport | null>(null);
  const [expandedTech, setExpandedTech] = useState<Record<string, boolean>>({});
  const [healing, setHealing] = useState(false);
  const [healReports, setHealReports] = useState<HealReportEntry[] | null>(null);
  const [healHistory, setHealHistory] = useState<HealEvent[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Refresh heal history on mount + after operations
  useEffect(() => { setHealHistory(getHealHistory()); }, [benchReport, healReports]);

  /**
   * PROVIDER-AWARE BENCHMARK (directive #11): every provider is pinged with
   * ITS OWN resolved model — never one global model id propagated everywhere.
   * Failures are classified, health is updated, and safe Auto-Heal runs when
   * enabled (followed by a re-ping of the repaired configuration).
   */
  const runBenchmarkPing = async (providerIds?: string[]) => {
    setBenchmarking(true);
    setHealReports(null);
    try {
      const report = await runProviderAwareBenchmark({ providerIds });
      setBenchReport(report);
      const passed = report.rows.filter((r) => r.ok).length;
      const healed = report.rows.filter((r) => r.status === "healed").length;
      if (passed === report.rows.length && report.rows.length > 0) {
        toast.success(`Benchmark passed for all ${passed} provider${passed === 1 ? "" : "s"}.`);
      } else if (report.allFailed) {
        toast.error(`All ${report.rows.length} providers failed — click HEAL PROVIDERS for diagnosis + recovery.`);
      } else {
        toast.info(`Benchmark: ${passed}/${report.rows.length} passed${healed ? ` · ${healed} auto-healed` : ""}.`, { duration: 5000 });
      }
    } catch (e: any) {
      toast.error(e?.message || "Benchmark failed");
    } finally {
      setBenchmarking(false);
    }
  };

  /** HEAL ALL — manual recovery sweep (directive #7): diagnose → repair → validate → report. */
  const healAll = async () => {
    setHealing(true);
    try {
      const reports = await ProviderHealer.healAllProviders("manual");
      setHealReports(reports);
      setHealHistory(getHealHistory());
      const recovered = reports.filter((r) => r.result === "recovered").length;
      if (reports.length === 0) toast.info("All providers are healthy — nothing to heal.");
      else if (recovered === reports.length) toast.success(`Healing complete: ${recovered}/${reports.length} provider(s) recovered.`);
      else toast.warning(`Healing complete: ${recovered}/${reports.length} recovered — see the heal report for the rest.`, { duration: 6000 });
      // Directive #20: re-run the benchmark after healing so results reflect repairs.
      await runBenchmarkPing();
    } catch (e: any) {
      toast.error(e?.message || "Healing failed");
    } finally {
      setHealing(false);
    }
  };

  /** Per-provider HEAL — only affects that provider (directive #9). */
  const healOne = async (pid: string) => {
    setHealing(true);
    try {
      const report = await ProviderHealer.healProvider(pid, "manual");
      setHealReports([report]);
      setHealHistory(getHealHistory());
      if (report.result === "recovered") toast.success(`${report.providerName}: healed — ${report.action}`);
      else toast.warning(`${report.providerName}: ${report.result.replace("_", " ")} — ${report.action}`, { duration: 7000 });
    } catch (e: any) {
      toast.error(e?.message || "Heal failed");
    } finally {
      setHealing(false);
    }
  };

  /** Single-provider health check — same engine, one provider. */
  const healthCheckOne = async (pid: string) => {
    await runBenchmarkPing([pid]);
  };

  const stripProviders = providers.filter((p) => p.isActive && p.type !== "puter");

  return (
    <Card className="border-brand/20" data-provider-health-panel>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icon name="Activity" className="w-4 h-4 text-brand" /> Provider Health — Auto-Heal &amp; Manual Heal
        </CardTitle>
        <CardDescription className="text-xs">
          Each provider is pinged with its own provider-compatible model — never one shared model id. Failures are classified, safely auto-repaired where possible, and validated before a provider is marked healthy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {/* Auto-Heal toggle + primary actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => runBenchmarkPing()}
            disabled={benchmarking}
            className="h-8 font-semibold"
          >
            {benchmarking ? (
              <><Icon name="Loader2" className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Benchmarking…</>
            ) : (
              <><Icon name="Gauge" className="w-3.5 h-3.5 mr-1.5" /> Run Benchmark Ping</>
            )}
          </Button>
          <Button
            onClick={healAll}
            disabled={healing || benchmarking}
            className="h-8 font-semibold bg-amber-600 hover:bg-amber-700 text-white"
          >
            {healing ? (
              <><Icon name="Loader2" className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Healing…</>
            ) : (
              <><Icon name="HeartPulse" className="w-3.5 h-3.5 mr-1.5" /> HEAL PROVIDERS</>
            )}
          </Button>
          <button
            onClick={() => updateProviderSettings({ autoHealProviders: !autoHealOn })}
            className={`ml-auto flex items-center gap-1.5 px-2.5 h-8 rounded-md border text-[11px] font-medium ${autoHealOn ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600" : "bg-secondary/40 border-border text-muted-foreground"}`}
            title="When ON, provider failures automatically trigger safe diagnosis + repair + validation"
          >
            <Icon name={autoHealOn ? "ToggleRight" : "ToggleLeft"} className="w-4 h-4" />
            AUTO-HEAL PROVIDERS: {autoHealOn ? "ON" : "OFF"}
          </button>
        </div>

        {/* Per-provider health strip (directive #17) */}
        <div className="rounded-lg border border-border/60 divide-y divide-border/60">
          {stripProviders.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
              No active API providers. Add or activate a provider to see its live health here.
            </div>
          )}
          {stripProviders.map((p) => {
            const inCd = providerInCooldown(p);
            const cdSecs = inCd ? cooldownRemainingSeconds(p) : 0;
            const cls = p.health?.lastError ? classifyProviderFailure(p.health.lastError, { providerType: p.type }) : null;
            const chip: string = inCd
              ? "COOLDOWN"
              : p.health?.healState && p.health.healState !== "untested"
                ? p.health.healState.toUpperCase().replace("_", " ")
                : cls && !cls.temporary
                  ? cls.kind.toUpperCase().replace("_", " ")
                  : p.status === "healthy" ? "HEALTHY" : p.status.toUpperCase();
            const chipCls =
              chip === "HEALTHY" || chip === "RECOVERED" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
              : chip === "COOLDOWN" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
              : chip === "MODEL ERROR" || chip === "ENDPOINT ERROR" || chip === "AUTH ERROR" || chip === "CONFIGURATION ERROR" ? "bg-orange-500/10 text-orange-600 border-orange-500/30"
              : chip === "HEALING" ? "bg-sky-500/10 text-sky-600 border-sky-500/30"
              : "bg-red-500/10 text-red-600 border-red-500/30";
            return (
              <div key={p.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${chipCls}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" /> {chip}{inCd ? ` ${cdSecs}s` : ""}
                </span>
                <span className="font-medium truncate max-w-[140px]">{p.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[160px]">{p.modelName || "—"}</span>
                {p.health?.lastDiagnosis && <span className="text-[10px] text-muted-foreground truncate flex-1 hidden sm:inline">{p.health.lastDiagnosis}</span>}
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" disabled={benchmarking} onClick={() => healthCheckOne(p.id)}>
                    <Icon name="Stethoscope" className="w-3 h-3 mr-0.5" /> HEALTH CHECK
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" disabled={healing} onClick={() => healOne(p.id)}>
                    <Icon name="Wrench" className="w-3 h-3 mr-0.5" /> HEAL
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Benchmark results table (directive #11) */}
        {benchReport && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold flex items-center gap-1.5">
                <Icon name="ListChecks" className="w-3.5 h-3.5 text-brand" /> Benchmark Results
              </span>
              <span className="text-[10px] text-muted-foreground">{new Date(benchReport.at).toLocaleTimeString()} · {benchReport.totalMs}ms total</span>
            </div>
            <div className="rounded-lg border border-border/60 divide-y divide-border/60">
              {benchReport.rows.map((r: BenchmarkRow) => (
                <div key={r.providerId} className="px-2.5 py-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={r.ok ? (r.status === "healed" ? "warning" : "success") : r.status === "cooldown" ? "warning" : "danger"}>
                      {r.chip}
                    </Badge>
                    <span className="font-semibold">{r.providerName}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">model: {r.resolvedModel}</span>
                    <Badge variant="outline" className="text-[9px]">{r.modelSource === "enabled" ? "FROM ENABLED" : r.modelSource === "default" ? "PROVIDER DEFAULT" : r.modelSource === "catalog" ? "FROM CATALOG" : "NO MODEL"}</Badge>
                    {r.ok && <Badge variant="success" className="text-[9px]">{r.latencyMs}ms</Badge>}
                    {r.autoHeal?.repaired && <Badge variant="warning" className="text-[9px]"><Icon name="Wrench" className="w-3 h-3 mr-0.5" /> AUTO-HEALED</Badge>}
                  </div>
                  {r.reply && r.ok && <div className="font-mono text-[10px] text-emerald-600">reply: &quot;{r.reply}&quot;</div>}
                  {r.diagnosis && !r.ok && <div className="text-[11px] text-amber-700">{r.diagnosis}</div>}
                  {r.error && (
                    <div>
                      <button className="text-[10px] text-muted-foreground underline flex items-center gap-1" onClick={() => setExpandedTech((s) => ({ ...s, [r.providerId]: !s[r.providerId] }))}>
                        <Icon name={expandedTech[r.providerId] ? "ChevronDown" : "ChevronRight"} className="w-3 h-3" /> Technical Details
                      </button>
                      {expandedTech[r.providerId] && (
                        <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-slate-900 text-slate-100 p-2 font-mono text-[10px] max-h-24 overflow-y-auto">{r.error}</pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {benchReport.allFailed && (
              <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-2.5 text-[11px] text-red-600">
                All providers failed AFTER model resolution, cooldown handling and safe auto-healing. This is a genuine outage or a configuration problem — review the diagnoses above, then run HEAL PROVIDERS or fix the flagged configuration.
              </div>
            )}
          </div>
        )}

        {/* Heal report (directive #10) */}
        {healReports && healReports.length > 0 && (
          <div className="space-y-2">
            <span className="font-semibold flex items-center gap-1.5">
              <Icon name="HeartPulse" className="w-3.5 h-3.5 text-amber-600" /> Provider Heal Report
            </span>
            {healReports.map((r, i) => (
              <div key={i} className="rounded-lg border border-border/60 p-2.5 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.providerName}</span>
                  <Badge variant={r.result === "recovered" ? "success" : r.result === "cooldown" ? "warning" : r.result === "failed" ? "danger" : "outline"}>{r.result.replace("_", " ").toUpperCase()}</Badge>
                  <Badge variant="outline" className="text-[9px]">{r.mode === "auto" ? "AUTO-HEAL" : "MANUAL"}</Badge>
                </div>
                <div className="text-[11px] space-y-0.5 text-muted-foreground">
                  <div><strong className="text-foreground">Problem:</strong> {r.problem}</div>
                  <div><strong className="text-foreground">Diagnosis:</strong> {r.diagnosis}</div>
                  <div><strong className="text-foreground">Action:</strong> {r.action}</div>
                  {r.previousModel && r.newModel && <div><strong className="text-foreground">Model:</strong> <span className="font-mono">{r.previousModel}</span> → <span className="font-mono">{r.newModel}</span></div>}
                  {r.previousEndpoint && r.newEndpoint && <div><strong className="text-foreground">Endpoint:</strong> <span className="font-mono">{r.previousEndpoint}</span> → <span className="font-mono">{r.newEndpoint}</span></div>}
                </div>
                {r.technical && (
                  <pre className="whitespace-pre-wrap break-all rounded bg-slate-900 text-slate-100 p-2 font-mono text-[10px] max-h-20 overflow-y-auto">{r.technical}</pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Heal history (directive #19) */}
        {healHistory.length > 0 && (
          <div>
            <button className="font-semibold flex items-center gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setShowHistory((s) => !s)}>
              <Icon name={showHistory ? "ChevronDown" : "ChevronRight"} className="w-3.5 h-3.5" />
              <Icon name="History" className="w-3.5 h-3.5" /> Heal History ({healHistory.length})
            </button>
            {showHistory && (
              <div className="mt-2 rounded-lg border border-border/60 divide-y divide-border/60 max-h-48 overflow-y-auto">
                {healHistory.map((e) => (
                  <div key={e.id} className="px-2.5 py-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                    <span className="font-semibold">{e.providerName}</span>
                    <span>{e.failureKind}</span>
                    {e.previousModel && e.newModel && <span className="font-mono">{e.previousModel} → {e.newModel}</span>}
                    <Badge variant={e.result === "recovered" ? "success" : e.result === "cooldown" ? "warning" : "outline"} className="text-[9px]">{e.result.replace("_", " ")}</Badge>
                    <Badge variant="outline" className="text-[9px]">{e.mode === "auto" ? "AUTO" : "MANUAL"}</Badge>
                  </div>
                ))}
                <div className="px-2.5 py-1.5">
                  <button className="text-[10px] text-muted-foreground underline" onClick={() => { clearHealHistory(); setHealHistory([]); }}>Clear history</button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
