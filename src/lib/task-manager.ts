// ============================================================================
// Task Manager — D1-backed async task tracking (replaces Durable Objects).
//
// This module provides CRUD operations for tracking async AI/build/test/patch/
// debug jobs in D1. The frontend polls /api/tasks/:id/status every 2 seconds
// to get updates.
//
// Architecture:
//   Browser → POST /api/tasks/create → D1 INSERT (status='queued')
//   Worker runs the task → UPDATE progress/message in D1
//   Browser polls GET /api/tasks/:id/status every 2s → reads from D1
//   Polling stops when status ∈ {completed, failed, cancelled}
//
// No Durable Objects, no WebSockets, no Workers Paid Plan required.
// Works entirely on Cloudflare Free plan (Pages + Workers + D1).
// ============================================================================

// Use a generic DB type so this module can be imported from both the worker
// (where D1Database is available) and the client (where it's not).
// The worker passes the real D1Database; the client never calls these functions
// directly (it uses the HTTP API via useTaskPolling).
export interface D1Like {
  prepare(sql: string): {
    bind(...values: any[]): {
      first<T = any>(): Promise<T | null>;
      all<T = any>(): Promise<{ results: T[] }>;
      run(): Promise<any>;
    };
  };
}

export type TaskType =
  | "optimization"
  | "cover_letter"
  | "interview"
  | "jd_scrape"
  | "ats_check"
  | "ai_builder"
  | "patch_generation"
  | "build"
  | "test"
  | "autonomous_debug"
  | "repository_audit"
  | "git_operation"
  | "generic";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TaskRecord {
  id: string;
  type: TaskType | string;
  status: TaskStatus;
  progress: number;      // 0-100
  message: string | null;
  result_json: string | null;  // JSON string
  error: string | null;
  created_at: number;    // epoch ms
  updated_at: number;    // epoch ms
}

export interface CreateTaskInput {
  id?: string;
  type: TaskType | string;
  message?: string;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  progress?: number;
  message?: string;
  result?: any;          // will be JSON.stringify'd
  error?: string;
}

// ============================================================================
// D1 queries — these run in the Cloudflare Worker
// ============================================================================

/**
 * Create a new task in D1. Returns the task record.
 */
