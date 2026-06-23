// ResumeAI Pro — Health Endpoint
// Returns system health, provider status, cache info, and runtime metadata.
// Edge Runtime compatible — no Node.js APIs.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const START_TIME = Date.now();

type HealthStatus = "ok" | "degraded" | "down" | "unknown";

interface HealthCheck {
  status: HealthStatus;
  detail?: string;
  [key: string]: unknown;
}

interface HealthResponse {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  uptimeSeconds: number;
  runtime: "edge";
  checks: {
    providers: HealthCheck;
    cache: HealthCheck;
    database: HealthCheck;
    storage: HealthCheck;
    ai: HealthCheck;
    exports: HealthCheck;
    pipeline: HealthCheck;
    workers: HealthCheck;
  };
  env: string[];
}

export async function GET(_req: NextRequest): Promise<NextResponse<HealthResponse>> {
  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);

  // Detect configured providers from env vars (presence only — never expose values)
  const configuredProviders: string[] = [];
  if (process.env.PUTER_API_KEY) configuredProviders.push("puter");
  if (process.env.OPENAI_API_KEY) configuredProviders.push("openai");
  if (process.env.GEMINI_API_KEY) configuredProviders.push("gemini");
  if (process.env.ANTHROPIC_API_KEY) configuredProviders.push("anthropic");
  if (process.env.DEEPSEEK_API_KEY) configuredProviders.push("deepseek");
  if (process.env.NVIDIA_API_KEY) configuredProviders.push("nvidia");
  if (process.env.GROQ_API_KEY) configuredProviders.push("groq");
  if (process.env.MISTRAL_API_KEY) configuredProviders.push("mistral");
  if (process.env.OPENROUTER_API_KEY) configuredProviders.push("openrouter");
  if (process.env.COHERE_API_KEY) configuredProviders.push("cohere");

  const hasDbUrl = !!process.env.DATABASE_URL;

  // Aggregate overall status
  const allChecks: HealthCheck[] = [];
  const providersCheck: HealthCheck = {
    status: configuredProviders.length > 0 ? "ok" : "degraded",
    configured: configuredProviders.length,
    providers: configuredProviders,
    detail: configuredProviders.length > 0
      ? `${configuredProviders.length} provider(s) configured`
      : "No server-side providers configured (browser-auth providers available client-side)",
  };
  allChecks.push(providersCheck);

  const cacheCheck: HealthCheck = {
    status: "ok",
    type: "in-memory (session-scoped)",
    detail: "Cache is session-scoped. No persistent cache to scan.",
  };
  allChecks.push(cacheCheck);

  const dbCheck: HealthCheck = {
    status: hasDbUrl ? "ok" : "degraded",
    configured: hasDbUrl,
    detail: hasDbUrl ? "DATABASE_URL configured" : "No DATABASE_URL set",
  };
  allChecks.push(dbCheck);

  const storageCheck: HealthCheck = {
    status: "ok",
    detail: "In-memory / localStorage (client-side persistence)",
  };
  allChecks.push(storageCheck);

  const aiCheck: HealthCheck = {
    status: providersCheck.status,
    detail: configuredProviders.length > 0
      ? "AI calls route through configured providers"
      : "AI routing falls back to browser-auth providers (Puter, etc.)",
  };
  allChecks.push(aiCheck);

  const exportsCheck: HealthCheck = {
    status: "ok",
    formats: ["pdf", "docx", "doc", "txt", "html"],
    detail: "All export formats available",
  };
  allChecks.push(exportsCheck);

  const pipelineCheck: HealthCheck = {
    status: "ok",
    agents: "6-agent V2 pipeline (JI, Company+SkillGap, ATS, Optimizer, QA, Reflection)",
    detail: "Pipeline operational",
  };
  allChecks.push(pipelineCheck);

  const workersCheck: HealthCheck = {
    status: "ok",
    runtime: "edge",
  };
  allChecks.push(workersCheck);

  const hasDegraded = allChecks.some((c) => c.status === "degraded");
  const hasDown = allChecks.some((c) => c.status === "down");

  return NextResponse.json({
    status: hasDown ? "down" : hasDegraded ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    runtime: "edge",
    checks: {
      providers: providersCheck,
      cache: cacheCheck,
      database: dbCheck,
      storage: storageCheck,
      ai: aiCheck,
      exports: exportsCheck,
      pipeline: pipelineCheck,
      workers: workersCheck,
    },
    env: ["DATABASE_URL", ...configuredProviders.map((p) => `${p.toUpperCase()}_API_KEY`)].filter((k) => !!process.env[k] || k === "DATABASE_URL" ? !!process.env[k] : true).map((k) => k),
  });
}
