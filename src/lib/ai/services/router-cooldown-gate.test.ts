// ============================================================================
// COOLDOWN-GATE tests — probes are EVIDENCE, traffic is USAGE.
//
// Task 15 established: probes (requestType "test") never ARM cooldowns.
// This file pins the symmetric half of that contract, which the P1 quota
// cooldown made load-bearing:
//
//   1. PROBE BYPASS — cooldowns gate REAL traffic only. A health probe
//      (benchmark ping, heal diagnosis/retest, HEALTH CHECK button) must
//      reach a cooled-down provider; otherwise nothing can ever re-test it,
//      heal pings fail with an unclassifiable "in cooldown (Xs remaining)"
//      error (the "unknown / failed AUTO heal" history noise), and the
//      evidence-based early clear could never fire.
//
//   2. REAL TRAFFIC still skips cooled-down providers (failover unchanged).
//
//   3. SUCCESS EVIDENCE — a successful call clears the provider's cooldown
//      immediately (recovery observed beats any timer).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeAdapter = {
  type: "fake",
  chat: vi.fn(),
  testConnection: vi.fn(),
};

const clearProviderCooldownOnSuccessMock = vi.hoisted(() => vi.fn());

/** Mutable gate state — tests flip these to control the two cooldown layers. */
const gate = vi.hoisted(() => ({ trackerLimited: true, sessionCooldown: true }));

const PROVIDERS = vi.hoisted(() => [
  {
    id: "p_z", name: "ZenCode", type: "fake", isActive: true, allowedForRegularUsers: true,
    modelName: "hy3-free", enabledModels: ["hy3-free"], priority: 10, retryAttempts: 0,
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
  uid: () => "pl-test",
}));

vi.mock("./factory", () => ({
  ProviderFactory: { get: () => fakeAdapter },
  ProviderError: class extends Error {},
}));

vi.mock("../../provider-cooldown", () => ({
  isProviderInCooldown: () => gate.sessionCooldown, // the whole provider chain is "in cooldown"
  markProvider429Cooldown: vi.fn(),
  markProvider401Cooldown: vi.fn(),
  markProviderTimeoutCooldown: vi.fn(),
  markProviderQuotaCooldown: vi.fn(),
  markProviderRateLimitCooldown: vi.fn(),
  recordTrafficCooldownFromError: vi.fn(),
  clearProviderCooldownOnSuccess: clearProviderCooldownOnSuccessMock,
  isTimeoutError: () => false,
  clearAllProviderCooldowns: vi.fn(),
}));

vi.mock("../../rate-limit-tracker", () => ({
  rateLimitTracker: {
    isRateLimited: () => gate.trackerLimited, // and the tracker also blocks it
    getCooldownRemainingMs: () => 120_000,
    record429: vi.fn(),
    recordSuccess: vi.fn(),
  },
}));

vi.mock("../../local-engine", () => ({ localGenerate: () => "" }));

import { ProviderRouter } from "./router";

const REQ = {
  messages: [
    { role: "system", content: "Respond in exactly one word: 'READY'." },
    { role: "user", content: "status check" },
  ],
  maxTokens: 5,
} as any;

beforeEach(() => {
  fakeAdapter.chat.mockReset();
  clearProviderCooldownOnSuccessMock.mockClear();
  gate.trackerLimited = true;
  gate.sessionCooldown = true;
});

describe("router cooldown gate — probes bypass, traffic obeys", () => {
  it("a probe (requestType 'test') reaches a provider that is in cooldown", async () => {
    fakeAdapter.chat.mockResolvedValue({ text: "READY", model: "hy3-free", latencyMs: 5 });
    const res = await ProviderRouter.chat(REQ, {
      singleProvider: true,
      preferredProviderId: "p_z",
      requestType: "test",
      timeoutMs: 5000,
    } as any);
    expect(fakeAdapter.chat).toHaveBeenCalledTimes(1);
    expect(res.text).toBe("READY");
  });

  it("real traffic is still skipped while the provider is in cooldown", async () => {
    await expect(
      ProviderRouter.chat(REQ, {
        singleProvider: true,
        preferredProviderId: "p_z",
        requestType: "chat",
        timeoutMs: 5000,
      } as any)
    ).rejects.toThrow(/All AI providers failed/i);
    expect(fakeAdapter.chat).not.toHaveBeenCalled();
  });

  it("a successful call clears the provider's cooldown (evidence of recovery)", async () => {
    gate.trackerLimited = false;
    gate.sessionCooldown = false; // not blocked — e.g. cooldown armed under a stale key
    fakeAdapter.chat.mockResolvedValue({ text: "READY", model: "hy3-free", latencyMs: 5 });
    await ProviderRouter.chat(REQ, {
      singleProvider: true,
      preferredProviderId: "p_z",
      requestType: "chat",
      timeoutMs: 5000,
    } as any);
    expect(fakeAdapter.chat).toHaveBeenCalledTimes(1);
    expect(clearProviderCooldownOnSuccessMock).toHaveBeenCalledWith("p_z");
  });

  it("a successful PROBE also clears the cooldown (heal retest = recovery evidence)", async () => {
    fakeAdapter.chat.mockResolvedValue({ text: "READY", model: "hy3-free", latencyMs: 5 });
    await ProviderRouter.chat(REQ, {
      singleProvider: true,
      preferredProviderId: "p_z",
      requestType: "test",
      timeoutMs: 5000,
    } as any);
    expect(clearProviderCooldownOnSuccessMock).toHaveBeenCalledWith("p_z");
  });
});
