// ============================================================================
// Zustand Store — Admin & Settings Slice
// ============================================================================

"use client";

import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type {
  AIProvider, AIProviderLog, AIProviderSettings, FallbackChainConfig,
  PromptTemplate, BrandingConfig, FeatureFlags, OptimizerDirectiveConfig
} from "../types";
import type {
  PipelineProfile, AgentConfig, PromptVersion
} from "../pipeline-orchestration-types";
import {
  SEED_PROVIDERS, SEED_PROVIDER_LOGS, SEED_PROVIDER_SETTINGS, SEED_PROMPTS,
  SEED_BRANDING, SEED_FLAGS, SEED_OPTIMIZER_DIRECTIVE, SEED_FALLBACK_CHAIN
} from "../mock-data";
import {
  SEED_PIPELINE_PROFILES, SEED_AGENT_CONFIGS, SEED_PROMPT_VERSIONS
} from "../pipeline-orchestration-seeds";
import { uid } from "./helpers";
import { api as cloudApi, cloudApiSafe } from "../cloud-api";

const {
  createProvider, updateProvider: cloudUpdateProvider, deleteProvider,
  createPrompt, updatePrompt: cloudUpdatePrompt, deletePrompt,
  updateBranding, updateFlag,
} = cloudApi;

// ----------------------------------------------------------------------------
// Persist provider / prompt active-toggles to localStorage so a page refresh
// no longer resets them to the SEED_PROVIDERS defaults. Without this, the
// Super Admin health gauge bounced (e.g. 97% -> 31%) on every reload because
// the `providers` array is re-seeded from defaults each load.
// ----------------------------------------------------------------------------
const PROVIDER_ACTIVE_KEY = "resumeai-provider-active";
const PROMPT_ACTIVE_KEY = "resumeai-prompt-active";

