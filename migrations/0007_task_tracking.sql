-- Migration 0007: Task tracking tables for D1-based polling (replaces Durable Objects)
--
-- This migration creates tables for tracking async AI/build/test/patch/debug jobs.
-- The frontend polls /api/tasks/:id/status every 2 seconds to get updates.
-- No Durable Objects or WebSockets required — works on Cloudflare Free plan.
--
-- Task status enum: queued | running | completed | failed | cancelled
-- Progress values: 0, 10, 25, 50, 75, 100

-- === AI Tasks (resume optimization, cover letter, interview, JD scraper, etc.) ===
CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'generic',      -- optimization | cover_letter | interview | jd_scrape | etc.
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | running | completed | failed | cancelled
  progress INTEGER NOT NULL DEFAULT 0,        -- 0-100
  message TEXT,                               -- "Initializing", "Generating Patch", etc.
  result_json TEXT,                            -- JSON blob with the task result
  error TEXT,                                  -- error message (if status = failed)
  created_at INTEGER NOT NULL,                 -- epoch milliseconds
  updated_at INTEGER NOT NULL                  -- epoch milliseconds
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_type ON ai_tasks(type);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_created ON ai_tasks(created_at);

-- === Patch Jobs (AI Builder Agent patch generation) ===
CREATE TABLE IF NOT EXISTS patch_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  patch_json TEXT,                             -- { files: [{path, content, diff}], description }
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patch_jobs_status ON patch_jobs(status);

-- === Build Jobs (Build Manager) ===
CREATE TABLE IF NOT EXISTS build_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  logs TEXT,                                   -- build log output
  warnings TEXT,                               -- warning messages
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_build_jobs_status ON build_jobs(status);

-- === Test Jobs (Test Runner) ===
CREATE TABLE IF NOT EXISTS test_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  logs TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_test_jobs_status ON test_jobs(status);

-- === Autonomous Debug Jobs ===
CREATE TABLE IF NOT EXISTS autonomous_debug_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  findings_json TEXT,                          -- { rootCause, stackTrace, analysis }
  patch_json TEXT,                             -- proposed fix
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_autonomous_debug_jobs_status ON autonomous_debug_jobs(status);
