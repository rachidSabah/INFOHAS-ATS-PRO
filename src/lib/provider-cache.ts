// ============================================================================
// Provider Cache Recovery
//
// Repairs and rebuilds all provider-related caches:
//   providerCache, modelCache, enabledModelCache, sessionCache, tokenCache
//
// Called after provider sync, after provider updates, or manually.
// ============================================================================

"use client";

import { SEED_PROVIDERS } from "./mock-data";
import type { AIProvider } from "./types";

// In-memory caches
const providerCache = new Map<string, AIProvider>();
const modelCache = new Map<string, string[]>();
const enabledModelCache = new Map<string, string[]>();
const sessionCache = new Map<string, any>();
const tokenCache = new Map<string, string>();

let isRebuilding = false;

/**
 * Rebuild all provider caches from the current provider list.
 * Clears all caches first, then repopulates from providers + seed defaults.
 */
export function rebuildProviderCache(providers: AIProvider[]): void {
  if (isRebuilding) {
    console.info("[Cache Recovery] Already rebuilding — skipping");
    return;
  }

  isRebuilding = true;
  const startTime = Date.now();

  try {
    // Clear all caches
    providerCache.clear();
    modelCache.clear();
    enabledModelCache.clear();
    sessionCache.clear();
    tokenCache.clear();

    // Rebuild provider cache
    for (const p of providers) {
      providerCache.set(p.id, p);

      // Rebuild model cache
      if (p.enabledModels && p.enabledModels.length > 0) {
        modelCache.set(p.id, p.enabledModels);
        enabledModelCache.set(p.id, p.enabledModels);
      } else {
        // Fallback to seed models
        const seed = SEED_PROVIDERS.find((s) => s.id === p.id || s.name === p.name);
        if (seed?.enabledModels) {
          modelCache.set(p.id, seed.enabledModels);
          enabledModelCache.set(p.id, seed.enabledModels);
        }
      }

      // Rebuild token cache (API keys)
      if (p.apiKey) {
        tokenCache.set(p.id, p.apiKey);
      }
    }

    const duration = Date.now() - startTime;
    console.info(
      `[Cache Recovery] Rebuilt all caches in ${duration}ms — ` +
      `${providerCache.size} providers, ${modelCache.size} model lists, ` +
      `${tokenCache.size} tokens`
    );
  } finally {
    isRebuilding = false;
  }
}

/**
 * Get a provider from cache (or null if not cached).
 */
export function getCachedProvider(id: string): AIProvider | null {
  return providerCache.get(id) ?? null;
}

/**
 * Get cached models for a provider.
 */
export function getCachedModels(providerId: string): string[] {
  return modelCache.get(providerId) ?? [];
}

/**
 * Get cached enabled models for a provider.
 */
export function getCachedEnabledModels(providerId: string): string[] {
  return enabledModelCache.get(providerId) ?? [];
}

/**
 * Get cached API key for a provider.
 */
export function getCachedToken(providerId: string): string | null {
  return tokenCache.get(providerId) ?? null;
}

/**
 * Invalidate a specific provider's cache entry.
 */
export function invalidateProviderCacheEntry(providerId: string): void {
  providerCache.delete(providerId);
  modelCache.delete(providerId);
  enabledModelCache.delete(providerId);
  tokenCache.delete(providerId);
  console.info(`[Cache Recovery] Invalidated cache for provider ${providerId}`);
}

/**
 * Invalidate all caches (forces full rebuild on next access).
 */
export function invalidateAllCaches(): void {
  providerCache.clear();
  modelCache.clear();
  enabledModelCache.clear();
  sessionCache.clear();
  tokenCache.clear();
  console.info("[Cache Recovery] All caches invalidated");
}

/**
 * Get cache statistics for monitoring.
 */
export function getCacheStats(): {
  providers: number;
  models: number;
  enabledModels: number;
  sessions: number;
  tokens: number;
} {
  return {
    providers: providerCache.size,
    models: modelCache.size,
    enabledModels: enabledModelCache.size,
    sessions: sessionCache.size,
    tokens: tokenCache.size,
  };
}
