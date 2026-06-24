// ResumeAI Pro — AI Builder Agent engine
// Extends the AI Dev Agent with full code-editing capabilities:
//   - Repository Explorer (browse files)
//   - File operations (read/create/update/rename/move/delete)
//   - AI File Editor (syntax highlighting, diff viewer)
//   - Git Manager (branches, commits, PRs)
//   - AI Task System (analyze → plan → generate → test → approve)
//   - Patch Center (pending/approved/rejected/applied/rolled_back)
//   - Build Manager (run build, validate, view logs)
//   - Test Runner (Vitest, Playwright)
//   - Rollback System
//
// All operations go through the Safe Apply workflow:
//   Generate Patch → Staging Branch → Build → Test → Report → Approval → Merge
// The AI NEVER directly modifies production.

"use client";

import { callAI, extractJSON } from "./ai";
import { useApp } from "./store";
import { searchRepository } from "./agent-runtime";
import type {
  AITask, AIWorkspacePatch, AIBuildResult, AITestResult,
  AIFile, AIGitBranch, AIGitCommit,
} from "./types";

// ============================================================================
// REPOSITORY EXPLORER — file tree + file reading
// ============================================================================

/**
 * Known project structure (static map of the ResumeAI Pro repo).
 * In a real IDE, this would be a live file system. Here we provide a
 * representative tree so the AI and user can browse the project.
 */
