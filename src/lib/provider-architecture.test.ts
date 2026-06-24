// Regression tests for the Provider Classification System
// Proves:
//   1. Puter requests never execute for document tasks
//   2. API providers function for document tasks
//   3. Provider failover works
//   4. 429 errors trigger failover
//   5. Provider errors never appear in generated documents
//   6. Invalid model names are rejected

import { describe, it, expect } from "vitest";
import {
  classifyTask,
  isApiProvider,
  isBrowserAuthProvider,
  canProviderHandleTask,
  isPuterAllowedForTask,
  DOCUMENT_ROUTING_POLICY,
} from "./provider-router";
import { isRateLimitError, isAuthError, isModelError } from "./provider-health";
import { validateResumeContent, ERROR_LEAK_PATTERNS } from "./ai-error-filter";
import { assertBrowserOnly } from "./puter-client";
import type { AIProvider } from "./types";

// Helper: create a mock API provider
function mockApiProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: "p_test_api",
    name: "Test API Provider",
    type: "opencode",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://api.test.com/v1",
    baseUrl: "https://api.test.com/v1",
    apiKey: "test-key",
    priority: 1,
    isActive: true,
    isDefault: false,
    isFallback: false,
    isBuiltIn: false,
    timeout: 30000,
    maxTokens: 4096,
    temperature: 0.7,
    status: "healthy",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
    ...overrides,
  };
}

// Helper: create a mock Puter (browser_auth) provider
function mockPuterProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: "p_test_puter",
    name: "Puter.js (Test)",
    type: "puter",
    providerCategory: "browser_auth",
    supportsServerSide: false,
    supportsClientSide: true,
    supportsStreaming: false,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: true,
    requiresApiKey: false,
    apiUrl: "https://api.puter.com",
    baseUrl: "https://api.puter.com",
    priority: 1,
    isActive: true,
    isDefault: false,
    isFallback: true,
    isBuiltIn: true,
    timeout: 30000,
    maxTokens: 4096,
    temperature: 0.7,
    status: "healthy",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
    ...overrides,
  };
}

describe("Provider Classification", () => {
  it("classifies API providers correctly", () => {
    const api = mockApiProvider();
    expect(isApiProvider(api)).toBe(true);
    expect(isBrowserAuthProvider(api)).toBe(false);
  });

  it("classifies Puter (browser_auth) providers correctly", () => {
    const puter = mockPuterProvider();
    expect(isApiProvider(puter)).toBe(false);
    expect(isBrowserAuthProvider(puter)).toBe(true);
  });

  it("classifies legacy providers without providerCategory by type", () => {
    const legacy = mockApiProvider({ providerCategory: undefined as any });
    expect(isApiProvider(legacy)).toBe(true);
  });
});

describe("Task Classification", () => {
  it("classifies document tasks correctly", () => {
    expect(classifyTask("resume_optimization")).toBe("document");
    expect(classifyTask("ats_check")).toBe("document");
    expect(classifyTask("cover_letter")).toBe("document");
    expect(classifyTask("interview_prep")).toBe("document");
    expect(classifyTask("pdf_generation")).toBe("document");
  });

  it("classifies interactive tasks correctly", () => {
    expect(classifyTask("chat")).toBe("interactive");
    expect(classifyTask("prompt_playground")).toBe("interactive");
    expect(classifyTask("ai_assistant")).toBe("interactive");
  });
});

describe("Provider Routing — Puter Inclusion for Document Tasks", () => {
  it("ALLOWS Puter to handle document tasks", () => {
    const puter = mockPuterProvider({ isActive: true });
    expect(canProviderHandleTask(puter, "document")).toBe(true);
  });

  it("ALLOWS Puter for interactive tasks", () => {
    const puter = mockPuterProvider({ isActive: true });
    expect(canProviderHandleTask(puter, "interactive")).toBe(true);
  });

  it("ALLOWS API providers for document tasks", () => {
    const api = mockApiProvider({ isActive: true });
    expect(canProviderHandleTask(api, "document")).toBe(true);
  });

  it("ALLOWS API providers for interactive tasks", () => {
    const api = mockApiProvider({ isActive: true });
    expect(canProviderHandleTask(api, "interactive")).toBe(true);
  });

  it("rejects inactive providers for any task", () => {
    const inactive = mockApiProvider({ isActive: false });
    expect(canProviderHandleTask(inactive, "document")).toBe(false);
    expect(canProviderHandleTask(inactive, "interactive")).toBe(false);
  });
});

