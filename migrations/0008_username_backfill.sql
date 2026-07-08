-- Migration 0008: Backfill username column in ai_tasks (D1 nullable field crash fix)
--
-- This migration adds the username column to ai_tasks for databases that
-- already ran 0007_task_tracking.sql before the fix was applied.
-- The 0007 migration was updated to include username NOT NULL DEFAULT 'anonymous'
-- for fresh deployments; this migration handles existing tables.
--
-- SQLite / D1: ALTER TABLE ... ADD COLUMN only supports adding a column with
-- a DEFAULT value (NOT NULL constraint requires DEFAULT in SQLite).

ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT 'anonymous';
