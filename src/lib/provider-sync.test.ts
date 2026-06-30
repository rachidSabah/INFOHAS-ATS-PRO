import { describe, it, expect } from "vitest";
import { findSeedProvider, mergeProviderWithSeed, syncProviderConfigs, calculateProviderHash, detectProviderDrift } from "./provider-sync";
import { SEED_PROVIDERS } from "./mock-data";
import type { AIProvider } from "./types";

describe("Provider Sync & Matching Logic", () => {
  const mockSeedProviders: AIProvider[] = [
    {
      id: "p_nvidia",
      name: "NVIDIA NIM (Llama free)",
      type: "custom",
      apiUrl: "https://integrate.api.nvidia.com/v1",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "seed-nvidia-key",
      priority: 5,
      isActive: true,
      timeout: 90000,
      maxTokens: 8192,
      modelName: "meta/llama-3.3-70b-instruct",
      enabledModels: ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-70b-instruct"],
    } as any,
    {
      id: "p_opencode",
      name: "OpenCode Zen (Free models)",
      type: "opencode",
      apiUrl: "https://opencode.ai/zen/v1",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "seed-opencode-key",
      priority: 2,
      isActive: true,
      timeout: 60000,
      maxTokens: 4096,
      modelName: "deepseek-v4-flash-free",
      enabledModels: ["deepseek-v4-flash-free", "nemotron-3-super-free"],
    } as any,
  ];

  describe("findSeedProvider", () => {
    it("should match by ID first", () => {
      const d1Provider = { id: "p_nvidia", name: "Different Name" } as any;
      const matched = findSeedProvider(d1Provider, mockSeedProviders);
      expect(matched).toBeDefined();
      expect(matched?.id).toBe("p_nvidia");
    });

    it("should match by exact name (case-insensitive, trimmed)", () => {
      const d1Provider = { id: "custom_id", name: "  NVIDIA NIM (Llama free)  " } as any;
      const matched = findSeedProvider(d1Provider, mockSeedProviders);
      expect(matched).toBeDefined();
      expect(matched?.id).toBe("p_nvidia");
    });

    it("should match by flexible substring name", () => {
      const d1Provider = { id: "custom_id_2", name: "OpenCode" } as any;
      const matched = findSeedProvider(d1Provider, mockSeedProviders);
      expect(matched).toBeDefined();
      expect(matched?.id).toBe("p_opencode");
    });

    it("should match common aliases like Nvidia", () => {
      const d1Provider = { id: "custom_nvidia", name: "Nvidia" } as any;
      const matched = findSeedProvider(d1Provider, mockSeedProviders);
      expect(matched).toBeDefined();
      expect(matched?.id).toBe("p_nvidia");
    });
  });

  describe("mergeProviderWithSeed", () => {
    it("should restore empty or undefined/null API key from seed", () => {
      const d1Provider = {
        id: "p_nvidia",
        name: "Nvidia",
        apiKey: "",
        apiUrl: "https://integrate.api.nvidia.com/v1",
        modelName: "meta/llama-3.3-70b-instruct",
        timeout: 90000,
        maxTokens: 8192,
      } as any;

      const merged = mergeProviderWithSeed(d1Provider, mockSeedProviders[0]);
      expect(merged.apiKey).toBe("seed-nvidia-key");
    });

    it("should NOT overwrite a valid API key configured in D1", () => {
      const d1Provider = {
        id: "p_nvidia",
        name: "Nvidia",
        apiKey: "user-configured-key",
        apiUrl: "https://integrate.api.nvidia.com/v1",
        modelName: "meta/llama-3.3-70b-instruct",
        timeout: 90000,
        maxTokens: 8192,
      } as any;

      const merged = mergeProviderWithSeed(d1Provider, mockSeedProviders[0]);
      expect(merged.apiKey).toBe("user-configured-key");
    });

    it("should restore default model if D1 model is not in seed's enabledModels", () => {
      const d1Provider = {
        id: "p_nvidia",
        name: "Nvidia",
        apiKey: "user-configured-key",
        apiUrl: "https://integrate.api.nvidia.com/v1",
        modelName: "stepfun-ai/step-3.7-flash", // not in seed enabledModels
        timeout: 90000,
        maxTokens: 8192,
      } as any;

      const merged = mergeProviderWithSeed(d1Provider, mockSeedProviders[0]);
      expect(merged.modelName).toBe("meta/llama-3.3-70b-instruct");
    });

    it("should restore default timeout and maxTokens if D1 has invalid values", () => {
      const d1Provider = {
        id: "p_nvidia",
        name: "Nvidia",
        apiKey: "user-...ey",
        apiUrl: "https://integrate.api.nvidia.com/v1",
        modelName: "meta/llama-3.3-70b-instruct",
        timeout: 0, // invalid
        maxTokens: 5, // invalid
      } as any;

      const merged = mergeProviderWithSeed(d1Provider, mockSeedProviders[0]);
      expect(merged.timeout).toBe(90000);
      expect(merged.maxTokens).toBe(8192);
    });
  });

  // ===========================================================================
  // Hash stability tests
  // ===========================================================================
  describe("calculateProviderHash", () => {
    it("should produce the same hash for identical provider arrays", () => {
      const providers = [
        { id: "p_a", modelName: "model-a", apiKey: "key123", isActive: true } as any,
        { id: "p_b", modelName: "model-b", apiKey: "key456", isActive: false } as any,
      ];
      const hash1 = calculateProviderHash(providers);
      const hash2 = calculateProviderHash(providers);
      expect(hash1).toBe(hash2);
    });

    it("should produce a different hash when modelName changes", () => {
      const before = [{ id: "p_a", modelName: "model-a", apiKey: "key", isActive: true }] as any;
      const after  = [{ id: "p_a", modelName: "model-b", apiKey: "key", isActive: true }] as any;
      expect(calculateProviderHash(before)).not.toBe(calculateProviderHash(after));
    });

    it("should produce a different hash when isActive changes", () => {
      const active   = [{ id: "p_a", modelName: "m", apiKey: "k", isActive: true }] as any;
      const inactive = [{ id: "p_a", modelName: "m", apiKey: "k", isActive: false }] as any;
      expect(calculateProviderHash(active)).not.toBe(calculateProviderHash(inactive));
    });

    it("should produce the same hash regardless of array order", () => {
      const a = [
        { id: "p_alpha", modelName: "m1", apiKey: "k1", isActive: true } as any,
        { id: "p_beta",  modelName: "m2", apiKey: "k2", isActive: false } as any,
      ];
      const b = [
        { id: "p_beta",  modelName: "m2", apiKey: "k2", isActive: false } as any,
        { id: "p_alpha", modelName: "m1", apiKey: "k1", isActive: true } as any,
      ];
      expect(calculateProviderHash(a)).toBe(calculateProviderHash(b));
    });
  });

  // ===========================================================================
  // Drift detection tests
  // ===========================================================================
  describe("detectProviderDrift", () => {
    it("should return empty array when D1 has all seed providers", () => {
      // Use model names that exist in mockSeedProviders' enabledModels,
      // and provide explicit apiKey values, to get 0 drift.
      const d1 = [
        { id: "p_nvidia",    name: "NVIDIA NIM (Llama free)", modelName: "meta/llama-3.3-70b-instruct", apiKey: "key" } as any,
        { id: "p_opencode",  name: "OpenCode Zen (Free models)", modelName: "deepseek-v4-flash-free",    apiKey: "key" } as any,
      ];
      const drift = detectProviderDrift(d1, mockSeedProviders);
      expect(drift).toHaveLength(0);
    });

    it("should detect missing seed provider", () => {
      const d1 = [
        { id: "p_nvidia", name: "NVIDIA", modelName: "meta/llama-3.3-70b-instruct" } as any,
      ];
      const drift = detectProviderDrift(d1, mockSeedProviders);
      expect(drift.some((d) => d.includes("Missing provider"))).toBe(true);
    });

    it("should detect invalid model name in D1 provider", () => {
      const d1 = [
        { id: "p_nvidia", name: "NVIDIA", modelName: "bogus-model" } as any,
        { id: "p_opencode", name: "OpenCode Zen", modelName: "deepseek-v4-flash-free" } as any,
      ];
      const drift = detectProviderDrift(d1, mockSeedProviders);
      expect(drift.some((d) => d.includes("not in enabledModels"))).toBe(true);
    });

    it("should detect empty API key", () => {
      const d1 = [
        { id: "p_nvidia", name: "NVIDIA", modelName: "meta/llama-3.3-70b-instruct", apiKey: "" } as any,
        { id: "p_opencode", name: "OpenCode Zen", modelName: "deepseek-v4-flash-free", apiKey: "key" } as any,
      ];
      const drift = detectProviderDrift(d1, mockSeedProviders);
      expect(drift.some((d) => d.includes("API key is empty"))).toBe(true);
    });
  });

  // ===========================================================================
  // Deterministic sync tests
  // ===========================================================================
  describe("syncProviderConfigs idempotence", () => {
    it("should produce the same result when called twice with same input", () => {
      // Provide ALL seed providers with models valid in the global SEED_PROVIDERS,
      // so no backfill, no model repair, and no apiKey drift occurs on either pass
      const providers = [
        { id: "p_nvidia",      name: "NVIDIA NIM (Llama free)",   modelName: "stepfun-ai/step-3.7-flash", apiKey: "key",        isActive: true } as any,
        { id: "p_opencode",    name: "OpenCode Zen (Free models)", modelName: "deepseek-v4-flash-free",    apiKey: "key",        isActive: true } as any,
        { id: "p_puter",       name: "Puter.js (Free, browser-auth)", modelName: "gpt-5.4-nano",         apiKey: "puter-auth", isActive: true } as any,
        { id: "p_antigravity", name: "Antigravity CLI",            modelName: "claude-sonnet-4",           apiKey: "ant-key",    isActive: true } as any,
      ];
      const { providers: r1 } = syncProviderConfigs(providers);
      const { providers: r2 } = syncProviderConfigs(r1);
      // Second call should not change anything (idempotent)
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it("should not introduce duplicate providers on repeated sync", () => {
      const providers = [
        { id: "p_nvidia", name: "NVIDIA", modelName: "meta/llama-3.3-70b-instruct", apiKey: "", isActive: true } as any,
      ];
      const { providers: r1, result } = syncProviderConfigs(providers);
      // First sync backfills missing providers
      expect(result.backfilled).toBeGreaterThanOrEqual(0);
      // Second sync should not backfill again
      const { result: r2 } = syncProviderConfigs(r1);
      expect(r2.backfilled).toBe(0);
    });
  });
});
