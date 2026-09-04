-- DB migration 0007: Enhanced user management with approval workflow
-- Run with: wrangler d1 migrations apply resumeai-pro-db --remote
--
-- CHAIN FIX (2026-09): the users ALTERs below previously duplicated columns
-- that 0001 already creates (password_hash, status) — the migration runner
-- died on "duplicate column name: password_hash" and EVERY migration after
-- 0006 was never applied on fresh databases. 0001 now carries the full
-- users shape (username, last_login_at, updated_at, wide status CHECK), so
-- this file only creates what 0001 does not have.
--
-- NOTE for databases stuck between 0001 and 0007 (0007 failed there): apply
-- the missing users columns manually with
--   ALTER TABLE users ADD COLUMN username TEXT;            -- if missing
--   ALTER TABLE users ADD COLUMN last_login_at TEXT;       -- if missing
--   ALTER TABLE users ADD COLUMN updated_at TEXT;          -- if missing
-- then re-run `wrangler d1 migrations apply`.

-- Backfill: normalize pre-workflow status values (harmless on fresh DBs)
UPDATE users SET status = 'approved' WHERE status IS NULL OR status = 'active';

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- Password resets table
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

-- Enhanced audit logs
ALTER TABLE audit_logs ADD COLUMN user_id TEXT;
ALTER TABLE audit_logs ADD COLUMN performed_by TEXT;
ALTER TABLE audit_logs ADD COLUMN metadata TEXT;

-- ATS reports: the API writes user_id on every report and 0008's
-- idx_ats_user index requires it — but 0001's ats_reports predates the
-- column. Must run BEFORE 0008.
ALTER TABLE ats_reports ADD COLUMN user_id TEXT;

-- Seed super admin (if not exists)
INSERT OR IGNORE INTO users (id, email, username, name, password_hash, role, status, provider, created_at, updated_at)
VALUES (
  'u_superadmin',
  'admin@resumeai.local',
  'Admin',
  'Super Admin',
  -- Password: Santafee@@@@@1972 (hashed — in production use bcrypt via Workers)
  'rh1$' || 'Santafee@@@@@1972_hashed_with_bcrypt_in_production',
  'super_admin',
  'approved',
  'email',
  '2025-01-01T00:00:00Z',
  datetime('now')
);