function loadActiveOverrides(key: string): Record<string, boolean> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveActiveOverrides(key: string, map: Record<string, boolean>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function applyActiveOverrides<T extends { id: string; isActive: boolean }>(
  items: T[],
  overrides: Record<string, boolean>
): T[] {
  if (!overrides || Object.keys(overrides).length === 0) return items;
  return items.map((it) =>
    overrides[it.id] !== undefined ? { ...it, isActive: overrides[it.id] } : it
  );
}

export interface AdminSlice {
  providers: AIProvider[];
  providerLogs: AIProviderLog[];
  providerSettings: AIProviderSettings;
  fallbackChain: FallbackChainConfig;
  pipelineProfiles: PipelineProfile[];
  selectedProfileId: string;
  agentConfigs: AgentConfig[];
  promptVersions: PromptVersion[];
  prompts: PromptTemplate[];
  branding: BrandingConfig;
  flags: FeatureFlags;
  optimizerDirective: OptimizerDirectiveConfig;

  addProvider: (p: AIProvider) => void;
  updateProvider: (id: string, patch: Partial<AIProvider>) => void;
  removeProvider: (id: string) => void;
  duplicateProvider: (id: string) => string | null;
  setDefaultProvider: (id: string) => void;
  toggleFallback: (id: string) => void;
  reorderFallback: (id: string, direction: "up" | "down") => void;
  openFallbackOffer: (choices: AIProvider[], currentProviderId: string | null) => void;
  closeFallbackOffer: () => void;
  addProviderLog: (l: AIProviderLog) => void;
  clearProviderLogs: (providerId?: string) => void;
  updateProviderSettings: (patch: Partial<AIProviderSettings>) => void;
  addPrompt: (p: PromptTemplate) => void;
  updatePrompt: (id: string, patch: Partial<PromptTemplate>) => void;
  removePrompt: (id: string) => void;
  updateBranding: (patch: Partial<BrandingConfig>) => void;
  updateFlag: (k: keyof FeatureFlags, v: boolean) => void;
  updateOptimizerDirective: (patch: Partial<OptimizerDirectiveConfig>) => void;
  resetOptimizerDirective: () => void;
  updateFallbackChain: (patch: Partial<FallbackChainConfig>) => void;
  resetFallbackChain: () => void;
  updatePipelineProfile: (id: string, patch: Partial<PipelineProfile>) => void;
  addPipelineProfile: (profile: PipelineProfile) => void;
  removePipelineProfile: (id: string) => void;
  selectPipelineProfile: (id: string) => void;
  updateAgentConfig: (agentType: string, patch: Partial<AgentConfig>) => void;
  applyOptimalAgentDefaults: () => void;
  updatePromptVersion: (id: string, patch: Partial<PromptVersion>) => void;
  addPromptVersion: (prompt: PromptVersion) => void;
  resetPipelineOrchestration: () => void;
}

export const createAdminSlice: StateCreator<AppState, [], [], AdminSlice> = (set, get) => ({
  providers: applyActiveOverrides(SEED_PROVIDERS, loadActiveOverrides(PROVIDER_ACTIVE_KEY)),
  providerLogs: SEED_PROVIDER_LOGS,
  providerSettings: (() => {
    if (typeof localStorage === "undefined") return SEED_PROVIDER_SETTINGS;
    try {
      const saved = localStorage.getItem("resumeai-provider-settings");
      if (saved) {
        const ls = JSON.parse(saved);
        if (ls.defaultProviderId || ls.defaultModel) {
          return { ...SEED_PROVIDER_SETTINGS, ...ls };
        }
      }
    } catch {}
    return SEED_PROVIDER_SETTINGS;
  })(),
  fallbackChain: SEED_FALLBACK_CHAIN,
  pipelineProfiles: SEED_PIPELINE_PROFILES,
  selectedProfileId: SEED_PIPELINE_PROFILES.find((p) => p.isDefault)?.id || SEED_PIPELINE_PROFILES[0]?.id || "",
  agentConfigs: SEED_AGENT_CONFIGS,
  promptVersions: SEED_PROMPT_VERSIONS,
  prompts: applyActiveOverrides(SEED_PROMPTS, loadActiveOverrides(PROMPT_ACTIVE_KEY)),
  branding: SEED_BRANDING,
  flags: SEED_FLAGS,
  optimizerDirective: SEED_OPTIMIZER_DIRECTIVE,

  addProvider: (p) => {
    set((s) => ({ providers: [...s.providers, p] }));
    // Persist active-toggle so it survives refresh.
    try {
      const current = loadActiveOverrides(PROVIDER_ACTIVE_KEY);
      current[p.id] = p.isActive;
      saveActiveOverrides(PROVIDER_ACTIVE_KEY, current);
    } catch {}
    cloudApiSafe(createProvider)(p).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    try {
      import("../provider-sync").then(({ syncProviderConfigs, calculateProviderHash }) => {
        const currentProviders = get().providers as any[];
        const currentHash = calculateProviderHash(currentProviders);
        const lastHash = get()._lastProviderHash;
        if (currentHash !== lastHash) {
          const { providers: syncedProviders } = syncProviderConfigs(currentProviders);
          const syncedJson = JSON.stringify(syncedProviders);
          const currentJson = JSON.stringify(currentProviders);
          if (currentJson !== syncedJson) {
            set({ providers: syncedProviders, _lastProviderHash: calculateProviderHash(syncedProviders) });
          }
        }
      }).catch(() => {});
    } catch {}
  },

  updateProvider: (id, patch) => {
    set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)) }));
    cloudApiSafe(cloudUpdateProvider)(id, patch).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    // Persist active-toggle so it survives refresh.
    if (patch.isActive !== undefined) {
      try {
        const current = loadActiveOverrides(PROVIDER_ACTIVE_KEY);
        current[id] = patch.isActive;
        saveActiveOverrides(PROVIDER_ACTIVE_KEY, current);
      } catch {}
    }
    try {
      import("../provider-sync").then(({ syncProviderConfigs, calculateProviderHash }) => {
        const currentProviders = get().providers as any[];
        const currentHash = calculateProviderHash(currentProviders);
        const lastHash = get()._lastProviderHash;
        if (currentHash !== lastHash) {
          const { providers: syncedProviders, result } = syncProviderConfigs(currentProviders);
          const syncedJson = JSON.stringify(syncedProviders);
          const currentJson = JSON.stringify(currentProviders);
          if (currentJson !== syncedJson) {
            set({ providers: syncedProviders, _lastProviderHash: calculateProviderHash(syncedProviders) });
            if (result.repaired > 0 || result.backfilled > 0) {
              console.info(`[PROVIDER SYNC] Provider updated. ${result.repaired} repaired, ${result.backfilled} backfilled.`);
            }
          }
        }
      }).catch(() => {});
    } catch {}
  },

  removeProvider: (id) => {
    if (typeof window !== "undefined") {
      try {
        const deleted = JSON.parse(localStorage.getItem("resumeai-deleted-providers") || "[]");
        if (!deleted.includes(id)) {
          localStorage.setItem("resumeai-deleted-providers", JSON.stringify([...deleted, id]));
        }
        const activeMap = loadActiveOverrides(PROVIDER_ACTIVE_KEY);
        delete activeMap[id];
        saveActiveOverrides(PROVIDER_ACTIVE_KEY, activeMap);
      } catch (e) { console.warn("[store] Failed to save deleted provider to localStorage:", e); }
    }
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      providerLogs: s.providerLogs.filter((l) => l.providerId !== id),
      providerSettings: {
        ...s.providerSettings,
        defaultProviderId: s.providerSettings.defaultProviderId === id ? null : s.providerSettings.defaultProviderId,
        fallbackProviderIds: s.providerSettings.fallbackProviderIds.filter((fid) => fid !== id),
      },
    }));
    cloudApiSafe(deleteProvider)(id).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  duplicateProvider: (id) => {
    const src = get().providers.find((p) => p.id === id);
    if (!src) return null;
    const newId = uid("p");
    const copy: AIProvider = {
      ...src,
      id: newId,
      name: `${src.name} (copy)`,
      isDefault: false,
      isBuiltIn: false,
      isActive: false,
      status: "untested",
      usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
      lastUsedAt: undefined,
    };
    set((s) => ({ providers: [...s.providers, copy] }));
    cloudApiSafe(createProvider)(copy).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    return newId;
  },

  setDefaultProvider: (id) => {
    set((s) => ({
      providers: s.providers.map((p) => ({ ...p, isDefault: p.id === id })),
      providerSettings: { ...s.providerSettings, defaultProviderId: id },
    }));
    get().providers.forEach((p) => cloudApiSafe(cloudUpdateProvider)(p.id, { isDefault: p.id === id }).catch((e) => { console.warn("[store] Cloud sync failed:", e); }));
  },

  toggleFallback: (id) => {
    set((s) => {
      const isIn = s.providerSettings.fallbackProviderIds.includes(id);
      return {
        providers: s.providers.map((p) => (p.id === id ? { ...p, isFallback: !isIn } : p)),
        providerSettings: {
          ...s.providerSettings,
          fallbackProviderIds: isIn
            ? s.providerSettings.fallbackProviderIds.filter((fid) => fid !== id)
            : [...s.providerSettings.fallbackProviderIds, id],
        },
      };
    });
    const p = get().providers.find((x) => x.id === id);
    if (p) cloudApiSafe(cloudUpdateProvider)(id, { isFallback: p.isFallback }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  reorderFallback: (id, direction) => {
    set((s) => {
      const ids = [...s.providerSettings.fallbackProviderIds];
      const i = ids.indexOf(id);
      if (i < 0) return s;
      const j = direction === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return s;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { providerSettings: { ...s.providerSettings, fallbackProviderIds: ids } };
    });
  },

  openFallbackOffer: (choices, currentProviderId) => set({
    fallbackOfferOpen: true,
    fallbackOfferChoices: choices,
    fallbackOfferCurrentProviderId: currentProviderId,
  }),

  closeFallbackOffer: () => set({
    fallbackOfferOpen: false,
    fallbackOfferChoices: [],
    fallbackOfferCurrentProviderId: null,
  }),

  addProviderLog: (l) => {
    set((s) => ({
      providerLogs: [l, ...s.providerLogs].slice(0, 1000),
      providers: s.providers.map((p) =>
        p.id === l.providerId
          ? {
              ...p,
              lastUsedAt: l.createdAt,
              status: l.status === "success" ? "healthy" : l.status === "timeout" || l.status === "rate_limited" ? "degraded" : "down",
              // usage may be missing on freshly created providers (editor save /
              // rotation swaps before first rehydrate) — a crash here would turn
              // every successful AI call into a thrown error inside the router.
              usage: {
                ...p.usage,
                requests: (p.usage?.requests ?? 0) + 1,
                tokens: (p.usage?.tokens ?? 0) + (l.inputTokens ?? 0) + (l.outputTokens ?? 0),
                errors: (p.usage?.errors ?? 0) + (l.status === "success" ? 0 : 1),
                avgLatencyMs: Math.round(((p.usage?.avgLatencyMs ?? 0) * (p.usage?.requests ?? 0) + l.latencyMs) / ((p.usage?.requests ?? 0) + 1)),
                cost: (p.usage?.cost ?? 0) + (l.inputTokens ?? 0) * (p.costPerInputToken ?? 0) + (l.outputTokens ?? 0) * (p.costPerOutputToken ?? 0),
              },
            }
          : p
      ),
    }));
  },

  clearProviderLogs: (providerId) =>
    set((s) => ({
      providerLogs: providerId ? s.providerLogs.filter((l) => l.providerId !== providerId) : [],
    })),

  updateProviderSettings: (patch) => {
    set((s) => ({ providerSettings: { ...s.providerSettings, ...patch } }));
    const settings = get().providerSettings;
    cloudApiSafe(updateBranding)({
      providerSettings: settings,
    }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem("resumeai-provider-settings", JSON.stringify(settings));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  addPrompt: (p) => {
    set((s) => ({ prompts: [...s.prompts, p] }));
    cloudApiSafe(createPrompt)(p).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  updatePrompt: (id, patch) => {
    set((s) => ({
      prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...patch, version: p.version + 1 } : p)),
    }));
    if (patch.isActive !== undefined) {
      try {
        const current = loadActiveOverrides(PROMPT_ACTIVE_KEY);
        current[id] = patch.isActive;
        saveActiveOverrides(PROMPT_ACTIVE_KEY, current);
      } catch {}
    }
    cloudApiSafe(cloudUpdatePrompt)(id, patch).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  removePrompt: (id) => {
    set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) }));
    cloudApiSafe(deletePrompt)(id).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  updateBranding: (patch) => {
    set((s) => ({ branding: { ...s.branding, ...patch } }));
    cloudApiSafe(updateBranding)({ ...get().branding, ...patch }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  updateFlag: (k, v) => {
    set((s) => ({ flags: { ...s.flags, [k]: v } }));
    cloudApiSafe(updateFlag)(k, v).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  updateOptimizerDirective: (patch) => {
    set((s) => ({ optimizerDirective: { ...s.optimizerDirective, ...patch } }));
    cloudApiSafe(cloudApi.updateBranding as any)({ optimizerDirective: { ...get().optimizerDirective, ...patch } }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Optimizer directive updated", category: "admin", details: Object.keys(patch).join(", "), severity: "info" });
  },

  resetOptimizerDirective: () => {
    set({ optimizerDirective: SEED_OPTIMIZER_DIRECTIVE });
    cloudApiSafe(cloudApi.updateBranding as any)({ optimizerDirective: SEED_OPTIMIZER_DIRECTIVE }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Optimizer directive reset to defaults", category: "admin", details: "All parameters restored to factory defaults", severity: "warning" });
  },

  updateFallbackChain: (patch) => {
    set((s) => ({ fallbackChain: { ...s.fallbackChain, ...patch } }));
    cloudApiSafe(cloudApi.updateBranding as any)({ fallbackChain: { ...get().fallbackChain, ...patch } }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Fallback chain updated", category: "admin", details: `${(patch.entries ?? []).length} entries, enabled=${patch.enabled ?? get().fallbackChain.enabled}`, severity: "info" });
  },

  resetFallbackChain: () => {
    set({ fallbackChain: SEED_FALLBACK_CHAIN });
    cloudApiSafe(cloudApi.updateBranding as any)({ fallbackChain: SEED_FALLBACK_CHAIN }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Fallback chain reset to defaults", category: "admin", details: "All fallback entries restored to factory defaults", severity: "warning" });
  },

  updatePipelineProfile: (id, patch) => {
    set((s) => ({
      pipelineProfiles: s.pipelineProfiles.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
      ),
    }));
    cloudApiSafe(cloudApi.updateBranding as any)({ pipelineProfiles: get().pipelineProfiles }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Pipeline profile updated", category: "admin", details: `Profile ${id}: ${Object.keys(patch).join(", ")}`, severity: "info" });
  },

  addPipelineProfile: (profile) => {
    set((s) => ({ pipelineProfiles: [...s.pipelineProfiles, profile] }));
    cloudApiSafe(cloudApi.updateBranding as any)({ pipelineProfiles: get().pipelineProfiles }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Pipeline profile added", category: "admin", details: `Profile: ${profile.name} (${profile.type})`, severity: "info" });
  },

  removePipelineProfile: (id) => {
    const profile = get().pipelineProfiles.find((p) => p.id === id);
    if (profile?.isBuiltIn) {
      console.warn("[store] Cannot remove built-in profile");
      return;
    }
    set((s) => ({ pipelineProfiles: s.pipelineProfiles.filter((p) => p.id !== id) }));
    cloudApiSafe(cloudApi.updateBranding as any)({ pipelineProfiles: get().pipelineProfiles }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Pipeline profile removed", category: "admin", details: `Profile: ${id}`, severity: "warning" });
  },

  selectPipelineProfile: (id) => {
    set({ selectedProfileId: id });
    cloudApiSafe(cloudApi.updateBranding as any)({ selectedProfileId: id }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const profile = get().pipelineProfiles.find((p) => p.id === id);
    get().log({ actor: get().user?.email ?? "admin", action: "Pipeline profile selected", category: "admin", details: `Selected: ${profile?.name || id}`, severity: "info" });
  },

  updateAgentConfig: (agentType, patch) => {
    set((s) => ({
      agentConfigs: s.agentConfigs.map((a) =>
        a.agentType === agentType ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a,
      ),
    }));
    cloudApiSafe(cloudApi.updateBranding as any)({ agentConfigs: get().agentConfigs }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Agent config updated", category: "admin", details: `Agent: ${agentType}, fields: ${Object.keys(patch).join(", ")}`, severity: "info" });
  },

  applyOptimalAgentDefaults: () => {
    const now = new Date().toISOString();
    set({ agentConfigs: SEED_AGENT_CONFIGS.map((a) => ({ ...a, createdAt: now, updatedAt: now })) });
    cloudApiSafe(cloudApi.updateBranding as any)({ agentConfigs: get().agentConfigs }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Optimal agent defaults applied", category: "admin", details: `${SEED_AGENT_CONFIGS.length} agent configs restored to tuned optimal values (Task 7)`, severity: "warning" });
  },

  updatePromptVersion: (id, patch) => {
    set((s) => ({
      promptVersions: s.promptVersions.map((p) =>
        p.id === id ? { ...p, ...patch, lastModified: new Date().toISOString() } : p,
      ),
    }));
    cloudApiSafe(cloudApi.updateBranding as any)({ promptVersions: get().promptVersions }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Prompt version updated", category: "admin", details: `Prompt: ${id}`, severity: "info" });
  },

  addPromptVersion: (prompt) => {
    set((s) => ({ promptVersions: [...s.promptVersions, prompt] }));
    cloudApiSafe(cloudApi.updateBranding as any)({ promptVersions: get().promptVersions }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Prompt version added", category: "admin", details: `Prompt: ${prompt.name} v${prompt.version}`, severity: "info" });
  },

  resetPipelineOrchestration: () => {
    set({
      pipelineProfiles: SEED_PIPELINE_PROFILES,
      selectedProfileId: SEED_PIPELINE_PROFILES.find((p) => p.isDefault)?.id || SEED_PIPELINE_PROFILES[0]?.id || "",
      agentConfigs: SEED_AGENT_CONFIGS,
      promptVersions: SEED_PROMPT_VERSIONS,
    });
    cloudApiSafe(cloudApi.updateBranding as any)({
      pipelineProfiles: SEED_PIPELINE_PROFILES,
      selectedProfileId: get().selectedProfileId,
      agentConfigs: SEED_AGENT_CONFIGS,
      promptVersions: SEED_PROMPT_VERSIONS,
    }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "Pipeline orchestration reset to defaults", category: "admin", details: "All profiles, agents, and prompts restored to factory defaults", severity: "warning" });
  },
});
