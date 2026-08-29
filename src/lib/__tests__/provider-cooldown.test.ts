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
  PROVIDER_QUOTA_COOLDOWN_MS,
  markProviderQuotaCooldown,
  markProvider429Cooldown,
  clearProviderCooldownOnSuccess,
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

// S1: cooldown entries are now JSON ({until, class}) — parse accordingly.
const readUntil = (id: string): number => {
  const raw = store.get(keyFor(id)) ?? "";
  if (raw.startsWith("{")) {
    try { return JSON.parse(raw).until as number; } catch { return NaN; }
  }
  return Number(raw);
};

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
    const until = readUntil(id);
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
    const until = readUntil(id);
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

// ============================================================================
// P1 — QUOTA-CLASS COOLDOWN. FreeUsageLimitError-style 429s mean the
// account/model quota is EXHAUSTED (resets on an hourly/daily window), not
// "backing off for a few seconds". A flat 3-minute window made the router
// re-attempt a quota-dead provider every 3 minutes all day (the retry
// treadmill). Quota-class evidence must park the provider for the long
// window; transient 429s keep the short one.
// ============================================================================
describe("recordTrafficCooldownFromError — quota-class cooldown (P1)", () => {
  it("real-traffic FreeUsageLimitError arms the 30-MINUTE quota cooldown, not 3 minutes", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      modelName: "mimo-v2.5-free",
      error: new Error(
        "API returned HTTP 429: FreeUsageLimitError: Rate limit exceeded. Please try again later."
      ),
      statusCode: 429,
      isTimeout: false,
      requestType: "chat",
    });
    const until = readUntil(id);
    expect(until - Date.now()).toBeGreaterThan(PROVIDER_QUOTA_COOLDOWN_MS - 5000);
  });

  it("real-traffic usage-limit wording (no FreeUsageLimitError token) is also quota-class", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error("API returned HTTP 429: usage limit exceeded for this model"),
      statusCode: 429,
      isTimeout: false,
      requestType: "chat",
    });
    const until = readUntil(id);
    expect(until - Date.now()).toBeGreaterThan(PROVIDER_QUOTA_COOLDOWN_MS - 5000);
  });

  it("transient 429 without quota wording keeps the 3-minute window", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error("HTTP 429: Too Many Requests (burst)"),
      statusCode: 429,
      isTimeout: false,
      requestType: "chat",
    });
    const until = readUntil(id);
    expect(until - Date.now()).toBeGreaterThan(PROVIDER_429_COOLDOWN_MS - 5000);
    expect(until - Date.now()).toBeLessThan(PROVIDER_QUOTA_COOLDOWN_MS - 60_000);
  });

  it("markProviderQuotaCooldown arms the long window directly", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    const until = readUntil(id);
    expect(until - Date.now()).toBeGreaterThan(PROVIDER_QUOTA_COOLDOWN_MS - 5000);
  });
});

// ============================================================================
// P2 — RETRY-AFTER HONORED. When the provider tells us exactly when to come
// back (Retry-After header, relayed by the proxy as `retryAfterSeconds` or an
// "(retry-after: Ns)" note in the error text), use that EXACT window instead
// of guessing. Clamped to [5s, PROVIDER_QUOTA_COOLDOWN_MS].
// ============================================================================
describe("recordTrafficCooldownFromError — Retry-After honored (P2)", () => {
  it("error.retryAfterSeconds sets an exact ~120s window", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: Object.assign(new Error("HTTP 429: Too Many Requests"), { retryAfterSeconds: 120 }),
      statusCode: 429,
      isTimeout: false,
      requestType: "chat",
    });
    const until = readUntil(id);
    const windowMs = until - Date.now();
    expect(windowMs).toBeGreaterThan(110_000);
    expect(windowMs).toBeLessThanOrEqual(126_000);
  });

  it("an '(retry-after: 90s)' note embedded in the error message is parsed", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: new Error(
        'Proxy: {"ok":false,"error":"API returned HTTP 429: Rate limit exceeded. Please try again later. (retry-after: 90s)"}'
      ),
      statusCode: 429,
      isTimeout: false,
      requestType: "chat",
    });
    const until = readUntil(id);
    const windowMs = until - Date.now();
    expect(windowMs).toBeGreaterThan(85_000);
    expect(windowMs).toBeLessThanOrEqual(96_000);
  });

  it("Retry-After wins over the quota class (exact evidence beats a class guess)", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: Object.assign(
        new Error("FreeUsageLimitError: Rate limit exceeded. (retry-after: 60s)"),
        { retryAfterSeconds: 60 }
      ),
      statusCode: 429,
      isTimeout: false,
      requestType: "chat",
    });
    const until = readUntil(id);
    const windowMs = until - Date.now();
    expect(windowMs).toBeGreaterThan(55_000);
    expect(windowMs).toBeLessThanOrEqual(66_000);
  });

  it("Retry-After is clamped to the 30-minute cap", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: Object.assign(new Error("HTTP 429: Too Many Requests"), { retryAfterSeconds: 7200 }),
      statusCode: 429,
      isTimeout: false,
      requestType: "chat",
    });
    const until = readUntil(id);
    expect(until - Date.now()).toBeLessThanOrEqual(PROVIDER_QUOTA_COOLDOWN_MS + 5000);
  });

  it("non-429 classes ignore Retry-After (auth stays 30-min)", () => {
    const id = nextId();
    recordTrafficCooldownFromError({
      cooldownId: id,
      providerId: id,
      error: Object.assign(new Error("HTTP 401: unauthorized"), { retryAfterSeconds: 10 }),
      statusCode: 401,
      isTimeout: false,
      requestType: "chat",
    });
    const until = readUntil(id);
    expect(until - Date.now()).toBeGreaterThan(PROVIDER_401_COOLDOWN_MS - 5000);
  });
});

// ============================================================================
// Evidence of recovery must CLEAR cooldowns early. A successful call (real
// traffic or an honest probe) is strictly stronger evidence than any timer.
// ============================================================================
describe("clearProviderCooldownOnSuccess — evidence-based early clear", () => {
  it("clears an active rate-limit cooldown", () => {
    const id = nextId();
    markProvider429Cooldown(id);
    expect(isProviderInCooldown(id)).toBe(true);
    clearProviderCooldownOnSuccess(id);
    expect(isProviderInCooldown(id)).toBe(false);
  });

  it("clears an active quota cooldown", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    expect(isProviderInCooldown(id)).toBe(true);
    clearProviderCooldownOnSuccess(id);
    expect(isProviderInCooldown(id)).toBe(false);
  });

  it("is safe on providers with no cooldown", () => {
    const id = nextId();
    expect(() => clearProviderCooldownOnSuccess(id)).not.toThrow();
    expect(isProviderInCooldown(id)).toBe(false);
  });
});
