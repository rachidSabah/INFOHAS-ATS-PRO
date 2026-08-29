// ============================================================================
// Task 22 — QUOTA-WINDOW VISIBILITY (cooldown snapshot + display formatting)
//
// Task 21 made the ADAPTIVE CAP visible on the Providers page. The other half
// of traffic control was still invisible there: the COOLDOWN windows (S1).
// The router parks providers in sessionStorage windows (429 → 3m, timeout →
// 90s) and mirrors long ones (quota 30m, auth 30m) into localStorage so they
// survive a tab close — but the Providers table showed none of it, and the
// health strip's COOLDOWN chip showed raw seconds without the CLASS (quota vs
// 429 vs auth vs timeout — the "why") or whether the window is PERSISTED.
//
// Pure logic first, thin UI wiring after (repo convention):
//   getProviderCooldownSnapshot(id) — the full window picture:
//     inCooldown / remainingMs / class / until / persisted (S1 mirror is the
//     active window → survives tab close). Mirrors the session→local lookup
//     order of getProviderCooldownRemainingMs exactly.
//   formatCooldownRemaining(ms) — human display: "30m 00s", "2m 05s", "45s".
//     Hours-capable for future windows longer than the current 30m cap.
//
// Manual clearing already exists as clearProviderCooldownOnSuccess (evidence-
// based early-clear) — the UI reuses it for the manual clear affordance.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  getProviderCooldownSnapshot,
  formatCooldownRemaining,
  markProvider429Cooldown,
  markProviderQuotaCooldown,
  markProvider401Cooldown,
  markProviderTimeoutCooldown,
  markProviderRateLimitCooldown,
  clearProviderCooldownOnSuccess,
  PROVIDER_COOLDOWN_PREFIX,
  PROVIDER_QUOTA_PERSIST_PREFIX,
} from "../provider-cooldown";

// -- Minimal window fake with BOTH stores (vitest runs in node env) ----------
const session = new Map<string, string>();
const local = new Map<string, string>();
(globalThis as any).window = {
  sessionStorage: {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => void session.set(k, v),
    removeItem: (k: string) => void session.delete(k),
  },
  localStorage: {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => void local.set(k, v),
    removeItem: (k: string) => void local.delete(k),
  },
};

let seq = 0;
const nextId = () => `p_snap_${++seq}`;

beforeEach(() => {
  session.clear();
  local.clear();
});