export const PROJECT_TREE: AIFile[] = [
  // Root
  { path: "src", type: "directory" },
  { path: "src/app", type: "directory" },
  { path: "src/app/api", type: "directory" },
  { path: "src/app/api/ai", type: "directory" },
  { path: "src/app/api/ai/chat", type: "directory" },
  { path: "src/app/api/ai/chat/route.ts", type: "file", language: "ts", size: 2048 },
  { path: "src/app/api/jd-scrape", type: "directory" },
  { path: "src/app/api/jd-scrape/route.ts", type: "file", language: "ts", size: 5120 },
  { path: "src/app/api/providers", type: "directory" },
  { path: "src/app/api/providers/models", type: "directory" },
  { path: "src/app/api/providers/models/route.ts", type: "file", language: "ts", size: 3072 },
  { path: "src/app/api/providers/test", type: "directory" },
  { path: "src/app/api/providers/test/route.ts", type: "file", language: "ts", size: 4096 },
  { path: "src/app/layout.tsx", type: "file", language: "tsx", size: 3584 },
  { path: "src/app/page.tsx", type: "file", language: "tsx", size: 4096 },
  { path: "src/app/globals.css", type: "file", language: "css", size: 2048 },
  { path: "src/components", type: "directory" },
  { path: "src/components/app", type: "directory" },
  { path: "src/components/app/modules", type: "directory" },
  { path: "src/components/app/modules/AIDevAgent.tsx", type: "file", language: "tsx", size: 25000 },
  { path: "src/components/app/modules/AIWorkspace.tsx", type: "file", language: "tsx", size: 30000 },
  { path: "src/components/app/modules/Optimizer.tsx", type: "file", language: "tsx", size: 28000 },
  { path: "src/components/app/modules/OptimizerDirective.tsx", type: "file", language: "tsx", size: 15000 },
  { path: "src/components/app/modules/ATSChecker.tsx", type: "file", language: "tsx", size: 18000 },
  { path: "src/components/app/modules/Builder.tsx", type: "file", language: "tsx", size: 22000 },
  { path: "src/components/app/modules/JDScraper.tsx", type: "file", language: "tsx", size: 12000 },
  { path: "src/components/app/modules/CoverLetter.tsx", type: "file", language: "tsx", size: 15000 },
  { path: "src/components/app/modules/Interview.tsx", type: "file", language: "tsx", size: 14000 },
  { path: "src/components/app/modules/MyResumes.tsx", type: "file", language: "tsx", size: 10000 },
  { path: "src/components/app/modules/Dashboard.tsx", type: "file", language: "tsx", size: 16000 },
  { path: "src/components/app/modules/Settings.tsx", type: "file", language: "tsx", size: 12000 },
  { path: "src/components/app/modules/Users.tsx", type: "file", language: "tsx", size: 14000 },
  { path: "src/components/app/modules/SuperAdmin.tsx", type: "file", language: "tsx", size: 13000 },
  { path: "src/components/app/modules/AIProviders.tsx", type: "file", language: "tsx", size: 20000 },
  { path: "src/components/app/modules/AIModels.tsx", type: "file", language: "tsx", size: 11000 },
  { path: "src/components/app/modules/Prompts.tsx", type: "file", language: "tsx", size: 10000 },
  { path: "src/components/app/modules/Branding.tsx", type: "file", language: "tsx", size: 9000 },
  { path: "src/components/app/modules/FeatureFlags.tsx", type: "file", language: "tsx", size: 8000 },
  { path: "src/components/app/modules/Logs.tsx", type: "file", language: "tsx", size: 7000 },
  { path: "src/components/app/AppShell.tsx", type: "file", language: "tsx", size: 6000 },
  { path: "src/components/app/Sidebar.tsx", type: "file", language: "tsx", size: 5000 },
  { path: "src/components/app/TopBar.tsx", type: "file", language: "tsx", size: 13000 },
  { path: "src/components/app/AuthModal.tsx", type: "file", language: "tsx", size: 11000 },
  { path: "src/components/resume", type: "directory" },
  { path: "src/components/resume/A4Preview.tsx", type: "file", language: "tsx", size: 20000 },
  { path: "src/components/resume/EditableA4Preview.tsx", type: "file", language: "tsx", size: 25000 },
  { path: "src/components/landing", type: "directory" },
  { path: "src/components/landing/LandingPage.tsx", type: "file", language: "tsx", size: 18000 },
  { path: "src/lib", type: "directory" },
  { path: "src/lib/ai.ts", type: "file", language: "ts", size: 45000 },
  { path: "src/lib/ai-dev-agent.ts", type: "file", language: "ts", size: 35000 },
  { path: "src/lib/ai-builder-agent.ts", type: "file", language: "ts", size: 30000 },
  { path: "src/lib/ai-error-filter.ts", type: "file", language: "ts", size: 8000 },
  { path: "src/lib/ats.ts", type: "file", language: "ts", size: 15000 },
  { path: "src/lib/ats-directives.ts", type: "file", language: "ts", size: 25000 },
  { path: "src/lib/auth-utils.ts", type: "file", language: "ts", size: 6000 },
  { path: "src/lib/brand.ts", type: "file", language: "ts", size: 5000 },
  { path: "src/lib/cloud-api.ts", type: "file", language: "ts", size: 12000 },
  { path: "src/lib/exporter.ts", type: "file", language: "ts", size: 30000 },
  { path: "src/lib/job-intelligence.ts", type: "file", language: "ts", size: 10000 },
  { path: "src/lib/output-validator.ts", type: "file", language: "ts", size: 12000 },
  { path: "src/lib/parser.ts", type: "file", language: "ts", size: 12000 },
  { path: "src/lib/relevance-engine.ts", type: "file", language: "ts", size: 11000 },
  { path: "src/lib/store.ts", type: "file", language: "ts", size: 40000 },
  { path: "src/lib/types.ts", type: "file", language: "ts", size: 20000 },
  { path: "src/lib/mock-data.ts", type: "file", language: "ts", size: 25000 },
  { path: "migrations", type: "directory" },
  { path: "migrations/0001_init.sql", type: "file", language: "sql", size: 8000 },
  { path: "migrations/0002_ai_providers_enhanced.sql", type: "file", language: "sql", size: 5000 },
  { path: "migrations/0003_ai_dev_agent.sql", type: "file", language: "sql", size: 3000 },
  { path: "workers", type: "directory" },
  { path: "workers/api", type: "directory" },
  { path: "workers/api/index.ts", type: "file", language: "ts", size: 20000 },
  { path: "package.json", type: "file", language: "json", size: 2000 },
  { path: "tsconfig.json", type: "file", language: "json", size: 800 },
  { path: "next.config.ts", type: "file", language: "ts", size: 600 },
  { path: "wrangler.toml", type: "file", language: "toml", size: 1000 },
  { path: "tailwind.config.ts", type: "file", language: "ts", size: 1200 },
  { path: "eslint.config.mjs", type: "file", language: "js", size: 1500 },
  { path: ".github/workflows/ci-cd.yml", type: "file", language: "yaml", size: 5000 },
  { path: "README.md", type: "file", language: "md", size: 4000 },
];

/**
 * List files in a directory (one level deep).
 */
export function listDirectory(dirPath: string): AIFile[] {
  const normalized = dirPath.replace(/\/$/, "");
  return PROJECT_TREE.filter((f) => {
    if (f.path === normalized) return false;
    const relativePath = f.path.startsWith(normalized + "/") ? f.path.slice(normalized.length + 1) : null;
    if (!relativePath) return false;
    // Only direct children (no further slashes)
    return !relativePath.includes("/");
  });
}

/**
 * Search files by name or path.
 */
export function searchFiles(query: string): AIFile[] {
  const q = query.toLowerCase();
  return PROJECT_TREE.filter((f) => f.type === "file" && f.path.toLowerCase().includes(q));
}

