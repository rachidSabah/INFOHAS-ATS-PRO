"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { ProviderManager } from "@/lib/ai/services";
import { toast } from "sonner";
import type { AIProvider, AIProviderType } from "@/lib/types";
import { isOpenCodeZenFree } from "@/lib/provider-capabilities";
import { ProviderEditor } from "./AIProviderEditor";
import { ProviderAnalytics } from "./ProviderAnalytics";
import { ProviderLogsTable } from "./ProviderLogsTable";
import { TestConnectionModal } from "./TestConnectionModal";
import { PuterAuthCard } from "./PuterAuthCard";
import { getPuterProvider } from "@/lib/providers";
import type { ProviderAuthStatus } from "@/lib/providers/interface";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const PROVIDER_TYPES: { type: AIProviderType; label: string; icon: string; defaultUrl?: string; defaultModel?: string; authType?: "bearer" | "header" | "query" | "none" }[] = [
  { type: "puter", label: "Puter.js (Free)", icon: "Sparkles", defaultUrl: "https://api.puter.com", defaultModel: "claude-sonnet-4" },
  { type: "openai", label: "OpenAI", icon: "Bot", defaultUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", authType: "bearer" },
  { type: "claude", label: "Anthropic Claude", icon: "Bot", defaultUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-20241022", authType: "header" },
  { type: "gemini", label: "Google Gemini", icon: "Bot", defaultUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash", authType: "bearer" },
  { type: "deepseek", label: "DeepSeek", icon: "Bot", defaultUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", authType: "bearer" },
  { type: "groq", label: "Groq", icon: "Zap", defaultUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", authType: "bearer" },
  { type: "mistral", label: "Mistral AI", icon: "Bot", defaultUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest", authType: "bearer" },
  { type: "cohere", label: "Cohere", icon: "Bot", defaultUrl: "https://api.cohere.com/v1", defaultModel: "command-r-plus", authType: "bearer" },
  { type: "perplexity", label: "Perplexity", icon: "Search", defaultUrl: "https://api.perplexity.ai", defaultModel: "llama-3.1-sonar-large-128k-online", authType: "bearer" },
  { type: "openrouter", label: "OpenRouter", icon: "Network", defaultUrl: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude-3.5-sonnet", authType: "bearer" },
  { type: "together", label: "Together AI", icon: "Users", defaultUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", authType: "bearer" },
  { type: "huggingface", label: "HuggingFace", icon: "Box", defaultUrl: "https://api-inference.huggingface.co", defaultModel: "meta-llama/Llama-3.3-70B-Instruct", authType: "bearer" },
  { type: "ollama", label: "Ollama (self-hosted)", icon: "HardDrive", defaultUrl: "http://localhost:11434", defaultModel: "llama3.3:70b", authType: "none" },
  { type: "azure-openai", label: "Azure OpenAI", icon: "Cloud", defaultUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}", defaultModel: "gpt-4o", authType: "header" },
  { type: "bedrock", label: "AWS Bedrock", icon: "Cloud", defaultUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", defaultModel: "anthropic.claude-3-5-sonnet-20241022-v1:0", authType: "bearer" },
  { type: "custom", label: "Custom / self-hosted LLM", icon: "Settings", defaultUrl: "", defaultModel: "", authType: "bearer" },
];

type Tab = "providers" | "auth" | "analytics" | "logs";

export function AIProviders() {
  const providers = useApp((s) => s.providers);
  const settings = useApp((s) => s.providerSettings);
  const setView = useApp((s) => s.setView);

  // Provider auth state — MUST be declared before the tab state that references them
  const [puterStatus, setPuterStatus] = useState<ProviderAuthStatus>({
    connected: false, authenticated: false, email: null, expiresAt: null, models: [], sharedAdminAccount: false, authMethod: null, googleUserId: null, googlePicture: null,
  });
  

  // Default to providers tab if Puter is authenticated; otherwise show auth
  const [tab, setTab] = useState<Tab>(puterStatus.authenticated ? "providers" : "auth");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<AIProvider | null>(null);
  const [testing, setTesting] = useState<AIProvider | null>(null);
  const [q, setQ] = useState("");

  // Refresh auth status from providers
  const refreshAuthStatus = useCallback(() => {
    try {
      setPuterStatus(getPuterProvider().getStatus());
    } catch (e) { console.warn("[AIProviders] Puter status check failed:", e instanceof Error ? e.message : e); }
  }, []);

  // Restore sessions on mount and switch to providers tab if already authenticated
  useEffect(() => {
    (async () => {
      let puterOk = false;
      
      try { const s = await getPuterProvider().restore(); puterOk = !!s?.authenticated; } catch (e) { console.warn("[AIProviders] Puter restore failed:", e instanceof Error ? e.message : e); }
      
      refreshAuthStatus();
      // If already authenticated, show providers tab (not auth tab)
      if (puterOk) {
        setTab("providers");
      }
    })();
  }, [refreshAuthStatus]);

  const totalReqs = providers.reduce((n, p) => n + p.usage.requests, 0);
  const activeCount = providers.filter((p) => p.isActive).length;
  const healthyCount = providers.filter((p) => p.status === "healthy").length;
  const totalCost = providers.reduce((n, p) => n + p.usage.cost, 0);

  const filtered = providers.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.type.toLowerCase().includes(q.toLowerCase()));

  const handleTest = async (provider: AIProvider) => {
    setTesting(provider);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Cpu" className="w-6 h-6 text-brand" /> AI Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">Multi-provider system with automatic failover. 17 types supported — extendable without code changes.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setView("ai-settings")} className="gap-2">
            <Icon name="Settings" className="w-4 h-4" /> Routing settings
          </Button>
          <Button onClick={() => { setEditing(null); setShowAdd(true); }} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name="Plus" className="w-4 h-4" /> Add provider
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: "Total providers", value: providers.length, icon: "Cpu", color: "#1154A3" },
          { label: "Active", value: activeCount, icon: "CheckCircle2", color: "#10B981" },
          { label: "Healthy", value: healthyCount, icon: "Heart", color: "#10B981" },
          { label: "Total requests", value: totalReqs.toLocaleString(), icon: "Activity", color: "#F59E0B" },
          { label: "Est. cost", value: `$${totalCost.toFixed(4)}`, icon: "DollarSign", color: "#8B5CF6" },
          { label: "OAuth Auth", value: [puterStatus.authenticated].filter(Boolean).length, icon: "Shield", color: "#10B981" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${s.color}15`, color: s.color }}>
                <Icon name={s.icon} className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-bold font-display truncate">{s.value}</div>
                <div className="text-xs text-muted-foreground truncate">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit">
        {[
          { id: "providers" as const, label: "Providers", icon: "List" },
          { id: "auth" as const, label: !puterStatus.authenticated ? "Sign In" : "OAuth Auth", icon: !puterStatus.authenticated ? "LogIn" : "Shield" },
          { id: "analytics" as const, label: "Usage Analytics", icon: "BarChart3" },
          { id: "logs" as const, label: "Error Logs", icon: "ScrollText" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition ${tab === t.id ? "bg-card shadow-sm text-brand" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon name={t.icon} className="w-4 h-4" /> {t.label}
            {t.id === "auth" && !puterStatus.authenticated && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Providers tab */}
      {tab === "providers" && (
        <>
          {/* Auth required banner — shown when no OAuth providers are connected */}
          {!puterStatus.authenticated && (
            <Card className="border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
              <CardContent className="p-4 flex items-start gap-3">
                <Icon name="AlertTriangle" className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No AI provider authenticated</p>
                  <p className="text-xs text-amber-600/80 dark:text-amber-500/80 mt-0.5">
                    Connect Puter.js (free, Google OAuth) to enable resume optimization. Without authentication, the optimizer cannot run.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 gap-1.5 border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950/40"
                    onClick={() => setTab("auth")}
                  >
                    <Icon name="LogIn" className="w-3.5 h-3.5" /> Go to OAuth Auth
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <div className="relative w-full sm:w-72">
                <Icon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search providers…" className="pl-9 h-9" />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon name="Info" className="w-3.5 h-3.5" /> Default: <span className="font-semibold text-foreground">{providers.find((p) => p.id === settings.defaultProviderId)?.name ?? "None"}</span>
                <span>·</span>
                <span>Fallbacks: <span className="font-semibold text-foreground">{settings.fallbackProviderIds.length}</span></span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/40">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-semibold">Provider</th>
                    <th className="px-4 py-2 font-semibold">Type</th>
                    <th className="px-4 py-2 font-semibold">Base URL</th>
                    <th className="px-4 py-2 font-semibold">Model</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Priority</th>
                    <th className="px-4 py-2 font-semibold">Requests</th>
                    <th className="px-4 py-2 font-semibold">Last used</th>
                    <th className="px-4 py-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const cfg = PROVIDER_TYPES.find((t) => t.type === p.type);
                    const statusColor = p.status === "healthy" ? "success" : p.status === "degraded" ? "warning" : p.status === "untested" ? "outline" : "danger";
                    return (
                      <tr key={p.id} className="border-b border-border hover:bg-secondary/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${p.type === "puter" ? "#F59E0B" : "#94A3B8"}15`, color: p.type === "puter" ? "#F59E0B" : "#475569" }}>
                              <Icon name={cfg?.icon ?? "Cpu"} className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate flex items-center gap-1.5">
                                {p.name}
                                {p.isDefault && <Badge variant="gold" className="text-[9px]">DEFAULT</Badge>}
                                {p.isFallback && <Badge variant="brand" className="text-[9px]">FALLBACK</Badge>}
                                {p.allowedForRegularUsers && <Badge variant="success" className="text-[9px]">USER ACCESS</Badge>}
                                {p.isBuiltIn && <Badge variant="outline" className="text-[9px]">BUILT-IN</Badge>}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">{p.name}</div>
                              {isOpenCodeZenFree(p) && (
                                <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                                  ⚠ Free model – third-party rate limits may apply.
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><Badge variant="outline" className="text-[10px] capitalize">{p.type.replace("-", " ")}</Badge></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono truncate max-w-[180px]">{p.baseUrl || p.apiUrl || "—"}</td>
                        <td className="px-4 py-3 text-xs font-mono">{p.modelName || "—"}</td>
                        <td className="px-4 py-3"><Badge variant={statusColor as any} className="capitalize text-[10px]">{p.status}</Badge></td>
                        <td className="px-4 py-3"><span className="font-mono text-xs">#{p.priority}</span></td>
                        <td className="px-4 py-3 text-xs">{p.usage.requests.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{p.lastUsedAt ? new Date(p.lastUsedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-0.5 justify-end">
                            <IconBtn icon="Pencil" label="Edit" onClick={() => { setEditing(p); setShowAdd(true); }} />
                            <IconBtn icon="Zap" label="Test connection" onClick={() => handleTest(p)} color="#F59E2B" />
                            <IconBtn icon="Copy" label="Duplicate" onClick={() => { const id = ProviderManager.duplicate(p.id); if (id) toast.success("Provider duplicated."); }} />
                            <IconBtn icon={p.isDefault ? "Star" : "StarOff"} label="Set as default" onClick={() => { ProviderManager.setDefault(p.id); toast.success(`${p.name} set as default.`); }} color={p.isDefault ? "#F59E2B" : undefined} />
                            {!p.isBuiltIn && <IconBtn icon="Trash2" label="Delete" color="#DC2626" onClick={() => { if (confirm(`Delete provider "${p.name}"?`)) { ProviderManager.remove(p.id); toast.success(`Provider deleted.`); } }} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">No providers match "{q}".</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        </>
      )}

      {/* OAuth Auth tab */}
      {tab === "auth" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold font-display flex items-center gap-2">
                <Icon name="Shield" className="w-5 h-5 text-brand" />
                Provider Authentication
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Authenticate with AI providers to enable seamless optimization. Authenticated providers never silently fall back to offline mode.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={refreshAuthStatus} className="gap-1.5">
              <Icon name="RefreshCw" className="w-3.5 h-3.5" /> Refresh Status
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Puter.js Auth (Multi-Account) */}
            <PuterAuthCard status={puterStatus} onRefreshStatus={refreshAuthStatus} />
          </div>

          {/* Auth info box */}
          <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4 flex items-start gap-3">
              <Icon name="Info" className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-medium">How Provider Authentication Works</p>
                <ul className="text-xs space-y-0.5 text-blue-600/80 dark:text-blue-400/80">
                                    <li>• <strong>Puter.js</strong> uses Google OAuth via a browser popup. Sign in once and your session persists across reloads.</li>
                  <li>• When a provider is authenticated, it becomes available in the AI routing chain for all optimization requests.</li>
                  <li>• <strong>Shared Admin Account</strong> mode lets all users on this instance use your authenticated session — ideal for team deployments.</li>
                  <li>• Authentication errors are <strong>never silently ignored</strong> — you will always see a clear "Authentication required" message.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Analytics tab */}
      {tab === "analytics" && <ProviderAnalytics />}

      {/* Logs tab */}
      {tab === "logs" && <ProviderLogsTable />}

      {/* Editor drawer */}
      {showAdd && (
        <ProviderEditor
          provider={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSave={(p) => {
            if (editing) {
              ProviderManager.update(editing.id, p);
              toast.success("Provider updated.");
            } else {
              const id = ProviderManager.add({
                ...p,
                isBuiltIn: false,
              } as any);
              toast.success(`Provider added (id: ${id}).`);
            }
            setShowAdd(false);
            setEditing(null);
          }}
        />
      )}

      {/* Test connection modal */}
      {testing && (
        <TestConnectionModal provider={testing} onClose={() => setTesting(null)} />
      )}
    </div>
  );
}

function IconBtn({ icon, label, onClick, color }: { icon: string; label: string; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-7 h-7 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition"
      style={color ? { color } : undefined}
    >
      <Icon name={icon} className="w-3.5 h-3.5" />
    </button>
  );
}
