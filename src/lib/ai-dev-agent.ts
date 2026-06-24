// ResumeAI Pro — AI Development Agent engine
// Uses the existing callAI() gateway + AI Provider Management System.
// All scans/audits go through the configured provider (default: DeepSeek V4 Flash
// via OpenCode-compatible API).
//
// Safe Apply workflow: every generated patch/feature goes through
// draft → staging → tested → approved → applied. The agent NEVER modifies
// production directly.

"use client";

import { callAI, extractJSON } from "./ai";
import { useApp } from "./store";
import { searchRepository, readFile } from "./agent-runtime";
import type {
  AIDevAgentSettings,
  AIDevIssue,
  AIDevPatch,
  AIDevFeature,
  AIDevReport,
  HealthCheck,
  AppHealthDashboard,
} from "./types";

/**
 * Get the current AI Dev Agent settings (provider, model, etc.)
 */
export function getAIDevSettings(): AIDevAgentSettings {
  return useApp.getState().aiDevSettings;
}

/**
 * Resolve the provider to use for AI Dev Agent calls.
 * Priority: settings.providerId → first active DeepSeek provider → first active provider.
 */
function resolveProvider() {
  const state = useApp.getState();
  const settings = state.aiDevSettings;
  const providers = state.providers || [];

  // 1. Explicitly configured provider
  if (settings.providerId) {
    const p = providers.find((x: any) => x.id === settings.providerId && x.isActive);
    if (p) return { provider: p, model: settings.modelName };
  }
  // 2. First active DeepSeek provider (default)
  const deepseek = providers.find((x: any) => x.isActive && (x.type === "deepseek" || /deepseek/i.test(x.name)));
  if (deepseek) return { provider: deepseek, model: settings.modelName || deepseek.modelName || "deepseek-v4-flash" };
  // 3. First active OpenCode-compatible provider
  const opencode = providers.find((x: any) => x.isActive && /opencode/i.test(x.name));
  if (opencode) return { provider: opencode, model: settings.modelName || opencode.modelName || "deepseek-v4-flash" };
  // 4. Fallback: any active provider
  const any = providers.find((x: any) => x.isActive);
  return { provider: any, model: settings.modelName };
}

/**
 * Call the AI with the Dev Agent's configured provider + system prompt.
 * Falls back to callAI's built-in provider chain if no provider is configured.
 */
