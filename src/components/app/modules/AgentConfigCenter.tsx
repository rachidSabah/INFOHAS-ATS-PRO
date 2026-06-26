"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import type { AgentConfig, AgentType } from "@/lib/pipeline-orchestration-types";

export function AgentConfigCenter() {
  const agentConfigs = useApp((s) => s.agentConfigs);
  const providers = useApp((s) => s.providers);
  const updateAgentConfig = useApp((s) => s.updateAgentConfig);
  const promptVersions = useApp((s) => s.promptVersions);

  const [selectedAgentType, setSelectedAgentType] = useState<AgentType | null>(null);
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [dirty, setDirty] = useState(false);

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
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return [];
    const models = provider.enabledModels || [];
    if (provider.modelName && !models.includes(provider.modelName)) {
      models.unshift(provider.modelName);
    }
    return models;
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

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        {/* Agent list sidebar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agents ({agentConfigs.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[600px] overflow-y-auto">
            {agentConfigs
              .slice()
              .sort((a, b) => a.executionOrder - b.executionOrder)
              .map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleSelectAgent(agent.agentType)}
                  className={`w-full text-left rounded-md p-2 transition-colors ${
                    selectedAgentType === agent.agentType
                      ? "bg-brand/10 border border-brand/30"
                      : "hover:bg-secondary/50 border border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{agent.displayName}</span>
                    {agent.enabled ? (
                      <Badge variant="success" className="text-[9px] shrink-0">ON</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] shrink-0">OFF</Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Order: {agent.executionOrder} · {agent.agentType}
                  </div>
                </button>
              ))}
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
