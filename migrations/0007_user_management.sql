-- DB migration 0004: Enhanced user management with approval workflow
-- Run with: wrangler d1 execute resumeai-pro-db --file=migrations/0004_user_management.sql --remote

-- Update users table with new columns
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended','deleted'));
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;

-- Update existing users to approved status (backward compat)
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
