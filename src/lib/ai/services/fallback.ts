// FallbackManager — decides which provider to try next when one fails.
// Considers: retry policy, rate limits, current health, fallback chain order.
import type { AIProvider, AIProviderSettings, AIProviderLog } from "../../types";
import type { ProviderConfig } from "../providers/interface";

export interface RoutingDecision {
  provider: AIProvider;
  config: ProviderConfig;
  isRetry: boolean;
  attempt: number;
  reason: string;
}

export class FallbackManager {
  /**
   * Build the ordered list of providers to try for a given request.
   * Order: default → fallbacks (in saved order) → any other active provider by priority.
   */
  static buildChain(
    providers: AIProvider[],
    settings: AIProviderSettings
  ): AIProvider[] {
    const active = providers.filter((p) => p.isActive);
    const chain: AIProvider[] = [];
    const seen = new Set<string>();

    // 1. Default provider first
    if (settings.defaultProviderId) {
      const def = active.find((p) => p.id === settings.defaultProviderId);
      if (def) {
        chain.push(def);
        seen.add(def.id);
      }
    }

    // 2. Fallbacks in order
    for (const fid of settings.fallbackProviderIds) {
      const f = active.find((p) => p.id === fid);
      if (f && !seen.has(f.id)) {
        chain.push(f);
        seen.add(f.id);
      }
    }

    // 3. Other active providers by priority (excluding "down")
    for (const p of active.sort((a, b) => a.priority - b.priority)) {
      if (!seen.has(p.id) && p.status !== "down") {
        chain.push(p);
        seen.add(p.id);
      }
    }

    return chain;
  }

  /**
   * Decide whether to retry on the current provider or move to the next one.
   */
  static shouldRetry(
    error: any,
    attempt: number,
    settings: AIProviderSettings
  ): { retry: boolean; reason: string } {
    const maxAttempts = settings.retryAttempts ?? 2;
    if (attempt >= maxAttempts) {
      return { retry: false, reason: "Max retry attempts reached" };
    }
    // 429 rate-limited → don't retry on same provider, move to next
    if (error?.statusCode === 429) {
      return { retry: false, reason: "Rate limited — moving to next provider" };
    }
    // 5xx → retry with backoff
    if (error?.statusCode >= 500) {
      return { retry: true, reason: `Server error ${error.statusCode} — retrying` };
    }
    // Network / timeout → retry
    if (error?.name === "AbortError" || /timeout|network|fetch/i.test(error?.message ?? "")) {
      return { retry: true, reason: "Network/timeout — retrying" };
    }
    // Other → don't retry, move to next
    return { retry: false, reason: error?.message ?? "Provider error" };
  }

  /**
   * Exponential backoff delay.
   */
  static backoffDelay(attempt: number): number {
    return Math.min(8000, 500 * Math.pow(2, attempt));
  }
}

/**
 * Convert an AIProvider (store shape) to a ProviderConfig (adapter shape).
 */
export function toProviderConfig(p: AIProvider): ProviderConfig {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    baseUrl: p.baseUrl || p.apiUrl,
    apiKey: p.apiKey,
    modelName: p.modelName,
    headersJson: p.headersJson,
    parametersJson: p.parametersJson,
    requestTemplate: p.requestTemplate,
    responsePath: p.responsePath,
    streamingEnabled: p.streamingEnabled,
    timeout: p.timeout,
    maxTokens: p.maxTokens,
    temperature: p.temperature,
    retryAttempts: p.retryAttempts,
    rateLimitPerMinute: p.rateLimitPerMinute,
    authType: p.authType,
    costPerInputToken: p.costPerInputToken,
    costPerOutputToken: p.costPerOutputToken,
    applicationId: p.applicationId,
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    enabledModels: p.enabledModels,
  };
}
