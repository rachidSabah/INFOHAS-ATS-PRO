-- ============================================================================
-- D1 Migration 0016: provider_models stable identities (Task 29)
--
-- Problem: the OAuth callback and /models/sync inserted one row per model
-- per sync with a fresh crypto.randomUUID() PRIMARY KEY + INSERT OR REPLACE.
-- REPLACE keyed on the NEW random id never matched the previous row, so every
-- "Sync Models" click appended 8 duplicate rows (same provider_id + model_id,
-- new id). Provider configuration UIs reading provider_models then showed a
-- duplicated catalog.
--
-- This migration:
--   1. Deduplicates existing rows, keeping the newest per (provider_id,
--      model_id) — no model data is lost, user enable/disable state of the
--      kept row is preserved.
--   2. Adds UNIQUE(provider_id, model_id) so future syncs are true upserts.
--   3. Normalizes kept row ids to the stable 'provider:model' form.
--
-- Run: npx wrangler d1 migrations apply <db-name> --remote
-- ============================================================================

-- 1. Deduplicate: keep only the newest row per (provider_id, model_id).
DELETE FROM provider_models
WHERE id NOT IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY provider_id, model_id
            ORDER BY created_at DESC, rowid DESC
        ) AS rn
        FROM provider_models
    )
    WHERE rn = 1
);

-- 2. Stable row ids: normalize kept rows to 'provider:model' (idempotent).
--    Collisions are impossible after step 1 (one row per pair).
UPDATE provider_models
SET id = provider_id || ':' || model_id
WHERE id != provider_id || ':' || model_id;

-- 3. Enforce the stable identity contract going forward.
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_models_provider_model
    ON provider_models(provider_id, model_id);
