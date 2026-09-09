// ============================================================================
// ZEN FREE-MODEL REGISTRY tests — the "stale static list" regression.
//
// Live verification of https://opencode.ai/zen/v1 (2026-08-30, keyless probes
// from a fresh network): free-model availability churns per model AND the
// free-usage limiter is IP-keyed, so the shipped static enabledModels list
// must (a) never contain dead/removed ids (hy3-free vanished from /models),
// (b) never contain region-locked ids shipped through the OpenAI-compatible
// /chat/completions route (muse-spark-1.2-contributor-free → 403 RegionError),
// and (c) default to a model that was VERIFIED answering at verification time.
//
// The registry is the single source of truth; catalog + mock-data must agree
// with it (consistency tests at the bottom).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  ZEN_VERIFICATION_DATE,
  ZEN_DEAD_MODEL_IDS,
  ZEN_REGION_LOCKED_MODEL_IDS,
  ZEN_PREFERRED_DEFAULT,
  ZEN_VERIFIED_WORKING_FREE_MODELS,
  sanitizeZenEnabledModels,
  pickZenDefaultModel,
  isZenFreeModelId,
  isZenRotationAllowed,
  ZEN_FREE_WHITELIST,
  filterZenIngestedModels,
  zenObserveFailure,
  zenRecordSuccess,
  zenResetRegistry,
  zenHealthyPool,
  isZenModelUsable,
} from "./zen-free-models";

