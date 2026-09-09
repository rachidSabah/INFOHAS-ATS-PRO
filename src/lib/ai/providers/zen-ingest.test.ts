import { describe, it, expect, vi } from "vitest";
import {
  getZenFreeModelSet,
  evictZenModelFromKV,
  zenIngestResetMemory,
  ZEN_KV_KEY,
} from "./zen-ingest";

const BASE = "https://opencode.ai/zen/v1";

const catalog = {
  data: [
    { id: "nemotron-3-ultra-free", pricing: { prompt: 0, completion: 0 } },
    { id: "mimo-v2.5", pricing: { prompt: 1, completion: 2 } },
    { id: "big-pickle" },
  ],
};

const okFetch = () =>
  (async () =>
    new Response(JSON.stringify(catalog), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as any;

const memKv = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => {
      const raw = store.get(k);
      return raw === undefined ? null : JSON.parse(raw);
    }),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
};

describe("zen-ingest (dynamic ingestion)", () => {
  it("live fetch filters by pricing with heuristic fallback and writes KV through", async () => {
    zenIngestResetMemory();
    const kv = memKv();
    const set = await getZenFreeModelSet(BASE + "/t1", {
      fetchImpl: okFetch(),
      kv: kv as any,
    });
    expect(set).not.toBeNull();
    expect(set!.ids).toEqual(["nemotron-3-ultra-free", "big-pickle"]);
    expect(set!.pricingAvailable).toBe(true);
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(JSON.parse(kv.store.get(ZEN_KV_KEY)!)).toEqual(["nemotron-3-ultra-free", "big-pickle"]);
  });

  it("prefers the shared KV list and skips upstream entirely on hit", async () => {
    zenIngestResetMemory();
    const kv = memKv();
    kv.store.set(ZEN_KV_KEY, JSON.stringify(["nemotron-3-ultra-free"]));
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const set = await getZenFreeModelSet(BASE + "/t2", { fetchImpl: fetchImpl as any, kv: kv as any });
    expect(set!.ids).toEqual(["nemotron-3-ultra-free"]);
    expect(set!.via).toBe("kv");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("upstream failure resolves to null (callers keep static behavior)", async () => {
    zenIngestResetMemory();
    const failing = (async () => new Response("boom", { status: 429 })) as any;
    const set = await getZenFreeModelSet(BASE + "/t3", { fetchImpl: failing });
    expect(set).toBeNull();
  });

  it("evictZenModelFromKV prunes one id and keeps the rest", async () => {
    const kv = memKv();
    kv.store.set(ZEN_KV_KEY, JSON.stringify(["a-free", "b-free"]));
    const remaining = await evictZenModelFromKV(kv as any, "a-free");
    expect(remaining).toBe(1);
    expect(JSON.parse(kv.store.get(ZEN_KV_KEY)!)).toEqual(["b-free"]);
    expect(await evictZenModelFromKV(null, "b-free")).toBeNull();
  });
});
