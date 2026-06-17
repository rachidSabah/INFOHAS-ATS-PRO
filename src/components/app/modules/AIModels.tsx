"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";

// Common models per provider type — used to populate the model picker
const MODEL_CATALOG: Record<string, { name: string; contextWindow: string; inputCost?: number; outputCost?: number; tags?: string[] }[]> = {
  openai: [
    { name: "gpt-4o", contextWindow: "128K", inputCost: 0.0000025, outputCost: 0.00001, tags: ["flagship", "vision"] },
    { name: "gpt-4o-mini", contextWindow: "128K", inputCost: 0.00000015, outputCost: 0.0000006, tags: ["cheap", "fast"] },
    { name: "gpt-4-turbo", contextWindow: "128K", inputCost: 0.00001, outputCost: 0.00003 },
    { name: "o1-preview", contextWindow: "128K", inputCost: 0.000015, outputCost: 0.00006, tags: ["reasoning"] },
  ],
  claude: [
    { name: "claude-3-5-sonnet-20241022", contextWindow: "200K", inputCost: 0.000003, outputCost: 0.000015, tags: ["flagship"] },
    { name: "claude-3-5-haiku-20241022", contextWindow: "200K", inputCost: 0.0000008, outputCost: 0.000004, tags: ["fast"] },
    { name: "claude-3-opus-20240229", contextWindow: "200K", inputCost: 0.000015, outputCost: 0.000075 },
  ],
  gemini: [
    { name: "gemini-2.0-flash", contextWindow: "1M", inputCost: 0.0000001, outputCost: 0.0000004, tags: ["fast", "vision"] },
    { name: "gemini-1.5-pro", contextWindow: "2M", inputCost: 0.00000125, outputCost: 0.000005 },
    { name: "gemini-1.5-flash", contextWindow: "1M", inputCost: 0.000000075, outputCost: 0.0000003 },
  ],
  deepseek: [
    { name: "deepseek-chat", contextWindow: "64K", inputCost: 0.00000014, outputCost: 0.00000028 },
    { name: "deepseek-reasoner", contextWindow: "64K", inputCost: 0.00000055, outputCost: 0.00000219, tags: ["reasoning"] },
  ],
  groq: [
    { name: "llama-3.3-70b-versatile", contextWindow: "128K", tags: ["fast", "free"] },
    { name: "llama-3.1-8b-instant", contextWindow: "128K", tags: ["fastest"] },
    { name: "mixtral-8x7b-32768", contextWindow: "32K" },
  ],
  puter: [
    { name: "claude-sonnet-4", contextWindow: "200K", tags: ["free", "flagship"] },
    { name: "gpt-4o", contextWindow: "128K", tags: ["free"] },
    { name: "gemini-2.0-flash", contextWindow: "1M", tags: ["free"] },
    { name: "llama-3.3-70b", contextWindow: "128K", tags: ["free"] },
    { name: "mistral-large", contextWindow: "128K", tags: ["free"] },
  ],
  ollama: [
    { name: "llama3.3:70b", contextWindow: "128K", tags: ["self-hosted"] },
    { name: "qwen2.5:32b", contextWindow: "32K", tags: ["self-hosted"] },
    { name: "mistral-nemo", contextWindow: "128K", tags: ["self-hosted"] },
    { name: "phi4:14b", contextWindow: "16K", tags: ["self-hosted", "small"] },
  ],
};

