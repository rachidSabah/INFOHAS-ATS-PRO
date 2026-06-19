-- ResumeAI Pro — Provider Classification System
-- Adds provider_category, capability flags, and health tracking to ai_providers
-- Cloudflare D1 (SQLite) compatible

-- Add provider classification columns
ALTER TABLE ai_providers ADD COLUMN provider_category TEXT NOT NULL DEFAULT 'api';
ALTER TABLE ai_providers ADD COLUMN supports_server_side INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_providers ADD COLUMN supports_client_side INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN supports_streaming INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN supports_function_calling INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN supports_json_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN requires_browser_auth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN requires_api_key INTEGER NOT NULL DEFAULT 1;

-- Add health tracking columns
ALTER TABLE ai_providers ADD COLUMN health_last_success_at TEXT;
ALTER TABLE ai_providers ADD COLUMN health_last_failure_at TEXT;
ALTER TABLE ai_providers ADD COLUMN health_last_error TEXT;
ALTER TABLE ai_providers ADD COLUMN health_consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN health_consecutive_successes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN health_rate_limited_until TEXT;

-- Update existing Puter providers to browser_auth category
UPDATE ai_providers
SET provider_category = 'browser_auth',
    supports_server_side = 0,
    supports_client_side = 1,
    requires_browser_auth = 1,
    requires_api_key = 0
WHERE provider_type = 'puter' OR name LIKE '%Puter%';

-- Update all other providers to api category (already default, but be explicit)
UPDATE ai_providers
SET provider_category = 'api',
    supports_server_side = 1,
    supports_client_side = 1,
    requires_browser_auth = 0,
    requires_api_key = 1
WHERE provider_category = 'api' AND (provider_type != 'puter' AND name NOT LIKE '%Puter%');
