import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProviderManager } from "../ai/services/manager";
import type { AIProvider } from "../types";

describe("API Key Rotation and Prefetching Fallbacks", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should failover to alternate keys in fetchModelsForConfig when primary key gets 429", async () => {
    const config: Partial<AIProvider> = {
      type: "opencode",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "primary-key-429",
      alternateApiKeys: ["alt-key-1-working"],
      authType: "bearer",
    };

    const mockFetch = vi.fn()
      .mockImplementationOnce(async (url, init) => {
        const body = JSON.parse(init.body);
        expect(body.apiKey).toBe("primary-key-429");
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: "Rate limit exceeded" }),
        } as any;
      })
      .mockImplementationOnce(async (url, init) => {
        const body = JSON.parse(init.body);
        expect(body.apiKey).toBe("alt-key-1-working");
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: ["model-a", "model-b"] }),
        } as any;
      });

    global.fetch = mockFetch;

    const result = await ProviderManager.fetchModelsForConfig(config);
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(["model-a", "model-b"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