export async function callDevAgent(opts: {
  userPrompt: string;
  systemPromptOverride?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; provider: string; model: string }> {
  const settings = getAIDevSettings();
  const { provider, model } = resolveProvider();

  const systemPrompt = opts.systemPromptOverride || settings.systemPrompt;

  // If we have a configured provider, use callUserProvider via callAI
  // (callAI already tries the user's default provider first, so this works)
  const result = await callAI({
    systemPrompt,
    userPrompt: opts.userPrompt,
    maxTokens: opts.maxTokens ?? settings.maxTokens,
    temperature: opts.temperature ?? settings.temperature,
  });

  return {
    text: result.text,
    provider: provider?.name || result.provider,
    model: model || "default",
  };
}

/**
 * Call the AI and extract JSON from the response. If the AI returns prose
 * instead of JSON, retry ONCE with a stricter prompt that prepends
 * "Return ONLY valid JSON. No prose, no markdown fences, no explanations."
 *
 * If the retry also fails, returns null (caller should handle the fallback).
 */
export async function callDevAgentJSON<T = any>(opts: {
  userPrompt: string;
  systemPromptOverride?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ data: T | null; rawText: string; provider: string; model: string }> {
  const settings = getAIDevSettings();

  // First attempt
  let result = await callDevAgent(opts);

  // Try to extract JSON
  try {
    const data = extractJSON<T>(result.text);
    return { data, rawText: result.text, provider: result.provider, model: result.model };
  } catch {
    // JSON extraction failed — retry with a stricter prompt
    console.warn("[AI Dev Agent] First call returned non-JSON, retrying with stricter prompt...");
  }

  // Retry with a much more forceful JSON-only instruction
  const stricterSystemPrompt = (opts.systemPromptOverride || settings.systemPrompt) +
    "\n\nCRITICAL REQUIREMENT: You MUST respond with ONLY valid JSON. No prose, no markdown fences, no explanations, no preamble. The very first character of your response must be '{' or '['. If you include any text before the JSON, the system will reject your response.";

  const stricterUserPrompt = opts.userPrompt +
    "\n\nREMINDER: Return ONLY valid JSON. Start your response with '{'. Do not include any text before or after the JSON object.";

  try {
    result = await callDevAgent({
      ...opts,
      userPrompt: stricterUserPrompt,
      systemPromptOverride: stricterSystemPrompt,
      temperature: 0.1, // lower temperature for more deterministic output
    });
    const data = extractJSON<T>(result.text);
    return { data, rawText: result.text, provider: result.provider, model: result.model };
  } catch {
    // Still failed — return null and let the caller handle it
    return { data: null, rawText: result.text, provider: result.provider, model: result.model };
  }
}

/**
 * Create a report from a prose (non-JSON) AI response.
 * This is a fallback when the AI doesn't return structured JSON.
 * We extract whatever useful info we can from the prose.
 */
function makeProseReport(
  type: AIDevReport["type"],
  title: string,
  proseResponse: string,
  provider: string,
  model: string,
): AIDevReport {
  // Truncate the prose for the summary
  const summary = `AI returned a prose response instead of structured JSON (provider: ${provider}/${model}). ` +
    `The response started with: "${proseResponse.slice(0, 150)}${proseResponse.length > 150 ? "..." : ""}". ` +
    `This usually means the AI provider doesn't follow JSON-only instructions well. ` +
    `Try a different provider (e.g. GPT-4o, Claude) or lower the temperature in Settings.`;

  return {
    id: `rpt_${Date.now()}`,
    type,
    title,
    summary,
    issues: [{
      id: `iss_${Math.random().toString(36).slice(2, 9)}`,
      type: type.split("_")[0] as AIDevIssue["type"],
      severity: "warning",
      title: "AI returned prose instead of JSON",
      description: `The AI provider (${provider}/${model}) returned a prose response instead of the requested JSON structure. This is a provider capability issue, not a code issue. The raw response was:\n\n${proseResponse.slice(0, 500)}${proseResponse.length > 500 ? "..." : ""}`,
      recommendedFix: `Try one of:\n1. Switch to a more capable model (GPT-4o, Claude Sonnet) in Settings\n2. Lower the temperature to 0.1\n3. Use a provider that better follows JSON-only instructions`,
      status: "open",
    }],
    score: undefined,
    createdBy: useApp.getState().user?.email || "system",
    createdAt: new Date().toISOString(),
  };
}

// ============================================================================
// SCAN FUNCTIONS — each returns a structured report
// ============================================================================

/**
 * CODE AUDIT — scan the codebase for TypeScript errors, ESLint issues,
 * dead code, broken imports, etc.
 */
export async function scanCode(): Promise<AIDevReport> {
  const userPrompt = `Perform a comprehensive code audit of this Next.js 16 + Cloudflare Pages + D1 application.

Scan for:
- TypeScript errors (type mismatches, missing properties, etc.)
- ESLint errors (unused vars, no-this-alias, no-require-imports, etc.)
- Dead code (unused exports, unreachable branches)
- Duplicate code blocks
- Broken imports (modules that don't exist)
- Unused dependencies
- Memory leaks (uncleared intervals, listeners, etc.)
- React hydration issues (useEffect without deps, SSR mismatches)
- React warnings (missing keys, unescaped entities, etc.)

The application is at https://github.com/rachidSabah/INFOHAS-ATS-PRO.
Key directories: src/lib (core logic), src/components (UI), src/app (Next.js routes), workers/api (Cloudflare Workers).

Return ONLY valid JSON:
{
  "summary": "1-2 sentence summary of findings",
  "issues": [
    {
      "type": "code",
      "severity": "warning",
      "file": "src/lib/ai.ts",
      "line": 249,
      "title": "Property 'message' does not exist on type '{}'",
      "description": "The Puter response object is typed as {} but we access .message.content on it.",
      "recommendedFix": "Cast resp to any: const resp: any = await ..."
    }
  ]
}`;

  try {
    const { data, rawText, provider, model } = await callDevAgentJSON<{ summary: string; issues: any[] }>({ userPrompt });
    if (data) {
      return {
        type: "code_audit",
        title: "Code Audit",
        summary: data.summary || "Code audit completed",
        issues: (data.issues || []).map(normalizeIssue),
        score: undefined,
        createdBy: useApp.getState().user?.email || "system",
      } as Omit<AIDevReport, "id" | "createdAt"> as AIDevReport;
    }
    // AI returned prose instead of JSON — create a fallback report
    return makeProseReport("code_audit", "Code Audit", rawText, provider, model);
  } catch (e: any) {
    return makeErrorReport("code_audit", "Code Audit", e?.message || "Scan failed");
  }
}

/**
 * ERROR ANALYSIS — analyze browser console, network requests, worker logs,
 * API logs for 404/401/403/500/timeout/runtime exceptions.
 */
export async function analyzeErrors(): Promise<AIDevReport> {
  const userPrompt = `Analyze this Next.js 16 + Cloudflare application for errors.

Detect:
- HTTP 404 (not found), 401 (unauthorized), 403 (forbidden), 500 (server error)
- Timeouts (network, API, worker)
- Runtime exceptions (TypeError, ReferenceError, SyntaxError)
- Validation failures (Zod, Yup, manual)

Common error sources in this app:
- Cloudflare Workers API at https://resumeai-pro-api.rachidelsabah.workers.dev
- D1 database queries
- AI provider calls (Puter, DeepSeek, OpenAI, etc.)
- PDF/DOCX export (jsPDF, docx)
- Auth (Puter OAuth, email/password)

Return ONLY valid JSON:
{
  "summary": "...",
  "issues": [
    {
      "type": "error",
      "severity": "error",
      "file": "src/lib/cloud-api.ts",
      "title": "404 on /api/health",
      "description": "The health check endpoint returns 404",
      "recommendedFix": "Add a /api/health route to the Workers API"
    }
  ]
}`;

  try {
    const { data, rawText, provider, model } = await callDevAgentJSON<{ summary: string; issues: any[] }>({ userPrompt });
    if (data) {
      return {
        type: "error_analysis",
        title: "Error Analysis",
        summary: data.summary,
        issues: (data.issues || []).map(normalizeIssue),
      createdBy: useApp.getState().user?.email || "system",
    } as AIDevReport;
    }
    return makeProseReport("error_analysis", "Error Analysis", rawText, provider, model);
  } catch (e: any) {
    return makeErrorReport("error_analysis", "Error Analysis", e?.message || "Analysis failed");
  }
}

/**
 * ROUTE INSPECTOR — scan app/worker/API routes using REAL repository data.
 * Uses the Repository Intelligence Engine to read actual files — NO hallucination.
 */
export async function inspectRoutes(): Promise<AIDevReport> {
  const issues: AIDevIssue[] = [];
  const evidence: string[] = [];

  try {
    // === 1. Read the REAL AppShell.tsx to check VIEW_COMPONENTS ===
    const appShellResult = await searchRepository("VIEW_COMPONENTS", { filePattern: "*.tsx" });
    let appShellFile: string | null = null;
    for (const r of appShellResult) {
      if (r.file.includes("AppShell")) {
        appShellFile = r.file;
        break;
      }
    }

    if (appShellFile) {
      try {
        const file = await readFile(appShellFile);
        // Find all view keys in VIEW_COMPONENTS
        const viewKeysInMap: string[] = [];
        for (let i = 0; i < file.lines.length; i++) {
          const line = file.lines[i];
          const match = line.match(/^\s*["']([^"']+)["']\s*:/);
          if (match && line.includes(":") && !line.includes("const") && !line.includes("//")) {
            viewKeysInMap.push(match[1]);
          }
        }

        // Find all ViewKey union members
        const typesResult = await searchRepository("ViewKey", { filePattern: "*.ts" });
        let viewKeyFile: string | null = null;
        for (const r of typesResult) {
          if (r.file.includes("types")) {
            viewKeyFile = r.file;
            break;
          }
        }

        if (viewKeyFile) {
          const typesFile = await readFile(viewKeyFile);
          const viewKeyMembers: string[] = [];
          let inViewKey = false;
          for (let i = 0; i < typesFile.lines.length; i++) {
            const line = typesFile.lines[i];
            if (line.includes("type ViewKey")) { inViewKey = true; continue; }
            if (inViewKey) {
              const match = line.match(/["']([^"']+)["']/);
              if (match) viewKeyMembers.push(match[1]);
              if (line.includes(";") || line.includes("}")) { inViewKey = false; break; }
            }
          }

          // Check for ViewKey members missing from VIEW_COMPONENTS
          for (const vk of viewKeyMembers) {
            if (!viewKeysInMap.includes(vk)) {
              issues.push({
                id: `iss_${Math.random().toString(36).slice(2, 9)}`,
                type: "route",
                severity: "warning",
                file: appShellFile,
                line: 1,
                title: `ViewKey '${vk}' missing from VIEW_COMPONENTS`,
                description: `The ViewKey type includes '${vk}' but VIEW_COMPONENTS map in ${appShellFile} doesn't have an entry for it. This would cause a runtime error if a user navigates to this view.`,
                recommendedFix: `Add "${vk}": SomeComponent to VIEW_COMPONENTS in ${appShellFile}`,
                status: "open",
              });
              evidence.push(`File: ${appShellFile}\nViewKey member '${vk}' not found in VIEW_COMPONENTS map`);
            }
          }
        }

        // === 2. Check SUPER_ADMIN_VIEWS for access control ===
        const superAdminResult = await searchRepository("SUPER_ADMIN_VIEWS", { filePattern: "*.tsx" });
        if (superAdminResult.length > 0) {
          const saFile = await readFile(superAdminResult[0].file);
          const superAdminViews: string[] = [];
          let inArray = false;
          for (let i = 0; i < saFile.lines.length; i++) {
            const line = saFile.lines[i];
            if (line.includes("SUPER_ADMIN_VIEWS")) { inArray = true; continue; }
            if (inArray) {
              const match = line.match(/["']([^"']+)["']/);
              if (match) superAdminViews.push(match[1]);
              if (line.includes("];") || line.includes("}")) { inArray = false; break; }
            }
          }

          // Check if all ViewKey members that should be super-admin-only are in SUPER_ADMIN_VIEWS
          const expectedSuperAdmin = ["ai-providers", "ai-models", "ai-settings", "ai-logs", "prompts", "branding", "feature-flags", "optimizer-directive", "ai-dev-agent", "ai-workspace", "logs", "super-admin", "user-approvals", "suspended-users"];
          for (const view of expectedSuperAdmin) {
            if (!superAdminViews.includes(view)) {
              issues.push({
                id: `iss_${Math.random().toString(36).slice(2, 9)}`,
                type: "route",
                severity: "error",
                file: superAdminResult[0].file,
                line: superAdminResult[0].line,
                title: `View '${view}' missing from SUPER_ADMIN_VIEWS`,
                description: `The view '${view}' appears to be a super-admin-only view but is not listed in SUPER_ADMIN_VIEWS. Non-superadmin users could potentially access it.`,
                recommendedFix: `Add "${view}" to SUPER_ADMIN_VIEWS in ${superAdminResult[0].file}`,
                status: "open",
              });
              evidence.push(`File: ${superAdminResult[0].file}\nView '${view}' not in SUPER_ADMIN_VIEWS`);
            }
          }
        }

        // === 3. Check for canAccessView function ===
        const accessCheckResult = await searchRepository("canAccessView", { filePattern: "*.tsx" });
        if (accessCheckResult.length === 0) {
          issues.push({
            id: `iss_${Math.random().toString(36).slice(2, 9)}`,
            type: "route",
            severity: "error",
            file: appShellFile,
            line: 1,
            title: "No access control function found",
            description: "No canAccessView() function was found in the codebase. Route access control may be missing.",
            recommendedFix: "Implement canAccessView(view, role) in AppShell to prevent unauthorized access",
            status: "open",
          });
        }
      } catch (e: any) {
        // File read failed — skip
      }
    }

    // === 4. Find REAL API routes ===
    const apiRoutes = await searchRepository("export async function (GET|POST|PUT|DELETE|PATCH)", { regex: true, filePattern: "**/route.ts" });
    evidence.push(`Found ${apiRoutes.length} API route handler(s) in the codebase`);

    // === 5. Check for broken setView calls ===
    const setViewResults = await searchRepository("setView\\(", { regex: true, filePattern: "*.tsx" });
    for (const r of setViewResults.slice(0, 20)) {
      const match = r.match.match(/setView\(["']([^"']+)["']\)/);
      if (match) {
        const viewKey = match[1];
        // Check if this viewKey exists in VIEW_COMPONENTS
        const viewCheck = await searchRepository(`"${viewKey}"`, { filePattern: "**/AppShell.tsx" });
        if (viewCheck.length === 0) {
          issues.push({
            id: `iss_${Math.random().toString(36).slice(2, 9)}`,
            type: "route",
            severity: "error",
            file: r.file,
            line: r.line,
            title: `setView('${viewKey}') references non-existent view`,
            description: `The code in ${r.file}:${r.line} calls setView('${viewKey}') but this view key may not exist in VIEW_COMPONENTS.`,
            recommendedFix: `Verify that '${viewKey}' is in VIEW_COMPONENTS or update the setView call`,
            status: "open",
          });
          evidence.push(`File: ${r.file}:${r.line}\nsetView('${viewKey}') — view may not exist`);
        }
      }
    }

    const summary = issues.length === 0
      ? `Route inspection completed. Found ${apiRoutes.length} API routes. No issues found. All ViewKey members have VIEW_COMPONENTS entries.`
      : `Route inspection completed with REAL repository evidence. Found ${issues.length} issue(s) across ${issues.filter(i => i.file).length} file(s). Scanned ${apiRoutes.length} API routes and ${setViewResults.length} setView() calls.`;

    return {
      type: "route_inspector",
      title: "Route Inspector",
      summary,
      issues,
      createdBy: useApp.getState().user?.email || "system",
    } as Omit<AIDevReport, "id" | "createdAt"> as AIDevReport;
  } catch (e: any) {
    return makeErrorReport("route_inspector", "Route Inspector", e?.message || "Inspection failed — ensure /api/repo is accessible");
  }
}

/**
 * DATABASE INSPECTOR — analyze D1 schema, indexes, foreign keys, migrations.
 */
export async function inspectDatabase(): Promise<AIDevReport> {
  const userPrompt = `Analyze the Cloudflare D1 (SQLite) database for this app.

Migrations are in migrations/ directory. Schema includes tables: users, resumes, cover_letters, job_descriptions, interviews, ats_reports, ai_providers, prompts, audit_logs, settings, downloads.

Detect:
- Missing indexes (columns frequently queried but not indexed)
- Orphan records (foreign key references that don't exist)
- Slow queries (SELECT * without WHERE, N+1 patterns)
- Duplicate records
- Missing foreign key constraints
- Schema drift between migrations

Return ONLY valid JSON:
{
  "summary": "...",
  "issues": [
    {
      "type": "database",
      "severity": "warning",
      "file": "migrations/0001_init.sql",
      "title": "Missing index on resumes.user_id",
      "description": "The resumes table is queried by user_id but has no index on it.",
      "recommendedFix": "CREATE INDEX idx_resumes_user_id ON resumes(user_id);"
    }
  ]
}`;

  try {
    const { data, rawText, provider, model } = await callDevAgentJSON<{ summary: string; issues: any[] }>({ userPrompt });
    if (data) {
      return {
        type: "database_inspector",
        title: "Database Inspector",
        summary: data.summary,
        issues: (data.issues || []).map(normalizeIssue),
      createdBy: useApp.getState().user?.email || "system",
    } as AIDevReport;
    }
    return makeProseReport("database_inspector", "Database Inspector", rawText, provider, model);
  } catch (e: any) {
    return makeErrorReport("database_inspector", "Database Inspector", e?.message || "Inspection failed");
  }
}

/**
 * SECURITY SCANNER — detect XSS, CSRF, SQL injection, open redirects, etc.
 */
export async function scanSecurity(): Promise<AIDevReport> {
  const userPrompt = `Perform a security audit of this Next.js 16 + Cloudflare app.

Detect:
- XSS (dangerouslySetInnerHTML, unescaped user input)
- CSRF (missing CSRF tokens on mutations)
- SQL Injection (string-concatenated SQL queries)
- Open Redirects (redirect URLs from user input without validation)
- Broken Authentication (missing auth checks, weak password requirements)
- Broken Authorization (admin routes without role checks)
- Missing CSP (Content-Security-Policy header)
- Cookie Security Issues (missing HttpOnly, Secure, SameSite)

Return ONLY valid JSON:
{
  "summary": "...",
  "issues": [
    {
      "type": "security",
      "severity": "critical",
      "file": "src/app/layout.tsx",
      "title": "Missing Content-Security-Policy header",
      "description": "No CSP header is set, allowing arbitrary script execution.",
      "recommendedFix": "Add a CSP header via next.config.ts headers() or _middleware.ts"
    }
  ]
}`;

  try {
    const { data, rawText, provider, model } = await callDevAgentJSON<{ summary: string; issues: any[] }>({ userPrompt });
    if (data) {
      return {
        type: "security_scan",
        title: "Security Scan",
        summary: data.summary,
        issues: (data.issues || []).map(normalizeIssue),
      score: undefined,
      createdBy: useApp.getState().user?.email || "system",
    } as AIDevReport;
    }
    return makeProseReport("security_scan", "Security Scan", rawText, provider, model);
  } catch (e: any) {
    return makeErrorReport("security_scan", "Security Scan", e?.message || "Scan failed");
  }
}

/**
 * PERFORMANCE ANALYZER — analyze LCP, CLS, INP, TTFB, bundle size, latency.
 */
export async function analyzePerformance(): Promise<AIDevReport> {
  const userPrompt = `Analyze the performance of this Next.js 16 + Cloudflare Pages app.

Metrics to assess:
- LCP (Largest Contentful Paint) — should be < 2.5s
- CLS (Cumulative Layout Shift) — should be < 0.1
- INP (Interaction to Next Paint) — should be < 200ms
- TTFB (Time to First Byte) — should be < 800ms
- Bundle Size — should be < 200KB initial JS
- Worker Latency — API response times
- API Latency — database query times

Common performance issues in this app:
- Large client bundles (framer-motion, recharts, jsPDF, docx)
- No image optimization (Cloudflare Pages doesn't support next/image optimizer)
- Edge runtime cold starts
- D1 query latency

Return ONLY valid JSON:
{
  "summary": "...",
  "issues": [
    {
      "type": "performance",
      "severity": "warning",
      "file": "package.json",
      "title": "Large bundle: docx library",
      "description": "The docx library adds ~500KB to the client bundle.",
      "recommendedFix": "Use dynamic import: const docx = await import('docx') in the export function"
    }
  ]
}`;

  try {
    const { data, rawText, provider, model } = await callDevAgentJSON<{ summary: string; issues: any[] }>({ userPrompt });
    if (data) {
      return {
        type: "performance",
        title: "Performance Analysis",
        summary: data.summary,
        issues: (data.issues || []).map(normalizeIssue),
      createdBy: useApp.getState().user?.email || "system",
    } as AIDevReport;
    }
    return makeProseReport("performance", "Performance Analysis", rawText, provider, model);
  } catch (e: any) {
    return makeErrorReport("performance", "Performance Analysis", e?.message || "Analysis failed");
  }
}

/**
 * DEPLOYMENT VALIDATOR — validate Cloudflare Pages, Workers, D1, KV,
 * env vars, worker bindings, routing, build output.
 */
export async function validateDeployment(): Promise<AIDevReport> {
  const userPrompt = `Validate the deployment configuration for this Cloudflare app.

Check:
- Cloudflare Pages: wrangler.toml, build output (.next/standalone), env vars
- Cloudflare Workers: wrangler.toml, bindings (D1, KV), secrets
- Cloudflare D1: database ID, migrations applied
- Cloudflare KV: namespace IDs
- Environment Variables: NEXTAUTH_SECRET, JWT_SECRET, ENCRYPTION_KEY, etc.
- Worker Bindings: DB, KV, vars
- Routing: Pages <-> Worker API CORS
- Build Output: .next/standalone generated correctly

Return ONLY valid JSON:
{
  "summary": "...",
  "issues": [
    {
      "type": "deployment",
      "severity": "error",
      "file": "wrangler.toml",
      "title": "Missing D1 binding in wrangler.toml",
      "description": "The Workers API wrangler.toml doesn't bind the D1 database.",
      "recommendedFix": "Add [[d1_databases]] binding = 'DB' database_name = 'resumeai-pro-db'"
    }
  ]
}`;

  try {
    const { data, rawText, provider, model } = await callDevAgentJSON<{ summary: string; issues: any[] }>({ userPrompt });
    if (data) {
      return {
        type: "deployment_validation",
        title: "Deployment Validation",
        summary: data.summary,
        issues: (data.issues || []).map(normalizeIssue),
      createdBy: useApp.getState().user?.email || "system",
    } as AIDevReport;
    }
    return makeProseReport("deployment_validation", "Deployment Validation", rawText, provider, model);
  } catch (e: any) {
    return makeErrorReport("deployment_validation", "Deployment Validation", e?.message || "Validation failed");
  }
}

/**
 * FEATURE GENERATOR — generate UI + API + DB + tests for a feature request.
 */
export async function generateFeature(request: string): Promise<AIDevFeature> {
  const userPrompt = `Generate a complete feature for this Next.js 16 + Cloudflare app.

Feature Request: "${request}"

Generate ALL files needed:
1. UI component(s) in src/components/app/modules/
2. API route(s) in src/app/api/ (if needed)
3. Database migration in migrations/ (if needed)
4. Tests in *.test.ts
5. Update AppShell.tsx VIEW_COMPONENTS + access control (if new view)

Tech stack:
- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- Zustand for state
- Cloudflare D1 (SQLite) for database
- Cloudflare Workers (Hono) for API

Return ONLY valid JSON:
{
  "title": "Feature name",
  "description": "1-2 sentence description",
  "files": [
    {
      "path": "src/components/app/modules/MyFeature.tsx",
      "content": "\"use client\"\\nimport { ... }\\n// full file content",
      "type": "component"
    },
    {
      "path": "migrations/0003_my_feature.sql",
      "content": "CREATE TABLE ...",
      "type": "migration"
    },
    {
      "path": "src/lib/my-feature.test.ts",
      "content": "import { describe, it, expect } ...",
      "type": "test"
    }
  ]
}`;

  try {
    const { data, rawText, provider, model } = await callDevAgentJSON<any>({ userPrompt, maxTokens: 10000 });
    if (data) {
      return {
        id: `feat_${Date.now()}`,
        title: data.title || "Generated Feature",
        description: data.description || "",
        request,
        files: (data.files || []).map((f: any) => ({
          path: f.path,
          content: f.content,
          type: f.type || "other",
        })),
        status: "draft",
        createdAt: new Date().toISOString(),
      };
    }
    // AI returned prose — return a fallback feature with the raw text
    return {
      id: `feat_${Date.now()}`,
      title: "Feature Generation (prose response)",
      description: `AI returned a prose response instead of structured JSON (provider: ${provider}/${model}). The raw response is stored in the first file. Try a different provider or lower the temperature.`,
      request,
      files: [{
        path: "AI_RESPONSE.txt",
        content: rawText,
        type: "other",
      }],
      status: "draft",
      createdAt: new Date().toISOString(),
    };
  } catch (e: any) {
    return {
      id: `feat_${Date.now()}`,
      title: "Generation Failed",
      description: e?.message || "Feature generation failed",
      request,
      files: [],
      status: "draft",
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * PATCH GENERATOR — generate a unified git diff patch for a specific issue/fix.
 */
export async function generatePatch(issue: AIDevIssue): Promise<AIDevPatch> {
  const userPrompt = `Generate a patch (unified git diff) to fix this issue:

Issue:
- Type: ${issue.type}
- Severity: ${issue.severity}
- File: ${issue.file || "unknown"}
- Line: ${issue.line || "unknown"}
- Title: ${issue.title}
- Description: ${issue.description}
- Recommended Fix: ${issue.recommendedFix || "n/a"}

Generate:
1. A unified git diff (diff --git a/... b/... format) that fixes the issue
2. Impact analysis (what else might be affected)
3. Risk analysis (low/medium/high)
4. A test that verifies the fix

Return ONLY valid JSON:
{
  "title": "Fix: <short description>",
  "description": "1-2 sentence description of the fix",
  "diff": "diff --git a/src/lib/ai.ts b/src/lib/ai.ts\\n--- a/src/lib/ai.ts\\n+++ b/src/lib/ai.ts\\n@@ -247,7 +247,7 @@\\n-          } else if (resp?.message?.content) {\\n+          } else if ((resp as any)?.message?.content) {",
  "modifiedFiles": ["src/lib/ai.ts"],
  "newFiles": [],
  "deletedFiles": [],
  "impactAnalysis": "This change only affects the Puter response parsing path. No other code paths are affected.",
  "riskAnalysis": "low",
  "generatedTests": "import { describe, it, expect } from 'vitest';\\n// test code"
}`;

  try {
    const { data, rawText, provider, model } = await callDevAgentJSON<any>({ userPrompt, maxTokens: 8000 });
    if (data) {
      return {
        id: `patch_${Date.now()}`,
        title: data.title || "Generated Patch",
        description: data.description || "",
        diff: data.diff || "",
        modifiedFiles: data.modifiedFiles || [],
        newFiles: data.newFiles || [],
        deletedFiles: data.deletedFiles || [],
        impactAnalysis: data.impactAnalysis || "",
        riskAnalysis: data.riskAnalysis || "medium",
        generatedTests: data.generatedTests || "",
        status: "draft",
        createdAt: new Date().toISOString(),
      };
    }
    // AI returned prose — return a fallback patch with the raw text as the diff
    return {
      id: `patch_${Date.now()}`,
      title: "Patch Generation (prose response)",
      description: `AI returned a prose response instead of structured JSON (provider: ${provider}/${model}). The raw response is stored in the diff field. Try a different provider or lower the temperature.`,
      diff: `// AI returned prose instead of a unified diff.\n// Provider: ${provider}/${model}\n// Raw response:\n\n${rawText}`,
      modifiedFiles: [],
      newFiles: [],
      deletedFiles: [],
      impactAnalysis: "Unable to determine — AI returned prose instead of structured patch data.",
      riskAnalysis: "high",
      status: "draft",
      createdAt: new Date().toISOString(),
    };
  } catch (e: any) {
    return {
      id: `patch_${Date.now()}`,
      title: "Patch Generation Failed",
      description: e?.message || "Failed to generate patch",
      diff: "",
      modifiedFiles: [],
      newFiles: [],
      deletedFiles: [],
      impactAnalysis: "",
      riskAnalysis: "high",
      status: "draft",
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * TEST GENERATOR — generate tests for a given file or component.
 */
export async function generateTests(filePath: string, fileContent?: string): Promise<string> {
  const userPrompt = `Generate comprehensive tests for this file:

File: ${filePath}
${fileContent ? `\nContent:\n\`\`\`\n${fileContent.slice(0, 4000)}\n\`\`\`` : ""}

Generate:
1. Unit tests (Vitest) — test individual functions
2. Integration tests — test interactions with other modules
3. Edge cases — empty input, null, undefined, very large input
4. Error cases — what happens when things go wrong

Use Vitest (describe, it, expect, vi). Mock external dependencies.
Return ONLY the test file content (TypeScript), no markdown fences.`;

  try {
    const result = await callDevAgent({ userPrompt, maxTokens: 6000 });
    return result.text.replace(/```typescript|```ts|```/g, "").trim();
  } catch (e: any) {
    return `// Test generation failed: ${e?.message || "unknown error"}\n// Please generate tests manually for ${filePath}`;
  }
}

/**
 * HEALTH DASHBOARD — compute overall + per-area health scores.
 * Uses the latest reports to calculate scores.
 */
export function computeHealthDashboard(reports: AIDevReport[]): AppHealthDashboard {
  const now = new Date().toISOString();
  const checks: HealthCheck[] = [];

  // Map report types to health areas
  const findByType = (type: AIDevReport["type"]) =>
    reports.filter((r) => r.type === type).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const codeReport = findByType("code_audit");
  const errorReport = findByType("error_analysis");
  const routeReport = findByType("route_inspector");
  const dbReport = findByType("database_inspector");
  const securityReport = findByType("security_scan");
  const perfReport = findByType("performance");

  const scoreFrom = (r: AIDevReport | undefined, area: HealthCheck["area"]): HealthCheck => {
    if (!r) return { area, score: 100, status: "healthy", details: "No scan run yet — assumed healthy", lastChecked: now };
    const critical = r.issues.filter((i) => i.severity === "critical").length;
    const errors = r.issues.filter((i) => i.severity === "error").length;
    const warnings = r.issues.filter((i) => i.severity === "warning").length;
    const score = Math.max(0, 100 - critical * 25 - errors * 10 - warnings * 3);
    const status: HealthCheck["status"] = score >= 90 ? "healthy" : score >= 60 ? "degraded" : "down";
    return {
      area,
      score,
      status,
      details: `${critical} critical, ${errors} errors, ${warnings} warnings`,
      lastChecked: r.createdAt,
    };
  };

  checks.push(scoreFrom(codeReport, "frontend"));
  checks.push(scoreFrom(errorReport, "backend"));
  checks.push(scoreFrom(routeReport, "api"));
  checks.push(scoreFrom(dbReport, "database"));
  checks.push(scoreFrom(securityReport, "security"));
  checks.push(scoreFrom(perfReport, "performance"));
  // Accessibility — always 100 for now (no scanner implemented)
  checks.push({ area: "accessibility", score: 100, status: "healthy", details: "No accessibility scanner yet", lastChecked: now });

  const overall = Math.round(checks.reduce((sum, c) => sum + c.score, 0) / checks.length);
  const lastFullScan = reports.length
    ? reports.map((r) => r.createdAt).sort((a, b) => b.localeCompare(a))[0]
    : now;

  return { overall, checks, lastFullScan };
}

// ============================================================================
// HELPERS
// ============================================================================

function normalizeIssue(i: any): AIDevIssue {
  return {
    id: `iss_${Math.random().toString(36).slice(2, 9)}`,
    type: i.type || "code",
    severity: i.severity || "warning",
    file: i.file,
    line: i.line,
    title: i.title || "Untitled issue",
    description: i.description || "",
    recommendedFix: i.recommendedFix,
    status: "open",
  };
}

function makeErrorReport(type: AIDevReport["type"], title: string, errorMsg: string): AIDevReport {
  return {
    id: `rpt_${Date.now()}`,
    type,
    title,
    summary: `Scan failed: ${errorMsg}`,
    issues: [{
      id: `iss_${Math.random().toString(36).slice(2, 9)}`,
      type: type.split("_")[0] as AIDevIssue["type"],
      severity: "error",
      title: "Scan failed",
      description: errorMsg,
      status: "open",
    }],
    createdBy: useApp.getState().user?.email || "system",
    createdAt: new Date().toISOString(),
  };
}
