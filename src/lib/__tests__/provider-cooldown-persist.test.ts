// ============================================================================
// S1 — Cross-session quota cooldown persistence (Task 18)
//
// Session storage survives a page RELOAD but dies with the TAB. A 30-minute
// quota window stored only in sessionStorage therefore evaporates the moment
// the user closes and reopens the app — the first request of the new session
// re-hits the quota-dead provider (one wasted request + latency before the
// window re-arms).
//
// Contract under test:
//   - LONG windows (>= QUOTA_PERSIST_MIN_MS: quota 30m, 401 30m) are mirrored
//     into localStorage (keyed with a dedicated prefix) and survive a wiped
//     sessionStorage ("new tab" simulation).
//   - SHORT windows (429 3m, timeout 90s) remain session-only — a fresh tab
//     always starts with a clean tactical slate.
//   - Early-clear (success evidence) removes BOTH stores.
//   - Expired localStorage entries are ignored and removed (self-cleaning).
//   - Legacy bare-number entries (pre-JSON format) still parse.
//   - New introspection API: getProviderCooldownRemainingMs / Class.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  markProviderQuotaCooldown,
  markProvider429Cooldown,
  markProvider401Cooldown,
  markProviderTimeoutCooldown,
  markProviderRateLimitCooldown,
  isProviderInCooldown,
  clearProviderCooldownOnSuccess,
  getProviderCooldownRemainingMs,
  getProviderCooldownClass,
  PROVIDER_COOLDOWN_PREFIX,
  PROVIDER_QUOTA_PERSIST_PREFIX,
  QUOTA_PERSIST_MIN_MS,
  PROVIDER_QUOTA_COOLDOWN_MS,
} from "../provider-cooldown";

// -- Separate fakes: sessionStorage dies with the tab, localStorage does not --
const sessionStore = new Map<string, string>();
const localStore = new Map<string, string>();
(globalThis as any).window = {
  sessionStorage: {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => void sessionStore.set(k, v),
    removeItem: (k: string) => void sessionStore.delete(k),
  },
  localStorage: {
    getItem: (k: string) => localStore.get(k) ?? null,
    setItem: (k: string, v: string) => void localStore.set(k, v),
    removeItem: (k: string) => void localStore.delete(k),
  },
};

let seq = 0;
const nextId = () => `p_persist_${++seq}`;

/** Simulates the user closing the tab and opening a new one. */
function simulateNewTab(): void {
  sessionStore.clear();
}

beforeEach(() => {
  sessionStore.clear();
  localStore.clear();
});

describe("S1 — long cooldowns survive a new tab (localStorage mirror)", () => {
  it("quota cooldown (30m) survives simulateNewTab()", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    expect(isProviderInCooldown(id)).toBe(true);

    simulateNewTab();
    // The whole point of S1: still cooling down in the fresh tab.
    expect(isProviderInCooldown(id)).toBe(true);
    // ...and it was re-hydrated into the new session for consistency.
    expect(sessionStore.has(PROVIDER_COOLDOWN_PREFIX + id)).toBe(true);
  });

  it("401 cooldown (30m) survives simulateNewTab()", () => {
    const id = nextId();
    markProvider401Cooldown(id);
    simulateNewTab();
    expect(isProviderInCooldown(id)).toBe(true);
  });

  it("short 429 cooldown (3m) does NOT persist across tabs", () => {
    const id = nextId();
    markProvider429Cooldown(id);
    simulateNewTab();
    expect(isProviderInCooldown(id)).toBe(false);
  });

  it("timeout cooldown (90s) does NOT persist across tabs", () => {
    const id = nextId();
    markProviderTimeoutCooldown(id);
    simulateNewTab();
    expect(isProviderInCooldown(id)).toBe(false);
  });

  it("explicit windows below QUOTA_PERSIST_MIN_MS stay session-only", () => {
    const id = nextId();
    markProviderRateLimitCooldown(id, 5 * 60 * 1000); // 5m < 10m threshold
    expect(localStore.has(PROVIDER_QUOTA_PERSIST_PREFIX + id)).toBe(false);
  });

  it("explicit windows at/above QUOTA_PERSIST_MIN_MS are mirrored", () => {
    const id = nextId();
    markProviderRateLimitCooldown(id, 15 * 60 * 1000); // 15m >= 10m threshold
    expect(localStore.has(PROVIDER_QUOTA_PERSIST_PREFIX + id)).toBe(true);
    simulateNewTab();
    expect(isProviderInCooldown(id)).toBe(true);
  });
});

describe("S1 — early clear and expiry", () => {
  it("clearProviderCooldownOnSuccess removes BOTH stores (even across a new tab)", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    simulateNewTab();
    expect(isProviderInCooldown(id)).toBe(true); // restored from localStorage
    clearProviderCooldownOnSuccess(id);
    expect(isProviderInCooldown(id)).toBe(false);
    expect(localStore.has(PROVIDER_QUOTA_PERSIST_PREFIX + id)).toBe(false);
    expect(sessionStore.has(PROVIDER_COOLDOWN_PREFIX + id)).toBe(false);
  });

  it("expired localStorage entries are ignored and self-cleaned", () => {
    const id = nextId();
    const expired = JSON.stringify({ until: Date.now() - 1000, class: "quota" });
    localStore.set(PROVIDER_QUOTA_PERSIST_PREFIX + id, expired);
    expect(isProviderInCooldown(id)).toBe(false);
    expect(localStore.has(PROVIDER_QUOTA_PERSIST_PREFIX + id)).toBe(false);
  });

  it("legacy bare-number entries (pre-JSON) still parse", () => {
    const id = nextId();
    localStore.set(
      PROVIDER_QUOTA_PERSIST_PREFIX + id,
      String(Date.now() + 60_000),
    );
    expect(isProviderInCooldown(id)).toBe(true);
    expect(getProviderCooldownClass(id)).toBe("unknown");
  });

  it("corrupted localStorage entries are ignored, not thrown", () => {
    const id = nextId();
    localStore.set(PROVIDER_QUOTA_PERSIST_PREFIX + id, "{not json!!");
    expect(() => isProviderInCooldown(id)).not.toThrow();
    expect(isProviderInCooldown(id)).toBe(false);
  });
});

describe("S1 — introspection API (feeds S2 structured skip reasons)", () => {
  it("getProviderCooldownRemainingMs returns real remaining time, 0 when none", () => {
    const id = nextId();
    expect(getProviderCooldownRemainingMs(id)).toBe(0);
    markProviderQuotaCooldown(id);
    const rem = getProviderCooldownRemainingMs(id);
    expect(rem).toBeGreaterThan(PROVIDER_QUOTA_COOLDOWN_MS - 60_000);
    expect(rem).toBeLessThanOrEqual(PROVIDER_QUOTA_COOLDOWN_MS);
  });

  it("getProviderCooldownRemainingMs works across a new tab", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    simulateNewTab();
    expect(getProviderCooldownRemainingMs(id)).toBeGreaterThan(0);
  });

  it("getProviderCooldownClass reports the window class", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    expect(getProviderCooldownClass(id)).toBe("quota");

    const id401 = nextId();
    markProvider401Cooldown(id401);
    expect(getProviderCooldownClass(id401)).toBe("401");

    const id429 = nextId();
    markProvider429Cooldown(id429);
    expect(getProviderCooldownClass(id429)).toBe("429");
  });

  it("QUOTA_PERSIST_MIN_MS is 10 minutes", () => {
    expect(QUOTA_PERSIST_MIN_MS).toBe(10 * 60 * 1000);
  });
});
