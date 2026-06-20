// ResumeAI Pro — Cloud API client
// All data flows through this client → Cloudflare Worker → D1
// The browser is NEVER the permanent storage location for business data.

const API_BASE = "https://resumeai-pro-api.rachidelsabah.workers.dev";

// Session user ID — stored in sessionStorage (temporary, not business data)
function getUserId(): string {
  if (typeof window === "undefined") return "anonymous";
  return sessionStorage.getItem("resumeai-user-id") || "anonymous";
}

export function setUserId(id: string) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem("resumeai-user-id", id);
  }
}

export function clearUserId() {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem("resumeai-user-id");
  }
}

/**
 * Retry wrapper — retries network requests with exponential backoff.
 * Used for all cloud API calls to handle transient network failures.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": getUserId(),
          ...options.headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // Retry on 5xx server errors (transient)
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (err: any) {
      clearTimeout(timeout);
      lastError = err;
      // Retry on network errors (timeout, DNS, connection reset)
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  throw lastError ?? new Error("fetchWithRetry exhausted retries");
}

async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    const res = await fetchWithRetry(`${API_BASE}${path}`, options, 2);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `API ${res.status}`);
    }
    return res.json();
  } catch (e: any) {
    // If the error is a network failure (not an API error), throw a
    // user-friendly message that the cloud is unreachable.
    if (e?.name === "AbortError" || e?.message?.includes("fetch")) {
      throw new Error("Cloud sync unavailable — data saved locally as backup.");
    }
    throw e;
  }
}

// ============ RESUMES ============
export const api = {
  // Resumes
  getResumes: () => apiFetch<{ resumes: any[] }>("/api/resumes"),
  createResume: (resume: any) => apiFetch("/api/resumes", { method: "POST", body: JSON.stringify(resume) }),
  updateResume: (id: string, patch: any) => apiFetch(`/api/resumes/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteResume: (id: string) => apiFetch(`/api/resumes/${id}`, { method: "DELETE" }),

  // Cover Letters
  getCoverLetters: () => apiFetch<{ coverLetters: any[] }>("/api/cover-letters"),
  createCoverLetter: (cl: any) => apiFetch("/api/cover-letters", { method: "POST", body: JSON.stringify(cl) }),
  updateCoverLetter: (id: string, patch: any) => apiFetch(`/api/cover-letters/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteCoverLetter: (id: string) => apiFetch(`/api/cover-letters/${id}`, { method: "DELETE" }),

  // Job Descriptions
  getJobDescriptions: () => apiFetch<{ jobDescriptions: any[] }>("/api/job-descriptions"),
  createJobDescription: (jd: any) => apiFetch("/api/job-descriptions", { method: "POST", body: JSON.stringify(jd) }),
  deleteJobDescription: (id: string) => apiFetch(`/api/job-descriptions/${id}`, { method: "DELETE" }),

  // Interview Packages
  getInterviews: () => apiFetch<{ interviews: any[] }>("/api/interviews"),
  createInterview: (iv: any) => apiFetch("/api/interviews", { method: "POST", body: JSON.stringify(iv) }),
  deleteInterview: (id: string) => apiFetch(`/api/interviews/${id}`, { method: "DELETE" }),

  // ATS Reports
  getATSReports: () => apiFetch<{ atsReports: any[] }>("/api/ats-reports"),
  createATSReport: (report: any) => apiFetch("/api/ats-reports", { method: "POST", body: JSON.stringify(report) }),

  // Users
  getUsers: () => apiFetch<{ users: any[] }>("/api/users"),
  createUser: (user: any) => apiFetch("/api/users", { method: "POST", body: JSON.stringify(user) }),
  updateUser: (id: string, patch: any) => apiFetch(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteUser: (id: string) => apiFetch(`/api/users/${id}`, { method: "DELETE" }),

  // AI Providers
  getProviders: () => apiFetch<{ providers: any[] }>("/api/providers"),
  createProvider: (provider: any) => apiFetch("/api/providers", { method: "POST", body: JSON.stringify(provider) }),
  updateProvider: (id: string, patch: any) => apiFetch(`/api/providers/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteProvider: (id: string) => apiFetch(`/api/providers/${id}`, { method: "DELETE" }),

  // Prompts
  getPrompts: () => apiFetch<{ prompts: any[] }>("/api/prompts"),
  createPrompt: (prompt: any) => apiFetch("/api/prompts", { method: "POST", body: JSON.stringify(prompt) }),
  updatePrompt: (id: string, patch: any) => apiFetch(`/api/prompts/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deletePrompt: (id: string) => apiFetch(`/api/prompts/${id}`, { method: "DELETE" }),

  // Audit Logs
  getAuditLogs: () => apiFetch<{ logs: any[] }>("/api/audit-logs"),
  createAuditLog: (log: any) => apiFetch("/api/audit-logs", { method: "POST", body: JSON.stringify(log) }),

  // Settings
  getBranding: () => apiFetch<{ branding: any }>("/api/settings/branding"),
  updateBranding: (branding: any) => apiFetch("/api/settings/branding", { method: "PUT", body: JSON.stringify(branding) }),
  getFlags: () => apiFetch<{ flags: Record<string, boolean> }>("/api/settings/flags"),
  updateFlag: (key: string, value: boolean) => apiFetch(`/api/settings/flags/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),

  // Downloads
  getDownloads: () => apiFetch<{ downloads: any[] }>("/api/downloads"),
  createDownload: (download: any) => apiFetch("/api/downloads", { method: "POST", body: JSON.stringify(download) }),

  // Health
  health: () => apiFetch<{ ok: boolean }>("/api/health"),
};

/**
 * Wraps an async API function so it NEVER throws synchronously and NEVER rejects.
 *
 * Why this exists:
 *   The Zustand store calls cloud APIs in a fire-and-forget manner — local state
 *   is updated optimistically and the cloud sync is a side effect. If the cloud
 *   API throws synchronously (e.g. undefined function) or rejects (e.g. network
 *   error, CORS, 500), the calling action would crash the page.
 *
 * Behavior:
 *   - If `fn` is not a function (undefined, null), returns a no-op async function
 *     that resolves to undefined. This makes the call site safe even if the
 *     cloud API surface changes.
 *   - If `fn` is a function, returns an async wrapper that catches all errors
 *     and logs a warning to the console. The promise always resolves.
 *
 * Usage:
 *   cloudApiSafe(cloudApi.createResume)(resume).catch(() => {});
 *   // or with destructured methods:
 *   cloudApiSafe(createResume)(resume).catch(() => {});
 */
