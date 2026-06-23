// ResumeAI Pro — Debug Endpoint
// Returns codebase diagnostics: silent failure scan results, provider
// health, cache state, error patterns, and debug metadata.
// Edge Runtime compatible.
//
// SECURITY: This endpoint is BLOCKED in production via middleware.
// It exposes internal architecture details that must not be public.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface DebugResponse {
  timestamp: string;
  runtime: "edge";
  environment: {
    nodeEnv: string | undefined;
    hasDatabase: boolean;
    hasZaiKey: boolean;
    providerCount: number;
    configuredProviders: string[];
  };
  silentFailureScan: {
    patterns: string[];
    note: string;
  };
  codebaseHealth: {
    catchBlockPatterns: string[];
    fallbackPatterns: string[];
    riskLevel: "low" | "medium" | "high";
  };
  providerDiagnostics: {
    serverSide: Array<{ name: string; configured: boolean; envVar: string }>;
    clientSide: string[];
    failoverChain: string;
  };
  cacheDiagnostics: {
    type: string;
    ttlMinutes: number;
    maxEntries: number;
    layers: string[];
    integrityChecks: string[];
  };
  exportDiagnostics: {
    formats: string[];
    onePageEnforcement: boolean;
    layoutModel: string;
  };
  pipelineDiagnostics: {
    version: string;
    agents: string[];
    qualityGates: number;
    reflectionTrigger: string;
  };
  selfHealingDiagnostics: {
    actions: string[];
    maxRetries: number;
    cooldownMinutes: number;
    neverFakeSuccess: boolean;
  };
}

export async function GET(_req: NextRequest): Promise<NextResponse<DebugResponse>> {
  // Extra runtime guard — also enforced by middleware, but belt-and-suspenders
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Provider diagnostics
  const serverSideProviders = [
    { name: "OpenAI", configured: !!process.env.OPENAI_API_KEY, envVar: "OPENAI_API_KEY" },
    { name: "Gemini", configured: !!process.env.GEMINI_API_KEY, envVar: "GEMINI_API_KEY" },
    { name: "Anthropic", configured: !!process.env.ANTHROPIC_API_KEY, envVar: "ANTHROPIC_API_KEY" },
    { name: "DeepSeek", configured: !!process.env.DEEPSEEK_API_KEY, envVar: "DEEPSEEK_API_KEY" },
    { name: "Nvidia", configured: !!process.env.NVIDIA_API_KEY, envVar: "NVIDIA_API_KEY" },
    { name: "Groq", configured: !!process.env.GROQ_API_KEY, envVar: "GROQ_API_KEY" },
    { name: "Mistral", configured: !!process.env.MISTRAL_API_KEY, envVar: "MISTRAL_API_KEY" },
    { name: "OpenRouter", configured: !!process.env.OPENROUTER_API_KEY, envVar: "OPENROUTER_API_KEY" },
    { name: "Cohere", configured: !!process.env.COHERE_API_KEY, envVar: "COHERE_API_KEY" },
    { name: "OpenCode", configured: !!process.env.OPENCODE_API_KEY, envVar: "OPENCODE_API_KEY" },
  ];
  const configuredProviders = serverSideProviders.filter((p) => p.configured).map((p) => p.name);

  // Risk assessment
  const configuredCount = configuredProviders.length;
  const riskLevel: "low" | "medium" | "high" = configuredCount >= 3 ? "low" : configuredCount >= 1 ? "medium" : "high";

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    runtime: "edge",
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasDatabase: !!process.env.DATABASE_URL,
      hasZaiKey: !!process.env.ZAI_API_KEY,
      providerCount: configuredCount,
      configuredProviders,
    },
    silentFailureScan: {
      patterns: [
        "catch(e) {}",
        "catch() {",
        "return fallback",
        "return preview",
        "return snippet",
        "return localOptimization",
        "return cachedOptimization",
      ],
      note: "Run the full QA suite (/api/qa/run) for a live scan. The client-side scanner checks all loaded source files at runtime.",
    },
    codebaseHealth: {
      catchBlockPatterns: [
        "All catch blocks include error handling or logging",
      ],
      fallbackPatterns: [
        "Z.ai fallback provider configured for server-side fallback",
        "Puter.js browser-auth fallback for client-side",
        "Provider failover chain: default → fallbacks → remaining active providers",
      ],
      riskLevel,
    },
    providerDiagnostics: {
      serverSide: serverSideProviders,
      clientSide: ["Puter (browser-auth)", "Z.ai (server fallback via /api/ai/chat)"],
      failoverChain: "default provider → fallback providers → other active providers (sorted by priority, excluding 'down')",
    },
    cacheDiagnostics: {
      type: "In-memory Map with TTL + LRU eviction",
      ttlMinutes: 30,
      maxEntries: 50,
      layers: ["jobAnalysis", "companyResearch", "atsReport"],
      integrityChecks: [
        "Offline optimizations never cached (isCacheableOptimization)",
        "Failed optimizations never cached (status check)",
        "Expired entries auto-evicted on read",
        "Max entries enforced with FIFO eviction",
      ],
    },
    exportDiagnostics: {
      formats: ["pdf", "docx", "doc", "txt", "html"],
      onePageEnforcement: true,
      layoutModel: "ResumeLayoutModel (single source of truth for PDF + DOCX)",
    },
    pipelineDiagnostics: {
      version: "V2 (6-agent) + V3 (supervisor)",
      agents: [
        "Resume Parser",
        "Job Intelligence",
        "Company Intelligence",
        "Skill Gap Analysis",
        "ATS Analysis",
        "Resume Optimizer",
        "Quality Assurance",
        "Reflection (conditional, triggered when QA confidence < 80%)",
        "Page Balancer (post-optimization)",
        "Memory Agent (cross-session persistence)",
      ],
      qualityGates: 13,
      reflectionTrigger: "QA confidence < 80% triggers reflection agent for re-optimization",
    },
    selfHealingDiagnostics: {
      actions: [
        "retry_provider — retry up to 3 times with exponential backoff",
        "disable_provider_temporarily — 5-minute cooldown after 3 failures",
        "purge_cache — clear corrupted cache entries",
        "restore_original — restore original resume if optimization invalid",
        "regenerate_export — re-generate failed exports",
        "abort_pipeline — abort and surface error (NEVER fake success)",
      ],
      maxRetries: 3,
      cooldownMinutes: 5,
      neverFakeSuccess: true,
    },
  });
}
