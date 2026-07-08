import { describe, it, expect } from "vitest";
import { useApp } from "../store";

describe("Feature Flags Configuration", () => {
  it("defines enableAIGuardian and enableSelfHealing in the Zustand store", () => {
    const state = useApp.getState();
    expect(state.flags).toBeDefined();
    expect(state.flags.enableAIGuardian).toBeDefined();
    expect(state.flags.enableSelfHealing).toBeDefined();
  });
});
