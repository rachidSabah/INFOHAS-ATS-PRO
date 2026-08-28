import { describe, it, expect, vi } from "vitest";
import {
  callDevAgent,
  callDevAgentJSON,
  computeHealthDashboard,
  scanCode,
  scanSecurity,
  inspectRoutes,
  generateFeature,
  generatePatch,
  generateTests,
} from "../ai-dev-agent";
import { useApp } from "../store";
import { callAI } from "../ai";
import type { AIDevReport } from "../types";

// Mock callAI to inspect the arguments passed to it
vi.mock("../ai", async () => {
  const original = await vi.importActual("../ai");
  return {
    ...(original as any),
    callAI: vi.fn().mockResolvedValue({
      text: JSON.stringify({
        summary: "Audit completed successfully with zero issues.",
        issues: [],
      }),
      provider: "Mocked DeepSeek",
    }),
  };
});

describe("AI Development Agent", () => {
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

  it("calculates health dashboard scores correctly", () => {
    const reports: AIDevReport[] = [
      {
        id: "rpt_1",
        type: "code_audit",
        title: "Code Audit",
        summary: "Found 1 warning",
        issues: [
          {
            id: "iss_1",
            type: "code",
            severity: "warning",
            title: "Unused variable",
            description: "Unused var x",
            status: "open",
          },
        ],
        createdAt: "2026-08-28T10:00:00.000Z",
        createdBy: "system",
      },
      {
        id: "rpt_2",
        type: "security_scan",
        title: "Security Scan",
        summary: "Found 1 critical",
        issues: [
          {
            id: "iss_2",
            type: "security",
            severity: "critical",
            title: "Missing CSP",
            description: "No CSP header",
            status: "open",
          },
        ],
        createdAt: "2026-08-28T10:05:00.000Z",
        createdBy: "system",
      },
    ];

    const health = computeHealthDashboard(reports);
    expect(health.overall).toBeGreaterThan(0);
    expect(health.checks.find((c) => c.area === "frontend")?.score).toBe(97); // 100 - 3 (warning)
    expect(health.checks.find((c) => c.area === "security")?.score).toBe(75); // 100 - 25 (critical)
  });

  it("executes callDevAgentJSON and recovers from prose responses gracefully", async () => {
    const mockCallAI = vi.mocked(callAI);
    mockCallAI.mockResolvedValueOnce({
      text: "I analyzed the code and everything looks good.",
      provider: "Mock Provider",
    } as any);

    const res = await callDevAgentJSON<{ summary: string }>({ userPrompt: "Audit code" });
    // First call failed JSON parsing, retried with strict prompt
    expect(res).toBeDefined();
  });
});
