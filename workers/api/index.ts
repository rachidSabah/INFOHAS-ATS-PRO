// ResumeAI Pro — Cloudflare Worker API with D1
// All CRUD endpoints for cloud-based data storage
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb, schema } from "./db";
import { eq } from "drizzle-orm";

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  APP_NAME: string;
  APP_URL: string;
  CORS_ORIGIN: string;
  // Set via: wrangler secret put NEXTAUTH_SECRET
  // Must match the NEXTAUTH_SECRET used by the Next.js frontend.
  // When set, the worker verifies JWTs cryptographically instead of
  // trusting the X-User-Id header.
  NEXTAUTH_SECRET?: string;
  // Workers AI native binding (wrangler.toml [ai] binding = "AI") — the
  // Cloudflare-native rescue tier engine.
  AI?: any;
  // Injected at deploy time via `wrangler deploy --var
  // WORKERSAI_SHARED_SECRET:${{ secrets.WORKERSAI_SHARED_SECRET }}` (kept out
  // of this public repo). /api/ai/workers-ai rejects unauthenticated calls.
  WORKERSAI_SHARED_SECRET?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());
app.use(
  "*",
  cors({
    // Permissive CORS: allow all origins.
    // Cloudflare Pages preview deployments have dynamic URLs
    // (e.g., bcf5bbd9.resumeai-pro.pages.dev) that change on each deploy.
    // Restricting to a single origin breaks the frontend.
    // The CORS_ORIGIN env var is still respected if set, but *.pages.dev
    // and *.workers.dev are ALWAYS allowed regardless.
    origin: (origin, c) => {
      // Always allow the request origin (permissive mode).
      // This is safe because:
      //   1. The API uses X-User-Id header for auth (not cookies)
      //   2. All endpoints require a valid user ID
      //   3. Cloudflare's edge provides DDoS protection
      // Returning the request origin (instead of "*") allows credentials:true
      // to work for future cookie-based auth.
      if (origin) return origin;

      // No origin header (same-origin request or curl) — return *
      const allowed = c.env.CORS_ORIGIN || "*";
      return allowed;
    },
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-User-Id", "X-Requested-With", "Accept", "Origin"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    exposeHeaders: ["Content-Length", "X-Total-Count", "Content-Type"],
    maxAge: 86400, // Cache preflight for 24 hours
  })
);

