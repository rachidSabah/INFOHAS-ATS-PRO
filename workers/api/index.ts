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
async function parseBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// Helper: generate UUID
function uuid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

// Helper: get or create user_id from header (simplified auth for demo)
function getUserId(req: Request): string | null {
  const auth = req.headers.get("X-User-Id") || req.headers.get("Authorization")?.replace("Bearer ", "");
  return auth || null;
}

// ============ HEALTH ============
app.get("/api/health", (c) => c.json({ ok: true, app: c.env.APP_NAME, time: new Date().toISOString() }));

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
  const { results } = await c.env.DB.prepare("SELECT * FROM ai_providers ORDER BY priority ASC").all();
  return c.json({ providers: results || [] });
});

app.post("/api/providers", async (c) => {
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("p");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO ai_providers (id, name, provider_type, base_url, api_key_encrypted, headers_json, parameters_json, model_name, priority, is_active, is_default, is_fallback, allowed_for_regular_users, timeout, max_tokens, temperature, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.name, body.type, body.baseUrl || null, body.apiKey || null, body.headersJson || null, body.parametersJson || null,
    body.modelName || null, body.priority || 10, body.isActive ? 1 : 0, body.isDefault ? 1 : 0, body.isFallback ? 1 : 0,
    body.allowedForRegularUsers ? 1 : 0, body.timeout || 30000, body.maxTokens || 4096, body.temperature || 0.7,
    body.status || "untested", now, now).run();
  return c.json({ ok: true, provider: { ...body, id } });
});

app.put("/api/providers/:id", async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(c.req.raw);
  const now = new Date().toISOString();
  const updates: string[] = ["updated_at = ?"];
  const values: any[] = [now];
  for (const [k, col] of Object.entries({ name: "name", baseUrl: "base_url", apiKey: "api_key_encrypted", modelName: "model_name", priority: "priority", isActive: "is_active", isDefault: "is_default", isFallback: "is_fallback", allowedForRegularUsers: "allowed_for_regular_users", timeout: "timeout", maxTokens: "max_tokens", temperature: "temperature", status: "status", headersJson: "headers_json", parametersJson: "parameters_json", requestTemplate: "request_template", responsePath: "response_path", streamingEnabled: "streaming_enabled", authType: "auth_type", costPerInputToken: "cost_per_input_token", costPerOutputToken: "cost_per_output_token", enabledModels: "enabled_models_json", applicationId: "application_id", clientId: "client_id", redirectUri: "redirect_uri" })) {
    if (body[k] !== undefined) {
      updates.push(`${col} = ?`);
      values.push(k === "enabledModels" ? JSON.stringify(body[k]) : typeof body[k] === "boolean" ? (body[k] ? 1 : 0) : body[k]);
    }
  }
  values.push(id);
  await c.env.DB.prepare(`UPDATE ai_providers SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

app.delete("/api/providers/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM ai_providers WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ============ PROMPT TEMPLATES ============
app.get("/api/prompts", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM prompt_templates ORDER BY created_at DESC").all();
  return c.json({ prompts: results || [] });
});

app.post("/api/prompts", async (c) => {
  const body = await parseBody(c.req.raw);
  const id = body.id || uuid("pt");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO prompt_templates (id, name, category, content, provider_id, version, is_active, variables_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.name, body.category, body.content, body.providerId || null, body.version || 1, body.isActive ? 1 : 0, JSON.stringify(body.variables || []), now, now).run();
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
  return c.json({ ok: true });
});

app.delete("/api/prompts/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM prompt_templates WHERE id = ?").bind(c.req.param("id")).run();
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
  const result = await c.env.DB.prepare("SELECT * FROM branding WHERE id = 1").first();
  return c.json({ branding: result || {} });
});

app.put("/api/settings/branding", async (c) => {
  const body = await parseBody(c.req.raw);
  const now = new Date().toISOString();
  // Try advanced UPDATE (with provider_settings_json column from migration 0006).
  // If the column doesn't exist (migration not yet applied), fall back to basic UPDATE.
  try {
    const providerSettingsJson = body.providerSettings ? JSON.stringify(body.providerSettings) : null;
    await c.env.DB.prepare(
      "UPDATE branding SET app_name = ?, tagline = ?, primary_color = ?, accent_color = ?, logo_url = ?, email_from_name = ?, email_from_address = ?, pdf_footer_text = ?, provider_settings_json = ?, updated_at = ? WHERE id = 1"
    ).bind(body.appName, body.tagline, body.primaryColor, body.accentColor, body.logoUrl, body.emailFromName, body.emailFromAddress, body.pdfFooterText, providerSettingsJson, now).run();
  } catch {
    // Fallback: column provider_settings_json doesn't exist yet
    await c.env.DB.prepare(
      "UPDATE branding SET app_name = ?, tagline = ?, primary_color = ?, accent_color = ?, logo_url = ?, email_from_name = ?, email_from_address = ?, pdf_footer_text = ?, updated_at = ? WHERE id = 1"
    ).bind(body.appName, body.tagline, body.primaryColor, body.accentColor, body.logoUrl, body.emailFromName, body.emailFromAddress, body.pdfFooterText, now).run();
  }
  return c.json({ ok: true });
});

app.get("/api/settings/flags", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM feature_flags").all();
  const flags: Record<string, boolean> = {};
  for (const r of results || []) flags[r.key] = r.value === 1;
  return c.json({ flags });
});

app.put("/api/settings/flags/:key", async (c) => {
  const key = c.req.param("key");
  const body = await parseBody(c.req.raw);
  await c.env.DB.prepare("UPDATE feature_flags SET value = ?, updated_at = ? WHERE key = ?").bind(body.value ? 1 : 0, new Date().toISOString(), key).run();
  return c.json({ ok: true });
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

// 404
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error", message: err.message }, 500);
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
