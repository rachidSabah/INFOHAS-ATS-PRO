-- Migration 0006: Add provider_settings_json column to branding table
-- Stores AI routing settings (defaultProviderId, defaultModel, fallbackProviderIds)
-- so they persist across refresh/logout/login cycles.

ALTER TABLE branding ADD COLUMN provider_settings_json TEXT;
ALTER TABLE branding ADD COLUMN ai_routing_settings_json TEXT;
