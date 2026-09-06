// ============================================================================
// Directive Profiles — Custom Profile Registry Tests (Task 15)
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import {
  BUILT_IN_PROFILES,
  registerCustomProfiles,
  getAllProfiles,
  getProfile,
  isBuiltInProfile,
  applyProfileToConfig,
} from "../directive-profiles";
import type { DirectiveProfile } from "../directive-profiles";
import type { AgentDirectives } from "../types";
import { SEED_OPTIMIZER_DIRECTIVE } from "../mock-data";

describe("Custom directive profile registry", () => {
  afterEach(() => {
    registerCustomProfiles([]); // reset module state between tests
  });

  const CUSTOM_PROFILE: DirectiveProfile = {
    id: "custom-qa-premium",
    name: "QA Premium",
    description: "User-saved snapshot",
    tags: ["custom", "premium"],
    overrides: {
      agentDirectives: {
        ...BUILT_IN_PROFILES["ats-conservative"].overrides.agentDirectives,
      } as AgentDirectives,
    },
  };

  it("registerCustomProfiles makes a new profile resolvable + listed", () => {
    registerCustomProfiles([CUSTOM_PROFILE]);
    expect(getProfile("custom-qa-premium")?.name).toBe("QA Premium");
    expect(getAllProfiles().some((p) => p.id === "custom-qa-premium")).toBe(true);
    expect(isBuiltInProfile("custom-qa-premium")).toBe(false);
  });

  it("a custom profile with a built-in id SHADOWS the built-in", () => {
    const override: DirectiveProfile = {
      ...CUSTOM_PROFILE,
      id: "cabin-crew",
      name: "Cabin Crew (Customized)",
    };
    registerCustomProfiles([override]);
    expect(getProfile("cabin-crew")?.name).toBe("Cabin Crew (Customized)");
    expect(isBuiltInProfile("cabin-crew")).toBe(true);
    // merged list keeps ONE entry for the id
    expect(getAllProfiles().filter((p) => p.id === "cabin-crew")).toHaveLength(1);
  });

  it("clearing the registry restores factory built-ins", () => {
    registerCustomProfiles([{ ...CUSTOM_PROFILE, id: "executive" }]);
    expect(getProfile("executive")?.name).toBe("QA Premium"); // shadowed
    registerCustomProfiles([]);
    expect(getProfile("executive")?.name).toBe("Executive / Leadership"); // factory restored
  });

  it("applyProfileToConfig applies a custom profile's full snapshot", () => {
    const snapshot: DirectiveProfile = {
      id: "custom-snap",
      name: "Snapshot",
      description: "",
      tags: [],
      overrides: {
        agentDirectives: {
          ...BUILT_IN_PROFILES["ats-aggressive"].overrides.agentDirectives,
        } as AgentDirectives,
        complianceThreshold: 90,
      },
    };
    registerCustomProfiles([snapshot]);
    const profile = getProfile("custom-snap")!;
    const merged = applyProfileToConfig(
      { ...SEED_OPTIMIZER_DIRECTIVE },
      profile,
    );
    expect(merged.complianceThreshold).toBe(90);
    expect(merged.agentDirectives.summary.atsAggressiveness).toBe(
      BUILT_IN_PROFILES["ats-aggressive"].overrides.agentDirectives!.summary!.atsAggressiveness,
    );
  });

  it("registerCustomProfiles ignores malformed entries", () => {
    registerCustomProfiles([null as any, { id: "" } as any, { id: "x" } as any, { id: "ok", name: "OK" } as any]);
    expect(getProfile("x")).toBeUndefined(); // missing name → ignored
    expect(getProfile("ok")?.name).toBe("OK"); // valid → registered
  });
});
