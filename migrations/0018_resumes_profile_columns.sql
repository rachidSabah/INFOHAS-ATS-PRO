-- ============================================================================
-- D1 Migration 0018: resumes profile columns + users.avatar
--
-- CHAIN FIX: the Workers API writes these columns (POST/PUT /api/resumes,
-- POST/PUT /api/users) but no earlier migration ever ADDED them to
-- databases created from 0001 (they only existed inside 0008's
-- CREATE TABLE IF NOT EXISTS — which never runs when 0001's tables are
-- already present). On any 0001-based database the resume INSERT failed
-- with "no such column: photo_url".
--
--   resumes.photo_url / resumes.date_of_birth — worker INSERT + UPDATE
--   users.avatar                              — worker INSERT/UPDATE
--     (0001 provides avatar_url, the API's "avatar" column is the
--      0008-era name and is now guaranteed to exist alongside it)
--
-- Run: npx wrangler d1 migrations apply resumeai-pro-db --remote
-- ============================================================================

ALTER TABLE resumes ADD COLUMN photo_url TEXT;
ALTER TABLE resumes ADD COLUMN date_of_birth TEXT;
ALTER TABLE users ADD COLUMN avatar TEXT;
-- NOTE: ats_reports.user_id is added by 0007_user_management.sql — it must
-- exist BEFORE 0008 creates idx_ats_user on it.
