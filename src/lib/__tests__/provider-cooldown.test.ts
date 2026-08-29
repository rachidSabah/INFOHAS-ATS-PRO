// ============================================================================
// Traffic-vs-PROBE cooldown authority — regression tests for the
// "providers cool down even though the API was never used" bug.
//
// Root cause: the router armed provider cooldowns (sessionStorage + in-memory
// rate-limit tracker) on EVERY failed call — including the app's own health
// probes (preflight / benchmark / heal pings, requestType "test"). Free-tier
// models 429 those probes constantly, so providers cycled in a perpetual
// "Temporary cooldown — 180s remaining" state with zero real user traffic.
//
// Contract under test (recordTrafficCooldownFromError):
//   - requestType "test"  → NEVER arms any cooldown (evidence only)
//   - real traffic 429    → tracker window + sessionStorage 429 cooldown
//   - real traffic 401    → 30-min auth cooldown
//   - real traffic timeout→ 90s timeout cooldown
//   - authExtra (race)    → billing/payment wording still classified
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordTrafficCooldownFromError,
  isProviderInCooldown,
  PROVIDER_COOLDOWN_PREFIX,
  PROVIDER_429_COOLDOWN_MS,
  PROVIDER_401_COOLDOWN_MS,
} from "../provider-cooldown";
import { rateLimitTracker } from "../rate-limit-tracker";

// -- Minimal window/sessionStorage fake (vitest runs in node env) -----------
const store = new Map<string, string>();
(globalThis as any).window = {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const keyFor = (id: string) => PROVIDER_COOLDOWN_PREFIX + id;

// Unique provider ids per test — the rate-limit tracker is a process-level
// singleton with no reset, so tests must not share keys.
let seq = 0;
const nextId = () => `p_test_${++seq}`;

beforeEach(() => {
  store.clear();
});

describe("recordTrafficCooldownFromError — probe requests never arm cooldowns", () => {
  it("a probe 429 (requestType 'test') arms NOTHING — the phantom-cooldown bug", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      modelName: "hy3-free",
      error: new Error("HTTP 429: rate limit exceeded"),
      isTimeout: false,
      requestType: "test", // preflight / benchmark / heal ping
    });
    expect(isProviderInCooldown(id)).toBe(false);
    expect(rateLimitTracker.isRateLimited(id)).toBe(false);
  });

  it("a probe timeout (requestType 'test') arms NOTHING", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error("Request timed out after 15000ms"),
      isTimeout: true,
      requestType: "test",
    });
    expect(isProviderInCooldown(id)).toBe(false);
  });

  it("a probe auth error (requestType 'test') arms NOTHING", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error("HTTP 401: unauthorized"),
      isTimeout: false,
      requestType: "test",
    });
    expect(isProviderInCooldown(id)).toBe(false);
  });
});

describe("recordTrafficCooldownFromError — real traffic still arms cooldowns", () => {
  it("a REAL 429 arms the tracker window + the 3-minute sessionStorage cooldown", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      modelName: "hy3-free",
      error: new Error("HTTP 429: Too Many Requests"),
      isTimeout: false,
      requestType: "chat",
    });
    expect(isProviderInCooldown(id)).toBe(true);
    expect(rateLimitTracker.isRateLimited(id)).toBe(true);
    // sessionStorage key carries the 429 window
    const until = Number(store.get(keyFor(id)));
    expect(until - Date.now()).toBeGreaterThan(PROVIDER_429_COOLDOWN_MS - 5000);
  });

  it("a REAL 401 arms the 30-minute auth cooldown", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error("HTTP 401: unauthorized"),
      isTimeout: false,
      requestType: "chat",
    });
    expect(isProviderInCooldown(id)).toBe(true);
    const until = Number(store.get(keyFor(id)));
    expect(until - Date.now()).toBeGreaterThan(PROVIDER_401_COOLDOWN_MS - 5000);
  });

  it("a REAL timeout arms the short timeout cooldown", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error("Provider.generate timed out"),
      isTimeout: true,
      requestType: "chat",
    });
    expect(isProviderInCooldown(id)).toBe(true);
  });

  it("statusCode takes precedence over message matching (429 via status)", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: Object.assign(new Error("quota"), { statusCode: 429 }),
      isTimeout: false,
      requestType: "chat",
    });
    expect(isProviderInCooldown(id)).toBe(true);
  });

  it("authExtra (speculative race) still classifies billing/payment wording", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error("payment required for this model"),
      isTimeout: false,
      requestType: "chat",
      authExtra: /billing|payment/i,
    });
    expect(isProviderInCooldown(id)).toBe(true);
  });

  it("non-rate-limit, non-auth, non-timeout errors arm nothing (failover only)", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error("The model `foo` does not exist"),
      isTimeout: false,
      requestType: "chat",
    });
    expect(isProviderInCooldown(id)).toBe(false);
  });
});
