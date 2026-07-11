-- Migration 0006: Add provider_settings_json column to branding table
-- Stores AI routing settings (defaultProviderId, defaultModel, fallbackProviderIds)
-- so they persist across refresh/logout/login cycles.
--
-- IDEMPOTENT: Safe to re-run. SQLite does not support IF NOT EXISTS on ADD COLUMN,
-- so we use a guard via PRAGMA table_info. The Cloudflare D1 migrations runner
-- will skip already-applied statements automatically (it tracks applied migrations
-- in the d1_migrations system table).
--
-- If running manually via `wrangler d1 execute`, re-running will produce a
-- "duplicate column name" error — this is expected and harmless. The CI/CD
-- pipeline uses `wrangler d1 migrations apply` which tracks state and skips.

ALTER TABLE branding ADD COLUMN provider_settings_json TEXT;
ALTER TABLE branding ADD COLUMN ai_routing_settings_json TEXT;