export function cloudApiSafe<T extends (...args: any[]) => Promise<any>>(
  fn: T | undefined | null,
): T {
  if (typeof fn !== "function") {
    return ((..._: any[]) => Promise.resolve(undefined)) as unknown as T;
  }
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (e: any) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[cloudApiSafe] Cloud sync failed (non-fatal):", e?.message || e);
      }
      return undefined as any;
    }
  }) as T;
}

// ============ SYNC HOOK ============
// On app load, sync all data from D1 to the Zustand store
export async function syncAllFromCloud(store: any): Promise<void> {
  try {
    const [resumesRes, clsRes, jdsRes, ivsRes, atsRes, providersRes, promptsRes, logsRes, brandingRes, flagsRes] = await Promise.all([
      api.getResumes().catch(() => ({ resumes: [] })),
      api.getCoverLetters().catch(() => ({ coverLetters: [] })),
      api.getJobDescriptions().catch(() => ({ jobDescriptions: [] })),
      api.getInterviews().catch(() => ({ interviews: [] })),
      api.getATSReports().catch(() => ({ atsReports: [] })),
      api.getProviders().catch(() => ({ providers: [] })),
      api.getPrompts().catch(() => ({ prompts: [] })),
      api.getAuditLogs().catch(() => ({ logs: [] })),
      api.getBranding().catch(() => ({ branding: null })),
      api.getFlags().catch(() => ({ flags: null })),
    ]);

    // Hydrate store with cloud data — ALWAYS set arrays even if empty
    const resumes = (resumesRes.resumes || []).map(parseDbResume);
    const coverLetters = (clsRes.coverLetters || []).map(parseDbCoverLetter);
    const jobDescriptions = (jdsRes.jobDescriptions || []).map(parseDbJD);
    const interviews = (ivsRes.interviews || []).map(parseDbInterview);
    const atsReports = (atsRes.atsReports || []).map(parseDbATS);
    const providers = (providersRes.providers || []).map(parseDbProvider);
    const prompts = (promptsRes.prompts || []).map(parseDbPrompt);
    const logs = logsRes.logs || [];

    // Only override if we got data from the cloud — otherwise keep seed data
    if (resumes.length) {
      store.setState({ resumes });
    } else {
      // Fallback: restore from localStorage backup (in case cloud API was unreachable on previous session)
      if (typeof localStorage !== "undefined") {
        try {
          const backup = JSON.parse(localStorage.getItem("resumeai-resumes-backup") || "[]");
          if (backup.length > 0) {
            store.setState({ resumes: backup });
          }
        } catch {}
      }
    }
    if (coverLetters.length) store.setState({ coverLetters });
    if (jobDescriptions.length) store.setState({ jobDescriptions });
    if (interviews.length) store.setState({ interviews });
    if (atsReports.length) store.setState({ atsReports });
    if (providers.length) store.setState({ providers });
    if (prompts.length) store.setState({ prompts });
    if (logs.length) store.setState({ logs });
    if (brandingRes.branding && Object.keys(brandingRes.branding).length > 0) {
      const bd: any = brandingRes.branding;
      // Only restore branding fields that are actually branding (not nested settings)
      const brandingFields = ["appName", "tagline", "primaryColor", "accentColor", "logoUrl", "emailFromName", "emailFromAddress", "pdfFooterText"];
      const cleanBranding: any = {};
      for (const key of brandingFields) {
        if (bd[key] !== undefined) cleanBranding[key] = bd[key];
      }
      if (Object.keys(cleanBranding).length > 0) store.setState({ branding: { ...store.getState().branding, ...cleanBranding } });

      // Restore optimizerDirective if it was stored as part of branding settings
      if (bd.optimizerDirective && typeof bd.optimizerDirective === "object") {
        // Only overwrite if the stored version has meaningful data (not all defaults)
        const stored = bd.optimizerDirective;
        if (stored.customDirectiveOverride?.trim() || stored.bodyFontSizePt !== 10.5) {
          console.info("[syncAllFromCloud] Restoring optimizerDirective from D1");
          store.setState({ optimizerDirective: stored });
        }
      }
      if (bd.aiDevSettings && typeof bd.aiDevSettings === "object") {
        store.setState({ aiDevSettings: { ...store.getState().aiDevSettings, ...bd.aiDevSettings } });
      }
    }
    if (flagsRes.flags) store.setState({ flags: flagsRes.flags });
  } catch (e) {
    console.error("[syncAllFromCloud] Error:", e);
  }
}

