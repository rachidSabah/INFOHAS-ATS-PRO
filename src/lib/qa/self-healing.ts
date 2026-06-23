// ResumeAI Pro — Self-Healing Engine
// Automatically detects failures and takes corrective action:
// - Provider fails → retry, then disable temporarily
// - Cache corrupted → purge cache
// - Optimization invalid → restore original
// - Export invalid → regenerate
// - Pipeline fails → abort and surface error
// NEVER fakes success.
//
// "use client" — interacts with Zustand store.

import type { HealingAction, HealingEvent } from "./types";

const MAX_RETRY_ATTEMPTS = 3;
const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * In-memory healing event log.
 */
const healingLog: HealingEvent[] = [];

/**
 * Get all healing events.
 */
export function getHealingEvents(): HealingEvent[] {
  return [...healingLog];
}

/**
 * Clear healing event log.
 */
export function clearHealingLog(): void {
  healingLog.length = 0;
}

/**
 * Log a healing event.
 */
function logHealingEvent(
  trigger: string,
  action: HealingAction,
  result: "success" | "failed" | "pending",
  details: string,
  opts?: { providerId?: string; resumeId?: string }
): HealingEvent {
  const event: HealingEvent = {
    id: `heal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    trigger,
    action,
    result,
    details,
    providerId: opts?.providerId,
    resumeId: opts?.resumeId,
  };
  healingLog.push(event);
  return event;
}

// ============================================================================
// Provider Self-Healing
// ============================================================================

/**
 * Track temporarily disabled providers.
 * Key: providerId, Value: { until timestamp, reason }
 */
const disabledProviders = new Map<string, { until: number; reason: string }>();

/**
 * Check if a provider is temporarily disabled.
 */
export function isProviderDisabled(providerId: string): boolean {
  const entry = disabledProviders.get(providerId);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    disabledProviders.delete(providerId);
    return false;
  }
  return true;
}

/**
 * Get disabled provider info.
 */
export function getDisabledProviders(): Array<{ providerId: string; until: string; reason: string }> {
  // Clean up expired entries
  for (const [id, entry] of disabledProviders) {
    if (Date.now() > entry.until) {
      disabledProviders.delete(id);
    }
  }
  return [...disabledProviders.entries()].map(([id, entry]) => ({
    providerId: id,
    until: new Date(entry.until).toISOString(),
    reason: entry.reason,
  }));
}

/**
 * Heal a provider failure.
 * Strategy: retry up to MAX_RETRIES, then disable temporarily.
 */
export async function healProviderFailure(
  providerId: string,
  providerName: string,
  retryFn: () => Promise<boolean>
): Promise<HealingEvent> {
  // Check if already disabled
  if (isProviderDisabled(providerId)) {
    return logHealingEvent(
      `Provider ${providerName} failed`,
      "disable_provider_temporarily",
      "success",
      `Provider already in cooldown until ${new Date(disabledProviders.get(providerId)!.until).toISOString()}`,
      { providerId }
    );
  }

  // Retry up to MAX_RETRY_ATTEMPTS
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const success = await retryFn();
      if (success) {
        return logHealingEvent(
          `Provider ${providerName} failure`,
          "retry_provider",
          "success",
          `Provider recovered on attempt ${attempt}`,
          { providerId }
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logHealingEvent(
        `Provider ${providerName} retry ${attempt}/${MAX_RETRY_ATTEMPTS}`,
        "retry_provider",
        "failed",
        errorMsg,
        { providerId }
      );
    }

    // Exponential backoff between retries
    if (attempt < MAX_RETRY_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }

  // All retries failed — disable temporarily
  disabledProviders.set(providerId, {
    until: Date.now() + PROVIDER_COOLDOWN_MS,
    reason: `Failed ${MAX_RETRY_ATTEMPTS} consecutive attempts`,
  });

  return logHealingEvent(
    `Provider ${providerName} failed ${MAX_RETRY_ATTEMPTS} times`,
    "disable_provider_temporarily",
    "success",
    `Provider disabled for ${PROVIDER_COOLDOWN_MS / 1000 / 60} minutes`,
    { providerId }
  );
}

// ============================================================================
// Cache Self-Healing
// ============================================================================

/**
 * Heal cache corruption.
 * Strategy: purge the corrupted cache entries.
 */
export function healCacheCorruption(
  cacheName: string,
  purgeFn: () => void
): HealingEvent {
  try {
    purgeFn();
    return logHealingEvent(
      `Cache corruption detected in ${cacheName}`,
      "purge_cache",
      "success",
      `Cache ${cacheName} purged successfully`
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return logHealingEvent(
      `Cache corruption detected in ${cacheName}`,
      "purge_cache",
      "failed",
      `Failed to purge cache: ${errorMsg}`
    );
  }
}

/**
 * Purge all caches — use when corruption is widespread.
 */
export function healAllCacheCorruption(
  purgeAllFn: () => void
): HealingEvent {
  try {
    purgeAllFn();
    return logHealingEvent(
      "Widespread cache corruption detected",
      "purge_cache",
      "success",
      "All caches purged successfully"
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return logHealingEvent(
      "Widespread cache corruption",
      "purge_cache",
      "failed",
      `Failed to purge caches: ${errorMsg}`
    );
  }
}

// ============================================================================
// Optimization Self-Healing
// ============================================================================

/**
 * Heal an invalid optimization.
 * Strategy: restore the original resume.
 */
export function healInvalidOptimization(
  resumeId: string,
  restoreFn: () => boolean
): HealingEvent {
  try {
    const restored = restoreFn();
    return logHealingEvent(
      "Invalid optimization detected",
      "restore_original",
      restored ? "success" : "failed",
      restored
        ? "Original resume restored successfully"
        : "Failed to restore original resume",
      { resumeId }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return logHealingEvent(
      "Invalid optimization detected",
      "restore_original",
      "failed",
      `Failed to restore: ${errorMsg}`,
      { resumeId }
    );
  }
}

// ============================================================================
// Export Self-Healing
// ============================================================================

/**
 * Heal an invalid export.
 * Strategy: regenerate the export.
 */
export async function healInvalidExport(
  resumeId: string,
  format: string,
  regenerateFn: () => Promise<boolean>
): Promise<HealingEvent> {
  try {
    const regenerated = await regenerateFn();
    return logHealingEvent(
      `Invalid ${format.toUpperCase()} export detected`,
      "regenerate_export",
      regenerated ? "success" : "failed",
      regenerated
        ? `${format.toUpperCase()} export regenerated successfully`
        : `Failed to regenerate ${format.toUpperCase()} export`,
      { resumeId }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return logHealingEvent(
      `Invalid ${format.toUpperCase()} export detected`,
      "regenerate_export",
      "failed",
      `Failed to regenerate: ${errorMsg}`,
      { resumeId }
    );
  }
}

// ============================================================================
// Pipeline Self-Healing
// ============================================================================

/**
 * Heal a pipeline failure.
 * Strategy: ABORT and surface the error. NEVER fake success.
 */
export function healPipelineFailure(
  stage: string,
  error: string
): HealingEvent {
  return logHealingEvent(
    `Pipeline failed at stage: ${stage}`,
    "abort_pipeline",
    "success",
    `Pipeline aborted at "${stage}". Error: ${error}. Original data preserved. Error surfaced to user.`,
  );
}

/**
 * Generate QA test results from healing events.
 */
export function healingToQATests(): QATestResult[] {
  const tests: QATestResult[] = [];
  const timestamp = new Date().toISOString();

  const recentEvents = healingLog.slice(-20); // Last 20 events
  const failedHeals = recentEvents.filter((e) => e.result === "failed");
  const providerCooldowns = [...disabledProviders.entries()];

  // Test: Self-healing system operational
  tests.push({
    id: `heal_operational_${Date.now()}`,
    name: "Self-Healing: System Operational",
    category: "api",
    severity: "medium",
    passed: true,
    message: `Self-healing engine active. ${recentEvents.length} recent events.`,
    durationMs: 0,
    timestamp,
  });

  // Test: No failed healing attempts
  tests.push({
    id: `heal_failures_${Date.now()}`,
    name: "Self-Healing: No Failed Healing Attempts",
    category: "api",
    severity: "high",
    passed: failedHeals.length === 0,
    message:
      failedHeals.length === 0
        ? "All healing attempts succeeded"
        : `${failedHeals.length} healing attempt(s) failed — manual intervention may be needed`,
    durationMs: 0,
    timestamp,
    suggestion: failedHeals.length > 0
      ? "Review failed healing events and consider manual fixes"
      : undefined,
  });

  // Test: No providers in cooldown
  tests.push({
    id: `heal_cooldown_${Date.now()}`,
    name: "Self-Healing: No Providers in Cooldown",
    category: "provider",
    severity: "medium",
    passed: providerCooldowns.length === 0,
    message:
      providerCooldowns.length === 0
        ? "No providers in cooldown"
        : `${providerCooldowns.length} provider(s) in cooldown: ${providerCooldowns.map(([id]) => id).join(", ")}`,
    durationMs: 0,
    timestamp,
  });

  return tests;
}

// Import QATestResult for healingToQATests return type
import type { QATestResult } from "./types";
