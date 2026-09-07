// ============================================================================
// Task 19 — Puter account persistence + auto-rotation regression suite.
//
// User-visible bugs covered here:
//   1. "Add account → refresh → account gone": loadAccounts() used to treat
//      the API's EMPTY accounts array as authoritative, shadowing (wiping)
//      the locally persisted copy whenever the KV binding was missing/empty.
//   2. Self-heal: when the server copy is empty but the local copy has
//      accounts, the client now pushes the local copy back up.
//   3. Auto-rotate: on 429 the active account is cooled down and the next
//      healthy account is activated + retried (and NOT retried when the
//      user disabled auto-rotate).
//   4. refresh() rolls the ACTIVE ACCOUNT's expiry (previously only the
//      session's — every page load re-saw the account as expired).
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const LS_KEY = "puter_sessions";
const SESSION_KEY = "resumeai-provider-session-puter";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
}

function makeAccount(overrides: Record<string, any> = {}) {
  return {
    id: "acc-1",
    email: "user1@puter.com",
    userId: "u1",
    accessToken: null,
    refreshToken: null,
    expiresAt: Date.now() + 3600_000,
    connectedAt: Date.now(),
    active: true,
    status: "healthy",
    ...overrides,
  };
}

interface RecordedPost { url: string; body: any }

/**
 * Fetch stub that selects its response BY URL (call-count-based mocks get
 * misaligned across retries — same lesson as the manager direct-probe tests).
 * Every POST/PUT/DELETE is recorded and answered { ok: true }.
 */
