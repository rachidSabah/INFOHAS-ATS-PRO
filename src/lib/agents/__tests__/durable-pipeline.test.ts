// ============================================================================
// Durable Pipeline Runner — unit tests (Option 1).
// Exercises the runner against an IN-MEMORY mock of the /api/pipeline/jobs
// endpoints (same contract as workers/api/index.ts) with the heavy pipeline
// modules mocked out. Verifies: enqueue idempotency, claim→execute→complete
// checkpointing, fail→backoff→retry with Retry-After, dead-on-exhaustion,
// and every fallback path (no task id, durable unavailable, optimizer
// unavailable → inline-with-checkpoint).
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../orchestrator", () => ({ runOptimizationPipeline: vi.fn() }));
vi.mock("../../job-intelligence", () => ({ analyzeJobIntelligence: vi.fn() }));
vi.mock("../company-skill-agents", () => ({
  analyzeCompanyIntelligence: vi.fn(),
  analyzeSkillGap: vi.fn(),
}));
vi.mock("../supervisor", () => ({ getActiveD1TaskId: vi.fn() }));

import { runDurableCorePipeline } from "../durable-pipeline";
import { runOptimizationPipeline } from "../orchestrator";
import { analyzeJobIntelligence } from "../../job-intelligence";
import { analyzeCompanyIntelligence, analyzeSkillGap } from "../company-skill-agents";
import { getActiveD1TaskId } from "../supervisor";

// --- in-memory mock of the pipeline-jobs API -------------------------------

const db = new Map<string, any>();
let fetchCalls: Array<{ url: string; body: any }> = [];

function jsonRes(data: any) {
  return { ok: true, status: 200, json: async () => data } as any;
}

function installFetchMock() {
  (global as any).fetch = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    fetchCalls.push({ url: u, body });

    if (u.endsWith("/api/pipeline/jobs") && init?.method === "POST") {
      for (const j of body.jobs ?? []) {
        const exists = [...db.values()].find((r) => r.task_id === body.taskId && r.stage === j.stage);
        if (!exists) {
          const id = `pjob_${db.size + 1}`;
          db.set(id, {
            id, task_id: body.taskId, stage: j.stage, status: "queued",
            attempts: 0, max_attempts: j.maxAttempts ?? 5,
            next_run_at: null, lease_expires_at: null, last_error: null, result_json: null,
            created_at: new Date(db.size).toISOString(),
          });
        }
      }
      return jsonRes({ ok: true, jobs: [...db.values()].filter((r) => r.task_id === body.taskId) });
    }

    if (u.endsWith("/api/pipeline/jobs/claim")) {
      const job = [...db.values()]
        .filter((r) => r.task_id === body.taskId && (!body.stage || r.stage === body.stage) && r.status === "queued")
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (!job) return jsonRes({ ok: true, jobs: [] });
      job.status = "running";
      job.attempts += 1;
      job.lease_expires_at = new Date(Date.now() + 600_000).toISOString();
      return jsonRes({ ok: true, jobs: [job] });
    }

    const completeMatch = u.match(/\/api\/pipeline\/jobs\/([^/]+)\/complete$/);
    if (completeMatch) {
      const job = db.get(completeMatch[1]);
      if (!job) return { ok: false, status: 404, json: async () => ({ ok: false }) };
      job.status = "done";
      job.result_json = JSON.stringify(body.result ?? null);
      return jsonRes({ ok: true, job });
    }

    const failMatch = u.match(/\/api\/pipeline\/jobs\/([^/]+)\/fail$/);
    if (failMatch) {
      const job = db.get(failMatch[1]);
      if (!job) return { ok: false, status: 404, json: async () => ({ ok: false }) };
      job.last_error = body.error;
      job.lease_expires_at = null;
      if (job.attempts >= job.max_attempts) {
        job.status = "dead";
        job.next_run_at = null;
        return jsonRes({ ok: true, status: "dead", next_run_at: null, attempts: job.attempts, max_attempts: job.max_attempts });
      }
      job.status = "queued";
      // Backoff honored but kept tiny (tests must not really sleep long).
      job.next_run_at = new Date(Date.now() + Math.min(body.retryAfterMs ?? 60_000, 1_000)).toISOString();
      return jsonRes({ ok: true, status: "queued", next_run_at: job.next_run_at, attempts: job.attempts, max_attempts: job.max_attempts });
    }

    return { ok: false, status: 404, json: async () => ({ ok: false }) };
  });
}

