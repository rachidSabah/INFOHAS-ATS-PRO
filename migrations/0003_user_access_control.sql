# DB migration 0003: Add allowed_for_regular_users column to ai_providers
-- Run with: wrangler d1 execute resumeai-pro-db --file=migrations/0003_user_access_control.sql --remote

-- Add column: controls whether non-super-admin users can use this provider
ALTER TABLE ai_providers ADD COLUMN allowed_for_regular_users INTEGER NOT NULL DEFAULT 0;

-- Set default: Puter.js, OpenCode, ZenCode, and Z.ai fallback are available to all users
-- (these are the free / built-in providers)
UPDATE ai_providers SET allowed_for_regular_users = 1
  WHERE provider_type IN ('puter', 'opencode', 'zencode', 'z-ai-fallback');

-- All other providers (OpenAI, Claude, Gemini, etc.) are super-admin-only by default
-- Super admins can toggle this per-provider in the AI Providers dashboard
UPDATE ai_providers SET allowed_for_regular_users = 0
  WHERE provider_type NOT IN ('puter', 'opencode', 'zencode', 'z-ai-fallback');
