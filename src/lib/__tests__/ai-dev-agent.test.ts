import { describe, it, expect, vi } from "vitest";
import { callDevAgent } from "../ai-dev-agent";
import { useApp } from "../store";
import { callAI } from "../ai";

// Mock callAI to inspect the arguments passed to it
vi.mock("../ai", async () => {
  const original = await vi.importActual("../ai");
  return {
    ...original as any,
    callAI: vi.fn().mockResolvedValue({
      text: "mocked response",
      provider: "Mocked Provider",
    }),
  };
});

describe("AI Development Agent Scoping", () => {
  it("appends focus directories and exclude patterns to userPrompt", async () => {
    const originalState = useApp.getState();
    
    useApp.setState({
      aiDevSettings: {
        providerId: "p_mock",
        modelName: "mock-model",
        temperature: 0.5,
        maxTokens: 4000,
        timeout: 30,
        streaming: false,
        reasoningLevel: "medium",
        systemPrompt: "You are an assistant.",
        fallbackProviderId: "",
        fallbackModel: "",
        autoScanEnabled: false,
        autoReportEnabled: false,
        safeApplyEnabled: false,
        requireApprovalEnabled: false,
        focusDirectories: ["src/lib", "src/components"],
        excludeFilesPattern: "*.test.ts",
      },
    });

    try {
      const mockCallAI = vi.mocked(callAI);
      mockCallAI.mockClear();

      await callDevAgent({ userPrompt: "Scan code." });

      expect(mockCallAI).toHaveBeenCalledTimes(1);
      const calledArgs = mockCallAI.mock.calls[0][0];
      
      expect(calledArgs.userPrompt).toContain("Focus ONLY on files under the following directories/paths: src/lib, src/components");
      expect(calledArgs.userPrompt).toContain("EXCLUDE all files matching these patterns: *.test.ts");
    } finally {
      useApp.setState(originalState);
    }
  });
});
