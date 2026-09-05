-- 0021_provider_concurrency_cap.sql
-- The AI Providers editor exposes a per-provider `concurrencyCap` field
-- (AIProvider.concurrencyCap) used by the rate governor / provider
-- concurrency limiter at runtime, and a `retryAttempts` + `rateLimitPerMinute`
-- pair. retry_attempts and rate_limit_per_minute already existed, but the
-- worker's PUT /api/providers/:id whitelist never accepted them (edits were
-- silently dropped with "No persistable DB fields"), and concurrency_cap had
-- no column at all.
--
-- This migration adds the missing column; the worker whitelist now maps
-- retryAttempts / rateLimitPerMinute / concurrencyCap so every provider
-- field edited in Super Admin persists and survives refresh.

ALTER TABLE ai_providers ADD COLUMN concurrency_cap INTEGER;
