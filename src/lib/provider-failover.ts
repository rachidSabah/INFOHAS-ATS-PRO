// ============================================================================
// Provider Failover Chain
//
// Structured provider priority with exponential backoff:
//   Primary → Fallback 1 → Fallback 2 → ... → Local Engine
//
// Backoff: 2s, 5s, 10s on rate limits (429)
// Cooldown: 90s on timeouts, 30min on auth (401)
//
// Integrates with circuit breakers — skips tripped providers.
// ============================================================================

"use client";

import type { AIProvider } from "./types";
import { isProviderTripped, recordProviderCircuitFailure, resetProviderCircuit } from "./circuit-breaker";
import { recordProviderFailure } from "./telemetry";

export interface FailoverResult {
  provider: AIProvider | null;
  providerIndex: number;
  attempted: string[];
  skipped: string[];
  reason: string;
}

/**
 * Default provider priority order.
 * The chain tries providers in this order, skipping tripped/inactive ones.
 */
export const DEFAULT_FAILOVER_ORDER = [
  "opencode",    // Primary: OpenCode (free models)
  "zencode",     // Fallback 1: ZenCode (free models)
  "nvidia",      // Fallback 2: Nvidia (Llama free)
  "google",      // Fallback 3: Google (Gemini Flash)
  "openrouter",  // Fallback 4: OpenRouter
  "mistral",     // Fallback 5: Mistral
  "puter",       // Fallback 6: Puter.js (browser auth)
  "zai",         // Fallback 7: Z.ai built-in
];

/**
 * Get the ordered failover chain for the current providers.
 * Filters out inactive providers and those with circuit breakers tripped.
 * Providers are ordered by DEFAULT_FAILOVER_ORDER, then by priority field.
 */
export function getFailoverChain(providers: AIProvider[]): AIProvider[] {
  const activeProviders = providers.filter(
    (p) => p.isActive &&
    // Skip if circuit breaker is tripped
    !isProviderTripped(p.name) &&
    // Skip if no API key (unless browser_auth like Puter)
    (p.apiKey || p.providerCategory === "browser_auth")
  );

  // Sort by failover order, then by priority
  const ordered: AIProvider[] = [];
  for (const type of DEFAULT_FAILOVER_ORDER) {
    const match = activeProviders.find((p) => p.type === type || p.id.includes(type));
    if (match && !ordered.includes(match)) {
      ordered.push(match);
    }
  }

  // Add any remaining active providers not in the default order
  for (const p of activeProviders) {
    if (!ordered.includes(p)) {
      ordered.push(p);
    }
  }

  return ordered;
}

/**
 * Calculate exponential backoff delay for a given attempt.
 * Returns: 2s, 5s, 10s for attempts 1, 2, 3+
 */
export function getBackoffDelay(attempt: number): number {
  const delays = [2000, 5000, 10000];
  return delays[Math.min(attempt - 1, delays.length - 1)] || 10000;
}

/**
 * Record a provider failure and determine if we should failover.
 * Returns true if we should try the next provider, false if we should retry.
 */
export function shouldFailover(
  providerName: string,
  error: { statusCode?: number; message?: string },
): { failover: boolean; delayMs: number; reason: string } {
  const msg = error.message || "";
  const status = error.statusCode;

  // 429 = Rate limited → backoff and retry same provider
  if (status === 429 || /rate.?limit/i.test(msg) || /429/.test(msg)) {
    recordProviderCircuitFailure(providerName, 180_000); // 3 min cooldown
    recordProviderFailure({
      providerName,
      errorType: "rate_limit",
      errorMessage: msg,
    });
    return { failover: true, delayMs: getBackoffDelay(1), reason: "Rate limited (429) — failover to next provider" };
  }

  // 401 = Auth failure → failover immediately, long cooldown
  if (status === 401 || /401/.test(msg) || /billing|payment|credits/i.test(msg)) {
    recordProviderCircuitFailure(providerName, 30 * 60 * 1000); // 30 min cooldown
    recordProviderFailure({
      providerName,
      errorType: "auth",
      errorMessage: msg,
    });
    return { failover: true, delayMs: 0, reason: "Auth failure (401) — failover immediately" };
  }

  // Timeout → failover with short delay
  if (/timeout|timed out|abort/i.test(msg)) {
    recordProviderCircuitFailure(providerName, 90_000); // 90s cooldown
    recordProviderFailure({
      providerName,
      errorType: "timeout",
      errorMessage: msg,
    });
    return { failover: true, delayMs: 1000, reason: "Timeout — failover to next provider" };
  }

  // Network error → failover
  if (/network|fetch|unreachable|connection/i.test(msg)) {
    recordProviderCircuitFailure(providerName, 60_000); // 60s cooldown
    recordProviderFailure({
      providerName,
      errorType: "network",
      errorMessage: msg,
    });
    return { failover: true, delayMs: 2000, reason: "Network error — failover to next provider" };
  }

  // Unknown error → failover
  recordProviderCircuitFailure(providerName);
  recordProviderFailure({
    providerName,
    errorType: "unknown",
    errorMessage: msg,
  });
  return { failover: true, delayMs: 1000, reason: "Unknown error — failover to next provider" };
}

/**
 * Record a successful provider call — resets the circuit breaker.
 */
export function recordProviderSuccess(providerName: string): void {
  resetProviderCircuit(providerName);
}

/**
 * Get the list of currently available providers (not tripped, active, with keys).
 */
export function getAvailableProviders(providers: AIProvider[]): AIProvider[] {
  return getFailoverChain(providers);
}

/**
 * Get the list of currently unavailable providers (tripped or inactive).
 */
export function getUnavailableProviders(providers: AIProvider[]): { name: string; reason: string }[] {
  const unavailable: { name: string; reason: string }[] = [];

  for (const p of providers) {
    if (!p.isActive) {
      unavailable.push({ name: p.name, reason: "Inactive" });
    } else if (isProviderTripped(p.name)) {
      unavailable.push({ name: p.name, reason: "Circuit breaker tripped" });
    } else if (!p.apiKey && p.type !== "puter") {
      unavailable.push({ name: p.name, reason: "No API key" });
    }
  }

  return unavailable;
}
