// ============================================================================
// Task 24 — Upstream failure-domain diversion
//
// p_opencode ("OpenCode Zen") and p_zencode ("ZenCode") both point at
// opencode.ai — ONE Cloudflare-level, IP-keyed free limiter. When one sibling
// hits the 429 quota window, trying the other just burns a request against
// the same limited pool (and can extend the IP penalty). The optimizer must
// DIVERT: skip same-upstream siblings and jump to the next DISTINCT engine
// (NVIDIA / Mistral / Google / OpenRouter / Puter).
//
// Contract under test:
//   - upstreamDomainOf() normalizes baseUrl/apiUrl to the upstream host
//     (protocol, port, path, www stripped); providers without a URL fall
//     back to `type:<type>`; with neither, the provider id is its own domain
//     (never falsely diverted).
//   - buildUpstreamBlockMap(chain, isQuotaBlocked) maps each quota-blocked
//     provider's upstream domain → the FIRST blocked sibling id (chain order,
//     deterministic). Unblocked providers seed nothing.
//   - Router integration (chat path; stream shares the gate):
//       * a sibling whose upstream is quota-blocked is SKIPPED before any
//         attempt, with a structured skip_provider event:
//           reason: "upstream_quota_divert", blockedBy, domain, remainingMs
//       * the blocked provider itself keeps its accurate "cooldown" skip
//         (Task 18 semantics preserved)
//       * a LIVE 429 mid-chain arms the domain block for later siblings
//       * PROBES (requestType "test") bypass diversion entirely
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  upstreamDomainOf,
  buildUpstreamBlockMap,
  UPSTREAM_QUOTA_DIVERT_REASON,
} from "../upstream-domain";

// ---------------------------------------------------------------------------
// Part A — pure domain logic
// ---------------------------------------------------------------------------
describe("upstreamDomainOf", () => {
  it("normalizes baseUrl to the upstream host (protocol/path stripped)", () => {
    expect(upstreamDomainOf({ id: "p", baseUrl: "https://opencode.ai/zen/v1" })).toBe("opencode.ai");
  });

  it("ignores trailing slashes, port, www and host case", () => {
    expect(upstreamDomainOf({ id: "p", baseUrl: "HTTPS://WWW.OpenCode.AI:443/zen/v1/" })).toBe("opencode.ai");
  });

  it("falls back to apiUrl when baseUrl is empty", () => {
    expect(upstreamDomainOf({ id: "p", baseUrl: "", apiUrl: "https://integrate.api.nvidia.com/v1" })).toBe(
      "integrate.api.nvidia.com"
    );
  });

  it("URL-less providers are their own domain (never falsely diverted — same type proves nothing)", () => {
    expect(upstreamDomainOf({ id: "p_a", type: "puter" })).toBe("id:p_a");
    expect(upstreamDomainOf({ id: "p_b", type: "puter" })).toBe("id:p_b");
    expect(upstreamDomainOf({ id: "p_a" })).toBe("id:p_a");
    expect(upstreamDomainOf({ id: "p_b" })).toBe("id:p_b");
  });
});

describe("buildUpstreamBlockMap", () => {
  const CHAIN = [
    { id: "p_zencode", baseUrl: "https://opencode.ai/zen/v1" },
    { id: "p_opencode", baseUrl: "https://opencode.ai/zen/v1" },
    { id: "p_nvidia", baseUrl: "https://integrate.api.nvidia.com/v1" },
    { id: "p_mistral", baseUrl: "https://api.mistral.ai/v1" },
  ];

  it("maps the blocked provider's upstream domain to its id", () => {
    const map = buildUpstreamBlockMap(CHAIN, (id) => id === "p_opencode");
    expect(map.get("opencode.ai")).toBe("p_opencode");
    expect(map.size).toBe(1);
  });

  it("unblocked providers seed nothing", () => {
    const map = buildUpstreamBlockMap(CHAIN, () => false);
    expect(map.size).toBe(0);
  });

  it("first blocked sibling in chain order wins (deterministic)", () => {
    const map = buildUpstreamBlockMap(CHAIN, (id) => id === "p_opencode" || id === "p_zencode");
    expect(map.get("opencode.ai")).toBe("p_zencode");
  });

  it("distinct upstreams of blocked providers each get their own entry", () => {
    const map = buildUpstreamBlockMap(CHAIN, (id) => id === "p_opencode" || id === "p_nvidia");
    expect(map.get("opencode.ai")).toBe("p_opencode");
    expect(map.get("integrate.api.nvidia.com")).toBe("p_nvidia");
  });

  it("empty chain → empty map", () => {
    expect(buildUpstreamBlockMap([], () => true).size).toBe(0);
  });

  it("exposes the structured skip reason constant", () => {
    expect(UPSTREAM_QUOTA_DIVERT_REASON).toBe("upstream_quota_divert");
  });
});

// ---------------------------------------------------------------------------
// Part B — router integration (chat path)
// ---------------------------------------------------------------------------
const fakeAdapter = {
  type: "fake",
  chat: vi.fn(),
  testConnection: vi.fn(),
};

const gate = vi.hoisted(() => ({
  blockedIds: new Set<string>(["p_opencode"]),
  remainingMs: 25 * 60 * 1000,
  class: "quota" as string | null,
}));

