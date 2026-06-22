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
  if (!hasChanges && form !== settingsRef && JSON.stringify(form) !== JSON.stringify(settingsRef)) {
    setForm(settingsRef);
  }

  // Model prefetch state
  const [fetchingModels, setFetchingModels] = useState(false);
  const [liveModels, setLiveModels] = useState<string[]>([]);

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
    // === PRESERVE last known valid model list on failure ===
    // Do NOT clear liveModels on failure — keep the previous list so the
    // user's routing configuration stays valid. Only clear on success.
    const result = await ProviderManager.fetchModels(defaultProvider);
    setFetchingModels(false);
    if (result.ok && result.models.length > 0) {
      setLiveModels(result.models);
      toast.success(`Loaded ${result.models.length} ${defaultProvider.type === "puter" ? "built-in" : "live"} models from ${defaultProvider.name}.`);
    } else {
      // === DO NOT clear provider, model, or routing config ===
      // Just show the error — the user's last known valid config is preserved.
      toast.error(result.error || "Failed to fetch models. Your existing configuration is preserved.");
    }
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
                {providers.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                  // Puter uses built-in models — show a static list instead of fetching
                  <Button variant="outline" size="sm" onClick={fetchModels} disabled={fetchingModels} className="gap-1.5 shrink-0">
                    {fetchingModels ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="List" className="w-3.5 h-3.5" />}
                    Show built-in models
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={fetchModels} disabled={fetchingModels || !defaultProvider} className="gap-1.5 shrink-0">
                    {fetchingModels ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="DownloadCloud" className="w-3.5 h-3.5" />}
                    Fetch models
                  </Button>
                )}
              </div>
              {defaultProvider?.type === "puter" && liveModels.length === 0 && <p className="text-[10px] text-muted-foreground">Puter uses built-in models — click "Show built-in models" to load them.</p>}
              {liveModels.length > 0 && <p className="text-[10px] text-muted-foreground">{liveModels.length} {defaultProvider?.type === "puter" ? "built-in" : "live"} models from {defaultProvider?.name}</p>}
            </div>
          </div>
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
