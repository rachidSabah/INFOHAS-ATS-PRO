// ============================================================================
// Pipeline Profile Resolution tests (Task 7 — Pipeline Profiles are LIVE).
//
// Verifies that every built-in profile produces the runtime decisions the
// orchestrator consumes, that the env fallback reproduces the exact
// pre-profile behavior, and that the store-selected profile is resolved.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineProfile } from "../pipeline-orchestration-types";
import { SEED_PIPELINE_PROFILES } from "../pipeline-orchestration-seeds";

const storeState: { pipelineProfiles: PipelineProfile[]; selectedProfileId: string } = {
  pipelineProfiles: SEED_PIPELINE_PROFILES,
  selectedProfileId: "profile-hybrid",
};

vi.mock("../store", () => ({
  useApp: {
    getState: () => storeState,
  },
}));

import { resolveProfileRuntime, getSelectedProfile, describeProfileRuntime } from "./profile-resolution";

const byId = (id: string) => SEED_PIPELINE_PROFILES.find((p) => p.id === id)!;

describe("resolveProfileRuntime — built-in profiles", () => {
  it("Hybrid (default): locked + V3 ON + regeneration ON + hybrid matching + 4 attempts + threshold 80", () => {
    const cfg = resolveProfileRuntime(byId("profile-hybrid"));
    expect(cfg.useLockedPipeline).toBe(true);
    expect(cfg.enableV3PostOptimization).toBe(true);
    expect(cfg.enableTargetedRegeneration).toBe(true);
    expect(cfg.matchingStrategy).toBe("hybrid");
    expect(cfg.maxOptimizeAttempts).toBe(4);
    expect(cfg.reflectionConfidenceThreshold).toBe(80);
    expect(cfg.source).toBe("selected-profile");
    expect(cfg.profileId).toBe("profile-hybrid");
  });

  it("Locked: locked ON, V3 OFF (skipped), strict matching", () => {
    const cfg = resolveProfileRuntime(byId("profile-locked"));
    expect(cfg.useLockedPipeline).toBe(true);
    expect(cfg.enableV3PostOptimization).toBe(false);
    expect(cfg.matchingStrategy).toBe("strict");
    expect(cfg.reflectionConfidenceThreshold).toBe(75);
  });

  it("Legacy V2: legacy path, no V3, no regeneration", () => {
    const cfg = resolveProfileRuntime(byId("profile-legacy-v2"));
    expect(cfg.useLockedPipeline).toBe(false);
    expect(cfg.enableV3PostOptimization).toBe(false);
    expect(cfg.enableTargetedRegeneration).toBe(false);
    expect(cfg.matchingStrategy).toBe("fuzzy");
    expect(cfg.reflectionConfidenceThreshold).toBe(70);
  });

  it("Legacy V3: legacy path + V3 ON, no regeneration", () => {
    const cfg = resolveProfileRuntime(byId("profile-legacy-v3"));
    expect(cfg.useLockedPipeline).toBe(false);
    expect(cfg.enableV3PostOptimization).toBe(true);
    expect(cfg.enableTargetedRegeneration).toBe(false);
  });
});

describe("resolveProfileRuntime — env fallback (non-regression)", () => {
  it("no profile + env unset → EXACT pre-profile behavior (locked ON, V3 skipped on locked, 4 attempts, threshold 75)", () => {
    const cfg = resolveProfileRuntime(null, undefined);
    expect(cfg.source).toBe("env-fallback");
    expect(cfg.useLockedPipeline).toBe(true);
    expect(cfg.enableV3PostOptimization).toBe(false); // pre-profile: V3 skipped whenever locked
    expect(cfg.maxOptimizeAttempts).toBe(4);
    expect(cfg.reflectionConfidenceThreshold).toBe(75);
    expect(cfg.enableTargetedRegeneration).toBe(true);
    expect(cfg.matchingStrategy).toBe("hybrid");
  });

  it("no profile + NEXT_PUBLIC_USE_LOCKED_PIPELINE=false → legacy path, V3 allowed (old env behavior)", () => {
    const cfg = resolveProfileRuntime(null, "false");
    expect(cfg.useLockedPipeline).toBe(false);
    expect(cfg.enableV3PostOptimization).toBe(true);
  });
});

describe("resolveProfileRuntime — clamping and custom profiles", () => {
  it("clamps maxRetries into 1..6", () => {
    const base = byId("profile-hybrid");
    expect(resolveProfileRuntime({ ...base, maxRetries: 0 }).maxOptimizeAttempts).toBe(1);
    expect(resolveProfileRuntime({ ...base, maxRetries: 10 }).maxOptimizeAttempts).toBe(6);
    expect(resolveProfileRuntime({ ...base, maxRetries: 2 }).maxOptimizeAttempts).toBe(2);
  });

  it("custom profile overrides are honored", () => {
    const base = byId("profile-hybrid");
    const cfg = resolveProfileRuntime({
      ...base,
      id: "profile-custom-x",
      name: "My Custom",
      useLockedPipeline: false,
      enableV3PostOptimization: false,
      matchingStrategy: "fuzzy",
      hybridMatchingThreshold: 60,
      maxRetries: 2,
    });
    expect(cfg.profileName).toBe("My Custom");
    expect(cfg.useLockedPipeline).toBe(false);
    expect(cfg.enableV3PostOptimization).toBe(false);
    expect(cfg.matchingStrategy).toBe("fuzzy");
    expect(cfg.hybridMatchingThreshold).toBe(60);
    expect(cfg.maxOptimizeAttempts).toBe(2);
  });

  it("missing matchingStrategy falls back to hybrid", () => {
    const base = byId("profile-hybrid") as any;
    const cfg = resolveProfileRuntime({ ...base, matchingStrategy: undefined });
    expect(cfg.matchingStrategy).toBe("hybrid");
  });
});

describe("getSelectedProfile — store resolution", () => {
  beforeEach(() => {
    storeState.pipelineProfiles = SEED_PIPELINE_PROFILES;
    storeState.selectedProfileId = "profile-hybrid";
  });

  it("returns the selected profile", () => {
    storeState.selectedProfileId = "profile-locked";
    expect(getSelectedProfile()?.id).toBe("profile-locked");
  });

  it("falls back to the default (recommended) profile when the id is unknown", () => {
    storeState.selectedProfileId = "does-not-exist";
    expect(getSelectedProfile()?.id).toBe("profile-hybrid");
  });
});

describe("describeProfileRuntime", () => {
  it("summarizes the runtime config in one line", () => {
    const line = describeProfileRuntime(resolveProfileRuntime(byId("profile-hybrid")));
    expect(line).toContain("Hybrid");
    expect(line).toContain("locked");
    expect(line).toContain("V3=ON");
    expect(line).toContain("matching=hybrid");
  });
});
