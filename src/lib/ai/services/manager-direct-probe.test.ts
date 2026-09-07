// ============================================================================
// Task 17 — ProviderManager.testConnection × DirectProbePolicy wiring tests.
//
// Regression: testing the demoted opencode zen provider row fired a
// browser-direct fetch at https://opencode.ai/zen/v1/chat/completions on
// every 429 verdict. opencode.ai sends no CORS headers, so the browser
// logged unavoidable "blocked by CORS policy" + net::ERR_FAILED stacks.
// The probe must now be policy-gated: skipped for demoted providers, and
// remembered (localStorage, 24h TTL) for hosts whose probe already failed.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      addProviderLog: vi.fn(),
    }),
  },
  uid: () => "pl-test",
}));

import { ProviderManager } from "./manager";

// ---------------------------------------------------------------------------
// Fake Storage + window
// ---------------------------------------------------------------------------
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
  } as Storage;
}

let storage: Storage;
const realWindow = (globalThis as any).window;

beforeEach(() => {
  storage = fakeStorage();
  (globalThis as any).window = { localStorage: storage };
});

afterEach(() => {
  (globalThis as any).window = realWindow;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Provider fixtures
// ---------------------------------------------------------------------------
const ZEN = (isActive: boolean) => ({
  id: "p_zencode",
  name: "OpenCode Zen",
  type: "opencode-zen",
  baseUrl: "https://opencode.ai/zen/v1",
  apiKey: "test-key",
  modelName: "qwen3-coder-480b:free",
  priority: 3,
  isActive,
  timeout: 30000,
  maxTokens: 10,
  temperature: 0.3,
  requiresApiKey: true,
  status: "degraded",
} as any);

const PROXY_429 = (ok = false) => new Response(
  JSON.stringify({
    ok,
    rateLimited: true,
    message: "Rate-limited (HTTP 429) — provider is reachable and the API key was accepted, but this account/model has exhausted its usage quota.",
  }),
  { status: 200, headers: { "Content-Type": "application/json" } }
);

const DIRECT_OK = () => new Response(
  JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
  { status: 200, headers: { "Content-Type": "application/json" } }
);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
describe("ProviderManager.testConnection — direct probe gating", () => {
  it("REGRESSION: a demoted provider (isActive=false) NEVER triggers the browser-direct probe", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      calls.push(String(url));
      return PROXY_429();
    }));

    const res = await ProviderManager.testConnection(ZEN(false));

    expect(calls).toEqual(["/api/providers/test"]); // only the proxy call
    expect(res.ok).toBe(false);
    expect((res as any).rateLimited).toBe(true);
  });

  it("an active provider probes on 429 and a successful probe replaces the verdict", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      calls.push(String(url));
      return calls.length === 1 ? PROXY_429() : DIRECT_OK();
    }));

    const res = await ProviderManager.testConnection(ZEN(true));

    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Direct Client IP");
    // success clears any remembered failure
    expect(storage.getItem("directProbe.corsBlockedHosts")).toBeNull();
  });

  it("a failed probe (CORS TypeError) is remembered — the NEXT run skips the probe entirely", async () => {
    let run = 0;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      calls.push(u);
      // URL-aware: the proxy always 429s; the direct probe throws on run 1 only.
      if (u === "/api/providers/test") return PROXY_429();
      if (run === 0) throw new TypeError("Failed to fetch");
      return DIRECT_OK(); // must never be reached on run 2 — calls count catches it
    }));

    // Run 1 — probe attempted, fails, host remembered
    const res1 = await ProviderManager.testConnection(ZEN(true));
    expect(res1.ok).toBe(false);
    expect((res1 as any).rateLimited).toBe(true); // proxy diagnostic preserved
    expect(calls).toHaveLength(2);
    const remembered = JSON.parse(storage.getItem("directProbe.corsBlockedHosts") ?? "{}");
    expect(remembered["opencode.ai"]).toBeTypeOf("number");

    // Run 2 — remembered host: no second fetch, verdict still the proxy's
    run = 1;
    const callsBefore = calls.length;
    const res2 = await ProviderManager.testConnection(ZEN(true));
    expect(calls).toHaveLength(callsBefore + 1); // only the proxy call
    expect((res2 as any).rateLimited).toBe(true);
    expect(res2.message).toContain("429");
  });

  it("a pre-remembered hostile host does not probe, but a successful probe clears the memory", async () => {
    // Seed memory as if a previous probe failed
    storage.setItem("directProbe.corsBlockedHosts", JSON.stringify({ "opencode.ai": Date.now() - 1000 }));

    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      calls.push(u);
      return u === "/api/providers/test" ? PROXY_429() : DIRECT_OK();
    }));

    // Skipped while remembered
    await ProviderManager.testConnection(ZEN(true));
    expect(calls).toEqual(["/api/providers/test"]);

    // TTL expiry lets the probe through again; success clears the memory
    storage.setItem("directProbe.corsBlockedHosts", JSON.stringify({ "opencode.ai": Date.now() - 25 * 60 * 60 * 1000 }));
    const res2 = await ProviderManager.testConnection(ZEN(true));
    expect(calls).toHaveLength(3); // run 1: proxy · run 2: proxy + probe
    expect(calls[2]).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(res2.ok).toBe(true); // probe succeeded on the expired memory
    expect(JSON.parse(storage.getItem("directProbe.corsBlockedHosts") ?? "{}")).toEqual({});
  });

  it("a non-rateLimited proxy response never probes (even for active providers)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({ ok: false, message: "HTTP 401 — invalid api key" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }));

    const res = await ProviderManager.testConnection(ZEN(true));
    expect(calls).toEqual(["/api/providers/test"]);
    expect(res.ok).toBe(false);
    expect((res as any).rateLimited).toBeUndefined();
  });
});
