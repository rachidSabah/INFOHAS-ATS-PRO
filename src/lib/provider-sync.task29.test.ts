/**
 * Task 29 — provider identity separation: Antigravity CLI vs Google Gemini API.
 *
 * Spec (2026-08-31 user report): provider ownership must never be inferred
 * from NAMES. provider-sync's findSeedProvider() matched D1 records by
 * name-substring ("google"/"gemini" → p_google_gemini seed) and
 * mergeProviderWithSeed() force-restored seed base URLs onto empty fields.
 * For a CLI integration that is wrong twice over:
 *  1. A CLI provider must only ever match its seed by ID — name matching can
 *     pull Google API identity (baseUrl, models) into the CLI record.
 *  2. A CLI provider legitimately has NO REST Base URL ("N/A" per spec) —
 *     the sync must never force one back onto it.
 */

import { describe, it, expect } from "vitest";
import { findSeedProvider, mergeProviderWithSeed } from "./provider-sync";
import { SEED_PROVIDERS } from "./mock-data";
import type { AIProvider } from "./types";

// Debug-simplification pass: the Antigravity seed was REMOVED from the runtime
// SEED_PROVIDERS registry (the integration kept failing over in production).
// The identity-separation contracts below are still about findSeedProvider /
// mergeProviderWithSeed behavior, so the tests run against a local fixture
// that replicates the exact seed shape the CLI integration used to have.
const ANTIGRAVITY_SEED_FIXTURE: AIProvider = {
  id: "p_antigravity",
  name: "Antigravity CLI",
  type: "antigravity",
  integrationType: "cli",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://cloudcode-pa.googleapis.com",
  baseUrl: "https://cloudcode-pa.googleapis.com",
  apiKey: "",
  priority: 3,
  isActive: false,
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  timeout: 30000,
  maxTokens: 4096,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 60,
  modelName: "claude-sonnet-4",
  enabledModels: ["claude-sonnet-4", "gpt-4.1", "deepseek-v4", "gemini-2.5-pro"],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "untested",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
} as unknown as AIProvider;

const TEST_SEEDS: AIProvider[] = [ANTIGRAVITY_SEED_FIXTURE, ...SEED_PROVIDERS];

const CLI_RECORD = {
  id: "p_antigravity",
  name: "Antigravity CLI",
  type: "antigravity",
  integrationType: "cli" as const,
  baseUrl: "",
  apiUrl: "",
  enabledModels: ["gemini-1.5-flash", "claude-3-opus"], // synced via CLI — Google-family names, CLI ownership
  modelName: "claude-sonnet-4",
} as unknown as AIProvider;

describe("Task 29: findSeedProvider — CLI identity is immune to name matching", () => {
  it("CLI record with its exact seed id matches by ID (normal path)", () => {
    const seed = findSeedProvider(CLI_RECORD, TEST_SEEDS);
    expect(seed?.id).toBe("p_antigravity");
  });

  it("CLI record with a DIFFERENT id must NOT match any seed — not even by name", () => {
    const renamed = { ...CLI_RECORD, id: "user_custom_antigravity" };
    expect(findSeedProvider(renamed, TEST_SEEDS)).toBeUndefined();
  });

  it("an antigravity-TYPED record without integrationType is still treated as CLI", () => {
    const legacy = { ...CLI_RECORD, id: "legacy_antigravity", integrationType: undefined } as unknown as AIProvider;
    expect(findSeedProvider(legacy, TEST_SEEDS)).toBeUndefined();
  });

  it("API providers keep name matching (regression): 'Google Gemini API' flex-matches the p_gemini seed", () => {
    const googleNamed = {
      id: "d1_custom_google",
      name: "Google Gemini API",
      type: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    } as unknown as AIProvider;
    const seed = findSeedProvider(googleNamed, TEST_SEEDS);
    expect(seed?.id).toBe("p_gemini");
  });

  it("API providers keep the keyword mapping (regression): 'Google API' (no seed-name substring) → p_google_gemini", () => {
    const googleNamed = {
      id: "d1_custom_gapi",
      name: "Google API",
      type: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    } as unknown as AIProvider;
    const seed = findSeedProvider(googleNamed, TEST_SEEDS);
    expect(seed?.id).toBe("p_google_gemini");
  });
});

describe("Task 29: mergeProviderWithSeed — never force a Base URL onto a CLI integration", () => {
  it("CLI record with empty baseUrl stays empty after merge (Base URL = N/A)", () => {
    const seed = findSeedProvider(CLI_RECORD, TEST_SEEDS);
    const merged = mergeProviderWithSeed(CLI_RECORD, seed);
    expect(merged.baseUrl?.trim() ?? "").toBe("");
    expect(merged.apiUrl?.trim() ?? "").toBe("");
  });

  it("CLI record keeps its synced models — seed models are NOT unioned in", () => {
    const seed = findSeedProvider(CLI_RECORD, TEST_SEEDS);
    const merged = mergeProviderWithSeed(CLI_RECORD, seed);
    // The seed's static enabledModels must not be injected into the CLI
    // record: model ownership stays exactly what the CLI integration synced
    // (the provider's own configured modelName may be unioned for router
    // rotation — that is this provider's own selection, not seed data).
    for (const synced of ["gemini-1.5-flash", "claude-3-opus"]) {
      expect(merged.enabledModels).toContain(synced);
    }
    // Seed-only models must NOT appear:
    for (const seedOnly of ["gpt-4.1", "deepseek-v4"]) {
      expect(merged.enabledModels).not.toContain(seedOnly);
    }
  });

  it("API record with empty baseUrl still gets the seed URL restored (regression)", () => {
    const apiRecord = {
      id: "p_google_gemini",
      name: "Google AI Studio (Gemini)",
      type: "gemini",
      baseUrl: "",
      apiUrl: "",
      modelName: "gemini-2.5-flash",
    } as unknown as AIProvider;
    const seed = findSeedProvider(apiRecord, TEST_SEEDS);
    expect(seed).toBeDefined();
    const merged = mergeProviderWithSeed(apiRecord, seed!);
    expect(merged.baseUrl).toContain("generativelanguage.googleapis.com");
  });
});
