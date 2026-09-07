// ============================================================================
// Task 17 — DirectProbePolicy unit tests.
//
// The policy gates ProviderManager.testConnection's "direct client IP probe"
// (browser fetch straight to the provider URL when the /api/providers/test
// proxy reports 429). Regression context: testing the DEMOTED opencode zen
// row spammed the console with unavoidable CORS preflight errors — the probe
// can never succeed against opencode.ai (no Access-Control-Allow-Origin) and
// demoted providers are excluded from the live chain anyway.
// ============================================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  shouldAttemptDirectProbe,
  extractProbeHost,
  safeLocalStorage,
  loadBlockedProbeHosts,
  rememberBlockedProbeHost,
  clearBlockedProbeHost,
  DIRECT_PROBE_BLOCK_TTL_MS,
} from "./direct-probe-policy";

afterEach(() => {
  delete (globalThis as any).window;
  vi.restoreAllMocks();
});

const baseCtx = (overrides: Partial<Parameters<typeof shouldAttemptDirectProbe>[0]> = {}) => ({
  rateLimited: true,
  providerIsActive: true,
  baseUrl: "https://api.example.com/v1",
  isBrowser: true,
  blockedHosts: new Set<string>(),
  ...overrides,
});

describe("extractProbeHost", () => {
  it("extracts the hostname from a normal base URL", () => {
    expect(extractProbeHost("https://opencode.ai/zen/v1")).toBe("opencode.ai");
    expect(extractProbeHost("https://api.mistral.ai/v1/")).toBe("api.mistral.ai");
  });

  it("normalizes case", () => {
    expect(extractProbeHost("https://OpenCode.AI/zen/v1")).toBe("opencode.ai");
  });

  it("returns null for missing / unparseable URLs", () => {
    expect(extractProbeHost(undefined)).toBeNull();
    expect(extractProbeHost("")).toBeNull();
    expect(extractProbeHost("ht tp://broken")).toBeNull();
  });

  it("accepts bare host:port forms", () => {
    expect(extractProbeHost("api.example.com/v1")).toBe("api.example.com");
  });
});

describe("shouldAttemptDirectProbe", () => {
  it("probes only when the proxy reported 429", () => {
    expect(shouldAttemptDirectProbe(baseCtx({ rateLimited: false }))).toBe(false);
    expect(shouldAttemptDirectProbe(baseCtx())).toBe(true);
  });

  it("never probes outside a browser", () => {
    expect(shouldAttemptDirectProbe(baseCtx({ isBrowser: false }))).toBe(false);
  });

  it("REGRESSION: never probes a demoted (isActive = false) provider — the opencode zen CORS-noise case", () => {
    expect(shouldAttemptDirectProbe(baseCtx({ providerIsActive: false }))).toBe(false);
  });

  it("treats isActive undefined (legacy rows) as active", () => {
    expect(shouldAttemptDirectProbe(baseCtx({ providerIsActive: undefined as any }))).toBe(true);
  });

  it("refuses to probe without a usable baseUrl", () => {
    expect(shouldAttemptDirectProbe(baseCtx({ baseUrl: undefined }))).toBe(false);
  });

  it("never probes localhost — same-machine endpoints need no IP rescue", () => {
    expect(shouldAttemptDirectProbe(baseCtx({ baseUrl: "http://localhost:11434/v1" }))).toBe(false);
    expect(shouldAttemptDirectProbe(baseCtx({ baseUrl: "http://127.0.0.1:8080/v1" }))).toBe(false);
  });

  it("skips hosts remembered as CORS/network-hostile", () => {
    expect(shouldAttemptDirectProbe(baseCtx({ blockedHosts: new Set(["api.example.com"]) }))).toBe(false);
  });
});

describe("blocked-host memory (localStorage, TTL)", () => {
  it("has a bounded TTL (24h)", () => {
    expect(DIRECT_PROBE_BLOCK_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("returns an empty set without storage or with empty storage", () => {
    expect(loadBlockedProbeHosts(null)).toEqual(new Set());
    const empty = fakeStorage();
    expect(loadBlockedProbeHosts(empty)).toEqual(new Set());
  });

  it("keeps entries inside the TTL and drops expired ones", () => {
    const store = fakeStorage();
    const now = 1_700_000_000_000;
    store.setItem(
      "directProbe.corsBlockedHosts",
      JSON.stringify({ "fresh.example.com": now - 1000, "stale.example.com": now - DIRECT_PROBE_BLOCK_TTL_MS - 1000 })
    );
    expect(loadBlockedProbeHosts(store, now)).toEqual(new Set(["fresh.example.com"]));
  });

  it("treats corrupt JSON and non-numeric timestamps as empty", () => {
    const store = fakeStorage();
    store.setItem("directProbe.corsBlockedHosts", "{not json");
    expect(loadBlockedProbeHosts(store)).toEqual(new Set());
    store.setItem("directProbe.corsBlockedHosts", JSON.stringify({ "bad.example.com": "oops" }));
    expect(loadBlockedProbeHosts(store)).toEqual(new Set());
  });

  it("rememberBlockedProbeHost merges and persists; clearBlockedProbeHost removes", () => {
    const store = fakeStorage();
    const now = 1_700_000_000_000;
    rememberBlockedProbeHost(store, "opencode.ai", now);
    rememberBlockedProbeHost(store, "Other.Example.COM", now + 5);
    expect(loadBlockedProbeHosts(store, now + 10)).toEqual(new Set(["opencode.ai", "other.example.com"]));

    clearBlockedProbeHost(store, "opencode.ai");
    expect(loadBlockedProbeHosts(store, now + 10)).toEqual(new Set(["other.example.com"]));

    // clearing an absent host is a no-op; null storage never throws
    expect(() => clearBlockedProbeHost(store, "absent.example.com")).not.toThrow();
    expect(() => rememberBlockedProbeHost(null, "x.example.com")).not.toThrow();
    expect(() => clearBlockedProbeHost(null, "x.example.com")).not.toThrow();
  });

  it("overwrites a corrupt payload instead of throwing", () => {
    const store = fakeStorage();
    store.setItem("directProbe.corsBlockedHosts", "{corrupt");
    const now = 1_700_000_000_000;
    expect(() => rememberBlockedProbeHost(store, "opencode.ai", now)).not.toThrow();
    expect(loadBlockedProbeHosts(store, now + 1000)).toEqual(new Set(["opencode.ai"]));
  });

  it("safeLocalStorage returns null without a window and works when one exists", () => {
    expect(safeLocalStorage()).toBeNull();
    (globalThis as any).window = { localStorage: fakeStorage() };
    expect(safeLocalStorage()).toBe((globalThis as any).window.localStorage);
  });
});

// ---------------------------------------------------------------------------
// Minimal in-memory Storage
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
