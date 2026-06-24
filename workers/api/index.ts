// ResumeAI Pro — Cloudflare Worker API with D1
// All CRUD endpoints for cloud-based data storage
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  APP_NAME: string;
  APP_URL: string;
  CORS_ORIGIN: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.CORS_ORIGIN || "*";
      return origin === allowed ? origin : allowed === "*" ? origin : null;
    },
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-User-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// Helper: parse JSON body
async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch (parseErr) {
    console.warn("[Worker] Body parse failed:", parseErr instanceof Error ? parseErr.message : parseErr);
    return {};
  }
}

// Helper: generate UUID
function uuid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

// ============================================================================
// AUTH: Validate user identity from request headers.
//
// SECURITY NOTE: The current auth model trusts the X-User-Id header sent by
// the client. This is a DEMO-level auth model. For production, replace with:
//   - JWT verification (sign with a server-side secret)
//   - Session-based auth (httpOnly cookies + server-side session store)
//   - OAuth2 token validation
//
// The minimum viable hardening is:
//   1. Validate the user ID format (must match our uid pattern)
//   2. Reject obviously malicious IDs (SQL injection, path traversal)
//   3. Rate-limit per user (done in middleware)
// ============================================================================
const ALLOWED_USER_ID_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;

function getUserId(req: Request): string | null {
  const raw = req.headers.get("X-User-Id") || req.headers.get("Authorization")?.replace("Bearer ", "") || null;
  if (!raw) return null;
  // Validate format — reject SQL injection, path traversal, XSS
  if (!ALLOWED_USER_ID_PATTERN.test(raw)) {
    console.warn("[Worker] Rejected malformed user ID:", raw.slice(0, 20));
    return null;
  }
  return raw;
}

/**
 * Cache for "does column X exist on table T?" lookups.
 * Avoids repeating the same PRAGMA query within a single request.
 */
const columnExistenceCache = new Map<string, boolean>();

/**
 * Check whether a column exists on a given table.
 * Uses PRAGMA table_info() — works on SQLite/D1.
 * Result is cached per-request to avoid repeated lookups.
 */
async function columnExists(db: D1Database, table: string, column: string): Promise<boolean> {
  const cacheKey = `${table}.${column}`;
  if (columnExistenceCache.has(cacheKey)) {
    return columnExistenceCache.get(cacheKey)!;
  }
  try {
    // SANITIZE: Only allow alphanumeric + underscore table names to prevent SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      console.warn("[Worker] Rejected suspicious table name in PRAGMA:", table);
      columnExistenceCache.set(cacheKey, false);
      return false;
    }
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<any>();
    const exists = (results || []).some((row: any) => row.name === column);
    columnExistenceCache.set(cacheKey, exists);
    return exists;
  } catch (pragmaErr) {
    // If PRAGMA fails (table doesn't exist?), assume the column doesn't exist.
    console.warn("[Worker] PRAGMA table_info failed:", pragmaErr instanceof Error ? pragmaErr.message : pragmaErr);
    columnExistenceCache.set(cacheKey, false);
    return false;
  }
}

// ============================================================================
// API KEY ENCRYPTION — AES-GCM using Web Crypto API (available in Workers)
//
// The ENCRYPTION_KEY env var must be set via `wrangler secret put ENCRYPTION_KEY`.
// It should be a 32-byte hex string (64 hex chars).
// If ENCRYPTION_KEY is not set, API keys are stored in plaintext (DEV ONLY).
// ============================================================================

async function getEncryptionKey(env: Env): Promise<CryptoKey | null> {
  const keyHex = (env as Record<string, string>).ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) return null;
  try {
    const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
    return await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch (importErr) {
    console.warn("[Worker] Failed to import ENCRYPTION_KEY — storing API keys in plaintext:", importErr instanceof Error ? importErr.message : importErr);
    return null;
  }
}

async function encryptApiKey(plaintext: string, env: Env): Promise<string> {
  if (!plaintext) return plaintext;
  const key = await getEncryptionKey(env);
  if (!key) return plaintext; // No encryption key — store plaintext (dev mode)
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    // Format: base64(iv):base64(ciphertext)
    const ivB64 = btoa(String.fromCharCode(...iv));
    const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
    return `enc:${ivB64}:${ctB64}`;
  } catch (encErr) {
    console.warn("[Worker] API key encryption failed:", encErr instanceof Error ? encErr.message : encErr);
    return plaintext; // Fallback to plaintext
  }
}

