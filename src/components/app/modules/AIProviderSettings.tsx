"use client";

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

  const update = (patch: Partial<typeof settings>) => {
    ProviderManager.updateSettings(patch);
    toast.success("Settings saved.");
  };

  const fallbackProviders = settings.fallbackProviderIds
    .map((id) => providers.find((p) => p.id === id))
    .filter(Boolean) as typeof providers;

  const availableForFallback = providers.filter((p) => p.id !== settings.defaultProviderId && !settings.fallbackProviderIds.includes(p.id));

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Settings" className="w-6 h-6 text-brand" /> AI Routing Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure default provider, fallback chain, retry policy, and rate limits.</p>
      </div>

      {/* Default provider */}
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Icon name="Star" className="w-4 h-4 text-gold" /> Default Provider</CardTitle><CardDescription>Used first for every request.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Default provider</Label>
              <select
                value={settings.defaultProviderId ?? ""}
                onChange={(e) => update({ defaultProviderId: e.target.value || null })}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">— None —</option>
                {providers.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Default model</Label>
              <Input value={settings.defaultModel} onChange={(e) => update({ defaultModel: e.target.value })} placeholder="claude-sonnet-4" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fallback chain */}
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Icon name="Layers" className="w-4 h-4 text-brand" /> Fallback Chain</CardTitle><CardDescription>Providers tried in order if the default fails.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {fallbackProviders.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4 rounded-lg border border-dashed border-border">
              No fallback providers configured. Add some below.
            </div>
          )}
          {fallbackProviders.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{p.type.replace("-", " ")} · {p.modelName}</div>
              </div>
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => ProviderManager.reorderFallback(p.id, "up")}><Icon name="ChevronUp" className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" disabled={i === fallbackProviders.length - 1} onClick={() => ProviderManager.reorderFallback(p.id, "down")}><Icon name="ChevronDown" className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { ProviderManager.toggleFallback(p.id); toast.success(`${p.name} removed from fallback chain.`); }}><Icon name="X" className="w-4 h-4" /></Button>
            </div>
          ))}
          {availableForFallback.length > 0 && (
            <div className="pt-2 border-t border-border">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Add to fallback chain</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {availableForFallback.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { ProviderManager.toggleFallback(p.id); toast.success(`${p.name} added to fallback chain.`); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-secondary text-xs"
                  >
                    <Icon name="Plus" className="w-3 h-3" /> {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Retry & timeout */}
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Icon name="Timer" className="w-4 h-4 text-gold" /> Retry & Timeout</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Retry attempts</Label>
            <Input type="number" min="0" max="5" value={settings.retryAttempts} onChange={(e) => update({ retryAttempts: parseInt(e.target.value) || 0 })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Timeout (ms)</Label>
            <Input type="number" value={settings.timeout} onChange={(e) => update({ timeout: parseInt(e.target.value) || 30000 })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Rate limit (req/min)</Label>
            <Input type="number" value={settings.rateLimitPerMinute} onChange={(e) => update({ rateLimitPerMinute: parseInt(e.target.value) || 60 })} />
          </div>
        </CardContent>
      </Card>

      {/* Feature toggles */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Routing features</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <ToggleRow label="Enable failover" desc="Automatically try the next provider when one fails" checked={settings.enableFailover} onChange={(v) => update({ enableFailover: v })} />
          <ToggleRow label="Enable response caching" desc="Cache identical prompts for 1 hour to save tokens" checked={settings.enableCaching} onChange={(v) => update({ enableCaching: v })} />
          <ToggleRow label="Enable cost tracking" desc="Track token usage and estimate cost per provider" checked={settings.enableCostTracking} onChange={(v) => update({ enableCostTracking: v })} />
        </CardContent>
      </Card>
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
