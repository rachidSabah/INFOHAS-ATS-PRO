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
import type { AgentDirectives, OptimizerDirectiveConfig } from "../types";
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

describe("Directive profile EDIT / SAVE / DELETE semantics (Task 15 follow-up)", () => {
  afterEach(() => {
    registerCustomProfiles([]);
  });

  it("EDIT a built-in: loading it onto the factory seed yields its effective config", () => {
    // The UI's editProfile() does applyProfileToConfig(SEED, profile) — the
    // loaded draft must carry the built-in's agentDirectives and keep the
    // factory seed values for anything the built-in does not override.
    const loaded = applyProfileToConfig({ ...SEED_OPTIMIZER_DIRECTIVE }, BUILT_IN_PROFILES["ats-conservative"]);
    expect(loaded.agentDirectives.summary.atsAggressiveness).toBe(25);
    expect(loaded.agentDirectives.skills.maxKeywords).toBe(15);
    expect(loaded.agentDirectives.experience.maxExpansionPercent).toBe(20);
    // non-overridden scalars keep factory seed values
    expect(loaded.complianceThreshold).toBe(SEED_OPTIMIZER_DIRECTIVE.complianceThreshold);
  });

  it("EDIT a custom full-snapshot profile: seed → load reproduces the snapshot exactly (round-trip)", () => {
    const snapshot: OptimizerDirectiveConfig = JSON.parse(JSON.stringify({
      ...SEED_OPTIMIZER_DIRECTIVE,
      complianceThreshold: 77,
      agentDirectives: {
        ...SEED_OPTIMIZER_DIRECTIVE.agentDirectives,
        summary: { ...SEED_OPTIMIZER_DIRECTIVE.agentDirectives.summary, atsAggressiveness: 71 },
      },
    })) as OptimizerDirectiveConfig;
    const profile: DirectiveProfile = {
      id: "custom-roundtrip",
      name: "Roundtrip",
      description: "",
      tags: [],
      overrides: JSON.parse(JSON.stringify(snapshot)),
    };
    registerCustomProfiles([profile]);
    const loaded = applyProfileToConfig({ ...SEED_OPTIMIZER_DIRECTIVE }, getProfile("custom-roundtrip")!);
    expect(loaded.complianceThreshold).toBe(77);
    expect(loaded.agentDirectives.summary.atsAggressiveness).toBe(71);
    // The FULL snapshot survives the merge — every agent directive equals the snapshot.
    expect(JSON.stringify(loaded.agentDirectives)).toBe(JSON.stringify(snapshot.agentDirectives));
  });

  it("SAVE into a built-in id shadows it while the factory definition stays recoverable", () => {
    const factoryAggr = BUILT_IN_PROFILES["ats-conservative"].overrides.agentDirectives!.summary!.atsAggressiveness;
    const customized: DirectiveProfile = {
      id: "ats-conservative",
      name: "ATS Conservative",
      description: "customized via save-into",
      tags: ["ats"],
      overrides: {
        agentDirectives: {
          ...BUILT_IN_PROFILES["ats-conservative"].overrides.agentDirectives,
          summary: {
            ...BUILT_IN_PROFILES["ats-conservative"].overrides.agentDirectives!.summary!,
            atsAggressiveness: 40,
          },
        } as AgentDirectives,
      },
    };
    registerCustomProfiles([customized]);
    expect(isBuiltInProfile("ats-conservative")).toBe(true); // still a built-in id
    expect(getProfile("ats-conservative")?.overrides.agentDirectives!.summary!.atsAggressiveness).toBe(40); // shadowed
    // DELETE / restore → factory definition returns
    registerCustomProfiles([]);
    expect(getProfile("ats-conservative")?.overrides.agentDirectives!.summary!.atsAggressiveness).toBe(factoryAggr);
  });

  it("SAVE into a custom profile replaces its previous configuration in place", () => {
    const v1: DirectiveProfile = {
      id: "custom-v1", name: "V1", description: "first", tags: ["a"],
      overrides: { complianceThreshold: 60 },
    };
    registerCustomProfiles([v1]);
    // Simulate "save into" — same id, new overrides, metadata preserved
    const updated: DirectiveProfile = {
      id: v1.id,
      name: v1.name,
      description: v1.description,
      tags: [...(v1.tags ?? [])],
      overrides: { complianceThreshold: 85 },
    };
    registerCustomProfiles([updated]);
    expect(getAllProfiles().filter((p) => p.id === "custom-v1")).toHaveLength(1); // replaced, not duplicated
    expect(getProfile("custom-v1")?.overrides.complianceThreshold).toBe(85);
    expect(getProfile("custom-v1")?.name).toBe("V1"); // metadata kept
  });
});
