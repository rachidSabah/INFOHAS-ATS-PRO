import { describe, it, expect } from "vitest";
import { PUTER_AGENT_PRESETS } from "../puter-models";
import { getPrebuiltModelsForProvider, getPrebuiltModelIdsForProvider, PREBUILT_MODELS_BY_PROVIDER } from "../ai/prebuilt-models";

describe("Puter Agent Presets", () => {
  it("defines all required agent presets with valid routes for all 4 agents", () => {
    expect(PUTER_AGENT_PRESETS.length).toBeGreaterThanOrEqual(3);

    for (const preset of PUTER_AGENT_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();

      expect(preset.routes.optimizer).toBeTruthy();
      expect(preset.routes.supervisor).toBeTruthy();
      expect(preset.routes.guardian).toBeTruthy();
      expect(preset.routes.assembler).toBeTruthy();
    }
  });

  it("verifies the Flagship Stable preset uses top-tier JSON compliant models", () => {
    const flagship = PUTER_AGENT_PRESETS.find((p) => p.id === "puter-flagship-stable");
    expect(flagship).toBeDefined();
    expect(flagship?.routes.optimizer).toBe("claude-sonnet-4-5");
    expect(flagship?.routes.supervisor).toBe("gpt-4o");
    expect(flagship?.routes.guardian).toBe("gemini-2.5-flash");
    expect(flagship?.routes.assembler).toBe("gemini-2.5-flash");
  });

  it("verifies the High Speed preset uses Gemini 2.5 Flash", () => {
    const speed = PUTER_AGENT_PRESETS.find((p) => p.id === "puter-high-speed");
    expect(speed).toBeDefined();
    expect(speed?.routes.optimizer).toBe("gemini-2.5-flash");
    expect(speed?.routes.supervisor).toBe("gemini-2.5-flash");
  });
});

describe("Prebuilt Models by Provider", () => {
  it("provides curated model groups for primary providers", () => {
    const providerTypes = ["puter", "openrouter", "gemini", "openai", "claude", "groq", "deepseek", "mistral"];

    for (const type of providerTypes) {
      const groups = getPrebuiltModelsForProvider(type);
      expect(groups).not.toBeNull();
      expect(groups!.length).toBeGreaterThan(0);

      const ids = getPrebuiltModelIdsForProvider(type);
      expect(ids.length).toBeGreaterThan(0);
    }
  });

  it("puter catalog includes flagship stable models with descriptions and stability flags", () => {
    const puterGroups = getPrebuiltModelsForProvider("puter");
    expect(puterGroups).not.toBeNull();

    const flagshipGroup = puterGroups?.find((g) => g.group.includes("Recommended"));
    expect(flagshipGroup).toBeDefined();

    const modelIds = flagshipGroup?.models.map((m) => m.id);
    expect(modelIds).toContain("claude-sonnet-4-5");
    expect(modelIds).toContain("gpt-4o");
    expect(modelIds).toContain("gemini-2.5-flash");
  });

  it("normalizes alias types like opencode-zen and zencode", () => {
    const zen = getPrebuiltModelsForProvider("opencode-zen");
    expect(zen).not.toBeNull();
    const zenIds = getPrebuiltModelIdsForProvider("zencode");
    expect(zenIds).toContain("nemotron-3-ultra-free");
  });
});
