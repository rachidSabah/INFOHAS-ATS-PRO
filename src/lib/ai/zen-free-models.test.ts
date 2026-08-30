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
