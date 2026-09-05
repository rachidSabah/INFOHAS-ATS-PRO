"use client";

import { setFlightScope } from "@/lib/ai/flight-recorder";
setFlightScope({ scope: "resume-copilot", feature: "AI Models", module: "src.components.app.modules.AIModels" });

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { api as cloudApi } from "@/lib/cloud-api";
import { ProviderManager } from "@/lib/ai/services";
import { toast } from "sonner";
import { ProviderHealthPanel } from "./ProviderHealthPanel";
import { UnsavedBanner } from "./unsaved-changes";
import { isCliIntegration, isWebSessionIntegration } from "@/lib/provider-sync";

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
    { name: "gemini-2.5-flash", contextWindow: "1M", inputCost: 0, outputCost: 0, tags: ["free", "fast"] },
    { name: "gemini-2.5-flash-lite", contextWindow: "1M", inputCost: 0, outputCost: 0, tags: ["free", "fastest"] },
    { name: "gemini-2.5-pro", contextWindow: "2M", inputCost: 0, outputCost: 0, tags: ["free", "reasoning"] },
    { name: "gemini-2.0-flash", contextWindow: "1M", inputCost: 0, outputCost: 0, tags: ["free", "fast", "vision"] },
    { name: "gemini-2.0-flash-lite", contextWindow: "1M", inputCost: 0, outputCost: 0, tags: ["free", "fastest"] },
    { name: "gemini-1.5-pro", contextWindow: "2M", inputCost: 0, outputCost: 0, tags: ["free", "reasoning"] },
    { name: "gemini-1.5-flash", contextWindow: "1M", inputCost: 0, outputCost: 0, tags: ["free", "fast"] },
    { name: "models/gemini-2.5-flash", contextWindow: "1M", tags: ["free"] },
    { name: "models/gemini-2.5-flash-lite", contextWindow: "1M", tags: ["free"] },
    { name: "models/gemini-2.5-pro", contextWindow: "2M", tags: ["free"] },
    { name: "models/gemini-2.0-flash", contextWindow: "1M", tags: ["free"] },
    { name: "models/gemini-2.0-flash-lite", contextWindow: "1M", tags: ["free"] },
    { name: "models/gemini-1.5-flash", contextWindow: "1M", tags: ["free"] },
    { name: "models/gemini-1.5-pro", contextWindow: "2M", tags: ["free"] },
  ],
  deepseek: [
    { name: "deepseek-chat", contextWindow: "64K", inputCost: 0.00000014, outputCost: 0.00000028, tags: ["cheap", "fast"] },
    { name: "deepseek-reasoner", contextWindow: "64K", inputCost: 0.00000055, outputCost: 0.00000219, tags: ["reasoning", "cheap"] },
  ],
  groq: [
    { name: "llama-3.3-70b-versatile", contextWindow: "128K", tags: ["fast", "free"] },
    { name: "llama-3.1-8b-instant", contextWindow: "128K", tags: ["fastest", "free"] },
    { name: "mixtral-8x7b-32768", contextWindow: "32K", tags: ["free"] },
  ],
  puter: [
    { name: "claude-sonnet-4-5", contextWindow: "200K", tags: ["free", "flagship"] },
    { name: "gpt-5.4-nano", contextWindow: "128K", tags: ["free"] },
    { name: "gpt-4o", contextWindow: "128K", tags: ["free"] },
    { name: "gpt-4o-mini", contextWindow: "128K", tags: ["free", "fast"] },
    { name: "gemini-2.5-flash", contextWindow: "1M", tags: ["free", "fast"] },
    { name: "deepseek-chat", contextWindow: "64K", tags: ["free"] },
    { name: "deepseek-reasoner", contextWindow: "64K", tags: ["free", "reasoning"] },
    { name: "meta-llama/Llama-3.3-70B-Instruct", contextWindow: "128K", tags: ["free"] },
  ],
  ollama: [
    { name: "llama3.3:70b", contextWindow: "128K", tags: ["self-hosted"] },
    { name: "qwen2.5:32b", contextWindow: "32K", tags: ["self-hosted"] },
    { name: "mistral-nemo", contextWindow: "128K", tags: ["self-hosted"] },
    { name: "phi4:14b", contextWindow: "16K", tags: ["self-hosted", "small"] },
  ],
  opencode: [
    { name: "mimo-v2.5-free", contextWindow: "32K", tags: ["free"] },
    { name: "hy3-free", contextWindow: "32K", tags: ["free"] },
    { name: "nemotron-3-ultra-free", contextWindow: "32K", tags: ["free"] },
    { name: "nemotron-3.5-lightning-free", contextWindow: "32K", tags: ["free"] },
    { name: "laguna-s-2.1-free", contextWindow: "32K", tags: ["free"] },
    { name: "muse-spark-1.2-contributor-free", contextWindow: "32K", tags: ["free"] },
    { name: "deepseek-v4-flash-free", contextWindow: "64K", tags: ["free", "fast"] },
  ],
  openrouter: [
    { name: "openai/gpt-oss-120b:free", contextWindow: "128K", tags: ["free"] },
    { name: "openai/gpt-oss-20b:free", contextWindow: "128K", tags: ["free"] },
    { name: "x-ai/grok-3-mini:free", contextWindow: "128K", tags: ["free", "fast"] },
    { name: "x-ai/grok-3-mini-beta:free", contextWindow: "128K", tags: ["free"] },
    { name: "deepseek/deepseek-chat-v3-0324:free", contextWindow: "64K", tags: ["free", "fast"] },
    { name: "deepseek/deepseek-r1:free", contextWindow: "64K", tags: ["free", "reasoning"] },
    { name: "deepseek/deepseek-r1-0528:free", contextWindow: "64K", tags: ["free"] },
    { name: "tngtech/deepseek-r1t2-chimera:free", contextWindow: "64K", tags: ["free"] },
    { name: "meta-llama/llama-4-maverick:free", contextWindow: "128K", tags: ["free"] },
    { name: "meta-llama/llama-4-scout:free", contextWindow: "128K", tags: ["free"] },
    { name: "meta-llama/llama-3.3-70b-instruct:free", contextWindow: "128K", tags: ["free"] },
    { name: "meta-llama/llama-3.2-3b-instruct:free", contextWindow: "128K", tags: ["free", "fastest"] },
    { name: "qwen/qwen3-235b-a22b:free", contextWindow: "128K", tags: ["free"] },
    { name: "qwen/qwen3-30b-a3b-free", contextWindow: "128K", tags: ["free"] },
    { name: "qwen/qwen3-32b:free", contextWindow: "128K", tags: ["free"] },
    { name: "qwen/qwen3-14b:free", contextWindow: "128K", tags: ["free"] },
    { name: "qwen/qwen3-8b:free", contextWindow: "128K", tags: ["free"] },
    { name: "qwen/qwen3-coder:free", contextWindow: "128K", tags: ["free"] },
    { name: "qwen/qwen3-next-80b-a3b-instruct:free", contextWindow: "128K", tags: ["free"] },
    { name: "google/gemma-4-31b-it:free", contextWindow: "1M", tags: ["free"] },
    { name: "google/gemma-4-26b-a4b-it:free", contextWindow: "1M", tags: ["free"] },
    { name: "google/gemma-3-27b-it:free", contextWindow: "1M", tags: ["free"] },
    { name: "nvidia/nemotron-3-ultra-550b-a55b:free", contextWindow: "128K", tags: ["free"] },
    { name: "nvidia/nemotron-3-super-120b-a12b:free", contextWindow: "128K", tags: ["free"] },
    { name: "nvidia/nemotron-3-nano-30b-a3b:free", contextWindow: "128K", tags: ["free"] },
    { name: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", contextWindow: "128K", tags: ["free", "reasoning"] },
    { name: "nvidia/nemotron-nano-12b-v2-vl:free", contextWindow: "128K", tags: ["free"] },
    { name: "nvidia/nemotron-nano-9b-v2:free", contextWindow: "128K", tags: ["free"] },
    { name: "nvidia/nemotron-3.5-content-safety:free", contextWindow: "128K", tags: ["free"] },
    { name: "moonshotai/kimi-k2:free", contextWindow: "128K", tags: ["free"] },
    { name: "mistralai/mistral-7b-instruct:free", contextWindow: "128K", tags: ["free"] },
    { name: "mistralai/mistral-small-3.2-24b-instruct:free", contextWindow: "32K", tags: ["free"] },
    { name: "cohere/north-mini-code:free", contextWindow: "128K", tags: ["free"] },
    { name: "nousresearch/hermes-3-llama-3.1-405b:free", contextWindow: "128K", tags: ["free"] },
    { name: "stepfun/step-3.5-flash:free", contextWindow: "128K", tags: ["free", "fast"] },
    { name: "liquid/lfm-2.5-1.2b-instruct:free", contextWindow: "128K", tags: ["free"] },
    { name: "liquid/lfm-2.5-1.2b-thinking:free", contextWindow: "128K", tags: ["free", "reasoning"] },
    { name: "poolside/laguna-m.1:free", contextWindow: "128K", tags: ["free"] },
    { name: "poolside/laguna-xs.2:free", contextWindow: "128K", tags: ["free"] },
    { name: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", contextWindow: "128K", tags: ["free"] },
    { name: "sarvamai/sarvam-m:free", contextWindow: "128K", tags: ["free"] },
    { name: "featherless/qwerky-72b:free", contextWindow: "128K", tags: ["free"] },
    { name: "bytedance-research/ui-tars-72b:free", contextWindow: "128K", tags: ["free"] },
    { name: "shisa-ai/shisa-v2-llama3.3-70b:free", contextWindow: "128K", tags: ["free"] },
    { name: "openrouter/owl-alpha:free", contextWindow: "1M", tags: ["free", "agentic"] },
    { name: "openrouter/free", contextWindow: "128K", tags: ["free", "router"] },
  ],
  nvidia: [
    { name: "nvidia/nemotron-3-super-120b-a12b", contextWindow: "128K", tags: ["free", "instruct"] },
    { name: "deepseek-ai/deepseek-v4-flash", contextWindow: "64K", tags: ["free", "fast"] },
    { name: "deepseek-ai/deepseek-v4-pro", contextWindow: "64K", tags: ["free", "reasoning"] },
    { name: "minimaxai/minimax-m3", contextWindow: "32K", tags: ["free"] },
    { name: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", contextWindow: "32K", tags: ["free", "reasoning"] },
    { name: "nvidia/nemotron-3-super-120b-a12b", contextWindow: "32K", tags: ["free"] },
    { name: "nvidia/nemotron-3-ultra-550b-a55b", contextWindow: "32K", tags: ["free"] },
  ],
  mistral: [
    { name: "mistral-small-latest", contextWindow: "32K", tags: ["free", "fast"] },
    { name: "codestral-latest", contextWindow: "32K", tags: ["free", "code"] },
    { name: "ministral-8b-latest", contextWindow: "32K", tags: ["free", "fastest"] },
    { name: "pixtral-large-latest", contextWindow: "32K", tags: ["free", "vision"] },
    { name: "open-mistral-nemo", contextWindow: "128K", tags: ["free"] },
  ],
  antigravity: [
    { name: "gemini-2.5-flash", contextWindow: "1M", tags: ["free", "fast"] },
    { name: "gemini-2.5-pro", contextWindow: "2M", tags: ["free", "reasoning"] },
    { name: "claude-sonnet-4", contextWindow: "200K", tags: ["free", "flagship"] },
    { name: "gpt-4.1", contextWindow: "128K", tags: ["free"] },
    { name: "deepseek-v4", contextWindow: "64K", tags: ["free"] },
  ],
  cerebras: [
    { name: "qwen-3-235b", contextWindow: "128K", tags: ["free", "flagship"] },
    { name: "qwen-3-32b", contextWindow: "128K", tags: ["free"] },
    { name: "llama-3.3-70b", contextWindow: "128K", tags: ["free", "fast"] },
    { name: "llama-4-scout-17b", contextWindow: "128K", tags: ["free"] },
    { name: "llama-4-maverick-17b", contextWindow: "128K", tags: ["free"] },
    { name: "deepseek-r1", contextWindow: "64K", tags: ["free", "reasoning"] },
  ],
  huggingface: [
    { name: "meta-llama/Llama-3.3-70B-Instruct", contextWindow: "128K", tags: ["free"] },
    { name: "meta-llama/Llama-4-Scout-17B-16E-Instruct", contextWindow: "128K", tags: ["free"] },
    { name: "Qwen/Qwen3-235B-A22B", contextWindow: "128K", tags: ["free", "flagship"] },
    { name: "Qwen/Qwen3-32B", contextWindow: "128K", tags: ["free"] },
    { name: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", contextWindow: "64K", tags: ["free", "reasoning"] },
    { name: "deepseek-ai/DeepSeek-R1-0528", contextWindow: "64K", tags: ["free", "reasoning"] },
    { name: "mistralai/Mistral-7B-Instruct-v0.3", contextWindow: "32K", tags: ["free", "fast"] },
    { name: "microsoft/phi-4", contextWindow: "16K", tags: ["free", "small"] },
    { name: "google/gemma-2-27b-it", contextWindow: "8K", tags: ["free"] },
  ],
  together: [
    { name: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", contextWindow: "128K", tags: ["free", "fast"] },
    { name: "meta-llama/Llama-4-Scout-17B-16E-Instruct-Free", contextWindow: "128K", tags: ["free"] },
    { name: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8-Free", contextWindow: "128K", tags: ["free"] },
    { name: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free", contextWindow: "64K", tags: ["free", "reasoning"] },
    { name: "Qwen/Qwen3-235B-A22B-fp8-tbo-free", contextWindow: "128K", tags: ["free"] },
    { name: "Qwen/Qwen3-30B-A3B-fp8-tbo-free", contextWindow: "128K", tags: ["free"] },
    { name: "moonshotai/Kimi-K2-Instruct-free", contextWindow: "128K", tags: ["free"] },
  ],
  sambanova: [
    { name: "Meta-Llama-4-Maverick-17B-128E-Instruct", contextWindow: "128K", tags: ["free"] },
    { name: "Meta-Llama-4-Scout-17B-16E-Instruct", contextWindow: "128K", tags: ["free"] },
    { name: "Meta-Llama-3.3-70B-Instruct", contextWindow: "128K", tags: ["free", "fast"] },
    { name: "DeepSeek-R1-671B", contextWindow: "64K", tags: ["free", "reasoning"] },
    { name: "DeepSeek-V3-0324", contextWindow: "64K", tags: ["free"] },
    { name: "Qwen3-32B", contextWindow: "128K", tags: ["free"] },
    { name: "QwQ-32B", contextWindow: "128K", tags: ["free", "reasoning"] },
  ],
  perplexity: [
    { name: "sonar", contextWindow: "128K", tags: ["free", "search"] },
    { name: "sonar-pro", contextWindow: "200K", tags: ["search"] },
    { name: "sonar-reasoning", contextWindow: "128K", tags: ["free", "reasoning", "search"] },
    { name: "sonar-reasoning-pro", contextWindow: "200K", tags: ["reasoning", "search"] },
    { name: "r1-1776", contextWindow: "128K", tags: ["free", "reasoning"] },
  ],
};


export function AIModels() {
  const providers = useApp((s) => s.providers);
  const updateProvider = useApp((s) => s.updateProvider);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providers[0]?.id ?? "");
  const [customModel, setCustomModel] = useState("");
  const [fetching, setFetching] = useState(false);
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [freeOnly, setFreeOnly] = useState(false);
  const [autoAddFree, setAutoAddFree] = useState(true);
  const [newlyDiscovered, setNewlyDiscovered] = useState<string[]>([]);
  const [savingAll, setSavingAll] = useState(false);
  // Unsaved-changes tracking (same contract as the other Super Admin panels):
  // model edits (toggle, custom add, default model, auto-add) mark the panel
  // dirty until "Save Models" confirms every provider reached D1. Cleared only
  // on a fully successful save-all.
  const [dirty, setDirty] = useState(false);

  // Explicit cloud commit of every provider's model configuration
  // (enabledModels + modelName). Inline edits already sync fire-and-forget;
  // this button repairs any that failed and confirms persistence.
  const handleSaveModels = async () => {
    setSavingAll(true);
    try {
      const results = await Promise.allSettled(
        providers.map((p) => cloudApi.updateProvider(p.id, {
          modelName: p.modelName, enabledModels: p.enabledModels,
        })),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === 0) {
        setDirty(false);
        toast.success("All model selections saved — they survive refresh now.");
      } else toast.error(`${failed} provider(s) failed to save — check your connection and retry.`);
    } finally {
      setSavingAll(false);
    }
  };

  // === COST CALCULATOR STATES ===
  const [testModel, setTestModel] = useState("");
  const [estInputTokens, setEstInputTokens] = useState(2500);
  const [estOutputTokens, setEstOutputTokens] = useState(1000);

  const selected = providers.find((p) => p.id === selectedProviderId);

  // Providers hydrate asynchronously (D1/worker sync) — if the selection was
  // initialized from an empty list, auto-select the first provider once the
  // list arrives. Without this, `selected` stays undefined and the whole
  // right column (catalog + calculator) would never render.
  useEffect(() => {
    if (providers.length > 0 && !providers.some((p) => p.id === selectedProviderId)) {
      setSelectedProviderId(providers[0].id);
    }
  }, [providers, selectedProviderId]);
  const catalog = selected ? (MODEL_CATALOG[selected.type] ?? []) : [];
  const enabledModels = selected?.enabledModels ?? [];

  // Sync testModel when selected provider changes
  useEffect(() => {
    if (enabledModels.length > 0) {
      setTestModel(enabledModels[0]);
    } else {
      setTestModel("");
    }
  }, [selectedProviderId, enabledModels.length]);

  const calculateEstimatedCost = (): number | null => {
    if (!selected || !testModel) return null;
    const cat = MODEL_CATALOG[selected.type] || [];
    const modelInfo = cat.find(m => m.name === testModel);
    // HONEST PRICING (directive #20): no catalog entry (or a free-tagged one)
    // means pricing is UNKNOWN, not $0. Return null so the UI never presents
    // a fabricated $0.000000 as if the provider had confirmed free usage.
    if (!modelInfo) return null;
    if (modelInfo.inputCost === undefined && modelInfo.outputCost === undefined) return null;
    const inputRate = modelInfo.inputCost ?? 0;
    const outputRate = modelInfo.outputCost ?? 0;
    return (estInputTokens * inputRate) + (estOutputTokens * outputRate);
  };

  /** Returns true if a model ID looks like a free-tier model based on naming conventions. */
  const isFreeModel = (id: string) =>
    id.endsWith(":free") ||
    id.includes("/free") ||
    /(^|-|_)free($|-|_)/i.test(id.split("/").pop() ?? id);

  const fetchLiveModels = async () => {
    if (!selected) return;
    setFetching(true);
    setLiveModels([]);
    setNewlyDiscovered([]);
    const result = await ProviderManager.fetchModels(selected);
    setFetching(false);
    if (result.ok && result.models.length > 0) {
      setLiveModels(result.models);

      // Auto-discover: find free models not yet in enabledModels and add them automatically
      if (autoAddFree) {
        const currentEnabled = selected.enabledModels ?? [];
        const discovered = result.models.filter(
          (m) => isFreeModel(m) && !currentEnabled.includes(m)
        );
        if (discovered.length > 0) {
          updateProvider(selected.id, { enabledModels: [...currentEnabled, ...discovered] });
          setDirty(true);
          setNewlyDiscovered(discovered);
          toast.success(
            `✨ Auto-added ${discovered.length} new free model${discovered.length > 1 ? "s" : ""} from ${selected.name}.`,
            { duration: 5000 }
          );
        } else {
          toast.success(`Fetched ${result.models.length} live models — no new free models discovered.`);
        }
      } else {
        toast.success(`Fetched ${result.models.length} live models from ${selected.name}.`);
      }
    } else {
      toast.error(result.error || "Failed to fetch models. Check the provider's API key and Base URL.");
    }
  };

  const toggleModel = (modelName: string) => {
    if (!selected) return;
    const current = selected.enabledModels ?? [];
    const next = current.includes(modelName)
      ? current.filter((m) => m !== modelName)
      : [...current, modelName];
    updateProvider(selected.id, { enabledModels: next });
    setDirty(true);
    toast.success(`${modelName} ${next.includes(modelName) ? "enabled" : "disabled"} for ${selected.name}.`);
  };

  const addCustom = () => {
    if (!selected || !customModel.trim()) return;
    const next = [...(selected.enabledModels ?? []), customModel.trim()];
    updateProvider(selected.id, { enabledModels: next });
    setDirty(true);
    setCustomModel("");
    toast.success(`Added custom model: ${customModel.trim()}`);
  };

  const setAsDefaultModel = (modelName: string) => {
    if (!selected) return;
    updateProvider(selected.id, { modelName });
    setDirty(true);
    toast.success(`${modelName} set as default model for ${selected.name}.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Boxes" className="w-6 h-6 text-brand" /> AI Models</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse the model catalog and enable specific models per provider.</p>
        </div>
        <Button onClick={handleSaveModels} disabled={savingAll} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name="Save" className="w-4 h-4" /> {savingAll ? "Saving…" : "Save Models"}
        </Button>
      </div>

      {dirty && <UnsavedBanner saveLabel="Save Models" />}

      {/* Provider Health — Auto-Heal + Manual Heal (directives #7–#20).
          Rendered UNCONDITIONALLY at the top so the healing controls are always
          visible, independent of which provider is selected. */}
      <ProviderHealthPanel />

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
                      {/* Task 29 — integration identity tag: a CLI integration (Antigravity)
                          keeps Google-family model ids it synced, but they remain CLI-owned
                          models — ownership is the integration, never the model name. */}
                      {isCliIntegration(selected) ? (
                        <span title="CLI integration — models here belong to the CLI integration (provider_id = antigravity), even when ids look like Google models.">
                          <Badge variant="outline" className="text-[10px] font-semibold">CLI</Badge>
                        </span>
                      ) : isWebSessionIntegration(selected) ? (
                        <span title="Web-session integration — models here belong to the Z.ai Web session (provider_id = zai-web). The same GLM model may exist separately under an official Z.ai API integration.">
                          <Badge variant="outline" className="text-[10px] font-semibold">WEB SESSION</Badge>
                        </span>
                      ) : (
                        <Badge variant="outline" className="capitalize text-[10px]">{selected.type.replace("-", " ")}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Default model: <span className="font-mono">{selected.modelName || "—"}</span> · {enabledModels.length} models enabled
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Add custom model + fetch live models */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex gap-2">
                    <Input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="Add custom model name (e.g. gpt-4o-2024-08-06)" onKeyDown={(e) => e.key === "Enter" && addCustom()} />
                    <Button onClick={addCustom} disabled={!customModel.trim()} className="bg-brand hover:bg-brand-dark text-white gap-2 shrink-0">
                      <Icon name="Plus" className="w-4 h-4" /> Add
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
                    <Button onClick={fetchLiveModels} disabled={fetching || !selected} variant="outline" className="gap-2">
                      {fetching ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="DownloadCloud" className="w-4 h-4" />}
                      {fetching ? "Fetching…" : "Fetch live models from API"}
                    </Button>
                    <button
                      onClick={() => setAutoAddFree((v) => !v)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition ${autoAddFree ? "border-green-500 bg-green-500 text-white" : "border-border text-muted-foreground hover:border-green-500/50"}`}
                      title="Automatically enable any new free-tier models discovered from the live API"
                    >
                      <Icon name="Zap" className="w-3.5 h-3.5" />
                      Auto-add free
                    </button>
                    <button
                      onClick={() => setFreeOnly((v) => !v)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition ${freeOnly ? "border-brand bg-brand text-white" : "border-border text-muted-foreground hover:border-brand/50"}`}
                      title="Show only free models in the live results below"
                    >
                      <Icon name="Sparkles" className="w-3.5 h-3.5" />
                      Free only
                    </button>
                    <span className="text-xs text-muted-foreground">Calls GET /v1/models on the provider's API</span>
                  </div>
                  {liveModels.length > 0 && (
                    <div className="space-y-2">
                      {(() => {
                        const displayed = freeOnly ? liveModels.filter((m) => m.endsWith(":free") || m.includes("/free") || m.toLowerCase().includes("-free")) : liveModels;
                        return (
                          <>
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {displayed.length}{freeOnly && liveModels.length !== displayed.length ? ` of ${liveModels.length}` : ""} live models from {selected?.name}{freeOnly ? " (free only)" : ""}
                            </div>
                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-1">
                        {displayed.map((m) => {
                          const isEnabled = enabledModels.includes(m);
                          const isDefault = selected?.modelName === m;
                          const isNew = newlyDiscovered.includes(m);
                          return (
                            <div key={m} className={`rounded-md border p-2 ${isNew ? "border-green-500 bg-green-500/10" : isEnabled ? "border-brand bg-brand-light/30" : "border-border"}`}>
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-mono text-[11px] truncate">{m}</span>
                                <div className="flex gap-1 shrink-0">
                                  {isNew && <Badge className="text-[8px] bg-green-500 text-white border-0">NEW</Badge>}
                                  {isDefault && <Badge variant="gold" className="text-[8px]">DEFAULT</Badge>}
                                </div>
                              </div>
                              <div className="flex gap-1 mt-1">
                                <button onClick={() => toggleModel(m)} className={`text-[10px] px-1.5 py-0.5 rounded ${isEnabled ? "bg-brand text-white" : "bg-secondary"}`}>
                                  {isEnabled ? "Enabled" : "Enable"}
                                </button>
                                <button onClick={() => setAsDefaultModel(m)} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary" title="Set as default">
                                  <Icon name="Star" className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
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

              {/* Cost Estimator (depends on the selected provider/model).
                  The benchmarker + auto-heal + manual-heal controls live in
                  <ProviderHealthPanel />, rendered at the top of this page. */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  {/* Cost Estimator */}
                  <div className="rounded-lg bg-secondary/40 p-3 space-y-3 border border-border/60">
                    <div className="font-semibold text-xs flex items-center gap-1.5">
                      <Icon name="Calculator" className="w-3.5 h-3.5 text-brand" />
                      <span>Estimated Token Cost Calculator</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="input-tokens" className="text-[10px] text-muted-foreground">Estimated Input Tokens</Label>
                        <Input
                          id="input-tokens"
                          type="number"
                          value={estInputTokens}
                          onChange={(e) => setEstInputTokens(parseInt(e.target.value) || 0)}
                          className="h-8 text-xs mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="output-tokens" className="text-[10px] text-muted-foreground">Estimated Output Tokens</Label>
                        <Input
                          id="output-tokens"
                          type="number"
                          value={estOutputTokens}
                          onChange={(e) => setEstOutputTokens(parseInt(e.target.value) || 0)}
                          className="h-8 text-xs mt-1"
                        />
                      </div>
                    </div>
                    <div className="pt-2 border-t border-border flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Calculated Cost for {testModel || "selected model"}:</span>
                      {(() => {
                        // Directive #20: unknown pricing must not display as $0.000000.
                        const cost = calculateEstimatedCost();
                        return cost === null ? (
                          <span className="font-bold text-sm text-muted-foreground">Unknown (no verified pricing)</span>
                        ) : (
                          <span className="font-bold text-sm text-brand">${cost.toFixed(6)}</span>
                        );
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
