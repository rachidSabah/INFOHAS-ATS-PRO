import { describe, it, expect, vi, afterEach } from "vitest";
import { ProviderFactory } from "../ai/services/factory";
import { ProviderRouter } from "../ai/services/router";
import { useApp } from "../store";
import {
  zenResetRegistry,
  zenModelStatus,
  ZEN_ZERO_MODEL_VALVE,
} from "../ai/zen-free-models";

vi.mock("../local-engine", () => ({
  localGenerate: vi.fn(() => null),
}));

const zenChatMock = vi.fn();
const workersChatMock = vi.fn();

ProviderFactory.register("opencode-zen", {
  type: "opencode-zen",
  chat: zenChatMock,
  testConnection: vi.fn(async () => ({ ok: true, latencyMs: 1, message: "ok" })),
} as any);

ProviderFactory.register("workers-ai", {
  type: "workers-ai",
  chat: workersChatMock,
  testConnection: vi.fn(async () => ({ ok: true, latencyMs: 1, message: "ok" })),
} as any);

const err401 = () => {
  const e: any = new Error("API returned HTTP 401: CreditsError: No payment method");
  e.statusCode = 401;
  return e;
};

const err429 = () => {
  const e: any = new Error("API returned HTTP 429: FreeUsageLimitError: Rate limit exceeded");
  e.statusCode = 429;
  e.retryAfterSeconds = 60;
  return e;
};

const makeZen = (over: Record<string, any> = {}) => ({
  id: "p_zentest",
  name: "Zen Test",
  type: "opencode-zen",
  isActive: true,
  priority: 1,
  apiKey: "",
  alternateApiKeys: [],
  modelName: "nemotron-3-ultra-free",
  enabledModels: ["nemotron-3-ultra-free", "mimo-v2.5-free"],
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

const chatReq = (model: string) => ({
  messages: [{ role: "user" as const, content: "hello world" }],
  model,
});

afterEach(() => {
  zenChatMock.mockReset();
  workersChatMock.mockReset();
  zenResetRegistry();
});

describe("Zen adaptive eviction (router)", () => {
  it("never spends an upstream call on a paid primary — cascades to free immediately", async () => {
    zenChatMock.mockImplementation(async (req: any) => {
      if (req.model === "nemotron-3-ultra-free") {
        return { text: "free-ok", provider: "zen", model: req.model, latencyMs: 5 };
      }
      throw err401();
    });
    setState([makeZen({ id: "p_z1", modelName: "mimo-v2.5", enabledModels: ["mimo-v2.5", "nemotron-3-ultra-free"] })]);

    const res = await ProviderRouter.chat(chatReq("mimo-v2.5") as any, {});
    expect(res.text).toBe("free-ok");
    const tried = zenChatMock.mock.calls.map((c: any[]) => c[0].model);
    expect(tried).toEqual(["nemotron-3-ultra-free"]);
  });

  it("evicts a whitelisted-but-dead id on 401 and cascades within the same run", async () => {
    zenChatMock.mockImplementation(async (req: any) => {
      if (req.model === "minimax-m2.5-free") throw err401();
      return { text: "ultra-ok", provider: "zen", model: req.model, latencyMs: 5 };
    });
    setState([makeZen({
      id: "p_z2",
      modelName: "minimax-m2.5-free",
      enabledModels: ["minimax-m2.5-free", "nemotron-3-ultra-free"],
    })]);

    const res = await ProviderRouter.chat(chatReq("minimax-m2.5-free") as any, {});
    expect(res.text).toBe("ultra-ok");
    expect(zenModelStatus("minimax-m2.5-free")).toBe("evicted");
    const tried = zenChatMock.mock.calls.map((c: any[]) => c[0].model);
    expect(tried).toEqual(["minimax-m2.5-free", "nemotron-3-ultra-free"]);
  });

  it("cools down a 429 model and cascades to the next free id", async () => {
    zenChatMock.mockImplementation(async (req: any) => {
      if (req.model === "nemotron-3-ultra-free") throw err429();
      return { text: "mimo-ok", provider: "zen", model: req.model, latencyMs: 5 };
    });
    setState([makeZen({
      id: "p_z3",
      modelName: "nemotron-3-ultra-free",
      enabledModels: ["nemotron-3-ultra-free", "mimo-v2.5-free"],
    })]);

    const res = await ProviderRouter.chat(chatReq("nemotron-3-ultra-free") as any, {});
    expect(res.text).toBe("mimo-ok");
    expect(zenModelStatus("nemotron-3-ultra-free")).toBe("cooldown");
  });

  it("zero healthy models → Workers AI safety valve, no zen call, no crash", async () => {
    workersChatMock.mockImplementation(async (req: any) => ({
      text: "valve-ok", provider: "Workers AI (native)", model: req.model, latencyMs: 5,
    }));
    setState([makeZen({ id: "p_z4" })]);
    const { zenObserveFailure } = await import("../ai/zen-free-models");
    zenObserveFailure("nemotron-3-ultra-free", err401());
    zenObserveFailure("mimo-v2.5-free", err429());

    const res = await ProviderRouter.chat(chatReq("nemotron-3-ultra-free") as any, {});
    expect(res.text).toBe("valve-ok");
    expect(zenChatMock).not.toHaveBeenCalled();
    expect(workersChatMock).toHaveBeenCalledTimes(1);
    expect(workersChatMock.mock.calls[0][0].model).toBe(ZEN_ZERO_MODEL_VALVE);
  });
});
