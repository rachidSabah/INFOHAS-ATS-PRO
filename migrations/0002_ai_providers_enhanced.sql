-- DB migration 0002: Enhanced AI Provider Management
-- Adds new columns to ai_providers and creates ai_provider_logs table.
-- Run with: wrangler d1 migrations apply resumeai-pro-db --remote

-- ============ ai_providers: new columns ============
ALTER TABLE ai_providers ADD COLUMN base_url TEXT;
ALTER TABLE ai_providers ADD COLUMN request_template TEXT;
ALTER TABLE ai_providers ADD COLUMN response_path TEXT;
ALTER TABLE ai_providers ADD COLUMN streaming_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN is_fallback INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN retry_attempts INTEGER NOT NULL DEFAULT 2;
ALTER TABLE ai_providers ADD COLUMN rate_limit_per_minute INTEGER NOT NULL DEFAULT 60;
ALTER TABLE ai_providers ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'bearer';
ALTER TABLE ai_providers ADD COLUMN supports_function_calling INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN cost_per_input_token REAL NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN cost_per_output_token REAL NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN application_id TEXT;
ALTER TABLE ai_providers ADD COLUMN client_id TEXT;
ALTER TABLE ai_providers ADD COLUMN redirect_uri TEXT;
ALTER TABLE ai_providers ADD COLUMN enabled_models_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ai_providers ADD COLUMN last_used_at TEXT;
-- Add cost to existing usage columns (we use a single usage_cost column to keep things simple)
ALTER TABLE ai_providers ADD COLUMN usage_cost REAL NOT NULL DEFAULT 0;

-- Status enum now allows 'untested'
-- (SQLite doesn't enforce CHECK on existing rows; we just update the constraint for future inserts via app logic)

-- ============ ai_provider_logs ============
CREATE TABLE IF NOT EXISTS ai_provider_logs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'chat' CHECK (request_type IN ('chat','test','stream','embed')),
  model_name TEXT,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','error','timeout','rate_limited')),
  latency_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_message TEXT,
  request_preview TEXT,
  response_preview TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_provider ON ai_provider_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_status ON ai_provider_logs(status);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_provider_logs(created_at DESC);

-- ============ ai_provider_settings (singleton row) ============
CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_provider_id TEXT,
  default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4',
  fallback_provider_ids_json TEXT NOT NULL DEFAULT '[]',
  retry_attempts INTEGER NOT NULL DEFAULT 2,
  timeout INTEGER NOT NULL DEFAULT 30000,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  enable_failover INTEGER NOT NULL DEFAULT 1,
  enable_caching INTEGER NOT NULL DEFAULT 1,
  enable_cost_tracking INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO ai_provider_settings (id) VALUES (1);
