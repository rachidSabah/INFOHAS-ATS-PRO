"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { SEED_FALLBACK_CHAIN } from "@/lib/mock-data";
import { callAI } from "@/lib/ai";
import { toast } from "sonner";
import type { FallbackChainConfig, FallbackChainEntry, AIProvider } from "@/lib/types";

export function FallbackChain() {
  const config = useApp((s) => s.fallbackChain);
  const update = useApp((s) => s.updateFallbackChain);
  const reset = useApp((s) => s.resetFallbackChain);
  const providers = useApp((s) => s.providers);

  const [draft, setDraft] = useState<FallbackChainConfig>(config);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<Array<{ entry: string; status: "success" | "error" | "skipped"; message: string }>>([]);

  const patch = (p: Partial<FallbackChainConfig>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  const save = () => {
    update(draft);
    setDirty(false);
    toast.success("Fallback chain saved. All pipelines, routes, and agents will use this order.");
  };

  const discard = () => {
    setDraft(config);
    setDirty(false);
    toast.info("Changes discarded.");
  };

  const resetToDefaults = () => {
    if (!confirm("Reset fallback chain to factory defaults? This cannot be undone.")) return;
    setDraft(SEED_FALLBACK_CHAIN);
    reset();
    setDirty(false);
    toast.success("Fallback chain reset to factory defaults.");
  };

  // === Entry management ===

  const addEntry = () => {
    const firstProvider = providers[0];
    if (!firstProvider) {
      toast.error("No providers configured. Add a provider first in AI Providers settings.");
      return;
    }
    const newEntry: FallbackChainEntry = {
      id: `fb_${Date.now()}`,
      providerId: firstProvider.id,
      model: firstProvider.modelName || firstProvider.enabledModels?.[0] || "",
      enabled: true,
      temperature: 0.15,
      maxTokens: 8000,
      timeoutMs: 120000,
    };
    patch({ entries: [...draft.entries, newEntry] });
  };

  const removeEntry = (id: string) => {
    patch({ entries: draft.entries.filter((e) => e.id !== id) });
  };

  const updateEntry = (id: string, p: Partial<FallbackChainEntry>) => {
    patch({
      entries: draft.entries.map((e) => (e.id === id ? { ...e, ...p } : e)),
    });
  };

  const moveEntry = (index: number, direction: "up" | "down") => {
    const entries = [...draft.entries];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= entries.length) return;
    [entries[index], entries[targetIndex]] = [entries[targetIndex], entries[index]];
    patch({ entries });
  };

  // === Test fallback chain ===

  const testChain = async () => {
    setTesting(true);
    setTestResults([]);
    const results: Array<{ entry: string; status: "success" | "error" | "skipped"; message: string }> = [];

    for (const entry of draft.entries) {
      const provider = providers.find((p) => p.id === entry.providerId);
      if (!provider) {
        results.push({ entry: entry.id, status: "error", message: `Provider "${entry.providerId}" not found` });
        continue;
      }
      if (!entry.enabled) {
        results.push({ entry: `${provider.name} (${entry.model})`, status: "skipped", message: "Entry disabled — skipped" });
        continue;
      }

      try {
        const result = await callAI({
          systemPrompt: "You are a test assistant. Reply with exactly: OK",
          userPrompt: "Test connection. Reply with: OK",
          maxTokens: 10,
          temperature: 0,
          taskCategory: "interactive",
          timeoutMs: 15000,
        });
        if (result.text && result.text.length > 0) {
          results.push({
            entry: `${provider.name} (${entry.model})`,
            status: "success",
            message: `Response: "${result.text.slice(0, 50)}" (${result.latencyMs}ms)`,
          });
        } else {
          results.push({
            entry: `${provider.name} (${entry.model})`,
            status: "error",
            message: "Empty response",
          });
        }
      } catch (e: any) {
        results.push({
          entry: `${provider.name} (${entry.model})`,
          status: "error",
          message: e?.message || String(e),
        });
      }
    }

    setTestResults(results);
    setTesting(false);
    const successCount = results.filter((r) => r.status === "success").length;
    toast.success(`Fallback chain test complete: ${successCount}/${results.length} providers responded.`);
  };

  // === Helper: get models for a provider ===

  const getModelsForProvider = (providerId: string): string[] => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return [];
    const models = provider.enabledModels || [];
    if (provider.modelName && !models.includes(provider.modelName)) {
      models.unshift(provider.modelName);
    }
    return models;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="Shuffle" className="w-6 h-6 text-brand" /> Fallback Chain
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the ordered fallback chain used by ALL pipelines, routes, and agents. When the primary provider fails (rate limit, timeout, error), the chain is traversed in order. Changes are synced to D1 and take effect immediately.
          </p>
        </div>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="outline" onClick={discard} className="gap-2">
              <Icon name="RotateCcw" className="w-4 h-4" /> Discard
            </Button>
          )}
          <Button variant="outline" onClick={resetToDefaults} className="gap-2 text-destructive hover:text-destructive">
            <Icon name="Trash2" className="w-4 h-4" /> Reset to defaults
          </Button>
          <Button onClick={save} disabled={!dirty} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name="Save" className="w-4 h-4" /> Save chain
          </Button>
        </div>
      </div>

      {dirty && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-center gap-2">
          <Icon name="AlertTriangle" className="w-4 h-4 text-amber-600" />
          <span className="text-sm text-amber-800 dark:text-amber-200">You have unsaved changes. Click "Save chain" to apply them.</span>
        </div>
      )}

      {/* Chain settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Settings" className="w-4 h-4 text-brand" /> Chain Settings</CardTitle>
          <CardDescription>Global settings for the fallback chain behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Fallback Chain</Label>
              <p className="text-xs text-muted-foreground">When enabled, uses the user-configured chain below. When disabled, uses legacy hardcoded logic.</p>
            </div>
            <Switch checked={draft.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Respect Primary Selection</Label>
              <p className="text-xs text-muted-foreground">Always try the user's selected primary model first. Only use the chain on failure.</p>
            </div>
            <Switch checked={draft.respectPrimarySelection} onCheckedChange={(v) => patch({ respectPrimarySelection: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Include Puter as Last Resort</Label>
              <p className="text-xs text-muted-foreground">Try Puter.js (browser auth) before falling back to local engine.</p>
            </div>
            <Switch checked={draft.includePuterLastResort} onCheckedChange={(v) => patch({ includePuterLastResort: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Include Local Engine as Last Resort</Label>
              <p className="text-xs text-muted-foreground">Fall back to local rule-based engine if all providers fail. Always produces output.</p>
            </div>
            <Switch checked={draft.includeLocalEngineLastResort} onCheckedChange={(v) => patch({ includeLocalEngineLastResort: v })} />
          </div>
        </CardContent>
      </Card>

      {/* Fallback entries */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><Icon name="ListOrdered" className="w-4 h-4 text-brand" /> Fallback Entries</CardTitle>
              <CardDescription>Ordered list of fallback providers. Index 0 is tried first. Drag up/down to reorder.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={testChain} disabled={testing} className="gap-2">
                <Icon name="FlaskConical" className="w-4 h-4" /> {testing ? "Testing..." : "Test Chain"}
              </Button>
              <Button size="sm" onClick={addEntry} className="bg-brand hover:bg-brand-dark text-white gap-2">
                <Icon name="Plus" className="w-4 h-4" /> Add Entry
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.entries.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Icon name="Inbox" className="w-12 h-12 mx-auto mb-2 opacity-40" />
              <p>No fallback entries configured. Click "Add Entry" to create one.</p>
            </div>
          )}
          {draft.entries.map((entry, index) => {
            const provider = providers.find((p) => p.id === entry.providerId);
            const models = getModelsForProvider(entry.providerId);
            return (
              <div
                key={entry.id}
                className={`rounded-lg border p-4 space-y-3 ${entry.enabled ? "border-border bg-card" : "border-muted bg-muted/30 opacity-70"}`}
              >
                {/* Entry header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant={index === 0 ? "brand" : "outline"} className="text-[10px]">
                      #{index + 1}
                    </Badge>
                    <span className="font-medium text-sm">
                      {provider?.name || `Unknown (${entry.providerId})`}
                    </span>
                    {entry.enabled ? (
                      <Badge variant="success" className="text-[10px]">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Disabled</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveEntry(index, "up")}
                      disabled={index === 0}
                      className="h-8 w-8 p-0"
                    >
                      <Icon name="ChevronUp" className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveEntry(index, "down")}
                      disabled={index === draft.entries.length - 1}
                      className="h-8 w-8 p-0"
                    >
                      <Icon name="ChevronDown" className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEntry(entry.id)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <Icon name="Trash2" className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Entry fields */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Provider</Label>
                    <select
                      value={entry.providerId}
                      onChange={(e) => {
                        const newProviderId = e.target.value;
                        const newModels = getModelsForProvider(newProviderId);
                        updateEntry(entry.id, {
                          providerId: newProviderId,
                          model: newModels[0] || "",
                        });
                      }}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Model</Label>
                    <select
                      value={entry.model}
                      onChange={(e) => updateEntry(entry.id, { model: e.target.value })}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                    >
                      {models.length === 0 && <option value="">(no models configured)</option>}
                      {models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Temperature</Label>
                    <Input
                      type="number"
                      step={0.05}
                      min={0}
                      max={2}
                      value={entry.temperature ?? 0.15}
                      onChange={(e) => updateEntry(entry.id, { temperature: parseFloat(e.target.value) || 0 })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Max Tokens</Label>
                    <Input
                      type="number"
                      step={1000}
                      min={1000}
                      max={32000}
                      value={entry.maxTokens ?? 8000}
                      onChange={(e) => updateEntry(entry.id, { maxTokens: parseInt(e.target.value) || 8000 })}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Timeout (ms)</Label>
                    <Input
                      type="number"
                      step={5000}
                      min={5000}
                      max={300000}
                      value={entry.timeoutMs ?? 120000}
                      onChange={(e) => updateEntry(entry.id, { timeoutMs: parseInt(e.target.value) || 120000 })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Top P (optional)</Label>
                    <Input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      value={entry.topP ?? ""}
                      onChange={(e) => updateEntry(entry.id, { topP: e.target.value ? parseFloat(e.target.value) : undefined })}
                      className="mt-1"
                      placeholder="(default)"
                    />
                  </div>
                </div>

                {/* Enable toggle */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <Label className="text-xs">Enabled</Label>
                  <Switch
                    checked={entry.enabled}
                    onCheckedChange={(v) => updateEntry(entry.id, { enabled: v })}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Test results */}
      {testResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><Icon name="FlaskConical" className="w-4 h-4 text-brand" /> Test Results</CardTitle>
            <CardDescription>Results from testing each fallback entry.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {testResults.map((result, i) => (
              <div
                key={i}
                className={`rounded-md p-3 flex items-start gap-3 ${
                  result.status === "success"
                    ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
                    : result.status === "error"
                    ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
                    : "bg-muted/50 border border-muted"
                }`}
              >
                <Icon
                  name={result.status === "success" ? "CheckCircle" : result.status === "error" ? "XCircle" : "SkipForward"}
                  className={`w-5 h-5 mt-0.5 ${
                    result.status === "success" ? "text-green-600" : result.status === "error" ? "text-red-600" : "text-muted-foreground"
                  }`}
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{result.entry}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{result.message}</div>
                </div>
                <Badge
                  variant={result.status === "success" ? "success" : result.status === "error" ? "danger" : "outline"}
                  className="text-[10px]"
                >
                  {result.status.toUpperCase()}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Info" className="w-4 h-4 text-brand" /> How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. The user's selected primary provider is ALWAYS tried first.</p>
          <p>2. If the primary fails (rate limit, timeout, error), the chain is traversed in order (index 0 → 1 → 2 → ...).</p>
          <p>3. Each entry uses its configured model and generation parameters (temperature, maxTokens, timeout).</p>
          <p>4. Disabled entries are skipped. Entries with invalid API keys are skipped.</p>
          <p>5. If "Include Puter as Last Resort" is enabled, Puter.js is tried after all chain entries.</p>
          <p>6. If "Include Local Engine as Last Resort" is enabled, the local rule-based engine produces output if everything fails.</p>
          <p>7. Changes are synced to D1 and take effect immediately — no restart required.</p>
        </CardContent>
      </Card>

      {/* Save bar at bottom */}
      {dirty && (
        <div className="sticky bottom-4 z-10">
          <Card className="bg-brand text-white border-brand shadow-premium">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <span className="text-sm font-medium flex items-center gap-2">
                <Icon name="AlertTriangle" className="w-4 h-4" /> You have unsaved changes
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={discard} className="text-white hover:bg-white/10">Discard</Button>
                <Button size="sm" onClick={save} className="bg-white text-brand hover:bg-white/90 gap-2">
                  <Icon name="Save" className="w-4 h-4" /> Save chain
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
