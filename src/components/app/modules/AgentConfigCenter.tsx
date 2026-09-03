"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import type { AgentConfig, AgentType } from "@/lib/pipeline-orchestration-types";
// Agent Configuration Center runtime (directives #4/#5/#23/#24):
import { resolveAgentAIOptions } from "@/lib/agents/agent-ai-config";
import { getJobAILock, getActiveJobModel } from "@/lib/ai/readiness/config-lock";
import { modelsForProvider } from "@/lib/ai/routing/model-compatibility";
import { aiHealthManager, type AIHealthRecord } from "@/lib/ai/health/ai-health-manager";
import { SEED_AGENT_CONFIGS } from "@/lib/pipeline-orchestration-seeds";

/** Seed configs indexed by agentType — used by bulk "Reset Selected". */
function SEED_AGENT_CONFIGS_BY_TYPE(): Record<string, AgentConfig> {
  const map: Record<string, AgentConfig> = {};
  for (const c of SEED_AGENT_CONFIGS) map[c.agentType] = c;
  return map;
}

/** Health → indicator color + label (directive #10 — explicit states). */
function healthIndicator(rec: AIHealthRecord | undefined): { color: string; label: string } {
  if (!rec || rec.state === "unknown") return { color: "bg-slate-400", label: "Unknown" };
  switch (rec.state) {
    case "healthy": return { color: "bg-emerald-500", label: "Healthy" };
    case "degraded": return { color: "bg-amber-500", label: "Degraded" };
    case "rate_limited": return { color: "bg-orange-500", label: "Rate limited" };
    case "quota_exhausted": return { color: "bg-red-500", label: "Quota exhausted" };
    case "authentication_required": return { color: "bg-red-500", label: "Auth required" };
    case "unsupported_model": return { color: "bg-purple-500", label: "Unsupported model" };
    case "endpoint_error": return { color: "bg-red-500", label: "Endpoint error" };
    case "timeout": return { color: "bg-orange-500", label: "Timeout" };
    case "unavailable": return { color: "bg-red-500", label: "Unavailable" };
    case "cooldown": return { color: "bg-sky-500", label: "Cooldown" };
    default: return { color: "bg-slate-400", label: rec.state };
  }
}

