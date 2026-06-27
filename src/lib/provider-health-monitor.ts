// ============================================================================
// Provider Health Monitor — per-provider latency, success rate, rate limit tracking
//
// Tracks every AI call per provider to build a runtime health profile.
// The Supervisor can use this to auto-select the best provider.
// Eliminates "all providers failed" situations by excluding degraded providers.
//
// Integrated with Agent Event Bus for real-time monitoring.
// ============================================================================

import { globalEventBus } from "./agent-event-bus";

export interface ProviderHealth {
  provider: string;
  /** Total calls made */
  totalCalls: number;
  /** Successful calls */
  successfulCalls: number;
  /** Failed calls */
  failedCalls: number;
  /** Rate-limited calls (429 responses) */
  rateLimitedCalls: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Last latency in milliseconds */
  lastLatencyMs: number;
  /** Success rate 0-100 */
  successRate: number;
  /** Whether this provider is currently rate-limited */
  isRateLimited: boolean;
  /** Last call timestamp */
  lastCallAt: string;
  /** Health status */
  status: "healthy" | "degraded" | "unhealthy";
}

const providers = new Map<string, ProviderHealth>();

function initProvider(name: string): ProviderHealth {
  return {
    provider: name,
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    rateLimitedCalls: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    successRate: 100,
    isRateLimited: false,
    lastCallAt: new Date().toISOString(),
    status: "healthy",
  };
}

/**
 * Record a successful call to a provider.
 */
export function recordProviderSuccess(
  provider: string,
  latencyMs: number,
  tokensUsed?: number,
): void {
  let health = providers.get(provider);
  if (!health) {
    health = initProvider(provider);
    providers.set(provider, health);
  }

  health.totalCalls++;
  health.successfulCalls++;
  health.lastLatencyMs = latencyMs;
  health.lastCallAt = new Date().toISOString();

  // Exponential moving average for latency
  health.avgLatencyMs = health.avgLatencyMs === 0
    ? latencyMs
    : Math.round(health.avgLatencyMs * 0.7 + latencyMs * 0.3);

  health.successRate = Math.round((health.successfulCalls / health.totalCalls) * 100);
  health.status = health.successRate >= 90 ? "healthy" : health.successRate >= 70 ? "degraded" : "unhealthy";

  globalEventBus.emit({
    agent: "ProviderHealthMonitor",
    action: "call_success",
    resumeId: provider,
    duration: latencyMs,
    tokens: tokensUsed ?? 0,
    provider,
    success: true,
    metadata: { successRate: health.successRate, avgLatencyMs: health.avgLatencyMs },
  });
}

/**
 * Record a failed call to a provider.
 */
export function recordProviderFailure(
  provider: string,
  latencyMs: number,
  isRateLimit: boolean = false,
): void {
  let health = providers.get(provider);
  if (!health) {
    health = initProvider(provider);
    providers.set(provider, health);
  }

  health.totalCalls++;
  health.failedCalls++;
  health.lastLatencyMs = latencyMs;
  health.lastCallAt = new Date().toISOString();

  if (isRateLimit) {
    health.rateLimitedCalls++;
    health.isRateLimited = true;
    // Reset rate limit flag after 30 seconds
    setTimeout(() => {
      const current = providers.get(provider);
      if (current) current.isRateLimited = false;
    }, 30000);
  }

  health.successRate = Math.round(((health.totalCalls - health.failedCalls) / health.totalCalls) * 100);
  health.status = health.successRate >= 90 ? "healthy" : health.successRate >= 70 ? "degraded" : "unhealthy";

  globalEventBus.emit({
    agent: "ProviderHealthMonitor",
    action: "call_failed",
    resumeId: provider,
    duration: latencyMs,
    provider,
    success: false,
    metadata: { isRateLimit, successRate: health.successRate },
  });
}

/**
 * Get health for all providers, sorted by best success rate.
 */
export function getProviderHealth(): ProviderHealth[] {
  const all = Array.from(providers.values());
  return all.sort((a, b) => b.successRate - a.successRate);
}

/**
 * Get health for a specific provider.
 */
export function getProviderHealthByName(provider: string): ProviderHealth | null {
  return providers.get(provider) ?? null;
}

/**
 * Get the best available provider (highest success rate, not rate-limited).
 */
export function getBestProvider(): { provider: string; health: ProviderHealth } | null {
  const candidates = Array.from(providers.entries())
    .filter(([, h]) => !h.isRateLimited && h.status !== "unhealthy")
    .sort(([, a], [, b]) => b.successRate - a.successRate);

  if (candidates.length === 0) return null;
  const [provider, health] = candidates[0];
  return { provider, health };
}

/**
 * Clear all provider health data.
 */
export function clearProviderHealth(): void {
  providers.clear();
}