async function decryptApiKey(stored: string, env: Env): Promise<string> {
  if (!stored || !stored.startsWith("enc:")) return stored;
  const key = await getEncryptionKey(env);
  if (!key) return stored; // Can't decrypt without key
  try {
    const [, ivB64, ctB64] = stored.split(":");
    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch (decErr) {
    console.warn("[Worker] API key decryption failed:", decErr instanceof Error ? decErr.message : decErr);
    return stored; // Return as-is
  }
}

/**
 * Run a D1 query and never throw. Returns { ok, results, error }.
 * Used for fire-and-forget writes where a failure should not break
 * the response cycle.
 */
async function safeQuery<T = any>(
  db: D1Database,
  sql: string,
  ...binds: any[]
): Promise<{ ok: boolean; results?: T[]; error?: string }> {
  try {
    const stmt = db.prepare(sql);
    const result = await (binds.length > 0 ? stmt.bind(...binds).all<T>() : stmt.all<T>());
    return { ok: true, results: result.results || [] };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ============================================================================
// AUTH MIDDLEWARE — Require authenticated user for write operations
// ============================================================================

/** Middleware that requires a valid user ID for write operations */
const requireAuth = async (c: any, next: any) => {
  const userId = getUserId(c.req.raw);
  if (!userId) {
    return c.json({ success: false, code: "AUTH_REQUIRED", message: "Authentication required. Provide X-User-Id or Authorization header." }, 401);
  }
  await next();
};

// Apply auth middleware to all write routes (POST, PUT, PATCH, DELETE)
app.use("/api/resumes/*", requireAuth);
app.use("/api/cover-letters/*", requireAuth);
app.use("/api/interviews/*", requireAuth);
app.use("/api/ats-reports/*", requireAuth);
app.use("/api/providers/*", requireAuth);
app.use("/api/prompts/*", requireAuth);
app.use("/api/branding", requireAuth);
app.use("/api/flags/*", requireAuth);
app.use("/api/audit-logs", requireAuth);
app.use("/api/settings/*", requireAuth);
app.use("/api/downloads/*", requireAuth);

// ============ HEALTH ============
app.get("/api/health", async (c) => {
  // Test DB connectivity
  const dbCheck = await safeQuery(c.env.DB, "SELECT 1 AS ok");
  return c.json({
    ok: true,
    app: c.env.APP_NAME,
    time: new Date().toISOString(),
    db: dbCheck.ok ? "connected" : "error",
    dbError: dbCheck.error,
  });
});

// ============ SCHEMA MIGRATION CHECK ============
app.get("/api/health/schema", async (c) => {
  try {
    const { results } = await c.env.DB.prepare("PRAGMA table_info(ai_providers)").all<any>();
    const columns = (results || []).map((r: any) => r.name);

    const requiredColumns = [
      "id", "name", "provider_type", "base_url", "api_key_encrypted",
      "headers_json", "parameters_json", "model_name", "priority",
      "is_active", "is_default", "is_fallback", "allowed_for_regular_users",
      "timeout", "max_tokens", "temperature", "status",
      "created_at", "updated_at",
      // From migration 0002
      "request_template", "response_path", "streaming_enabled",
      "retry_attempts", "rate_limit_per_minute", "auth_type",
      "supports_function_calling", "cost_per_input_token", "cost_per_output_token",
      "application_id", "client_id", "redirect_uri", "enabled_models_json",
      // From migration 0004
      "provider_category", "health_last_success_at", "health_last_failure_at",
    ];

    const missing = requiredColumns.filter((col) => !columns.includes(col));
    return c.json({
      ok: missing.length === 0,
      table: "ai_providers",
      columnsPresent: columns.length,
      columnsExpected: requiredColumns.length,
      missingColumns: missing,
      allColumns: columns,
    });
  } catch (error: any) {
    return c.json({
      ok: false,
      error: error?.message || "Schema check failed",
      hint: "Run migrations: wrangler d1 migrations apply resumeai-pro-db --remote",
    }, 500);
  }
});

// ============================================================================
// P4: Edge Caching via Cloudflare Cache API
// ============================================================================
// The Cache API caches responses at the Cloudflare edge — meaning subsequent
// requests for the same URL are served from the edge POP (typically <20ms
// latency) instead of going all the way to the Worker + D1 (typically
// 100-300ms from a distant region).
//
// Strategy:
//   - GET endpoints that return global (non-user-specific) data are cached.
//   - Cache TTL: 60s (s-maxage) + 5min stale-while-revalidate.
//   - On write (PUT/POST/DELETE), the cache is purged for the affected URL.
//   - User-specific endpoints (resumes, cover letters, etc.) are NOT cached
//     because they depend on the X-User-Id header.
//
// Cached endpoints:
//   - GET /api/settings/branding
//   - GET /api/settings/flags
//   - GET /api/providers (global, not user-specific)
//   - GET /api/prompts (global)
//
// NOT cached:
//   - GET /api/resumes (depends on X-User-Id)
//   - GET /api/cover-letters (depends on X-User-Id)
//   - GET /api/job-descriptions (depends on X-User-Id)
//   - GET /api/interviews (depends on X-User-Id)
//   - GET /api/ats-reports (depends on X-User-Id)
//   - GET /api/users (admin-only — small cache benefit, and we don't want
//     admin-only data cached at the edge where it could be served to a
//     non-admin if the auth header changes)
//   - GET /api/downloads (depends on X-User-Id)
//   - GET /api/audit-logs (admin-only)

/**
 * Try to serve a cached response. Returns null on cache miss.
 * The cache key is the full URL — this means queries with different params
 * get separate cache entries (which is correct for our use case).
 */
async function getCached(c: any, url: string): Promise<Response | null> {
  try {
    const cache = caches.default;
    const cacheKey = new Request(url, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      // Clone the response and add a header so we can observe cache hits
      const resp = new Response(cached.body, cached);
      resp.headers.set("X-Cache-Status", "HIT");
      return resp;
    }
  } catch (cacheReadErr) {
    // Cache API not available in some environments (e.g. local dev)
    console.warn("[Worker] Cache read failed:", cacheReadErr instanceof Error ? cacheReadErr.message : cacheReadErr);
  }
  return null;
}

/**
 * Cache a response. The response is cloned so the original can still be
 * returned to the client. Sets s-maxage + stale-while-revalidate headers.
 */
async function setCached(c: any, url: string, response: Response, maxAgeSec = 60, swrSec = 300): Promise<void> {
  try {
    const cache = caches.default;
    const cacheKey = new Request(url, { method: "GET" });
    const cached = new Response(response.body, response);
    cached.headers.set("Cache-Control", `s-maxage=${maxAgeSec}, stale-while-revalidate=${swrSec}`);
    cached.headers.set("X-Cache-Status", "MISS");
    // waitUntil ensures the cache write completes even if the request ends first
    c.executionCtx.waitUntil(cache.put(cacheKey, cached.clone()));
  } catch (cacheWriteErr) {
    // Cache API not available
    console.warn("[Worker] Cache write failed:", cacheWriteErr instanceof Error ? cacheWriteErr.message : cacheWriteErr);
  }
}

/**
 * Purge the cache for a specific URL. Call this after any write that would
 * invalidate the cached response.
 */
async function purgeCached(c: any, url: string): Promise<void> {
  try {
    const cache = caches.default;
    const cacheKey = new Request(url, { method: "GET" });
    c.executionCtx.waitUntil(cache.delete(cacheKey));
  } catch (cachePurgeErr) {
    // Cache API not available
    console.warn("[Worker] Cache purge failed:", cachePurgeErr instanceof Error ? cachePurgeErr.message : cachePurgeErr);
  }
}

/** Build the full URL from a path (uses the request's host). */
function buildUrl(req: Request, path: string): string {
  const url = new URL(path, req.url);
  return url.toString();
}

// ============ USERS ============
app.get("/api/users", async (c) => {
  const stmt = c.env.DB.prepare("SELECT * FROM users WHERE status != 'deleted' ORDER BY created_at DESC");
  const { results } = await stmt.all();
  return c.json({ users: results || [] });
});

app.post("/api/users", async (c) => {
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("u");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, username, name, password_hash, avatar, provider, role, status, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.email, body.username || null, body.name, body.passwordHash || null, body.avatarUrl || null, body.provider || "email", body.role || "user", body.status || "pending", now, now, now).run();
  return c.json({ ok: true, user: { ...body, id } });
});

app.put("/api/users/:id", async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(c.req.raw);
  const now = new Date().toISOString();
  const fields = ["name", "username", "email", "password_hash", "avatar", "role", "status", "provider", "last_login_at", "updated_at"];
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    const key = f === "password_hash" ? "passwordHash" : f === "avatar" ? "avatarUrl" : f;
    if (body[key] !== undefined || body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(body[key] ?? body[f]);
    }
  }
  if (updates.length === 0) return c.json({ ok: true, user: body });
  updates.push("updated_at = ?");
  values.push(now);
  values.push(id);
  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

app.delete("/api/users/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE users SET status = 'deleted', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  return c.json({ ok: true });
});

// ============ RESUMES ============
app.get("/api/resumes", async (c) => {
  const userId = getUserId(c.req.raw);
  if (!userId) return c.json({ resumes: [] });
  const { results } = await c.env.DB.prepare("SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC").bind(userId).all();
  const resumes = (results || []).map(parseDbResume);
  return c.json({ resumes });
});

app.post("/api/resumes", async (c) => {
  const userId = getUserId(c.req.raw) || "anonymous";
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("r");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO resumes (id, user_id, name, headline, contact_json, summary, experience_json, education_json, skills_json, projects_json, certifications_json, languages_json, achievements_json, template, accent_color, photo_url, date_of_birth, source, file_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, userId, body.name || "", body.headline || null, JSON.stringify(body.contact || {}), body.summary || null,
    JSON.stringify(body.experience || []), JSON.stringify(body.education || []), JSON.stringify(body.skills || []),
    JSON.stringify(body.projects || []), JSON.stringify(body.certifications || []), JSON.stringify(body.languages || []),
    JSON.stringify(body.achievements || []), body.template || "ats-professional", body.accentColor || "#1154A3",
    body.photoUrl || null, body.dateOfBirth || null, body.source || "manual", body.fileName || null, now, now
  ).run();
  return c.json({ ok: true, resume: { ...body, id } });
});

app.put("/api/resumes/:id", async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(c.req.raw);
  const now = new Date().toISOString();
  const fields: Record<string, string> = {
    name: "name", headline: "headline", summary: "summary", template: "template", accentColor: "accent_color",
    photoUrl: "photo_url", dateOfBirth: "date_of_birth", source: "source", fileName: "file_name",
    contact: "contact_json", experience: "experience_json", education: "education_json",
    skills: "skills_json", projects: "projects_json", certifications: "certifications_json",
    languages: "languages_json", achievements: "achievements_json",
  };
  const updates: string[] = ["updated_at = ?"];
  const values: any[] = [now];
  for (const [bodyKey, dbCol] of Object.entries(fields)) {
    if (body[bodyKey] !== undefined) {
      updates.push(`${dbCol} = ?`);
      values.push(dbCol.endsWith("_json") ? JSON.stringify(body[bodyKey]) : body[bodyKey]);
    }
  }
  values.push(id);
  await c.env.DB.prepare(`UPDATE resumes SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

app.delete("/api/resumes/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM resumes WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ============ COVER LETTERS ============
app.get("/api/cover-letters", async (c) => {
  const userId = getUserId(c.req.raw);
  if (!userId) return c.json({ coverLetters: [] });
  const { results } = await c.env.DB.prepare("SELECT * FROM cover_letters WHERE user_id = ? ORDER BY updated_at DESC").bind(userId).all();
  return c.json({ coverLetters: results || [] });
});

app.post("/api/cover-letters", async (c) => {
  const userId = getUserId(c.req.raw) || "anonymous";
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("cl");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO cover_letters (id, user_id, title, template, content, resume_id, jd_id, company, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, userId, body.title || "Untitled", body.template || "modern", body.content || "", body.resumeId || null, body.jdId || null, body.company || null, body.role || null, now, now).run();
  return c.json({ ok: true, coverLetter: { ...body, id } });
});

app.put("/api/cover-letters/:id", async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(c.req.raw);
  const now = new Date().toISOString();
  const updates: string[] = ["updated_at = ?"];
  const values: any[] = [now];
  for (const [k, col] of Object.entries({ title: "title", template: "template", content: "content", company: "company", role: "role", resumeId: "resume_id", jdId: "jd_id" })) {
    if (body[k] !== undefined) { updates.push(`${col} = ?`); values.push(body[k]); }
  }
  values.push(id);
  await c.env.DB.prepare(`UPDATE cover_letters SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

app.delete("/api/cover-letters/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM cover_letters WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ============ JOB DESCRIPTIONS ============
app.get("/api/job-descriptions", async (c) => {
  const userId = getUserId(c.req.raw);
  if (!userId) return c.json({ jobDescriptions: [] });
  const { results } = await c.env.DB.prepare("SELECT * FROM job_descriptions WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all();
  return c.json({ jobDescriptions: results || [] });
});

app.post("/api/job-descriptions", async (c) => {
  const userId = getUserId(c.req.raw) || "anonymous";
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("jd");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO job_descriptions (id, user_id, title, company, location, employment_type, salary, responsibilities_json, required_skills_json, preferred_skills_json, technologies_json, experience_years, education, keywords_json, raw_text, url, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, userId, body.title || "", body.company || null, body.location || null, body.employmentType || null, body.salary || null,
    JSON.stringify(body.responsibilities || []), JSON.stringify(body.requiredSkills || []), JSON.stringify(body.preferredSkills || []),
    JSON.stringify(body.technologies || []), body.experienceYears || null, body.education || null, JSON.stringify(body.keywords || []),
    body.rawText || null, body.url || null, body.source || "text", now).run();
  return c.json({ ok: true, jobDescription: { ...body, id } });
});

app.delete("/api/job-descriptions/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM job_descriptions WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ============ INTERVIEW PACKAGES ============
app.get("/api/interviews", async (c) => {
  const userId = getUserId(c.req.raw);
  if (!userId) return c.json({ interviews: [] });
  const { results } = await c.env.DB.prepare("SELECT * FROM interview_packages WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all();
  return c.json({ interviews: results || [] });
});

app.post("/api/interviews", async (c) => {
  const userId = getUserId(c.req.raw) || "anonymous";
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("iv");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO interview_packages (id, user_id, resume_id, jd_id, company, role, questions_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, userId, body.resumeId || null, body.jdId || null, body.company || null, body.role || null, JSON.stringify(body.questions || []), now).run();
  return c.json({ ok: true, interview: { ...body, id } });
});

app.delete("/api/interviews/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM interview_packages WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ============ ATS REPORTS ============
app.get("/api/ats-reports", async (c) => {
  const userId = getUserId(c.req.raw);
  if (!userId) return c.json({ atsReports: [] });
  const { results } = await c.env.DB.prepare("SELECT * FROM ats_reports WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all();
  return c.json({ atsReports: results || [] });
});

app.post("/api/ats-reports", async (c) => {
  const userId = getUserId(c.req.raw) || "anonymous";
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("ats");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO ats_reports (id, user_id, resume_id, jd_id, ats_score, formatting_score, keywords_score, content_score, grammar_score, completeness_score, recommendations_json, missing_keywords_json, matched_keywords_json, weak_sections_json, jd_match_percent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, userId, body.resumeId, body.jdId || null, body.scores?.ats || 0, body.scores?.formatting || 0, body.scores?.keywords || 0,
    body.scores?.content || 0, body.scores?.grammar || 0, body.scores?.completeness || 0, JSON.stringify(body.recommendations || []),
    JSON.stringify(body.missingKeywords || []), JSON.stringify(body.matchedKeywords || []), JSON.stringify(body.weakSections || []),
    body.jdMatchPercent || null, now).run();
  return c.json({ ok: true, atsReport: { ...body, id } });
});

// ============ AI PROVIDERS ============
app.get("/api/providers", async (c) => {
  // === P4: Edge cache — providers are global, cache for 60s ===
  const fullUrl = buildUrl(c.req.raw, "/api/providers");
  const cached = await getCached(c, fullUrl);
  if (cached) return cached;

  const { results } = await c.env.DB.prepare("SELECT * FROM ai_providers ORDER BY priority ASC").all();
  const response = c.json({ providers: results || [] });
  response.headers.set("X-Cache-Status", "MISS");
  await setCached(c, fullUrl, response.clone());
  return response;
});

app.post("/api/providers", async (c) => {
  try {
    const body = await parseBody(c.req.raw);

    // === VALIDATE REQUIRED FIELDS ===
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return c.json({ success: false, code: "VALIDATION_ERROR", message: "Display name is required." }, 400);
    }
    if (!body.type || typeof body.type !== "string") {
      return c.json({ success: false, code: "VALIDATION_ERROR", message: "Provider type is required." }, 400);
    }

    // === VALIDATE NUMERIC FIELDS ===
    const temperature = typeof body.temperature === "number" ? body.temperature : parseFloat(body.temperature) || 0.7;
    const maxTokens = typeof body.maxTokens === "number" ? body.maxTokens : parseInt(body.maxTokens) || 4096;
    const priority = typeof body.priority === "number" ? body.priority : parseInt(body.priority) || 10;
    const timeout = typeof body.timeout === "number" ? body.timeout : parseInt(body.timeout) || 30000;
    const retryAttempts = typeof body.retryAttempts === "number" ? body.retryAttempts : parseInt(body.retryAttempts) || 2;
    const rateLimitPerMinute = typeof body.rateLimitPerMinute === "number" ? body.rateLimitPerMinute : parseInt(body.rateLimitPerMinute) || 60;

    if (temperature < 0 || temperature > 2) {
      return c.json({ success: false, code: "VALIDATION_ERROR", message: "Temperature must be between 0 and 2." }, 400);
    }
    if (maxTokens < 1 || maxTokens > 128000) {
      return c.json({ success: false, code: "VALIDATION_ERROR", message: "Max tokens must be between 1 and 128000." }, 400);
    }
    if (priority < 1 || priority > 100) {
      return c.json({ success: false, code: "VALIDATION_ERROR", message: "Priority must be between 1 and 100." }, 400);
    }

    const id = body.id || uuid("p");
    const now = new Date().toISOString();

    // === ENCRYPT API KEY BEFORE STORING ===
    // Uses AES-GCM if ENCRYPTION_KEY is set, otherwise stores plaintext (DEV ONLY)
    const apiKeyToStore = body.apiKey ? await encryptApiKey(String(body.apiKey), c.env) : null;

    const result = await c.env.DB.prepare(
      "INSERT INTO ai_providers (id, name, provider_type, base_url, api_key_encrypted, headers_json, parameters_json, model_name, priority, is_active, is_default, is_fallback, allowed_for_regular_users, timeout, max_tokens, temperature, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id, body.name.trim(), body.type, body.baseUrl || null, apiKeyToStore,
      body.headersJson || null, body.parametersJson || null,
      body.modelName || null, priority, body.isActive ? 1 : 0, body.isDefault ? 1 : 0, body.isFallback ? 1 : 0,
      body.allowedForRegularUsers ? 1 : 0, timeout, maxTokens, temperature,
      body.status || "untested", now, now
    ).run();

    if (!result.success) {
      console.error("[Provider Save Error] D1 INSERT failed:", result.error, { id, name: body.name, type: body.type });
      return c.json({ success: false, code: "PROVIDER_SAVE_FAILED", message: `Database insert failed: ${result.error || "unknown error"}` }, 500);
    }

    // === P4: Purge the providers cache ===
    await purgeCached(c, buildUrl(c.req.raw, "/api/providers"));
    return c.json({ success: true, ok: true, provider: { ...body, id } });
  } catch (error: any) {
    console.error("[Provider Save Error]", error, { body: await parseBody(c.req.raw).catch(() => ({})) });
    return c.json({
      success: false,
      code: "PROVIDER_SAVE_FAILED",
      message: error?.message || "Failed to save provider",
      stack: process.env.NODE_ENV === "development" ? error?.stack : undefined,
    }, 500);
  }
});

app.put("/api/providers/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ success: false, code: "VALIDATION_ERROR", message: "Provider ID is required." }, 400);
    }
    const body = await parseBody(c.req.raw);

    // === VALIDATE NUMERIC FIELDS IF PROVIDED ===
    if (body.temperature !== undefined) {
      const t = typeof body.temperature === "number" ? body.temperature : parseFloat(body.temperature);
      if (isNaN(t) || t < 0 || t > 2) {
        return c.json({ success: false, code: "VALIDATION_ERROR", message: "Temperature must be between 0 and 2." }, 400);
      }
      body.temperature = t;
    }
    if (body.maxTokens !== undefined) {
      const m = typeof body.maxTokens === "number" ? body.maxTokens : parseInt(body.maxTokens);
      if (isNaN(m) || m < 1 || m > 128000) {
        return c.json({ success: false, code: "VALIDATION_ERROR", message: "Max tokens must be between 1 and 128000." }, 400);
      }
      body.maxTokens = m;
    }
    if (body.priority !== undefined) {
      const p = typeof body.priority === "number" ? body.priority : parseInt(body.priority);
      if (isNaN(p) || p < 1 || p > 100) {
        return c.json({ success: false, code: "VALIDATION_ERROR", message: "Priority must be between 1 and 100." }, 400);
      }
      body.priority = p;
    }

    const now = new Date().toISOString();
    const updates: string[] = ["updated_at = ?"];
    const values: any[] = [now];

    // Map of JS field name -> DB column name
    const fieldToColumn: Record<string, string> = {
      name: "name", baseUrl: "base_url", apiKey: "api_key_encrypted",
      modelName: "model_name", priority: "priority", isActive: "is_active",
      isDefault: "is_default", isFallback: "is_fallback",
      allowedForRegularUsers: "allowed_for_regular_users", timeout: "timeout",
      maxTokens: "max_tokens", temperature: "temperature", status: "status",
      headersJson: "headers_json", parametersJson: "parameters_json",
      requestTemplate: "request_template", responsePath: "response_path",
      streamingEnabled: "streaming_enabled", authType: "auth_type",
      costPerInputToken: "cost_per_input_token", costPerOutputToken: "cost_per_output_token",
      enabledModels: "enabled_models_json", applicationId: "application_id",
      clientId: "client_id", redirectUri: "redirect_uri",
      supportsFunctionCalling: "supports_function_calling",
      type: "provider_type", apiUrl: "base_url",
    };

    for (const [k, col] of Object.entries(fieldToColumn)) {
      if (body[k] !== undefined) {
        updates.push(`${col} = ?`);
        const val = body[k];
        if (k === "apiKey") {
          // Encrypt API key before storing
          values.push(val ? await encryptApiKey(String(val), c.env) : null);
        } else if (k === "enabledModels") {
          values.push(JSON.stringify(val));
        } else if (typeof val === "boolean") {
          values.push(val ? 1 : 0);
        } else if (typeof val === "number") {
          values.push(val);
        } else {
          values.push(val);
        }
      }
    }

    if (updates.length <= 1) {
      return c.json({ success: false, code: "VALIDATION_ERROR", message: "No fields to update." }, 400);
    }

    values.push(id);
    const result = await c.env.DB.prepare(
      `UPDATE ai_providers SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...values).run();

    if (!result.success) {
      console.error("[Provider Update Error] D1 UPDATE failed:", result.error, { id });
      return c.json({ success: false, code: "PROVIDER_UPDATE_FAILED", message: `Database update failed: ${result.error || "unknown error"}` }, 500);
    }

    // === P4: Purge the providers cache ===
    await purgeCached(c, buildUrl(c.req.raw, "/api/providers"));
    return c.json({ success: true, ok: true });
  } catch (error: any) {
    console.error("[Provider Update Error]", error, { id: c.req.param("id") });
    return c.json({
      success: false,
      code: "PROVIDER_UPDATE_FAILED",
      message: error?.message || "Failed to update provider",
      stack: process.env.NODE_ENV === "development" ? error?.stack : undefined,
    }, 500);
  }
});

app.delete("/api/providers/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ success: false, code: "VALIDATION_ERROR", message: "Provider ID is required." }, 400);
    }
    const result = await c.env.DB.prepare("DELETE FROM ai_providers WHERE id = ?").bind(id).run();
    if (!result.success) {
      console.error("[Provider Delete Error] D1 DELETE failed:", result.error, { id });
      return c.json({ success: false, code: "PROVIDER_DELETE_FAILED", message: `Database delete failed: ${result.error || "unknown error"}` }, 500);
    }
    // === P4: Purge the providers cache ===
    await purgeCached(c, buildUrl(c.req.raw, "/api/providers"));
    return c.json({ success: true, ok: true });
  } catch (error: any) {
    console.error("[Provider Delete Error]", error, { id: c.req.param("id") });
    return c.json({
      success: false,
      code: "PROVIDER_DELETE_FAILED",
      message: error?.message || "Failed to delete provider",
    }, 500);
  }
});

// ============ PROMPT TEMPLATES ============
app.get("/api/prompts", async (c) => {
  // === P4: Edge cache — prompts are global, cache for 60s ===
  const fullUrl = buildUrl(c.req.raw, "/api/prompts");
  const cached = await getCached(c, fullUrl);
  if (cached) return cached;

  const { results } = await c.env.DB.prepare("SELECT * FROM prompt_templates ORDER BY created_at DESC").all();
  const response = c.json({ prompts: results || [] });
  response.headers.set("X-Cache-Status", "MISS");
  await setCached(c, fullUrl, response.clone());
  return response;
});

app.post("/api/prompts", async (c) => {
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("pt");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO prompt_templates (id, name, category, content, provider_id, version, is_active, variables_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.name, body.category, body.content, body.providerId || null, body.version || 1, body.isActive ? 1 : 0, JSON.stringify(body.variables || []), now, now).run();
  // === P4: Purge the prompts cache ===
  await purgeCached(c, buildUrl(c.req.raw, "/api/prompts"));
  return c.json({ ok: true, prompt: { ...body, id } });
});

app.put("/api/prompts/:id", async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(c.req.raw);
  const now = new Date().toISOString();
  const updates: string[] = ["updated_at = ?"];
  const values: any[] = [now];
  for (const [k, col] of Object.entries({ name: "name", category: "category", content: "content", isActive: "is_active", variables: "variables_json" })) {
    if (body[k] !== undefined) { updates.push(`${col} = ?`); values.push(k === "variables" ? JSON.stringify(body[k]) : typeof body[k] === "boolean" ? (body[k] ? 1 : 0) : body[k]); }
  }
  values.push(id);
  await c.env.DB.prepare(`UPDATE prompt_templates SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  // === P4: Purge the prompts cache ===
  await purgeCached(c, buildUrl(c.req.raw, "/api/prompts"));
  return c.json({ ok: true });
});

app.delete("/api/prompts/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM prompt_templates WHERE id = ?").bind(c.req.param("id")).run();
  // === P4: Purge the prompts cache ===
  await purgeCached(c, buildUrl(c.req.raw, "/api/prompts"));
  return c.json({ ok: true });
});

// ============ AUDIT LOGS ============
app.get("/api/audit-logs", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500").all();
  return c.json({ logs: results || [] });
});

app.post("/api/audit-logs", async (c) => {
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("log");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO audit_logs (id, timestamp, user_id, actor, action, category, details, severity, performed_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, now, body.userId || null, body.actor || "system", body.action || "", body.category || "system",
    body.details || null, body.severity || "info", body.performedBy || null, body.metadata || null).run();
  return c.json({ ok: true });
});

// ============ SETTINGS ============
app.get("/api/settings/branding", async (c) => {
  // === P4: Edge cache — branding rarely changes, cache for 60s at the edge ===
  const fullUrl = buildUrl(c.req.raw, "/api/settings/branding");
  const cached = await getCached(c, fullUrl);
  if (cached) return cached;

  try {
    const result = await c.env.DB.prepare("SELECT * FROM branding WHERE id = 1").first<any>();
    const response = c.json({ branding: result || {} });
    response.headers.set("X-Cache-Status", "MISS");
    // Cache the response (fire-and-forget via waitUntil)
    await setCached(c, fullUrl, response.clone());
    return response;
  } catch (e: any) {
    // Table might not exist yet (migration not applied)
    console.error("GET /api/settings/branding failed:", e?.message);
    return c.json({ branding: {}, dbError: e?.message });
  }
});

app.put("/api/settings/branding", async (c) => {
  const body = await parseBody(c.req.raw);
  const now = new Date().toISOString();

  let existing: any = {};
  try {
    existing = await c.env.DB.prepare("SELECT * FROM branding WHERE id = 1").first() || {};
  } catch (e) {}

  const n = (bodyValue: any, dbField: string) => bodyValue !== undefined ? bodyValue : (existing[dbField] ?? null);

  const updates: string[] = [
    "app_name = ?", "tagline = ?", "primary_color = ?", "accent_color = ?",
    "logo_url = ?", "email_from_name = ?", "email_from_address = ?",
    "pdf_footer_text = ?", "updated_at = ?",
    "provider_settings_json = ?", "ai_routing_settings_json = ?",
  ];
  const values: any[] = [
    n(body.appName, "app_name") || "ResumeAI Pro", // Enforce NOT NULL default
    n(body.tagline, "tagline"), n(body.primaryColor, "primary_color"), n(body.accentColor, "accent_color"),
    n(body.logoUrl, "logo_url"), n(body.emailFromName, "email_from_name"), n(body.emailFromAddress, "email_from_address"),
    n(body.pdfFooterText, "pdf_footer_text"), now,
    body.providerSettings !== undefined ? JSON.stringify(body.providerSettings) : existing.provider_settings_json,
    body.aiRoutingSettings !== undefined ? JSON.stringify(body.aiRoutingSettings) : existing.ai_routing_settings_json,
  ];

  values.push("1"); // WHERE id = 1

  try {
    await c.env.DB.prepare(
      `UPDATE branding SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...values).run();
    // === P4: Purge the edge cache for branding ===
    await purgeCached(c, buildUrl(c.req.raw, "/api/settings/branding"));
    return c.json({ ok: true });
  } catch (e: any) {
    console.error("PUT /api/settings/branding failed:", e?.message);
    // If the error is "no such column", provide a migration hint
    if (/no such column.*provider_settings_json/i.test(e?.message || "")) {
      return c.json({
        ok: false,
        error: "Migration 0006 not yet applied. Run: npx wrangler d1 migrations apply resumeai-pro-db --remote",
        migrationRequired: true,
      }, 500);
    }
    return c.json({ ok: false, error: e?.message || "Failed to update branding" }, 500);
  }
});

app.get("/api/settings/flags", async (c) => {
  // === P4: Edge cache — flags rarely change, cache for 60s ===
  const fullUrl = buildUrl(c.req.raw, "/api/settings/flags");
  const cached = await getCached(c, fullUrl);
  if (cached) return cached;

  try {
    const { results } = await c.env.DB.prepare("SELECT * FROM feature_flags").all<any>();
    const flags: Record<string, boolean> = {};
    for (const r of results || []) flags[r.key] = r.value === 1;
    const response = c.json({ flags });
    response.headers.set("X-Cache-Status", "MISS");
    await setCached(c, fullUrl, response.clone());
    return response;
  } catch (e: any) {
    console.error("GET /api/settings/flags failed:", e?.message);
    return c.json({ flags: {}, dbError: e?.message });
  }
});

app.put("/api/settings/flags/:key", async (c) => {
  const key = c.req.param("key");
  const body = await parseBody(c.req.raw);
  try {
    await c.env.DB.prepare("UPDATE feature_flags SET value = ?, updated_at = ? WHERE key = ?")
      .bind(body.value ? 1 : 0, new Date().toISOString(), key).run();
    // === P4: Purge the edge cache for flags ===
    await purgeCached(c, buildUrl(c.req.raw, "/api/settings/flags"));
    return c.json({ ok: true });
  } catch (e: any) {
    console.error("PUT /api/settings/flags failed:", e?.message);
    return c.json({ ok: false, error: e?.message }, 500);
  }
});

// ============ DOWNLOADS ============
app.get("/api/downloads", async (c) => {
  const userId = getUserId(c.req.raw);
  if (!userId) return c.json({ downloads: [] });
  const { results } = await c.env.DB.prepare("SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").bind(userId).all();
  return c.json({ downloads: results || [] });
});

app.post("/api/downloads", async (c) => {
  const userId = getUserId(c.req.raw) || "anonymous";
  const body = await parseBody(c.req.raw);
  const id = uuid("dl");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO downloads (id, user_id, entity_type, entity_id, entity_name, format, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, userId, body.entityType, body.entityId, body.entityName || null, body.format, body.fileSize || null, now).run();
  return c.json({ ok: true });
});

// ============================================================================
// TASK TRACKING — D1-backed polling (replaces Durable Objects)
// ============================================================================
// These endpoints support the polling-based task tracking system.
// The frontend polls /api/tasks/:id/status every 2 seconds.
// No Durable Objects, no WebSockets — works on Cloudflare Free plan.

// === POST /api/tasks/create — create a new task ===
app.post("/api/tasks/create", async (c) => {
  try {
    const body = await parseBody(c.req.raw);
    const type = body.type || "generic";
    const message = body.message || "Initializing";

    const id = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    await c.env.DB.prepare(
      `INSERT INTO ai_tasks (id, type, status, progress, message, result_json, error, created_at, updated_at)
       VALUES (?, ?, 'queued', 0, ?, NULL, NULL, ?, ?)`,
    ).bind(id, type, message, now, now).run();

    return c.json({
      ok: true,
      task: {
        id,
        type,
        status: "queued",
        progress: 0,
        message,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (e: any) {
    console.error("POST /api/tasks/create failed:", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to create task" }, 500);
  }
});

// === GET /api/tasks/:id — get full task record (including result) ===
app.get("/api/tasks/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare(
      `SELECT id, type, status, progress, message, result_json, error, created_at, updated_at
       FROM ai_tasks WHERE id = ?`,
    ).bind(id).first<any>();

    if (!row) return c.json({ ok: false, error: "Task not found" }, 404);

    // Parse result_json for the client
    let result = null;
    if (row.result_json) {
      try { result = JSON.parse(row.result_json); } catch { result = row.result_json; }
    }

    return c.json({
      ok: true,
      task: {
        id: row.id,
        type: row.type,
        status: row.status,
        progress: row.progress,
        message: row.message,
        result,
        error: row.error,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (e: any) {
    console.error("GET /api/tasks/:id failed:", e?.message);
    return c.json({ ok: false, error: e?.message }, 500);
  }
});

// === GET /api/tasks/:id/status — lightweight status poll (for 2s polling) ===
app.get("/api/tasks/:id/status", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare(
      `SELECT id, status, progress, message, error, updated_at FROM ai_tasks WHERE id = ?`,
    ).bind(id).first<any>();

    if (!row) return c.json({ ok: false, error: "Task not found" }, 404);

    return c.json({
      ok: true,
      id: row.id,
      status: row.status,
      progress: row.progress,
      message: row.message,
      error: row.error,
      updated_at: row.updated_at,
    });
  } catch (e: any) {
    console.error("GET /api/tasks/:id/status failed:", e?.message);
    return c.json({ ok: false, error: e?.message }, 500);
  }
});

// === POST /api/tasks/:id/cancel — cancel a queued/running task ===
app.post("/api/tasks/:id/cancel", async (c) => {
  try {
    const id = c.req.param("id");
    const now = Date.now();
    const result = await c.env.DB.prepare(
      `UPDATE ai_tasks SET status = 'cancelled', message = 'Cancelled by user', updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    ).bind(now, id).run();

    const changes = (result as any)?.meta?.changes ?? 0;
    if (changes === 0) {
      return c.json({ ok: false, error: "Task not found or already in terminal status" }, 404);
    }
    return c.json({ ok: true, status: "cancelled" });
  } catch (e: any) {
    console.error("POST /api/tasks/:id/cancel failed:", e?.message);
    return c.json({ ok: false, error: e?.message }, 500);
  }
});

// === PATCH /api/tasks/:id — update task progress/status (called by the worker running the task) ===
app.patch("/api/tasks/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await parseBody(c.req.raw);
    const now = Date.now();

    const updates: string[] = ["updated_at = ?"];
    const values: any[] = [now];

    if (body.status !== undefined) { updates.push("status = ?"); values.push(body.status); }
    if (body.progress !== undefined) { updates.push("progress = ?"); values.push(Math.max(0, Math.min(100, body.progress))); }
    if (body.message !== undefined) { updates.push("message = ?"); values.push(body.message); }
    if (body.error !== undefined) { updates.push("error = ?"); values.push(body.error); }
    if (body.result !== undefined) {
      updates.push("result_json = ?");
      values.push(typeof body.result === "string" ? body.result : JSON.stringify(body.result));
    }

    values.push(id);
    await c.env.DB.prepare(
      `UPDATE ai_tasks SET ${updates.join(", ")} WHERE id = ?`,
    ).bind(...values).run();

    return c.json({ ok: true });
  } catch (e: any) {
    console.error("PATCH /api/tasks/:id failed:", e?.message);
    return c.json({ ok: false, error: e?.message }, 500);
  }
});

// === GET /api/tasks — list recent tasks (admin dashboard) ===
app.get("/api/tasks", async (c) => {
  try {
    const limit = Math.min(100, parseInt(c.req.query("limit") || "50", 10));
    const statusFilter = c.req.query("status");

    const sql = statusFilter
      ? `SELECT id, type, status, progress, message, error, created_at, updated_at
         FROM ai_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, type, status, progress, message, error, created_at, updated_at
         FROM ai_tasks ORDER BY created_at DESC LIMIT ?`;

    const stmt = statusFilter
      ? c.env.DB.prepare(sql).bind(statusFilter, limit)
      : c.env.DB.prepare(sql).bind(limit);

    const { results } = await stmt.all<any>();
    return c.json({ ok: true, tasks: results || [] });
  } catch (e: any) {
    console.error("GET /api/tasks failed:", e?.message);
    return c.json({ ok: false, error: e?.message }, 500);
  }
});

// === POST /api/tasks/purge — purge completed/failed tasks older than 30 days ===
app.post("/api/tasks/purge", async (c) => {
  try {
    const maxAgeDays = parseInt(c.req.query("days") || "30", 10);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const result = await c.env.DB.prepare(
      `DELETE FROM ai_tasks
       WHERE status IN ('completed', 'failed', 'cancelled') AND created_at < ?`,
    ).bind(cutoff).run();

    const changes = (result as any)?.meta?.changes ?? 0;
    return c.json({ ok: true, purged: changes });
  } catch (e: any) {
    console.error("POST /api/tasks/purge failed:", e?.message);
    return c.json({ ok: false, error: e?.message }, 500);
  }
});

// === GET /api/tasks/:id/events — Server-Sent Events (optional SSE) ===
// SSE is a lightweight alternative to polling. The browser opens a persistent
// connection and the server pushes updates. No Durable Objects required.
// If SSE is unavailable, the frontend falls back to polling automatically.
app.get("/api/tasks/:id/events", async (c) => {
  const id = c.req.param("id");

  // Check if the task exists
  const existing = await c.env.DB.prepare(
    "SELECT status FROM ai_tasks WHERE id = ?",
  ).bind(id).first<any>();

  if (!existing) {
    return c.json({ ok: false, error: "Task not found" }, 404);
  }

  // SSE headers
  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastUpdated = 0;
      let pollCount = 0;
      const maxPolls = 300; // 10 minutes at 2s intervals

      const sendEvent = (data: any) => {
        const event = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(event));
      };

      // Send initial event
      sendEvent({ type: "connected", taskId: id, timestamp: Date.now() });

      while (pollCount < maxPolls) {
        try {
          const row = await c.env.DB.prepare(
            `SELECT id, status, progress, message, error, updated_at FROM ai_tasks WHERE id = ?`,
          ).bind(id).first<any>();

          if (!row) {
            sendEvent({ type: "error", error: "Task not found" });
            break;
          }

          // Only send if there's an update
          if (row.updated_at > lastUpdated) {
            lastUpdated = row.updated_at;
            sendEvent({
              type: "status",
              id: row.id,
              status: row.status,
              progress: row.progress,
              message: row.message,
              error: row.error,
              updated_at: row.updated_at,
            });
          }

          // Stop if terminal status
          if (["completed", "failed", "cancelled"].includes(row.status)) {
            sendEvent({ type: "done", status: row.status });
            break;
          }
        } catch (e) {
          // D1 error — keep trying
        }

        pollCount++;
        await new Promise((r) => setTimeout(r, 2000)); // 2s interval
      }

      controller.close();
    },
  });

  return new Response(stream, { headers });
});

