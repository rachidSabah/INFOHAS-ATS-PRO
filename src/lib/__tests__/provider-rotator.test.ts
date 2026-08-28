import { describe, it, expect, vi, afterEach } from "vitest";
import { ProviderFactory } from "../ai/services/factory";
import { ProviderRouter } from "../ai/services/router";
import { useApp } from "../store";

// Local engine must never rescue exhausted providers in these tests.
vi.mock("../local-engine", () => ({
  localGenerate: vi.fn(() => null),
}));

// === Mock adapter registered under a dedicated type ===
const chatMock = vi.fn();
const streamMock = vi.fn();

const mockAdapter = {
  type: "mock-rot",
  chat: chatMock,
  testConnection: vi.fn(async () => ({ ok: true, latencyMs: 1, message: "ok" })),
  stream: streamMock,
};

ProviderFactory.register("mock-rot", mockAdapter as any);

const rateErr = (msg = "Rate limit exceeded", statusCode = 429) => {
  const e: any = new Error(msg);
  e.statusCode = statusCode;
  return e;
};

const makeProvider = (over: Record<string, any> = {}) => ({
  id: "p_rottest",
  name: "Rotator Test Provider",
  type: "mock-rot",
  isActive: true,
  priority: 1,
  apiKey: "primary-key",
  alternateApiKeys: ["alt-key-1"],
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
      retryAttempts: 2,
    } as any,
  });
};

const chatReq = { messages: [{ role: "user" as const, content: "hello world" }], model: "m1" };

const okRes = (text = "alt-ok") => ({ text, provider: "mock-rot", model: "m1", latencyMs: 5 });

afterEach(() => {
  chatMock.mockReset();
  streamMock.mockReset();
});

describe("API Rotator — ProviderRouter.tryProviderWithRotations", () => {
  it("rotates to an alternate API key on 429 and persists the swap (primary ↔ alt)", async () => {
    chatMock.mockImplementation(async (req: any, config: any) => {
      if (config.apiKey === "primary-key") throw rateErr();
      return okRes();
    });
    setState([makeProvider({ id: "p_rottest_a", name: "A" })]);

    const res = await ProviderRouter.chat(chatReq as any, {});

    expect(res.text).toBe("alt-ok");
    // Exactly 2 calls: primary key, then the alternate key.
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(chatMock.mock.calls[0][1].apiKey).toBe("primary-key");
    expect(chatMock.mock.calls[1][1].apiKey).toBe("alt-key-1");

    // The swap must be persisted so future requests start with the working key.
    const p = useApp.getState().providers.find((x: any) => x.id === "p_rottest_a")!;
    expect(p.apiKey).toBe("alt-key-1");
    expect(p.alternateApiKeys).toEqual(["primary-key"]);
  });

  it("rotates keys on CreditsError (credit exhaustion) — not just on 429/auth", async () => {
    chatMock.mockImplementation(async (req: any, config: any) => {
      if (config.apiKey === "primary-key") throw new Error("CreditsError: insufficient credits");
      return okRes();
    });
    setState([makeProvider({ id: "p_rottest_b", name: "B" })]);

    const res = await ProviderRouter.chat(chatReq as any, {});
    expect(res.text).toBe("alt-ok");
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT rotate on unrelated errors (e.g. context length limit)", async () => {
    chatMock.mockImplementation(async () => {
      throw rateErr("Context length limit exceeded for model m1", 400);
    });
    setState([makeProvider({ id: "p_rottest_c", name: "C" })]);

    await expect(ProviderRouter.chat(chatReq as any, {})).rejects.toThrow(/All AI providers failed/);

    // No rotation attempts — the alternate key must never be tried for a 400.
    expect(chatMock).toHaveBeenCalledTimes(1);
    const p = useApp.getState().providers.find((x: any) => x.id === "p_rottest_c")!;
    expect(p.apiKey).toBe("primary-key");
    expect(p.alternateApiKeys).toEqual(["alt-key-1"]);
  });

  it("does NOT re-try already-failed alternate keys across retry attempts (call-amplification guard)", async () => {
    chatMock.mockImplementation(async (req: any, config: any) => {
      // 503 + "quota" → retryable (5xx) AND rotation-worthy — the exact
      // combination that previously caused rotations to repeat per attempt.
      throw rateErr("quota exceeded", 503);
    });
    setState([
      makeProvider({ id: "p_rottest_d", name: "D", retryAttempts: 1, enabledModels: ["m1"] }),
    ]);

    await expect(ProviderRouter.chat(chatReq as any, {})).rejects.toThrow();

    // Attempt 1: primary + alt. Attempt 2: primary only (alt already tried).
    expect(chatMock).toHaveBeenCalledTimes(3);
    const triedKeys = chatMock.mock.calls.map((c: any[]) => c[1].apiKey);
    expect(triedKeys).toEqual(["primary-key", "alt-key-1", "primary-key"]);
  });

  it("rotates models within enabledModels on 429 and persists the new default", async () => {
    chatMock.mockImplementation(async (req: any, config: any) => {
      if (config.modelName === "m2") return okRes("m2-ok");
      throw rateErr();
    });
    setState([
      makeProvider({ id: "p_rottest_e", name: "E", alternateApiKeys: [], enabledModels: ["m1", "m2"] }),
    ]);

    const res = await ProviderRouter.chat(chatReq as any, {});
    expect(res.text).toBe("m2-ok");

    // Second call must carry the rotated model.
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(chatMock.mock.calls[1][0].model).toBe("m2");

    const p = useApp.getState().providers.find((x: any) => x.id === "p_rottest_e")!;
    expect(p.modelName).toBe("m2");
  });

  it("moves to the next provider in the chain after exhausting all rotations", async () => {
    chatMock.mockImplementation(async (req: any, config: any) => {
      if (config.id === "p_rottest_f1") {
        // Both the primary key AND the alternate key fail for F1.
        throw rateErr();
      }
      return okRes("provider2-ok");
    });
    setState([
      makeProvider({ id: "p_rottest_f1", name: "F1", priority: 1 }),
      makeProvider({ id: "p_rottest_f2", name: "F2", priority: 2, alternateApiKeys: [] }),
    ]);

    const res = await ProviderRouter.chat(chatReq as any, {});
    expect(res.text).toBe("provider2-ok");
    // p1 primary + p1 alt + p2 primary
    expect(chatMock).toHaveBeenCalledTimes(3);
  });
});

describe("API Rotator — streaming path", () => {
  it("stream() falls back to key rotation when the stream fails with 429", async () => {
    streamMock.mockImplementation(async () => {
      throw rateErr();
    });
    chatMock.mockImplementation(async (req: any, config: any) => {
      if (config.apiKey === "primary-key") throw rateErr();
      return okRes();
    });
    setState([makeProvider({ id: "p_rottest_g", name: "G" })]);

    const chunks: string[] = [];
    const res = await ProviderRouter.stream(chatReq as any, {}, (t: string) => chunks.push(t));

    // The rotated (non-streaming) retry result is delivered as chunks.
    expect(res.text).toBe("alt-ok");
    expect(chunks.join("")).toContain("alt-ok");

    // stream attempted once (no retry on stream), rotation used chat with alt key.
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(chatMock.mock.calls[0][1].apiKey).toBe("alt-key-1");

    const p = useApp.getState().providers.find((x: any) => x.id === "p_rottest_g")!;
    expect(p.apiKey).toBe("alt-key-1");
  });
});
