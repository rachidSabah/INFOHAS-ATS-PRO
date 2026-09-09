import { describe, it, expect, vi } from "vitest";
import {
  probeZenModel,
  ingestZenCatalog,
  refreshZenVerifiedModels,
} from "./zen-cron-probe";

const BASE = "https://opencode.ai/zen/v1";

const jsonRes = (status: number, body: any) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );

describe("zen-cron-probe", () => {
  it("probe passes only on HTTP 200", async () => {
    const ok = () => jsonRes(200, { choices: [{ message: { content: "pong" } }] });
    expect(await probeZenModel(BASE, "a-free", "", { fetchImpl: ok })).toBe(true);
    expect(await probeZenModel(BASE, "a-free", "", {
      fetchImpl: (() => jsonRes(401, { error: "nope" })) as any,
    })).toBe(false);
    expect(await probeZenModel(BASE, "a-free", "", {
      fetchImpl: (async () => { throw new Error("down"); }) as any,
    })).toBe(false);
  });

  it("ingest discriminates pricing and drops paid ids", async () => {
    const catalog = {
      data: [
        { id: "a-free", pricing: { prompt: 0, completion: 0 } },
        { id: "b-pro", pricing: { prompt: 1, completion: 0 } },
        { id: "c-free" },
      ],
    };
    const out = await ingestZenCatalog(BASE, "", { fetchImpl: (() => jsonRes(200, catalog)) as any });
    expect(out!.candidates).toEqual(["a-free", "c-free"]);
    expect(out!.pricingAvailable).toBe(true);
    expect(await ingestZenCatalog(BASE, "", { fetchImpl: (() => jsonRes(500, {})) as any })).toBeNull();
  });

  it("refresh keeps only probed-healthy ids and returns null when none survive", async () => {
    const catalog = { data: [{ id: "good-free" }, { id: "bad-free" }] };
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      if (String(url).endsWith("/models")) return jsonRes(200, catalog);
      const body = JSON.parse(String(init.body));
      return jsonRes(body.model === "good-free" ? 200 : 404, {});
    });
    const out = await refreshZenVerifiedModels(BASE, "", { fetchImpl: fetchImpl as any });
    expect(out!.ids).toEqual(["good-free"]);

    const allDead = vi.fn(async (url: any) => {
      if (String(url).endsWith("/models")) return jsonRes(200, catalog);
      return jsonRes(429, {});
    });
    expect(await refreshZenVerifiedModels(BASE, "", { fetchImpl: allDead as any })).toBeNull();
  });
});