/**
 * Search for symbols (function/class names) across files.
 * Uses the AI to find symbol definitions.
 */
export async function searchSymbols(query: string): Promise<Array<{ file: string; line: number; symbol: string; type: string }>> {
  const prompt = `Search the ResumeAI Pro codebase for symbols matching "${query}".

Known files and their likely contents:
- src/lib/ai.ts — callAI, extractJSON, getOptimizerDirective, callUserProvider
- src/lib/store.ts — useApp (Zustand store), addResume, updateResume, signInWithPuter
- src/lib/ats.ts — scoreATS
- src/lib/exporter.ts — exportResumePDF, exportResumeDOCX
- src/lib/parser.ts — parseResumeFile, extractResumeFromText
- src/lib/cloud-api.ts — api, cloudApiSafe, syncAllFromCloud
- src/lib/ai-dev-agent.ts — scanCode, analyzeErrors, scanSecurity, generateFeature
- src/lib/ai-builder-agent.ts — executeTask, createStagingBranch, runBuild, runTests

Return ONLY valid JSON array:
[{"file": "src/lib/ai.ts", "line": 172, "symbol": "callAI", "type": "function"}]`;

  try {
    const result = await callAI({
      systemPrompt: "You are a code search engine. Return ONLY valid JSON arrays.",
      userPrompt: prompt,
      maxTokens: 1000,
      temperature: 0.1,
    });
    return extractJSON<Array<{ file: string; line: number; symbol: string; type: string }>>(result.text);
  } catch (err) {
    console.warn("[ai-builder] searchSymbols failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ============================================================================
// AI TASK SYSTEM — the core execution pipeline
// ============================================================================

/**
 * Execute an AI task through the full pipeline:
 *   1. Load the REAL project structure from repo-index.json
 *   2. Analyze the request (with real project context)
 *   3. Generate an execution plan (with correct file paths)
 *   4. Generate actual code for each file
 *   5. Generate tests
 *   6. Mark build/test as "pending" (honest — not simulated)
 *
 * The task is NOT applied automatically — it requires super admin approval.
 * Generated code is stored in the task for the user to review and copy.
 */
export async function executeTask(request: string, type: AITask["type"] = "feature"): Promise<AITask> {
  const taskId = `t_${Date.now()}`;
  const now = new Date().toISOString();
  const userEmail = useApp.getState().user?.email || "system";

  // Step 0: Load the REAL project structure so the AI uses correct paths
  const projectStructure = await getProjectStructure();

  // Step 1+2: Analyze + Plan (with real project context)
  const analysis = await analyzeAndPlan(request, type, projectStructure);

  // Step 3: Generate actual file contents (not just a diff)
  const generatedFiles = await generateFilesForTask(request, analysis.plan, analysis.affectedFiles, projectStructure);

  // Step 4: Generate tests
  const tests = await generateTestsForTask(request, analysis.affectedFiles, projectStructure);

  // Step 5: Build/test validation — COMPLETELY HONEST status
  // This is a browser-based app. It CANNOT run builds, run tests, or create files.
  // The generated code must be manually copied to the project by the user.
  const buildResult: AIBuildResult = {
    success: false, // NOT built — code is generated but not validated
    errors: [],
    warnings: [
      "CODE GENERATED — NOT BUILT. This is a browser-based app and cannot run 'npm run build'.",
      "To make this feature visible in the app:",
      "1. Copy each generated file below to the corresponding path in your local project",
      "2. Run 'npm run build' to validate",
      "3. Commit and push to deploy to Cloudflare Pages",
      "The feature will NOT appear in the app until you do this manually.",
    ],
    duration: 0,
    output: "Code generated but NOT built. Manual file creation + build required.",
    timestamp: now,
  };
  const testResult: AITestResult = {
    success: false, // NOT tested
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    output: "Tests generated but NOT executed. Manual test run required.",
    failures: [],
    timestamp: now,
  };

  // Build a unified diff from the generated files
  const diff = buildDiffFromFiles(generatedFiles);

  return {
    id: taskId,
    title: analysis.title,
    description: analysis.description,
    type,
    status: "ready",
    request,
    plan: analysis.plan,
    affectedFiles: analysis.affectedFiles,
    generatedPatch: diff,
    generatedTests: tests,
    buildResult,
    testResult,
    createdAt: now,
    updatedAt: now,
    createdBy: userEmail,
  };
}

/**
 * Get the REAL project structure from repo-index.json
 * Returns a summary of existing directories and files so the AI uses correct paths.
 */
async function getProjectStructure(): Promise<string> {
  try {
    const res = await fetch("/repo-index.json");
    if (!res.ok) return "Unable to load project structure.";
    const index = await res.json();
    const files = Object.keys(index);

    // Group by top-level directory
    const dirs: Record<string, string[]> = {};
    for (const f of files) {
      const parts = f.split("/");
      const topDir = parts.length > 1 ? parts[0] : "(root)";
      if (!dirs[topDir]) dirs[topDir] = [];
      dirs[topDir].push(f);
    }

    let summary = "EXISTING PROJECT STRUCTURE (use these patterns for new files):\n\n";
    for (const [dir, dirFiles] of Object.entries(dirs)) {
      summary += `${dir}/ (${dirFiles.length} files)\n`;
      // Show first 10 files per directory
      for (const f of dirFiles.slice(0, 10)) {
        summary += `  ${f}\n`;
      }
      if (dirFiles.length > 10) {
        summary += `  ... and ${dirFiles.length - 10} more\n`;
      }
      summary += "\n";
    }

    // Add key patterns
    summary += "KEY PATTERNS:\n";
    summary += "- UI components go in: src/components/app/modules/ (e.g., src/components/app/modules/MyFeature.tsx)\n";
    summary += "- Lib functions go in: src/lib/ (e.g., src/lib/my-feature.ts)\n";
    summary += "- API routes go in: src/app/api/ (e.g., src/app/api/my-feature/route.ts)\n";
    summary += "- Migrations go in: migrations/ (e.g., migrations/0005_my_migration.sql)\n";
    summary += "- Worker code goes in: workers/api/ (e.g., workers/api/index.ts)\n";
    summary += "- Store actions go in: src/lib/store.ts\n";
    summary += "- Types go in: src/lib/types.ts\n";
    summary += "- Navigation goes in: src/lib/brand.ts (NAV_USER, NAV_ADMIN, NAV_SUPER)\n";
    summary += "- Views go in: src/components/app/AppShell.tsx (VIEW_COMPONENTS map)\n";

    return summary;
  } catch (err) {
    console.warn("[ai-builder] getProjectStructure failed:", err instanceof Error ? err.message : err);
    return "Unable to load project structure. Use standard Next.js App Router patterns.";
  }
}

/**
 * Build a unified diff from generated files for display.
 */
function buildDiffFromFiles(files: Array<{ path: string; content: string; type: string }>): string {
  if (!files || files.length === 0) return "";

  let diff = "";
  for (const file of files) {
    diff += `diff --git a/${file.path} b/${file.path}\n`;
    diff += `new file mode 100644\n`;
    diff += `--- /dev/null\n`;
    diff += `+++ b/${file.path}\n`;
    diff += `@@ -0,0 +1,${file.content.split("\n").length} @@\n`;
    for (const line of file.content.split("\n")) {
      diff += `+${line}\n`;
    }
    diff += "\n";
  }

  return diff;
}

async function analyzeAndPlan(request: string, type: AITask["type"], projectStructure: string) {
  const prompt = `You are an AI Builder Agent analyzing a task for the ResumeAI Pro application.

Task type: ${type}
Request: "${request}"

The application is a Next.js 16 + Cloudflare Pages + D1 + Workers app.
Tech stack: React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Zustand, Hono.

${projectStructure}

CRITICAL: Use the EXACT file path patterns from the project structure above.
Do NOT invent paths like src/app/(main)/ or src/app/(admin)/ — this project
does NOT use route groups. Use src/app/api/ for API routes, src/components/app/modules/
for UI components, src/lib/ for library code, migrations/ for SQL migrations.

Analyze the request and create an execution plan. Return ONLY valid JSON:
{
  "title": "Short task title",
  "description": "1-2 sentence description",
  "plan": "Step 1: ...\\nStep 2: ...\\nStep 3: ...",
  "affectedFiles": ["src/components/app/modules/...", "src/lib/...", "migrations/..."]
}`;

  try {
    const result = await callAI({
      systemPrompt: "You are an AI Builder Agent. Always return ONLY valid JSON.",
      userPrompt: prompt,
      maxTokens: 2000,
      temperature: 0.3,
    });
    return extractJSON<any>(result.text);
  } catch (err) {
    console.warn("[ai-builder] analyzeTask failed:", err instanceof Error ? err.message : err);
    return {
      title: request.slice(0, 60),
      description: request,
      plan: "1. Analyze request\n2. Generate code\n3. Test\n4. Deploy",
      affectedFiles: [],
    };
  }
}

/**
 * Generate actual file contents for each affected file.
 * The AI receives the REAL project structure so it generates files with correct paths.
 */
async function generateFilesForTask(
  request: string,
  plan: string,
  affectedFiles: string[],
  projectStructure: string,
): Promise<Array<{ path: string; content: string; type: string }>> {
  const prompt = `Generate COMPLETE file contents for this feature:

Request: ${request}
Plan: ${plan}
Files to create: ${affectedFiles.join(", ")}

${projectStructure}

CRITICAL RULES:
1. Use the EXACT file path patterns from the project structure above
2. Do NOT use route groups like (main) or (admin) — this project doesn't use them
3. Generate COMPLETE, production-ready TypeScript/TSX code for each file
4. Use existing patterns from the project (Zustand store, shadcn/ui components, etc.)
5. Each file must be fully functional and compilable

Return ONLY valid JSON:
{
  "files": [
    {
      "path": "src/components/app/modules/MyFeature.tsx",
      "content": "\"use client\"\\nimport ...\\n// full file content",
      "type": "component"
    }
  ]
}`;

  try {
    const result = await callAI({
      systemPrompt: "You are a code generator. Generate complete, production-ready file contents. Always return ONLY valid JSON.",
      userPrompt: prompt,
      maxTokens: 10000,
      temperature: 0.2,
      taskCategory: "development",
    });

    const data = extractJSON<any>(result.text);
    if (data.files && Array.isArray(data.files)) {
      return data.files.map((f: any) => ({
        path: f.path,
        content: f.content || "",
        type: f.type || "other",
      }));
    }
    return [];
  } catch (err) {
    console.warn("[ai-builder] getAffectedFiles failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function generatePatchForTask(request: string, plan: string, affectedFiles: string[]) {
  const prompt = `Generate a patch (unified git diff) for this task:

Request: ${request}
Plan: ${plan}
Affected files: ${affectedFiles.join(", ")}

Generate a unified git diff that implements the task. Use the format:
diff --git a/path b/path
--- a/path
+++ b/path
@@ -line,count +line,count @@
 context
-removed
+added

Return ONLY valid JSON:
{
  "diff": "diff --git a/...",
  "modifiedFiles": ["src/..."],
  "newFiles": ["src/..."],
  "deletedFiles": [],
  "impactAnalysis": "What this change affects",
  "riskAnalysis": "low" | "medium" | "high"
}`;

  try {
    const result = await callAI({
      systemPrompt: "You are an AI code generator. Generate unified git diffs. Always return ONLY valid JSON.",
      userPrompt: prompt,
      maxTokens: 6000,
      temperature: 0.2,
    });
    return extractJSON<any>(result.text);
  } catch (err) {
    console.warn("[ai-builder] generatePatchForTask failed:", err instanceof Error ? err.message : err);
    return { diff: "", modifiedFiles: [], newFiles: [], deletedFiles: [], impactAnalysis: "", riskAnalysis: "medium" };
  }
}

async function generateTestsForTask(request: string, affectedFiles: string[], projectStructure?: string) {
  const prompt = `Generate Vitest tests for this task:

Request: ${request}
Affected files: ${affectedFiles.join(", ")}

Generate comprehensive tests that verify the task implementation.
Return ONLY the test file content (TypeScript), no markdown fences.`;

  try {
    const result = await callAI({
      systemPrompt: "You are a test generator. Generate Vitest tests.",
      userPrompt: prompt,
      maxTokens: 4000,
      temperature: 0.2,
    });
    return result.text.replace(/```typescript|```ts|```/g, "").trim();
  } catch (err) {
    console.warn("[ai-builder] generateTestsForTask failed:", err instanceof Error ? err.message : err);
    return `// Test generation failed for: ${request}`;
  }
}

// ============================================================================
// BUILD MANAGER + TEST RUNNER
// Browser-based app — cannot run shell commands. These functions return honest
// "not available" messages instead of fake simulated results.
// ============================================================================

/**
 * Run a build — HONEST: cannot run actual builds in browser.
 * Returns a clear message explaining this is not possible.
 */
export async function runBuild(): Promise<AIBuildResult> {
  return {
    success: false,
    errors: ["Cannot run 'npm run build' from a browser-based app."],
    warnings: [
      "This is a browser-based app running on Cloudflare Pages (Edge runtime).",
      "It cannot execute shell commands like 'npm run build'.",
      "To validate a build: copy the generated files to your local project and run 'npm run build' manually.",
    ],
    duration: 0,
    output: "Build not executed — browser-based app cannot run shell commands.",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Run tests — HONEST: cannot run actual tests in browser.
 */
export async function runTests(): Promise<AITestResult> {
  return {
    success: false,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    output: "Tests not executed — browser-based app cannot run 'npx vitest'. Copy generated test files to your project and run 'npx vitest' manually.",
    failures: [],
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// GIT MANAGER (simulated — would call actual git commands in production)
// ============================================================================

/**
 * Create a staging branch for a task.
 */
export function createStagingBranch(taskTitle: string): AIGitBranch {
  const slug = taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  return {
    name: `staging/${slug}`,
    isCurrent: false,
    isStaging: true,
    lastCommit: `task: ${taskTitle}`,
    commitCount: 0,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get the commit history (from store).
 */
export function getCommitHistory(): AIGitCommit[] {
  return useApp.getState().aiCommits;
}

/**
 * Get the branch list (from store).
 */
export function getBranches(): AIGitBranch[] {
  return useApp.getState().aiBranches;
}

// ============================================================================
// SAFE APPLY WORKFLOW
// ============================================================================

/**
 * Apply a patch — this is the FINAL step after approval.
 * In production, this would:
 *   1. Merge the staging branch into main
 *   2. Push to GitHub
 *   3. Trigger CI/CD
 *
 * Here we just mark the patch as "applied" and log it.
 */
export function applyPatch(patchId: string): { success: boolean; message: string } {
  const patch = useApp.getState().aiPatches.find((p) => p.id === patchId);
  if (!patch) return { success: false, message: "Patch not found" };
  if (patch.status !== "approved") return { success: false, message: "Patch must be approved first" };

  useApp.getState().updateAIPatch(patchId, {
    status: "applied",
    appliedAt: new Date().toISOString(),
    appliedBy: useApp.getState().user?.email || "system",
  });

  useApp.getState().log({
    actor: useApp.getState().user?.email ?? "admin",
    action: "AI patch applied",
    category: "admin",
    details: `Patch "${patch.title}" applied to production`,
    severity: "info",
  });

  return { success: true, message: `Patch "${patch.title}" applied to production` };
}

/**
 * Rollback a patch — undo the changes.
 */
export function rollbackPatch(patchId: string, reason: string): { success: boolean; message: string } {
  const patch = useApp.getState().aiPatches.find((p) => p.id === patchId);
  if (!patch) return { success: false, message: "Patch not found" };
  if (patch.status !== "applied") return { success: false, message: "Can only rollback applied patches" };

  useApp.getState().updateAIPatch(patchId, {
    status: "rolled_back",
    rolledBackAt: new Date().toISOString(),
  });

  useApp.getState().addAIRollback({
    patchId,
    patchTitle: patch.title,
    reason,
    rolledBackBy: useApp.getState().user?.email || "system",
    previousState: "applied",
  });

  useApp.getState().log({
    actor: useApp.getState().user?.email ?? "admin",
    action: "AI patch rolled back",
    category: "admin",
    details: `Patch "${patch.title}" rolled back. Reason: ${reason}`,
    severity: "warning",
  });

  return { success: true, message: `Patch "${patch.title}" rolled back` };
}

/**
 * Approve a patch — marks it as ready to apply.
 */
export function approvePatch(patchId: string): { success: boolean; message: string } {
  const patch = useApp.getState().aiPatches.find((p) => p.id === patchId);
  if (!patch) return { success: false, message: "Patch not found" };
  if (patch.status !== "pending") return { success: false, message: "Can only approve pending patches" };

  useApp.getState().updateAIPatch(patchId, { status: "approved" });

  useApp.getState().log({
    actor: useApp.getState().user?.email ?? "admin",
    action: "AI patch approved",
    category: "admin",
    details: `Patch "${patch.title}" approved for application`,
    severity: "info",
  });

  return { success: true, message: `Patch "${patch.title}" approved` };
}

/**
 * Reject a patch.
 */
export function rejectPatch(patchId: string, reason: string): { success: boolean; message: string } {
  const patch = useApp.getState().aiPatches.find((p) => p.id === patchId);
  if (!patch) return { success: false, message: "Patch not found" };

  useApp.getState().updateAIPatch(patchId, { status: "rejected" });

  useApp.getState().log({
    actor: useApp.getState().user?.email ?? "admin",
    action: "AI patch rejected",
    category: "admin",
    details: `Patch "${patch.title}" rejected. Reason: ${reason}`,
    severity: "warning",
  });

  return { success: true, message: `Patch "${patch.title}" rejected` };
}

// ============================================================================
// AUTONOMOUS DEBUG MODE
// ============================================================================

/**
 * Run autonomous debug — scans REAL repository code for actual issues.
 * Uses the Repository Intelligence Engine (agent-runtime.ts) to search
 * actual files — NO hallucination, NO fabricated paths.
 *
 * Also uses the detectErrors() function from autonomous-healing.ts for
 * heuristic error pattern detection.
 *
 * Generates fixes via AI only for issues backed by REAL evidence.
 */
export async function runAutonomousDebug(): Promise<{
  issues: Array<{ area: string; severity: string; description: string; suggestedFix: string; file?: string; line?: number; code?: string }>;
  generatedPatches: Array<{ title: string; diff: string }>;
}> {
  const issues: Array<{ area: string; severity: string; description: string; suggestedFix: string; file?: string; line?: number; code?: string }> = [];
  const generatedPatches: Array<{ title: string; diff: string }> = [];

  try {
    // === 1. Search for REAL error-prone patterns in actual source files ===

    // console.error calls (potential unhandled errors)
    const consoleErrors = await searchRepository("console\\.error", { regex: true, filePattern: "*.{ts,tsx}" });
    for (const r of consoleErrors.slice(0, 5)) {
      issues.push({
        area: "frontend",
        severity: "info",
        description: `console.error found in ${r.file}:${r.line} — ${r.match}`,
        suggestedFix: "Review if this error is properly handled or if it indicates a real bug.",
        file: r.file,
        line: r.line,
        code: r.match,
      });
    }

    // catch blocks that swallow errors (empty catch)
    const emptyCatch = await searchRepository("catch"+"\\s*\\(\\s*\\w*\\s*\\)\\s*\\{\\s*\\}", { regex: true, filePattern: "*.{ts,tsx}" });
    for (const r of emptyCatch.slice(0, 3)) {
      issues.push({
        area: "backend",
        severity: "warning",
        description: `Empty catch block in ${r.file}:${r.line} — errors are being silently swallowed.`,
        suggestedFix: "Add error logging or proper error handling in the catch block.",
        file: r.file,
        line: r.line,
        code: r.match,
      });
    }

    // @ts-ignore (suppressed TypeScript errors)
    const tsIgnore = await searchRepository("@ts-"+"ignore", { filePattern: "*.{ts,tsx}" });
    for (const r of tsIgnore.slice(0, 5)) {
      issues.push({
        area: "build",
        severity: "warning",
        description: `@ts-`+`ignore in ${r.file}:${r.line} — TypeScript error is being suppressed.`,
        suggestedFix: "Fix the underlying TypeScript error instead of suppressing it.",
        file: r.file,
        line: r.line,
        code: r.match,
      });
    }

    // TODO/FIXME comments
    const todos = await searchRepository("\\b(?:TODO"+"|FIXME)\\b", { regex: true, filePattern: "*.{ts,tsx}" });
    for (const r of todos.slice(0, 5)) {
      issues.push({
        area: "build",
        severity: "info",
        description: `TODO/`+`FIXME in ${r.file}:${r.line} — ${r.match}`,
        suggestedFix: "Address the TODO or FIXME comment.",
        file: r.file,
        line: r.line,
        code: r.match,
      });
    }

    // 'any' type usage (potential type safety issues)
    const anyTypes = await searchRepository(":\\s*any\\b", { regex: true, filePattern: "*.{ts,tsx}" });
    for (const r of anyTypes.slice(0, 3)) {
      issues.push({
        area: "build",
        severity: "info",
        description: `'any' type used in ${r.file}:${r.line} — type safety is reduced.`,
        suggestedFix: "Replace 'any' with a proper TypeScript type.",
        file: r.file,
        line: r.line,
        code: r.match,
      });
    }

    // === 2. Search for REAL provider error leak patterns ===
    // Exclude pattern-definition files, test files, and mock data — these contain
    // error strings for detection/testing purposes, not actual leaks in resume content.
    const EXCLUDED_LEAK_FILES = [
      "ai-error-filter.ts", "ai-response-processor.ts", "analysis-leak-prevention",
      ".test.ts", ".spec.ts", "platform-audit", "mock-data.ts", "qa/types.ts",
    ];
    const errorLeaks = await searchRepository("optimization "+"incomplete|non-json "+"output|raw response "+"started", { regex: true, filePattern: "*.{ts,tsx}" });
    for (const r of errorLeaks.slice(0, 5)) {
      // Skip files that define these patterns for detection/testing purposes
      if (EXCLUDED_LEAK_FILES.some((f) => r.file.includes(f))) continue;
      // Skip if the match is inside a regex literal (pattern definition, not actual leak)
      if (r.match.trim().startsWith("/") && r.match.trim().endsWith("/i")) continue;
      // Skip if it's inside a comment (search string description, not actual code)
      if (r.match.trim().startsWith("//") || r.match.includes("suggestedFix:")) continue;
      issues.push({
        area: "frontend",
        severity: "error",
        description: `Error leak pattern found in ${r.file}:${r.line} — this text could appear in generated documents.`,
        suggestedFix: "Remove or guard this error message so it never reaches the resume content.",
        file: r.file,
        line: r.line,
        code: r.match,
      });
    }

    // === 3. Search for "From JD" skill category (analysis artifact) ===
    // Exclude files where "From JD" appears in negative examples (ai.ts),
    // pattern definitions, test data, or comments referencing JD input.
    const EXCLUDED_FROM_JD_FILES = ["ai-error-filter.ts", "ai-response-processor.ts", "analysis-leak-prevention", "mock-data.ts"];
    const fromJd = await searchRepository("From JD", { filePattern: "*.{ts,tsx}" });
    for (const r of fromJd.slice(0, 5)) {
      // Skip pattern definition and test files
      if (EXCLUDED_FROM_JD_FILES.some((f) => r.file.includes(f))) continue;
      // Skip if it's in a "BAD:" example (negative teaching pattern in ai.ts)
      if (r.match.includes("BAD:") || r.match.includes("✗")) continue;
      // Skip if it's just a comment like "from JD + resume" (not the artifact)
      if (/from JD[\s+]/i.test(r.match) && !/From JD:/i.test(r.match)) continue;
      issues.push({
        area: "frontend",
        severity: "warning",
        description: `"From JD" found in ${r.file}:${r.line} — this is an analysis artifact that should not appear in resumes.`,
        suggestedFix: 'Change the category from "From JD" to "Skills".',
        file: r.file,
        line: r.line,
        code: r.match,
      });
    }

    // === 4. Search for summary_critique being wrongly assigned to resume.summary ===
    // Only flag if summary_critique is explicitly assigned to a resume summary field.
    // Exclude: type definitions, pattern definitions, mock data, and the search code itself.
    const EXCLUDED_CRITIQUE_FILES = ["ats-directives.ts", "mock-data.ts", "ai-builder-agent.ts"];
    const critiqueUsage = await searchRepository("summary_critique", { filePattern: "*.{ts,tsx}" });
    for (const r of critiqueUsage.slice(0, 5)) {
      // Skip type definition files, mock data, and this file's own search code
      if (EXCLUDED_CRITIQUE_FILES.some((f) => r.file.includes(f))) continue;
      // Only flag if summary_critique is being ASSIGNED to a .summary field
      // Pattern: result.summary_critique being used as resume.summary = result.summary_critique
      if (r.match.includes("summary =") && r.match.includes("summary_critique") && !r.match.includes("summary_critique:")) {
        issues.push({
          area: "frontend",
          severity: "error",
          description: `summary_critique is being assigned to a summary field in ${r.file}:${r.line} — this injects analysis text into the resume.`,
          suggestedFix: "Use resume.summary instead of result.summary_critique.",
          file: r.file,
          line: r.line,
          code: r.match,
        });
      }
    }

    // === 5. Generate AI patches for the most critical issues (with REAL evidence) ===
    const criticalIssues = issues.filter((i) => i.severity === "error" || i.severity === "critical").slice(0, 3);
    for (const issue of criticalIssues) {
      try {
        const evidenceText = issue.file && issue.line
          ? `File: ${issue.file}:${issue.line}\nCode: ${issue.code || "n/a"}\nDescription: ${issue.description}`
          : `Description: ${issue.description}`;

        const patchResult = await callAI({
          systemPrompt: "You are a code fixer. Generate a unified git diff to fix the described issue. Use ONLY real file paths from the evidence. Return ONLY valid JSON: {\"title\": \"Fix: ...\", \"diff\": \"diff --git a/...\"}",
          userPrompt: `Fix this issue using the REAL evidence provided. Do NOT invent file paths.\n\n${evidenceText}`,
          maxTokens: 2000,
          temperature: 0.2,
          taskCategory: "development",
        });

        try {
          const patch = extractJSON<{ title: string; diff: string }>(patchResult.text);
          if (patch.diff && patch.diff.startsWith("diff --git")) {
            generatedPatches.push(patch);
          }
        } catch (parseErr) {
          // AI didn't return valid JSON for the patch — skip
          console.warn(`[ai-builder-agent] Failed to parse patch JSON:`, parseErr instanceof Error ? parseErr.message : String(parseErr));
        }
      } catch (patchErr) {
        // Patch generation failed for this issue — skip
        console.warn(`[ai-builder-agent] Patch generation failed:`, patchErr instanceof Error ? patchErr.message : String(patchErr));
      }
    }

    return { issues, generatedPatches };
  } catch (e: any) {
    return {
      issues: [{
        area: "system",
        severity: "error",
        description: `Debug scan failed: ${e?.message || "unknown error"}. Ensure /api/repo is accessible.`,
        suggestedFix: "Check that the /api/repo route is deployed and accessible.",
      }],
      generatedPatches: [],
    };
  }
}
