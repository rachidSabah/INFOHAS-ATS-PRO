// ============================================================================
// HealthMonitor — circuit breaker, latency/availability tracking
// ============================================================================

import type { ProviderId, ProviderHealth } from "./types";
import { ProviderRegistry } from "./provider-registry";

export interface CircuitBreakerConfig {
  failureThreshold: number;    // consecutive failures before opening circuit
  successThreshold: number;    // consecutive successes before closing circuit
  halfOpenMaxCalls: number;    // max calls to allow in half-open state
  cooldownMs: number;          // how long to wait before half-open
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  halfOpenMaxCalls: 1,
  cooldownMs: 30_000, // 30 seconds
};

interface CircuitState {
  state: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  halfOpenCalls: number;
}

/**
 * HealthMonitor — continuously monitors provider health, manages circuit
 * breakers, and tracks latency/availability metrics.
 *
 * Providers that fail health checks are automatically marked as unhealthy.
 * Circuit breakers automatically disable failing providers with automatic
 * recovery via half-open probes.
 */
export class HealthMonitor {
  private registry: ProviderRegistry;
  private circuits = new Map<ProviderId, CircuitState>();
  private config: CircuitBreakerConfig;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    registry: ProviderRegistry,
    config?: Partial<CircuitBreakerConfig>,
  ) {
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Circuit Breaker ──────────────────────────────────────────────────

  /**
   * Check if a provider's circuit breaker allows calls.
   */
  isAllowed(providerId: ProviderId): boolean {
    const circuit = this.circuits.get(providerId);
    if (!circuit) return true; // not tracked yet

    if (circuit.state === "closed") return true;
    if (circuit.state === "open") {
      // Check if cooldown has elapsed → transition to half-open
      if (Date.now() - circuit.lastFailureTime >= this.config.cooldownMs) {
        circuit.state = "half-open";
        circuit.halfOpenCalls = 0;
        return true;
      }
      return false;
    }
    // half-open: allow limited calls
    if (circuit.halfOpenCalls < this.config.halfOpenMaxCalls) {
      circuit.halfOpenCalls++;
      return true;
    }
    return false;
  }

  /**
   * Record a successful call.
   */
  recordSuccess(providerId: ProviderId, latencyMs: number): void {
    let circuit = this.circuits.get(providerId);
    if (!circuit) {
      circuit = this.initCircuit();
      this.circuits.set(providerId, circuit);
    }

    circuit.consecutiveFailures = 0;
    circuit.consecutiveSuccesses++;
    circuit.lastSuccessTime = Date.now();

    // If half-open and we hit success threshold → close
    if (
      circuit.state === "half-open" &&
      circuit.consecutiveSuccesses >= this.config.successThreshold
    ) {
      circuit.state = "closed";
      circuit.halfOpenCalls = 0;
    }

    // Update registry health
    this.registry.updateHealth(providerId, {
      status: "healthy",
      latencyMs,
      lastChecked: Date.now(),
      successRate: this.calculateSuccessRate(circuit),
      consecutiveFailures: 0,
      circuitState: circuit.state,
    });
  }

  /**
   * Record a failed call (updates circuit breaker).
   */
  recordFailure(providerId: ProviderId, error: string): void {
    let circuit = this.circuits.get(providerId);
    if (!circuit) {
      circuit = this.initCircuit();
      this.circuits.set(providerId, circuit);
    }

    circuit.consecutiveFailures++;
    circuit.consecutiveSuccesses = 0;
    circuit.lastFailureTime = Date.now();

    // Check if threshold met → open circuit
    if (circuit.consecutiveFailures >= this.config.failureThreshold) {
      circuit.state = "open";
    }

    const status: ProviderHealth["status"] =
      circuit.state === "open"
        ? "unhealthy"
        : circuit.consecutiveFailures >= this.config.failureThreshold - 1
          ? "degraded"
          : "healthy";

    this.registry.updateHealth(providerId, {
      status,
      latencyMs: 0,
      lastChecked: Date.now(),
      successRate: this.calculateSuccessRate(circuit),
      consecutiveFailures: circuit.consecutiveFailures,
      circuitState: circuit.state,
      lastError: error,
    });
  }

  /**
   * Get current circuit state for a provider.
   */
  getCircuitState(providerId: ProviderId): CircuitState | undefined {
    return this.circuits.get(providerId);
  }

  // ── Health Checks ────────────────────────────────────────────────────

  /**
   * Run a health check against all registered providers.
   */
  async checkAll(): Promise<void> {
    for (const reg of this.registry.getAll()) {
      try {
        const health = await reg.provider.health();
        this.registry.updateHealth(reg.config.id, health);
      } catch {
        this.registry.updateHealth(reg.config.id, {
          status: "unhealthy",
          latencyMs: 0,
          lastChecked: Date.now(),
          successRate: 0,
          consecutiveFailures: 999,
          circuitState: "open",
          lastError: "Health check failed",
        });
      }
    }
  }

  /**
   * Start periodic health checks.
   */
  startPeriodicChecks(intervalMs: number = 60_000): void {
    if (this.healthInterval) return;
    this.healthInterval = setInterval(() => this.checkAll(), intervalMs);
    // Run first check immediately
    this.checkAll();
  }

  /**
   * Stop periodic health checks.
   */
  stopPeriodicChecks(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  // ── Recovery ─────────────────────────────────────────────────────────

  /**
   * Manually reset a provider's circuit breaker.
   */
  resetCircuit(providerId: ProviderId): void {
    const circuit = this.circuits.get(providerId);
    if (circuit) {
      circuit.state = "closed";
      circuit.consecutiveFailures = 0;
      circuit.consecutiveSuccesses = 0;
      circuit.halfOpenCalls = 0;
    }
    this.registry.updateHealth(providerId, {
      status: "healthy",
      latencyMs: 0,
      lastChecked: Date.now(),
      successRate: 100,
      consecutiveFailures: 0,
      circuitState: "closed",
    });
  }

  /**
   * Get a summary of all circuit states.
   */
  getCircuitSummary(): Array<{
    providerId: ProviderId;
    state: string;
    failures: number;
  }> {
    const summary: Array<{
      providerId: ProviderId;
      state: string;
      failures: number;
    }> = [];
    for (const [id, circuit] of this.circuits) {
      summary.push({
        providerId: id,
        state: circuit.state,
        failures: circuit.consecutiveFailures,
      });
    }
    return summary;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private initCircuit(): CircuitState {
    return {
      state: "closed",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      halfOpenCalls: 0,
    };
  }

  private calculateSuccessRate(circuit: CircuitState): number {
    const total = circuit.consecutiveFailures + circuit.consecutiveSuccesses;
    if (total === 0) return 100;
    return Math.round((circuit.consecutiveSuccesses / total) * 100);
  }
}
