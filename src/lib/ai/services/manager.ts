// ProviderManager — high-level helpers for the AI Providers UI module.
// Wraps the store + router for common operations: add, edit, delete, duplicate,
// set default, toggle fallback, test connection, get usage stats, get logs.
"use client";

import { useApp, uid } from "../../store";
import { ProviderRouter } from "./router";
import { ProviderFactory } from "./factory";
import { toProviderConfig } from "./fallback";
import type { AIProvider, AIProviderLog, AIProviderSettings } from "../../types";

export class ProviderManager {
  static list(): AIProvider[] {
    return useApp.getState().providers;
  }

  static get(id: string): AIProvider | undefined {
    return useApp.getState().providers.find((p) => p.id === id);
  }

  static add(provider: Omit<AIProvider, "id" | "usage" | "status">): string {
    const id = uid("p");
    const full: AIProvider = {
      ...provider,
      id,
      status: "untested",
      usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
    };
    useApp.getState().addProvider(full);
    useApp.getState().log({
      actor: "you",
      action: "AI provider added",
      category: "admin",
      details: `${full.name} (${full.type})`,
      severity: "info",
    });
    return id;
  }

  static update(id: string, patch: Partial<AIProvider>) {
    useApp.getState().updateProvider(id, patch);
  }

  static remove(id: string) {
    const p = this.get(id);
    useApp.getState().removeProvider(id);
    useApp.getState().log({
      actor: "you",
      action: "AI provider removed",
      category: "admin",
      details: p?.name ?? id,
      severity: "warning",
    });
  }

  static duplicate(id: string): string | null {
    const newId = useApp.getState().duplicateProvider(id);
    if (newId) {
      useApp.getState().log({
        actor: "you",
        action: "AI provider duplicated",
        category: "admin",
        details: `${this.get(id)?.name} → ${this.get(newId)?.name}`,
        severity: "info",
      });
    }
    return newId;
  }

  static setDefault(id: string) {
    useApp.getState().setDefaultProvider(id);
    useApp.getState().log({
      actor: "you",
      action: "Default AI provider set",
      category: "admin",
      details: this.get(id)?.name ?? id,
      severity: "info",
    });
  }

  static toggleFallback(id: string) {
    useApp.getState().toggleFallback(id);
  }

  static reorderFallback(id: string, direction: "up" | "down") {
    useApp.getState().reorderFallback(id, direction);
  }

  static async testConnection(id: string) {
    const provider = this.get(id);
    if (!provider) return { ok: false, latencyMs: 0, message: "Provider not found" };
    return ProviderRouter.testConnection(provider);
  }

  /**
   * Fetch the list of available models from a provider's API.
   * Uses the adapter's listModels() method — calls GET /v1/models (or equivalent).
   * Returns a list of model ID strings.
   */
  static async fetchModels(provider: AIProvider): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const adapter = ProviderFactory.get(provider.type);
      if (!adapter.listModels) {
        return { ok: false, models: [], error: `Provider type "${provider.type}" does not support dynamic model listing.` };
      }
      const config = toProviderConfig(provider);
      const models = await adapter.listModels(config);
      return { ok: true, models };
    } catch (e: any) {
      return { ok: false, models: [], error: e?.message || "Failed to fetch models" };
    }
  }

  /**
   * Fetch models for a provider config (without needing a saved provider).
   * Used by the editor to preview models before saving.
   */
  static async fetchModelsForConfig(config: Partial<AIProvider>): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const adapter = ProviderFactory.get(config.type || "custom");
      if (!adapter.listModels) {
        return { ok: false, models: [], error: `Provider type "${config.type}" does not support dynamic model listing.` };
      }
      const fullConfig = toProviderConfig({
        id: "preview",
        name: "preview",
        type: config.type || "custom",
        baseUrl: config.baseUrl,
        apiUrl: config.baseUrl,
        apiKey: config.apiKey,
        headersJson: config.headersJson,
        authType: config.authType,
        timeout: config.timeout ?? 10000,
        maxTokens: 4096,
        temperature: 0.7,
        priority: 99,
        isActive: true,
        status: "untested",
        usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
      } as AIProvider);
      const models = await adapter.listModels(fullConfig);
      return { ok: true, models };
    } catch (e: any) {
      return { ok: false, models: [], error: e?.message || "Failed to fetch models" };
    }
  }

  static logs(providerId?: string): AIProviderLog[] {
    const logs = useApp.getState().providerLogs;
    return providerId ? logs.filter((l) => l.providerId === providerId) : logs;
  }

  static clearLogs(providerId?: string) {
    useApp.getState().clearProviderLogs(providerId);
  }

  static settings(): AIProviderSettings {
    return useApp.getState().providerSettings;
  }

  static updateSettings(patch: Partial<AIProviderSettings>) {
    useApp.getState().updateProviderSettings(patch);
    useApp.getState().log({
      actor: "you",
      action: "AI provider settings updated",
      category: "admin",
      details: Object.keys(patch).join(", "),
      severity: "info",
    });
  }

  /** Aggregate usage stats across all providers — for the analytics dashboard. */
  static aggregateUsage() {
    const providers = this.list();
    const total = providers.reduce(
      (acc, p) => ({
        requests: acc.requests + p.usage.requests,
        tokens: acc.tokens + p.usage.tokens,
        errors: acc.errors + p.usage.errors,
        cost: acc.cost + p.usage.cost,
        avgLatencySum: acc.avgLatencySum + p.usage.avgLatencyMs * p.usage.requests,
      }),
      { requests: 0, tokens: 0, errors: 0, cost: 0, avgLatencySum: 0 }
    );
    return {
      ...total,
      successRate: total.requests > 0 ? ((total.requests - total.errors) / total.requests) * 100 : 0,
      errorRate: total.requests > 0 ? (total.errors / total.requests) * 100 : 0,
      avgLatencyMs: total.requests > 0 ? Math.round(total.avgLatencySum / total.requests) : 0,
    };
  }
}
