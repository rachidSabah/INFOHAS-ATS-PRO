/**
 * ResumeAI Pro — Playwright E2E: Supervisor Phantom Agent Fix
 *
 * Validates that restoreFromSnapshot() filters out stale/phantom agents
 * (e.g. "Parser Validation", "Render Validation") from localStorage
 * that don't exist in the canonical AGENT_DEFINITIONS.
 *
 * Bug reproduction:
 *   - Snapshot saved with phantom agents from corrupted localStorage
 *   - On page load, restoreFromSnapshot() would rebuild state.agents from
 *     the snapshot including phantoms
 *   - finalizeSupervisorStatus() saw phantoms as still-pending → supervisor
 *     hung forever on "Waiting for 2 agent(s): Parser Validation, Render Validation"
 *
 * Fix:
 *   1. restoreFromSnapshot() now iterates AGENT_DEFINITIONS instead of
 *      Object.entries(restoredState.agents) — phantom agents never restored.
 *   2. saveSnapshot(state) is called after restore so the cleaned state is
 *      persisted to localStorage permanently (one-page-load cleanup).
 */

import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

test.describe("Supervisor Phantom Agent Filtering", () => {
  test("corrupted snapshot with phantoms → cleaned after page load", async ({
    page,
  }) => {
    // Inject mock session + corrupted snapshot BEFORE page scripts run.
    // addInitScript runs in the browser before any page JS executes, so
    // the supervisor module sees the corrupted data on first load.
    await page.addInitScript(() => {
      // Mock session (same format as optimizer.spec.ts)
      localStorage.setItem(
        "resumeai-session",
        JSON.stringify({
          user: {
            id: "test-user",
            name: "Test User",
            email: "test@example.com",
            role: "admin",
            status: "approved",
          },
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        })
      );

      // Corrupted snapshot with phantom agents
      const SNAPSHOT_KEY = "resumeai-pipeline-snapshot";
      const corrupted = {
        pipelineId: "test-phantom-" + Date.now(),
        userId: "test-user",
        resumeId: null,
        jobId: null,
        timestamp: new Date().toISOString(),
        state: {
          context: {
            resumeId: null,
            jobId: null,
            userId: "test-user",
            optimizationId: null,
            optimizedResume: null,
            pipelineResult: null,
          },
          agents: {
            supervisor: { id: "supervisor", name: "Supervisor", icon: "Cpu", status: "completed" },
            planner: { id: "planner", name: "Planner", icon: "ClipboardList", status: "completed" },
            memory: { id: "memory", name: "Memory", icon: "Database", status: "completed" },
            research: { id: "research", name: "Research", icon: "Search", status: "completed" },
            "resume-parser": { id: "resume-parser", name: "Resume Parser", icon: "FileText", status: "completed" },
            "resume-repair": { id: "resume-repair", name: "Resume Repair", icon: "Wrench", status: "skipped" },
            "content-expansion": { id: "content-expansion", name: "Content Expansion", icon: "Expand", status: "completed" },
            "job-intelligence": { id: "job-intelligence", name: "Job Intelligence", icon: "Briefcase", status: "completed" },
            "company-intelligence": { id: "company-intelligence", name: "Company Intelligence", icon: "Building2", status: "completed" },
            "skill-gap": { id: "skill-gap", name: "Skill Gap", icon: "GitCompare", status: "completed" },
            "ats-analysis": { id: "ats-analysis", name: "ATS Analysis", icon: "ScanText", status: "completed" },
            optimizer: { id: "optimizer", name: "Optimizer", icon: "Wand2", status: "completed", log: "12 patches applied", durationMs: 3550 },
            qa: { id: "qa", name: "Quality Assurance", icon: "ShieldCheck", status: "completed" },
            reflection: { id: "reflection", name: "Reflection", icon: "Brain", status: "completed" },
            "cover-letter": { id: "cover-letter", name: "Cover Letter", icon: "Mail", status: "completed" },
            interview: { id: "interview", name: "Interview Prep", icon: "MessageSquare", status: "completed" },
            "career-coach": { id: "career-coach", name: "Career Coach", icon: "Compass", status: "completed" },
            "application-tracker": { id: "application-tracker", name: "Application Tracker", icon: "ListChecks", status: "skipped" },
            salary: { id: "salary", name: "Salary Insights", icon: "DollarSign", status: "completed" },
            "job-search": { id: "job-search", name: "Job Search", icon: "Globe", status: "completed" },
            // PHANTOM AGENTS — not in AGENT_DEFINITIONS
            "parser-validation": { id: "parser-validation", name: "Parser Validation", icon: "FileSearch", status: "pending" },
            "render-validation": { id: "render-validation", name: "Render Validation", icon: "Eye", status: "pending" },
          },
          events: [],
          isRunning: false,
        },
      };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(corrupted));
    });

    // Navigate to app — restoreFromSnapshot runs automatically in page.tsx useEffect
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 45000 });

    // Wait for auth to recognize the mock session (same as existing tests)
    await expect(page.locator("text=Welcome back").first()).toBeVisible({
      timeout: 15000,
    });

    // Give restoreFromSnapshot + setState auto-save time to complete
    await page.waitForTimeout(3000);

    // Read the snapshot from localStorage — phantoms should be gone
    const stateAfter = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem("resumeai-pipeline-snapshot");
        if (!raw) return { error: "No snapshot found after restore" };
        const snap = JSON.parse(raw);
        const agents = snap.state.agents || {};
        const agentIds = Object.keys(agents);
        return {
          agentIds,
          phantomIds: agentIds.filter(
            (id) => id === "parser-validation" || id === "render-validation"
          ),
          totalAgents: agentIds.length,
          hasOptimizer: !!agents["optimizer"],
          optimizerLog: agents["optimizer"]?.log,
          optimizerDuration: agents["optimizer"]?.durationMs,
          hasPlanner: !!agents["planner"],
          hasSupervisor: !!agents["supervisor"],
        };
      } catch (e) {
        return { error: `${e instanceof Error ? e.message : String(e)}` };
      }
    });

    // CRITICAL: Phantom agents must be gone from persisted snapshot
    expect(stateAfter.phantomIds).toEqual([]);
    expect(stateAfter.agentIds).not.toContain("parser-validation");
    expect(stateAfter.agentIds).not.toContain("render-validation");

    // Canonical agents and their runtime state must be preserved
    expect(stateAfter.hasOptimizer).toBe(true);
    expect(stateAfter.optimizerLog).toBe("12 patches applied");
    expect(stateAfter.optimizerDuration).toBe(3550);
    expect(stateAfter.hasPlanner).toBe(true);
    expect(stateAfter.hasSupervisor).toBe(true);

    // Must have exactly 20 agents (19 definitions + supervisor = 20)
    // If phantoms leaked it would be 22
    expect(stateAfter.totalAgents).toBe(20);
  });

  test("clean snapshot round-trips all 20 agents preserving state", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "resumeai-session",
        JSON.stringify({
          user: {
            id: "test-user",
            name: "Test User",
            email: "test@example.com",
            role: "admin",
            status: "approved",
          },
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        })
      );

      const SNAPSHOT_KEY = "resumeai-pipeline-snapshot";
      const clean = {
        pipelineId: "test-clean-" + Date.now(),
        userId: "test-user",
        resumeId: null,
        jobId: null,
        timestamp: new Date().toISOString(),
        state: {
          context: { resumeId: null, jobId: null, userId: "test-user", optimizationId: null, optimizedResume: null, pipelineResult: null },
          agents: {
            supervisor: { id: "supervisor", name: "Supervisor", icon: "Cpu", status: "completed", log: "Pipeline done" },
            planner: { id: "planner", name: "Planner", icon: "ClipboardList", status: "completed" },
            memory: { id: "memory", name: "Memory", icon: "Database", status: "completed" },
            research: { id: "research", name: "Research", icon: "Search", status: "completed" },
            "resume-parser": { id: "resume-parser", name: "Resume Parser", icon: "FileText", status: "completed", log: "Parsed OK" },
            "resume-repair": { id: "resume-repair", name: "Resume Repair", icon: "Wrench", status: "skipped" },
            "content-expansion": { id: "content-expansion", name: "Content Expansion", icon: "Expand", status: "completed" },
            "job-intelligence": { id: "job-intelligence", name: "Job Intelligence", icon: "Briefcase", status: "completed" },
            "company-intelligence": { id: "company-intelligence", name: "Company Intelligence", icon: "Building2", status: "completed" },
            "skill-gap": { id: "skill-gap", name: "Skill Gap", icon: "GitCompare", status: "completed" },
            "ats-analysis": { id: "ats-analysis", name: "ATS Analysis", icon: "ScanText", status: "completed" },
            optimizer: { id: "optimizer", name: "Optimizer", icon: "Wand2", status: "completed", log: "All good", durationMs: 2800 },
            qa: { id: "qa", name: "Quality Assurance", icon: "ShieldCheck", status: "completed" },
            reflection: { id: "reflection", name: "Reflection", icon: "Brain", status: "completed" },
            "cover-letter": { id: "cover-letter", name: "Cover Letter", icon: "Mail", status: "completed" },
            interview: { id: "interview", name: "Interview Prep", icon: "MessageSquare", status: "completed" },
            "career-coach": { id: "career-coach", name: "Career Coach", icon: "Compass", status: "completed" },
            "application-tracker": { id: "application-tracker", name: "Application Tracker", icon: "ListChecks", status: "skipped" },
            salary: { id: "salary", name: "Salary Insights", icon: "DollarSign", status: "completed" },
            "job-search": { id: "job-search", name: "Job Search", icon: "Globe", status: "completed" },
          },
          events: [],
          isRunning: false,
        },
      };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(clean));
    });

    await page.goto(BASE_URL, { waitUntil: "load", timeout: 45000 });
    await expect(page.locator("text=Welcome back").first()).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem("resumeai-pipeline-snapshot");
        if (!raw) return { error: "No snapshot found" };
        const snap = JSON.parse(raw);
        const agents = snap.state.agents || {};
        return {
          totalAgents: Object.keys(agents).length,
          hasSupervisor: !!agents["supervisor"],
          supervisorLog: agents["supervisor"]?.log,
          hasOptimizer: !!agents["optimizer"],
          optimizerLog: agents["optimizer"]?.log,
          optimizerDuration: agents["optimizer"]?.durationMs,
          hasCoverLetter: !!agents["cover-letter"],
          resumeParserLog: agents["resume-parser"]?.log,
        };
      } catch (e) {
        return { error: `${e instanceof Error ? e.message : String(e)}` };
      }
    });

    expect(result.totalAgents).toBe(20);
    expect(result.hasSupervisor).toBe(true);
    expect(result.hasOptimizer).toBe(true);
    expect(result.hasCoverLetter).toBe(true);

    // Runtime state must survive the restore round-trip
    expect(result.optimizerLog).toBe("All good");
    expect(result.optimizerDuration).toBe(2800);
    expect(result.supervisorLog).toBe("Pipeline done");
    expect(result.resumeParserLog).toBe("Parsed OK");
  });
});
