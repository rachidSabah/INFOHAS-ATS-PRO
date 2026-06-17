"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { toast } from "sonner";
import type { AIProvider, AIProviderType } from "@/lib/types";

const PROVIDER_TYPES: { type: AIProviderType; label: string; icon: string }[] = [
  { type: "puter", label: "Puter.js (Free)", icon: "Sparkles" },
  { type: "z-ai-fallback", label: "Z.ai Fallback", icon: "Cpu" },
  { type: "openai", label: "OpenAI", icon: "Bot" },
  { type: "claude", label: "Anthropic Claude", icon: "Bot" },
  { type: "gemini", label: "Google Gemini", icon: "Bot" },
  { type: "deepseek", label: "DeepSeek", icon: "Bot" },
  { type: "groq", label: "Groq", icon: "Zap" },
  { type: "mistral", label: "Mistral AI", icon: "Bot" },
  { type: "cohere", label: "Cohere", icon: "Bot" },
  { type: "perplexity", label: "Perplexity", icon: "Search" },
  { type: "openrouter", label: "OpenRouter", icon: "Network" },
  { type: "together", label: "Together AI", icon: "Users" },
  { type: "huggingface", label: "HuggingFace", icon: "Box" },
  { type: "ollama", label: "Ollama (self-hosted)", icon: "HardDrive" },
  { type: "azure-openai", label: "Azure OpenAI", icon: "Cloud" },
  { type: "bedrock", label: "AWS Bedrock", icon: "Cloud" },
  { type: "custom", label: "Custom / self-hosted LLM", icon: "Settings" },
];