function makeFetch(opts: {
  getAccounts?: () => any;
  getAccountsThrows?: boolean;
} = {}) {
  const posts: RecordedPost[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    const method = (init?.method || "GET").toUpperCase();
    if (method !== "GET") {
      let body: any = null;
      try { body = JSON.parse(init?.body || "null"); } catch { body = null; }
      posts.push({ url: u, body });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u.includes("/api/providers/puter/accounts")) {
      if (opts.getAccountsThrows) throw new Error("network down");
      const body = opts.getAccounts ? opts.getAccounts() : { activeAccount: null, accounts: null };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as any;
  fn._posts = posts;
  return fn;
}

async function flushAsync() {
  // Let fire-and-forget promises (self-heal saveAccounts) settle.
  await new Promise((r) => setTimeout(r, 10));
}

async function freshProvider(fetchMock: any) {
  vi.resetModules();
  (globalThis as any).fetch = fetchMock;
  const mod = await import("../providers/puter-provider");
  const provider = mod.getPuterProvider();
  return { mod, provider };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Puter account persistence (Task 19)", () => {
  let ls: ReturnType<typeof makeLocalStorage>;

  beforeEach(() => {
    ls = makeLocalStorage();
    (globalThis as any).window = {
      location: { origin: "https://test.local", hostname: "test.local" },
      localStorage: ls,
    };
    // The provider + session-manager read the BARE browser global
    // `localStorage` (=== window.localStorage in a real browser).
    (globalThis as any).localStorage = ls;
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
    delete (globalThis as any).fetch;
    vi.restoreAllMocks();
  });

  it("REGRESSION: an empty server account list must NOT shadow the local copy", async () => {
    ls.setItem(LS_KEY, JSON.stringify({
      accounts: [makeAccount()],
      autoRotate: true,
      useGlobally: false,
    }));
    // Server says "nothing stored" (accounts: null — the new honest shape).
    const fetchMock = makeFetch({ getAccounts: () => ({ activeAccount: null, accounts: null }) });
    const { provider } = await freshProvider(fetchMock);

    await provider.loadAccounts();

    expect(provider.accounts).toHaveLength(1);
    expect(provider.accounts[0].email).toBe("user1@puter.com");
    expect(provider.autoRotate).toBe(true);

    // Self-heal: local copy pushed back up to the server.
    await flushAsync();
    const syncPost = fetchMock._posts.find((p: RecordedPost) => p.url.includes("/api/providers/puter/accounts"));
    expect(syncPost).toBeTruthy();
    expect(syncPost.body.accounts).toHaveLength(1);
  });

  it("REGRESSION: the LEGACY empty-array shape must not shadow the local copy either", async () => {
    ls.setItem(LS_KEY, JSON.stringify({ accounts: [makeAccount()], autoRotate: true, useGlobally: true }));
    // Old (buggy) server response: accounts: [] — truthy in JS!
    const fetchMock = makeFetch({ getAccounts: () => ({ activeAccount: null, accounts: [], autoRotate: true, useGlobally: false }) });
    const { provider } = await freshProvider(fetchMock);

    await provider.loadAccounts();

    expect(provider.accounts).toHaveLength(1);
    expect(provider.accounts[0].email).toBe("user1@puter.com");
    expect(provider.useGlobally).toBe(true);
  });

  it("cloud copy is used when the local copy is empty (no self-heal POST then)", async () => {
    // localStorage intentionally empty — the API copy must be honored.
    const serverAccounts = [
      makeAccount({ id: "srv-1", email: "server1@puter.com" }),
      makeAccount({ id: "srv-2", email: "server2@puter.com", active: false }),
    ];
    const fetchMock = makeFetch({ getAccounts: () => ({ activeAccount: "server1@puter.com", accounts: serverAccounts, autoRotate: true, useGlobally: true }) });
    const { provider } = await freshProvider(fetchMock);

    await provider.loadAccounts();

    expect(provider.accounts).toHaveLength(2);
    expect(provider.accounts[0].email).toBe("server1@puter.com");
    expect(provider.useGlobally).toBe(true);

    await flushAsync();
    // Server was the SOURCE — no self-heal push-back for an API-sourced list.
    expect(fetchMock._posts.find((p: RecordedPost) => p.url.includes("/api/providers/puter/accounts"))).toBeFalsy();
  });

  it("no data anywhere — stays empty without crashing (no self-heal POST)", async () => {
    const fetchMock = makeFetch({ getAccounts: () => ({ accounts: null }) });
    const { provider } = await freshProvider(fetchMock);

    await provider.loadAccounts();

    expect(provider.accounts).toHaveLength(0);
    await flushAsync();
    expect(fetchMock._posts.find((p: RecordedPost) => p.url.includes("/api/providers/puter/accounts"))).toBeFalsy();
  });

  it("API network failure falls back to the local copy", async () => {
    ls.setItem(LS_KEY, JSON.stringify({ accounts: [makeAccount()], autoRotate: false, useGlobally: false }));
    const fetchMock = makeFetch({ getAccountsThrows: true });
    const { provider } = await freshProvider(fetchMock);

    await provider.loadAccounts();

    expect(provider.accounts).toHaveLength(1);
    expect(provider.accounts[0].email).toBe("user1@puter.com");
    expect(provider.autoRotate).toBe(false);
  });

  it("saveAccounts persists locally and pushes the server copy", async () => {
    const fetchMock = makeFetch();
    const { provider } = await freshProvider(fetchMock);
    (provider as any).accounts = [makeAccount()];
    provider.autoRotate = true;
    provider.useGlobally = false;

    await provider.saveAccounts();

    const raw = ls.getItem(LS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0].email).toBe("user1@puter.com");
    expect(parsed.autoRotate).toBe(true);

    const syncPost = fetchMock._posts.find((p: RecordedPost) => p.url.includes("/api/providers/puter/accounts"));
    expect(syncPost).toBeTruthy();
    expect(syncPost.body.useGlobally).toBe(false);
  });

  it("corrupt localStorage JSON is ignored without crashing", async () => {
    ls.setItem(LS_KEY, "{not-json");
    const fetchMock = makeFetch({ getAccounts: () => ({ accounts: null }) });
    const { provider } = await freshProvider(fetchMock);

    await provider.loadAccounts();

    expect(provider.accounts).toHaveLength(0);
  });
});

