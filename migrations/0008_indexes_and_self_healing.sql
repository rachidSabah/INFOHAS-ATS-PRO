-- ============================================================================
-- Migration 0008: Required Indexes + Foreign Keys + Self-Healing
--
-- Adds all required indexes for performance and consistency.
-- Enables foreign key enforcement.
-- Adds provider_sync_state table for drift detection.
-- ============================================================================

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- === REQUIRED INDEXES ===

CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_cover_letters_user_id ON cover_letters(user_id);
CREATE INDEX IF NOT EXISTS idx_job_descriptions_user_id ON job_descriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_interviews_user_id ON interviews(user_id);
CREATE INDEX IF NOT EXISTS idx_ats_reports_resume_id ON ats_reports(resume_id);
CREATE INDEX IF NOT EXISTS idx_ats_reports_job_description_id ON ats_reports(job_description_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_ai_providers_name ON ai_providers(name);
CREATE INDEX IF NOT EXISTS idx_prompts_provider_id ON prompts(provider_id);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
CREATE INDEX IF NOT EXISTS idx_downloads_user_id ON downloads(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_user_created ON resumes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_user_created ON interviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- === UNIQUE INDEX for users.email (if not already unique) ===
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);

-- === PROVIDER SYNC STATE TABLE ===
-- Tracks the last sync hash and status for drift detection
CREATE TABLE IF NOT EXISTS provider_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  config_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_status TEXT NOT NULL DEFAULT 'pending',
  last_sync_error TEXT,
  provider_count INTEGER DEFAULT 0,
  repaired_count INTEGER DEFAULT 0,
  backfilled_count INTEGER DEFAULT 0
);

-- Insert default row if not exists
INSERT OR IGNORE INTO provider_sync_state (id, config_hash, updated_at, last_sync_status)
VALUES (1, '', datetime('now'), 'pending');

-- === CLEANUP ORPHAN RECORDS ===
-- Remove resumes that reference non-existent users
DELETE FROM resumes WHERE user_id IS NOT NULL AND user_id != '' AND user_id NOT IN (SELECT id FROM users);

-- Remove cover letters that reference non-existent resumes
DELETE FROM cover_letters WHERE resume_id IS NOT NULL AND resume_id != '' AND resume_id NOT IN (SELECT id FROM resumes);

-- Remove interviews that reference non-existent resumes
DELETE FROM interviews WHERE resume_id IS NOT NULL AND resume_id != '' AND resume_id NOT IN (SELECT id FROM resumes);

-- Remove ATS reports that reference non-existent resumes
DELETE FROM ats_reports WHERE resume_id IS NOT NULL AND resume_id != '' AND resume_id NOT IN (SELECT id FROM resumes);
