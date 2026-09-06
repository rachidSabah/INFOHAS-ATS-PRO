/**
 * Task 30 — ZaiWebSessionAdapter + provider-sync isolation tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../providers/antigravity-provider", () => ({
  getAntigravityProvider: () => ({ listModels: vi.fn(async () => []), isAuthenticated: () => false }),
}));

import { ProviderFactory } from "./factory";
import { ZAI_WEB_CHAT_CONTRACT, ZaiWebSessionAdapter } from "../providers/zai-web-adapter";
import {
  forgetZaiWebSession,
  recallZaiWebSession,
  rememberZaiWebSession,
} from "../../providers/zai-web/credential-store";
import { findSeedProvider, isWebSessionIntegration, mergeProviderWithSeed } from "../../provider-sync";
import { SEED_PROVIDERS } from "../../mock-data";
import type { AIProvider } from "../../types";

// Debug-simplification pass: the Z.ai Web seed was REMOVED from the runtime
// SEED_PROVIDERS registry (the web-session integration kept failing over in
// production). The provider-sync isolation contracts below still hold, so the
// tests run against a local fixture replicating the exact seed shape.
const ZAI_WEB_SEED_FIXTURE = {
  id: "p_zai_web",
  name: "Z.ai Web",
  type: "zai-web",
  integrationType: "web-session",
  baseUrl: "",
  enabledModels: [],
  modelName: "",
  isActive: false,
  isBuiltIn: false,
  timeout: 60000,
  apiKey: "",
} as unknown as AIProvider;

const TEST_SEEDS: AIProvider[] = [ZAI_WEB_SEED_FIXTURE, ...SEED_PROVIDERS];

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ6YWkifQ.signature-part-000000";

function zaiWebProvider(over: Partial<AIProvider> = {}): AIProvider {
  return {
    id: "p_zai_web",
    name: "Z.ai Web",
    type: "zai-web",
    integrationType: "web-session",
    baseUrl: "",
    enabledModels: [],
    modelName: "",
    timeout: 60000,
    apiKey: "",
    ...over,
  } as unknown as AIProvider;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(async () => {
  // Clear the module-level memory session between tests.
  await forgetZaiWebSession({ store: async () => ({ ok: true as const }), clear: async () => {} });
});

describe("ZaiWebSessionAdapter — factory registration", () => {
  it("routes provider type zai-web to the dedicated web-session adapter (never z-ai-fallback/custom)", () => {
    const adapter = ProviderFactory.get("zai-web");
    expect(adapter.type).toBe("zai-web");
    expect(adapter).not.toBe(ProviderFactory.get("custom"));
    expect(adapter).not.toBe(ProviderFactory.get("z-ai-fallback"));
  });
});

describe("ZaiWebSessionAdapter — auth semantics", () => {
  it("chat fails fast with an auth error when no session exists (never an OpenAI-shaped REST call)", async () => {
    const fetchSpy = vi.fn();
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy as unknown as typeof fetch);
    await expect(
      adapter.chat({ messages: [{ role: "user", content: "hi" }] } as any, {
        id: "p_zai_web", name: "Z.ai Web", type: "zai-web", modelName: "glm-4.6",
      } as any),
    ).rejects.toThrow(/not connected/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("testConnection is a REAL validation request — a token alone is not 'connected'", async () => {
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    const fetchSpy = vi.fn(async (..._a: unknown[]) => jsonResponse(401, { detail: "token expired, login required" }));
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy as unknown as typeof fetch);
    const res = await adapter.testConnection({ id: "p_zai_web", type: "zai-web" } as any);
    expect(res.ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("chat.z.ai");
  });

  it("testConnection passes only when the live validation succeeds", async () => {
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [{ id: "glm-4.6" }] }));
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy as unknown as typeof fetch);
    const res = await adapter.testConnection({ id: "p_zai_web", type: "zai-web" } as any);
    expect(res.ok).toBe(true);
  });
});

describe("ZaiWebSessionAdapter — chat + normalization", () => {
  it("normalizes an OpenAI-shaped web response into the ChatResponse contract", async () => {
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    const fetchSpy = vi.fn(async (..._a: unknown[]) =>
      jsonResponse(200, {
        choices: [{ message: { content: "Optimized resume text" } }],
        usage: { prompt_tokens: 120, completion_tokens: 80 },
        model: "glm-4.6",
      }),
    );
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy as unknown as typeof fetch);
    const res = await adapter.chat(
      { messages: [{ role: "user", content: "optimize" }] } as any,
      { id: "p_zai_web", type: "zai-web", modelName: "glm-4.6", timeout: 5000 } as any,
    );
    expect(res.provider).toBe("zai-web");
    expect(res.model).toBe("glm-4.6");
    expect(res.text).toBe("Optimized resume text");
    expect(res.inputTokens).toBe(120);
    expect(res.outputTokens).toBe(80);
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.model).toBe("glm-4.6");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/v2/chat/completions");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("signature_timestamp=");
    const headers = (fetchSpy.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Signature"]).toBeTypeOf("string");
    expect(headers["X-FE-Version"]).toContain("prod-fe");
  });

  it("maps 401 chat failures to a session_expired auth error (failover-able, never a fake success)", async () => {
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    const fetchSpy = vi.fn(async () => jsonResponse(401, { detail: "unauthorized" }));
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy as unknown as typeof fetch);
    await expect(
      adapter.chat({ messages: [{ role: "user", content: "hi" }] } as any, { type: "zai-web", modelName: "glm-4.6" } as any),
    ).rejects.toThrow(/session expired|DEGRADED/i);
  });

  it("gracefully fails when the web contract shape changes (no fabricated content)", async () => {
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    const fetchSpy = vi.fn(async () => jsonResponse(200, { totally: "different-shape" }));
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy as unknown as typeof fetch);
    await expect(
      adapter.chat({ messages: [{ role: "user", content: "hi" }] } as any, { type: "zai-web" } as any),
    ).rejects.toThrow(/session_invalid|shape/i);
  });

  it("listModels returns validated web models, else the stored catalog, else a truthful error", async () => {
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    const okFetch = vi.fn(async () => jsonResponse(200, { data: [{ id: "glm-4.6" }, { id: "glm-4.5-air" }] }));
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, okFetch as unknown as typeof fetch);
    await expect(adapter.listModels({ type: "zai-web" } as any)).resolves.toEqual(["glm-4.6", "glm-4.5-air"]);

    const deadFetch = vi.fn(async () => jsonResponse(503, {}));
    const adapter2 = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, deadFetch as unknown as typeof fetch);
    await expect(
      adapter2.listModels({ type: "zai-web", enabledModels: ["glm-4.6"] } as any),
    ).resolves.toEqual(["glm-4.6"]);
    await expect(adapter2.listModels({ type: "zai-web" } as any)).rejects.toThrow(/session_invalid/i);
  });
});

describe("provider-sync — web-session isolation (Task 29 rules extended)", () => {
  it("matches the zai-web seed by ID only — never by name/substring", () => {
    const d1 = zaiWebProvider({ id: "p_custom_abc", name: "Z.ai Web Account", type: "zai-web" });
    expect(findSeedProvider(d1, TEST_SEEDS)).toBeUndefined();
    expect(findSeedProvider(zaiWebProvider(), TEST_SEEDS)?.id).toBe("p_zai_web");
  });

  it("never force-restores a REST Base URL onto a web-session record and never unions seed models", () => {
    const d1 = zaiWebProvider({ enabledModels: ["glm-4.6"] });
    const merged = mergeProviderWithSeed(d1, TEST_SEEDS.find((p) => p.id === "p_zai_web"));
    expect(merged.baseUrl).toBe("");
    expect(merged.enabledModels).toEqual(["glm-4.6"]);
  });

  it("classifies legacy zai-web records by type and web-session by integrationType", () => {
    expect(isWebSessionIntegration({ type: "zai-web" })).toBe(true);
    expect(isWebSessionIntegration({ integrationType: "web-session", type: "custom" })).toBe(true);
    expect(isWebSessionIntegration({ type: "custom" })).toBe(false);
    expect(isWebSessionIntegration({ type: "antigravity" })).toBe(false);
  });
});

describe("ZaiWebSessionAdapter — browser chat via the signed server route (Task 30c)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chat posts to the same-origin chat route and returns the parsed answer", async () => {
    vi.stubGlobal("window", {});
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    const fetchSpy = vi.fn(async (...args: unknown[]) => {
      const [url, init] = args as [string, RequestInit];
      expect(url).toBe("/api/providers/zai-web/chat");
      expect(init.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("glm-4.6");
      expect(body.token).toBe(TOKEN);
      return jsonResponse(200, { ok: true, state: "connected", content: "Web answer", model: "glm-4.6", usage: { prompt_tokens: 7, completion_tokens: 3 } });
    }) as unknown as typeof fetch;
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy);
    const res = await adapter.chat(
      { messages: [{ role: "user", content: "hi" }] } as any,
      { type: "zai-web", modelName: "glm-4.6" } as any,
    );
    expect(res.text).toBe("Web answer");
    expect(res.provider).toBe("zai-web");
    expect(res.inputTokens).toBe(7);
  });

  it("chat maps authentication_required to a ProviderAuthenticationError (failover-able)", async () => {
    vi.stubGlobal("window", {});
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { ok: false, state: "authentication_required", message: "No Z.ai web session available." }),
    ) as unknown as typeof fetch;
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy);
    await expect(
      adapter.chat({ messages: [{ role: "user", content: "hi" }] } as any, { type: "zai-web" } as any),
    ).rejects.toThrow(/not connected|no z\.ai web session/i);
  });

  it("browser chat NEVER calls chat.z.ai cross-origin directly", async () => {
    vi.stubGlobal("window", {});
    const raw = vi.fn(async () =>
      jsonResponse(200, { ok: true, state: "connected", content: "x" }),
    );
    const fetchSpy = raw as unknown as typeof fetch;
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, fetchSpy);
    await adapter.chat({ messages: [{ role: "user", content: "hi" }] } as any, { type: "zai-web" } as any);
    expect(String((raw.mock.calls[0] as unknown[])[0])).not.toContain("chat.z.ai");
  });
});

describe("disconnect isolation", () => {
  it("forgets only the zai-web session (other providers untouched by design)", async () => {
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    expect(recallZaiWebSession()?.token).toBe(TOKEN);
    const cleared: string[] = [];
    await forgetZaiWebSession({ store: async () => ({ ok: true as const }), clear: async () => { cleared.push("zai-web"); } });
    expect(recallZaiWebSession()).toBeNull();
    expect(cleared).toEqual(["zai-web"]);
  });
});

// Task 30b — the "always failing" fix: in a BROWSER the bridge import leaves
// the memory store empty (the token lives encrypted server-side), so the
// adapter must validate through the same-origin import route instead of
// calling chat.z.ai cross-origin directly.
describe("ZaiWebSessionAdapter — browser runtime validates via the import route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function routeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
    return vi.fn((...args: unknown[]) => {
      const [url, init] = args as [string, RequestInit?];
      return Promise.resolve(handler(url, init)) as unknown;
    });
  }
  const asFetch = (fn: ReturnType<typeof vi.fn>) => fn as unknown as typeof fetch;

  it("with an empty memory store it asks the server to validate the stored session (GET, never chat.z.ai cross-origin)", async () => {
    vi.stubGlobal("window", {});
    const fetchStub = routeFetch((url, init) => {
      expect(String(url)).toBe("/api/providers/zai-web/session-import");
      expect(init?.method ?? "GET").toBe("GET");
      return jsonResponse(200, {
        ok: true,
        stored: "server",
        validated: true,
        state: "connected",
        models: ["glm-4.6"],
        message: "Z.ai web session validated against the live web contract.",
      });
    });
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, asFetch(fetchStub));
    const res = await adapter.testConnection({ id: "p_zai_web", type: "zai-web" } as any);
    expect(res.ok).toBe(true);
    expect(String(fetchStub.mock.calls[0][0])).not.toContain("chat.z.ai");
  });

  it("with a memory token it POSTs it for validate-before-store (source=test-connection)", async () => {
    vi.stubGlobal("window", {});
    rememberZaiWebSession({ authenticated: true, token: TOKEN, source: "localStorage" });
    let seenBody: any = null;
    const fetchStub = routeFetch((_url, init) => {
      expect(init?.method).toBe("POST");
      seenBody = JSON.parse(String(init?.body));
      return jsonResponse(200, { ok: true, validated: true, state: "connected", models: [], message: "validated and stored encrypted." });
    });
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, asFetch(fetchStub));
    const res = await adapter.testConnection({ id: "p_zai_web", type: "zai-web" } as any);
    expect(res.ok).toBe(true);
    expect(seenBody.credential_type).toBe("zai_web_session");
    expect(seenBody.token).toBe(TOKEN);
    expect(seenBody.source).toBe("test-connection");
  });

  it("reports the honest failure state when nothing is stored server-side", async () => {
    vi.stubGlobal("window", {});
    const fetchStub = routeFetch(() =>
      jsonResponse(200, {
        ok: true,
        validated: false,
        state: "authentication_required",
        models: [],
        message: "No server-stored Z.ai web session yet. Open Z.ai, sign in with Google, run the Z.ai → ATS Pro bridge on chat.z.ai, then Test Connection again.",
      }),
    );
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, asFetch(fetchStub));
    const res = await adapter.testConnection({ id: "p_zai_web", type: "zai-web" } as any);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no server-stored z\.ai web session/i);
  });

  it("fails closed when the secure sink is unavailable (HTTP 501)", async () => {
    vi.stubGlobal("window", {});
    const fetchStub = routeFetch(() =>
      jsonResponse(501, {
        ok: false,
        validated: false,
        state: "network_error",
        models: [],
        message: "ATS Pro secure storage is unavailable (no D1 binding), so the server-stored session cannot be validated. Re-run the bridge import — it validates before storing.",
      }),
    );
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, asFetch(fetchStub));
    const res = await adapter.testConnection({ id: "p_zai_web", type: "zai-web" } as any);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/secure storage is unavailable/i);
  });

  it("an unreachable validation endpoint is an explicit network_error, never a fabricated success", async () => {
    vi.stubGlobal("window", {});
    const fetchStub = routeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, asFetch(fetchStub));
    const res = await adapter.testConnection({ id: "p_zai_web", type: "zai-web" } as any);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/validation endpoint unreachable/i);
  });

  it("listModels uses the server-validated catalog, then the stored one, then fails truthfully", async () => {
    vi.stubGlobal("window", {});
    const okFetch = routeFetch(() =>
      jsonResponse(200, { ok: true, validated: true, state: "connected", models: ["glm-4.6", "glm-4.5-air"], message: "ok" }),
    );
    const adapter = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, asFetch(okFetch));
    await expect(adapter.listModels({ type: "zai-web" } as any)).resolves.toEqual(["glm-4.6", "glm-4.5-air"]);

    const degradedFetch = routeFetch(() =>
      jsonResponse(200, { ok: true, validated: false, state: "session_expired", models: [], message: "expired" }),
    );
    const adapter2 = new ZaiWebSessionAdapter(ZAI_WEB_CHAT_CONTRACT, asFetch(degradedFetch));
    await expect(adapter2.listModels({ type: "zai-web", enabledModels: ["glm-4.6"] } as any)).resolves.toEqual(["glm-4.6"]);
    await expect(adapter2.listModels({ type: "zai-web" } as any)).rejects.toThrow(/session_expired/i);
  });
});
