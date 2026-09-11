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
  isZenChatUpstream,
  ZEN_RELAY_HOST,
  ZEN_RELAY_BASE_URL,
  isCanonicalZenBaseUrl,
  resolveZenEgressBaseUrl,
  zenSessionHeaders,
  zenHealthStatusOverride,
  isRateLimitShaped,
  isZenSharedEgressSymptom,
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

describe("zen session header gate (MissingSessionID fix)", () => {
  it("detects the opencode.ai host or a /zen relay path as Zen chat upstream", () => {
    expect(isZenChatUpstream("https://opencode.ai/zen/v1")).toBe(true);
    expect(isZenChatUpstream("https://OPENCODE.AI/zen/v1")).toBe(true);
    // Relay escape hatch (docs/ZEN_SHARED_EGRESS_HEALTH.md): any host serving
    // a /zen path prefix is treated as a Zen mirror — session headers, quota
    // grace and the free-model registry follow it automatically.
    expect(isZenChatUpstream("https://relay.example.com/zen/v1")).toBe(true);
    expect(isZenChatUpstream("https://10.0.0.7:8080/ZEN/v1")).toBe(true);
    expect(isZenChatUpstream("https://api.openai.com/v1")).toBe(false);
    expect(isZenChatUpstream("https://relay.example.com/openai/v1")).toBe(false);
    expect(isZenChatUpstream("https://opencode.ai.evil.example/v1")).toBe(false);
    expect(isZenChatUpstream("")).toBe(false);
    expect(isZenChatUpstream(null)).toBe(false);
    expect(isZenChatUpstream("not a url")).toBe(false);
  });

  it("injects x-opencode-session only for Zen and varies per request", () => {
    const zenBase = "https://opencode.ai/zen/v1";
    const h1 = zenSessionHeaders(zenBase);
    const h2 = zenSessionHeaders(zenBase);
    expect(h1["x-opencode-session"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(h2["x-opencode-session"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(h1["x-opencode-session"]).not.toBe(h2["x-opencode-session"]);
    expect(zenSessionHeaders("https://api.openai.com/v1")).toEqual({});
    expect(zenSessionHeaders(undefined)).toEqual({});
  });

  it("injects x-opencode-session for a /zen relay too", () => {
    const h = zenSessionHeaders("https://relay.example.com/zen/v1");
    expect(h["x-opencode-session"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

describe("zen quota-grace health override (enableZenQuotaGrace)", () => {
  const base = {
    graceEnabled: true,
    isZen: true,
    consecutiveFailures: 5,
    lastError: "HTTP 429 FreeUsageLimitError — free tier exhausted",
  };

  it("keeps a quota-throttled Zen provider green", () => {
    expect(zenHealthStatusOverride({ ...base, currentStatus: "down" })).toBe("healthy");
    expect(zenHealthStatusOverride({ ...base, currentStatus: "degraded" })).toBe("healthy");
  });

  it("never claims verification for an untested provider", () => {
    expect(zenHealthStatusOverride({ ...base, currentStatus: "untested" })).toBe("untested");
    expect(zenHealthStatusOverride({ ...base, currentStatus: null })).toBe("untested");
  });

  it("does not mask real failures (auth / model / outage)", () => {
    expect(zenHealthStatusOverride({ ...base, lastError: "401 invalid api key" })).toBeNull();
    expect(zenHealthStatusOverride({ ...base, lastError: "404 model not found" })).toBeNull();
    expect(zenHealthStatusOverride({ ...base, lastError: "502 bad gateway" })).toBeNull();
  });

  it("applies only to Zen upstreams and only when the flag is on", () => {
    expect(zenHealthStatusOverride({ ...base, isZen: false })).toBeNull();
    expect(zenHealthStatusOverride({ ...base, graceEnabled: false })).toBeNull();
  });

  it("treats a clean provider (no lastError) as healthy under grace", () => {
    expect(zenHealthStatusOverride({ ...base, lastError: null, currentStatus: "down" })).toBe("healthy");
  });

  it("recognizes quota-shaped errors", () => {
    expect(isRateLimitShaped("HTTP 429")).toBe(true);
    expect(isRateLimitShaped("FreeUsageLimitError")).toBe(true);
    expect(isRateLimitShaped("you hit your quota")).toBe(true);
    expect(isRateLimitShaped("too many requests")).toBe(true);
    expect(isRateLimitShaped("connection refused")).toBe(false);
  });
});

// ============================================================================
// Task 38 — shared-egress symptom detection (CF-only posture). Cloudflare
// WAF challenges / firewall blocks / 52x edge errors from the SHARED egress
// pool are IP-reputation symptoms, never application-level failures.
// ============================================================================
describe("isZenSharedEgressSymptom (shared-egress WAF/edge fingerprints)", () => {
  it("matches Cloudflare challenge-page fingerprints", () => {
    expect(isZenSharedEgressSymptom("API returned HTTP 403 Forbidden: <!DOCTYPE html><title>Attention Required! | Cloudflare</title>")).toBe(true);
    expect(isZenSharedEgressSymptom("<html>Just a moment...</html><!-- cf-ray: 8f2a -->")).toBe(true);
    expect(isZenSharedEgressSymptom("error code: 1015 — you are being rate limited")).toBe(true);
    expect(isZenSharedEgressSymptom("error code: 1020 — Access ruled out by firewall")).toBe(true);
    expect(isZenSharedEgressSymptom("cloudflare HTML response instead of JSON")).toBe(true);
  });

  it("matches Cloudflare 52x edge errors in text and status form", () => {
    expect(isZenSharedEgressSymptom("API returned HTTP 522: Connection timed out")).toBe(true);
    expect(isZenSharedEgressSymptom("error code: 521 — web server is down")).toBe(true);
    expect(isZenSharedEgressSymptom("upstream failed", 522)).toBe(true);
    expect(isZenSharedEgressSymptom(null, 530)).toBe(true);
  });

  it("never matches real application-level failures", () => {
    // A bare 403 without Cloudflare markers stays a real auth failure.
    expect(isZenSharedEgressSymptom("API returned HTTP 403 Forbidden: invalid api key")).toBe(false);
    // Zen's real AuthError JSON carries no Cloudflare markers.
    expect(isZenSharedEgressSymptom('{"error":{"type":"AuthError","message":"Invalid API key"}}')).toBe(false);
    expect(isZenSharedEgressSymptom("401 unauthorized")).toBe(false);
    expect(isZenSharedEgressSymptom("404 model not found")).toBe(false);
    expect(isZenSharedEgressSymptom("502 bad gateway")).toBe(false);
    expect(isZenSharedEgressSymptom("503 service unavailable")).toBe(false);
    expect(isZenSharedEgressSymptom("", null)).toBe(false);
    expect(isZenSharedEgressSymptom(null, 200)).toBe(false);
    expect(isZenSharedEgressSymptom(null, 429)).toBe(false);
  });

  it("extends the display override: WAF-shaped lastError keeps Zen green, real errors still mask through", () => {
    const base = {
      graceEnabled: true,
      isZen: true,
      consecutiveFailures: 4,
      currentStatus: "down",
    };
    expect(zenHealthStatusOverride({ ...base, lastError: "HTTP 403 Attention Required | Cloudflare" })).toBe("healthy");
    expect(zenHealthStatusOverride({ ...base, lastError: "API returned HTTP 522: Connection timed out" })).toBe("healthy");
    // Real failures still follow normal rules.
    expect(zenHealthStatusOverride({ ...base, lastError: "401 invalid api key" })).toBeNull();
    expect(zenHealthStatusOverride({ ...base, lastError: "404 model not found" })).toBeNull();
  });
});

// ============================================================================
// Managed Vercel relay routing (zenRelayEnabled) — the deployed escape hatch
// from Cloudflare's SHARED egress pool (docs/ZEN_SHARED_EGRESS_HEALTH.md,
// vercel-relay/ in the repo root, live at ats-zen-relay.vercel.app).
// ============================================================================
describe("zen relay routing (zenRelayEnabled)", () => {
  it("recognizes the canonical gateway as the routing target", () => {
    expect(isCanonicalZenBaseUrl("https://opencode.ai/zen/v1")).toBe(true);
    expect(isCanonicalZenBaseUrl("https://OPENCODE.ai/zen/v1")).toBe(true);
    expect(isCanonicalZenBaseUrl(ZEN_RELAY_BASE_URL)).toBe(false); // already relayed
    expect(isCanonicalZenBaseUrl("https://relay.example.com/zen/v1")).toBe(false);
    expect(isCanonicalZenBaseUrl("https://api.openai.com/v1")).toBe(false);
    expect(isCanonicalZenBaseUrl("opencode.ai.evil.example")).toBe(false);
    expect(isCanonicalZenBaseUrl("")).toBe(false);
    expect(isCanonicalZenBaseUrl(null)).toBe(false);
    expect(isCanonicalZenBaseUrl(undefined)).toBe(false);
  });

  it("swaps the canonical host for the relay, preserving path and query", () => {
    expect(resolveZenEgressBaseUrl("https://opencode.ai/zen/v1", true)).toBe(ZEN_RELAY_BASE_URL);
    expect(resolveZenEgressBaseUrl("https://opencode.ai/zen/v1/", true)).toBe(
      `${ZEN_RELAY_BASE_URL}/`
    );
    expect(resolveZenEgressBaseUrl("https://opencode.ai/zen/v1/chat/completions", true)).toBe(
      `${ZEN_RELAY_BASE_URL}/chat/completions`
    );
    expect(resolveZenEgressBaseUrl("https://opencode.ai/zen/v1/models?key=k", true)).toBe(
      `${ZEN_RELAY_BASE_URL}/models?key=k`
    );
  });

  it("passes everything through untouched when the flag is off", () => {
    expect(resolveZenEgressBaseUrl("https://opencode.ai/zen/v1", false)).toBe(
      "https://opencode.ai/zen/v1"
    );
    expect(resolveZenEgressBaseUrl("https://opencode.ai/zen/v1", undefined as unknown as boolean)).toBe(
      "https://opencode.ai/zen/v1"
    );
  });

  it("never touches non-canonical URLs (relays, mirrors, other providers)", () => {
    expect(resolveZenEgressBaseUrl(ZEN_RELAY_BASE_URL, true)).toBe(ZEN_RELAY_BASE_URL);
    expect(resolveZenEgressBaseUrl("https://relay.example.com/zen/v1", true)).toBe(
      "https://relay.example.com/zen/v1"
    );
    expect(resolveZenEgressBaseUrl("https://api.openai.com/v1", true)).toBe("https://api.openai.com/v1");
    expect(resolveZenEgressBaseUrl("https://opencode.ai.evil.example/v1", true)).toBe(
      "https://opencode.ai.evil.example/v1"
    );
  });

  it("handles empty/malformed input without throwing", () => {
    expect(resolveZenEgressBaseUrl("", true)).toBe("");
    expect(resolveZenEgressBaseUrl(null, true)).toBeNull();
    expect(resolveZenEgressBaseUrl(undefined, true)).toBeUndefined();
    expect(resolveZenEgressBaseUrl("not a url", true)).toBe("not a url");
  });

  it("does not route canonical-host URLs that lack the /zen API prefix", () => {
    // Degenerate config (opencode type, bare host): leave it alone rather
    // than sending it to the relay root, which 404s with a usage message.
    expect(resolveZenEgressBaseUrl("https://opencode.ai/v1", true)).toBe("https://opencode.ai/v1");
  });

  it("keeps the relay URL itself recognized as a Zen upstream (path detection)", () => {
    // The whole point: after the swap, session headers / quota grace /
    // free-model registry follow because the path still says /zen.
    expect(isZenChatUpstream(ZEN_RELAY_BASE_URL)).toBe(true);
    expect(isZenChatUpstream(`https://${ZEN_RELAY_HOST}/zen/v1/chat/completions`)).toBe(true);
    expect(zenSessionHeaders(ZEN_RELAY_BASE_URL)["x-opencode-session"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
