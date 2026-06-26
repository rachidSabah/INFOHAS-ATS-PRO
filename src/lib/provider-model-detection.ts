// ============================================================================
// Provider Model Detection
//
// Fetches all available models from a provider's API endpoint.
// Used by the AI Dev Agent to auto-detect models and configure fallback chains.
//
// Supports:
//   - OpenAI-compatible APIs (GET /v1/models)
//   - DeepSeek, OpenCode, ZenCode, OpenRouter, Groq, Together, Fireworks, etc.
//   - Custom OpenAI-compatible providers
//
// Falls back to the provider's configured enabledModels if the API is unreachable.
// ============================================================================

"use client";

import type { AIProvider } from "./types";

export interface DetectedModel {
  id: string;          // The model ID to use in API calls
  name?: string;       // Display name (if available)
  contextLength?: number;
  maxTokens?: number;
  supportsReasoning?: boolean;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsToolCalling?: boolean;
}

export interface ModelDetectionResult {
  models: DetectedModel[];
  source: "api" | "configured" | "fallback";
  error?: string;
}

/**
 * Fetch all available models from a provider's API.
 *
 * Tries the standard OpenAI-compatible endpoint: GET {baseUrl}/models
 * Falls back to the provider's configured enabledModels if the API is unreachable.
 */
export async function fetchProviderModels(provider: AIProvider): Promise<ModelDetectionResult> {
  if (!provider) {
    return { models: [], source: "fallback", error: "No provider provided" };
  }

  // Determine the base URL
  const baseUrl = (provider.baseUrl || provider.apiUrl || "").trim();
  if (!baseUrl) {
    return {
      models: getFallbackModels(provider),
      source: "configured",
      error: "No base URL configured — using enabledModels from provider config",
    };
  }

  const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("0.0.0.0") || baseUrl.includes("::1");

  try {
    let rawModels: any[] = [];

    if (isLocal) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (provider.apiKey) {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
      }
      if (provider.headersJson) {
        try {
          const custom = JSON.parse(provider.headersJson);
          Object.assign(headers, custom);
        } catch { /* ignore parse errors */ }
      }

      const modelsUrl = baseUrl.endsWith("/models") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/models`;
      const response = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      rawModels = data.data || data.models || data;
    } else {
      // Use proxy to avoid CORS issues
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (data && Array.isArray(data.models)) {
        rawModels = data.models.map((id: string) => ({ id, name: id }));
      } else {
        rawModels = data.data || data.models || data;
      }
    }

    if (!Array.isArray(rawModels)) {
      throw new Error("Unexpected response format — expected array or { data: [...] }");
    }

    const models: DetectedModel[] = rawModels
      .map((m: any): DetectedModel => {
        if (typeof m === "string") {
          return { id: m, name: m, supportsStreaming: true };
        }
        return {
          id: m.id || m.name || m.model,
          name: m.name || m.id,
          contextLength: m.context_length || m.maxContextLength || m.context_window,
          maxTokens: m.max_tokens || m.maxTokens,
          supportsReasoning: m.supports_reasoning ?? m.reasoning,
          supportsStreaming: m.supports_streaming ?? m.streaming ?? true,
          supportsVision: m.supports_vision ?? m.vision,
          supportsToolCalling: m.supports_tool_calling ?? m.tool_calling ?? m.function_calling,
        };
      })
      .filter((m: DetectedModel) => m.id);

    if (models.length === 0) {
      throw new Error("No models returned from API");
    }

    console.info(`[ModelDetection] Fetched ${models.length} models from ${provider.name} (${baseUrl})`);
    return { models, source: "api" };
  } catch (error: any) {
    console.warn(`[ModelDetection] Failed to fetch models from ${provider.name}: ${error?.message || error}`);
    return {
      models: getFallbackModels(provider),
      source: "configured",
      error: error?.message || String(error),
    };
  }
}

/**
 * Get fallback models from the provider's configured enabledModels.
 */
function getFallbackModels(provider: AIProvider): DetectedModel[] {
  const configured = provider.enabledModels || [];
  if (configured.length > 0) {
    return configured.map((id) => ({
      id,
      name: id,
      supportsStreaming: true,
    }));
  }
  // Ultimate fallback: the provider's default model
  if (provider.modelName) {
    return [{ id: provider.modelName, name: provider.modelName, supportsStreaming: true }];
  }
  return [];
}

/**
 * Build a fallback model chain from detected models.
 *
 * Given a primary model, returns an ordered list of OTHER detected models
 * to use as fallbacks (in case the primary model fails).
 *
 * @param detectedModels - All models detected from the provider's API
 * @param primaryModel - The primary model to exclude from fallbacks
 * @param maxFallbacks - Maximum number of fallback models (default: 5)
 */
export function buildFallbackModelChain(
  detectedModels: DetectedModel[],
  primaryModel: string,
  maxFallbacks: number = 5,
): DetectedModel[] {
  return detectedModels
    .filter((m) => m.id !== primaryModel)
    .slice(0, maxFallbacks);
}

/**
 * Check if a model supports a given capability.
 */
export function modelSupports(model: DetectedModel, capability: "reasoning" | "streaming" | "vision" | "tool-calling"): boolean {
  switch (capability) {
    case "reasoning": return model.supportsReasoning ?? false;
    case "streaming": return model.supportsStreaming ?? true;
    case "vision": return model.supportsVision ?? false;
    case "tool-calling": return model.supportsToolCalling ?? false;
    default: return false;
  }
}

/**
 * Filter models by capability.
 */
export function filterModelsByCapability(
  models: DetectedModel[],
  capability: "reasoning" | "streaming" | "vision" | "tool-calling",
): DetectedModel[] {
  return models.filter((m) => modelSupports(m, capability));
}

/**
 * Sort models by context length (largest first).
 */
export function sortModelsByContextLength(models: DetectedModel[]): DetectedModel[] {
  return [...models].sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0));
}

/**
 * Get a human-readable description of a detected model.
 */
export function describeModel(model: DetectedModel): string {
  const parts: string[] = [model.id];
  if (model.contextLength) parts.push(`${(model.contextLength / 1000).toFixed(0)}k ctx`);
  const caps: string[] = [];
  if (model.supportsReasoning) caps.push("reasoning");
  if (model.supportsVision) caps.push("vision");
  if (model.supportsToolCalling) caps.push("tools");
  if (caps.length > 0) parts.push(caps.join("+"));
  return parts.join(" · ");
}
