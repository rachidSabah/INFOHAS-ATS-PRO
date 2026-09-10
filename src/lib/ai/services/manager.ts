// ProviderManager — high-level helpers for the AI Providers UI module.
// Wraps the store + router for common operations: add, edit, delete, duplicate,
// set default, toggle fallback, test connection, get usage stats, get logs.
"use client";

import { useApp, uid } from "../../store";
import { resolveTestTimeoutMs } from "../test-timeout";
import { zenEgressBaseUrl } from "../zen-egress";
import { ProviderRouter } from "./router";
import { ProviderFactory } from "./factory";
import { toProviderConfig } from "./fallback";
import type { AIProvider, AIProviderLog, AIProviderSettings } from "../../types";
// Puter curated ids — SINGLE SOURCE OF TRUTH (src/lib/puter-models.ts).
// Pure module, import-safe outside the browser.
import { PUTER_CURATED_MODEL_IDS } from "../../puter-models";
// Direct client IP probe policy — gates the browser-direct fallback fetch
// (Task 17): never for demoted providers, and never twice for a host whose
// upstream sends no CORS headers (every failed preflight is logged by the
// browser itself and cannot be suppressed from JS).
import {
  shouldAttemptDirectProbe,
  extractProbeHost,
  safeLocalStorage,
  loadBlockedProbeHosts,
  rememberBlockedProbeHost,
  clearBlockedProbeHost,
} from "./direct-probe-policy";

// ============================================================================
// PUTER LIVE MODEL CATALOG (prefetch fix)
// ============================================================================

const PUTER_CATALOG_TTL_MS = 5 * 60 * 1000;
const PuterCatalogCache: { data: string[] | null; at: number } = { data: null, at: 0 };

/**
 * Normalize a live Puter catalog id into the id form the puter.js chat SDK
 * accepts:
 *   "openai:openai/gpt-4o"                      → "gpt-4o"        (first-party)
 *   "anthropic:anthropic/claude-sonnet-4-5"     → "claude-sonnet-4-5"
 *   "openrouter:meta-llama/llama-3.3-70b-..."   → "meta-llama/llama-3.3-70b-..."
 *   "infron:deepseek/deepseek-chat"             → "deepseek/deepseek-chat"
 * Vendor-prefix-only ids ("gpt-5-nano") pass through unchanged.
 */
