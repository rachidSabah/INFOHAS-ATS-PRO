// ============================================================================
// S3 — Per-provider concurrency limiter (Task 18)
//
// The pipeline fires parallel AI calls (intelligence stage: Job Intelligence
// + Company Intelligence; locked pipeline: Summary/Skills/Experience
// optimizers). All of them funnel into the SAME provider on free setups —
// 4 simultaneous requests to one free-tier provider can self-inflict 429s
// that look identical to provider-side exhaustion.
//
// Contract under test (provider-concurrency module):
//   - acquire/release: at most PROVIDER_CONCURRENCY_CAP in-flight per provider
//   - an acquire beyond the cap WAITS up to maxWaitMs, then reports busy
//   - release frees the slot for the next waiter
//   - probes (requestType "test") always pass and never consume slots
//   - caps are PER PROVIDER — provider B is unaffected by provider A's cap
//
// Router integration:
//   - with the provider's cap saturated, real traffic skips it with a
//     structured busy event and falls through to the next provider
//   - probes are never throttled
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  acquireProviderSlot,
  releaseProviderSlot,
  getProviderInFlight,
  setProviderConcurrencyOpts,
  DEFAULT_PROVIDER_CONCURRENCY,
} from "../../provider-concurrency";

beforeEach(() => {
  // Reset the module's tables between tests via the public test hook.
  setProviderConcurrencyOpts({ cap: DEFAULT_PROVIDER_CONCURRENCY, maxWaitMs: 10_000 });
});

describe("S3 — semaphore semantics", () => {
  it("allows up to cap concurrent acquisitions, then reports busy after the wait", async () => {
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 40 });
    expect(await acquireProviderSlot("prov-a")).toBe(true);
    expect(await acquireProviderSlot("prov-a")).toBe(true);
    const t0 = Date.now();
    expect(await acquireProviderSlot("prov-a")).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    expect(getProviderInFlight("prov-a")).toBe(2);
  });

  it("release frees the slot for the next acquirer", async () => {
    setProviderConcurrencyOpts({ cap: 1, maxWaitMs: 40 });
    expect(await acquireProviderSlot("prov-b")).toBe(true);
    expect(await acquireProviderSlot("prov-b")).toBe(false);
    releaseProviderSlot("prov-b");
    expect(await acquireProviderSlot("prov-b")).toBe(true);
    expect(getProviderInFlight("prov-b")).toBe(1);
  });

  it("probes bypass: always acquire, never consume", async () => {
    setProviderConcurrencyOpts({ cap: 1, maxWaitMs: 20 });
    // Traffic call occupies the only slot:
    expect(await acquireProviderSlot("prov-c")).toBe(true);
    // A probe still passes instantly (never queued, never counted):
    expect(await acquireProviderSlot("prov-c", { probe: true })).toBe(true);
    expect(await acquireProviderSlot("prov-c", { probe: true })).toBe(true);
    expect(getProviderInFlight("prov-c")).toBe(1); // only the traffic call counts
    releaseProviderSlot("prov-c"); // traffic release only
    expect(getProviderInFlight("prov-c")).toBe(0);
  });

  it("caps are per provider — a saturated provider does not block others", async () => {
    setProviderConcurrencyOpts({ cap: 1, maxWaitMs: 20 });
    expect(await acquireProviderSlot("prov-d1")).toBe(true);
    expect(await acquireProviderSlot("prov-d2")).toBe(true);
    expect(await acquireProviderSlot("prov-d1")).toBe(false);
    expect(await acquireProviderSlot("prov-d2")).toBe(false);
  });

  it("waiting acquires succeed when a slot frees up in time", async () => {
    setProviderConcurrencyOpts({ cap: 1, maxWaitMs: 300 });
    expect(await acquireProviderSlot("prov-e")).toBe(true);
    const waiter = acquireProviderSlot("prov-e");
    setTimeout(() => releaseProviderSlot("prov-e"), 50);
    expect(await waiter).toBe(true);
    releaseProviderSlot("prov-e");
  });
});

// ============================================================================
// Router integration — busy providers are skipped, not pounded
// ============================================================================

const fakeAdapter = {
  type: "fake",
  chat: vi.fn(),
  testConnection: vi.fn(),
};

const PROVIDERS = vi.hoisted(() => [
  {
    id: "p_busy", name: "BusyProv", type: "fake", isActive: true, allowedForRegularUsers: true,
    modelName: "m-free", enabledModels: ["m-free"], priority: 10, retryAttempts: 0,
  },
]);

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers: PROVIDERS,
      providerSettings: { fallbackProviderIds: [], retryAttempts: 0 },
      user: { role: "super_admin" },
      addProviderLog: vi.fn(),
      updateProvider: vi.fn(),
    }),
  },
  uid: () => "pl-s3",
}));

vi.mock("./factory", () => ({
  ProviderFactory: { get: () => fakeAdapter },
  ProviderError: class extends Error {},
}));