const PROVIDERS = vi.hoisted(() => [
  {
    id: "p_zencode", name: "ZenCode", type: "fake", isActive: true, allowedForRegularUsers: true,
    baseUrl: "https://opencode.ai/zen/v1", modelName: "nemotron-3.5-lightning-free",
    enabledModels: ["nemotron-3.5-lightning-free"], priority: 10, retryAttempts: 0,
  },
  {
    id: "p_opencode", name: "OpenCode Zen", type: "fake", isActive: true, allowedForRegularUsers: true,
    baseUrl: "https://opencode.ai/zen/v1", modelName: "nemotron-3-ultra-free",
    enabledModels: ["nemotron-3-ultra-free"], priority: 11, retryAttempts: 0,
  },
  {
    id: "p_nvidia", name: "NVIDIA", type: "fake", isActive: true, allowedForRegularUsers: true,
    baseUrl: "https://integrate.api.nvidia.com/v1", modelName: "nvidia/nemotron-3-super-120b-a12b",
    enabledModels: ["nvidia/nemotron-3-super-120b-a12b"], priority: 12, retryAttempts: 0,
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
  uid: () => "pl-t24",
}));

vi.mock("../services/factory", () => ({
  ProviderFactory: { get: () => fakeAdapter },
  ProviderError: class extends Error {
    statusCode: number;
    constructor(msg: string, statusCode = 500) { super(msg); this.statusCode = statusCode; }
  },
}));

vi.mock("../../provider-cooldown", () => ({
  isProviderInCooldown: (id: string) => gate.blockedIds.has(id),
  getProviderCooldownRemainingMs: (id: string) => (gate.blockedIds.has(id) ? gate.remainingMs : 0),
  getProviderCooldownClass: (id: string) => (gate.blockedIds.has(id) ? gate.class : null),
  markProvider429Cooldown: vi.fn(),
  markProvider401Cooldown: vi.fn(),
  markProviderTimeoutCooldown: vi.fn(),
  markProviderQuotaCooldown: vi.fn(),
  markProviderRateLimitCooldown: vi.fn(),
  recordTrafficCooldownFromError: vi.fn(() => null),
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

import { ProviderRouter } from "../services/router";
import { globalEventBus } from "../../agent-event-bus";

const REQ = {
  messages: [
    { role: "system", content: "Respond in exactly one word: 'READY'." },
    { role: "user", content: "status check" },
  ],
  maxTokens: 5,
} as any;

function skipEvents(): any[] {
  return globalEventBus.getHistory().filter((e) => e.action === "skip_provider");
}

describe("router upstream diversion (chat)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalEventBus.clearHistory();
    gate.blockedIds = new Set<string>(["p_opencode"]);
    fakeAdapter.chat.mockResolvedValue({ text: "OK", provider: "fake", model: "m", latencyMs: 5 });
  });

  it("diverts the same-upstream sibling of a quota-blocked provider to the next distinct engine", async () => {
    const res = await ProviderRouter.chat(REQ, { requestType: "chat", timeoutMs: 5000 } as any);
    expect(res.text).toBe("OK");

    const events = skipEvents();
    // ZenCode skipped — upstream opencode.ai is in OpenCode's quota window
    const divert = events.find((e) => e.provider === "ZenCode");
    expect(divert).toBeTruthy();
    expect(divert.metadata.reason).toBe("upstream_quota_divert");
    expect(divert.metadata.blockedBy).toBe("p_opencode");
    expect(divert.metadata.domain).toBe("opencode.ai");
    expect(divert.metadata.remainingMs).toBe(25 * 60 * 1000);

    // OpenCode itself keeps the accurate Task 18 "cooldown" skip
    const own = events.find((e) => e.provider === "OpenCode Zen");
    expect(own).toBeTruthy();
    expect(own.metadata.reason).toBe("cooldown");

    // NVIDIA (distinct upstream) was actually attempted — exactly once
    expect(fakeAdapter.chat).toHaveBeenCalledTimes(1);
  });

  it("a LIVE 429 mid-chain arms the domain block for later siblings", async () => {
    const { recordTrafficCooldownFromError } = await import("../../provider-cooldown");
    (recordTrafficCooldownFromError as any).mockReturnValue("429");
    fakeAdapter.chat.mockRejectedValueOnce(
      Object.assign(new Error("opencode API 429: FreeUsageLimitError"), { statusCode: 429 })
    );

    gate.blockedIds = new Set<string>(); // nobody pre-blocked
    const res = await ProviderRouter.chat(REQ, { requestType: "chat", timeoutMs: 30000 } as any);
    expect(res.text).toBe("OK");

    // ZenCode (first, same upstream) failed live; OpenCode (sibling) must be
    // diverted WITHOUT an attempt; NVIDIA proceeds.
    const attempts = fakeAdapter.chat.mock.calls.length;
    expect(attempts).toBe(2); // ZenCode + NVIDIA only
    const divert = skipEvents().find((e) => e.provider === "OpenCode Zen");
    expect(divert).toBeTruthy();
    expect(divert.metadata.reason).toBe("upstream_quota_divert");
    expect(divert.metadata.blockedBy).toBe("p_zencode");
  });

  it("probes (requestType test) bypass diversion entirely", async () => {
    const res = await ProviderRouter.chat(REQ, { requestType: "test", timeoutMs: 5000 } as any);
    expect(res.text).toBe("OK");
    // ZenCode (priority 10) attempted first despite sibling's quota window
    expect(fakeAdapter.chat).toHaveBeenCalledTimes(1);
    expect(skipEvents().length).toBe(0);
  });
});
