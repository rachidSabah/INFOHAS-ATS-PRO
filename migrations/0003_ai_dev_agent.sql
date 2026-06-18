-- ResumeAI Pro — AI Development Agent tables
-- Creates: ai_agent_settings, ai_agent_history, ai_agent_reports
-- Cloudflare D1 (SQLite) compatible

-- ============================================================================
-- ai_agent_settings — single-row table with the agent's configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_agent_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  provider_id TEXT,
  model_name TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
  temperature REAL NOT NULL DEFAULT 0.4,
  max_tokens INTEGER NOT NULL DEFAULT 8000,
  timeout INTEGER NOT NULL DEFAULT 60,
  streaming INTEGER NOT NULL DEFAULT 0,
  reasoning_level TEXT NOT NULL DEFAULT 'medium',
  system_prompt TEXT NOT NULL DEFAULT '',
  fallback_provider_id TEXT,
  fallback_model TEXT,
  safe_apply_enabled INTEGER NOT NULL DEFAULT 1,
  require_approval_enabled INTEGER NOT NULL DEFAULT 1,
  auto_scan_enabled INTEGER NOT NULL DEFAULT 0,
  auto_report_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default singleton row if it doesn't exist
INSERT OR IGNORE INTO ai_agent_settings (id, system_prompt) VALUES (
  'singleton',
  'You are an elite AI Development Agent for ResumeAI Pro — a production Next.js 16 + Cloudflare Pages + D1 application.'
);

-- ============================================================================
-- ai_agent_history — audit log of all agent actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_agent_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  action TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT '',
  patch TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_history_user_id ON ai_agent_history(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_history_action ON ai_agent_history(action);
CREATE INDEX IF NOT EXISTS idx_ai_agent_history_created_at ON ai_agent_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_history_status ON ai_agent_history(status);

-- ============================================================================
-- ai_agent_reports — stored scan reports (code audits, security scans, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_agent_reports (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  issues_json TEXT NOT NULL DEFAULT '[]',
  score INTEGER,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_reports_type ON ai_agent_reports(type);
CREATE INDEX IF NOT EXISTS idx_ai_agent_reports_created_at ON ai_agent_reports(created_at DESC);
