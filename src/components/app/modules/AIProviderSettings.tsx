"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { ProviderManager } from "@/lib/ai/services";
import { toast } from "sonner";
import { chainLinkDisplay, type ChainLinkTestResult } from "./routing-chain-diagnostics";

export function AIProviderSettings() {
  const settings = useApp((s) => s.providerSettings);
  const providers = useApp((s) => s.providers);
  const updateProviderSettings = useApp((s) => s.updateProviderSettings);

  // Local form state (editable, saved on "Save")
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync form when settings change from the store (only if no unsaved changes)
  const settingsRef = settings;
  useEffect(() => {
    if (!hasChanges && JSON.stringify(form) !== JSON.stringify(settingsRef)) {
      setForm(settingsRef);
    }
  }, [settings, hasChanges]);

  // Model prefetch state
  const [fetchingModels, setFetchingModels] = useState(false);
  const [liveModels, setLiveModels] = useState<string[]>([]);

  // Chain diagnostics state — Task 28: full per-link result is preserved
  // (failure latency + rateLimited flag + provider message), no more zeroed
  // latency / hover-only reasons.
  const [testingChain, setTestingChain] = useState(false);
  const [chainResults, setChainResults] = useState<Record<string, ChainLinkTestResult>>({});

  // === FAILOVER SIMULATOR STATES ===
  const [simulatingFailover, setSimulatingFailover] = useState(false);
  const [failoverTrace, setFailoverTrace] = useState<Array<{ title: string; status: string; desc: string; type: "info" | "success" | "error" }>>([]);

  const runFailoverSimulation = async () => {
    setSimulatingFailover(true);
    setFailoverTrace([]);

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Step 1: Initiate call
    setFailoverTrace([{ title: "Triggering API Request", status: "started", desc: "User initiated a resume optimization call. Routing to default provider...", type: "info" }]);
    await delay(1000);

    // Step 2: Primary failure
    setFailoverTrace(prev => [...prev, {
      title: `Connecting to Primary: ${defaultProvider?.name || "OpenAI"}`,
      status: "failed",
      desc: "API returned status code 429: Rate Limit Exceeded. Triggering failover policy...",
      type: "error"
    }]);
    await delay(1200);

    // Step 3: Check fallback count
    if (fallbackProviders.length === 0) {
      setFailoverTrace(prev => [...prev, {
        title: "Routing Failure",
        status: "aborted",
        desc: "Failover aborted. No active fallback providers are configured in your routing settings.",
        type: "error"
      }]);
      setSimulatingFailover(false);
      return;
    }

    // Step 4: Cascade through fallbacks
    for (let i = 0; i < fallbackProviders.length; i++) {
      const p = fallbackProviders[i];
      const isLast = i === fallbackProviders.length - 1;

      if (!isLast) {
        // Simulate a failure on intermediate fallbacks
        setFailoverTrace(prev => [...prev, {
          title: `Failover Tier ${i + 1}: ${p.name}`,
          status: "failed",
          desc: "API connection timed out after 3000ms. Escalating to next fallback tier...",
          type: "error"
        }]);
        await delay(1200);
      } else {
        // Final fallback succeeds
        setFailoverTrace(prev => [...prev, {
          title: `Failover Tier ${i + 1}: ${p.name}`,
          status: "success",
          desc: `Successfully established connection to ${p.name}. Completed text generation in 840ms with score metrics.`,
          type: "success"
        }]);
      }
    }

    setSimulatingFailover(false);
  };

  const defaultProvider = providers.find((p) => p.id === form.defaultProviderId);
  const fallbackProviders = form.fallbackProviderIds
    .map((id) => providers.find((p) => p.id === id))
    .filter(Boolean) as typeof providers;
  const availableForFallback = providers.filter(
    (p) => p.id !== form.defaultProviderId && !form.fallbackProviderIds.includes(p.id)
  );

  const update = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setHasChanges(true);
  };

  const save = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    updateProviderSettings(form);
    setSaving(false);
    setHasChanges(false);
    toast.success("AI routing settings saved to D1.");
  };

  const fetchModels = async () => {
    if (!defaultProvider) {
      toast.error("Select a default provider first.");
      return;
    }
    setFetchingModels(true);
    const result = await ProviderManager.fetchModels(defaultProvider);
    setFetchingModels(false);
    if (result.ok && result.models.length > 0) {
      setLiveModels(result.models);
      toast.success(`Loaded ${result.models.length} ${defaultProvider.type === "puter" ? "live-catalog" : "live"} models from ${defaultProvider.name}.`);
    } else {
      toast.error(result.error || "Failed to fetch models. Your existing configuration is preserved.");
    }
  };

  const handleTestChain = async () => {
    setTestingChain(true);
    setChainResults({});
    
    const providersToTest = [
      defaultProvider,
      ...fallbackProviders
    ].filter(Boolean) as typeof providers;

    for (const p of providersToTest) {
      setChainResults(prev => ({ ...prev, [p.id]: { ok: false, latencyMs: 0, phase: "testing" } }));
      try {
        const res = await ProviderManager.testConnection(p as any);
        setChainResults(prev => ({
          ...prev,
          // Task 28 — keep the REAL diagnosis: failure latency, rateLimited
          // flag (429 = reachable, key accepted) and the provider message.
          [p.id]: {
            ok: res.ok,
            latencyMs: res.latencyMs ?? 0,
            message: res.ok ? undefined : res.message,
            rateLimited: (res as any)?.rateLimited === true,
            phase: "done",
          },
        }));
      } catch (err: any) {
        setChainResults(prev => ({
          ...prev,
          [p.id]: { ok: false, latencyMs: 0, message: err?.message || "Connection error", phase: "done" },
        }));
      }
    }
    setTestingChain(false);
    toast.success("AI Routing Chain diagnostics complete.");
  };

  // === Import / Export ===
  const exportConfig = () => {
    const config = {
      settings: form,
      providers: providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? "***REDACTED***" : undefined,
      })),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-routing-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Configuration exported.");
  };

  const importConfig = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const config = JSON.parse(text);
        if (config.settings) {
          setForm(config.settings);
          setHasChanges(true);
          toast.success("Configuration imported. Click 'Save' to apply.");
        } else {
          toast.error("Invalid config file — missing 'settings' key.");
        }
      } catch {
        toast.error("Failed to parse config file.");
      }
    };
    input.click();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Settings" className="w-6 h-6 text-brand" /> AI Routing Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure default provider, model, fallback chain, and routing policy.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={importConfig} className="gap-1.5"><Icon name="Upload" className="w-3.5 h-3.5" /> Import</Button>
          <Button variant="outline" size="sm" onClick={exportConfig} className="gap-1.5"><Icon name="Download" className="w-3.5 h-3.5" /> Export</Button>
          <Button size="sm" onClick={save} disabled={!hasChanges || saving} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
            {saving ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Save" className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {hasChanges && (
        <div className="rounded-lg bg-amber-100 dark:bg-amber-400/10 border border-amber-300 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <Icon name="AlertTriangle" className="w-4 h-4" /> You have unsaved changes. Click "Save" to persist to D1.
        </div>
      )}

      {/* Default Provider + Model */}
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Icon name="Star" className="w-4 h-4 text-gold" /> Default Provider & Model</CardTitle><CardDescription>The provider and model used first for every AI request.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Default provider</Label>
              <select
                value={form.defaultProviderId ?? ""}
                onChange={(e) => { update({ defaultProviderId: e.target.value || null }); setLiveModels([]); }}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">— None —</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Default model</Label>
              <div className="flex gap-2">
                {liveModels.length > 0 ? (
                  <select
                    value={form.defaultModel}
                    onChange={(e) => update({ defaultModel: e.target.value })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm flex-1"
                  >
                    <option value="">— Select a model —</option>
                    {liveModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <Input value={form.defaultModel} onChange={(e) => update({ defaultModel: e.target.value })} placeholder="claude-sonnet-4" className="flex-1" />
                )}
                {defaultProvider?.type === "puter" ? (
                  <Button variant="outline" size="sm" onClick={fetchModels} disabled={fetchingModels} className="gap-1.5 shrink-0">
                    {fetchingModels ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="List" className="w-3.5 h-3.5" />}
                    Show live models
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={fetchModels} disabled={fetchingModels || !defaultProvider} className="gap-1.5 shrink-0">
                    {fetchingModels ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="DownloadCloud" className="w-3.5 h-3.5" />}
                    Fetch models
                  </Button>
                )}
              </div>
              {defaultProvider?.type === "puter" && liveModels.length === 0 && <p className="text-[10px] text-muted-foreground">Puter's live catalog is fetched from api.puter.com — click "Show live models" to load it (curated models ranked first).</p>}
              {liveModels.length > 0 && <p className="text-[10px] text-muted-foreground">{liveModels.length} {defaultProvider?.type === "puter" ? "live-catalog" : "live"} models from {defaultProvider?.name}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Diagnostics Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Icon name="Activity" className="w-4 h-4 text-emerald-500" /> 
              Routing Chain Diagnostics
            </span>
            <Button 
              onClick={handleTestChain} 
              disabled={testingChain || (!defaultProvider && fallbackProviders.length === 0)}
              variant="outline" 
              size="sm"
              className="text-xs gap-1.5"
            >
              {testingChain ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Play" className="w-3.5 h-3.5 text-brand" />}
              {testingChain ? "Testing..." : "Test Entire Chain"}
            </Button>
          </CardTitle>
          <CardDescription>
            Simulate live API calls to verify credentials, check latency, and ensure failover resilience across your configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {defaultProvider && (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 text-xs border border-border">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Primary</Badge>
                <span className="font-semibold">{defaultProvider.name}</span>
                <span className="text-muted-foreground font-mono">({form.defaultModel || "no model"})</span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                {chainResults[defaultProvider.id] ? (
                  <ChainLinkStatus result={chainResults[defaultProvider.id]} />
                ) : (
                  <span className="text-muted-foreground">Not tested</span>
                )}
              </div>
            </div>
          )}
          {fallbackProviders.map((p, idx) => (
            <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/10 text-xs border border-border">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Fallback #{idx + 1}</Badge>
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted-foreground font-mono">({p.modelName || "no model"})</span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                {chainResults[p.id] ? (
                  <ChainLinkStatus result={chainResults[p.id]} />
                ) : (
                  <span className="text-muted-foreground">Not tested</span>
                )}
              </div>
            </div>
          ))}
          {!defaultProvider && fallbackProviders.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
              Set up a primary or fallback provider to run diagnostics.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fallback Chain */}
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Icon name="Layers" className="w-4 h-4 text-brand" /> Fallback Chain</CardTitle><CardDescription>Providers tried in order if the default fails.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {fallbackProviders.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4 rounded-lg border border-dashed border-border">No fallback providers configured.</div>
          )}
          {fallbackProviders.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{p.type.replace("-", " ")} · {p.modelName}</div>
              </div>
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => { const ids = [...form.fallbackProviderIds]; [ids[i-1], ids[i]] = [ids[i], ids[i-1]]; update({ fallbackProviderIds: ids }); }}><Icon name="ChevronUp" className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" disabled={i === fallbackProviders.length - 1} onClick={() => { const ids = [...form.fallbackProviderIds]; [ids[i+1], ids[i]] = [ids[i], ids[i+1]]; update({ fallbackProviderIds: ids }); }}><Icon name="ChevronDown" className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => update({ fallbackProviderIds: form.fallbackProviderIds.filter((fid) => fid !== p.id) })}><Icon name="X" className="w-4 h-4" /></Button>
            </div>
          ))}
          {availableForFallback.length > 0 && (
            <div className="pt-2 border-t border-border">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Add to fallback chain</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {availableForFallback.map((p) => (
                  <button key={p.id} onClick={() => update({ fallbackProviderIds: [...form.fallbackProviderIds, p.id] })} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-secondary text-xs">
                    <Icon name="Plus" className="w-3 h-3" /> {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent Routing Matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Network" className="w-5 h-5 text-brand" /> Agent Routing Matrix
          </CardTitle>
          <CardDescription>
            Bind individual AI agent roles to specific LLM models or API providers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { key: "optimizer", label: "Optimizer Specialist Agent", desc: "Rewrites and expands experience, skills, and summary sections." },
              { key: "supervisor", label: "Supervisor QA Agent", desc: "Validates compliance, orchestrates correction cycles, and scores outputs." },
              { key: "guardian", label: "Guardian Check Agent", desc: "Checks formatting, ensures entity preservation, and prevents hallucinations." },
              { key: "assembler", label: "Structure Assembler Agent", desc: "Compiles section outputs, removes duplicates, and standardizes layout." }
            ].map((agent) => {
              const currentRoute = form.agentRoutes?.[agent.key] ?? "default";
              return (
                <div key={agent.key} className="p-3 border border-border rounded-lg space-y-2 bg-secondary/5">
                  <div>
                    <Label htmlFor={`route_${agent.key}`} className="font-semibold text-sm">{agent.label}</Label>
                    <p className="text-[10px] text-muted-foreground leading-normal mt-0.5">{agent.desc}</p>
                  </div>
                  <select
                    id={`route_${agent.key}`}
                    value={currentRoute}
                    onChange={(e) => {
                      const nextRoutes = { ...(form.agentRoutes || {}) };
                      nextRoutes[agent.key] = e.target.value;
                      update({ agentRoutes: nextRoutes });
                    }}
                    className="w-full h-9 px-2 rounded-md border border-input bg-background text-xs mt-1"
                  >
                    <option value="default">Default Fallback Chain (Tier-Limited)</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.modelName || p.type})</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Retry & Timeout */}
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Icon name="Timer" className="w-4 h-4 text-gold" /> Retry & Timeout</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Retry attempts</Label>
            <Input type="number" min="0" max="5" value={form.retryAttempts} onChange={(e) => update({ retryAttempts: parseInt(e.target.value) || 0 })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Timeout (ms)</Label>
            <Input type="number" value={form.timeout} onChange={(e) => update({ timeout: parseInt(e.target.value) || 30000 })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Rate limit (req/min)</Label>
            <Input type="number" value={form.rateLimitPerMinute} onChange={(e) => update({ rateLimitPerMinute: parseInt(e.target.value) || 60 })} />
          </div>
        </CardContent>
      </Card>

      {/* Feature toggles */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Routing features</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <ToggleRow label="Enable failover" desc="Automatically try the next provider when one fails" checked={form.enableFailover} onChange={(v) => update({ enableFailover: v })} />
          <ToggleRow label="Enable response caching" desc="Cache identical prompts for 1 hour to save tokens" checked={form.enableCaching} onChange={(v) => update({ enableCaching: v })} />
          <ToggleRow label="Enable cost tracking" desc="Track token usage and estimate cost per provider" checked={form.enableCostTracking} onChange={(v) => update({ enableCostTracking: v })} />
        </CardContent>
      </Card>

      {/* Dynamic Failover Simulation Sandbox */}
      <Card className="border-amber-500/20 bg-amber-500/[0.02]">
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon name="Activity" className="w-5 h-5 text-amber-500 animate-pulse" />
              Dynamic Failover Simulation Sandbox
            </CardTitle>
            <CardDescription className="text-xs">
              Simulate a primary API failure (e.g., 429 Rate Limit) to test and visually trace your fallback chain routing in real-time.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={simulatingFailover}
            onClick={runFailoverSimulation}
            className="border-amber-500/30 hover:bg-amber-500/10 font-semibold"
          >
            {simulatingFailover ? (
              <>
                <Icon name="Loader2" className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Simulating...
              </>
            ) : (
              <>
                <Icon name="Play" className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                Simulate Primary Failure
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="flex flex-wrap gap-4 items-center border-b border-border pb-3">
            <div>
              <span className="text-muted-foreground">Primary Provider:</span>{" "}
              <span className="font-semibold text-foreground/90">{defaultProvider?.name || "None"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Active Fallback Chain:</span>{" "}
              <span className="font-semibold text-foreground/90">{fallbackProviders.map(p => p.name).join(" → ") || "None (Default to failure)"}</span>
            </div>
          </div>

          {/* Simulation Trace Timeline */}
          {failoverTrace.length > 0 ? (
            <div className="space-y-3 border-l border-amber-300 dark:border-amber-700 pl-4 ml-2 mt-2">
              {failoverTrace.map((trace, idx) => (
                <div key={idx} className="relative flex flex-col gap-1 text-xs animate-fadeIn">
                  <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-amber-500 border border-background" />
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground/90">{trace.title}</span>
                    <Badge variant={trace.type === "success" ? "success" : trace.type === "error" ? "danger" : "warning"} className="text-[8px] uppercase tracking-wider px-1 py-0.5">
                      {trace.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{trace.desc}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 bg-secondary/10 rounded border border-dashed border-border text-muted-foreground">
              Click "Simulate Primary Failure" to trace the failover cascading logic.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky save bar */}
      {hasChanges && (
        <div className="sticky bottom-4 z-30 flex justify-end">
          <Button onClick={save} disabled={saving} className="bg-brand hover:bg-brand-dark text-white gap-2 shadow-premium">
            {saving ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Save" className="w-4 h-4" />}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * Task 28 — shared renderer for one Routing Chain Diagnostics link.
 * Replaces the old bare "Unhealthy" ternary: every failure now shows an
 * inline actionable diagnosis (HTTP status · latency · class hint · message
 * excerpt) with the full provider message on hover / to screen readers.
 * HTTP 429 renders as amber "Rate-limited" (provider reachable, key accepted).
 */
function ChainLinkStatus({ result }: { result: ChainLinkTestResult }) {
  const d = chainLinkDisplay(result);
  if (d.state === "testing") {
    return <span className={d.toneClass}>{d.headline}</span>;
  }
  if (d.state === "healthy") {
    return (
      <span className={`flex items-center gap-1 ${d.toneClass}`}>
        <Icon name="Check" className="w-3.5 h-3.5" /> {d.headline} ({d.latencyMs}ms)
      </span>
    );
  }
  return (
    <div className="flex flex-col items-end gap-0.5 text-right">
      <span className={`flex items-center gap-1 ${d.toneClass}`} title={d.fullMessage}>
        <Icon name={d.state === "rate-limited" ? "Clock" : "X"} className="w-3.5 h-3.5" />
        {d.headline}
        {d.latencyMs > 0 ? ` (${d.latencyMs}ms)` : ""}
      </span>
      <span className="text-[10px] leading-snug text-muted-foreground max-w-[420px]" title={d.fullMessage}>
        {d.detailLine}
      </span>
    </div>
  );
}
