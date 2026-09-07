// Identity isolation primitives — getEffectiveUserId() + userScopedKey().
//
// Contract under test:
//  1. sessionStorage id wins (set by setUserId on sign-in).
//  2. Fallback: the persisted session in localStorage — so a freshly opened
//     tab (empty sessionStorage) uses the SAME identity instead of "anonymous"
//     (all anonymous browsers used to share one D1 user_id bucket → leak).
//  3. Expired/corrupted session payload → "anonymous".
//  4. userScopedKey namespaces crash-recovery backup keys per identity, so
//     one user's backup can never be restored into another user's session.

import { describe, it, expect, beforeEach } from "vitest";
import { getEffectiveUserId, userScopedKey } from "./cloud-api";

type Store = Record<string, string>;

function makeStorage() {
  const data: Store = {};
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = String(v); },
    removeItem: (k: string) => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    _data: data,
  };
}

describe("getEffectiveUserId", () => {
  beforeEach(() => {
    const session = makeStorage();
    const local = makeStorage();
    (globalThis as any).window = {
      sessionStorage: session,
      localStorage: local,
    };
    (globalThis as any).sessionStorage = session;
    (globalThis as any).localStorage = local;
  });

  it("prefers the sessionStorage id set by setUserId", () => {
    (globalThis as any).sessionStorage.setItem("resumeai-user-id", "u_abc123");
    expect(getEffectiveUserId()).toBe("u_abc123");
  });

  it("falls back to the persisted localStorage session when sessionStorage is empty (new tab)", () => {
    (globalThis as any).localStorage.setItem(
      "resumeai-session",
      JSON.stringify({ user: { id: "u_persisted" }, expiresAt: Date.now() + 60_000 })
    );
    expect(getEffectiveUserId()).toBe("u_persisted");
    // Heals sessionStorage so subsequent reads are consistent.
    expect((globalThis as any).sessionStorage.getItem("resumeai-user-id")).toBe("u_persisted");
  });

  it("returns anonymous when the persisted session is expired", () => {
    (globalThis as any).localStorage.setItem(
      "resumeai-session",
      JSON.stringify({ user: { id: "u_expired" }, expiresAt: Date.now() - 60_000 })
    );
    expect(getEffectiveUserId()).toBe("anonymous");
  });

  it("returns anonymous when the persisted session payload is corrupted", () => {
    (globalThis as any).localStorage.setItem("resumeai-session", "{not-json");
    expect(getEffectiveUserId()).toBe("anonymous");
  });

  it("returns anonymous when no identity source exists", () => {
    expect(getEffectiveUserId()).toBe("anonymous");
  });
});

describe("userScopedKey", () => {
  beforeEach(() => {
    const session = makeStorage();
    const local = makeStorage();
    (globalThis as any).window = {
      sessionStorage: session,
      localStorage: local,
    };
    (globalThis as any).sessionStorage = session;
    (globalThis as any).localStorage = local;
  });

  it("namespaces the backup key with the effective user id", () => {
    (globalThis as any).sessionStorage.setItem("resumeai-user-id", "u_alice");
    expect(userScopedKey("resumeai-resumes-backup")).toBe("resumeai-resumes-backup:u_alice");
  });

  it("yields a DIFFERENT key for a different identity — the isolation guarantee", () => {
    (globalThis as any).sessionStorage.setItem("resumeai-user-id", "u_alice");
    const aliceKey = userScopedKey("resumeai-resumes-backup");
    (globalThis as any).sessionStorage.setItem("resumeai-user-id", "u_bob");
    const bobKey = userScopedKey("resumeai-resumes-backup");
    expect(aliceKey).not.toBe(bobKey);
  });

  it("falls back to the anonymous suffix when no identity exists", () => {
    expect(userScopedKey("resumeai-jds-backup")).toBe("resumeai-jds-backup:anonymous");
  });
});
