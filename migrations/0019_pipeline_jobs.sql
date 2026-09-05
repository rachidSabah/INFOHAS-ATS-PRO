-- ============================================================================
-- D1 Migration 0019: pipeline_jobs — durable queue for the optimization
-- pipeline (Option 1: Durable Queue Runner).
--
-- WHY: the pipeline's agents (Job/Company Intelligence, Skill Gap, the
-- Optimizer) run against AI providers with finite rate limits. When agents
-- fail on limits, the run degraded — and the in-memory checkpoint died with
-- the page. This table makes per-stage work DURABLE:
--
--   - one row per (task, stage) — UNIQUE for idempotent re-enqueue
--   - claim/lease protocol: a runner claims a job (status='running' +
--     lease_expires_at); expired leases are re-queued automatically so a
--     closed tab never orphans a run
--   - bounded exponential backoff via next_run_at (Retry-After aware)
--   - result_json checkpoint per completed stage — a retry restores
--     completed intelligence artifacts instead of re-billing those calls
--
-- Consumed by the Workers API endpoints under /api/pipeline/jobs and the
-- client runner (src/lib/agents/durable-pipeline.ts).
--
-- Run: npx wrangler d1 migrations apply resumeai-pro-db --remote
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_pjobs_task ON pipeline_jobs(task_id, status);
CREATE INDEX IF NOT EXISTS idx_pjobs_claim ON pipeline_jobs(status, next_run_at);
