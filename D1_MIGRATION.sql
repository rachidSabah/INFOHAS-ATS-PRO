-- ============================================================================
-- D1 Migration: Antigravity CLI Provider Support
-- Provider tokens, connections, models, health, and capabilities tables.
-- Run: npx wrangler d1 migrations apply <db-name> --remote
-- ============================================================================

-- 1. Provider Tokens (encrypted)
CREATE TABLE IF NOT EXISTS provider_tokens (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT 'antigravity',
    access_token TEXT NOT NULL,       -- AES-encrypted
    refresh_token TEXT,               -- AES-encrypted
    expires_at INTEGER,              -- epoch ms
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_user ON provider_tokens(user_id, provider_id);

-- 2. Provider Connections (registry)
CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'antigravity',
    provider_name TEXT DEFAULT 'Antigravity CLI',
    enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',     -- active, expired, error, disconnected
    metadata TEXT,                    -- JSON: detected models, health scores
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_provider_connections_user ON provider_connections(user_id, provider);

-- 3. Provider Models (auto-discovered)
CREATE TABLE IF NOT EXISTS provider_models (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    provider_id TEXT NOT NULL DEFAULT 'antigravity',
    model_id TEXT NOT NULL,           -- e.g. "claude-sonnet-4"
    model_name TEXT,                  -- e.g. "Claude Sonnet 4"
    context_window INTEGER,           -- e.g. 200000
    capabilities TEXT,                -- JSON: { coding, reasoning, quality }
    enabled INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);

-- 4. Provider Health Monitoring
CREATE TABLE IF NOT EXISTS provider_health (
    provider_id TEXT NOT NULL DEFAULT 'antigravity',
    model_id TEXT NOT NULL,
    latency INTEGER DEFAULT 0,        -- average latency ms
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    rate_limit_count INTEGER DEFAULT 0,
    health_score REAL DEFAULT 100.0,  -- 0.0 - 100.0
    updated_at INTEGER DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (provider_id, model_id)
);

-- 5. Provider Capability Scores
CREATE TABLE IF NOT EXISTS provider_capabilities (
    provider_id TEXT NOT NULL DEFAULT 'antigravity',
    model_id TEXT NOT NULL,
    coding_score REAL DEFAULT 50.0,     -- 0-100
    reasoning_score REAL DEFAULT 50.0,  -- 0-100
    quality_score REAL DEFAULT 50.0,    -- 0-100
    context_window INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (provider_id, model_id)
);

-- ============================================================================
-- 6. Providers Registry (emergency_only, priority, tier support)
-- ============================================================================
CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    provider_type TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 50,
    emergency_only INTEGER NOT NULL DEFAULT 0,
    tier INTEGER NOT NULL DEFAULT 3,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Seed provider registry with correct priorities
INSERT OR IGNORE INTO providers (id, provider_type, provider_name, enabled, priority, emergency_only, tier) VALUES
    ('antigravity', 'antigravity', 'Antigravity CLI', 1, 10, 0, 1),
    ('opencode', 'opencode', 'OpenCode', 1, 20, 0, 1),
    ('zencode', 'zencode', 'ZenCode', 1, 30, 0, 1),
    ('gemini', 'gemini', 'Gemini Pro', 1, 40, 0, 2),
    ('nvidia', 'nvidia', 'Nvidia', 1, 50, 0, 2),
    ('groq', 'groq', 'Groq', 1, 60, 0, 2),
    ('openrouter', 'openrouter', 'OpenRouter', 1, 70, 0, 3),
    ('mistral', 'mistral', 'Mistral', 1, 80, 0, 3),
    ('puter', 'puter', 'Puter.js', 1, 999, 1, 4);

-- ============================================================================
-- 7. Optimization Sessions (checkpoint + recovery)
-- ============================================================================
CREATE TABLE IF NOT EXISTS optimization_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    provider_id TEXT,
    current_stage TEXT DEFAULT 'parsing',
    status TEXT NOT NULL DEFAULT 'in_progress',
    checkpoint_json TEXT,
    error TEXT,
    started_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000),
    completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_opt_sessions_user ON optimization_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_opt_sessions_status ON optimization_sessions(status);

-- ============================================================================
-- 8. Optimization Checkpoints (per-stage snapshots)
-- ============================================================================
CREATE TABLE IF NOT EXISTS optimization_checkpoints (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    session_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (session_id) REFERENCES optimization_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_opt_checkpoints_session ON optimization_checkpoints(session_id, stage);
