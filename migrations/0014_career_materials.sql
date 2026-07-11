-- Migration to add career_materials table for Career RAG search
CREATE TABLE IF NOT EXISTS career_materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  category TEXT DEFAULT 'project', -- 'resume', 'cover_letter', 'certificate', 'project'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
