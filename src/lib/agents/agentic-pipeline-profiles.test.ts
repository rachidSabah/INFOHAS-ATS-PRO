// ============================================================================
// Agentic Pipeline Profiles (Task 17)
//
// Two new built-in pipeline profiles with agentic character, requested to
// complement the existing four (Legacy V2, Legacy V3, Locked, Hybrid):
//
//   - Agentic Turbo   (agentic-turbo)    — flash-tier speed: lean 2-attempt
//     budget, surgical targeted regeneration, slightly lenient matching to
//     avoid match churn. Factual integrity (factual-consistency 95) is NEVER
//     relaxed.
//   - Agentic Sentinel (agentic-sentinel) — maximum persistence: the full
//     6-attempt ceiling, strictest validation gates, high reflection trigger.
//
// BOTH must keep the directive-critical invariants:
//   - useLockedPipeline: true            (directive §2 — LLM cannot generate
//                                         full resume; bullet-only optimizer)
//   - enableTargetedRegeneration: true   (agentic self-correction)
//   - enableV3PostOptimization: true     (post-verification agents)
//   - matchingStrategy: "hybrid"         (strict mode is brittle → churn)
//   - isBuiltIn: true, isDefault: false  (Hybrid stays the default)
//
// Non-regression: the original four profiles must remain byte-identical in
// their runtime-relevant flags.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { SEED_PIPELINE_PROFILES } from "../pipeline-orchestration-seeds";
import {
  resolveProfileRuntime,
  describeProfileRuntime,
} from "./profile-resolution";

vi.mock("../store", () => ({
  useApp: {
    getState: () => ({
      pipelineProfiles: SEED_PIPELINE_PROFILES,
      selectedProfileId: "profile-hybrid",
    }),
  },
}));

const byId = (id: string) => SEED_PIPELINE_PROFILES.find((p) => p.id === id)!;

// ============================================================================
// Seed shape — the new profiles exist and carry the agentic invariants
// ============================================================================

describe("seed profiles — agentic turbo & sentinel exist", () => {
  it("adds exactly two new built-in profiles (6 total)", () => {
    expect(SEED_PIPELINE_PROFILES.length).toBe(6);
    const ids = SEED_PIPELINE_PROFILES.map((p) => p.id);
    expect(ids).toContain("profile-agentic-turbo");
    expect(ids).toContain("profile-agentic-sentinel");
  });

  it("Agentic Turbo: locked ON, V3 ON, regen ON, hybrid matching, 2 retries, built-in, not default", () => {
    const p = byId("profile-agentic-turbo");
    expect(p.type).toBe("agentic-turbo");
    expect(p.useLockedPipeline).toBe(true);
    expect(p.enableV3PostOptimization).toBe(true);
    expect(p.enableTargetedRegeneration).toBe(true);
    expect(p.matchingStrategy).toBe("hybrid");
    expect(p.maxRetries).toBe(2);
    expect(p.isBuiltIn).toBe(true);
    expect(p.isDefault).toBe(false);
    // Factual integrity is never relaxed:
    expect(p.validationThresholds.minFactualConsistency).toBeGreaterThanOrEqual(95);
    expect(p.validationThresholds.enforceOnePage).toBe(true);
    // Entity lock + assembler must be in the enabled agent set (locked shape):
    expect(p.enabledAgents).toContain("entity-lock");
    expect(p.enabledAgents).toContain("resume-assembler");
    expect(p.enabledAgents).toContain("factual-consistency");
  });

  it("Agentic Sentinel: locked ON, V3 ON, regen ON, hybrid matching at 85, 6 retries, built-in, not default", () => {
    const p = byId("profile-agentic-sentinel");
    expect(p.type).toBe("agentic-sentinel");
    expect(p.useLockedPipeline).toBe(true);
    expect(p.enableV3PostOptimization).toBe(true);
    expect(p.enableTargetedRegeneration).toBe(true);
    expect(p.matchingStrategy).toBe("hybrid");
    expect(p.hybridMatchingThreshold).toBe(85);
    expect(p.maxRetries).toBe(6);
    expect(p.isBuiltIn).toBe(true);
    expect(p.isDefault).toBe(false);
    expect(p.validationThresholds.minFactualConsistency).toBeGreaterThanOrEqual(95);
    expect(p.validationThresholds.enforceOnePage).toBe(true);
    expect(p.enabledAgents).toContain("entity-lock");
    expect(p.enabledAgents).toContain("resume-assembler");
    expect(p.enabledAgents).toContain("factual-consistency");
  });

  it("Hybrid remains the single default profile", () => {
    const defaults = SEED_PIPELINE_PROFILES.filter((p) => p.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0].id).toBe("profile-hybrid");
  });
});

