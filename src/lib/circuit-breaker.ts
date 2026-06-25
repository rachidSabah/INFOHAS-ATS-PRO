// ============================================================================
// Circuit Breaker Service
//
// Automatically trips when a provider fails > 5 times in 60 seconds.
// When tripped, the provider is skipped for a cooldown period.
//
// ProviderCircuitBreaker: tracks per-provider failure rates
// PipelineCircuitBreaker: tracks overall pipeline failure rates
// DatabaseCircuitBreaker: tracks D1 connection failures
// RepairCircuitBreaker: tracks self-healing repair attempts
// ============================================================================

"use client";

interface CircuitState {
  failureCount: number;
  lastFailureTime: number;
  tripped: boolean;
  trippedAt: number | null;
  cooldownMs: number;
}

const FAILURE_THRESHOLD = 5; // trip after 5 failures
const WINDOW_MS = 60_000; // 60 seconds
const DEFAULT_COOLDOWN_MS = 90_000; // 90 seconds

// Per-provider circuit states
const providerCircuits = new Map<string, CircuitState>();
const pipelineCircuit: CircuitState = {
  failureCount: 0,
  lastFailureTime: 0,
  tripped: false,
  trippedAt: null,
  cooldownMs: DEFAULT_COOLDOWN_MS,
};
const dbCircuit: CircuitState = {
  failureCount: 0,
  lastFailureTime: 0,
  tripped: false,
  trippedAt: null,
  cooldownMs: 30_000, // 30s for DB
};
const repairCircuit: CircuitState = {
  failureCount: 0,
  lastFailureTime: 0,
  tripped: false,
  trippedAt: null,
  cooldownMs: 60_000, // 60s for repairs
};

/**
 * Check if a provider's circuit breaker is tripped.
 * If tripped and cooldown has elapsed, auto-resets.
 */
export function isProviderTripped(providerName: string): boolean {
  const state = providerCircuits.get(providerName);
  if (!state || !state.tripped) return false;

  // Check if cooldown has elapsed
  if (state.trippedAt && Date.now() - state.trippedAt > state.cooldownMs) {
    // Auto-reset
    state.tripped = false;
    state.trippedAt = null;
    state.failureCount = 0;
    console.info(`[Circuit Breaker] Provider "${providerName}" auto-reset after cooldown`);
    return false;
  }

  return true;
}

/**
 * Record a provider failure. Trips the circuit if threshold is reached.
 */
export function recordProviderCircuitFailure(providerName: string, cooldownMs?: number): void {
  let state = providerCircuits.get(providerName);
  if (!state) {
    state = {
      failureCount: 0,
      lastFailureTime: 0,
      tripped: false,
      trippedAt: null,
      cooldownMs: cooldownMs ?? DEFAULT_COOLDOWN_MS,
    };
    providerCircuits.set(providerName, state);
  }

  const now = Date.now();

  // Reset count if outside the window
  if (now - state.lastFailureTime > WINDOW_MS) {
    state.failureCount = 0;
  }

  state.failureCount++;
  state.lastFailureTime = now;

  if (state.failureCount >= FAILURE_THRESHOLD && !state.tripped) {
    state.tripped = true;
    state.trippedAt = now;
    console.warn(
      `[Circuit Breaker] Provider "${providerName}" TRIPPED — ` +
      `${state.failureCount} failures in ${WINDOW_MS / 1000}s. ` +
      `Cooldown: ${state.cooldownMs / 1000}s.`
    );
  }
}

/**
 * Reset a provider's circuit breaker (e.g., after successful call).
 */
export function resetProviderCircuit(providerName: string): void {
  const state = providerCircuits.get(providerName);
  if (state) {
    state.failureCount = 0;
    state.tripped = false;
    state.trippedAt = null;
  }
}

/**
 * Get all tripped providers (for UI display).
 */
export function getTrippedProviders(): string[] {
  const tripped: string[] = [];
  for (const [name, state] of providerCircuits.entries()) {
    if (isProviderTripped(name)) {
      tripped.push(name);
    }
  }
  return tripped;
}

// ============================================================================
// Pipeline Circuit Breaker
// ============================================================================

