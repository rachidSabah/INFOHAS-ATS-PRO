-- ResumeAI Pro — Migration 0022: Server-backed shareable resume links
-- A share = a self-contained SNAPSHOT of one resume (full ResumeData JSON)
-- published under a stable URL-safe token. The public reader route
-- (/r/<token> in the Pages frontend) fetches the snapshot via
-- GET /api/public/shares/<token> — no auth, view-counted.
--
-- Design notes:
--  * No FK on resume_id on purpose: the snapshot is standalone and must keep
--    working even after the source resume is deleted/renamed locally.
--  * No FK on user_id on purpose: shares can be created by the "anonymous"
--    sync identity, which has no users row (see ensureUserExists in the
--    worker — it skips anonymous), and a REFERENCES constraint would reject
--    that INSERT. Owner scoping is enforced in code (WHERE user_id = ?).
--  * CREATE TABLE IF NOT EXISTS only — no ALTER TABLE (migrations/0018 lesson).
--  * One share per (user_id, resume_id): POST /api/shares UPSERTS so the
--    share URL/token stays stable across snapshot refreshes.

CREATE TABLE IF NOT EXISTS resume_shares (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  hide_contact INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  view_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resume_shares_token ON resume_shares(token);
CREATE INDEX IF NOT EXISTS idx_resume_shares_user ON resume_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_resume_shares_resume ON resume_shares(resume_id);
