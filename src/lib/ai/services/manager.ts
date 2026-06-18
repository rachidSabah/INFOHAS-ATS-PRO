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

  static async testConnection(providerOrId: string | AIProvider) {
    // Accept either a provider ID string or a full AIProvider object
    const provider = typeof providerOrId === "string" ? this.get(providerOrId) : providerOrId;
    if (!provider) return { ok: false, latencyMs: 0, message: "Provider not found" };

    // Route through the CORS proxy — browser can't call provider APIs directly
    const baseUrl = provider.baseUrl || provider.apiUrl || "";
    if (!baseUrl || baseUrl === "internal") {
      // Z.ai fallback or Puter.js — use the direct adapter
      return ProviderRouter.testConnection(provider);
    }

    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          apiKey: provider.apiKey,
          authType: provider.authType || "bearer",
          headersJson: provider.headersJson,
          model: provider.modelName,
          testPrompt: "Reply with exactly: OK",
          timeout: Math.min(provider.timeout || 30000, 15000),
        }),
      });
      const data = await res.json();

      // Log the test
      useApp.getState().addProviderLog({
        id: uid("pl"),
        createdAt: new Date().toISOString(),
        providerId: provider.id,
        providerName: provider.name,
        requestType: "test",
        modelName: provider.modelName,
        status: data.ok ? "success" : "error",
        latencyMs: data.latencyMs || 0,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        errorMessage: data.ok ? undefined : data.message,
        responsePreview: data.response?.slice(0, 200),
        requestPreview: "Test prompt: 'Reply with exactly: OK'",
      });

      return data;
    } catch (e: any) {
      return { ok: false, latencyMs: 0, message: e?.message || "Connection failed" };
    }
  }

  /**
   * Fetch the list of available models from a provider's API.
   * Routes through /api/providers/models to avoid CORS issues.
   */
  static async fetchModels(provider: AIProvider): Promise<{ ok: boolean; models: string[]; error?: string }> {
    return this.fetchModelsForConfig(provider);
  }

  /**
   * Fetch models for a provider config (without needing a saved provider).
   * Used by the editor to preview models before saving.
   * Routes through /api/providers/models to avoid CORS issues.
   */
  static async fetchModelsForConfig(config: Partial<AIProvider>): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      // Use the CORS proxy route instead of calling the provider API directly
      const res = await fetch("/api/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          authType: config.authType,
          headersJson: config.headersJson,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { ok: false, models: [], error: err.error || `Failed to fetch models (${res.status})` };
      }

      const data = await res.json();
      if (data.models && data.models.length > 0) {
        return { ok: true, models: data.models };
      }
      return { ok: false, models: [], error: "No models returned from the API." };
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