export function isPipelineTripped(): boolean {
  if (!pipelineCircuit.tripped) return false;
  if (pipelineCircuit.trippedAt && Date.now() - pipelineCircuit.trippedAt > pipelineCircuit.cooldownMs) {
    pipelineCircuit.tripped = false;
    pipelineCircuit.trippedAt = null;
    pipelineCircuit.failureCount = 0;
    console.info("[Circuit Breaker] Pipeline auto-reset after cooldown");
    return false;
  }
  return true;
}

export function recordPipelineCircuitFailure(): void {
  const now = Date.now();
  if (now - pipelineCircuit.lastFailureTime > WINDOW_MS) {
    pipelineCircuit.failureCount = 0;
  }
  pipelineCircuit.failureCount++;
  pipelineCircuit.lastFailureTime = now;

  if (pipelineCircuit.failureCount >= FAILURE_THRESHOLD && !pipelineCircuit.tripped) {
    pipelineCircuit.tripped = true;
    pipelineCircuit.trippedAt = now;
    console.error(
      `[Circuit Breaker] PIPELINE TRIPPED — ${pipelineCircuit.failureCount} failures in ${WINDOW_MS / 1000}s. ` +
      `Cooldown: ${pipelineCircuit.cooldownMs / 1000}s.`
    );
  }
}

export function resetPipelineCircuit(): void {
  pipelineCircuit.failureCount = 0;
  pipelineCircuit.tripped = false;
  pipelineCircuit.trippedAt = null;
}

// ============================================================================
// Database Circuit Breaker
// ============================================================================

export function isDatabaseTripped(): boolean {
  if (!dbCircuit.tripped) return false;
  if (dbCircuit.trippedAt && Date.now() - dbCircuit.trippedAt > dbCircuit.cooldownMs) {
    dbCircuit.tripped = false;
    dbCircuit.trippedAt = null;
    dbCircuit.failureCount = 0;
    console.info("[Circuit Breaker] Database auto-reset after cooldown");
    return false;
  }
  return true;
}

export function recordDatabaseCircuitFailure(): void {
  const now = Date.now();
  if (now - dbCircuit.lastFailureTime > WINDOW_MS) {
    dbCircuit.failureCount = 0;
  }
  dbCircuit.failureCount++;
  dbCircuit.lastFailureTime = now;

  if (dbCircuit.failureCount >= FAILURE_THRESHOLD && !dbCircuit.tripped) {
    dbCircuit.tripped = true;
    dbCircuit.trippedAt = now;
    console.error(`[Circuit Breaker] DATABASE TRIPPED — ${dbCircuit.failureCount} failures. Cooldown: ${dbCircuit.cooldownMs / 1000}s.`);
  }
}

export function resetDatabaseCircuit(): void {
  dbCircuit.failureCount = 0;
  dbCircuit.tripped = false;
  dbCircuit.trippedAt = null;
}

// ============================================================================
// Repair Circuit Breaker (prevents infinite repair loops)
// ============================================================================

export function isRepairTripped(): boolean {
  if (!repairCircuit.tripped) return false;
  if (repairCircuit.trippedAt && Date.now() - repairCircuit.trippedAt > repairCircuit.cooldownMs) {
    repairCircuit.tripped = false;
    repairCircuit.trippedAt = null;
    repairCircuit.failureCount = 0;
    console.info("[Circuit Breaker] Repair auto-reset after cooldown");
    return false;
  }
  return true;
}

export function recordRepairCircuitFailure(): void {
  const now = Date.now();
  if (now - repairCircuit.lastFailureTime > WINDOW_MS) {
    repairCircuit.failureCount = 0;
  }
  repairCircuit.failureCount++;
  repairCircuit.lastFailureTime = now;

  if (repairCircuit.failureCount >= FAILURE_THRESHOLD && !repairCircuit.tripped) {
    repairCircuit.tripped = true;
    repairCircuit.trippedAt = now;
    console.error(`[Circuit Breaker] REPAIR TRIPPED — ${repairCircuit.failureCount} repair failures. Pausing self-healing for ${repairCircuit.cooldownMs / 1000}s.`);
  }
}

export function resetRepairCircuit(): void {
  repairCircuit.failureCount = 0;
  repairCircuit.tripped = false;
  repairCircuit.trippedAt = null;
}