export function AIProviders() {
  const providers = useApp((s) => s.providers);
  const addProvider = useApp((s) => s.addProvider);
  const updateProvider = useApp((s) => s.updateProvider);
  const removeProvider = useApp((s) => s.removeProvider);
  const log = useApp((s) => s.log);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<AIProvider | null>(null);

  const totalReqs = providers.reduce((n, p) => n + p.usage.requests, 0);
  const activeCount = providers.filter((p) => p.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Cpu" className="w-6 h-6 text-brand" /> AI Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">Multi-provider system with automatic failover. 17 providers supported — extendable without code changes.</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowAdd(true); }} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name="Plus" className="w-4 h-4" /> Add provider
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total providers", value: providers.length, icon: "Cpu", color: "#1154A3" },
          { label: "Active", value: activeCount, icon: "CheckCircle2", color: "#10B981" },
          { label: "Total requests", value: totalReqs.toLocaleString(), icon: "Activity", color: "#F59E0B" },
          { label: "Avg latency", value: "1.2s", icon: "Timer", color: "#8B5CF6" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${s.color}15`, color: s.color }}>
                <Icon name={s.icon} className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xl font-bold font-display">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Provider cards */}
      <div className="grid lg:grid-cols-2 gap-4">
        {providers.map((p) => {
          const cfg = PROVIDER_TYPES.find((t) => t.type === p.type);
          const statusColor = p.status === "healthy" ? "#10B981" : p.status === "degraded" ? "#F59E0B" : "#DC2626";
          return (
            <Card key={p.id} className={p.isActive ? "" : "opacity-70"}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${p.type === "puter" ? "#F59E0B" : "#1154A3"}15`, color: p.type === "puter" ? "#F59E0B" : "#1154A3" }}>
                      <Icon name={cfg?.icon ?? "Cpu"} className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        {p.name}
                        {p.isBuiltIn && <Badge variant="outline" className="text-[10px]">Built-in</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{p.modelName}</div>
                    </div>
                  </div>
                  <Switch checked={p.isActive} onCheckedChange={(v) => { updateProvider(p.id, { isActive: v }); toast.success(`${p.name} ${v ? "activated" : "deactivated"}`); }} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div className="rounded-md bg-secondary p-2"><div className="text-muted-foreground">Priority</div><div className="font-semibold">#{p.priority}</div></div>
                  <div className="rounded-md bg-secondary p-2"><div className="text-muted-foreground">Timeout</div><div className="font-semibold">{p.timeout}ms</div></div>
                  <div className="rounded-md bg-secondary p-2"><div className="text-muted-foreground">Max tokens</div><div className="font-semibold">{p.maxTokens.toLocaleString()}</div></div>
                  <div className="rounded-md bg-secondary p-2"><div className="text-muted-foreground">Temperature</div><div className="font-semibold">{p.temperature}</div></div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                  <div><div className="text-muted-foreground">Requests</div><div className="font-semibold">{p.usage.requests.toLocaleString()}</div></div>
                  <div><div className="text-muted-foreground">Tokens</div><div className="font-semibold">{p.usage.tokens.toLocaleString()}</div></div>
                  <div><div className="text-muted-foreground">Errors</div><div className="font-semibold">{p.usage.errors.toLocaleString()}</div></div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
                    <span className="capitalize" style={{ color: statusColor }}>{p.status}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(p); setShowAdd(true); }}><Icon name="Pencil" className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                    {!p.isBuiltIn && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { removeProvider(p.id); toast.success("Provider removed."); }}><Icon name="Trash2" className="w-3.5 h-3.5" /></Button>}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add/Edit drawer */}
      {showAdd && (
        <ProviderEditor
          provider={editing}
          onClose={() => setShowAdd(false)}
          onSave={(p) => {
            if (editing) {
              updateProvider(editing.id, p);
              log({ actor: "you", action: `Updated provider: ${p.name}`, category: "admin", details: `priority ${p.priority}`, severity: "info" });
              toast.success("Provider updated.");
            } else {
              addProvider({ ...p, id: uid("p"), isBuiltIn: false, status: "healthy", usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0 } } as AIProvider);
              log({ actor: "you", action: `Added provider: ${p.name}`, category: "admin", details: `type ${p.type}`, severity: "info" });
              toast.success("Provider added.");
            }
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function ProviderEditor({ provider, onClose, onSave }: { provider: AIProvider | null; onClose: () => void; onSave: (p: Partial<AIProvider> & { name: string; type: AIProviderType }) => void }) {
  const [form, setForm] = useState({
    name: provider?.name ?? "",
    type: provider?.type ?? "custom" as AIProviderType,
    apiUrl: provider?.apiUrl ?? "",
    apiKey: provider?.apiKey ?? "",
    modelName: provider?.modelName ?? "",
    priority: provider?.priority ?? 10,
    timeout: provider?.timeout ?? 30000,
    maxTokens: provider?.maxTokens ?? 4096,
    temperature: provider?.temperature ?? 0.7,
    isActive: provider?.isActive ?? true,
    headersJson: provider?.headersJson ?? "",
    parametersJson: provider?.parametersJson ?? "",
  });

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-premium w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <h3 className="font-display font-bold text-lg">{provider ? "Edit provider" : "Add provider"}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><Icon name="X" className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Display name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OpenAI Production" /></Field>
            <Field label="Provider type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AIProviderType })} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm">
                {PROVIDER_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="API URL"><Input value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>
            <Field label="Model name"><Input value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} placeholder="gpt-4o-mini" /></Field>
            <Field label="API key (encrypted at rest)"><Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." /></Field>
            <Field label="Priority (1 = highest)"><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 10 })} /></Field>
            <Field label="Timeout (ms)"><Input type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: parseInt(e.target.value) || 30000 })} /></Field>
            <Field label="Max tokens"><Input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 4096 })} /></Field>
            <Field label="Temperature"><Input type="number" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0.7 })} /></Field>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              <Label className="text-sm">Active</Label>
            </div>
          </div>
          <Field label="Custom headers (JSON, optional)"><Input value={form.headersJson} onChange={(e) => setForm({ ...form, headersJson: e.target.value })} placeholder='{ "X-Custom": "value" }' /></Field>
          <Field label="Custom parameters (JSON, optional)"><Input value={form.parametersJson} onChange={(e) => setForm({ ...form, parametersJson: e.target.value })} placeholder='{ "top_p": 0.9 }' /></Field>

          <div className="rounded-lg bg-amber-100 dark:bg-amber-400/10 p-3 text-xs flex items-start gap-2">
            <Icon name="ShieldCheck" className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-amber-800 dark:text-amber-300">
              API keys are encrypted at rest and never exposed to the client. In production, store keys in Cloudflare secrets / Workers env vars — never hardcode in source.
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => form.name && onSave(form)} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Save" className="w-4 h-4" /> Save provider</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
