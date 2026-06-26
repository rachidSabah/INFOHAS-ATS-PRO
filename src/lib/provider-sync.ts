// ============================================================================
// Provider Synchronization Module
//
// Ensures D1 provider configurations stay in sync with seed defaults.
// D1 remains the source of truth, but seed data is used to:
//   - Backfill missing providers
//   - Repair corrupted providers (empty keys, invalid models)
//   - Detect configuration drift
//
// Called:
//   - On startup (after syncAllFromCloud)
//   - After migrations
//   - After adding/updating a provider
//   - After importing settings
// ============================================================================

"use client";

import { SEED_PROVIDERS } from "./mock-data";
import type { AIProvider } from "./types";

export interface ProviderSyncResult {
  synced: number;
  repaired: number;
  backfilled: number;
  driftDetected: boolean;
  driftDetails: string[];
}

/**
 * Merge a D1-stored provider with its seed default.
 *
 * Rules:
 *   - If D1 provider has empty API key → restore from seed (env var)
 *   - If D1 provider has empty base URL → restore from seed
 *   - If D1 model is NOT in seed's enabledModels → use seed default model
 *   - If D1 timeout/maxTokens are 0 or invalid → restore from seed
 *   - NEVER overwrite: encryptedApiKey, tokens, credentials (admin config)
 *
 * @returns The merged provider, or the original if no seed match.
 */
export function mergeProviderWithSeed(d1Provider: AIProvider, seedProvider?: AIProvider): AIProvider {
  if (!seedProvider) return d1Provider; // truly custom provider — keep as-is

  const merged = { ...d1Provider };

  // Restore API key from seed if D1 has empty/missing key
  if (!merged.apiKey || merged.apiKey.trim() === "" || merged.apiKey === "undefined" || merged.apiKey === "null") {
    merged.apiKey = seedProvider.apiKey || "";
  }

  // Restore base URL from seed if D1 has empty/missing URL
  if (!merged.apiUrl || merged.apiUrl.trim() === "") {
    merged.apiUrl = seedProvider.apiUrl || seedProvider.baseUrl || "";
  }
  if (!merged.baseUrl || merged.baseUrl.trim() === "") {
    merged.baseUrl = seedProvider.baseUrl || seedProvider.apiUrl || "";
  }

  // Update enabledModels: union the D1 models and the seed models to ensure the seed's defaults are always available
  const seedModels = seedProvider.enabledModels || [];
  const currentModels = merged.enabledModels || [];
  const mergedModels = Array.from(new Set([...seedModels, ...currentModels]));
  if (mergedModels.length > currentModels.length || !merged.enabledModels) {
    merged.enabledModels = mergedModels;
  }

  // Fix model name: if the D1 model is not in the seed's enabledModels,
  // use the seed's default model (which is known to work)
  const enabledModels = seedProvider.enabledModels || [];
  if (merged.modelName && enabledModels.length > 0 && !enabledModels.includes(merged.modelName)) {
    console.warn(
      `[PROVIDER SYNC] Provider "${merged.name}" has model "${merged.modelName}" ` +
      `which is not in enabledModels. Restoring to seed default "${seedProvider.modelName}".`
    );
    merged.modelName = seedProvider.modelName;
  }

  // If model name is empty, use seed default
  if (!merged.modelName || merged.modelName.trim() === "") {
    merged.modelName = seedProvider.modelName;
  }

  // Restore timeout/maxTokens from seed if D1 has 0 or invalid values
  if (!merged.timeout || typeof merged.timeout !== "number" || isNaN(merged.timeout) || merged.timeout < 1000) {
    merged.timeout = seedProvider.timeout;
  }
  if (!merged.maxTokens || typeof merged.maxTokens !== "number" || isNaN(merged.maxTokens) || merged.maxTokens < 100) {
    merged.maxTokens = seedProvider.maxTokens;
  }

  return merged;
}

/**
 * Find the seed provider that matches a D1 provider.
 * Matches by ID first, then by name (case-insensitive & flexible substring match).
 */
