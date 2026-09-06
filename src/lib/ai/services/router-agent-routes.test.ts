// ============================================================================
// REGRESSION TESTS — agent routes + emergency rescue in selectProviderForAgent
//
// Production configured agentRoutes.optimizer = "p_puter" (Task 9), yet the
// optimizer never ran on Puter: the routed provider passed through
// isAvailableForSelection WITHOUT an emergency exemption and was silently
// discarded. The optimizer then fell through to priority order — dead
// opencode-zen (priority 3) first — and Step 5 failed at ~50%.
//
// Contract under test:
//   1. an EXPLICIT agent route to an emergency-only provider is HONORED
//   2. when every selectable provider is excluded/parked, the emergency
//      provider (Puter) is returned as a rescue instead of "no provider"
//   3. the rescue is opt-out via providerSettings.puterEmergencyRescue = false
//   4. normal (non-emergency) routes and priority order are unchanged
// ============================================================================

import { describe, it, expect, vi } from "vitest";

const settings = vi.hoisted(() => ({
  fallbackProviderIds: [] as string[],
  retryAttempts: 0,
  agentRoutes: {} as Record<string, string>,
  puterEmergencyRescue: true as boolean,
}));

const PROVIDERS = vi.hoisted(() => [
  { id: "p_puter", name: "Puter.js (Free)", type: "puter", isActive: true, priority: 1, status: "healthy" },
  { id: "p_zen", name: "ZenCode (Free models)", type: "opencode-zen", isActive: true, priority: 3, status: "down", apiKey: "k-zen" },
  { id: "p_mistral", name: "Mistral", type: "mistral", isActive: true, priority: 10, status: "healthy", apiKey: "k-mistral" },
]);

vi.mock("../../store", () => ({
  useApp: {
    getState: () => ({
      providers: PROVIDERS,
      providerSettings: settings,
      user: { role: "super_admin" },
      addProviderLog: vi.fn(),
      updateProvider: vi.fn(),
    }),
  },
  uid: () => "pl-test",
}));

import { selectProviderForAgent } from "./router";

describe("selectProviderForAgent — explicit agent routes", () => {
  it("HONORS an explicit optimizer route to an emergency-only provider (puter)", async () => {
    settings.agentRoutes = { optimizer: "p_puter" };
    const p = await selectProviderForAgent("optimizer", []);
    expect(p?.id).toBe("p_puter");
  });

  it("still honors a normal (non-emergency) agent route", async () => {
    settings.agentRoutes = { optimizer: "p_mistral" };
    const p = await selectProviderForAgent("optimizer", []);
    expect(p?.id).toBe("p_mistral");
  });
});

describe("selectProviderForAgent — emergency rescue", () => {
  it("returns puter when every normal provider is excluded, instead of nothing", async () => {
    settings.agentRoutes = {};
    settings.puterEmergencyRescue = true;
    const p = await selectProviderForAgent("optimizer", ["p_zen", "p_mistral"]);
    expect(p?.id).toBe("p_puter");
  });

  it("rescue is opt-out via providerSettings.puterEmergencyRescue = false (falls back to local engine)", async () => {
    settings.agentRoutes = {};
    settings.puterEmergencyRescue = false;
    const p = await selectProviderForAgent("optimizer", ["p_zen", "p_mistral"]);
    // The existing terminal fallback is the offline Local Engine (which the
    // bullet-only optimizer explicitly rejects with "No AI provider available").
    // The point of the rescue is that Puter is returned instead.
    expect(p?.id).toBe("local-engine");
  });

  it("priority order is unchanged when no route is set (zen prio 3 beats mistral prio 10)", async () => {
    settings.agentRoutes = {};
    settings.puterEmergencyRescue = true;
    const p = await selectProviderForAgent("optimizer", []);
    expect(p?.id).toBe("p_zen");
  });
});