describe("zen-free-models registry integrity", () => {
  it("dead and region-locked registries never overlap the verified-working list", () => {
    for (const id of [...ZEN_DEAD_MODEL_IDS, ...ZEN_REGION_LOCKED_MODEL_IDS]) {
      expect(ZEN_VERIFIED_WORKING_FREE_MODELS).not.toContain(id);
    }
  });

  it("the preferred default was verified answering at verification time", () => {
    expect(ZEN_VERIFIED_WORKING_FREE_MODELS).toContain(ZEN_PREFERRED_DEFAULT);
    expect(ZEN_VERIFICATION_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("sanitizeZenEnabledModels", () => {
  it("drops dead ids, region-locked ids and duplicates while preserving order", () => {
    const input = [
      "hy3-free",                       // dead (removed upstream)
      "nemotron-3-ultra-free",          // verified working
      "muse-spark-1.2-contributor-free",// region-locked (403)
      "nemotron-3-ultra-free",          // duplicate
      "laguna-s-2.1-free",              // verified working
      "north-mini-code-free",           // dead
    ];
    expect(sanitizeZenEnabledModels(input)).toEqual([
      "nemotron-3-ultra-free",
      "laguna-s-2.1-free",
    ]);
  });

  it("passes unknown-but-plausible ids through (availability churns; only known-dead are dropped)", () => {
    expect(sanitizeZenEnabledModels(["some-future-free-model"])).toEqual(["some-future-free-model"]);
  });

  it("returns an empty array for garbage input", () => {
    expect(sanitizeZenEnabledModels(undefined as any)).toEqual([]);
    expect(sanitizeZenEnabledModels(["", null as any, "  "])).toEqual([]);
  });
});

describe("isZenFreeModelId (edge guest gate)", () => {
  it("allows verified-working free ids and the -free family", () => {
    expect(isZenFreeModelId("nemotron-3-ultra-free")).toBe(true);
    expect(isZenFreeModelId("laguna-s-2.1-free")).toBe(true);
    expect(isZenFreeModelId("some-future-model-free")).toBe(true);
    expect(isZenFreeModelId("muse-spark-1.3-contributor")).toBe(true);
  });

  it("refuses paid ids that 401 keyless (CreditsError storm source)", () => {
    expect(isZenFreeModelId("mimo-v2.5")).toBe(false);
    expect(isZenFreeModelId("hy4-preview")).toBe(false);
    expect(isZenFreeModelId("gpt-5.5-pro")).toBe(false);
    expect(isZenFreeModelId("claude-fable-5")).toBe(false);
  });

  it("allows whitelisted ids even when the static dead list names them (user override; runtime evicts)", () => {
    expect(isZenFreeModelId("minimax-m2.5-free")).toBe(true);
    expect(isZenFreeModelId("big-pickle")).toBe(true);
  });

  it("passes any -free id at the gate (billing protection only — dead ids are stripped at runtime by the breaker)", () => {
    expect(isZenFreeModelId("hy3-free")).toBe(true);
    expect(isZenFreeModelId("muse-spark-1.2-contributor-free")).toBe(true);
  });

  it("refuses garbage input", () => {
    expect(isZenFreeModelId(undefined as any)).toBe(false);
    expect(isZenFreeModelId("")).toBe(false);
    expect(isZenFreeModelId("gpt-4o")).toBe(false);
  });
});

describe("isZenRotationAllowed (rotation/heal admission)", () => {
  it("admits the explicit whitelist verbatim, including churned ids", () => {
    for (const id of ZEN_FREE_WHITELIST) {
      expect(isZenRotationAllowed(id)).toBe(true);
    }
  });

  it("admits unknown -free ids but not dead or region-locked ones", () => {
    expect(isZenRotationAllowed("some-future-model-free")).toBe(true);
    expect(isZenRotationAllowed("hy3-free")).toBe(false);
    expect(isZenRotationAllowed("muse-spark-1.2-contributor-free")).toBe(false);
  });

  it("refuses paid ids", () => {
    expect(isZenRotationAllowed("mimo-v2.5")).toBe(false);
    expect(isZenRotationAllowed("gpt-4o")).toBe(false);
  });
});

describe("filterZenIngestedModels (pricing discrimination)", () => {
  it("keeps only zero/zero pricing when metadata is present", () => {
    expect(filterZenIngestedModels([
      { id: "a-free", pricing: { prompt: 0, completion: 0 } },
      { id: "b-pro", pricing: { prompt: 1, completion: 2 } },
      { id: "c-mixed", pricing: { prompt: 0, completion: 5 } },
    ])).toEqual(["a-free"]);
  });

  it("falls back to the name heuristic when pricing is omitted", () => {
    expect(filterZenIngestedModels([
      { id: "mimo-v2.5-free" },
      { id: "mimo-v2.5" },
      { id: "hy3-free" },
      { id: "big-pickle" },
    ])).toEqual(["mimo-v2.5-free", "big-pickle"]);
  });

  it("explicit zero pricing beats the static dead list; garbage is dropped", () => {
    expect(filterZenIngestedModels([
      { id: "minimax-m2.5-free", pricing: { prompt: 0, completion: 0 } },
    ])).toEqual(["minimax-m2.5-free"]);
    expect(filterZenIngestedModels(undefined as any)).toEqual([]);
    expect(filterZenIngestedModels([{ id: "" }, { id: 42 } as any])).toEqual([]);
  });
});

describe("ModelRegistry (adaptive eviction)", () => {
  it("evicts on 401/404/410, cools down on 429 with retry-after, recovers by time", () => {
    zenResetRegistry();
    const t0 = 1_000_000;
    expect(zenObserveFailure("m-paid", { statusCode: 401, message: "CreditsError: No payment method" }, t0)).toBe("evicted");
    expect(isZenModelUsable("m-paid", t0)).toBe(false);
    expect(zenHealthyPool(["m-paid", "m-free"], t0)).toEqual(["m-free"]);

    const err429: any = new Error("Rate limit exceeded");
    err429.statusCode = 429;
    err429.retryAfterSeconds = 120;
    expect(zenObserveFailure("m-free", err429, t0)).toBe("cooldown");
    expect(isZenModelUsable("m-free", t0)).toBe(false);
    expect(isZenModelUsable("m-free", t0 + 121_000)).toBe(true);

    zenRecordSuccess("m-free");
    zenResetRegistry();
    expect(isZenModelUsable("m-paid", t0)).toBe(true);
  });

  it("keyed callers ignore billing evictions but honor retirements", () => {
    zenResetRegistry();
    const t0 = 2_000_000;
    zenObserveFailure("m-bill", { statusCode: 401, message: "CreditsError" }, t0);
    zenObserveFailure("m-gone", { statusCode: 404, message: "Not found" }, t0);
    expect(isZenModelUsable("m-bill", t0, { keyed: true })).toBe(true);
    expect(isZenModelUsable("m-bill", t0)).toBe(false);
    expect(isZenModelUsable("m-gone", t0, { keyed: true })).toBe(false);
    zenResetRegistry();
  });
});

describe("pickZenDefaultModel", () => {
  it("picks the first enabled model that is not dead/region-locked", () => {
    expect(pickZenDefaultModel(["hy3-free", "nemotron-3-ultra-free", "laguna-s-2.1-free"]))
      .toBe("nemotron-3-ultra-free");
  });

  it("falls back to the verified preferred default when everything enabled is unusable", () => {
    expect(pickZenDefaultModel(["hy3-free", "muse-spark-1.2-contributor-free"]))
      .toBe(ZEN_PREFERRED_DEFAULT);
    expect(pickZenDefaultModel([])).toBe(ZEN_PREFERRED_DEFAULT);
    expect(pickZenDefaultModel(undefined as any)).toBe(ZEN_PREFERRED_DEFAULT);
  });
});

describe("shipped configuration consistency (catalog + seed data)", () => {
  it("provider-catalog defaults for the opencode family equal the verified preferred default", async () => {
    const { PROVIDER_CATALOG } = await import("./provider-catalog");
    for (const entry of PROVIDER_CATALOG.filter((e: any) =>
      ["opencode", "opencode-zen", "zencode"].includes(e.type)
    )) {
      expect(entry.defaultModel).toBe(ZEN_PREFERRED_DEFAULT);
    }
  });

  it("the built-in opencode seed provider carries no dead ids and defaults to a verified model", async () => {
    const { SEED_PROVIDERS } = await import("../mock-data");
    const zen = SEED_PROVIDERS.find((p: any) => p.type === "opencode");
    if (!zen) throw new Error("built-in opencode seed provider is missing from SEED_PROVIDERS");
    for (const id of [...ZEN_DEAD_MODEL_IDS, ...ZEN_REGION_LOCKED_MODEL_IDS]) {
      expect(zen.enabledModels).not.toContain(id);
    }
    expect(pickZenDefaultModel(zen.enabledModels)).toBe(zen.modelName);
    expect(ZEN_VERIFIED_WORKING_FREE_MODELS).toContain(zen.modelName);
  });
});
