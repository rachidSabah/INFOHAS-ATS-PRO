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
  const existingIds = new Set(mergedProviders.map((p) => p.id));
  const existingNames = new Set(mergedProviders.map((p) => p.name.toLowerCase()));
  const backfilled: AIProvider[] = [];
  for (const seed of SEED_PROVIDERS) {
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