export async function createTask(db: D1Like, input: CreateTaskInput): Promise<TaskRecord> {
  const id = input.id || `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const status: TaskStatus = "queued";
  const progress = 0;
  const message = input.message || "Initializing";

  await db.prepare(
    `INSERT INTO ai_tasks (id, type, status, progress, message, result_json, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  ).bind(id, input.type, status, progress, message, now, now).run();

  return {
    id,
    type: input.type,
    status,
    progress,
    message,
    result_json: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Get a task by ID from D1.
 */
export async function getTask(db: D1Like, id: string): Promise<TaskRecord | null> {
  const row = await db.prepare(
    `SELECT id, type, status, progress, message, result_json, error, created_at, updated_at
     FROM ai_tasks WHERE id = ?`,
  ).bind(id).first<any>();

  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status as TaskStatus,
    progress: row.progress,
    message: row.message,
    result_json: row.result_json,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Get only the status fields (lighter query for polling).
 */
export async function getTaskStatus(db: D1Like, id: string): Promise<{
  id: string;
  status: TaskStatus;
  progress: number;
  message: string | null;
  error: string | null;
  updated_at: number;
} | null> {
  const row = await db.prepare(
    `SELECT id, status, progress, message, error, updated_at FROM ai_tasks WHERE id = ?`,
  ).bind(id).first<any>();

  if (!row) return null;
  return {
    id: row.id,
    status: row.status as TaskStatus,
    progress: row.progress,
    message: row.message,
    error: row.error,
    updated_at: row.updated_at,
  };
}

/**
 * Update a task in D1. Only updates the provided fields.
 */
export async function updateTask(db: D1Like, id: string, input: UpdateTaskInput): Promise<void> {
  const updates: string[] = ["updated_at = ?"];
  const values: any[] = [Date.now()];

  if (input.status !== undefined) {
    updates.push("status = ?");
    values.push(input.status);
  }
  if (input.progress !== undefined) {
    updates.push("progress = ?");
    values.push(Math.max(0, Math.min(100, input.progress)));
  }
  if (input.message !== undefined) {
    updates.push("message = ?");
    values.push(input.message);
  }
  if (input.result !== undefined) {
    updates.push("result_json = ?");
    values.push(JSON.stringify(input.result));
  }
  if (input.error !== undefined) {
    updates.push("error = ?");
    values.push(input.error);
  }

  values.push(id);
  await db.prepare(
    `UPDATE ai_tasks SET ${updates.join(", ")} WHERE id = ?`,
  ).bind(...values).run();
}

/**
 * Cancel a task (sets status to 'cancelled' if it's still queued or running).
 */
export async function cancelTask(db: D1Like, id: string): Promise<boolean> {
  const now = Date.now();
  const result = await db.prepare(
    `UPDATE ai_tasks SET status = 'cancelled', message = 'Cancelled by user', updated_at = ?
     WHERE id = ? AND status IN ('queued', 'running')`,
  ).bind(now, id).run();

  // D1 returns meta.changes = number of rows updated
  const changes = (result as any)?.meta?.changes ?? 0;
  return changes > 0;
}

/**
 * Purge completed/failed/cancelled tasks older than 30 days.
 * Called by a scheduled cleanup (or manually).
 */
export async function purgeOldTasks(db: D1Like, maxAgeDays = 30): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = await db.prepare(
    `DELETE FROM ai_tasks
     WHERE status IN ('completed', 'failed', 'cancelled')
       AND created_at < ?`,
  ).bind(cutoff).run();

  const changes = (result as any)?.meta?.changes ?? 0;
  return changes;
}

/**
 * List recent tasks (for the admin dashboard).
 */
export async function listRecentTasks(
  db: D1Like,
  limit = 50,
  statusFilter?: TaskStatus,
): Promise<TaskRecord[]> {
  const sql = statusFilter
    ? `SELECT id, type, status, progress, message, result_json, error, created_at, updated_at
       FROM ai_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT id, type, status, progress, message, result_json, error, created_at, updated_at
       FROM ai_tasks ORDER BY created_at DESC LIMIT ?`;

  const stmt = statusFilter
    ? db.prepare(sql).bind(statusFilter, limit)
    : db.prepare(sql).bind(limit);

  const { results } = await stmt.all<any>();
  return (results || []).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status as TaskStatus,
    progress: row.progress,
    message: row.message,
    result_json: row.result_json,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

// ============================================================================
// Progress milestones (spec: 0, 10, 25, 50, 75, 100)
// ============================================================================

export const PROGRESS_MILESTONES = {
  INITIALIZING: { progress: 0, message: "Initializing" },
  READING_REPOSITORY: { progress: 10, message: "Reading Repository" },
  ANALYZING: { progress: 25, message: "Analyzing" },
  GENERATING_PATCH: { progress: 50, message: "Generating Patch" },
  RUNNING_TESTS: { progress: 75, message: "Running Tests" },
  BUILDING: { progress: 75, message: "Building Application" },
  COMPLETED: { progress: 100, message: "Completed" },
} as const;

/**
 * Helper: set a progress milestone on a task.
 */
export async function setProgress(
  db: D1Like,
  taskId: string,
  milestone: keyof typeof PROGRESS_MILESTONES,
  status: TaskStatus = "running",
): Promise<void> {
  const m = PROGRESS_MILESTONES[milestone];
  await updateTask(db, taskId, {
    status,
    progress: m.progress,
    message: m.message,
  });
}

// ============================================================================
// Terminal status check (for polling auto-stop)
// ============================================================================

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
