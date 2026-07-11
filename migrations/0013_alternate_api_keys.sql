-- DB migration 0009: Add alternate API keys to ai_providers
-- Run with: wrangler d1 migrations apply resumeai-pro-db --local / --remote

ALTER TABLE ai_providers ADD COLUMN alternate_api_keys_json TEXT;