export function findSeedProvider(d1Provider: AIProvider, seedProviders: AIProvider[] = SEED_PROVIDERS): AIProvider | undefined {
  // Try ID match first
  let seed = seedProviders.find((p) => p.id === d1Provider.id);
  if (seed) return seed;

  // Try exact name match (case-insensitive, trimmed)
  const d1Name = (d1Provider.name || "").trim().toLowerCase();
  seed = seedProviders.find((p) => (p.name || "").trim().toLowerCase() === d1Name);
  if (seed) return seed;

  // Try flexible name match (starts with, ends with, contains, or word matching)
  seed = seedProviders.find((p) => {
    const sName = (p.name || "").trim().toLowerCase();
    return sName.includes(d1Name) || d1Name.includes(sName);
  });
  if (seed) return seed;

  // Hardcoded mappings for common provider names to their seed equivalents
  if (d1Name.includes("nvidia")) {
    return seedProviders.find((p) => p.id === "p_nvidia");
  }
  if (d1Name.includes("opencode")) {
    return seedProviders.find((p) => p.id === "p_opencode");
  }
  if (d1Name.includes("google") || d1Name.includes("gemini")) {
    return seedProviders.find((p) => p.id === "p_google_gemini");
  }
  if (d1Name.includes("openrouter")) {
    return seedProviders.find((p) => p.id === "p_openrouter");
  }
  if (d1Name.includes("mistral")) {
    return seedProviders.find((p) => p.id === "p_mistral");
  }

  return undefined;
}

/**
 * Detect configuration drift between D1 providers and seed defaults.
 *
 * Drift is detected when:
 *   - A seed provider is missing from D1 (needs backfill)
 *   - A D1 provider has an empty API key but the seed has one
 *   - A D1 provider has a model name not in the seed's enabledModels
 *
 * @returns Drift details array (empty if no drift)
 */
export function detectProviderDrift(
  d1Providers: AIProvider[],
  seedProviders: AIProvider[] = SEED_PROVIDERS,
): string[] {
  const drift: string[] = [];

  // Check for missing seed providers (need backfill)
  for (const seed of seedProviders) {
    const exists = d1Providers.some(
      (p) => p.id === seed.id || p.name.toLowerCase() === seed.name.toLowerCase()
    );
    if (!exists && seed.isActive) {
      drift.push(`Missing provider: ${seed.name} (${seed.id}) — needs backfill`);
    }
  }

  // Check for corrupted D1 providers
  for (const d1 of d1Providers) {
    const seed = findSeedProvider(d1, seedProviders);
    if (!seed) continue; // custom provider, skip

    // Empty API key
    if ((!d1.apiKey || d1.apiKey.trim() === "") && seed.apiKey) {
      drift.push(`${d1.name}: API key is empty (seed has one)`);
    }

    // Invalid model
    const enabledModels = seed.enabledModels || [];
    if (d1.modelName && enabledModels.length > 0 && !enabledModels.includes(d1.modelName)) {
      drift.push(`${d1.name}: model "${d1.modelName}" not in enabledModels`);
    }
  }

  return drift;
}

/**
 * Synchronize provider configurations between D1 and seed defaults.
 *
 * This is the main entry point. It:
 *   1. Detects drift
 *   2. Merges D1 providers with seed defaults (repairing empty keys, invalid models)
 *   3. Backfills missing seed providers
 *
 * @param d1Providers Providers loaded from D1
 * @returns Sync result with merged providers + drift details
 */
export function syncProviderConfigs(d1Providers: AIProvider[]): {
  providers: AIProvider[];
  result: ProviderSyncResult;
} {
  const driftDetails = detectProviderDrift(d1Providers);
  const driftDetected = driftDetails.length > 0;

  if (driftDetected) {
    console.warn("[PROVIDER SYNC] Database drift detected:");
    driftDetails.forEach((d) => console.warn(`  - ${d}`));
  }

  // Merge each D1 provider with its seed default
  let mergedProviders = d1Providers.map((p) => {
    const seed = findSeedProvider(p);
    if (!seed) return p;
    return mergeProviderWithSeed(p, seed);
  });

  let repaired = 0;
  for (let i = 0; i < d1Providers.length; i++) {
    if (JSON.stringify(d1Providers[i]) !== JSON.stringify(mergedProviders[i])) {
      repaired++;
    }
  }

  // Backfill missing seed providers
  const deletedIds: string[] = typeof window !== "undefined"
    ? (() => {
        try {
          return JSON.parse(localStorage.getItem("resumeai-deleted-providers") || "[]");
        } catch { return []; }
      })()
    : [];

  const existingIds = new Set(mergedProviders.map((p) => p.id));
  const existingNames = new Set(mergedProviders.map((p) => p.name.toLowerCase()));
  const backfilled: AIProvider[] = [];
  for (const seed of SEED_PROVIDERS) {
    if (deletedIds.includes(seed.id)) {
      continue; // Skip explicitly deleted provider
    }
    if (!existingIds.has(seed.id) && !existingNames.has(seed.name.toLowerCase())) {
      if (seed.isActive) {
        console.info(`[PROVIDER SYNC] Backfilling missing provider: ${seed.name}`);
        backfilled.push(seed);
      }
    }
  }
  mergedProviders = [...mergedProviders, ...backfilled];

  const result: ProviderSyncResult = {
    synced: mergedProviders.length,
    repaired,
    backfilled: backfilled.length,
    driftDetected,
    driftDetails,
  };

  console.info(
    `[PROVIDER SYNC] Sync complete: ${result.synced} providers, ` +
    `${result.repaired} repaired, ${result.backfilled} backfilled, ` +
    `drift=${driftDetected ? "detected" : "none"}.`
  );

  return { providers: mergedProviders, result };
}