describe("getProviderCooldownSnapshot — the full window picture", () => {
  it("no window → not in cooldown, zeros, no class, not persisted", () => {
    const id = nextId();
    const snap = getProviderCooldownSnapshot(id);
    expect(snap).toEqual({
      providerId: id,
      inCooldown: false,
      remainingMs: 0,
      class: null,
      until: null,
      persisted: false,
    });
  });

  it("429 window (3m): class 429, session-only → persisted false", () => {
    const id = nextId();
    markProvider429Cooldown(id);
    const snap = getProviderCooldownSnapshot(id);
    expect(snap.inCooldown).toBe(true);
    expect(snap.class).toBe("429");
    expect(snap.persisted).toBe(false);
    expect(snap.remainingMs).toBeGreaterThan(0);
    expect(snap.remainingMs).toBeLessThanOrEqual(3 * 60 * 1000);
    expect(snap.until).toBeGreaterThan(Date.now());
  });

  it("quota window (30m): class quota, PERSISTED (survives tab close)", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    const snap = getProviderCooldownSnapshot(id);
    expect(snap.class).toBe("quota");
    expect(snap.persisted).toBe(true);
    expect(local.has(PROVIDER_QUOTA_PERSIST_PREFIX + id)).toBe(true);
  });

  it("401 window (30m): class 401, persisted", () => {
    const id = nextId();
    markProvider401Cooldown(id);
    const snap = getProviderCooldownSnapshot(id);
    expect(snap.class).toBe("401");
    expect(snap.persisted).toBe(true);
  });

  it("timeout window (90s): class timeout, session-only", () => {
    const id = nextId();
    markProviderTimeoutCooldown(id);
    const snap = getProviderCooldownSnapshot(id);
    expect(snap.class).toBe("timeout");
    expect(snap.persisted).toBe(false);
  });

  it("explicit Retry-After window below the persist threshold stays session-only", () => {
    const id = nextId();
    markProviderRateLimitCooldown(id, 60_000); // 1m < 10m threshold
    expect(getProviderCooldownSnapshot(id).persisted).toBe(false);
  });

  it("expired session window with a LIVE local mirror → snapshot reads the persisted window", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    // Age out the session copy; the S1 mirror remains authoritative.
    const raw = session.get(PROVIDER_COOLDOWN_PREFIX + id)!;
    const entry = JSON.parse(raw);
    session.set(PROVIDER_COOLDOWN_PREFIX + id, JSON.stringify({ ...entry, until: Date.now() - 1000 }));
    const snap = getProviderCooldownSnapshot(id);
    expect(snap.inCooldown).toBe(true);
    expect(snap.persisted).toBe(true);
    expect(snap.class).toBe("quota");
    expect(snap.remainingMs).toBeGreaterThan(0);
  });

  it("both stores expired → clean empty snapshot (no stale class leaks)", () => {
    const id = nextId();
    const past = Date.now() - 1000;
    session.set(PROVIDER_COOLDOWN_PREFIX + id, JSON.stringify({ until: past, class: "quota" }));
    local.set(PROVIDER_QUOTA_PERSIST_PREFIX + id, JSON.stringify({ until: past, class: "quota" }));
    const snap = getProviderCooldownSnapshot(id);
    expect(snap.inCooldown).toBe(false);
    expect(snap.class).toBeNull();
    expect(snap.until).toBeNull();
    expect(snap.persisted).toBe(false);
  });

  it("manual clear via clearProviderCooldownOnSuccess → snapshot back to none", () => {
    const id = nextId();
    markProviderQuotaCooldown(id);
    expect(getProviderCooldownSnapshot(id).inCooldown).toBe(true);
    clearProviderCooldownOnSuccess(id);
    const snap = getProviderCooldownSnapshot(id);
    expect(snap.inCooldown).toBe(false);
    expect(snap.class).toBeNull();
    expect(snap.persisted).toBe(false);
  });
});

describe("formatCooldownRemaining — human display", () => {
  it("zero / negative → 0s", () => {
    expect(formatCooldownRemaining(0)).toBe("0s");
    expect(formatCooldownRemaining(-5)).toBe("0s");
  });

  it("sub-minute → bare seconds", () => {
    expect(formatCooldownRemaining(45_000)).toBe("45s");
    expect(formatCooldownRemaining(5_000)).toBe("5s");
  });

  it("minutes + seconds, zero-padded", () => {
    expect(formatCooldownRemaining(90_000)).toBe("1m 30s");
    expect(formatCooldownRemaining(125_000)).toBe("2m 05s");
  });

  it("quarter-hour and the full 30m quota window", () => {
    expect(formatCooldownRemaining(15 * 60_000)).toBe("15m 00s");
    expect(formatCooldownRemaining(30 * 60_000)).toBe("30m 00s");
    expect(formatCooldownRemaining(29 * 60_000 + 59_000)).toBe("29m 59s");
  });

  it("hours-capable for windows beyond the current cap", () => {
    expect(formatCooldownRemaining(60 * 60_000)).toBe("1h 00m");
    expect(formatCooldownRemaining(2 * 3_600_000 + 5 * 60_000)).toBe("2h 05m");
  });

  it("rounds up so a window never displays as already-expired", () => {
    expect(formatCooldownRemaining(1_000)).toBe("1s");
    expect(formatCooldownRemaining(60_500)).toBe("1m 01s");
  });
});
