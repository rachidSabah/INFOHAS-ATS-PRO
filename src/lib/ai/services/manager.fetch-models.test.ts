/**
 * Task 29b — CLI providers must never hit the REST model proxy.
 *
 * User report (2026-08-31): clicking "Fetch models" for Antigravity CLI on
 * AI Routing Settings shows "baseUrl is required" (HTTP 400 from
 * /api/providers/models). A CLI integration legitimately has NO Base URL
 * ("N/A" per Task 29) — model discovery must run through the CLI runtime
 * (adapter.listModels) with the provider's synced catalog as offline
 * fallback. Ownership rule: discovered models belong to the CLI provider,
 * never to the Google Gemini API provider, regardless of model-id family.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type FetchLike = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
const fetchSpy = vi.fn<FetchLike>(async () => {
  throw new Error("EDGE MODEL PROXY MUST NOT BE CALLED for CLI providers");
});
vi.stubGlobal("fetch", fetchSpy);

const listModelsMock = vi.fn<() => Promise<string[]>>();
const antigravityProviderMock = { listModels: listModelsMock };
vi.mock("../../providers/antigravity-provider", () => ({
  getAntigravityProvider: () => antigravityProviderMock,
}));

import { ProviderManager } from "./manager";
import type { AIProvider } from "../../types";

function cliProvider(over: Partial<AIProvider> = {}): AIProvider {
  return {
    id: "p_antigravity",
    name: "Antigravity CLI",
    type: "antigravity",
    integrationType: "cli",
    baseUrl: "",
    modelName: "gemini-3.7-flash",
    enabledModels: ["gemini-3.7-flash", "gemini-2.5-pro"],
    ...over,
  } as AIProvider;
}

describe("ProviderManager.fetchModels — CLI integrations (Task 29b)", () => {
  beforeEach(() => {
    fetchSpy.mockClear();
    listModelsMock.mockReset();
  });

  it("discovers models through the CLI integration and never calls the REST model proxy", async () => {
    listModelsMock.mockResolvedValue(["claude-sonnet-4", "gpt-4.1"]);
    const res = await ProviderManager.fetchModels(cliProvider({ enabledModels: [] }));
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(["claude-sonnet-4", "gpt-4.1"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the stored synced catalog when the CLI session is unavailable", async () => {
    listModelsMock.mockRejectedValue(new Error("Antigravity not authenticated"));
    const res = await ProviderManager.fetchModels(cliProvider());
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(["gemini-3.7-flash", "gemini-2.5-pro"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a truthful CLI error (no baseUrl wording) when nothing is available", async () => {
    listModelsMock.mockRejectedValue(new Error("Antigravity not authenticated"));
    const res = await ProviderManager.fetchModels(cliProvider({ enabledModels: [] }));
    expect(res.ok).toBe(false);
    expect(res.error || "").not.toMatch(/baseUrl is required/i);
    expect(res.error || "").toMatch(/CLI/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats legacy antigravity records (no integrationType) as CLI by type", async () => {
    listModelsMock.mockResolvedValue(["gemini-2.5-flash"]);
    const legacy = cliProvider({ integrationType: undefined } as Partial<AIProvider>);
    const res = await ProviderManager.fetchModels(legacy);
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(["gemini-2.5-flash"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps API providers on the REST model proxy (no behavior change)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ models: ["x-model"] }), { status: 200 }),
    );
    const api = cliProvider({
      id: "p_custom",
      type: "custom",
      integrationType: "api",
      baseUrl: "https://api.mistral.ai/v1",
      enabledModels: [],
    } as Partial<AIProvider>);
    const res = await ProviderManager.fetchModels(api);
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(["x-model"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/providers/models");
  });
});
