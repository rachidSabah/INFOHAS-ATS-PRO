import { describe, it, expect, vi } from "vitest";
import { selectProviderForAgent } from "../ai";
import { useApp } from "../store";

describe("Agent-Aware AI Routing", () => {
  it("routes dynamically based on custom agent settings", async () => {
    // Setup mock store state
    const originalState = useApp.getState();
    const mockProviders = [
      { id: "p_fast_local", name: "Fast Local", type: "opencode", isActive: true, requiresApiKey: false, priority: 10, modelName: "fast" },
      { id: "p_smart_cloud", name: "Smart Cloud", type: "opencode", isActive: true, requiresApiKey: false, priority: 20, modelName: "smart" },
    ];
    
    useApp.setState({
      providers: mockProviders,
      providerSettings: {
        defaultProviderId: "p_fast_local",
        defaultModel: "fast",
        fallbackProviderIds: [],
        retryAttempts: 1,
        timeout: 10000,
        rateLimitPerMinute: 60,
        enableFailover: true,
        enableCaching: false,
        enableCostTracking: false,
        agentRoutes: {
          supervisor: "p_smart_cloud",
          optimizer: "p_fast_local",
        },
      },
    });

    try {
      // 1. Supervisor agent should get routed to p_smart_cloud
      const supervisorProvider = await selectProviderForAgent("supervisor");
      expect(supervisorProvider.id).toBe("p_smart_cloud");

      // 2. Optimizer agent should get routed to p_fast_local
      const optimizerProvider = await selectProviderForAgent("optimizer");
      expect(optimizerProvider.id).toBe("p_fast_local");

      // 3. Assembler agent has no route, should fall back to default
      const assemblerProvider = await selectProviderForAgent("assembler");
      expect(assemblerProvider.id).toBe("p_fast_local");
    } finally {
      // Restore original state
      useApp.setState(originalState);
    }
  });
});
