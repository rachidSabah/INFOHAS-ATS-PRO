// ============================================================================
// S2 — Structured router skip reasons (Task 18)
//
// When the router skips a provider (cooldown / tracker backoff / busy), the
// only observable artifact was a generic string in the errors array — the
// trajectory panel could not answer "WHY was my provider skipped and for
// how long?".
//
// Contract under test (chat path; the stream path shares the gate):
//   - every traffic skip emits a structured globalEventBus event:
//       agent: "ProviderRouter", action: "skip_provider", success: false,
//       provider: <name>, metadata: { reason, class, remainingMs, layer }
//   - layer "tracker" (rate-limit tracker backoff) and layer "session"
//     (sessionStorage cooldown) are distinguishable
//   - remainingMs is REAL (from the cooldown store), not a hardcoded 60s
//   - PROBES (requestType "test") bypass the gate entirely → NO skip event
//   - the human-readable error string is preserved (failover logs unchanged)
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeAdapter = {
  type: "fake",
  chat: vi.fn(),
  testConnection: vi.fn(),
};

const gate = vi.hoisted(() => ({
  trackerLimited: false,
  trackerRemainingMs: 120_000,
  sessionCooldown: false,
  sessionClass: "quota" as string | null,
  sessionRemainingMs: 25 * 60 * 1000,
}));

const PROVIDERS = vi.hoisted(() => [
  {
    id: "p_s2", name: "ZenCode", type: "fake", isActive: true, allowedForRegularUsers: true,
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
  uid: () => "pl-s2",
}));

vi.mock("./factory", () => ({
  ProviderFactory: { get: () => fakeAdapter },
  ProviderError: class extends Error {},
}));

vi.mock("../../provider-cooldown", () => ({
  isProviderInCooldown: () => gate.sessionCooldown,
  getProviderCooldownRemainingMs: () =>
    gate.sessionCooldown ? gate.sessionRemainingMs : 0,
  getProviderCooldownClass: () => (gate.sessionCooldown ? gate.sessionClass : null),
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
    isRateLimited: () => gate.trackerLimited,
    getCooldownRemainingMs: () => gate.trackerRemainingMs,
    record429: vi.fn(),
    recordSuccess: vi.fn(),
  },
  RATE_LIMIT_BACKOFF_CAP_MS: 30 * 60 * 1000,
}));

vi.mock("../../local-engine", () => ({ localGenerate: () => "" }));

import { ProviderRouter } from "./router";
import { globalEventBus } from "../../agent-event-bus";

const REQ = {
  messages: [
    { role: "system", content: "Respond in exactly one word: 'READY'." },
    { role: "user", content: "status check" },
  ],
  maxTokens: 5,
} as any;

const OPTS = {
  singleProvider: true,
  preferredProviderId: "p_s2",
  requestType: "chat",
  timeoutMs: 5000,
} as any;

/** Collect skip_provider events from the global bus. */
function skipEvents(): any[] {
  return globalEventBus.getHistory().filter((e) => e.action === "skip_provider");
}

/** chat() that tolerates total failure (returns the thrown error). */
async function chatSoft(): Promise<Error | null> {
  try {
    await ProviderRouter.chat(REQ, { ...OPTS });
    return null;
  } catch (e: any) {
    return e;
  }
}

beforeEach(() => {
  globalEventBus.clearHistory();
  fakeAdapter.chat.mockReset();
  fakeAdapter.chat.mockResolvedValue({ text: "READY", model: "hy3-free", latencyMs: 5 });
  gate.trackerLimited = false;
  gate.sessionCooldown = false;
});

describe("S2 — structured skip_provider events", () => {
  it("session-cooldown skip emits {reason: cooldown, class, remainingMs, layer: session}", async () => {
    gate.sessionCooldown = true;
    const err = await chatSoft();
    expect(err?.message).toMatch(/All AI providers failed/i);
    const evt = skipEvents().find((e) => e.provider === "ZenCode");
    expect(evt).toBeDefined();
    expect(evt.agent).toBe("ProviderRouter");
    expect(evt.success).toBe(false);
    expect(evt.metadata.reason).toBe("cooldown");
    expect(evt.metadata.layer).toBe("session");
    expect(evt.metadata.class).toBe("quota");
    expect(evt.metadata.remainingMs).toBe(25 * 60 * 1000);
  });

  it("tracker-backoff skip emits {reason: cooldown, layer: tracker}", async () => {
    gate.trackerLimited = true;
    await chatSoft();
    const evt = skipEvents().find((e) => e.provider === "ZenCode");
    expect(evt).toBeDefined();
    expect(evt.metadata.layer).toBe("tracker");
    expect(evt.metadata.remainingMs).toBe(120_000);
  });

  it("the error string stays human-readable (failover log unchanged)", async () => {
    gate.sessionCooldown = true;
    const err = await chatSoft();
    expect(err?.message).toMatch(/ZenCode: in cooldown \(\d+s remaining\)/);
  });

  it("remaining seconds in the message reflect the REAL window (not hardcoded 60)", async () => {
    gate.sessionCooldown = true;
    gate.sessionRemainingMs = 29 * 60 * 1000; // 1740s
    const err = await chatSoft();
    expect(err?.message).toMatch(/in cooldown \(17\d\ds remaining\)/);
  });

  it("a probe (requestType 'test') bypasses the gate and emits NO skip event", async () => {
    gate.sessionCooldown = true;
    gate.trackerLimited = true;
    await ProviderRouter.chat(REQ, { ...OPTS, requestType: "test" });
    expect(skipEvents().length).toBe(0);
    expect(fakeAdapter.chat).toHaveBeenCalledTimes(1);
  });

  it("a healthy provider produces no skip events", async () => {
    await chatSoft();
    expect(skipEvents().length).toBe(0);
  });
});
