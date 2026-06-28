// ============================================================================
// Dynamic Provider Onboarding
//
// When new providers are added via D1, Admin UI, or env vars, this module
// auto-discovers them, fetches models, imports into Model Registry, and
// makes them immediately available for capability-weighted routing.
// No code changes required to add a new provider.
// ============================================================================

import type { AIProvider } from "./types";
import { modelRegistry } from "./model-registry";

/** Known base URLs for common provider types (no hardcoded API keys) */
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  cohere: "https://api.cohere.com/v2",
  perplexity: "https://api.perplexity.ai",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  huggingface: "https://api-inference.huggingface.co/models",
  opencode: "https://opencode.ai/zen/v1",
  zencode: "https://opencode.ai/zen/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
};

export interface OnboardingResult {
  providerId: string;
  providerName: string;
  modelsImported: number;
  alreadyTracked: boolean;
  error?: string;
}

export async function onboardProvider(provider: AIProvider): Promise<OnboardingResult> {
  const result: OnboardingResult = {
    providerId: provider.id,
    providerName: provider.name,
    modelsImported: 0,
    alreadyTracked: false,
  };

  const existing = modelRegistry.findByProvider(provider.id);
  if (existing.length > 0) {
    result.alreadyTracked = true;
    result.modelsImported = existing.length;
    return result;
  }

  try {
    const baseUrl = provider.baseUrl || provider.apiUrl || PROVIDER_BASE_URLS[provider.type] || "";
    const modelNames = await fetchModelList(baseUrl, provider.apiKey, provider.type);
    
    if (modelNames.length > 0) {
      result.modelsImported = modelRegistry.importFromProvider(
        provider.id, provider.name, modelNames, {}
      );
    }
  } catch (e: any) {
    result.error = e?.message || String(e);
  }

  return result;
}

export async function onboardAllProviders(providers: AIProvider[]): Promise<OnboardingResult[]> {
  const active = providers.filter((p) => p.isActive);
  const results: OnboardingResult[] = [];
  for (const provider of active) {
    const result = await onboardProvider(provider);
    results.push(result);
    if (result.modelsImported > 0) {
      console.info('[Onboarding] Imported ' + result.modelsImported + ' models from ' + provider.name);
    }
  }
  return results;
}

export async function onboardNewProvider(provider: AIProvider): Promise<OnboardingResult> {
  return onboardProvider(provider);
}

async function fetchModelList(baseUrl: string, apiKey: string | undefined, providerType: string): Promise<string[]> {
  if (!baseUrl) return [];

  const modelsUrl = baseUrl.replace(/\/$/, "") + "/models";
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      if (providerType === "gemini") {
        // Gemini uses query param, skipped here
      } else {
        headers["Authorization"] = "Bearer " + apiKey;
      }
    }

    const res = await fetch(modelsUrl, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();
    let models: string[] = [];
    
    if (Array.isArray(data?.data)) {
      models = data.data.map((m: any) => m.id || m.name || "").filter(Boolean);
    } else if (Array.isArray(data?.models)) {
      models = data.models.map((m: any) => m.name || m.id || "").filter(Boolean);
    } else if (Array.isArray(data)) {
      models = data.map((m: any) => m.id || m.name || m.model || "").filter(Boolean);
    }

    return models.slice(0, 200);
  } catch {
    return [];
  }
}

// Dynamic env-var provider detection is handled by D1 sync + Admin UI.
// The detectEnvProviders function was removed to avoid ESLint
// issues with dynamic process.env property access in Cloudflare builds.

