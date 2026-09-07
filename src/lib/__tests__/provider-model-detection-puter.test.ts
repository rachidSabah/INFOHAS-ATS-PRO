// ============================================================================
// Task 18 — fetchProviderModels puter branch.
//
// Regression: the AI Workspace / AI Dev Agent model pickers use
// fetchProviderModels (provider-model-detection.ts), which had NO puter
// branch. Puter is browser-auth with no REST {baseUrl}/models surface, so
// the generic probe fell straight back to the provider's configured model —
// the user saw a single static option "gpt-4o-mini" instead of Task 13's
// live catalog (~900 models, curated first).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchPuterModelsLive = vi.fn(
  async (): Promise<{ ok: boolean; models: string[]; error?: string }> => ({ ok: true, models: [] })
);

vi.mock("../ai/services/manager", () => ({
  ProviderManager: {
    fetchPuterModelsLive: (...args: unknown[]) => fetchPuterModelsLive(...(args as [])),
  },
}));

import { fetchProviderModels } from "../provider-model-detection";

const PUTER = {
  id: "p_puter",
  name: "Puter.js (Free, browser-auth)",
  type: "puter",
  modelName: "gpt-4o-mini",
  enabledModels: [],
} as any;

const LIVE = ["gpt-5-nano", "claude-sonnet-4-5", "deepseek-chat", "gpt-4o-mini"];

beforeEach(() => {
  fetchPuterModelsLive.mockClear();
  fetchPuterModelsLive.mockResolvedValue({ ok: true, models: [...LIVE] });
  vi.unstubAllGlobals();
});

describe("fetchProviderModels — puter live catalog (Task 18)", () => {
  it("REGRESSION: a puter provider returns the LIVE catalog (curated first), not the static configured model", async () => {
    const res = await fetchProviderModels(PUTER);
    expect(res.source).toBe("api");
    expect(res.error).toBeUndefined();
    expect(res.models.map((m) => m.id)).toEqual(LIVE);
    expect(res.models[0].id).toBe("gpt-5-nano"); // curated-first order preserved
    expect(res.models.every((m) => m.supportsStreaming)).toBe(true);
    expect(fetchPuterModelsLive).toHaveBeenCalledTimes(1);
  });

  it("degrades to the configured model when the live catalog is unavailable", async () => {
    fetchPuterModelsLive.mockResolvedValue({ ok: false, models: [], error: "offline" });
    const res = await fetchProviderModels(PUTER);
    expect(res.source).toBe("configured");
    expect(res.error).toBe("offline");
    expect(res.models.map((m) => m.id)).toEqual(["gpt-4o-mini"]);
  });

  it("degrades when the live catalog resolves empty", async () => {
    fetchPuterModelsLive.mockResolvedValue({ ok: true, models: [] });
    const res = await fetchProviderModels(PUTER);
    expect(res.source).toBe("configured");
    expect(res.models.map((m) => m.id)).toEqual(["gpt-4o-mini"]);
  });

  it("prefers enabledModels over modelName in the degraded path", async () => {
    fetchPuterModelsLive.mockResolvedValue({ ok: false, models: [] });
    const res = await fetchProviderModels({ ...PUTER, enabledModels: ["a", "b"] } as any);
    expect(res.models.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("fetchProviderModels — non-puter paths unchanged (regression guard)", () => {
  it("no baseUrl → configured fallback (never touches the puter branch)", async () => {
    const res = await fetchProviderModels({
      id: "p_x", name: "X", type: "deepseek", modelName: "deepseek-chat", enabledModels: [],
    } as any);
    expect(res.source).toBe("configured");
    expect(res.models.map((m) => m.id)).toEqual(["deepseek-chat"]);
    expect(fetchPuterModelsLive).not.toHaveBeenCalled();
  });

  it("with baseUrl → proxy /models path still works", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ models: ["m1", "m2"] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )));
    const res = await fetchProviderModels({
      id: "p_y", name: "Y", type: "mistral", baseUrl: "https://api.mistral.ai/v1", enabledModels: [],
    } as any);
    expect(res.source).toBe("api");
    expect(res.models.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(fetchPuterModelsLive).not.toHaveBeenCalled();
  });
});
