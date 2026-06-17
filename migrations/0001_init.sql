# DB migration: initial schema for ResumeAI Pro (Cloudflare D1 + Drizzle ORM)
-- Run with: wrangler d1 migrations apply resumeai-pro-db --remote

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('guest','user','admin','super_admin')),
  provider TEXT NOT NULL DEFAULT 'email',
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT,
  usage_resumes INTEGER NOT NULL DEFAULT 0,
  usage_ats_checks INTEGER NOT NULL DEFAULT 0,
  usage_cover_letters INTEGER NOT NULL DEFAULT 0,
  usage_interview_preps INTEGER NOT NULL DEFAULT 0,
  usage_downloads INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- Resumes
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  headline TEXT,
  contact_json TEXT NOT NULL,
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
  source TEXT NOT NULL DEFAULT 'manual',
  file_name TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_updated ON resumes(updated_at DESC);

-- Job descriptions
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

-- ATS reports
CREATE TABLE IF NOT EXISTS ats_reports (
  id TEXT PRIMARY KEY,
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

-- Cover letters
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

-- Interview packages
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

-- AI providers
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  api_url TEXT,
  api_key_encrypted TEXT,
  headers_json TEXT,
  parameters_json TEXT,
  model_name TEXT,
  priority INTEGER NOT NULL DEFAULT 10,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_built_in INTEGER NOT NULL DEFAULT 0,
  timeout INTEGER NOT NULL DEFAULT 30000,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  temperature REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'healthy',
  usage_requests INTEGER NOT NULL DEFAULT 0,
  usage_tokens INTEGER NOT NULL DEFAULT 0,
  usage_errors INTEGER NOT NULL DEFAULT 0,
  usage_avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt templates
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  variables_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Branding config (singleton)
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

-- Feature flags
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO feature_flags (key, value) VALUES
  ('enableResumeBuilder', 1), ('enableATSChecker', 1), ('enableOptimizer', 1),
  ('enableCoverLetter', 1), ('enableInterviewPrep', 1), ('enableJDScraper', 1),
  ('enableAIFailover', 1), ('enableDonations', 1), ('enableAds', 0), ('maintenanceMode', 0);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  details TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error'))
);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_category ON audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_logs_severity ON audit_logs(severity);