export function AgentConfigCenter() {
  const agentConfigs = useApp((s) => s.agentConfigs);
  const providers = useApp((s) => s.providers);
  const updateAgentConfig = useApp((s) => s.updateAgentConfig);
  const bulkUpdateAgentConfigs = useApp((s) => s.bulkUpdateAgentConfigs);
  const applyOptimalAgentDefaults = useApp((s) => s.applyOptimalAgentDefaults);
  const promptVersions = useApp((s) => s.promptVersions);

  const handleApplyOptimal = () => {
    if (!confirm("Reset ALL agent configurations to the tuned optimal defaults?\n\nThis restores per-agent temperature, tokens, timeouts and retry policies (Task 7 optimal values). Custom provider/model preferences will be cleared.")) return;
    applyOptimalAgentDefaults();
    toast.success("Optimal agent defaults applied. All agents now use the tuned Task 7 configuration.");
  };

  const [selectedAgentType, setSelectedAgentType] = useState<AgentType | null>(null);
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [dirty, setDirty] = useState(false);

  // ==== BULK SELECTION (directives #5, #25) ====
  // Selection state is held against the COMPLETE agent registry (agentTypes),
  // never against rendered DOM — Select All works across the whole list even
  // when the list scrolls.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkProviderId, setBulkProviderId] = useState("");
  const [bulkModel, setBulkModel] = useState("");
  const [bulkTemperature, setBulkTemperature] = useState<string>("");
  const [bulkMaxTokens, setBulkMaxTokens] = useState<string>("");
  const [bulkRetry, setBulkRetry] = useState<string>("");
  const [bulkTimeout, setBulkTimeout] = useState<string>("");
  const [bulkEnabled, setBulkEnabled] = useState<"" | "on" | "off">("");

  const allAgentTypes = useMemo(() => agentConfigs.map((a) => a.agentType), [agentConfigs]);
  const allSelected = allAgentTypes.length > 0 && allAgentTypes.every((t) => selection.has(t));
  const bulkModels = bulkProviderId ? modelsForProvider(providers.find((p) => p.id === bulkProviderId)) : [];

  const toggleSelect = (agentType: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(agentType)) next.delete(agentType); else next.add(agentType);
      return next;
    });
  };
  const selectAll = () => setSelection(new Set(allAgentTypes));
  const clearSelection = () => setSelection(new Set());

  const resetBulkFields = () => {
    setBulkProviderId(""); setBulkModel(""); setBulkTemperature("");
    setBulkMaxTokens(""); setBulkRetry(""); setBulkTimeout(""); setBulkEnabled("");
  };

  const applyBulkSave = () => {
    if (selection.size === 0) return;
    // Build the patch from ONLY the fields the admin actually set — unset
    // fields leave each agent's existing value untouched.
    const patch: Partial<AgentConfig> = {};
    if (bulkProviderId) {
      patch.providerId = bulkProviderId;
      // PROVIDER+MODEL PAIR rule (directive #6): only compatible models offered.
      patch.model = bulkModel || bulkModels[0] || "";
    }
    if (bulkTemperature.trim() !== "") patch.temperature = parseFloat(bulkTemperature);
    if (bulkMaxTokens.trim() !== "") patch.maxTokens = parseInt(bulkMaxTokens) || undefined;
    if (bulkRetry.trim() !== "") patch.maxRetryCount = parseInt(bulkRetry) || 0;
    if (bulkTimeout.trim() !== "") patch.requestTimeoutMs = parseInt(bulkTimeout) || undefined;
    if (bulkEnabled === "on") patch.enabled = true;
    if (bulkEnabled === "off") patch.enabled = false;

    if (Object.keys(patch).length === 0) {
      toast.info("Nothing to assign — set at least one bulk field first.");
      return;
    }
    const count = bulkUpdateAgentConfigs([...selection], patch);
    toast.success(`Bulk assignment saved for ${count} agent(s) — persisted to D1.`);
    console.info(`[AI_CONFIG] bulk-save agents=${count} fields=${Object.keys(patch).join(",")}`);
    resetBulkFields();
    clearSelection();
  };

  const applyBulkReset = () => {
    if (selection.size === 0) return;
    if (!confirm(`Reset ${selection.size} selected agent(s) to the tuned optimal defaults?`)) return;
    const seeds = SEED_AGENT_CONFIGS_BY_TYPE();
    const now = new Date().toISOString();
    for (const agentType of selection) {
      const seed = seeds[agentType];
      if (seed) updateAgentConfig(agentType, { ...seed, createdAt: now, updatedAt: now });
    }
    toast.success(`${selection.size} agent(s) reset to optimal defaults.`);
    clearSelection();
  };

  // ==== EFFECTIVE vs CONFIGURED (directives #23, #24) ====
  const jobLock = getJobAILock();
  const activeJobModel = getActiveJobModel();
  const lockActive = !!(jobLock && activeJobModel);

  const lockOverrideReason = () =>
    `MODEL OVERRIDDEN — Reason: Optimization Job AI Lock · Authority: Supervisor Readiness Gate (job ${jobLock?.jobId ?? "-"}). Agent configuration contributes generation parameters only while the lock is active.`;

  const effectiveFor = (agentType: string) => {
    const resolution = resolveAgentAIOptions(agentType, false, lockActive);
    if (lockActive) {
      return {
        providerId: activeJobModel!.providerId,
        providerName: activeJobModel!.providerName,
        model: activeJobModel!.model,
        source: "job-lock" as const,
      };
    }
    const provider = resolution.providerId
      ? providers.find((p) => p.id === resolution.providerId)
      : undefined;
    return {
      providerId: resolution.providerId,
      providerName: provider?.name ?? resolution.providerId,
      model: resolution.model,
      source: resolution.source,
    };
  };

  const selectedAgent = agentConfigs.find((a) => a.agentType === selectedAgentType);
  const draftAgent = draft || selectedAgent;

  const handleSelectAgent = (agentType: AgentType) => {
    const agent = agentConfigs.find((a) => a.agentType === agentType);
    setSelectedAgentType(agentType);
    setDraft(agent ? { ...agent } : null);
    setDirty(false);
  };

  const patch = (p: Partial<AgentConfig>) => {
    if (!draft) return;
    setDraft({ ...draft, ...p });
    setDirty(true);
  };

  const save = () => {
    if (!draft || !selectedAgentType) return;
    updateAgentConfig(selectedAgentType, draft);
    setDirty(false);
    toast.success(`Agent "${draft.displayName}" configuration saved.`);
  };

  const discard = () => {
    if (selectedAgent) {
      setDraft({ ...selectedAgent });
    }
    setDirty(false);
    toast.info("Changes discarded.");
  };

  const getModelsForProvider = (providerId: string): string[] => {
    // Compatibility-filtered (directive #6/#8): the selector must never offer
    // an impossible provider/model pair or a known-dead model id.
    return modelsForProvider(providers.find((p) => p.id === providerId));
  };

  const getPromptsForAgent = (agentType: AgentType) => {
    return promptVersions.filter((p) => p.agentType === agentType);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Icon name="Bot" className="w-6 h-6 text-brand" /> Agent Configuration Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure every AI agent — provider, model, generation parameters, prompts, retry, fallback, validation, memory. All changes sync to D1 and take effect immediately.
        </p>
      </div>

      {/* AI Governance banner (Task 7) */}
      <div className="rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm text-muted-foreground flex items-start gap-2">
        <Icon name="ShieldCheck" className="w-4 h-4 text-brand mt-0.5 shrink-0" />
        <div>
          <span className="font-semibold text-foreground">AI governance — resolution order:</span> explicit call pinning → job AI lock (readiness gate) → <span className="text-foreground">this configuration</span> → app default chain. During an optimization job the readiness-gate lock ALWAYS decides the provider+model (Supervisor-exclusive); this center then contributes each agent's temperature, tokens and timeout defaults, and its provider/model preference applies only to non-locked runs.
        </div>
      </div>

      {/* ===== BULK CONFIGURATION TOOLBAR (directives #5, #25) ===== */}
      <Card className={selection.size > 0 ? "border-brand/50" : "opacity-70"}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="CheckSquare" className="w-4 h-4 text-brand" />
              Bulk Assignment {selection.size > 0 ? `— ${selection.size} selected` : "(select agents below)"}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={selectAll} disabled={allSelected}>
                <Icon name="ListChecks" className="w-3 h-3 mr-1" /> Select All ({agentConfigs.length})
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={clearSelection} disabled={selection.size === 0}>
                <Icon name="X" className="w-3 h-3 mr-1" /> Clear Selection
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => { if (selection.size > 0 && confirm(`Enable ${selection.size} selected agent(s)?`)) { bulkUpdateAgentConfigs([...selection], { enabled: true }); toast.success(`${selection.size} agent(s) enabled.`); clearSelection(); } }}
                disabled={selection.size === 0}
              >
                Enable
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => { if (selection.size > 0 && confirm(`Disable ${selection.size} selected agent(s)? Disabled agents are skipped by the pipeline.`)) { bulkUpdateAgentConfigs([...selection], { enabled: false }); toast.success(`${selection.size} agent(s) disabled.`); clearSelection(); } }}
                disabled={selection.size === 0}
              >
                Disable
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={applyBulkReset}
                disabled={selection.size === 0}
              >
                Reset Selected
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs">Assign Provider</Label>
            <select
              value={bulkProviderId}
              onChange={(e) => { setBulkProviderId(e.target.value); setBulkModel(""); }}
              className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs mt-1"
            >
              <option value="">(keep current)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Assign Model</Label>
            <select
              value={bulkModel}
              onChange={(e) => setBulkModel(e.target.value)}
              disabled={!bulkProviderId || bulkModels.length === 0}
              className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs mt-1 disabled:opacity-50"
            >
              <option value="">{bulkProviderId ? "(provider default)" : "(pick a provider first)"}</option>
              {bulkModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Temperature</Label>
            <Input type="number" step={0.05} min={0} max={2} placeholder="keep current" value={bulkTemperature} onChange={(e) => setBulkTemperature(e.target.value)} className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-xs">Max Tokens</Label>
            <Input type="number" step={500} min={500} placeholder="keep current" value={bulkMaxTokens} onChange={(e) => setBulkMaxTokens(e.target.value)} className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-xs">Retries</Label>
            <Input type="number" min={0} max={10} placeholder="keep current" value={bulkRetry} onChange={(e) => setBulkRetry(e.target.value)} className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-xs">Timeout (ms)</Label>
            <Input type="number" step={5000} min={5000} placeholder="keep current" value={bulkTimeout} onChange={(e) => setBulkTimeout(e.target.value)} className="h-8 text-xs mt-1" />
          </div>
          <div className="col-span-2 md:col-span-3 xl:col-span-6 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Enabled state:</Label>
              <select
                value={bulkEnabled}
                onChange={(e) => setBulkEnabled(e.target.value as "" | "on" | "off")}
                className="h-8 px-2 rounded-md border border-input bg-background text-xs"
              >
                <option value="">(keep current)</option>
                <option value="on">ON</option>
                <option value="off">OFF</option>
              </select>
            </div>
            <Button
              size="sm"
              onClick={applyBulkSave}
              disabled={selection.size === 0}
              className="bg-brand hover:bg-brand-dark text-white h-8 text-xs gap-1"
            >
              <Icon name="Save" className="w-3 h-3" /> Save Selected ({selection.size})
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-[300px_1fr] gap-6">
        {/* Agent list sidebar */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Agents ({agentConfigs.length})</CardTitle>
              <div className="flex items-center gap-1">
                <button
                  onClick={selectAll}
                  className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-secondary/60"
                  title="Select all agents (complete registry, not only visible rows)"
                >
                  Select All
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleApplyOptimal}
                  className="h-7 text-[10px] gap-1"
                  title="Restore all agents to the tuned optimal defaults"
                >
                  <Icon name="Sparkles" className="w-3 h-3" /> OPTIMAL
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[600px] overflow-y-auto">
            {agentConfigs
              .slice()
              .sort((a, b) => a.executionOrder - b.executionOrder)
              .map((agent) => {
                const effective = effectiveFor(agent.agentType);
                const overridden = lockActive && (!!agent.providerId || !!agent.model);
                const health = agent.providerId
                  ? healthIndicator(aiHealthManager.getHealth(agent.providerId, agent.model || ""))
                  : null;
                return (
                  <div
                    key={agent.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectAgent(agent.agentType)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelectAgent(agent.agentType); }}
                    className={`w-full text-left rounded-md p-2 transition-colors cursor-pointer ${
                      selectedAgentType === agent.agentType
                        ? "bg-brand/10 border border-brand/30"
                        : "hover:bg-secondary/50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selection.has(agent.agentType)}
                        onClick={(e: any) => { e.stopPropagation(); toggleSelect(agent.agentType); }}
                        onCheckedChange={() => toggleSelect(agent.agentType)}
                        aria-label={`Select ${agent.displayName}`}
                      />
                      <span className="text-sm font-medium truncate flex-1">{agent.displayName}</span>
                      {agent.enabled ? (
                        <Badge variant="success" className="text-[9px] shrink-0">ON</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] shrink-0">OFF</Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                      <span>Order: {agent.executionOrder} · {agent.agentType}</span>
                      {health && <span className={`inline-block w-2 h-2 rounded-full ${health.color}`} title={`${health.label} — live health (AI Health Manager)`} />}
                    </div>
                    <div className="text-[10px] mt-0.5 flex items-center gap-1 flex-wrap">
                      <span className="text-muted-foreground">
                        {effective.providerName
                          ? <>Effective: <span className="text-foreground">{effective.providerName}{effective.model ? ` / ${effective.model}` : ""}</span></>
                          : "Effective: app default chain"}
                      </span>
                      {overridden && (
                        <Badge variant="warning" className="text-[8px] shrink-0">LOCK</Badge>
                      )}
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      Modified: {agent.updatedAt ? new Date(agent.updatedAt).toLocaleDateString() : "—"}
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>

        {/* Agent configuration panel */}
        {draftAgent ? (
          <div className="space-y-4">
            {dirty && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-center justify-between gap-2">
                <span className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <Icon name="AlertTriangle" className="w-4 h-4" /> You have unsaved changes
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={discard}>Discard</Button>
                  <Button size="sm" onClick={save} className="bg-brand hover:bg-brand-dark text-white gap-2">
                    <Icon name="Save" className="w-4 h-4" /> Save
                  </Button>
                </div>
              </div>
            )}

            {/* Agent info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Icon name="Info" className="w-4 h-4 text-brand" /> Agent Information
                </CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                <div><span className="text-muted-foreground">Name:</span> {draftAgent.displayName}</div>
                <div><span className="text-muted-foreground">Type:</span> {draftAgent.agentType}</div>
                <div><span className="text-muted-foreground">Version:</span> {draftAgent.version}</div>
                <div><span className="text-muted-foreground">Execution Order:</span> {draftAgent.executionOrder}</div>
                <div><span className="text-muted-foreground">Last Modified:</span> {new Date(draftAgent.updatedAt).toLocaleDateString()}</div>
                <div><span className="text-muted-foreground">Last Executed:</span> {draftAgent.lastExecutedAt ? new Date(draftAgent.lastExecutedAt).toLocaleString() : "Never"}</div>
                {draftAgent.averageExecutionTimeMs && (
                  <div><span className="text-muted-foreground">Avg Time:</span> {(draftAgent.averageExecutionTimeMs / 1000).toFixed(1)}s</div>
                )}
                {draftAgent.averageTokenUsage && (
                  <div><span className="text-muted-foreground">Avg Tokens:</span> {draftAgent.averageTokenUsage.toLocaleString()}</div>
                )}
                {draftAgent.successRate !== undefined && (
                  <div><span className="text-muted-foreground">Success Rate:</span> {draftAgent.successRate.toFixed(1)}%</div>
                )}
              </CardContent>
            </Card>

            {/* Effective vs configured route (directives #23, #24) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="Route" className="w-4 h-4 text-brand" /> Effective Route (this execution)</CardTitle>
                <CardDescription>
                  CONFIGURED = what you set for this agent · EFFECTIVE = what the agent will actually use. When they differ, the reason is shown — never guess why your configuration was not used.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Configured Provider</div>
                  <div className="font-medium">{draftAgent.providerId ? (providers.find((p) => p.id === draftAgent.providerId)?.name ?? draftAgent.providerId) : "(app default)"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Configured Model</div>
                  <div className="font-medium">{draftAgent.model || "(provider default)"}</div>
                </div>
                {(() => {
                  const eff = effectiveFor(draftAgent.agentType);
                  const overridden = lockActive && (!!draftAgent.providerId || !!draftAgent.model);
                  return (
                    <>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Effective Provider</div>
                        <div className={`font-medium ${overridden ? "text-orange-600 dark:text-orange-400" : ""}`}>{eff.providerName || "(app default chain)"}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Effective Model</div>
                        <div className={`font-medium ${overridden ? "text-orange-600 dark:text-orange-400" : ""}`}>{eff.model || "(app default)"}</div>
                      </div>
                      {overridden && (
                        <div className="sm:col-span-2 lg:col-span-4 rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 p-2 text-xs text-orange-800 dark:text-orange-300">
                          <span className="font-semibold">MODEL OVERRIDDEN</span> — Configured: {providers.find((p) => p.id === draftAgent.providerId)?.name ?? "(default)"} / {draftAgent.model || "(default)"} → Effective: {eff.providerName} / {eff.model}. <span className="font-semibold">Reason:</span> Optimization Job AI Lock. <span className="font-semibold">Authority:</span> Supervisor Readiness Gate (job {jobLock?.jobId ?? "-"}).
                        </div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            {/* General config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="Settings" className="w-4 h-4 text-brand" /> General Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Enable Agent</Label>
                  <Switch checked={draftAgent.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
                </div>
                <div>
                  <Label>Display Name</Label>
                  <Input value={draftAgent.displayName} onChange={(e) => patch({ displayName: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={draftAgent.description} onChange={(e) => patch({ description: e.target.value })} className="mt-1" />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Execution Priority (order)</Label>
                    <Input
                      type="number"
                      value={draftAgent.executionOrder}
                      onChange={(e) => patch({ executionOrder: parseInt(e.target.value) || 0 })}
                      className="mt-1"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-6">
                    <Label>Parallel Execution</Label>
                    <Switch checked={draftAgent.parallelExecution} onCheckedChange={(v) => patch({ parallelExecution: v })} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Run Only When Required</Label>
                    <p className="text-xs text-muted-foreground">Skip if input doesn't need this agent</p>
                  </div>
                  <Switch checked={draftAgent.runOnlyWhenRequired} onCheckedChange={(v) => patch({ runOnlyWhenRequired: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Enable Logging</Label>
                  <Switch checked={draftAgent.enableLogging} onCheckedChange={(v) => patch({ enableLogging: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Enable Debug Mode</Label>
                  <Switch checked={draftAgent.enableDebugMode} onCheckedChange={(v) => patch({ enableDebugMode: v })} />
                </div>
              </CardContent>
            </Card>

            {/* Provider & Model config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="Cpu" className="w-4 h-4 text-brand" /> Provider & Model Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Provider</Label>
                    <select
                      value={draftAgent.providerId}
                      onChange={(e) => {
                        const newProviderId = e.target.value;
                        const models = getModelsForProvider(newProviderId);
                        patch({ providerId: newProviderId, model: models[0] || "" });
                      }}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                    >
                      <option value="">(use primary provider)</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Model</Label>
                    <select
                      value={draftAgent.model}
                      onChange={(e) => patch({ model: e.target.value })}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                    >
                      <option value="">(provider default)</option>
                      {getModelsForProvider(draftAgent.providerId).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <Label>Quality Mode</Label>
                  <select
                    value={draftAgent.qualityMode}
                    onChange={(e) => patch({ qualityMode: e.target.value as any })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                  >
                    <option value="fast">Fast (lower quality, faster)</option>
                    <option value="balanced">Balanced (recommended)</option>
                    <option value="high-quality">High Quality (slower, better output)</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Generation parameters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="SlidersHorizontal" className="w-4 h-4 text-brand" /> Generation Parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <Label>Temperature: {draftAgent.temperature}</Label>
                    <input
                      type="range" min={0} max={2} step={0.05}
                      value={draftAgent.temperature}
                      onChange={(e) => patch({ temperature: parseFloat(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                  <div>
                    <Label>Top P: {draftAgent.topP}</Label>
                    <input
                      type="range" min={0} max={1} step={0.05}
                      value={draftAgent.topP}
                      onChange={(e) => patch({ topP: parseFloat(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                  <div>
                    <Label>Presence Penalty: {draftAgent.presencePenalty}</Label>
                    <input
                      type="range" min={-2} max={2} step={0.1}
                      value={draftAgent.presencePenalty}
                      onChange={(e) => patch({ presencePenalty: parseFloat(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                  <div>
                    <Label>Frequency Penalty: {draftAgent.frequencyPenalty}</Label>
                    <input
                      type="range" min={-2} max={2} step={0.1}
                      value={draftAgent.frequencyPenalty}
                      onChange={(e) => patch({ frequencyPenalty: parseFloat(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                  <div>
                    <Label>Max Output Tokens</Label>
                    <Input
                      type="number" step={1000} min={1000} max={32000}
                      value={draftAgent.maxTokens}
                      onChange={(e) => patch({ maxTokens: parseInt(e.target.value) || 8000 })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Context Length</Label>
                    <Input
                      type="number" step={1000} min={4000} max={128000}
                      value={draftAgent.contextLength}
                      onChange={(e) => patch({ contextLength: parseInt(e.target.value) || 16000 })}
                      className="mt-1"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Retry config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="RotateCcw" className="w-4 h-4 text-brand" /> Retry Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Max Retry Count</Label>
                    <Input
                      type="number" min={0} max={10}
                      value={draftAgent.maxRetryCount}
                      onChange={(e) => patch({ maxRetryCount: parseInt(e.target.value) || 0 })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Retry Delay (ms)</Label>
                    <Input
                      type="number" step={500} min={0}
                      value={draftAgent.retryDelayMs}
                      onChange={(e) => patch({ retryDelayMs: parseInt(e.target.value) || 1000 })}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Exponential Backoff</Label>
                  <Switch checked={draftAgent.exponentialBackoff} onCheckedChange={(v) => patch({ exponentialBackoff: v })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Retry on Timeout</Label>
                    <Switch checked={draftAgent.retryOnTimeout} onCheckedChange={(v) => patch({ retryOnTimeout: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Retry on Rate Limit</Label>
                    <Switch checked={draftAgent.retryOnRateLimit} onCheckedChange={(v) => patch({ retryOnRateLimit: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Retry on Network Error</Label>
                    <Switch checked={draftAgent.retryOnNetworkError} onCheckedChange={(v) => patch({ retryOnNetworkError: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Retry on Invalid Output</Label>
                    <Switch checked={draftAgent.retryOnInvalidOutput} onCheckedChange={(v) => patch({ retryOnInvalidOutput: v })} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Timeout config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="Clock" className="w-4 h-4 text-brand" /> Timeout Configuration</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label>Request Timeout (ms)</Label>
                  <Input
                    type="number" step={5000} min={5000} max={300000}
                    value={draftAgent.requestTimeoutMs}
                    onChange={(e) => patch({ requestTimeoutMs: parseInt(e.target.value) || 90000 })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Total Agent Timeout (ms)</Label>
                  <Input
                    type="number" step={5000} min={10000} max={600000}
                    value={draftAgent.totalAgentTimeoutMs}
                    onChange={(e) => patch({ totalAgentTimeoutMs: parseInt(e.target.value) || 120000 })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Max Queue Wait (ms)</Label>
                  <Input
                    type="number" step={5000} min={0} max={120000}
                    value={draftAgent.maxQueueWaitMs}
                    onChange={(e) => patch({ maxQueueWaitMs: parseInt(e.target.value) || 30000 })}
                    className="mt-1"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Validation rules */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="ShieldCheck" className="w-4 h-4 text-brand" /> Validation Rules</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Min Confidence Score: {draftAgent.minConfidenceScore}</Label>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={draftAgent.minConfidenceScore}
                      onChange={(e) => patch({ minConfidenceScore: parseInt(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                  <div>
                    <Label>Min Quality Score: {draftAgent.minQualityScore}</Label>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={draftAgent.minQualityScore}
                      onChange={(e) => patch({ minQualityScore: parseInt(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                  <div>
                    <Label>Min ATS Score: {draftAgent.minAtsScore}</Label>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={draftAgent.minAtsScore}
                      onChange={(e) => patch({ minAtsScore: parseInt(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                  <div>
                    <Label>Min Semantic Similarity: {draftAgent.minSemanticSimilarity}</Label>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={draftAgent.minSemanticSimilarity}
                      onChange={(e) => patch({ minSemanticSimilarity: parseInt(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                </div>
                <div>
                  <Label>On Failure Action</Label>
                  <select
                    value={draftAgent.onFailureAction}
                    onChange={(e) => patch({ onFailureAction: e.target.value as any })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                  >
                    <option value="retry">Retry</option>
                    <option value="reflect">Trigger Reflection</option>
                    <option value="regenerate-targeted">Regenerate Targeted Section</option>
                    <option value="fallback-model">Switch to Fallback Model</option>
                    <option value="stop-pipeline">Stop Pipeline</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Memory config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="Database" className="w-4 h-4 text-brand" /> Memory Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Read from Shared Memory</Label>
                  <Switch checked={draftAgent.readFromSharedMemory} onCheckedChange={(v) => patch({ readFromSharedMemory: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Write to Shared Memory</Label>
                  <Switch checked={draftAgent.writeToSharedMemory} onCheckedChange={(v) => patch({ writeToSharedMemory: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Cache Results</Label>
                  <Switch checked={draftAgent.cacheResults} onCheckedChange={(v) => patch({ cacheResults: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Persist Intermediate Results</Label>
                  <Switch checked={draftAgent.persistIntermediateResults} onCheckedChange={(v) => patch({ persistIntermediateResults: v })} />
                </div>
                <div>
                  <Label>Cache Duration (ms)</Label>
                  <Input
                    type="number" step={60000} min={0}
                    value={draftAgent.cacheDurationMs}
                    onChange={(e) => patch({ cacheDurationMs: parseInt(e.target.value) || 300000 })}
                    className="mt-1"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Output config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="FileOutput" className="w-4 h-4 text-brand" /> Output Configuration</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Output Format</Label>
                  <select
                    value={draftAgent.outputFormat}
                    onChange={(e) => patch({ outputFormat: e.target.value as any })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                  >
                    <option value="json">Structured JSON</option>
                    <option value="html">HTML</option>
                    <option value="markdown">Markdown (debug only)</option>
                    <option value="plain-text">Plain Text</option>
                  </select>
                </div>
                <div>
                  <Label>Output Visibility</Label>
                  <select
                    value={draftAgent.outputVisibility}
                    onChange={(e) => patch({ outputVisibility: e.target.value as any })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                  >
                    <option value="public">Public</option>
                    <option value="internal">Internal</option>
                    <option value="supervisor-only">Supervisor Only</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Prompt config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="FileText" className="w-4 h-4 text-brand" /> Prompt Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Prompt Version</Label>
                    <select
                      value={draftAgent.promptId}
                      onChange={(e) => {
                        const selectedPrompt = getPromptsForAgent(draftAgent.agentType).find((p) => p.id === e.target.value);
                        patch({ promptId: e.target.value, promptVersion: selectedPrompt?.version || 1 });
                      }}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                    >
                      <option value="">(default)</option>
                      {getPromptsForAgent(draftAgent.agentType).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} v{p.version} ({p.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Version Number</Label>
                    <Input
                      type="number" min={1}
                      value={draftAgent.promptVersion}
                      onChange={(e) => patch({ promptVersion: parseInt(e.target.value) || 1 })}
                      className="mt-1"
                    />
                  </div>
                </div>
                {draftAgent.promptId && (
                  <div className="rounded-md bg-secondary/30 p-3 text-xs">
                    {(() => {
                      const prompt = promptVersions.find((p) => p.id === draftAgent.promptId);
                      return prompt ? (
                        <div>
                          <div className="font-medium mb-1">{prompt.name}</div>
                          <div className="text-muted-foreground">{prompt.description}</div>
                          <div className="mt-2 text-[10px]">Variables: {prompt.variables.map((v) => v.name).join(", ") || "(none)"}</div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Reasoning config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="Brain" className="w-4 h-4 text-brand" /> Reasoning Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Enable Reasoning</Label>
                  <Switch checked={draftAgent.reasoningEnabled} onCheckedChange={(v) => patch({ reasoningEnabled: v })} />
                </div>
                {draftAgent.reasoningEnabled && (
                  <>
                    <div>
                      <Label>Reasoning Effort</Label>
                      <select
                        value={draftAgent.reasoningEffort}
                        onChange={(e) => patch({ reasoningEffort: e.target.value as any })}
                        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="maximum">Maximum</option>
                      </select>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Max Thinking Tokens</Label>
                        <Input
                          type="number" step={512} min={512} max={32768}
                          value={draftAgent.maxThinkingTokens}
                          onChange={(e) => patch({ maxThinkingTokens: parseInt(e.target.value) || 4096 })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Reasoning Timeout (ms)</Label>
                        <Input
                          type="number" step={5000} min={5000} max={120000}
                          value={draftAgent.reasoningTimeoutMs}
                          onChange={(e) => patch({ reasoningTimeoutMs: parseInt(e.target.value) || 30000 })}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Streaming config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Icon name="Radio" className="w-4 h-4 text-brand" /> Streaming Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Enable Streaming</Label>
                  <Switch checked={draftAgent.streamingEnabled} onCheckedChange={(v) => patch({ streamingEnabled: v })} />
                </div>
                {draftAgent.streamingEnabled && (
                  <>
                    <div className="flex items-center justify-between">
                      <Label>Stream Partial Responses</Label>
                      <Switch checked={draftAgent.streamPartialResponses} onCheckedChange={(v) => patch({ streamPartialResponses: v })} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Stream Thinking Process</Label>
                      <Switch checked={draftAgent.streamThinkingProcess} onCheckedChange={(v) => patch({ streamThinkingProcess: v })} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Stream Token Statistics</Label>
                      <Switch checked={draftAgent.streamTokenStatistics} onCheckedChange={(v) => patch({ streamTokenStatistics: v })} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Save button at bottom */}
            {dirty && (
              <div className="sticky bottom-4 z-10">
                <Card className="bg-brand text-white border-brand shadow-premium">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Icon name="AlertTriangle" className="w-4 h-4" /> You have unsaved changes to "{draftAgent.displayName}"
                    </span>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={discard} className="text-white hover:bg-white/10">Discard</Button>
                      <Button size="sm" onClick={save} className="bg-white text-brand hover:bg-white/90 gap-2">
                        <Icon name="Save" className="w-4 h-4" /> Save Agent Config
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="flex items-center justify-center h-96 text-muted-foreground">
              <div className="text-center">
                <Icon name="MousePointerClick" className="w-12 h-12 mx-auto mb-2 opacity-40" />
                <p>Select an agent from the left to configure it.</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
