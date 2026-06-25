// ============================================================================
// Provider Model Discovery
//
// If a provider exposes GET /models, automatically fetch and sync models.
// Preserves enabled models and user configuration.
// ============================================================================

"use client";

import type { AIProvider } from "./types";
import { recordProviderFailure } from "./telemetry";

export interface ModelDiscoveryResult {
  providerId: string;
  providerName: string;
  models: string[];
  newModels: string[];
  success: boolean;
  error: string | null;
}

/**
 * Fetch available models from a provider's /models endpoint.
 * Returns the list of model names, or null if the endpoint is unavailable.
 */
export async function discoverModels(provider: AIProvider): Promise<string[] | null> {
  const baseUrl = (provider.apiUrl || provider.baseUrl || "").trim();
  if (!baseUrl) return null;

  // Only attempt discovery for providers that support it
  // (Puter uses browser SDK, not REST API)
  if (provider.providerCategory === "browser_auth") return null;

  try {
    const modelsUrl = baseUrl.endsWith("/models")
      ? baseUrl
      : `${baseUrl.replace(/\/$/, "")}/models`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.apiKey) {
      const isGemini = baseUrl.includes("generativelanguage.googleapis.com");
      if (isGemini && !baseUrl.includes("/openai/")) {
        // Gemini native: key as query param
      } else {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
      }
    }

    // Use the server-side proxy to avoid CORS
    const response = await fetch("/api/providers/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl,
        apiKey: provider.apiKey,
        authType: provider.authType || "bearer",
        headersJson: provider.headersJson,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data.models || !Array.isArray(data.models)) {
      return null;
    }

    return data.models;
  } catch (e: any) {
    // Non-fatal — not all providers support /models
    return null;
  }
}

/**
 * Sync discovered models for a single provider.
 * Preserves the provider's currently enabled models — only ADDS new ones.
 * Never removes user-configured models.
 */
export async function syncModelsForProvider(provider: AIProvider): Promise<ModelDiscoveryResult> {
  const result: ModelDiscoveryResult = {
    providerId: provider.id,
    providerName: provider.name,
    models: [],
    newModels: [],
    success: false,
    error: null,
  };

  try {
    const discovered = await discoverModels(provider);

    if (!discovered || discovered.length === 0) {
      result.success = true; // No models endpoint — not an error
      result.error = "No models endpoint available";
      return result;
    }

    result.models = discovered;

    // Find new models not already in enabledModels
    const existingModels = new Set(provider.enabledModels || []);
    result.newModels = discovered.filter((m) => !existingModels.has(m));

    if (result.newModels.length > 0) {
      console.info(
        `[Model Discovery] ${provider.name}: found ${discovered.length} models, ` +
        `${result.newModels.length} new — ${result.newModels.slice(0, 5).join(", ")}...`
      );
    }

    result.success = true;
  } catch (e: any) {
    result.error = e?.message ?? "Unknown error";
    recordProviderFailure({
      providerName: provider.name,
      errorType: "unknown",
      errorMessage: `Model discovery failed: ${result.error}`,
    });
  }

  return result;
}

/**
 * Sync models for ALL active providers.
 * Returns results for each provider.
 */
export async function syncAllProviderModels(providers: AIProvider[]): Promise<ModelDiscoveryResult[]> {
  const activeProviders = providers.filter(
    (p) => p.isActive && p.providerCategory !== "browser_auth" && p.apiKey,
  );

  const results = await Promise.allSettled(
    activeProviders.map((p) => syncModelsForProvider(p)),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      providerId: activeProviders[i].id,
      providerName: activeProviders[i].name,
      models: [],
      newModels: [],
      success: false,
      error: r.reason?.message ?? "Unknown error",
    };
  });
}

/**
 * Get the total count of new models discovered across all providers.
 */
export function countNewModels(results: ModelDiscoveryResult[]): number {
  return results.reduce((sum, r) => sum + r.newModels.length, 0);
}
