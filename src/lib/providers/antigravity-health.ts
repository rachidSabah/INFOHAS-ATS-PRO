/**
 * antigravity-health.ts — Provider Health Monitor for Antigravity
 *
 * Tracks 429 errors, timeouts, latency, availability, and rate limits.
 * Automatically avoids unhealthy providers in the routing engine.
 */

export interface ProviderHealthEntry {
  providerId: string;
  modelId: string;
  latency: number;           // average latency in ms
  successCount: number;
  failureCount: number;
  rateLimitCount: number;
  healthScore: number;       // 0.0 - 100.0
  updatedAt: number;
}

export interface ModelCapability {
  quality: number;           // 0-100
  reasoning: number;         // 0-100
  coding: number;            // 0-100
  contextWindow: number;
  latency: number;           // ms
  health: number;            // 0-100
  availability: number;      // 0-100
}

const HEALTH_STORAGE_KEY = "antigravity_provider_health";

/**
 * Calculate composite capability score for model routing.
 * Higher = better.
 */
export function calculateCapabilityScore(cap: ModelCapability): number {
  return cap.quality + cap.reasoning + cap.coding + cap.health + cap.availability - (cap.latency / 100);
}

/**
 * Record a successful API call.
 */
export function recordSuccess(modelId: string, latencyMs: number): void {
  const health = loadHealth();
  const entry = health.get(modelId) || { providerId: "antigravity", modelId, latency: 0, successCount: 0, failureCount: 0, rateLimitCount: 0, healthScore: 100, updatedAt: 0 };
  entry.successCount++;
  entry.latency = entry.latency === 0 ? latencyMs : Math.round((entry.latency * 0.7) + (latencyMs * 0.3));
  entry.updatedAt = Date.now();
  entry.healthScore = Math.min(100, entry.healthScore + 1);
  health.set(modelId, entry);
  saveHealth(health);
}

/**
 * Record a failure (timeout, server error).
 */
export function recordFailure(modelId: string): void {
  const health = loadHealth();
  const entry = health.get(modelId) || { providerId: "antigravity", modelId, latency: 0, successCount: 0, failureCount: 0, rateLimitCount: 0, healthScore: 100, updatedAt: 0 };
  entry.failureCount++;
  entry.updatedAt = Date.now();
  entry.healthScore = Math.max(0, entry.healthScore - 10);
  health.set(modelId, entry);
  saveHealth(health);
}

/**
 * Record a 429 rate limit hit.
 */
export function recordRateLimit(modelId: string): void {
  const health = loadHealth();
  const entry = health.get(modelId) || { providerId: "antigravity", modelId, latency: 0, successCount: 0, failureCount: 0, rateLimitCount: 0, healthScore: 100, updatedAt: 0 };
  entry.rateLimitCount++;
  entry.updatedAt = Date.now();
  entry.healthScore = Math.max(0, entry.healthScore - 25); // Heavy penalty for rate limits
  health.set(modelId, entry);
  saveHealth(health);
}

/**
 * Get the healthiest model from the available list.
 * Returns models with healthScore >= 50.
 */
export function getHealthyModels(): { modelId: string; healthScore: number }[] {
  const health = loadHealth();
  const result: { modelId: string; healthScore: number }[] = [];
  for (const [modelId, entry] of health) {
    if (entry.healthScore >= 50) {
      result.push({ modelId, healthScore: entry.healthScore });
    }
  }
  return result.sort((a, b) => b.healthScore - a.healthScore);
}

/**
 * Check if a specific model is healthy enough to use.
 */
export function isModelHealthy(modelId: string, threshold: number = 50): boolean {
  const health = loadHealth();
  const entry = health.get(modelId);
  if (!entry) return true; // No data yet — assume healthy
  return entry.healthScore >= threshold;
}

function loadHealth(): Map<string, ProviderHealthEntry> {
  try {
    const raw = localStorage.getItem(HEALTH_STORAGE_KEY);
    if (!raw) return new Map();
    return new Map(JSON.parse(raw));
  } catch {
    return new Map();
  }
}

function saveHealth(health: Map<string, ProviderHealthEntry>): void {
  try {
    localStorage.setItem(HEALTH_STORAGE_KEY, JSON.stringify([...health]));
  } catch {
    // localStorage full — silently degrade
  }
}

/**
 * Reset health data (e.g., on reconnect).
 */
export function resetHealth(): void {
  try {
    localStorage.removeItem(HEALTH_STORAGE_KEY);
  } catch { /* ignore */ }
}
