import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ProviderFactory } from "../ai/services/factory";
import { ProviderRouter } from "../ai/services/router";
import { useApp } from "../store";

// Local engine must never rescue exhausted providers in these tests.
vi.mock("../local-engine", () => ({
  localGenerate: vi.fn(() => null),
}));

const chatMock = vi.fn();

const mockAdapter = {
  type: "mock-selfthrottle",
  chat: chatMock,
  testConnection: vi.fn(async () => ({ ok: true, latencyMs: 1, message: "ok" })),
};

ProviderFactory.register("mock-selfthrottle", mockAdapter as any);

// Exactly what middleware.ts returns on 429 (wrapped by adapters as "Proxy: …").
const selfThrottleErr = (wrapped = true) => {
  const body = JSON.stringify({ error: "Rate limit exceeded. Please try again later." });
  const e: any = new Error(wrapped ? `Proxy: ${body}` : "Rate limit exceeded. Please try again later.");
  e.statusCode = 429;
  return e;
};

const upstreamQuotaErr = () => {
  const e: any = new Error("Proxy: API returned HTTP 429: Rate limit reached for model X (retry-after: 60s)");
  e.statusCode = 429;
  return e;
};

const makeProvider = (over: Record<string, any> = {}) => ({
  id: "p_selfthrottle",
  name: "Self Throttle Provider",
  type: "mock-selfthrottle",
  isActive: true,
  priority: 1,
  apiKey: "primary-key",
  alternateApiKeys: ["alt-key-1", "alt-key-2"],
  modelName: "m1",
  enabledModels: ["m1"],
  retryAttempts: 0,
  timeout: 30000,
  allowedForRegularUsers: true,
  ...over,
});

const setState = (providers: any[]) => {
  useApp.setState({
    user: { role: "super_admin" } as any,
    providers: providers as any,
    providerSettings: {
      defaultProviderId: providers[0]?.id ?? "",
      fallbackProviderIds: [],
      retryAttempts: 0,
    } as any,
  });
};

const chatReq = { messages: [{ role: "user" as const, content: "hello world" }], model: "m1" };

import { clearProviderCooldownOnSuccess } from "../provider-cooldown";

beforeEach(() => {
  chatMock.mockReset();
  clearProviderCooldownOnSuccess("p_selfthrottle");
});

afterEach(() => {
  chatMock.mockReset();
  clearProviderCooldownOnSuccess("p_selfthrottle");
});

describe("ProviderRouter.isSelfThrottleError", () => {
  it("detects our own edge rate-limiter message (raw and Proxy-wrapped)", () => {
    expect(ProviderRouter.isSelfThrottleError(selfThrottleErr(false))).toBe(true);
    expect(ProviderRouter.isSelfThrottleError(selfThrottleErr(true))).toBe(true);
  });

  it("does NOT flag upstream provider quota 429s as self-throttle", () => {
    expect(ProviderRouter.isSelfThrottleError(upstreamQuotaErr())).toBe(false);
    expect(ProviderRouter.isSelfThrottleError(new Error("Too many requests"))).toBe(false);
  });
});

describe("self-throttle 429 never rotates keys", () => {
  it("makes exactly 1 call (no alternate-key rotation) on edge self-throttle", async () => {
    chatMock.mockRejectedValue(selfThrottleErr());
    setState([makeProvider({ id: "p_selfthrottle_a", name: "Self Throttle Provider" })]);

    await expect(ProviderRouter.chat(chatReq as any, {})).rejects.toThrow(/Self Throttle Provider|All AI providers failed/);
    // No key rotation: the alternate keys would only burn more edge quota.
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("still rotates alternate keys on upstream quota 429s", async () => {
    chatMock.mockImplementation(async (req: any, config: any) => {
      if (config.apiKey === "primary-key") throw upstreamQuotaErr();
      return { text: "alt-ok", provider: "mock-selfthrottle", model: "m1", latencyMs: 5 };
    });
    setState([makeProvider({ id: "p_selfthrottle_b", name: "Upstream Quota Provider" })]);

    const res = await ProviderRouter.chat(chatReq as any, {});
    expect(res.text).toBe("alt-ok");
    expect(chatMock).toHaveBeenCalledTimes(2);
  });
});
