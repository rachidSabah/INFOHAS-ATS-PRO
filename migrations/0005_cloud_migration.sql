-- ResumeAI Pro — Complete cloud migration schema
-- Database: resumeai-pro-db (D1 UUID: 4485ee27-7fec-4077-a39d-c5cc4b1b9167)
-- Run via: wrangler d1 execute resumeai-pro-db --file=migrations/0005_cloud_migration.sql --remote

-- ============ USERS ============
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT,
  name TEXT NOT NULL,
  password_hash TEXT,
  avatar TEXT,
  provider TEXT NOT NULL DEFAULT 'email',
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============ SESSIONS ============
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- ============ PASSWORD RESETS ============
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ RESUMES ============
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  headline TEXT,
  contact_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  experience_json TEXT NOT NULL DEFAULT '[]',
  education_json TEXT NOT NULL DEFAULT '[]',
  skills_json TEXT NOT NULL DEFAULT '[]',
  projects_json TEXT NOT NULL DEFAULT '[]',
  certifications_json TEXT NOT NULL DEFAULT '[]',
  languages_json TEXT NOT NULL DEFAULT '[]',
  achievements_json TEXT NOT NULL DEFAULT '[]',
  template TEXT NOT NULL DEFAULT 'ats-professional',
  accent_color TEXT DEFAULT '#1154A3',
  photo_url TEXT,
  date_of_birth TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  file_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_updated ON resumes(updated_at DESC);

