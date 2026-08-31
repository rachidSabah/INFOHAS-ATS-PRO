/**
 * Task 29 — Antigravity model sync uses STABLE row identities.
 *
 * Audit finding (2026-08-31): the OAuth callback inserted one provider_models
 * row per model per sync with `crypto.randomUUID()` as PRIMARY KEY and
 * `INSERT OR REPLACE` keyed on that NEW random id — so REPLACE never matched
 * the previous row and every "Sync Models" click appended 8 duplicate rows
 * (same provider_id + model_id, fresh id). The provider configuration UI then
 * displayed the synced catalog incorrectly.
 *
 * This helper is the single source of truth for the upsert statement:
 *  - Deterministic row id  : `${providerId}:${modelId}`
 *  - Conflict target       : UNIQUE(provider_id, model_id) (migration 0016)
 *  - Re-sync behaviour     : refresh model_name only; enabled state of an
 *                            existing row is preserved (never reset to 1)
 *  - Ownership             : provider_id is ALWAYS 'antigravity' for this
 *                            integration — synced models can never drift into
 *                            the google-gemini provider records.
 */

export const ANTIGRAVITY_MODEL_PROVIDER_ID = "antigravity";

export function antigravityModelUpsert(modelId: string): { sql: string; params: string[] } {
  const stableId = `${ANTIGRAVITY_MODEL_PROVIDER_ID}:${modelId}`;
  const sql = `
    INSERT INTO provider_models (id, provider_id, model_id, model_name, enabled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(provider_id, model_id) DO UPDATE
      SET model_name = excluded.model_name
  `.trim();
  return { sql, params: [stableId, ANTIGRAVITY_MODEL_PROVIDER_ID, modelId, modelId] };
}
