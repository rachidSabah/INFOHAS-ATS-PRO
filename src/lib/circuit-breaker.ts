/**
 * circuit-breaker.ts — Provider Circuit Breaker + State Machine
 *
 * State Machine: CONNECTED → HEALTHY → DEGRADED → UNHEALTHY → COOLDOWN → HEALTHY
 *
 * Rules:
 * - 3 consecutive failures → mark UNHEALTHY, enter 15-min cooldown
 * - After cooldown → mark HEALTHY on next success
 * - Puter: always DEGRADED, never HEALTHY (emergency only)
 * - Track: 429, timeouts, network failures, auth errors
 */

export type ProviderState = "connected" | "healthy" | "degraded" | "unhealthy" | "cooldown";

interface ProviderStatus {
  state: ProviderState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  cooldownUntil: number;
  rateLimitCount: number;
  timeoutCount: number;
  authFailureCount: number;
  totalCalls: number;
  totalFailures: number;
}

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const UNHEALTHY_THRESHOLD = 3;     // 3 consecutive failures → unhealthy
const HEALTHY_RESET = 2;            // 2 consecutive successes → healthy

/**
 * Providers that are emergency-only (Puter).
 * These providers are NEVER selected normally; only used as absolute last resort.
 */
export const EMERGENCY_ONLY_PROVIDERS = new Set(["puter", "p_puter"]);

/** In-memory circuit breaker state (resets on page reload) */
const circuitState = new Map<string, ProviderStatus>();

function getOrCreate(providerId: string): ProviderStatus {
  let status = circuitState.get(providerId);
  if (!status) {
    const isEmergency = EMERGENCY_ONLY_PROVIDERS.has(providerId) ||
      EMERGENCY_ONLY_PROVIDERS.has(providerId.replace("p_", ""));
    status = {
      state: isEmergency ? "degraded" : "connected",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      cooldownUntil: 0,
      rateLimitCount: 0,
      timeoutCount: 0,
      authFailureCount: 0,
      totalCalls: 0,
      totalFailures: 0,
    };
    circuitState.set(providerId, status);
  }
  return status;
}

/**
 * Record a successful call. Moves state toward HEALTHY.
 */
export function circuitBreakerSuccess(providerId: string, latencyMs?: number): void {
  const status = getOrCreate(providerId);
  status.totalCalls++;
  status.consecutiveSuccesses++;
  status.consecutiveFailures = 0;
  status.lastSuccessAt = Date.now();

  // Reset cooldown if enough consecutive successes
  if (status.consecutiveSuccesses >= HEALTHY_RESET) {
    status.state = "healthy";
    status.cooldownUntil = 0;
  } else if (status.state === "cooldown") {
    status.state = "degraded";
  }
}

/**
 * Record a failure (429, timeout, network, auth).
 * Moves state toward UNHEALTHY after threshold.
 */
export function circuitBreakerFailure(providerId: string, reason: "rate_limit" | "timeout" | "network" | "auth"): void {
  const status = getOrCreate(providerId);
  status.totalCalls++;
  status.totalFailures++;
  status.consecutiveFailures++;
  status.consecutiveSuccesses = 0;
  status.lastFailureAt = Date.now();

  switch (reason) {
    case "rate_limit": status.rateLimitCount++; break;
    case "timeout": status.timeoutCount++; break;
    case "auth": status.authFailureCount++; break;
  }

  // Enter cooldown after threshold consecutive failures
  if (status.consecutiveFailures >= UNHEALTHY_THRESHOLD) {
    status.state = "unhealthy";
    status.cooldownUntil = Date.now() + COOLDOWN_MS;
    console.warn(`[CircuitBreaker] ${providerId} marked UNHEALTHY (${status.consecutiveFailures} consecutive failures). Cooldown until ${new Date(status.cooldownUntil).toISOString()}.`);
  } else if (status.consecutiveFailures >= 2) {
    status.state = "degraded";
  }
}

/**
 * Enter cooldown manually (e.g., after exhausting all retries).
 */
export function circuitBreakerCooldown(providerId: string): void {
  const status = getOrCreate(providerId);
  status.state = "cooldown";
  status.cooldownUntil = Date.now() + COOLDOWN_MS;
}

/**
 * Check if a provider is available for use.
 * Returns true if the provider is not in unhealthy/cooldown state.
 */
export function isProviderAvailable(providerId: string): boolean {
  const status = circuitState.get(providerId);
  if (!status) return true;

  // Check cooldown expiry
  if (status.state === "unhealthy" || status.state === "cooldown") {
    if (Date.now() > status.cooldownUntil) {
      status.state = "degraded";
      status.consecutiveFailures = 0;
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Check if a provider should be skipped for optimization.
 * Emergency-only providers (Puter) return ALWAYS false here —
 * they're only used when all other providers are exhausted.
 */
export function shouldSkipForOptimization(providerId: string): boolean {
  if (EMERGENCY_ONLY_PROVIDERS.has(providerId) || EMERGENCY_ONLY_PROVIDERS.has(providerId.replace("p_", ""))) {
    return true; // Skip for optimization, only for emergency
  }
  return !isProviderAvailable(providerId);
}

/**
 * Get remaining cooldown time in seconds.
 */
export function getCooldownRemaining(providerId: string): number {
  const status = circuitState.get(providerId);
  if (!status || status.cooldownUntil <= Date.now()) return 0;
  return Math.ceil((status.cooldownUntil - Date.now()) / 1000);
}

/**
 * Get full provider status.
 */
export function getProviderStatus(providerId: string): ProviderStatus {
  return getOrCreate(providerId);
}

/**
 * Reset circuit breaker for a provider.
 */
export function resetCircuitBreaker(providerId: string): void {
  const isEmergency = EMERGENCY_ONLY_PROVIDERS.has(providerId) ||
    EMERGENCY_ONLY_PROVIDERS.has(providerId.replace("p_", ""));
  circuitState.set(providerId, {
    state: isEmergency ? "degraded" : "connected",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastFailureAt: 0,
    lastSuccessAt: 0,
    cooldownUntil: 0,
    rateLimitCount: 0,
    timeoutCount: 0,
    authFailureCount: 0,
    totalCalls: 0,
    totalFailures: 0,
  });
}

/** Debug: dump all circuit breaker states */
export function dumpCircuitBreaker(): ProviderStatus[] {
  return Array.from(circuitState.values());
}

/**
 * Get IDs of all providers that are currently in unhealthy or cooldown state.
 */
export function getTrippedProviders(): string[] {
  const tripped: string[] = [];
  for (const [id, status] of circuitState.entries()) {
    if (status.state === "unhealthy" || status.state === "cooldown") {
      tripped.push(id);
    }
  }
  return tripped;
}
