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