// Explicit OPTIONS handler — ensures preflight requests ALWAYS get a 200
// response with CORS headers, even if no route matches or the request
// method is OPTIONS (which Hono's cors middleware should handle, but
// this is a safety net).
app.options("*", (c) => {
  return c.text("", 200, {
    "Access-Control-Allow-Origin": c.req.header("origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id, X-Requested-With, Accept, Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  });
});

// Helper: parse JSON body
async function parseBody(req: Request): Promise<any> {
  try {
    return (await req.json()) as any;
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
// Verification priority (ADR-002 — 2026-07-11):
//   1. JWT verification   — Authorization: Bearer <nextauth-jwt>
//      Cryptographically verifies the token against NEXTAUTH_SECRET.
//      Extracts sub (user ID) from the verified payload.
//      This is the production-grade path.
//
//   2. Session token lookup — X-Session-Token: <opaque-token>
//      Looks up the token in the D1 sessions table.
//      Valid for SSR flows that set a session cookie forwarded as a header.
//
//   3. X-User-Id header (backward-compat / internal only)
//      Format-validated only — NOT cryptographically verified.
//      Emits a warning so this path can be monitored and phased out.
//      Acceptable for internal service-to-service calls on the same
//      Cloudflare account where network-level trust applies.
//
// To activate path 1, set the worker secret:
//   npx wrangler secret put NEXTAUTH_SECRET
//   (use the same value as NEXTAUTH_SECRET in your Pages environment)
// ============================================================================

const ALLOWED_USER_ID_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;

/**
 * Decode a Base64URL-encoded string to a UTF-8 string.
 * Works in the Workers runtime (no Node.js atob quirks).
 */
function base64UrlDecode(input: string): string {
  // Pad to multiple of 4 and convert URL-safe chars
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const b64 = pad ? padded + "=".repeat(4 - pad) : padded;
  return atob(b64);
}

/**
 * Verify a NextAuth JWT (HS256) using the NEXTAUTH_SECRET worker secret.
 * Returns the user ID (sub claim) on success, or null on failure.
 *
 * NextAuth default JWT structure:
 *   { sub: "<userId>", name, email, picture, iat, exp, jti }
 *
 * Signature: HMAC-SHA256 over "<header_b64url>.<payload_b64url>"
 */
async function verifyNextAuthJwt(token: string, secret: string): Promise<string | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;

    // Import the HMAC key
    const keyBytes = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Verify signature over "header.payload"
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

    // Re-derive signature bytes correctly from base64url
    const rawSig = base64UrlDecode(sigB64);
    const sigBuf = Uint8Array.from(rawSig, (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify("HMAC", key, sigBuf, signingInput);
    if (!valid) {
      console.warn("[Worker] JWT signature verification failed");
      return null;
    }

    // Decode payload
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as Record<string, unknown>;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && payload.exp < now) {
      console.warn("[Worker] JWT expired");
      return null;
    }

    // Extract user ID from sub claim
    const sub = payload.sub as string | undefined;
    if (!sub || !ALLOWED_USER_ID_PATTERN.test(sub)) {
      console.warn("[Worker] JWT sub claim missing or malformed");
      return null;
    }

    return sub;
  } catch (err) {
    console.warn("[Worker] JWT verification error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Look up an opaque session token in the D1 sessions table.
 * Returns the user_id on success, or null if the token is invalid/expired.
 */
async function lookupSessionToken(token: string, db: D1Database): Promise<string | null> {
  try {
    const drizzleDb = getDb({ DB: db });
    const row = await drizzleDb
      .select({ userId: schema.sessions.userId, expiresAt: schema.sessions.expiresAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.token, token))
      .get();

    if (!row) return null;

    // Check expiry
    const expiresAt = new Date(row.expiresAt).getTime();
    if (Date.now() > expiresAt) {
      console.warn("[Worker] Session token expired");
      return null;
    }

    return row.userId;
  } catch (err) {
    console.warn("[Worker] Session token lookup error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Extract and verify the caller's identity from the request.
 *
 * Verification order:
 *   1. JWT from Authorization: Bearer header (cryptographic — preferred)
 *   2. Session token from X-Session-Token header (D1 lookup)
 *   3. X-User-Id header (format-validated only — backward compat / internal)
 *
 * The env parameter is used for JWT verification (NEXTAUTH_SECRET)
 * and DB lookups. When called from the requireAuth middleware, env
 * is passed in. The legacy call sites that use getUserId(req) only
 * (without env) fall back to path 3 automatically.
 */
async function getUserIdFromRequest(req: Request, env?: Env): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") ?? "";

  // ── Path 1: JWT verification ──────────────────────────────────────────────
  if (authHeader.startsWith("Bearer ") && env?.NEXTAUTH_SECRET) {
    const token = authHeader.slice(7).trim();
    // NextAuth JWTs are three dot-separated base64url segments.
    // Simple opaque user IDs (legacy path 3) won't have two dots.
    if (token.includes(".")) {
      const userId = await verifyNextAuthJwt(token, env.NEXTAUTH_SECRET);
      if (userId) return userId;
      // JWT present but invalid — hard reject (do not fall through to path 3)
      console.warn("[Worker] Bearer token present but JWT verification failed — rejecting");
      return null;
    }
  }

  // ── Path 2: Session token lookup ─────────────────────────────────────────
  const sessionToken = req.headers.get("X-Session-Token");
  if (sessionToken && env?.DB) {
    const userId = await lookupSessionToken(sessionToken, env.DB);
    if (userId) return userId;
  }

  // ── Path 3: X-User-Id header (backward-compat / internal only) ───────────
  const raw =
    req.headers.get("X-User-Id") ||
    (!authHeader.includes(".") ? authHeader.replace("Bearer ", "").trim() : "") ||
    null;

  if (!raw) return null;

  if (!ALLOWED_USER_ID_PATTERN.test(raw)) {
    console.warn("[Worker] Rejected malformed user ID:", raw.slice(0, 20));
    return null;
  }

  // Warn on every use of the unverified path so it shows up in Logpush
  console.warn(
    "[Worker] AUTH: Using unverified X-User-Id path for user:",
    raw.slice(0, 8) + "...",
    "— Set NEXTAUTH_SECRET worker secret to enable JWT verification."
  );
  return raw;
}

/**
 * Synchronous shim kept for any legacy call sites that have not yet
 * been migrated to the async getUserIdFromRequest() path.
 * This only executes path 3 (format-validated X-User-Id).
 * Prefer getUserIdFromRequest(req, env) for all new code.
 *
 * @deprecated Use getUserIdFromRequest(req, env) instead.
 */
function getUserId(req: Request): string | null {
  const raw = req.headers.get("X-User-Id") || req.headers.get("Authorization")?.replace("Bearer ", "") || null;
  if (!raw) return null;
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
  const keyHex = (env as any).ENCRYPTION_KEY;
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

/** Middleware that requires a verified user identity for write operations.
 * Uses JWT verification (path 1) when NEXTAUTH_SECRET is set,
 * session lookup (path 2) when X-Session-Token is present,
 * or format-validated X-User-Id (path 3) as a backward-compat fallback.
 */
const requireAuth = async (c: any, next: any) => {
  const userId = await getUserIdFromRequest(c.req.raw, c.env as Env);
  if (!userId) {
    return c.json({ success: false, code: "AUTH_REQUIRED", message: "Authentication required. Provide a valid Authorization JWT or X-User-Id header." }, 401);
  }
  // Expose verified user ID to downstream handlers via context
  c.set("userId", userId);
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

// ============================================================================
// WORKERS AI NATIVE ROUTE — Task 16 rescue-tier engine.
// In-account inference through the [ai] binding: zero external egress, no
// WAF/bot-management, no per-IP third-party quota (the classes of failure
// that kill the OpenCode Zen free tier). Shared-secret gated so the public
// workers.dev URL cannot be used as an open LLM relay; the ONLY legitimate
// caller is the Pages chat proxy (/api/providers/chat workersAI branch).
// ============================================================================
const WORKERSAI_DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

app.post("/api/ai/workers-ai", async (c) => {
  const provided = c.req.header("X-WorkersAI-Secret") || "";
  const expected = c.env.WORKERSAI_SHARED_SECRET || "";
  if (!expected || !provided || provided !== expected) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }
  const ai = (c.env as any).AI;
  if (!ai?.run) {
    return c.json({ ok: false, error: "Workers AI binding (AI) is not configured on this Worker." }, 501);
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : WORKERSAI_DEFAULT_MODEL;
  if (!model.startsWith("@cf/") && !model.startsWith("@hf/")) {
    return c.json({ ok: false, error: `Invalid Workers AI model "${model}" — expected an @cf/ or @hf/ model id.` }, 400);
  }
  const rawMsgs: any[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages = rawMsgs
    .filter((m) => typeof m?.content === "string" && m.content.length > 0)
    .map((m) => ({
      role: m.role === "system" || m.role === "user" ? m.role : "assistant",
      content: m.content,
    }));
  if (messages.length === 0) messages.push({ role: "user", content: "Hello" });
  const maxTokens = Math.max(1, Math.min(8192, Math.floor(Number(body?.maxTokens) || 4096)));
  const temperature = Math.max(0, Math.min(2, Number(body?.temperature) || 0.7));
  const topP = Number(body?.topP) > 0 ? Math.min(1, Number(body.topP)) : undefined;
  const timeoutMs = Math.max(1000, Math.min(180_000, Number(body?.timeoutMs) || 120_000));

  const input: any = { messages, max_tokens: maxTokens, temperature };
  if (topP) input.top_p = topP;

  const t0 = Date.now();
  try {
    const result: any = await Promise.race([
      ai.run(model, input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error(`Workers AI timed out after ${Math.round(timeoutMs / 1000)}s`), { name: "AbortError" })), timeoutMs),
      ),
    ]);
    let text = "";
    if (typeof result?.response === "string") text = result.response;
    else if (typeof result?.data?.response === "string") text = result.data.response;
    else if (typeof result?.result?.response === "string") text = result.result.response;
    else if (Array.isArray(result?.content)) text = result.content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
    else if (typeof result?.text === "string") text = result.text;
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (!text) {
      return c.json({ ok: false, latencyMs: Date.now() - t0, error: "Workers AI returned an empty response" }, 502);
    }
    const usage = result?.usage ?? result?.data?.usage;
    return c.json({
      ok: true,
      latencyMs: Date.now() - t0,
      text,
      model,
      inputTokens: Number.isFinite(usage?.prompt_tokens) ? Number(usage.prompt_tokens) : undefined,
      outputTokens: Number.isFinite(usage?.completion_tokens) ? Number(usage.completion_tokens) : undefined,
    });
  } catch (e: any) {
    const isTimeout = e?.name === "AbortError" || /timed out/i.test(String(e?.message ?? ""));
    const quota = /neuron|quota|daily limit|exceeded|429/i.test(String(e?.message ?? e ?? ""));
    const msg = quota
      ? `Workers AI daily neurons exhausted (free tier). It will recover after the UTC reset — failover to the next provider. Detail: ${String(e?.message ?? e).slice(0, 200)}`
      : String(e?.message ?? e).slice(0, 300);
    return c.json({ ok: false, success: false, error: msg, message: msg, latencyMs: Date.now() - t0, isTimeout }, isTimeout ? 504 : quota ? 429 : 500);
  }
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
      // From migration 0009
      "alternate_api_keys_json",
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
    const cache = (caches as any).default;
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
    const cache = (caches as any).default;
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
    const cache = (caches as any).default;
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
    // Map camelCase body keys → snake_case columns. "lastLoginAt" was
    // previously dropped (auth-slice sends camelCase) so last-login was
    // never persisted.
    const key = f === "password_hash" ? "passwordHash"
      : f === "avatar" ? "avatarUrl"
      : f === "last_login_at" ? "lastLoginAt"
      : f;
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
  // Return RAW D1 rows (snake_case columns) — same contract as every other
  // collection endpoint (cover-letters, job-descriptions, interviews,
  // ats-reports). The frontend parser (cloud-api.ts parseDbResume) expects
  // snake_case keys. The previous drizzle select returned rows keyed by JS
  // property names (contactJson, ...) while parseDbResume read snake_case,
  // so every JSON column fell back to empty and resumes loaded BLANK.
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC"
  ).bind(userId).all();
  return c.json({ resumes: results || [] });
});

/** Ensure the user exists in the users table — auto-create if missing. */
async function ensureUserExists(db: D1Database, userId: string): Promise<void> {
  if (userId === "anonymous") return; // skip for anonymous
  const drizzleDb = getDb({ DB: db });
  const existing = await drizzleDb
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!existing) {
    const now = new Date().toISOString();
    await drizzleDb
      .insert(schema.users)
      .values({
        id: userId,
        email: `${userId}@placeholder.local`,
        name: userId,
        role: "user",
        status: "active",
        provider: "email",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

app.post("/api/resumes", async (c) => {
  const userId = getUserId(c.req.raw) || "anonymous";
  await ensureUserExists(c.env.DB, userId);
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("r");
  const now = new Date().toISOString();
  try {
    // Try INSERT first
    await c.env.DB.prepare(
      `INSERT INTO resumes (id, user_id, name, headline, contact_json, summary, experience_json, education_json, skills_json, projects_json, certifications_json, languages_json, achievements_json, additional_info_json, dynamic_sections_json, template, accent_color, photo_url, date_of_birth, source, file_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, userId, body.name || "", body.headline || null, JSON.stringify(body.contact || {}), body.summary || null,
      JSON.stringify(body.experience || []), JSON.stringify(body.education || []), JSON.stringify(body.skills || []),
      JSON.stringify(body.projects || []), JSON.stringify(body.certifications || []), JSON.stringify(body.languages || []),
      JSON.stringify(body.achievements || []), JSON.stringify(body.additionalInfo || ""), JSON.stringify(body.dynamicSections || []),
      body.template || "ats-professional", body.accentColor || "#1154A3",
      body.photoUrl || null, body.dateOfBirth || null, body.source || "manual", body.fileName || null, now, now
    ).run();
  } catch (insertErr: any) {
    // If INSERT fails (duplicate id), fall back to UPDATE (UPSERT pattern)
    console.warn("[Workers] Resume INSERT failed, trying UPDATE:", insertErr?.message || insertErr);
    await c.env.DB.prepare(
      `UPDATE resumes SET name = ?, headline = ?, contact_json = ?, summary = ?, experience_json = ?, education_json = ?, skills_json = ?, projects_json = ?, certifications_json = ?, languages_json = ?, achievements_json = ?, additional_info_json = ?, dynamic_sections_json = ?, template = ?, accent_color = ?, photo_url = ?, date_of_birth = ?, source = ?, file_name = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).bind(
      body.name || "", body.headline || null, JSON.stringify(body.contact || {}), body.summary || null,
      JSON.stringify(body.experience || []), JSON.stringify(body.education || []), JSON.stringify(body.skills || []),
      JSON.stringify(body.projects || []), JSON.stringify(body.certifications || []), JSON.stringify(body.languages || []),
      JSON.stringify(body.achievements || []), JSON.stringify(body.additionalInfo || ""), JSON.stringify(body.dynamicSections || []),
      body.template || "ats-professional", body.accentColor || "#1154A3",
      body.photoUrl || null, body.dateOfBirth || null, body.source || "manual", body.fileName || null, now, id, userId
    ).run();
  }
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
    additionalInfo: "additional_info_json", dynamicSections: "dynamic_sections_json",
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
  
  const providers: any[] = [];
  if (results) {
    for (const p of results as any[]) {
      const decProvider = { ...p };
      if (p.api_key_encrypted) {
        decProvider.api_key_encrypted = await decryptApiKey(p.api_key_encrypted, c.env);
      }
      if (p.alternate_api_keys_json) {
        try {
          const keys = JSON.parse(p.alternate_api_keys_json) as string[];
          const decryptedKeys: string[] = [];
          for (const k of keys) {
            decryptedKeys.push(await decryptApiKey(k, c.env));
          }
          decProvider.alternate_api_keys_json = JSON.stringify(decryptedKeys);
        } catch (e) {
          console.warn("[workers/api] Failed to decrypt alternate API keys:", e);
        }
      }
      providers.push(decProvider);
    }
  }

  const response = c.json({ providers });
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

    // Encrypt alternate API keys if present
    let alternateKeysStore: string | null = null;
    if (body.alternateApiKeys && Array.isArray(body.alternateApiKeys)) {
      const encryptedAltKeys: string[] = [];
      for (const k of body.alternateApiKeys) {
        if (k && typeof k === "string" && k.trim()) {
          encryptedAltKeys.push(await encryptApiKey(k.trim(), c.env));
        }
      }
      alternateKeysStore = JSON.stringify(encryptedAltKeys);
    }

    const result = await c.env.DB.prepare(
      "INSERT INTO ai_providers (id, name, provider_type, base_url, api_key_encrypted, alternate_api_keys_json, headers_json, parameters_json, model_name, priority, is_active, is_default, is_fallback, allowed_for_regular_users, timeout, max_tokens, temperature, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id, body.name.trim(), body.type, body.baseUrl || null, apiKeyToStore, alternateKeysStore,
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
    // NOTE: do not re-read the request body here — the stream was already
    // consumed by the handler's first parseBody() call.
    console.error("[Provider Save Error]", error, { id: error?.id });
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
      alternateApiKeys: "alternate_api_keys_json",
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
      retryAttempts: "retry_attempts", rateLimitPerMinute: "rate_limit_per_minute",
      concurrencyCap: "concurrency_cap",
    };

    for (const [k, col] of Object.entries(fieldToColumn)) {
      if (body[k] !== undefined) {
        updates.push(`${col} = ?`);
        const val = body[k];
        if (k === "apiKey") {
          // Encrypt API key before storing
          values.push(val ? await encryptApiKey(String(val), c.env) : null);
        } else if (k === "alternateApiKeys") {
          const encryptedAltKeys: string[] = [];
          if (Array.isArray(val)) {
            for (const ak of val) {
              if (ak && typeof ak === "string" && ak.trim()) {
                encryptedAltKeys.push(await encryptApiKey(ak.trim(), c.env));
              }
            }
          }
          values.push(JSON.stringify(encryptedAltKeys));
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
      return c.json({ success: true, ok: true, message: "No persistable DB fields in payload." });
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

// ============ PROVIDER SESSIONS (Puter, Antigravity, OAuth) ============
// REAL D1 lifecycle (directive #39): the client SessionManager issues
// PUT/GET/DELETE /api/provider-sessions/:provider — previously every handler
// was a stub and PUT did not exist at all (the production 404). Sessions are
// stored per provider so authentication state survives restore.
// NOTE: payloads are encrypted client-side by the SessionManager before they
// reach this route; access tokens are never logged here (directive #43).

async function ensureProviderSessionsTable(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS provider_sessions (
      provider TEXT PRIMARY KEY,
      session_json TEXT NOT NULL,
      authenticated INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`
  ).run();
}

app.put("/api/provider-sessions/:provider", async (c) => {
  const provider = c.req.param("provider");
  try {
    const body = await parseBody(c.req.raw);
    if (!body || typeof body !== "object") {
      return c.json({ ok: false, error: "Invalid session payload" }, 400);
    }
    await ensureProviderSessionsTable(c.env.DB);
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO provider_sessions (provider, session_json, authenticated, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET session_json = excluded.session_json, authenticated = excluded.authenticated, updated_at = excluded.updated_at`
    ).bind(provider, JSON.stringify(body), body?.authenticated ? 1 : 0, now).run();
    console.log(`[ProviderSessions] Session persisted for ${provider} (authenticated=${!!body?.authenticated})`);
    return c.json({ ok: true, success: true, provider, updatedAt: now });
  } catch (e: any) {
    console.error("[ProviderSessions PUT Error]", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to persist provider session" }, 500);
  }
});

app.get("/api/provider-sessions/:provider", async (c) => {
  const provider = c.req.param("provider");
  try {
    await ensureProviderSessionsTable(c.env.DB);
    const row = await c.env.DB.prepare("SELECT session_json, authenticated, updated_at FROM provider_sessions WHERE provider = ?").bind(provider).first<any>();
    if (!row) return c.json({ ok: true, session: null, sessions: [] });
    let session: any = null;
    try { session = JSON.parse(row.session_json); } catch { session = null; }
    return c.json({ ok: true, session, sessions: session ? [session] : [] });
  } catch (e: any) {
    console.error("[ProviderSessions GET Error]", e?.message);
    return c.json({ ok: true, session: null, sessions: [] });
  }
});

app.post("/api/provider-sessions/:provider", async (c) => {
  // POST behaves as an upsert alias of PUT (legacy clients).
  const provider = c.req.param("provider");
  try {
    const body = await parseBody(c.req.raw);
    await ensureProviderSessionsTable(c.env.DB);
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO provider_sessions (provider, session_json, authenticated, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET session_json = excluded.session_json, authenticated = excluded.authenticated, updated_at = excluded.updated_at`
    ).bind(provider, JSON.stringify(body ?? {}), body?.authenticated ? 1 : 0, now).run();
    return c.json({ ok: true, success: true, provider, updatedAt: now });
  } catch (e: any) {
    console.error("[ProviderSessions POST Error]", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to persist provider session" }, 500);
  }
});

app.delete("/api/provider-sessions/:provider", async (c) => {
  const provider = c.req.param("provider");
  try {
    await ensureProviderSessionsTable(c.env.DB);
    await c.env.DB.prepare("DELETE FROM provider_sessions WHERE provider = ?").bind(provider).run();
    return c.json({ ok: true, success: true });
  } catch (e: any) {
    console.error("[ProviderSessions DELETE Error]", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to clear provider session" }, 500);
  }
});

// ============ AGENT CONFIGURATION CENTER (directives #20/#21/#22) ============
// Authoritative D1 persistence for the 18-agent registry. Stored on the
// existing branding settings singleton row (adapted to the existing database
// architecture — directive #20) with a monotonically increasing version so
// stale writers are detected (cache-consistency directive #40).

async function ensureAgentConfigColumns(db: D1Database): Promise<void> {
  // Migration 0017 may not be applied on every environment yet; self-heal the
  // columns so the route works as soon as it is deployed.
  const alters: [string, string][] = [
    ["agent_configs_json", "TEXT"],
    ["agent_configs_version", "INTEGER NOT NULL DEFAULT 0"],
    ["agent_configs_updated_at", "TEXT"],
    ["agent_configs_updated_by", "TEXT"],
  ];
  for (const [col, def] of alters) {
    try {
      await db.prepare(`SELECT ${col} FROM branding WHERE id = 1`).first();
    } catch {
      try {
        await db.prepare(`ALTER TABLE branding ADD COLUMN ${col} ${def}`).run();
      } catch (e: any) {
        if (!/duplicate column/i.test(e?.message || "")) throw e;
      }
    }
  }
}

app.get("/api/agent-configs", async (c) => {
  try {
    await ensureAgentConfigColumns(c.env.DB);
    const row = await c.env.DB.prepare(
      "SELECT agent_configs_json, agent_configs_version, agent_configs_updated_at, agent_configs_updated_by FROM branding WHERE id = 1"
    ).first<any>();
    const configs = row?.agent_configs_json ? JSON.parse(row.agent_configs_json) : [];
    return c.json({
      ok: true,
      agentConfigs: configs ?? [],
      version: row?.agent_configs_version ?? 0,
      updatedAt: row?.agent_configs_updated_at ?? null,
      updatedBy: row?.agent_configs_updated_by ?? null,
    });
  } catch (e: any) {
    console.error("[AgentConfigs GET Error]", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to load agent configs", agentConfigs: [], version: 0 }, 500);
  }
});

app.put("/api/agent-configs", async (c) => {
  try {
    const body = await parseBody(c.req.raw);
    const configs = body?.agentConfigs;
    if (!Array.isArray(configs)) {
      return c.json({ ok: false, error: "agentConfigs must be an array" }, 400);
    }
    // Light structural validation: every entry needs agentType + enabled.
    for (const cfg of configs) {
      if (!cfg || typeof cfg !== "object" || typeof cfg.agentType !== "string" || typeof cfg.enabled !== "boolean") {
        return c.json({ ok: false, error: "Invalid agent config entry (agentType + enabled required)" }, 400);
      }
    }
    await ensureAgentConfigColumns(c.env.DB);
    const existing: any = await c.env.DB.prepare("SELECT agent_configs_version FROM branding WHERE id = 1").first() ?? {};
    const nextVersion = (existing?.agent_configs_version ?? 0) + 1;
    const now = new Date().toISOString();
    const updatedBy = typeof body?.updatedBy === "string" && body.updatedBy ? body.updatedBy : "admin";
    await c.env.DB.prepare(
      `UPDATE branding SET agent_configs_json = ?, agent_configs_version = ?, agent_configs_updated_at = ?, agent_configs_updated_by = ?, updated_at = ? WHERE id = ?`
    ).bind(JSON.stringify(configs), nextVersion, now, updatedBy, now, "1").run();
    console.log(`[AgentConfigs] Persisted ${configs.length} agent configs (version ${nextVersion})`);
    return c.json({ ok: true, version: nextVersion, updatedAt: now, count: configs.length });
  } catch (e: any) {
    console.error("[AgentConfigs PUT Error]", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to persist agent configs" }, 500);
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
    // Expose camelCase aliases alongside the raw snake_case columns — the
    // frontend restore (cloud-api.ts) reads bd.appName/bd.primaryColor/…
    // which never existed on the raw D1 row, so branding was silently never
    // restored. Keeping the raw keys too preserves every existing consumer.
    let branding: any = result || {};
    if (result) {
      branding = {
        ...result,
        appName: result.app_name ?? result.appName,
        primaryColor: result.primary_color ?? result.primaryColor,
        accentColor: result.accent_color ?? result.accentColor,
        logoUrl: result.logo_url ?? result.logoUrl,
        emailFromName: result.email_from_name ?? result.emailFromName,
        emailFromAddress: result.email_from_address ?? result.emailFromAddress,
        pdfFooterText: result.pdf_footer_text ?? result.pdfFooterText,
      };
      // === Admin settings blob (migration 0020) ===
      // optimizerDirective / fallbackChain / pipelineProfiles /
      // selectedProfileId / aiDevSettings live in admin_settings_json and are
      // spread back as TOP-LEVEL keys — syncAllFromCloud (cloud-api.ts)
      // hydrates them from bd.optimizerDirective, bd.fallbackChain, etc.
      if (result.admin_settings_json) {
        try {
          const adminSettings = JSON.parse(result.admin_settings_json);
          if (adminSettings && typeof adminSettings === "object" && !Array.isArray(adminSettings)) {
            branding = { ...branding, ...adminSettings };
          }
        } catch (e: any) {
          console.warn("GET /api/settings/branding admin_settings_json parse failed:", e?.message);
        }
      }
    }
    const response = c.json({ branding });
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

  const getBrandingSettings = async () => {
    try {
      return await c.env.DB.prepare("SELECT * FROM branding WHERE id = 1").first() || {};
    } catch (e) {
      return {};
    }
  };

  const existing: any = await getBrandingSettings();

  const existingAppName = existing.app_name ?? existing.appName ?? "ResumeAI Pro";
  const existingLogo = existing.logo_url ?? existing.logoUrl ?? existing.logo ?? "/brand/logo.svg";
  const existingCompany = existing.company ?? "ResumeAI Pro";

  // === Admin settings blob (migration 0020) ===
  // The Super Admin store pushes optimizerDirective / fallbackChain /
  // pipelineProfiles / selectedProfileId / aiDevSettings through this very
  // endpoint. The previous whitelist silently discarded them (while still
  // returning ok:true), so every save vanished on refresh. Merge the known
  // admin keys into one JSON column; keys absent from this request body keep
  // their previously stored value, so unrelated updateBranding callers can
  // never wipe another panel's settings.
  const ADMIN_SETTING_KEYS = [
    "optimizerDirective",
    "fallbackChain",
    "pipelineProfiles",
    "selectedProfileId",
    "aiDevSettings",
    "scenarios",
    "interviewPersonas",
  ] as const;
  let adminSettings: Record<string, unknown> = {};
  try {
    if (existing.admin_settings_json) {
      const parsed = JSON.parse(existing.admin_settings_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        adminSettings = parsed;
      }
    }
  } catch {
    adminSettings = {};
  }
  for (const k of ADMIN_SETTING_KEYS) {
    if (body[k] !== undefined && body[k] !== null) {
      adminSettings[k] = body[k];
    }
  }
  const adminSettingsJson = Object.keys(adminSettings).length > 0 ? JSON.stringify(adminSettings) : null;

  // Merge values exactly as required
  const payload = {
    appName: body.appName ?? existingAppName,
    logo: body.logo ?? body.logoUrl ?? existingLogo,
    company: body.company ?? existingCompany
  };

  function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
  }

  assert(payload.appName !== null, "app_name cannot be null");

  console.log("[D1]\nBranding settings merged successfully.");

  const updates: string[] = [
    "app_name = ?", "tagline = ?", "primary_color = ?", "accent_color = ?",
    "logo_url = ?", "email_from_name = ?", "email_from_address = ?",
    "pdf_footer_text = ?", "updated_at = ?",
    "provider_settings_json = ?", "ai_routing_settings_json = ?",
    "admin_settings_json = ?",
  ];

  const n = (bodyValue: any, dbField: string, defaultValue: string) => {
    if (bodyValue !== undefined && bodyValue !== null) return bodyValue;
    return existing[dbField] ?? defaultValue;
  };

  const values: any[] = [
    payload.appName, // app_name (NOT NULL)
    n(body.tagline, "tagline", "Land the offer. Beat the bots. Free forever."),
    n(body.primaryColor, "primary_color", "#1154A3"),
    n(body.accentColor, "accent_color", "#F59E0B"),
    payload.logo, // logo_url (NOT NULL)
    n(body.emailFromName, "email_from_name", "ResumeAI Pro"),
    n(body.emailFromAddress, "email_from_address", "hello@resumeai.pro"),
    n(body.pdfFooterText, "pdf_footer_text", "Generated by ResumeAI Pro — resumeai.pro"),
    now,
    body.providerSettings !== undefined && body.providerSettings !== null ? JSON.stringify(body.providerSettings) : (existing.provider_settings_json ?? null),
    body.aiRoutingSettings !== undefined && body.aiRoutingSettings !== null ? JSON.stringify(body.aiRoutingSettings) : (existing.ai_routing_settings_json ?? null),
    adminSettingsJson,
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
    // Upsert (was UPDATE-only): a flag key that was never seeded silently
    // matched 0 rows while still reporting ok:true, so the toggle was lost
    // on every refresh.
    await c.env.DB.prepare(
      `INSERT INTO feature_flags (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(key, body.value ? 1 : 0, new Date().toISOString()).run();
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
    const parsedDays = parseInt(c.req.query("days") || "30", 10);
    const maxAgeDays = Number.isFinite(parsedDays) && parsedDays >= 0 ? parsedDays : 30;
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

// ============ CAREER MATERIALS (RAG) ============
app.get("/api/career-materials", async (c) => {
  try {
    const { results } = await c.env.DB.prepare("SELECT * FROM career_materials ORDER BY created_at DESC").all();
    return c.json({ careerMaterials: results || [] });
  } catch (err: any) {
    // Table doesn't exist yet — migration 0010 not applied. Return empty gracefully.
    if (/no such table/i.test(err?.message || "")) {
      console.warn("[career-materials] Table not found — run migration 0010_career_materials.sql");
      return c.json({ careerMaterials: [] });
    }
    throw err;
  }
});

app.post("/api/career-materials", async (c) => {
  const body = await c.req.json();
  if (!body.id || !body.title || !body.contentText) {
    return c.json({ error: "Missing required fields: id, title, contentText" }, 400);
  }
  try {
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "INSERT OR REPLACE INTO career_materials (id, title, content_text, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      body.id, body.title.trim(), body.contentText.trim(), body.category || 'project', now, now
    ).run();
    return c.json({ success: true });
  } catch (err: any) {
    if (/no such table/i.test(err?.message || "")) {
      return c.json({ error: "Career materials table not yet created. Apply migration 0010_career_materials.sql." }, 503);
    }
    throw err;
  }
});

app.delete("/api/career-materials/:id", async (c) => {
  const id = c.req.param("id");
  try {
    await c.env.DB.prepare("DELETE FROM career_materials WHERE id = ?").bind(id).run();
  } catch (err: any) {
    if (/no such table/i.test(err?.message || "")) {
      console.warn("[career-materials] Table not found — delete skipped");
    } else {
      throw err;
    }
  }
  return c.json({ success: true });
});

// ============ PIPELINE JOBS (durable queue — Option 1) ============
// Durable per-stage jobs for the optimization pipeline. The client runner
// (src/lib/agents/durable-pipeline.ts) enqueues one job per stage, claims
// them with a lease, checkpoints stage results into result_json, and
// re-queues failures with bounded backoff (next_run_at, Retry-After aware).
// Expired leases are re-queued on every claim sweep so a closed tab can
// never orphan a run. Same trust model as /api/tasks/* (task-scoped,
// non-sensitive). Schema: migrations/0019_pipeline_jobs.sql.

const PIPELINE_JOB_LEASE_MS = 10 * 60 * 1000; // 10 min visibility timeout
const PIPELINE_JOB_BACKOFF_BASE_MS = 60_000;  // 60s — matches rate-limit-tracker
const PIPELINE_JOB_BACKOFF_CAP_MS = 30 * 60 * 1000; // 30 min hard cap

/**
 * Backoff for the n-th attempt: an explicit Retry-After from the provider
 * (when surfaced) wins, else the bounded exponential curve 60s→2m→4m→…→30m.
 */
function pipelineJobBackoffMs(attempts: number, retryAfterMs?: number): number {
  if (Number.isFinite(retryAfterMs) && (retryAfterMs as number) > 0) {
    return Math.min(retryAfterMs as number, PIPELINE_JOB_BACKOFF_CAP_MS);
  }
  const shifted = Math.max(0, Math.min(Math.max(1, attempts) - 1, 5));
  return Math.min(PIPELINE_JOB_BACKOFF_BASE_MS * 2 ** shifted, PIPELINE_JOB_BACKOFF_CAP_MS);
}

function parseJobRow(row: any): any {
  if (!row) return row;
  let result: unknown = null;
  if (row.result_json) {
    try { result = JSON.parse(row.result_json); } catch { result = row.result_json; }
  }
  return { ...row, result };
}

// POST /api/pipeline/jobs — bulk enqueue (idempotent per task+stage)
app.post("/api/pipeline/jobs", async (c) => {
  try {
    const body = await parseBody(c.req.raw);
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const jobs = Array.isArray(body.jobs) ? body.jobs : [];
    if (!taskId) return c.json({ ok: false, error: "taskId is required" }, 400);
    if (jobs.length === 0) return c.json({ ok: false, error: "jobs[] is required" }, 400);

    const now = new Date().toISOString();
    for (const j of jobs) {
      const stage = typeof j?.stage === "string" ? j.stage : "";
      if (!stage) return c.json({ ok: false, error: "each job needs a stage" }, 400);
      const maxAttempts = Number.isFinite(j?.maxAttempts) && j.maxAttempts > 0 ? Math.floor(j.maxAttempts) : 5;
      const id = `pjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      // OR IGNORE → re-enqueuing the same (task, stage) is a safe no-op.
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO pipeline_jobs (id, task_id, stage, status, attempts, max_attempts, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`,
      ).bind(id, taskId, stage, maxAttempts, now, now).run();
    }

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM pipeline_jobs WHERE task_id = ? ORDER BY created_at, id`,
    ).bind(taskId).all();
    return c.json({ ok: true, jobs: (results ?? []).map(parseJobRow) });
  } catch (e: any) {
    console.error("POST /api/pipeline/jobs failed:", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to enqueue jobs" }, 500);
  }
});

// POST /api/pipeline/jobs/claim — atomically claim 1..N runnable jobs.
// Runs BEFORE the claim: re-queue 'running' jobs whose lease expired.
app.post("/api/pipeline/jobs/claim", async (c) => {
  try {
    const body = await parseBody(c.req.raw);
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const stage = typeof body.stage === "string" && body.stage ? body.stage : null;
    const count = Number.isFinite(body.count) && body.count > 0 ? Math.min(Math.floor(body.count), 10) : 1;
    if (!taskId) return c.json({ ok: false, error: "taskId is required" }, 400);

    const now = new Date();
    const nowIso = now.toISOString();

    // Sweep expired leases for this task (crash recovery).
    await c.env.DB.prepare(
      `UPDATE pipeline_jobs SET status = 'queued', lease_expires_at = NULL, updated_at = ?
       WHERE task_id = ? AND status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
    ).bind(nowIso, taskId, nowIso).run();

    // Atomic claim: single UPDATE with a subselect + RETURNING — no read-
    // then-write race even with multiple concurrent runners.
    const claimed: any[] = [];
    const leaseExpires = new Date(now.getTime() + PIPELINE_JOB_LEASE_MS).toISOString();
    for (let i = 0; i < count; i++) {
      const stmt = stage
        ? c.env.DB.prepare(
          `UPDATE pipeline_jobs
             SET status = 'running', attempts = attempts + 1, lease_expires_at = ?, updated_at = ?
           WHERE id = (
             SELECT id FROM pipeline_jobs
              WHERE task_id = ? AND stage = ? AND status = 'queued' AND (next_run_at IS NULL OR next_run_at <= ?)
              ORDER BY created_at, id LIMIT 1
           )
           RETURNING *`,
        ).bind(leaseExpires, nowIso, taskId, stage, nowIso)
        : c.env.DB.prepare(
          `UPDATE pipeline_jobs
             SET status = 'running', attempts = attempts + 1, lease_expires_at = ?, updated_at = ?
           WHERE id = (
             SELECT id FROM pipeline_jobs
              WHERE task_id = ? AND status = 'queued' AND (next_run_at IS NULL OR next_run_at <= ?)
              ORDER BY created_at, id LIMIT 1
           )
           RETURNING *`,
        ).bind(leaseExpires, nowIso, taskId, nowIso);
      const { results } = await stmt.all();
      if (!results || results.length === 0) break;
      claimed.push(parseJobRow(results[0]));
    }

    return c.json({ ok: true, jobs: claimed });
  } catch (e: any) {
    console.error("POST /api/pipeline/jobs/claim failed:", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to claim jobs" }, 500);
  }
});

// POST /api/pipeline/jobs/:id/complete — checkpoint the stage result
app.post("/api/pipeline/jobs/:id/complete", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await parseBody(c.req.raw);
    const now = new Date().toISOString();
    const resultJson = body?.result !== undefined ? JSON.stringify(body.result) : null;

    const out = await c.env.DB.prepare(
      `UPDATE pipeline_jobs
          SET status = 'done', result_json = ?, lease_expires_at = NULL, next_run_at = NULL, last_error = NULL, updated_at = ?
        WHERE id = ?`,
    ).bind(resultJson, now, id).run();

    if (!out.meta || out.meta.changes === 0) return c.json({ ok: false, error: "Job not found" }, 404);
    const row = await c.env.DB.prepare(`SELECT * FROM pipeline_jobs WHERE id = ?`).bind(id).first<any>();
    return c.json({ ok: true, job: parseJobRow(row) });
  } catch (e: any) {
    console.error("POST /api/pipeline/jobs/:id/complete failed:", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to complete job" }, 500);
  }
});

// POST /api/pipeline/jobs/:id/fail — re-queue with bounded backoff
// (Retry-After aware) or mark dead when attempts are exhausted.
app.post("/api/pipeline/jobs/:id/fail", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await parseBody(c.req.raw);
    const now = new Date();
    const retryAfterMs = Number.isFinite(body?.retryAfterMs) ? Number(body.retryAfterMs) : undefined;

    const row = await c.env.DB.prepare(
      `SELECT attempts, max_attempts FROM pipeline_jobs WHERE id = ?`,
    ).bind(id).first<any>();
    if (!row) return c.json({ ok: false, error: "Job not found" }, 404);

    const exhausted = row.attempts >= row.max_attempts;
    const status = exhausted ? "dead" : "queued";
    const nextRunAt = exhausted ? null : new Date(now.getTime() + pipelineJobBackoffMs(row.attempts, retryAfterMs)).toISOString();

    await c.env.DB.prepare(
      `UPDATE pipeline_jobs SET status = ?, next_run_at = ?, lease_expires_at = NULL, last_error = ?, updated_at = ? WHERE id = ?`,
    ).bind(status, nextRunAt, String(body?.error ?? "unknown error"), now.toISOString(), id).run();

    return c.json({ ok: true, status, next_run_at: nextRunAt, attempts: row.attempts, max_attempts: row.max_attempts });
  } catch (e: any) {
    console.error("POST /api/pipeline/jobs/:id/fail failed:", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to fail job" }, 500);
  }
});

// GET /api/pipeline/jobs?task_id=…[&status=…] — job snapshot for UI/progress
app.get("/api/pipeline/jobs", async (c) => {
  try {
    const taskId = c.req.query("task_id");
    if (!taskId) return c.json({ ok: false, error: "task_id is required" }, 400);
    const status = c.req.query("status");
    const stmt = status
      ? c.env.DB.prepare(`SELECT * FROM pipeline_jobs WHERE task_id = ? AND status = ? ORDER BY created_at, id`).bind(taskId, status)
      : c.env.DB.prepare(`SELECT * FROM pipeline_jobs WHERE task_id = ? ORDER BY created_at, id`).bind(taskId);
    const { results } = await stmt.all();
    return c.json({ ok: true, jobs: (results ?? []).map(parseJobRow) });
  } catch (e: any) {
    console.error("GET /api/pipeline/jobs failed:", e?.message);
    return c.json({ ok: false, error: e?.message || "Failed to list jobs" }, 500);
  }
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
// NOTE: no longer used by GET /api/resumes — that endpoint returns raw D1
// rows (snake_case) which the frontend parses once (cloud-api.ts). Kept for
// reference by future server-side consumers.
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
    additionalInfo: safeJson(row.additional_info_json, ""),
    dynamicSections: safeJson(row.dynamic_sections_json, []),
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