describe("Puter auto-rotate on 429 (Task 19)", () => {
  let ls: ReturnType<typeof makeLocalStorage>;

  function puterWindow(chatMock: any) {
    (globalThis as any).window = {
      location: { origin: "https://test.local", hostname: "test.local" },
      localStorage: ls,
      dispatchEvent: (e: any) => true,
      addEventListener: (_t: string, _l: any) => {},
      removeEventListener: (_t: string, _l: any) => {},
      puter: { ai: { chat: chatMock } },
    };
    (globalThis as any).localStorage = ls;
  }

  function authenticate(provider: any) {
    // Session is private — set it through the same channel the code uses.
    const session = (provider as any).session;
    session.authenticated = true;
    session.expiresAt = null; // never expires
    session.email = "user1@puter.com";
  }

  beforeEach(() => {
    ls = makeLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
    delete (globalThis as any).fetch;
    vi.restoreAllMocks();
  });

  it("rotates to the next healthy account on 429 and retries successfully", async () => {
    const chatMock = vi.fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests — quota exceeded"))
      .mockResolvedValueOnce({ message: { content: [{ text: "rotated-ok" }] } });
    puterWindow(chatMock);
    const fetchMock = makeFetch();
    const { provider } = await freshProvider(fetchMock);

    (provider as any).accounts = [
      makeAccount({ id: "a", email: "user1@puter.com", active: true, status: "healthy" }),
      makeAccount({ id: "b", email: "user2@puter.com", active: false, status: "healthy" }),
    ];
    provider.autoRotate = true;
    authenticate(provider);

    const result = await provider.generate({ userPrompt: "hi" });

    expect(result.text).toBe("rotated-ok");
    expect(chatMock).toHaveBeenCalledTimes(2);
    // The ACTIVE account is now the rotated-to account.
    const active = provider.accounts.find((a: any) => a.active);
    expect(active?.email).toBe("user2@puter.com");
    // The rate-limited account was cooled down.
    const a = provider.accounts.find((x: any) => x.id === "a");
    expect(a?.status).toBe("rate_limited");
    expect(a?.cooldownUntil).toBeGreaterThan(Date.now());
  });

  it("auto-rotate DISABLED — no rotation, quota-exhausted error thrown", async () => {
    const chatMock = vi.fn().mockRejectedValue(new Error("429 quota"));
    puterWindow(chatMock);
    const fetchMock = makeFetch();
    const { provider, mod } = await freshProvider(fetchMock);

    (provider as any).accounts = [
      makeAccount({ id: "a", email: "user1@puter.com", active: true }),
    ];
    provider.autoRotate = false;
    authenticate(provider);

    await expect(provider.generate({ userPrompt: "hi" })).rejects.toThrow(/exhausted/i);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(provider.accounts[0].active).toBe(true);
    expect(mod).toBeTruthy();
  });

  it("a rate-limited sibling whose cooldown EXPIRED is revived and rotated to", async () => {
    const chatMock = vi.fn()
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockResolvedValueOnce({ message: { content: "revived-ok" } });
    puterWindow(chatMock);
    const fetchMock = makeFetch();
    const { provider } = await freshProvider(fetchMock);

    (provider as any).accounts = [
      makeAccount({ id: "a", email: "user1@puter.com", active: true, status: "healthy" }),
      makeAccount({
        id: "b",
        email: "user2@puter.com",
        active: false,
        status: "rate_limited",
        cooldownUntil: Date.now() - 1000, // expired cooldown
      }),
    ];
    provider.autoRotate = true;
    authenticate(provider);

    const result = await provider.generate({ userPrompt: "hi" });

    expect(result.text).toBe("revived-ok");
    const b = provider.accounts.find((x: any) => x.id === "b");
    expect(b?.status).toBe("healthy");
    expect(b?.cooldownUntil).toBeUndefined();
    expect(provider.accounts.find((x: any) => x.id === "b")?.active).toBe(true);
  });
});

describe("Puter session refresh rolls the account expiry (Task 19)", () => {
  let ls: ReturnType<typeof makeLocalStorage>;

  beforeEach(() => {
    ls = makeLocalStorage();
    (globalThis as any).window = {
      location: { origin: "https://test.local", hostname: "test.local" },
      localStorage: ls,
      puter: {
        auth: {
          isSignedIn: () => true,
          getUser: async () => ({ email: "user1@puter.com", username: "user1" }),
        },
      },
    };
    (globalThis as any).localStorage = ls;
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
    delete (globalThis as any).fetch;
    vi.restoreAllMocks();
  });

  it("refresh() extends the ACTIVE ACCOUNT's expiresAt and heals an expired status", async () => {
    const fetchMock = makeFetch();
    const { provider } = await freshProvider(fetchMock);

    const staleExpiry = Date.now() - 5000;
    (provider as any).accounts = [
      makeAccount({ id: "a", email: "user1@puter.com", active: true, expiresAt: staleExpiry, status: "expired" }),
    ];
    const session = (provider as any).session;
    session.authenticated = true;
    session.email = "user1@puter.com";
    session.expiresAt = staleExpiry;

    await provider.refresh();

    const a = provider.accounts.find((x: any) => x.id === "a");
    expect(a?.expiresAt).toBeGreaterThan(Date.now());
    expect(a?.status).toBe("healthy");

    // The session file was re-persisted with the new expiry.
    const sessionRaw = ls.getItem(SESSION_KEY);
    expect(sessionRaw).toBeTruthy();
    const persisted = JSON.parse(sessionRaw as string);
    expect(persisted.expiresAt).toBeGreaterThan(Date.now());
  });
});