// --- helpers ---------------------------------------------------------------

const baseInput = () => ({
  resume: { id: "r1", name: "Test" } as any,
  jd: { id: "jd1", title: "Engineer", company: "ACME", description: "d".repeat(200) } as any,
  enableReflection: true,
  deepAgenticMode: false,
});

const RESULT = { status: "completed", provider: "prov", charCount: 900 } as any;

beforeEach(() => {
  db.clear();
  fetchCalls = [];
  installFetchMock();
  vi.clearAllMocks(); // clear call history accumulated by earlier tests
  vi.mocked(getActiveD1TaskId).mockReturnValue("task_1");
  vi.mocked(analyzeJobIntelligence).mockResolvedValue({ priorityKeywords: ["k"] } as any);
  vi.mocked(analyzeCompanyIntelligence).mockResolvedValue({ companyName: "ACME" } as any);
  vi.mocked(analyzeSkillGap).mockResolvedValue({ overallMatch: 80 } as any);
  vi.mocked(runOptimizationPipeline).mockResolvedValue(RESULT);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (global as any).fetch;
});

// --- tests -----------------------------------------------------------------

describe("runDurableCorePipeline", () => {
  it("returns null without touching the network when no D1 task id exists", async () => {
    vi.mocked(getActiveD1TaskId).mockReturnValue(null);
    const out = await runDurableCorePipeline(baseInput());
    expect(out).toBeNull();
    expect(fetchCalls).toHaveLength(0);
    expect(runOptimizationPipeline).not.toHaveBeenCalled();
  });

  it("happy path: enqueues 4 stages, executes them, checkpoints artifacts, returns the result", async () => {
    const out = await runDurableCorePipeline(baseInput());
    expect(out).toEqual(RESULT);

    const enqueue = fetchCalls.find((c) => c.url.endsWith("/api/pipeline/jobs"));
    expect(enqueue?.body.jobs.map((j: any) => j.stage)).toEqual([
      "job_intelligence", "company_intelligence", "skill_gap", "optimizer",
    ]);

    // The orchestrator receives a fresh checkpoint carrying the durable artifacts.
    const call = vi.mocked(runOptimizationPipeline).mock.calls[0][0] as any;
    expect(call.checkpoint.jobIntelligence).toEqual({ priorityKeywords: ["k"] });
    expect(call.checkpoint.companyIntelligence).toEqual({ companyName: "ACME" });
    expect(call.checkpoint.skillGap).toEqual({ overallMatch: 80 });
    expect(call.checkpoint.jdFingerprint).toContain("engineer|acme|");

    // Optimizer job checkpointed a compact summary (not the full resume).
    const optJob = [...db.values()].find((j) => j.stage === "optimizer");
    expect(optJob.status).toBe("done");
    expect(JSON.parse(optJob.result_json)).toEqual(
      expect.objectContaining({ status: "completed", provider: "prov", charCount: 900 })
    );
  });

  it("skips an intelligence artifact that exhausted its attempts (run continues)", async () => {
    vi.mocked(analyzeCompanyIntelligence).mockRejectedValue({ statusCode: 429, message: "rate limit" });
    const out = await runDurableCorePipeline(baseInput());
    expect(out).toEqual(RESULT);
    const call = vi.mocked(runOptimizationPipeline).mock.calls[0][0] as any;
    expect(call.checkpoint.jobIntelligence).toBeDefined();
    expect(call.checkpoint.companyIntelligence).toBeUndefined(); // absent → orchestrator re-runs it once
    const ciJob = [...db.values()].find((j) => j.stage === "company_intelligence");
    expect(ciJob.status).toBe("dead");
    expect(ciJob.attempts).toBe(ciJob.max_attempts);
  });

  it("retries a failed stage and honors the Retry-After hint", async () => {
    vi.mocked(analyzeJobIntelligence)
      .mockRejectedValueOnce({ statusCode: 429, retryAfterSeconds: 3, message: "Too many requests" })
      .mockResolvedValue({ priorityKeywords: ["k"] } as any);
    const out = await runDurableCorePipeline(baseInput());
    expect(out).toEqual(RESULT);
    const jiJob = [...db.values()].find((j) => j.stage === "job_intelligence");
    expect(jiJob.status).toBe("done");
    expect(jiJob.attempts).toBe(2);
    const failCall = fetchCalls.find((c) => c.url.endsWith("/job_intelligence/fail") || (c.url.includes("/fail") && db.get(c.url.split("/jobs/")[1]?.split("/")[0])?.stage === "job_intelligence"));
    expect(failCall).toBeDefined();
    expect(failCall!.body.retryAfterMs).toBe(3000);
  });

  it("returns null (legacy fallback) when the durable layer is unreachable", async () => {
    (global as any).fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }));
    const started = Date.now();
    const out = await runDurableCorePipeline(baseInput());
    expect(out).toBeNull();
    expect(runOptimizationPipeline).not.toHaveBeenCalled();
    // fail-fast: ~3 null claims × 2s, well under the stage budget
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  it("falls back to INLINE execution with the checkpoint when the optimizer job goes unavailable mid-run", async () => {
    // JI + CI succeed; the SG stage breaks the network mid-execution (D1
    // outage) — SG completes best-effort, then the optimizer's claims fail
    // 3× → unavailable → the runner finishes INLINE with the checkpoint.
    vi.mocked(analyzeSkillGap).mockImplementation(async () => {
      (global as any).fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }));
      return { overallMatch: 80 } as any;
    });
    const out = await runDurableCorePipeline(baseInput());
    expect(out).toEqual(RESULT);
    const call = vi.mocked(runOptimizationPipeline).mock.calls[0][0] as any;
    expect(call.checkpoint.jobIntelligence).toEqual({ priorityKeywords: ["k"] });
    expect(call.checkpoint.companyIntelligence).toEqual({ companyName: "ACME" });
  }, 60_000);

  it("throws honestly when the optimizer exhausts every attempt", async () => {
    vi.mocked(runOptimizationPipeline).mockRejectedValue(new Error("all providers exhausted"));
    await expect(runDurableCorePipeline(baseInput())).rejects.toThrow(/exhausted|providers/i);
    const optJob = [...db.values()].find((j) => j.stage === "optimizer");
    expect(optJob.status).toBe("dead");
  });

  it("passes the UI-provided checkpoint through for artifacts the durable run lacks", async () => {
    vi.mocked(analyzeSkillGap).mockRejectedValue({ statusCode: 429, message: "rate limit" });
    const out = await runDurableCorePipeline({
      ...baseInput(),
      checkpoint: {
        savedAt: new Date().toISOString(),
        jdFingerprint: "engineer|acme|200:ddd",
        skillGap: { overallMatch: 55 } as any,
      },
    });
    expect(out).toEqual(RESULT);
    const call = vi.mocked(runOptimizationPipeline).mock.calls[0][0] as any;
    // durable artifacts win when present; the prior checkpoint fills the gap
    expect(call.checkpoint.jobIntelligence).toBeDefined();
    expect(call.checkpoint.skillGap).toEqual({ overallMatch: 55 });
  });
});