-- ============ RESUME VERSIONS ============
CREATE TABLE IF NOT EXISTS resume_versions (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resume_versions_resume ON resume_versions(resume_id);

-- ============ COVER LETTERS ============
CREATE TABLE IF NOT EXISTS cover_letters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'modern',
  content TEXT NOT NULL,
  resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  jd_id TEXT REFERENCES job_descriptions(id) ON DELETE SET NULL,
  company TEXT,
  role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cover_letters_user ON cover_letters(user_id);

-- ============ COVER LETTER VERSIONS ============
CREATE TABLE IF NOT EXISTS cover_letter_versions (
  id TEXT PRIMARY KEY,
  cover_letter_id TEXT NOT NULL REFERENCES cover_letters(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ JOB DESCRIPTIONS ============
CREATE TABLE IF NOT EXISTS job_descriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  company TEXT,
  location TEXT,
  employment_type TEXT,
  salary TEXT,
  responsibilities_json TEXT NOT NULL DEFAULT '[]',
  required_skills_json TEXT NOT NULL DEFAULT '[]',
  preferred_skills_json TEXT NOT NULL DEFAULT '[]',
  technologies_json TEXT NOT NULL DEFAULT '[]',
  experience_years TEXT,
  education TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  raw_text TEXT,
  url TEXT,
  source TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jds_user ON job_descriptions(user_id);

-- ============ ATS REPORTS ============
CREATE TABLE IF NOT EXISTS ats_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  jd_id TEXT REFERENCES job_descriptions(id) ON DELETE SET NULL,
  ats_score INTEGER NOT NULL,
  formatting_score INTEGER NOT NULL,
  keywords_score INTEGER NOT NULL,
  content_score INTEGER NOT NULL,
  grammar_score INTEGER NOT NULL,
  completeness_score INTEGER NOT NULL,
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  missing_keywords_json TEXT NOT NULL DEFAULT '[]',
  matched_keywords_json TEXT NOT NULL DEFAULT '[]',
  weak_sections_json TEXT NOT NULL DEFAULT '[]',
  jd_match_percent INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ats_resume ON ats_reports(resume_id);
CREATE INDEX IF NOT EXISTS idx_ats_user ON ats_reports(user_id);

-- ============ INTERVIEW PACKAGES ============
CREATE TABLE IF NOT EXISTS interview_packages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  jd_id TEXT REFERENCES job_descriptions(id) ON DELETE SET NULL,
  company TEXT,
  role TEXT,
  questions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interviews_user ON interview_packages(user_id);

-- ============ AI PROVIDERS ============
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  base_url TEXT,
  api_key_encrypted TEXT,
  headers_json TEXT,
  parameters_json TEXT,
  request_template TEXT,
  response_path TEXT,
  streaming_enabled INTEGER NOT NULL DEFAULT 0,
  model_name TEXT,
  priority INTEGER NOT NULL DEFAULT 10,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_fallback INTEGER NOT NULL DEFAULT 0,
  is_built_in INTEGER NOT NULL DEFAULT 0,
  allowed_for_regular_users INTEGER NOT NULL DEFAULT 0,
  timeout INTEGER NOT NULL DEFAULT 30000,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  temperature REAL NOT NULL DEFAULT 0.7,
  retry_attempts INTEGER NOT NULL DEFAULT 2,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  supports_function_calling INTEGER NOT NULL DEFAULT 0,
  cost_per_input_token REAL NOT NULL DEFAULT 0,
  cost_per_output_token REAL NOT NULL DEFAULT 0,
  application_id TEXT,
  client_id TEXT,
  redirect_uri TEXT,
  enabled_models_json TEXT NOT NULL DEFAULT '[]',
  last_used_at TEXT,
  status TEXT NOT NULL DEFAULT 'untested',
  usage_requests INTEGER NOT NULL DEFAULT 0,
  usage_tokens INTEGER NOT NULL DEFAULT 0,
  usage_errors INTEGER NOT NULL DEFAULT 0,
  usage_avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  usage_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ AI PROVIDER LOGS ============
CREATE TABLE IF NOT EXISTS ai_provider_logs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'chat',
  model_name TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_message TEXT,
  request_preview TEXT,
  response_preview TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_provider ON ai_provider_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_provider_logs(created_at DESC);

-- ============ AI PROVIDER SETTINGS ============
CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_provider_id TEXT,
  default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4',
  fallback_provider_ids_json TEXT NOT NULL DEFAULT '[]',
  retry_attempts INTEGER NOT NULL DEFAULT 2,
  timeout INTEGER NOT NULL DEFAULT 30000,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  enable_failover INTEGER NOT NULL DEFAULT 1,
  enable_caching INTEGER NOT NULL DEFAULT 1,
  enable_cost_tracking INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO ai_provider_settings (id) VALUES (1);

-- ============ PROMPT TEMPLATES ============
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  provider_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  variables_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ BRANDING SETTINGS ============
CREATE TABLE IF NOT EXISTS branding (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_name TEXT NOT NULL DEFAULT 'ResumeAI Pro',
  tagline TEXT NOT NULL DEFAULT 'Land the offer. Beat the bots. Free forever.',
  primary_color TEXT NOT NULL DEFAULT '#1154A3',
  accent_color TEXT NOT NULL DEFAULT '#F59E0B',
  logo_url TEXT NOT NULL DEFAULT '/brand/logo.svg',
  email_from_name TEXT NOT NULL DEFAULT 'ResumeAI Pro',
  email_from_address TEXT NOT NULL DEFAULT 'hello@resumeai.pro',
  pdf_footer_text TEXT NOT NULL DEFAULT 'Generated by ResumeAI Pro — resumeai.pro',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO branding (id) VALUES (1);

-- ============ FEATURE FLAGS ============
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO feature_flags (key, value) VALUES
  ('enableResumeBuilder', 1), ('enableATSChecker', 1), ('enableOptimizer', 1),
  ('enableCoverLetter', 1), ('enableInterviewPrep', 1), ('enableJDScraper', 1),
  ('enableAIFailover', 1), ('enableDonations', 1), ('enableAds', 0), ('maintenanceMode', 0);

-- ============ AUDIT LOGS ============
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  details TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  performed_by TEXT,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_category ON audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_logs_user ON audit_logs(user_id);

-- ============ USER SETTINGS ============
CREATE TABLE IF NOT EXISTS user_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'light',
  language TEXT NOT NULL DEFAULT 'en',
  sidebar_collapsed INTEGER NOT NULL DEFAULT 0,
  notification_preferences_json TEXT NOT NULL DEFAULT '{}',
  dashboard_settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ DOWNLOADS ============
CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT,
  format TEXT NOT NULL,
  file_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id);

-- ============ UPLOAD HISTORY ============
CREATE TABLE IF NOT EXISTS upload_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON upload_history(user_id);

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = 0;

-- ============ SEED: SUPER ADMIN ============
INSERT OR IGNORE INTO users (id, email, username, name, password_hash, role, status, provider, created_at)
VALUES (
  'u_superadmin',
  'admin@resumeai.local',
  'Admin',
  'Super Admin',
  'rh1$superadmin_hashed_placeholder',
  'super_admin',
  'approved',
  'email',
  '2025-01-01T00:00:00Z'
);

-- ============ SEED: DEFAULT PROVIDERS ============
INSERT OR IGNORE INTO ai_providers (id, name, provider_type, base_url, model_name, priority, is_active, is_default, is_fallback, is_built_in, allowed_for_regular_users, status) VALUES
  ('p_puter', 'Puter.js (Free, user-auth)', 'puter', 'https://api.puter.com', 'claude-sonnet-4', 1, 1, 1, 1, 1, 1, 'healthy'),
  ('p_opencode', 'OpenCode (Free models)', 'opencode', 'https://api.opencode.ai/v1', 'opencode/gpt-4o-mini', 2, 1, 0, 0, 1, 1, 'healthy'),
  ('p_zencode', 'ZenCode (Free models)', 'zencode', 'https://api.zencode.ai/v1', 'zencode/free-1', 3, 1, 0, 0, 1, 1, 'healthy'),
  ('p_zai', 'Z.ai Fallback (built-in)', 'z-ai-fallback', 'internal', 'glm-4.6', 99, 1, 0, 1, 1, 1, 'healthy');

-- ============ SEED: AI PROVIDER SETTINGS ============
UPDATE ai_provider_settings SET default_provider_id = 'p_puter', fallback_provider_ids_json = '["p_zai"]' WHERE id = 1;
