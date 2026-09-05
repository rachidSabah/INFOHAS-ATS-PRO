// ============================================================================
// Durable Pipeline Runner — Option 1 (Durable Queue Runner).
//
// Drives the optimization pipeline's AI-costly stages as DURABLE D1 jobs
// (pipeline_jobs table, migration 0019) instead of one-shot in-memory
// execution:
//
//   enqueue (idempotent per task+stage)
//     → claim job (atomic, leased)
//       → execute the SAME stage functions the legacy pipeline uses
//         (rate-governed at the provider-call layer)
//       → complete: checkpoint the artifact into D1 (survives reloads)
//       → fail: re-queue with bounded backoff (Retry-After aware) or die
//
// Guarantees:
//   - The pipeline's shape, stage functions, directives and semantics are
//     UNCHANGED — the runner only changes WHEN and HOW OFTEN stages execute
//     (paced, resumable, retryable) — never WHAT they produce.
//   - A run that hits provider limits now WAITS (job backoff) instead of
//     degrading; completed intelligence artifacts are never re-billed.
//   - Any durable-layer failure (D1 unreachable, flag off, no task id)
//     resolves to null → the supervisor falls back to the legacy inline
//     path. Zero regression by construction.
//
// The supervisor calls runDurableCorePipeline() at the exact call site where
// it previously called runOptimizationPipeline() directly, and keeps ALL of
// its post-processing (status sync, cache guards, zero-data-loss validation,
// context update, post-agents, finalize) on the shared path.
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import type { PipelineResult } from "./orchestrator";
import { runOptimizationPipeline } from "./orchestrator";
import { analyzeJobIntelligence } from "../job-intelligence";
import { analyzeCompanyIntelligence, analyzeSkillGap } from "./company-skill-agents";
import { jdFingerprint, type PipelineCheckpoint } from "./pipeline-checkpoint";
import { retryAfterMsFromError } from "../ai/rate-governor";
import { getActiveD1TaskId } from "./supervisor";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Stages executed as durable jobs, in dependency order. */
export const DURABLE_STAGES = [
  "job_intelligence",
  "company_intelligence",
  "skill_gap",
  "optimizer",
] as const;

export type DurableStage = (typeof DURABLE_STAGES)[number];

/** Max attempts per stage job (bounded budget — mirrors the worker default). */
const STAGE_MAX_ATTEMPTS = 5;
/**
 * Cap on how long the runner will inline-wait for a job's backoff window.
 * The D1 next_run_at may be up to 30 min; the browser run waits at most this
 * long per retry cycle, then attempts anyway (the provider layers handle a
 * still-limited provider; attempts increment toward the honest dead state).
 */
const INLINE_WAIT_CAP_MS = 180_000;
/** Poll interval while waiting for a backoff window to elapse (ms). */
const WAIT_TICK_MS = 5_000;
/** Overall stage time budget — the stage gives up HONESTLY after this. */
const STAGE_TOTAL_BUDGET_MS = 15 * 60 * 1000;

/** API base — same resolution as the supervisor's task API. */
const TASK_API_BASE_URL =
  typeof window !== "undefined" &&
  typeof window.location !== "undefined" &&
  typeof window.location.hostname === "string" &&
  window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://resumeai-pro-api.rachidelsabah.workers.dev";

export interface DurableStageEvent {
  stage: DurableStage;
  state: "claimed" | "completed" | "retrying" | "exhausted";
  attempt: number;
  message?: string;
}

export interface DurableRunnerInput {
  resume: ResumeData;
  jd: JobDescription;
  /** Resolved plan values from the supervisor (already computed). */
  userDirectives?: string;
  aviationMode?: any;
  enableReflection: boolean;
  deepAgenticMode: boolean;
  /** Checkpoint the UI passed in (previous recoverable run, same session). */
  checkpoint?: PipelineCheckpoint;
  profile?: unknown;
  onProgress?: (progress: any) => void;
  /** Supervisor-side UI hook (agent states, timeline). */
  onStageEvent?: (event: DurableStageEvent) => void;
}

// ---------------------------------------------------------------------------
// D1 job API — thin fetch wrappers (never throw: durable is best-effort)
// ---------------------------------------------------------------------------

async function jobsFetch(path: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(`${TASK_API_BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const data: any = await res.json().catch(() => null);
    return data;
  } catch {
    return null; // network down — caller decides the fallback
  }
}

async function enqueueStageJobs(taskId: string, stages: readonly DurableStage[]): Promise<boolean> {
  const res = await jobsFetch("/api/pipeline/jobs", {
    method: "POST",
    body: JSON.stringify({ taskId, jobs: stages.map((stage) => ({ stage, maxAttempts: STAGE_MAX_ATTEMPTS })) }),
  });
  return !!res?.ok;
}

async function claimStageJob(taskId: string, stage: DurableStage): Promise<any | null> {
  const res = await jobsFetch("/api/pipeline/jobs/claim", {
    method: "POST",
    body: JSON.stringify({ taskId, stage, count: 1 }),
  });
  return res?.ok && Array.isArray(res.jobs) && res.jobs.length > 0 ? res.jobs[0] : null;
}

async function completeStageJob(jobId: string, result: unknown): Promise<void> {
  await jobsFetch(`/api/pipeline/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    body: JSON.stringify({ result }),
  });
}