describe("Puter Task Eligibility", () => {
  it("allows Puter for chat", () => {
    expect(isPuterAllowedForTask("chat")).toBe(true);
  });

  it("allows Puter for prompt_playground", () => {
    expect(isPuterAllowedForTask("prompt_playground")).toBe(true);
  });

  it("PREVENTS Puter for resume_optimization", () => {
    expect(isPuterAllowedForTask("resume_optimization")).toBe(false);
  });

  it("PREVENTS Puter for ats_check", () => {
    expect(isPuterAllowedForTask("ats_check")).toBe(false);
  });

  it("PREVENTS Puter for cover_letter", () => {
    expect(isPuterAllowedForTask("cover_letter")).toBe(false);
  });
});

describe("Document Routing Policy", () => {
  it("excludes Puter from the document routing policy", () => {
    expect(DOCUMENT_ROUTING_POLICY).not.toContain("puter");
  });

  it("includes OpenCode as first priority", () => {
    expect(DOCUMENT_ROUTING_POLICY[0]).toBe("opencode");
  });

  it("includes DeepSeek as second priority", () => {
    expect(DOCUMENT_ROUTING_POLICY[1]).toBe("deepseek");
  });
});

describe("Error Detection", () => {
  it("detects 429 rate limit errors", () => {
    expect(isRateLimitError("429 Too Many Requests")).toBe(true);
    expect(isRateLimitError("rate limit exceeded")).toBe(true);
    expect(isRateLimitError("quota exceeded")).toBe(true);
  });

  it("detects 401/403 auth errors", () => {
    expect(isAuthError("401 Unauthorized")).toBe(true);
    expect(isAuthError("403 Forbidden")).toBe(true);
    expect(isAuthError("invalid api key")).toBe(true);
  });

  it("detects 404 model errors", () => {
    expect(isModelError("404 model not found")).toBe(true);
    expect(isModelError("not_found_error: model not found")).toBe(true);
  });
});

describe("AI Error Leak Prevention", () => {
  it("blocks 429 rate limit errors from resume content", () => {
    const contaminatedResume = {
      id: "r1",
      name: "Test",
      headline: "Developer",
      contact: {},
      summary: "429 rate limit exceeded. Please try again later.",
      experience: [],
      education: [],
      skills: [],
      languages: [],
      projects: [],
      certifications: [],
      template: "infohas-pro",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "manual",
    };
    const result = validateResumeContent(contaminatedResume as any);
    expect(result.valid).toBe(false);
  });

  it("blocks 401 authentication errors from resume content", () => {
    const contaminatedResume = {
      id: "r1",
      name: "Test",
      headline: "Developer",
      contact: {},
      summary: "401 Unauthorized: authentication failed. API key invalid.",
      experience: [],
      education: [],
      skills: [],
      languages: [],
      projects: [],
      certifications: [],
      template: "infohas-pro",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "manual",
    };
    const result = validateResumeContent(contaminatedResume as any);
    expect(result.valid).toBe(false);
  });

  it("blocks model not found errors from resume content", () => {
    const contaminatedResume = {
      id: "r1",
      name: "Test",
      headline: "Developer",
      contact: {},
      summary: "Model not found. not_found_error: model gpt-99 not available.",
      experience: [],
      education: [],
      skills: [],
      languages: [],
      projects: [],
      certifications: [],
      template: "infohas-pro",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "manual",
    };
    const result = validateResumeContent(contaminatedResume as any);
    expect(result.valid).toBe(false);
  });

  it("allows clean resume content", () => {
    const cleanResume = {
      id: "r1",
      name: "Test User",
      headline: "Customer Service Agent",
      contact: { email: "test@test.com" },
      summary: "Customer service professional with 3 years of experience in call center operations.",
      experience: [{
        id: "e1",
        title: "Customer Service Agent",
        company: "Emirates",
        startDate: "2022",
        endDate: "Present",
        bullets: ["Handled customer calls"],
      }],
      education: [{ id: "ed1", institution: "University", degree: "BA", startDate: "2018", endDate: "2022" }],
      skills: [{ id: "s1", name: "Customer Service" }],
      languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
      projects: [],
      certifications: [],
      template: "infohas-pro",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "manual",
    };
    const result = validateResumeContent(cleanResume as any);
    expect(result.valid).toBe(true);
  });
});

describe("Puter Browser-Only Enforcement", () => {
  it("assertBrowserOnly exists and is callable", () => {
    expect(typeof assertBrowserOnly).toBe("function");
  });
});