// ============================================================================
// Provider State Validation & Hash (for drift detection)
// ============================================================================

/**
 * Calculate a hash of the providers array to detect changes.
 * Only syncs when the hash changes — prevents infinite loops.
 */
export function calculateProviderHash(providers: AIProvider[]): string {
  const parts = providers
    .map((p) => `${p.id}|${p.modelName || ""}|${(p.apiKey || "").slice(0, 8)}|${p.isActive ? 1 : 0}`)
    .sort()
    .join("||");
  let hash = 0;
  for (let i = 0; i < parts.length; i++) {
    const char = parts.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return String(hash);
}

/**
 * Validate that provider state is consistent (no drift, no empty keys on active providers).
 * Returns a list of issues found (empty = healthy).
 */
export function validateProviderState(providers: AIProvider[]): string[] {
  const issues: string[] = [];

  for (const p of providers) {
    if (!p.isActive) continue; // skip inactive providers

    // Check for empty API key on active provider
    if (!p.apiKey || p.apiKey.trim() === "") {
      // Only flag if the provider type requires a key (not Puter)
      if (p.type !== "puter") {
        issues.push(`${p.name}: active but API key is empty`);
      }
    }

    // Check for empty model name
    if (!p.modelName || p.modelName.trim() === "") {
      issues.push(`${p.name}: model name is empty`);
    }

    // Check for empty base URL
    if (!p.baseUrl || p.baseUrl.trim() === "") {
      if (p.type !== "puter") {
        issues.push(`${p.name}: base URL is empty`);
      }
    }

    // Check for invalid timeout
    if (!p.timeout || p.timeout < 5000) {
      issues.push(`${p.name}: timeout is ${p.timeout || 0}ms (minimum 5000)`);
    }
  }

  return issues;
}

/**
 * Reconcile provider state — returns the corrected providers + list of fixes applied.
 * Idempotent: running twice produces the same result.
 */
export function reconcileProviderState(providers: AIProvider[]): {
  providers: AIProvider[];
  fixes: string[];
} {
  const fixes: string[] = [];
  const result = providers.map((p) => {
    const patched = { ...p };

    // Fix empty model name using seed
    if (!patched.modelName || patched.modelName.trim() === "") {
      const seed = findSeedProvider(patched);
      if (seed?.modelName) {
        patched.modelName = seed.modelName;
        fixes.push(`${p.name}: restored model name to "${seed.modelName}"`);
      }
    }

    // Fix empty base URL using seed
    if (!patched.baseUrl || patched.baseUrl.trim() === "") {
      const seed = findSeedProvider(patched);
      if (seed?.baseUrl) {
        patched.baseUrl = seed.baseUrl;
        patched.apiUrl = seed.apiUrl || seed.baseUrl;
        fixes.push(`${p.name}: restored base URL to "${seed.baseUrl}"`);
      }
    }

    // Fix low timeout
    if (!patched.timeout || patched.timeout < 5000) {
      const seed = findSeedProvider(patched);
      if (seed?.timeout) {
        patched.timeout = seed.timeout;
        fixes.push(`${p.name}: restored timeout to ${seed.timeout}ms`);
      }
    }

    return patched;
  });

  return { providers: result, fixes };
}