/** Returns the server's {status, next_run_at} or null when unreachable. */
async function failStageJob(jobId: string, error: string, retryAfterMs?: number | null): Promise<{ status: string; next_run_at: string | null } | null> {
  const res = await jobsFetch(`/api/pipeline/jobs/${encodeURIComponent(jobId)}/fail`, {
    method: "POST",
    body: JSON.stringify({ error, retryAfterMs: retryAfterMs ?? undefined }),
  });
  return res?.ok ? { status: res.status, next_run_at: res.next_run_at } : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** Wait for a backoff window, capped so the UI never freezes indefinitely. */
async function waitBackoff(nextRunAt: string | null | undefined): Promise<void> {
  let waitMs = INLINE_WAIT_CAP_MS;
  if (nextRunAt) {
    const at = Date.parse(nextRunAt);
    if (Number.isFinite(at)) waitMs = Math.min(waitMs, Math.max(0, at - Date.now()));
  }
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await sleep(Math.min(WAIT_TICK_MS, until - Date.now()));
  }
}

// ---------------------------------------------------------------------------
// Stage executors — the SAME functions the legacy orchestrator calls
// ---------------------------------------------------------------------------

type StageOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "exhausted"; lastError?: string }
  | { ok: false; kind: "unavailable" };

/** Consecutive null-claims before the durable layer is declared unavailable. */
const MAX_NULL_CLAIMS = 3;

