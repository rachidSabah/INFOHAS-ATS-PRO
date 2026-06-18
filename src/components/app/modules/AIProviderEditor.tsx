"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { ProviderManager } from "@/lib/ai/services";
import { toast } from "sonner";
import type { AIProvider, AIProviderType } from "@/lib/types";

const PROVIDER_TYPES: { type: AIProviderType; label: string; icon: string; defaultUrl?: string; defaultModel?: string; authType?: "bearer" | "header" | "query" | "none" }[] = [
  { type: "puter", label: "Puter.js (Free)", icon: "Sparkles", defaultUrl: "https://api.puter.com", defaultModel: "claude-sonnet-4", authType: "none" },
  { type: "opencode", label: "OpenCode Zen (Free models)", icon: "Gift", defaultUrl: "https://opencode.ai/zen/v1", defaultModel: "deepseek-v4-flash-free", authType: "bearer" },
  { type: "z-ai-fallback", label: "Z.ai Fallback (built-in)", icon: "Cpu", defaultUrl: "internal", defaultModel: "glm-4.6", authType: "none" },
  { type: "openai", label: "OpenAI", icon: "Bot", defaultUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", authType: "bearer" },
  { type: "claude", label: "Anthropic Claude", icon: "Bot", defaultUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-20241022", authType: "header" },
  { type: "gemini", label: "Google Gemini", icon: "Bot", defaultUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash", authType: "query" },
  { type: "deepseek", label: "DeepSeek", icon: "Bot", defaultUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", authType: "bearer" },
  { type: "groq", label: "Groq", icon: "Zap", defaultUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", authType: "bearer" },
  { type: "mistral", label: "Mistral AI", icon: "Bot", defaultUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest", authType: "bearer" },
  { type: "cohere", label: "Cohere", icon: "Bot", defaultUrl: "https://api.cohere.com/v2", defaultModel: "command-r-plus", authType: "bearer" },
  { type: "perplexity", label: "Perplexity", icon: "Search", defaultUrl: "https://api.perplexity.ai", defaultModel: "llama-3.1-sonar-large-128k-online", authType: "bearer" },
  { type: "openrouter", label: "OpenRouter", icon: "Network", defaultUrl: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude-3.5-sonnet", authType: "bearer" },
  { type: "together", label: "Together AI", icon: "Users", defaultUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", authType: "bearer" },
  { type: "huggingface", label: "HuggingFace", icon: "Box", defaultUrl: "https://api-inference.huggingface.co/models", defaultModel: "meta-llama/Llama-3.3-70B-Instruct", authType: "bearer" },
  { type: "ollama", label: "Ollama (self-hosted)", icon: "HardDrive", defaultUrl: "http://localhost:11434", defaultModel: "llama3.3:70b", authType: "none" },
  { type: "azure-openai", label: "Azure OpenAI", icon: "Cloud", defaultUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}", defaultModel: "gpt-4o", authType: "header" },
  { type: "bedrock", label: "AWS Bedrock", icon: "Cloud", defaultUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", defaultModel: "anthropic.claude-3-5-sonnet-20241022-v1:0", authType: "bearer" },
  { type: "custom", label: "Custom / self-hosted LLM", icon: "Settings", defaultUrl: "", defaultModel: "", authType: "bearer" },
];

export function ProviderEditor({ provider, onClose, onSave }: {
  provider: AIProvider | null;
  onClose: () => void;
  onSave: (p: Partial<AIProvider>) => void;
}) {
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [form, setForm] = useState(() => ({
    name: provider?.name ?? "",
    type: (provider?.type ?? "custom") as AIProviderType,
    baseUrl: provider?.baseUrl ?? provider?.apiUrl ?? "",
    apiKey: provider?.apiKey ?? "",
    modelName: provider?.modelName ?? "",
    temperature: provider?.temperature ?? 0.7,
    maxTokens: provider?.maxTokens ?? 4096,
    headersJson: provider?.headersJson ?? "",
    parametersJson: provider?.parametersJson ?? "",
    requestTemplate: provider?.requestTemplate ?? "",
    responsePath: provider?.responsePath ?? "",
    streamingEnabled: provider?.streamingEnabled ?? false,
    priority: provider?.priority ?? 10,
    isActive: provider?.isActive ?? true,
    isDefault: provider?.isDefault ?? false,
    timeout: provider?.timeout ?? 30000,
    retryAttempts: provider?.retryAttempts ?? 2,
    rateLimitPerMinute: provider?.rateLimitPerMinute ?? 60,
    authType: (provider?.authType ?? "bearer") as "bearer" | "header" | "query" | "none",
    supportsFunctionCalling: provider?.supportsFunctionCalling ?? false,
    allowedForRegularUsers: provider?.allowedForRegularUsers ?? false,
    costPerInputToken: provider?.costPerInputToken ?? 0,
    costPerOutputToken: provider?.costPerOutputToken ?? 0,
    // Puter
    applicationId: provider?.applicationId ?? "",
    clientId: provider?.clientId ?? "",
    redirectUri: provider?.redirectUri ?? "",
    enabledModels: provider?.enabledModels?.join(", ") ?? "",
  }));

  const cfg = PROVIDER_TYPES.find((t) => t.type === form.type);
  const isCustom = form.type === "custom";
  const isPuter = form.type === "puter";

  const onTypeChange = (type: AIProviderType) => {
    const t = PROVIDER_TYPES.find((x) => x.type === type)!;
    setForm((f) => ({
      ...f,
      type,
      baseUrl: f.baseUrl || t.defaultUrl || "",
      modelName: f.modelName || t.defaultModel || "",
      authType: t.authType ?? "bearer",
    }));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-premium w-full sm:max-w-3xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
          <h3 className="font-display font-bold text-lg flex items-center gap-2">
            <Icon name={cfg?.icon ?? "Cpu"} className="w-5 h-5 text-brand" />
            {provider ? "Edit provider" : "Add provider"}
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}><Icon name="X" className="w-4 h-4" /></Button>
        </div>

        <div className="p-5 space-y-5">
          {/* Type selector */}
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Provider type</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 max-h-44 overflow-y-auto p-1 rounded-lg bg-secondary/50">
              {PROVIDER_TYPES.map((t) => (
                <button
                  key={t.type}
                  onClick={() => onTypeChange(t.type)}
                  className={`flex items-center gap-1.5 p-2 rounded-md text-xs font-medium transition ${form.type === t.type ? "bg-brand text-white shadow-sm" : "bg-card hover:bg-secondary text-muted-foreground"}`}
                  title={t.label}
                >
                  <Icon name={t.icon} className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t.label.split(" ")[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Basic fields */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Display name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OpenAI Production" /></Field>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Model name</Label>
              <div className="flex gap-2">
                <Input value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} placeholder={cfg?.defaultModel ?? "gpt-4o-mini"} className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!form.baseUrl) { toast.error("Enter a Base URL first."); return; }
                    setFetchingModels(true);
                    setFetchedModels([]);
                    const result = await ProviderManager.fetchModelsForConfig({
                      type: form.type,
                      baseUrl: form.baseUrl,
                      apiKey: form.apiKey,
                      headersJson: form.headersJson,
                      authType: form.authType,
                      timeout: form.timeout,
                    });
                    setFetchingModels(false);
                    if (result.ok && result.models.length > 0) {
                      setFetchedModels(result.models);
                      toast.success(`Fetched ${result.models.length} models from the API.`);
                    } else {
                      toast.error(result.error || "No models returned. Check the API key and Base URL.");
                    }
                  }}
                  disabled={fetchingModels || !form.baseUrl}
                  className="gap-1.5 shrink-0"
                >
                  {fetchingModels ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="DownloadCloud" className="w-3.5 h-3.5" />}
                  Fetch
                </Button>
              </div>
              {fetchedModels.length > 0 && (
                <div className="mt-1">
                  <select
                    value={form.modelName}
                    onChange={(e) => setForm({ ...form, modelName: e.target.value })}
                    className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm"
                  >
                    <option value="">— Select a model —</option>
                    {fetchedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{fetchedModels.length} live models fetched from the API</p>
                </div>
              )}
            </div>
            <Field label="Base URL"><Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={cfg?.defaultUrl ?? "https://api.example.com/v1"} /></Field>
            <Field label="API key (encrypted at rest)">
              <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={isPuter ? "(not required for Puter)" : "sk-..."} disabled={isPuter} />
            </Field>
            <Field label="Auth type">
              <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as any })} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm">
                <option value="bearer">Bearer token (Authorization header)</option>
                <option value="header">Custom header (X-API-Key)</option>
                <option value="query">Query parameter (?api_key=)</option>
                <option value="none">None (open endpoint)</option>
              </select>
            </Field>
            <Field label="Priority (1 = highest)"><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 10 })} /></Field>
            <Field label="Temperature"><Input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0.7 })} /></Field>
            <Field label="Max tokens"><Input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 4096 })} /></Field>
            <Field label="Timeout (ms)"><Input type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: parseInt(e.target.value) || 30000 })} /></Field>
            <Field label="Retry attempts"><Input type="number" value={form.retryAttempts} onChange={(e) => setForm({ ...form, retryAttempts: parseInt(e.target.value) || 2 })} /></Field>
            <Field label="Rate limit (req/min)"><Input type="number" value={form.rateLimitPerMinute} onChange={(e) => setForm({ ...form, rateLimitPerMinute: parseInt(e.target.value) || 60 })} /></Field>
            <Field label="Cost per 1K input tokens (USD)"><Input type="number" step="0.0001" value={form.costPerInputToken * 1000} onChange={(e) => setForm({ ...form, costPerInputToken: (parseFloat(e.target.value) || 0) / 1000 })} /></Field>
            <Field label="Cost per 1K output tokens (USD)"><Input type="number" step="0.0001" value={form.costPerOutputToken * 1000} onChange={(e) => setForm({ ...form, costPerOutputToken: (parseFloat(e.target.value) || 0) / 1000 })} /></Field>
          </div>

          {/* Toggles */}
          <div className="grid sm:grid-cols-2 gap-2">
            <Toggle label="Enable provider" desc="Make this provider available for requests" checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
            <Toggle label="Set as default" desc="Use as the first-choice provider" checked={form.isDefault} onChange={(v) => setForm({ ...form, isDefault: v })} />
            <Toggle label="Enable streaming" desc="Stream responses token-by-token" checked={form.streamingEnabled} onChange={(v) => setForm({ ...form, streamingEnabled: v })} />
            <Toggle label="Function calling" desc="Provider supports tool/function calls" checked={form.supportsFunctionCalling} onChange={(v) => setForm({ ...form, supportsFunctionCalling: v })} />
          </div>

          {/* User Access Control — super admin only */}
          <div className="rounded-lg border-2 border-brand/30 bg-brand-light/30 dark:bg-brand/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="Users" className="w-5 h-5 text-brand" />
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2">
                    Allow regular users to use this provider
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    When ON, all signed-in users can route AI requests through this provider.
                    When OFF, only super admins can use it. Use this to control which AI models
                    regular users get access to (e.g. Puter.js = free for everyone, OpenAI = super-admin-only).
                  </div>
                </div>
              </div>
              <Switch checked={form.allowedForRegularUsers} onCheckedChange={(v) => setForm({ ...form, allowedForRegularUsers: v })} />
            </div>
            {form.allowedForRegularUsers && (
              <div className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
                <Icon name="CheckCircle2" className="w-3.5 h-3.5" />
                This provider is available to ALL users (regular + admin + super admin)
              </div>
            )}
            {!form.allowedForRegularUsers && (
              <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                <Icon name="Lock" className="w-3.5 h-3.5" />
                This provider is super-admin-only
              </div>
            )}
          </div>

          {/* Puter-specific */}
          {isPuter && (
            <div className="rounded-lg border border-amber-300/50 bg-amber-100/40 dark:bg-amber-400/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300"><Icon name="Sparkles" className="w-4 h-4" /> Puter.js configuration</div>
              <p className="text-xs text-amber-700 dark:text-amber-400/80">Puter.js is free for end users — they authenticate with their own Google account. No API key needed from you.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Application ID"><Input value={form.applicationId} onChange={(e) => setForm({ ...form, applicationId: e.target.value })} placeholder="resumeai-pro-app" /></Field>
                <Field label="Client ID"><Input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder="resumeai-pro-client" /></Field>
                <Field label="Redirect URI"><Input value={form.redirectUri} onChange={(e) => setForm({ ...form, redirectUri: e.target.value })} placeholder="https://resumeai.pro/auth/puter/callback" /></Field>
                <Field label="Enabled models (comma-separated)"><Input value={form.enabledModels} onChange={(e) => setForm({ ...form, enabledModels: e.target.value })} placeholder="claude-sonnet-4, gpt-4o, gemini-2.0-flash" /></Field>
              </div>
            </div>
          )}

          {/* Custom provider config */}
          {isCustom && (
            <div className="rounded-lg border border-brand/30 bg-brand-light/30 dark:bg-brand/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-brand"><Icon name="Settings" className="w-4 h-4" /> Custom provider configuration</div>
              <p className="text-xs text-muted-foreground">Configure any LLM with templated request/response. Use <code className="text-xs bg-secondary px-1 rounded">{"{{model}}"}</code>, <code className="text-xs bg-secondary px-1 rounded">{"{{messages}}"}</code>, <code className="text-xs bg-secondary px-1 rounded">{"{{temperature}}"}</code>, <code className="text-xs bg-secondary px-1 rounded">{"{{max_tokens}}"}</code>, <code className="text-xs bg-secondary px-1 rounded">{"{{api_key}}"}</code> placeholders.</p>
              <Field label="Request body template (JSON)">
                <textarea
                  value={form.requestTemplate}
                  onChange={(e) => setForm({ ...form, requestTemplate: e.target.value })}
                  rows={6}
                  placeholder={`{\n  "model": "{{model}}",\n  "messages": "{{messages}}",\n  "temperature": {{temperature}},\n  "max_tokens": {{max_tokens}}\n}`}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Response JSON path (where to extract the text)">
                <Input value={form.responsePath} onChange={(e) => setForm({ ...form, responsePath: e.target.value })} placeholder="choices[0].message.content" className="font-mono text-xs" />
              </Field>
            </div>
          )}

          {/* Advanced */}
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer p-3 text-sm font-medium flex items-center gap-2"><Icon name="ChevronDown" className="w-4 h-4" /> Advanced (custom headers & parameters)</summary>
            <div className="p-3 pt-0 space-y-3">
              <Field label="Custom headers (JSON)">
                <textarea
                  value={form.headersJson}
                  onChange={(e) => setForm({ ...form, headersJson: e.target.value })}
                  rows={3}
                  placeholder='{ "X-Custom-Header": "value" }'
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Custom parameters (JSON)">
                <textarea
                  value={form.parametersJson}
                  onChange={(e) => setForm({ ...form, parametersJson: e.target.value })}
                  rows={3}
                  placeholder='{ "top_p": 0.9, "frequency_penalty": 0 }'
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </div>
          </details>

          <div className="rounded-lg bg-amber-100 dark:bg-amber-400/10 p-3 text-xs flex items-start gap-2">
            <Icon name="ShieldCheck" className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-amber-800 dark:text-amber-300">
              API keys are stored encrypted at rest and never exposed to the client in production. In production (Cloudflare Workers), store keys as secrets via <code className="bg-amber-200/50 dark:bg-amber-400/20 px-1 rounded">wrangler secret put</code> — never in source code.
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!form.name.trim()) { toast.error("Please enter a display name."); return; }
              onSave({
                ...form,
                baseUrl: form.baseUrl,
                apiUrl: form.baseUrl, // keep both in sync
                enabledModels: form.enabledModels.split(",").map((s) => s.trim()).filter(Boolean),
              });
            }}
            className="bg-brand hover:bg-brand-dark text-white gap-2"
          >
            <Icon name="Save" className="w-4 h-4" /> Save provider
          </Button>
        </div>
      </motion.div>
    </motion.div>
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

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