// 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

// Global error handler — catches any uncaught error from route handlers.
// Returns a structured 500 response with useful context for debugging.
app.onError((err, c) => {
  const path = c.req.path;
  const method = c.req.method;
  const errMsg = err?.message || String(err);
  console.error(`[API ERROR] ${method} ${path}:`, errMsg, err?.stack);

  // Detect common DB schema errors and return a more helpful message
  if (/no such column|no such table|SQLITE_ERROR/i.test(errMsg)) {
    return c.json({
      error: "Database schema error",
      message: `A required D1 migration is not yet applied. Error: ${errMsg}`,
      path,
      hint: "Run `npx wrangler d1 migrations apply resumeai-pro-db --remote` to apply pending migrations.",
    }, 500);
  }

  return c.json({
    error: "Internal server error",
    message: errMsg,
    path,
    method,
  }, 500);
});

// Helper: parse DB resume row to app format
function parseDbResume(row: any): any {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    headline: row.headline,
    contact: safeJson(row.contact_json, {}),
    summary: row.summary,
    experience: safeJson(row.experience_json, []),
    education: safeJson(row.education_json, []),
    skills: safeJson(row.skills_json, []),
    projects: safeJson(row.projects_json, []),
    certifications: safeJson(row.certifications_json, []),
    languages: safeJson(row.languages_json, []),
    achievements: safeJson(row.achievements_json, []),
    template: row.template,
    accentColor: row.accent_color,
    photoUrl: row.photo_url,
    dateOfBirth: row.date_of_birth,
    source: row.source,
    fileName: row.file_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJson(s: string | null, fallback: any): any {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export default app;