export function AIModels() {
  const providers = useApp((s) => s.providers);
  const updateProvider = useApp((s) => s.updateProvider);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providers[0]?.id ?? "");
  const [customModel, setCustomModel] = useState("");

  const selected = providers.find((p) => p.id === selectedProviderId);
  const catalog = selected ? (MODEL_CATALOG[selected.type] ?? []) : [];
  const enabledModels = selected?.enabledModels ?? [];

  const toggleModel = (modelName: string) => {
    if (!selected) return;
    const current = selected.enabledModels ?? [];
    const next = current.includes(modelName)
      ? current.filter((m) => m !== modelName)
      : [...current, modelName];
    updateProvider(selected.id, { enabledModels: next });
    toast.success(`${modelName} ${next.includes(modelName) ? "enabled" : "disabled"} for ${selected.name}.`);
  };

  const addCustom = () => {
    if (!selected || !customModel.trim()) return;
    const next = [...(selected.enabledModels ?? []), customModel.trim()];
    updateProvider(selected.id, { enabledModels: next });
    setCustomModel("");
    toast.success(`Added custom model: ${customModel.trim()}`);
  };

  const setAsDefaultModel = (modelName: string) => {
    if (!selected) return;
    updateProvider(selected.id, { modelName });
    toast.success(`${modelName} set as default model for ${selected.name}.`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Boxes" className="w-6 h-6 text-brand" /> AI Models</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse the model catalog and enable specific models per provider.</p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Provider picker */}
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">Providers</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProviderId(p.id)}
                className={`w-full text-left p-2.5 rounded-md text-sm transition ${selectedProviderId === p.id ? "bg-brand text-white" : "hover:bg-secondary"}`}
              >
                <div className="font-medium truncate">{p.name}</div>
                <div className={`text-xs ${selectedProviderId === p.id ? "text-white/70" : "text-muted-foreground"} capitalize`}>{p.type.replace("-", " ")}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Model catalog */}
        <div className="lg:col-span-9 space-y-4">
          {selected && (
            <>
              <Card>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      {selected.name}
                      <Badge variant="outline" className="capitalize text-[10px]">{selected.type.replace("-", " ")}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Default model: <span className="font-mono">{selected.modelName || "—"}</span> · {enabledModels.length} models enabled
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Add custom model */}
              <Card>
                <CardContent className="p-4 flex gap-2">
                  <Input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="Add custom model name (e.g. gpt-4o-2024-08-06)" onKeyDown={(e) => e.key === "Enter" && addCustom()} />
                  <Button onClick={addCustom} disabled={!customModel.trim()} className="bg-brand hover:bg-brand-dark text-white gap-2 shrink-0">
                    <Icon name="Plus" className="w-4 h-4" /> Add
                  </Button>
                </CardContent>
              </Card>

              {/* Catalog grid */}
              {catalog.length > 0 ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {catalog.map((m) => {
                    const isEnabled = enabledModels.includes(m.name);
                    const isDefault = selected.modelName === m.name;
                    return (
                      <Card key={m.name} className={isEnabled ? "border-brand" : ""}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="font-mono text-sm font-semibold break-all">{m.name}</div>
                            {isDefault && <Badge variant="gold" className="text-[9px]">DEFAULT</Badge>}
                          </div>
                          <div className="flex flex-wrap gap-1 mb-3">
                            <Badge variant="outline" className="text-[10px]">{m.contextWindow} ctx</Badge>
                            {m.tags?.map((t) => <Badge key={t} variant="brand" className="text-[10px]">{t}</Badge>)}
                          </div>
                          {(m.inputCost || m.outputCost) && (
                            <div className="text-xs text-muted-foreground mb-3">
                              ${(m.inputCost ?? 0).toFixed(7)}/in · ${(m.outputCost ?? 0).toFixed(7)}/out
                            </div>
                          )}
                          <div className="flex gap-1">
                            <Button size="sm" variant={isEnabled ? "default" : "outline"} onClick={() => toggleModel(m.name)} className="flex-1 gap-1.5">
                              <Icon name={isEnabled ? "Check" : "Plus"} className="w-3.5 h-3.5" /> {isEnabled ? "Enabled" : "Enable"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setAsDefaultModel(m.name)} title="Set as default">
                              <Icon name="Star" className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Icon name="Boxes" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground mt-2">No catalog models for {selected.type}. Add custom model names above.</p>
                  </CardContent>
                </Card>
              )}

              {/* Enabled models list */}
              {enabledModels.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Enabled models ({enabledModels.length})</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {enabledModels.map((m) => (
                        <div key={m} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card">
                          <span className="font-mono text-xs">{m}</span>
                          <button onClick={() => toggleModel(m)} className="text-muted-foreground hover:text-destructive" aria-label="Remove">
                            <Icon name="X" className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
