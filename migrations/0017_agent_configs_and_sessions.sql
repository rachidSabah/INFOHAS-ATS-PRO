-- ============================================================================
-- Migration 0017 — Agent Configuration Center persistence (directive #20/#21)
--
-- The Agent Configuration Center previously wrote agentConfigs into
-- PUT /api/settings/branding, but the worker dropped the payload (no column,
-- no handler code) — configurations survived only for the current page
-- session. This migration adds an authoritative, versioned, auditable home
-- for the 18-agent registry on the existing branding settings singleton row
-- (adapting to the existing database architecture rather than duplicating
-- tables — directive #20).
-- ============================================================================

ALTER TABLE branding ADD COLUMN agent_configs_json TEXT;
ALTER TABLE branding ADD COLUMN agent_configs_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE branding ADD COLUMN agent_configs_updated_at TEXT;
ALTER TABLE branding ADD COLUMN agent_configs_updated_by TEXT;

-- ============================================================================
-- Migration 0017b — Provider session persistence (directive #39)
--
-- The SessionManager issues PUT /api/provider-sessions/:provider but neither
-- the Next.js route nor the worker implemented PUT (404 in production logs).
-- This table gives provider sessions (Puter/Antigravity OAuth) a real home in
-- D1 so authentication state survives restore.
-- ============================================================================

CREATE TABLE IF NOT EXISTS provider_sessions (
  provider TEXT PRIMARY KEY,
  session_json TEXT NOT NULL,
  authenticated INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
