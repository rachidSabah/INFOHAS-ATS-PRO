import { describe, it, expect, vi } from "vitest";

// Mock the RAW AI pipeline. recordAI lazily imports { callAIRaw } from "@/lib/ai",
// which resolves to the same module as "../ai" — so this mock intercepts every
// AI Workspace engine call (executeTask → analyzeAndPlan → generateFiles →
// generateTests → healing fixer).
vi.mock("../ai", async () => {
  const original = await vi.importActual("../ai");
  return {
    ...(original as any),
    callAIRaw: vi.fn().mockResolvedValue({
      text: JSON.stringify({
        title: "Add feature X",
        description: "Adds feature X to the app.",
        plan: "Step 1: create file\nStep 2: wire it up",
        affectedFiles: ["src/lib/feature-x.ts"],
        files: [{ path: "src/lib/feature-x.ts", content: "export const featureX = 1;", type: "lib" }],
      }),
      provider: "Mocked ZenCode",
      latencyMs: 5,
      tokensEstimate: 10,
    }),
  };
});

import { executeTask } from "../ai-builder-agent";
import { callAIRaw } from "../ai";
import { useApp } from "../store";

const ZENCODE_PROVIDER = {
  id: "p_zencode",
  name: "ZenCode (Free models)",
  type: "zencode",
  isActive: true,
  baseUrl: "https://api.zencode.example/v1",
  enabledModels: ["deepseek-v4-flash"],
};

const WORKSPACE_SETTINGS = {
  providerId: "p_zencode",
  modelName: "deepseek-v4-flash",
  temperature: 0.4,
  maxTokens: 8000,
  timeout: 30,
  streaming: false,
  reasoningLevel: "medium" as const,
  systemPrompt: "You are the AI Builder Agent.",
  fallbackProviderId: "",
  fallbackModel: "",
  autoScanEnabled: false,
  autoReportEnabled: false,
  safeApplyEnabled: true,
  requireApprovalEnabled: true,
  focusDirectories: [],
  excludeFilesPattern: "",
};

describe("AI Builder Agent — provider pinning", () => {
  it("pins the user-configured provider/model/timeout on EVERY AI call in executeTask", async () => {
    const originalState = useApp.getState();
    useApp.setState({
      aiDevSettings: WORKSPACE_SETTINGS as any,
      providers: [ZENCODE_PROVIDER as any],
    });

    try {
      const mockCallAIRaw = vi.mocked(callAIRaw);
      mockCallAIRaw.mockClear();

      const task = await executeTask("Add a feature X module", "feature");

      // executeTask runs analyzeAndPlan + generateFilesForTask + generateTestsForTask
      // = 3 recordAI calls, each of which must carry the pinned options.
      expect(mockCallAIRaw).toHaveBeenCalledTimes(3);

      for (const call of mockCallAIRaw.mock.calls) {
        const opts = call[0] as any;
        expect(opts.providerId).toBe("p_zencode");
        expect(opts.modelOverride).toBe("deepseek-v4-flash");
        expect(opts.timeoutMs).toBe(30_000);
        // Per-call-site generation params are preserved on top of the pinning.
        expect(opts.systemPrompt).toBeTruthy();
        expect(typeof opts.maxTokens).toBe("number");
      }

      // The task pipeline itself completed with honest (not simulated) status.
      expect(task.status).toBe("ready");
      expect(task.buildResult?.success).toBe(false);
      expect(task.buildResult?.warnings.join(" ")).toContain("NOT BUILT");
      expect(task.testResult?.output).toContain("NOT executed");
    } finally {
      useApp.setState(originalState);
    }
  });

  it("still completes the task when no provider is configured (app-default chain)", async () => {
    const originalState = useApp.getState();
    useApp.setState({
      aiDevSettings: { ...WORKSPACE_SETTINGS, providerId: "", modelName: "", timeout: 0 } as any,
      providers: [],
    });

    try {
      const mockCallAIRaw = vi.mocked(callAIRaw);
      mockCallAIRaw.mockClear();

      const task = await executeTask("Add a feature Y module", "feature");

      expect(mockCallAIRaw).toHaveBeenCalledTimes(3);
      for (const call of mockCallAIRaw.mock.calls) {
        const opts = call[0] as any;
        // No pinning keys should be present at all.
        expect(opts.providerId).toBeUndefined();
        expect(opts.modelOverride).toBeUndefined();
        expect(opts.timeoutMs).toBeUndefined();
      }
      expect(task.title).toBe("Add feature X"); // from mocked AI response
    } finally {
      useApp.setState(originalState);
    }
  });
});