// ============================================================================
// Runtime resolution — the orchestrator consumes the new profiles correctly
// ============================================================================

describe("resolveProfileRuntime — agentic profiles", () => {
  it("Turbo resolves to locked+V3+regen, 2 attempts, reflection < 75, source=selected-profile", () => {
    const cfg = resolveProfileRuntime(byId("profile-agentic-turbo"));
    expect(cfg.profileId).toBe("profile-agentic-turbo");
    expect(cfg.useLockedPipeline).toBe(true);
    expect(cfg.enableV3PostOptimization).toBe(true);
    expect(cfg.enableTargetedRegeneration).toBe(true);
    expect(cfg.matchingStrategy).toBe("hybrid");
    expect(cfg.hybridMatchingThreshold).toBe(70);
    expect(cfg.maxOptimizeAttempts).toBe(2);
    expect(cfg.reflectionConfidenceThreshold).toBe(75);
    expect(cfg.source).toBe("selected-profile");
  });

  it("Sentinel resolves to locked+V3+regen, 6 attempts (clamp ceiling), reflection < 85", () => {
    const cfg = resolveProfileRuntime(byId("profile-agentic-sentinel"));
    expect(cfg.profileId).toBe("profile-agentic-sentinel");
    expect(cfg.useLockedPipeline).toBe(true);
    expect(cfg.enableV3PostOptimization).toBe(true);
    expect(cfg.enableTargetedRegeneration).toBe(true);
    expect(cfg.matchingStrategy).toBe("hybrid");
    expect(cfg.hybridMatchingThreshold).toBe(85);
    expect(cfg.maxOptimizeAttempts).toBe(6);
    expect(cfg.reflectionConfidenceThreshold).toBe(85);
    expect(cfg.source).toBe("selected-profile");
  });

  it("describeProfileRuntime renders both agentic profiles", () => {
    const turbo = describeProfileRuntime(resolveProfileRuntime(byId("profile-agentic-turbo")));
    expect(turbo).toContain("Agentic Turbo");
    expect(turbo).toContain("locked");
    expect(turbo).toContain("retries=2");

    const sentinel = describeProfileRuntime(
      resolveProfileRuntime(byId("profile-agentic-sentinel")),
    );
    expect(sentinel).toContain("Agentic Sentinel");
    expect(sentinel).toContain("retries=6");
  });
});

// ============================================================================
// Non-regression — the original four profiles are untouched
// ============================================================================

describe("non-regression — original four profiles unchanged", () => {
  it("Hybrid flags unchanged", () => {
    const p = byId("profile-hybrid");
    expect(p.type).toBe("hybrid");
    expect(p.useLockedPipeline).toBe(true);
    expect(p.enableV3PostOptimization).toBe(true);
    expect(p.enableTargetedRegeneration).toBe(true);
    expect(p.maxRetries).toBe(4);
    expect(p.isDefault).toBe(true);
  });

  it("Locked flags unchanged (V3 OFF, strict matching)", () => {
    const p = byId("profile-locked");
    expect(p.type).toBe("locked");
    expect(p.useLockedPipeline).toBe(true);
    expect(p.enableV3PostOptimization).toBe(false);
    expect(p.enableTargetedRegeneration).toBe(false);
    expect(p.matchingStrategy).toBe("strict");
  });

  it("Legacy V2/V3 flags unchanged (legacy path, no regeneration)", () => {
    const v2 = byId("profile-legacy-v2");
    expect(v2.useLockedPipeline).toBe(false);
    expect(v2.enableV3PostOptimization).toBe(false);
    expect(v2.enableTargetedRegeneration).toBe(false);

    const v3 = byId("profile-legacy-v3");
    expect(v3.useLockedPipeline).toBe(false);
    expect(v3.enableV3PostOptimization).toBe(true);
    expect(v3.enableTargetedRegeneration).toBe(false);
  });
});