export function normalizePuterModelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let id = raw.trim();
  if (!id) return null;
  const colonIdx = id.indexOf(":");
  if (colonIdx > 0) {
    const vendor = id.slice(0, colonIdx);
    if (/^[a-z0-9][a-z0-9-]*$/i.test(vendor)) {
      const rest = id.slice(colonIdx + 1);
      const slashIdx = rest.indexOf("/");
      const org = slashIdx > 0 ? rest.slice(0, slashIdx) : "";
      const same = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (org && same(org) === same(vendor)) {
        id = rest.slice(slashIdx + 1); // first-party org — collapse to plain id
      } else {
        id = rest;
      }
    }
  }
  return id || null;
}

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

    // Puter.js uses window.puter.ai.chat() — can only be tested client-side
    if (provider.type === "puter") {
      if (typeof window !== "undefined" && window.puter?.ai?.chat) {
        try {
          const t0 = performance.now();
          const resp = await window.puter.ai.chat(
            [{ role: "user", content: "Reply with exactly: OK" }],
            { model: provider.modelName || "gpt-4o-mini", max_tokens: 10 }
          );
          const latencyMs = Math.round(performance.now() - t0);
          const text = typeof resp === "string" ? resp : (resp?.message?.content ?? resp?.text ?? "OK");
          useApp.getState().addProviderLog({
            id: uid("pl"), createdAt: new Date().toISOString(),
            providerId: provider.id, providerName: provider.name,
            requestType: "test", modelName: provider.modelName,
            status: "success", latencyMs, responsePreview: String(text).slice(0, 200),
            requestPreview: "Test prompt: 'Reply with exactly: OK'",
          });
          return { ok: true, latencyMs, message: `OK — ${provider.modelName}`, response: String(text) };
        } catch (e: any) {
          return { ok: false, latencyMs: 0, message: `Puter.js test failed: ${e?.message || "Unknown error"}. Make sure you're signed in to Puter.` };
        }
      } else {
        return { ok: false, latencyMs: 0, message: "Puter.js is not loaded. Please refresh the page and try again." };
      }
    }

    // Z.ai fallback — use the internal adapter
    if (!provider.baseUrl || provider.baseUrl === "internal") {
      return ProviderRouter.testConnection(provider);
    }

    // All other providers — route through the CORS proxy
    try {
      // Wall-clock for the proxy round-trip — reported even when the proxy
      // answer is unparseable (the old fallback omitted latencyMs, so the
      // Test Connection modal printed "Received response in undefinedms").
      const proxyT0 = performance.now();
      // Zen relay routing (flag zenRelayEnabled) — canonical opencode.ai URLs
      // egress through the managed Vercel relay; every other host unchanged.
      const egressBase = (await zenEgressBaseUrl(provider.baseUrl)) ?? provider.baseUrl;
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: egressBase,
          apiKey: provider.apiKey,
          authType: provider.authType || "bearer",
          headersJson: provider.headersJson,
          model: provider.modelName,
          testPrompt: "Reply with exactly: OK",
          // Task 24① — reasoning-aware: a reasoning-route default model
          // (e.g. nemotron-3-ultra-free, answers in 8-33s) gets the provider's
          // generous timeout instead of the 15s cap that declared
          // verified-working providers "down".
          timeout: resolveTestTimeoutMs({ modelName: provider.modelName, providerTimeoutMs: provider.timeout }),
        }),
      });

      // Safely parse response
      const responseText = await res.text();
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        // The proxy returned HTML (likely a platform error page — e.g. Vercel
        // FUNCTION_INVOCATION_TIMEOUT when a serverless function was killed)
        // Include the HTTP status code and first chars of the response for debugging
        const preview = responseText.slice(0, 100).replace(/\n/g, " ").trim();
        const platformKill = /FUNCTION_INVOCATION_TIMEOUT|FUNCTION_INVOCATION_FAILED/i.test(responseText);
        data = {
          ok: false,
          latencyMs: Math.round(performance.now() - proxyT0),
          message: platformKill
            ? `The server-side proxy function was killed by the hosting platform (HTTP ${res.status}). ${preview.includes("FUNCTION_INVOCATION_TIMEOUT") ? "The upstream model needed longer than the function's execution-time cap (Vercel Edge kills at ~30s and ignores maxDuration — deploy the latest main, which routes through Node-runtime functions with maxDuration 90-150s)." : "The deployment's function crashed or was recycled."} Response: "${preview}"`
            : `Proxy returned a non-JSON response (HTTP ${res.status}). ${res.status === 500 ? "The API route may be misconfigured on the deployment. Try refreshing the page or redeploying." : ""} Response: "${preview}"`,
        };
      }

      // If server proxy returned 429 rate limit and we are in a browser,
      // try direct client-side probe (which uses user's residential IP rather than Cloudflare's flagged server IP)
      // Task 17 — the probe is gated by DirectProbePolicy: skipped entirely
      // for demoted (isActive = false) providers, and skipped for hosts whose
      // direct probe already failed with a CORS/network error (remembered in
      // localStorage, TTL 24h) so the browser's own CORS console noise fires
      // at most once per host per window.
      if (data?.rateLimited && typeof window !== "undefined" && provider.baseUrl && !provider.baseUrl.includes("localhost")) {
        const probeStorage = safeLocalStorage();
        const probeAllowed = shouldAttemptDirectProbe({
          rateLimited: true,
          providerIsActive: (provider as AIProvider).isActive !== false,
          baseUrl: provider.baseUrl,
          isBrowser: true,
          blockedHosts: loadBlockedProbeHosts(probeStorage),
        });
        if (probeAllowed) {
          const probeHost = extractProbeHost(provider.baseUrl);
          try {
            const directStartTime = performance.now();
            const directUrl = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
            const directHeaders: Record<string, string> = { "Content-Type": "application/json" };
            if (provider.apiKey) directHeaders["Authorization"] = `Bearer ${provider.apiKey}`;
            const directRes = await fetch(directUrl, {
              method: "POST",
              headers: directHeaders,
              body: JSON.stringify({
                model: provider.modelName,
                messages: [{ role: "user", content: "Reply with exactly: OK" }],
                max_tokens: 10,
              }),
              signal: AbortSignal.timeout(
                // Task 24① — reasoning-aware direct probe (was fixed 10s).
                resolveTestTimeoutMs({ modelName: provider.modelName, providerTimeoutMs: provider.timeout, fastCapMs: 10000 })
              ),
            });
            if (directRes.ok) {
              // Probe succeeded — the host speaks CORS; forget past failures.
              clearBlockedProbeHost(probeStorage, probeHost || "");
              const directJson = (await directRes.json()) as any;
              const text = directJson?.choices?.[0]?.message?.content || "OK";
              data = {
                ok: true,
                latencyMs: Math.round(performance.now() - directStartTime),
                message: `OK (via Direct Client IP) — ${provider.modelName}`,
                response: text,
                rateLimited: false,
              };
            }
          } catch {
            // Direct fetch failed (CORS or network) — remember the host so the
            // browser's unavoidable CORS console error happens at most once per
            // TTL window, and preserve the proxy's diagnostic response.
            rememberBlockedProbeHost(probeStorage, probeHost || "");
          }
        }
      }

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
   * Puter: LIVE catalog from api.puter.com/puterai/chat/models (public,
   * keyless, SSRF-allow-listed) — previously a stale 8-id static list that
   * hid ~900 available models from the UI prefetch.
   */
  static async fetchModels(provider: AIProvider): Promise<{ ok: boolean; models: string[]; error?: string }> {
    // === PUTER: live catalog, curated-first, static fallback ===
    if (provider.type === "puter") {
      return this.fetchPuterModelsLive();
    }

    // NOTE: the NON-REST integration branches (Antigravity CLI + Z.ai Web,
    // Task 29b/30) were removed along with those integrations. Fetch-models
    // now always goes through the generic REST {baseUrl}/models proxy path.
    return this.fetchModelsForConfig(provider);
  }

  /**
   * Puter LIVE model catalog. Normalizes the catalog's vendor-prefixed ids
   * ("anthropic:anthropic/claude-sonnet-4-5" → "claude-sonnet-4-5"), ranks the
   * doc-verified curated ids first, and falls back to the curated list when
   * the live endpoint is unreachable. Results are cached in-memory for 5 min.
   */
  static async fetchPuterModelsLive(): Promise<{ ok: boolean; models: string[]; error?: string }> {
    if (PuterCatalogCache.data && Date.now() - PuterCatalogCache.at < PUTER_CATALOG_TTL_MS) {
      return { ok: true, models: PuterCatalogCache.data };
    }
    let live: string[] | null = null;
    try {
      // The models proxy appends "/models" → api.puter.com/puterai/chat/models.
      const res = await fetch("/api/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: "https://api.puter.com/puterai/chat" }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        const normalized = new Set<string>();
        for (const raw of (Array.isArray(data?.models) ? data.models : []) as unknown[]) {
          const id = normalizePuterModelId(raw);
          if (id) normalized.add(id);
        }
        if (normalized.size > 0) live = Array.from(normalized);
      }
    } catch {
      live = null; // offline / proxy down — curated fallback below
    }

    const rest = (live ?? []).filter((id) => !PUTER_CURATED_MODEL_IDS.includes(id))
      .sort((a, b) => a.localeCompare(b));
    const models = [...PUTER_CURATED_MODEL_IDS, ...rest];
    PuterCatalogCache.data = models;
    PuterCatalogCache.at = Date.now();
    return { ok: true, models };
  }

  /**
   * Fetch models for a provider config (without needing a saved provider).
   * Used by the editor to preview models before saving.
   * Routes through /api/providers/models to avoid CORS issues.
   */
  static async fetchModelsForConfig(config: Partial<AIProvider>): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      if (config.type === "puter") {
        return this.fetchPuterModelsLive();
      }

      // 1. Try primary key first (Zen relay routing applies via egressBase)
      const egressBase = (await zenEgressBaseUrl(config.baseUrl)) ?? config.baseUrl;
      const res = await fetch("/api/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: egressBase,
          apiKey: config.apiKey,
          authType: config.authType,
          headersJson: config.headersJson,
        }),
      });

      let errMessage = "";
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.models && data.models.length > 0) {
          return { ok: true, models: data.models };
        }
      } else {
        const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as any;
        errMessage = err.error || `Failed to fetch models (${res.status})`;
      }

      // 2. Try alternate keys if primary failed
      const alternateKeys = config.alternateApiKeys;
      if (alternateKeys && alternateKeys.length > 0) {
        console.log(`[ProviderManager] Primary API key failed for prefetch. Trying ${alternateKeys.length} alternate keys...`);
        for (let i = 0; i < alternateKeys.length; i++) {
          const altKey = alternateKeys[i];
          if (!altKey || altKey.trim() === "") continue;
          try {
            const altRes = await fetch("/api/providers/models", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                baseUrl: egressBase,
                apiKey: altKey,
                authType: config.authType,
                headersJson: config.headersJson,
              }),
            });
            if (altRes.ok) {
              const data = (await altRes.json()) as any;
              if (data.models && data.models.length > 0) {
                console.log(`[ProviderManager] Alternate API key #${i + 1} succeeded for prefetch.`);
                return { ok: true, models: data.models };
              }
            }
          } catch (altErr) {
            // continue
          }
        }
      }

      return { ok: false, models: [], error: errMessage || "No models returned from the API." };
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