async function runStageWithRetries<T>(
  taskId: string,
  stage: DurableStage,
  exec: () => Promise<T>,
  keepResult: (value: T) => unknown,
  onEvent?: (event: DurableStageEvent) => void,
): Promise<StageOutcome<T>> {
  const startedAt = Date.now();
  let nullClaims = 0;
  for (;;) {
    // Overall budget: the stage gives up honestly instead of retrying forever.
    if (Date.now() - startedAt > STAGE_TOTAL_BUDGET_MS) {
      onEvent?.({ stage, state: "exhausted", attempt: STAGE_MAX_ATTEMPTS, message: "stage time budget exceeded" });
      return { ok: false, kind: "exhausted", lastError: "stage time budget exceeded" };
    }

    const job = await claimStageJob(taskId, stage);
    if (!job?.id) {
      // No runnable job right now. A few consecutive misses mean the durable
      // layer itself is unreachable (D1 down / table missing) — fail FAST so
      // the caller can fall back instead of stalling the user's run.
      nullClaims += 1;
      if (nullClaims >= MAX_NULL_CLAIMS) {
        return { ok: false, kind: "unavailable" };
      }
      await sleep(2_000);
      continue;
    }
    nullClaims = 0;

    const attempt = Number(job.attempts) || 1;
    onEvent?.({ stage, state: "claimed", attempt, message: job.last_error ? `retrying after: ${job.last_error}` : undefined });

    try {
      const value = await exec();
      // Checkpoint the artifact (full artifact for intelligence stages; a
      // compact summary for the optimizer — the result itself returns inline).
      await completeStageJob(job.id, keepResult(value));
      onEvent?.({ stage, state: "completed", attempt });
      return { ok: true, value };
    } catch (err: any) {
      const retryAfter = retryAfterMsFromError(err);
      const serverState = await failStageJob(job.id, String(err?.message ?? err), retryAfter);
      if (serverState?.status === "dead") {
        onEvent?.({ stage, state: "exhausted", attempt, message: String(err?.message ?? err) });
        return { ok: false, kind: "exhausted", lastError: String(err?.message ?? err) };
      }
      onEvent?.({ stage, state: "retrying", attempt, message: `${err?.message ?? err} — retrying after backoff` });
      await waitBackoff(serverState?.next_run_at);
      // loop → re-claim and retry
    }
  }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Run the intelligence triplet + optimizer through the durable queue.
 * Returns the pipeline result, or null to signal "fall back to the legacy
 * inline path" (durable layer unavailable / not applicable).
 */
export async function runDurableCorePipeline(
  input: DurableRunnerInput,
): Promise<PipelineResult | null> {
  const taskId = getActiveD1TaskId();
  if (!taskId) return null; // no D1 anchor (task create failed / offline)

  const { resume, jd, onStageEvent, onProgress } = input;

  // Idempotent enqueue — safe to re-run, existing (task, stage) rows stay.
  const enqueued = await enqueueStageJobs(taskId, DURABLE_STAGES);
  if (!enqueued) return null; // D1 unreachable → legacy path

  onProgress?.({ stepNumber: 0, totalSteps: 6, log: "Durable queue mode — stages are checkpointed to D1 and paced under provider rate limits." });

  // === Stage 1-3: intelligence triplet (durable, retryable, checkpointed) ==
  let jobIntelligence: unknown;
  let companyIntelligence: unknown;
  let skillGap: unknown;

  const jiOut = await runStageWithRetries(
    taskId, "job_intelligence",
    () => analyzeJobIntelligence(jd),
    (v) => v,
    onStageEvent,
  );
  if (jiOut.ok) jobIntelligence = jiOut.value;
  else if (jiOut.kind === "unavailable") {
    console.warn("[DurablePipeline] Durable layer unavailable — falling back to the legacy inline pipeline.");
    return null; // full legacy fallback (supervisor's legacy call site)
  } else console.warn(`[DurablePipeline] Job Intelligence exhausted — continuing without it (${jiOut.lastError})`);

  const ciOut = await runStageWithRetries(
    taskId, "company_intelligence",
    () => analyzeCompanyIntelligence(jd, (jobIntelligence as any) ?? null),
    (v) => v,
    onStageEvent,
  );
  if (!ciOut.ok) {
    if (ciOut.kind === "unavailable") {
      console.warn("[DurablePipeline] Durable layer unavailable — falling back to the legacy inline pipeline.");
      return null;
    }
    console.warn(`[DurablePipeline] Company Intelligence exhausted — continuing without it (${ciOut.lastError})`);
  } else if (ciOut.value) {
    companyIntelligence = ciOut.value;
  } // else: stage returned null (no identifiable company) — continue without it

  const sgOut = await runStageWithRetries(
    taskId, "skill_gap",
    () => analyzeSkillGap(resume, jd, (jobIntelligence as any) ?? null, (companyIntelligence as any) ?? null),
    (v) => v,
    onStageEvent,
  );
  if (sgOut.ok) skillGap = sgOut.value;
  else if (sgOut.kind === "unavailable") {
    console.warn("[DurablePipeline] Durable layer unavailable — falling back to the legacy inline pipeline.");
    return null;
  } else console.warn(`[DurablePipeline] Skill Gap exhausted — continuing without it (${sgOut.lastError})`);

  // === Stage 4: optimizer (durable) ========================================
  // Assemble a FRESH checkpoint from this run's durable artifacts. Artifacts
  // that failed their job are simply absent → the orchestrator's restored
  // path re-runs exactly that one internally (bounded, single call).
  // Merge with the UI-passed checkpoint (previous recoverable run): this
  // run's durable artifacts win when present.
  const prior = input.checkpoint;
  const checkpoint: PipelineCheckpoint = {
    savedAt: new Date().toISOString(),
    jdFingerprint: jdFingerprint(jd),
    jobIntelligence: jobIntelligence ?? prior?.jobIntelligence,
    companyIntelligence: companyIntelligence ?? prior?.companyIntelligence,
    skillGap: skillGap ?? prior?.skillGap,
  };

  const optimizerOut = await runStageWithRetries<PipelineResult>(
    taskId, "optimizer",
    () =>
      runOptimizationPipeline({
        resume,
        jd,
        userDirectives: input.userDirectives,
        aviationMode: input.aviationMode,
        enableReflection: input.enableReflection,
        deepAgenticMode: input.deepAgenticMode,
        checkExport: false,
        onProgress,
        profile: input.profile as any,
        checkpoint,
      }),
    // Compact summary only — the full result returns inline; avoid storing
    // a duplicate of the whole resume in D1.
    (v) => ({ status: v.status, provider: v.provider, charCount: v.charCount, savedAt: new Date().toISOString() }),
    onStageEvent,
  );

  if (optimizerOut.ok) {
    return optimizerOut.value;
  }

  if (optimizerOut.kind === "unavailable") {
    // Durable layer died mid-run (e.g. D1 outage): fall back to the INLINE
    // pipeline WITH the checkpoint assembled so far — completed intelligence
    // artifacts are still not re-billed.
    console.warn("[DurablePipeline] Durable layer unavailable at the optimizer — finishing inline with the durable checkpoint.");
    try {
      return await runOptimizationPipeline({
        resume,
        jd,
        userDirectives: input.userDirectives,
        aviationMode: input.aviationMode,
        enableReflection: input.enableReflection,
        deepAgenticMode: input.deepAgenticMode,
        checkExport: false,
        onProgress,
        profile: input.profile as any,
        checkpoint,
      });
    } catch {
      return null; // last resort — supervisor's legacy path handles it
    }
  }

  // Optimizer exhausted its durable budget: surface the honest failure via
  // the standard error channel — the supervisor's catch shows the failed
  // run with per-step statuses (same as a legacy failed run).
  throw new Error(optimizerOut.lastError || "Optimizer stage exhausted its durable retry budget");
}