// ============ PARSERS ============
function safeJson(s: any, fallback: any) {
  if (s === null || s === undefined) return fallback;
  if (typeof s === "object") return s;
  try { return JSON.parse(s); } catch { return fallback; }
}
function safeArray(s: any): any[] { const v = safeJson(s, []); return Array.isArray(v) ? v : []; }
function safeObj(s: any): Record<string, any> { const v = safeJson(s, {}); return v && typeof v === "object" ? v : {}; }
function safeStr(s: any): string { return s ? String(s) : ""; }

function parseDbResume(r: any): any {
  const experience = safeArray(r.experience_json).map((e: any) => ({
    id: e.id || `e_${Math.random().toString(36).slice(2, 8)}`,
    title: e.title || "",
    company: e.company || "",
    location: e.location || "",
    startDate: e.startDate || "",
    endDate: e.endDate || "Present",
    bullets: Array.isArray(e.bullets) ? e.bullets : [],
  }));
  const education = safeArray(r.education_json).map((e: any) => ({
    id: e.id || `ed_${Math.random().toString(36).slice(2, 8)}`,
    institution: e.institution || "",
    degree: e.degree || "",
    field: e.field || "",
    location: e.location || "",
    startDate: e.startDate || "",
    endDate: e.endDate || "",
    gpa: e.gpa || "",
    highlights: Array.isArray(e.highlights) ? e.highlights : [],
  }));
  const skills = safeArray(r.skills_json).map((s: any) => ({
    id: s.id || `s_${Math.random().toString(36).slice(2, 8)}`,
    name: s.name || "",
    category: s.category || "",
    level: s.level || undefined,
  }));
  return {
    id: r.id, name: r.name || "", headline: r.headline || "",
    contact: safeObj(r.contact_json),
    summary: r.summary || "",
    experience, education, skills,
    projects: safeArray(r.projects_json),
    certifications: safeArray(r.certifications_json),
    languages: safeArray(r.languages_json),
    achievements: safeArray(r.achievements_json),
    template: r.template || "ats-professional",
    accentColor: r.accent_color || "#1154A3",
    photoUrl: r.photo_url || undefined,
    dateOfBirth: r.date_of_birth || undefined,
    source: r.source || "manual",
    fileName: r.file_name || undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function parseDbCoverLetter(c: any): any {
  return { id: c.id, title: c.title, template: c.template, content: c.content, resumeId: c.resume_id, jdId: c.jd_id, company: c.company, role: c.role, createdAt: c.created_at, updatedAt: c.updated_at };
}

function parseDbJD(j: any): any {
  return {
    id: j.id, title: j.title || "Untitled", company: j.company, location: j.location,
    employmentType: j.employment_type, salary: j.salary,
    responsibilities: safeArray(j.responsibilities_json),
    requiredSkills: safeArray(j.required_skills_json),
    preferredSkills: safeArray(j.preferred_skills_json),
    technologies: safeArray(j.technologies_json),
    experienceYears: j.experience_years, education: j.education,
    keywords: safeArray(j.keywords_json),
    rawText: j.raw_text, url: j.url, source: j.source || "text", createdAt: j.created_at,
  };
}

function parseDbInterview(i: any): any {
  return { id: i.id, resumeId: i.resume_id, jdId: i.jd_id, company: i.company, role: i.role, questions: safeArray(i.questions_json), createdAt: i.created_at };
}

function parseDbATS(a: any): any {
  return {
    id: a.id, resumeId: a.resume_id, jdId: a.jd_id,
    scores: { ats: a.ats_score || 0, formatting: a.formatting_score || 0, keywords: a.keywords_score || 0, content: a.content_score || 0, grammar: a.grammar_score || 0, completeness: a.completeness_score || 0 },
    recommendations: safeArray(a.recommendations_json),
    missingKeywords: safeArray(a.missing_keywords_json),
    matchedKeywords: safeArray(a.matched_keywords_json),
    weakSections: safeArray(a.weak_sections_json),
    jdMatchPercent: a.jd_match_percent,
    createdAt: a.created_at,
  };
}

function parseDbProvider(p: any): any {
  return {
    id: p.id, name: p.name, type: p.provider_type,
    apiUrl: p.base_url, baseUrl: p.base_url, apiKey: p.api_key_encrypted,
    headersJson: p.headers_json, parametersJson: p.parameters_json,
    requestTemplate: p.request_template, responsePath: p.response_path,
    streamingEnabled: p.streaming_enabled === 1,
    modelName: p.model_name, priority: p.priority,
    isActive: p.is_active === 1, isDefault: p.is_default === 1,
    isFallback: p.is_fallback === 1, isBuiltIn: p.is_built_in === 1,
    allowedForRegularUsers: p.allowed_for_regular_users === 1,
    timeout: p.timeout, maxTokens: p.max_tokens, temperature: p.temperature,
    retryAttempts: p.retry_attempts, rateLimitPerMinute: p.rate_limit_per_minute,
    authType: p.auth_type, supportsFunctionCalling: p.supports_function_calling === 1,
    costPerInputToken: p.cost_per_input_token, costPerOutputToken: p.cost_per_output_token,
    applicationId: p.application_id, clientId: p.client_id, redirectUri: p.redirect_uri,
    enabledModels: safeJson(p.enabled_models_json, []),
    lastUsedAt: p.last_used_at, status: p.status,
    usage: { requests: p.usage_requests, tokens: p.usage_tokens, errors: p.usage_errors, avgLatencyMs: p.usage_avg_latency_ms, cost: p.usage_cost },
  };
}

function parseDbPrompt(p: any): any {
  return {
    id: p.id, name: p.name, category: p.category, content: p.content,
    providerId: p.provider_id, version: p.version, isActive: p.is_active === 1,
    variables: safeJson(p.variables_json, []),
  };
}

// ============ LOCALSTORAGE MIGRATION ============
// On first login, check if there's old data in localStorage and migrate it to D1
export async function migrateLocalStorageToCloud(store: any): Promise<void> {
  if (typeof window === "undefined") return;
  const migrationKey = "resumeai-cloud-migration-done";
  if (localStorage.getItem(migrationKey)) return; // already migrated

  try {
    const oldData = localStorage.getItem("resumeai-pro");
    if (!oldData) {
      localStorage.setItem(migrationKey, "1");
      return;
    }

    const parsed = JSON.parse(oldData);
    const state = parsed.state || {};

    // Migrate resumes
    if (state.resumes?.length) {
      for (const r of state.resumes) {
        await api.createResume(r).catch(() => {});
      }
    }

    // Migrate cover letters
    if (state.coverLetters?.length) {
      for (const cl of state.coverLetters) {
        await api.createCoverLetter(cl).catch(() => {});
      }
    }

    // Migrate job descriptions
    if (state.jobDescriptions?.length) {
      for (const jd of state.jobDescriptions) {
        await api.createJobDescription(jd).catch(() => {});
      }
    }

    // Migrate interview packages
    if (state.interviews?.length) {
      for (const iv of state.interviews) {
        await api.createInterview(iv).catch(() => {});
      }
    }

    // Mark migration as done
    localStorage.setItem(migrationKey, "1");

    // DON'T clear old localStorage data yet — keep as backup
    // User can clear it manually from Settings → Privacy → Clear all local data
    // Dev-only log
    if (process.env.NODE_ENV !== "production") {
      console.info("[Cloud Migration] Migrated localStorage data to D1 successfully.");
    }
  } catch (e) {
    console.error("[Cloud Migration] Error:", e);
  }
}
