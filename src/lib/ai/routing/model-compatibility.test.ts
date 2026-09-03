// ============================================================================
// Model compatibility tests (directives #6, #7, #8)
// - impossible provider/model pairs can never validate
// - canonical id plausibility
// - health-validated pairs beat stale declarations
// - known-dead ids are rejected
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkModelCompatibility,
  isModelCompatible,
  modelsForProvider,
  filterCompatibleRotationCandidates,
  isPlausibleCanonicalModelId,
  KNOWN_INVALID_MODEL_IDS,
} from "./model-compatibility";
import { aiHealthManager } from "../health/ai-health-manager";

function provider(overrides: Partial<any> = {}): any {
  return {
    id: "prov-1",
    name: "Provider One",
    type: "openai",
    modelName: "primary-model",
    enabledModels: ["primary-model", "second-model", "third-model"],
    status: "healthy",
    isActive: true,
    ...overrides,
  };
}

describe("isPlausibleCanonicalModelId (directive #7)", () => {
  it("rejects empty/whitespace/placeholder ids", () => {
    expect(isPlausibleCanonicalModelId("")).toBe(false);
    expect(isPlausibleCanonicalModelId(undefined)).toBe(false);
    expect(isPlausibleCanonicalModelId("hy3 free")).toBe(false); // display label artifact
    expect(isPlausibleCanonicalModelId("select")).toBe(false);
  });
  it("accepts real canonical ids", () => {
    expect(isPlausibleCanonicalModelId("mistral-large-latest")).toBe(true);
    expect(isPlausibleCanonicalModelId("gpt-4o-mini")).toBe(true);
  });
});

describe("checkModelCompatibility (directive #6)", () => {
  beforeEach(() => {
    aiHealthManager.reset();
  });

  it("accepts a provider-declared model", () => {
    const r = checkModelCompatibility(provider(), "second-model");
    expect(r.compatible).toBe(true);
    expect(r.evidence).toBe("provider-declared");
  });

  it("rejects a model NOT in the provider's enabled models", () => {
    const r = checkModelCompatibility(provider(), "other-provider-model");
    expect(r.compatible).toBe(false);
    expect(r.reason).toContain("enabled models");
  });

  it("rejects unknown provider", () => {
    expect(checkModelCompatibility(null, "x").compatible).toBe(false);
    expect(checkModelCompatibility(undefined, "x").compatible).toBe(false);
  });

  it("rejects invalid ids", () => {
    expect(checkModelCompatibility(provider(), "has space").compatible).toBe(false);
    expect(checkModelCompatibility(provider(), "").compatible).toBe(false);
  });

  it("rejects known-dead ids even if somehow declared (directive #8 evidence)", () => {
    const p = provider({ enabledModels: ["primary-model", "hy3-free"] });
    expect(KNOWN_INVALID_MODEL_IDS.has("hy3-free")).toBe(true);
    const r = checkModelCompatibility(p, "hy3-free");
    expect(r.compatible).toBe(false);
    expect(r.evidence).toBe("known-dead");
  });

  it("fail-closed when provider declares no models (no trusting static catalogs)", () => {
    const p = provider({ enabledModels: [], modelName: "" });
    const r = checkModelCompatibility(p, "anything");
    expect(r.compatible).toBe(false);
    expect(r.reason).toContain("cannot be verified");
  });

  it("health-validated pair beats stale declaration", () => {
    const p = provider({ enabledModels: ["primary-model"] });
    aiHealthManager.recordSuccess({ providerId: "prov-1", providerName: "Provider One", canonicalModelId: "newly-validated-model", ok: true });
    const r = checkModelCompatibility(p, "newly-validated-model");
    expect(r.compatible).toBe(true);
    expect(r.evidence).toBe("health-validated");
  });

  it("provider-reported unsupported model is rejected even if declared", () => {
    const p = provider({ enabledModels: ["primary-model", "bad-model"] });
    aiHealthManager.recordFailure({ providerId: "prov-1", canonicalModelId: "bad-model", ok: false, errorMessage: "Model not supported by provider" });
    const r = checkModelCompatibility(p, "bad-model");
    expect(r.compatible).toBe(false);
  });

  it("isModelCompatible boolean convenience", () => {
    expect(isModelCompatible(provider(), "second-model")).toBe(true);
    expect(isModelCompatible(provider(), "nope")).toBe(false);
  });
});

describe("modelsForProvider — model selector source (directive #6)", () => {
  it("returns compatibility-filtered models", () => {
    const p = provider({ enabledModels: ["primary-model", "hy3-free", "", "has space"] });
    const models = modelsForProvider(p);
    expect(models).toContain("primary-model");
    expect(models).not.toContain("hy3-free");
    expect(models).not.toContain("has space");
  });

  it("falls back to modelName when no list", () => {
    const p = provider({ enabledModels: [], modelName: "solo-model" });
    expect(modelsForProvider(p)).toEqual(["solo-model"]);
  });

  it("empty provider → empty list", () => {
    expect(modelsForProvider(undefined)).toEqual([]);
  });
});

describe("filterCompatibleRotationCandidates — only validated candidates rotate (directive #12)", () => {
  it("filters unknown, dead and excluded models", () => {
    const p = provider({ enabledModels: ["primary-model", "second-model", "hy3-free", "third-model"] });
    const out = filterCompatibleRotationCandidates(
      p,
      ["second-model", "hy3-free", "unknown-model", "third-model", "second-model"],
      new Set(["third-model"]),
    );
    expect(out).toEqual(["second-model"]);
  });
});