vi.mock("../../provider-cooldown", () => ({
  isProviderInCooldown: () => false,
  getProviderCooldownRemainingMs: () => 0,
  getProviderCooldownClass: () => null,
  markProvider429Cooldown: vi.fn(),
  markProvider401Cooldown: vi.fn(),
  markProviderTimeoutCooldown: vi.fn(),
  markProviderQuotaCooldown: vi.fn(),
  markProviderRateLimitCooldown: vi.fn(),
  recordTrafficCooldownFromError: vi.fn(),
  clearProviderCooldownOnSuccess: vi.fn(),
  isTimeoutError: () => false,
  clearAllProviderCooldowns: vi.fn(),
}));

vi.mock("../../rate-limit-tracker", () => ({
  rateLimitTracker: {
    isRateLimited: () => false,
    getCooldownRemainingMs: () => 0,
    record429: vi.fn(),
    recordSuccess: vi.fn(),
  },
  RATE_LIMIT_BACKOFF_CAP_MS: 30 * 60 * 1000,
}));

vi.mock("../../local-engine", () => ({ localGenerate: () => "" }));

import { ProviderRouter } from "./router";
import { globalEventBus } from "../../agent-event-bus";

const REQ = {
  messages: [{ role: "user", content: "status check" }],
  maxTokens: 5,
} as any;

const OPTS = {
  singleProvider: true,
  preferredProviderId: "p_busy",
  requestType: "chat",
  timeoutMs: 8000,
} as any;

describe("S3 — router integration", () => {
  beforeEach(() => {
    globalEventBus.clearHistory();
    fakeAdapter.chat.mockReset();
    fakeAdapter.chat.mockResolvedValue({ text: "READY", model: "m-free", latencyMs: 5 });
    setProviderConcurrencyOpts({ cap: 1, maxWaitMs: 60 });
  });

  it("saturated provider is skipped with a structured busy event (adapter NOT called)", async () => {
    expect(await acquireProviderSlot("p_busy")).toBe(true);
    await expect(ProviderRouter.chat(REQ, OPTS)).rejects.toThrow(/All AI providers failed/i);
    expect(fakeAdapter.chat).not.toHaveBeenCalled();
    const evt = globalEventBus
      .getHistory()
      .find((e) => e.action === "skip_provider" && e.provider === "BusyProv");
    expect(evt).toBeDefined();
    expect(evt!.metadata!.reason).toBe("provider_busy");
    expect(evt!.metadata!.inFlight).toBe(1);
    releaseProviderSlot("p_busy");
  });

  it("after release, the same traffic call succeeds", async () => {
    expect(await acquireProviderSlot("p_busy")).toBe(true);
    releaseProviderSlot("p_busy");
    const res = await ProviderRouter.chat(REQ, OPTS);
    expect(res.text).toBe("READY");
  });

  it("probes reach a saturated provider (bypass)", async () => {
    expect(await acquireProviderSlot("p_busy")).toBe(true);
    await ProviderRouter.chat(REQ, { ...OPTS, requestType: "test" });
    expect(fakeAdapter.chat).toHaveBeenCalledTimes(1);
    releaseProviderSlot("p_busy");
  });
});

// ============================================================================
// Task 19 — the limiter reads the cap from the ROUTED provider object
// (AIProvider.concurrencyCap). Free tiers keep it tight; paid endpoints can
// raise it above the global default so parallel agents actually overlap.
// ============================================================================

describe("S3 polish — provider-configured cap (router wiring)", () => {
  beforeEach(() => {
    globalEventBus.clearHistory();
    fakeAdapter.chat.mockReset();
    // Hold the slot long enough that a capped-out call's maxWaitMs elapses
    // while the first attempt is STILL in flight (a fast adapter would free
    // the slot in time and the waiter would legitimately succeed).
    fakeAdapter.chat.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { text: "READY", model: "m-free", latencyMs: 150 };
    });
    setProviderConcurrencyOpts({ cap: 2, maxWaitMs: 60 });
    delete (PROVIDERS[0] as any).concurrencyCap;
  });

  it("provider cap 1 < global 2: parallel chats → one runs, one busy-skips", async () => {
    (PROVIDERS[0] as any).concurrencyCap = 1;
    const first = ProviderRouter.chat(REQ, OPTS);
    const second = ProviderRouter.chat(REQ, OPTS).catch((e: any) => e);
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.text).toBe("READY");
    expect(String(r2.message)).toMatch(/All AI providers failed/i);
    expect(fakeAdapter.chat).toHaveBeenCalledTimes(1); // never pounded
    const evt = globalEventBus
      .getHistory()
      .find((e) => e.action === "skip_provider" && e.provider === "BusyProv");
    expect(evt).toBeDefined();
    expect(evt!.metadata!.reason).toBe("provider_busy");
    expect(evt!.metadata!.cap).toBe(1); // busy event reports the effective cap
  });

  it("provider cap 4 > global 1: parallel chats BOTH run (paid headroom)", async () => {
    setProviderConcurrencyOpts({ cap: 1, maxWaitMs: 60 });
    (PROVIDERS[0] as any).concurrencyCap = 4;
    const [r1, r2] = await Promise.all([
      ProviderRouter.chat(REQ, OPTS),
      ProviderRouter.chat(REQ, OPTS),
    ]);
    expect(r1.text).toBe("READY");
    expect(r2.text).toBe("READY");
    expect(fakeAdapter.chat).toHaveBeenCalledTimes(2); // truly concurrent
  });
});
