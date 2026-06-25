import { describe, it, expect } from "vitest";
import { findSeedProvider, mergeProviderWithSeed, syncProviderConfigs } from "./provider-sync";
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
        apiKey: "user-configured-key",
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
});
