// ResumeAI Pro — Provider Health Manager
// Tracks provider health metrics: latency, success rate, failure rate,
// rate limit status, authentication status.

"use client";

import { useApp } from "./store";
import { isApiProvider, isBrowserAuthProvider } from "./provider-router";
import { getPuterAuthStatus, isPuterLoaded } from "./puter-client";
import type { AIProvider } from "./types";

export interface ProviderHealthInfo {
  provider: AIProvider;
  category: "api" | "browser_auth";
  status: "healthy" | "degraded" | "down" | "untested";
  authStatus: "authenticated" | "not_authenticated" | "not_required" | "unknown";
  latencyMs: number | null;
  successRate: number;       // 0-100
  failureRate: number;       // 0-100
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  rateLimited: boolean;
  rateLimitedUntil: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

/**
 * Get health info for all providers.
 */
export function getProviderHealth(): ProviderHealthInfo[] {
  const providers = useApp.getState().providers || [];
  return providers.map(getHealthForProvider);
}

/**
 * Get health info for a single provider.
 */
export function getHealthForProvider(p: AIProvider): ProviderHealthInfo {
  const category = isBrowserAuthProvider(p) ? "browser_auth" : "api";
  const health = p.health || {
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  };

  // Check rate limit
  const rateLimited = !!(health.rateLimitedUntil && new Date(health.rateLimitedUntil) > new Date());

  // Calculate success/failure rates from usage
  const totalRequests = p.usage?.requests || 0;
  const totalErrors = p.usage?.errors || 0;
  const successRate = totalRequests > 0 ? Math.round(((totalRequests - totalErrors) / totalRequests) * 100) : 100;
  const failureRate = totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 100) : 0;

  // Determine auth status
  let authStatus: ProviderHealthInfo["authStatus"] = "unknown";
  if (category === "browser_auth") {
    if (!isPuterLoaded()) {
      authStatus = "not_authenticated";
    } else {
      const puterStatus = getPuterAuthStatus();
      authStatus = puterStatus === "authenticated" ? "authenticated" : "not_authenticated";
    }
  } else {
    authStatus = p.apiKey ? "authenticated" : "not_required";
  }

  // Determine overall status
  let status: ProviderHealthInfo["status"] = p.status || "untested";
  if (rateLimited) status = "degraded";
  if (health.consecutiveFailures >= 3) status = "down";
  else if (health.consecutiveFailures >= 1) status = "degraded";
  else if (health.consecutiveSuccesses >= 1) status = "healthy";

  return {
    provider: p,
    category,
    status,
    authStatus,
    latencyMs: p.usage?.avgLatencyMs || null,
    successRate,
    failureRate,
    lastSuccessAt: health.lastSuccessAt || null,
    lastFailureAt: health.lastFailureAt || null,
    lastError: health.lastError || null,
    rateLimited,
    rateLimitedUntil: health.rateLimitedUntil || null,
    consecutiveFailures: health.consecutiveFailures || 0,
    consecutiveSuccesses: health.consecutiveSuccesses || 0,
  };
}

/**
 * Record a successful request for a provider.
 */
export function recordSuccess(providerId: string, latencyMs: number): void {
  const state = useApp.getState();
  const provider = state.providers.find((p) => p.id === providerId);
  if (!provider) return;

  const now = new Date().toISOString();
  const health = provider.health || { consecutiveFailures: 0, consecutiveSuccesses: 0 };

  state.updateProvider(providerId, {
    health: {
      ...health,
      lastSuccessAt: now,
      consecutiveSuccesses: health.consecutiveSuccesses + 1,
      consecutiveFailures: 0,
      lastError: undefined,
    },
    lastUsedAt: now,
    status: "healthy",
    usage: {
      ...provider.usage,
      requests: provider.usage.requests + 1,
      avgLatencyMs: Math.round((provider.usage.avgLatencyMs * provider.usage.requests + latencyMs) / (provider.usage.requests + 1)),
    },
  });
}

/**
 * Record a failed request for a provider.
 */
export function recordFailure(providerId: string, error: string, isRateLimit = false): void {
  const state = useApp.getState();
  const provider = state.providers.find((p) => p.id === providerId);
  if (!provider) return;

  const now = new Date().toISOString();
  const health = provider.health || { consecutiveFailures: 0, consecutiveSuccesses: 0 };

  state.updateProvider(providerId, {
    health: {
      ...health,
      lastFailureAt: now,
      lastError: error,
      consecutiveFailures: health.consecutiveFailures + 1,
      consecutiveSuccesses: 0,
      rateLimitedUntil: isRateLimit ? new Date(Date.now() + 60 * 1000).toISOString() : health.rateLimitedUntil,
    },
    lastUsedAt: now,
    status: health.consecutiveFailures + 1 >= 3 ? "down" : "degraded",
    usage: {
      ...provider.usage,
      requests: provider.usage.requests + 1,
      errors: provider.usage.errors + 1,
    },
  });
}

/**
 * Detect if an error is a rate limit (429) error.
 */
export function isRateLimitError(error: string): boolean {
  return /429|rate.?limit|too.?many.?requests|quota|FreeUsageLimitError/i.test(error);
}

/**
 * Detect if an error is an authentication (401/403) error.
 */
export function isAuthError(error: string): boolean {
  return /401|403|unauthor|forbidden|invalid.?api.?key|auth.?fail/i.test(error);
}

/**
 * Detect if an error is a model not found (404) error.
 */
export function isModelError(error: string): boolean {
  return /404|model.?not.?found|not_found_error|invalid.?model/i.test(error);
}
