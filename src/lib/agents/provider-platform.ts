// ============================================================================
// Provider Platform — cross-provider routing and execution layer.
//
// Provides a clean interface for pipeline agents to make AI calls with:
//   - Provider priority routing (primary → fallback chain)
//   - Circuit-breaker integration (skip unhealthy providers)
//   - Task-category-based provider filtering
//   - Execution metrics per provider
//
// Wraps callAI() — the existing provider dispatch layer. This module adds
// the routing rules, circuit-breaker awareness, and provider selection
// that pipeline agents need.
// ============================================================================

import { callAI, type AICallOptions, type AICallResult } from "../ai";
import { isProviderAvailable } from "../circuit-breaker";
import { useApp } from "../store";
import type { AIProvider } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderRoute {
  providerId: string;
  modelName: string;
  isFallback: boolean;
}

export interface RoutedCallResult extends AICallResult {
  /** The provider that was actually used */
  usedProvider: ProviderRoute;
  /** All providers that were tried (in order) */
  attemptedRoutes: ProviderRoute[];
}

export interface ProviderPlatformConfig {
  /** Priority-ordered list of provider IDs to attempt */
  priorityOrder?: string[];
  /** Task category for provider filtering */
  taskCategory?: AICallOptions["taskCategory"];
  /** Circuit breaker: skip unhealthy providers */
  useCircuitBreaker?: boolean;
  /** Per-call timeout in ms */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Provider Selection
// ---------------------------------------------------------------------------

/**
 * Build a priority-ordered list of provider routes.
 *
 * Priority:
 *   1. User's default provider
 *   2. Configured fallback providers (in order)
 *   3. Any other available providers
 *
 * Respects circuit breaker state when useCircuitBreaker=true.
 */
export function buildProviderRoutes(
  config?: ProviderPlatformConfig,
): ProviderRoute[] {
  const appState = useApp.getState();
  const settings = appState?.providerSettings;
  const providers: AIProvider[] = appState?.providers ?? [];
  const priorityOrder = config?.priorityOrder;
  const useCircuitBreaker = config?.useCircuitBreaker ?? true;

  const routes: ProviderRoute[] = [];

  // Helper: add a provider if available (respecting circuit breaker)
  const tryAdd = (providerId: string, isFallback: boolean) => {
    if (useCircuitBreaker && !isProviderAvailable(providerId)) return;
    if (routes.some((r) => r.providerId === providerId)) return; // dedupe

    const prov = providers.find((p) => p.id === providerId);
    if (!prov) return;

    routes.push({
      providerId: prov.id,
      modelName: prov.modelName ?? "",
      isFallback,
    });
  };

  // 1. Explicit priority order
  if (priorityOrder && priorityOrder.length > 0) {
    for (const pid of priorityOrder) tryAdd(pid, false);
    if (routes.length > 0) return routes;
  }

  // 2. User's default provider
  const defaultId = settings?.defaultProviderId;
  if (defaultId) tryAdd(defaultId, false);

  // 3. Fallback providers
  const fallbackIds: string[] = settings?.fallbackProviderIds ?? [];
  for (const fid of fallbackIds) tryAdd(fid, true);

  // 4. All other providers (as last resort fallbacks)
  for (const p of providers) {
    if (!routes.some((r) => r.providerId === p.id)) {
      tryAdd(p.id, true);
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Provider Call
// ---------------------------------------------------------------------------

/**
 * Make an AI call through the provider platform.
 *
 * Tries providers in priority order, falling back on failure.
 * Respects circuit breaker state and task category.
 *
 * @returns RoutedCallResult with the successful call and attempted routes
 * @throws If all providers fail
 */
export async function callWithRouting(
  prompt: { systemPrompt?: string; userPrompt: string },
  opts?: {
    maxTokens?: number;
    temperature?: number;
    /** Override the provider priority order */
    priorityOrder?: string[];
    /** Task category for provider filtering (defaults to "document") */
    taskCategory?: AICallOptions["taskCategory"];
    /** Skip circuit-breaker check */
    skipCircuitBreaker?: boolean;
    /** Per-call timeout */
    timeoutMs?: number;
    /** If true, this is the optimizer call (validates directive integrity) */
    isOptimizerCall?: boolean;
  },
): Promise<RoutedCallResult> {
  const routes = buildProviderRoutes({
    priorityOrder: opts?.priorityOrder,
    taskCategory: opts?.taskCategory ?? "document",
    useCircuitBreaker: !opts?.skipCircuitBreaker,
    timeoutMs: opts?.timeoutMs,
  });

  if (routes.length === 0) {
    throw new Error("No providers available");
  }

  const attemptedRoutes: ProviderRoute[] = [];
  let lastError: Error | undefined;

  for (const route of routes) {
    attemptedRoutes.push(route);

    try {
      const result = await callAI({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        maxTokens: opts?.maxTokens,
        temperature: opts?.temperature,
        taskCategory: opts?.taskCategory ?? "document",
        timeoutMs: opts?.timeoutMs,
        isOptimizerCall: opts?.isOptimizerCall,
      });

      return {
        ...result,
        usedProvider: route,
        attemptedRoutes,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Continue to next provider
    }
  }

  throw lastError ?? new Error("All providers failed");
}

/**
 * Make an AI call through the preferred/default provider (no fallback).
 * Useful for non-critical calls where failure is acceptable.
 */
export async function callDefaultProvider(
  prompt: { systemPrompt?: string; userPrompt: string },
  opts?: {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    taskCategory?: AICallOptions["taskCategory"];
    isOptimizerCall?: boolean;
  },
): Promise<RoutedCallResult> {
  const routes = buildProviderRoutes({ useCircuitBreaker: true });
  const primary = routes[0];

  if (!primary) {
    throw new Error("No provider available");
  }

  const result = await callAI({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    maxTokens: opts?.maxTokens,
    temperature: opts?.temperature,
    taskCategory: opts?.taskCategory ?? "document",
    timeoutMs: opts?.timeoutMs,
    isOptimizerCall: opts?.isOptimizerCall,
  });

  return {
    ...result,
    usedProvider: primary,
    attemptedRoutes: [primary],
  };
}
