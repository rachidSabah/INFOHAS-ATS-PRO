// ============================================================================
// Drizzle ORM Schema — Cloudflare D1 / SQLite
// ============================================================================

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// 1. Users Table
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash"),
  role: text("role").default("user").notNull(), // 'guest','user','admin','super_admin'
  provider: text("provider").default("email").notNull(),
  avatarUrl: text("avatar_url"),
  status: text("status").default("active").notNull(), // 'active','suspended','deleted'
  // NOTE: column names MUST match the real D1 schema (migrations 0001/0008):
  // "created_at" / "updated_at" (snake_case). A previous "createdAt" mapping
  // generated INSERTs referencing a non-existent column, crashing
  // ensureUserExists() and POST /api/resumes for brand-new users.
  createdAt: text("created_at").default("datetime('now')").notNull(),
  lastActiveAt: text("last_active_at"),
  lastLoginAt: text("last_login_at"),
  updatedAt: text("updated_at"),
  usageResumes: integer("usage_resumes").default(0).notNull(),
  usageAtsChecks: integer("usage_ats_checks").default(0).notNull(),
  usageCoverLetters: integer("usage_cover_letters").default(0).notNull(),
  usageInterviewPreps: integer("usage_interview_preps").default(0).notNull(),
  usageDownloads: integer("usage_downloads").default(0).notNull(),
});

// 2. Sessions Table
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").unique().notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").default("datetime('now')").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

// 3. Resumes Table
export const resumes = sqliteTable("resumes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  headline: text("headline"),
  contactJson: text("contact_json").notNull(),
  summary: text("summary"),
  experienceJson: text("experience_json").default("[]").notNull(),
  educationJson: text("education_json").default("[]").notNull(),
  skillsJson: text("skills_json").default("[]").notNull(),
  projectsJson: text("projects_json").default("[]").notNull(),
  certificationsJson: text("certifications_json").default("[]").notNull(),
  languagesJson: text("languages_json").default("[]").notNull(),
  achievementsJson: text("achievements_json").default("[]").notNull(),
  template: text("template").default("ats-professional").notNull(),
  accentColor: text("accent_color").default("#1154A3"),
  source: text("source").default("manual").notNull(),
  fileName: text("file_name"),
  filePath: text("file_path"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
  additionalInfoJson: text("additional_info_json"),
  dynamicSectionsJson: text("dynamic_sections_json"),
});

// 4. Job Descriptions Table
export const jobDescriptions = sqliteTable("job_descriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  company: text("company"),
  location: text("location"),
  employmentType: text("employment_type"),
  salary: text("salary"),
  responsibilitiesJson: text("responsibilities_json").default("[]").notNull(),
  requiredSkillsJson: text("required_skills_json").default("[]").notNull(),
  preferredSkillsJson: text("preferred_skills_json").default("[]").notNull(),
  technologiesJson: text("technologies_json").default("[]").notNull(),
  experienceYears: text("experience_years"),
  education: text("education"),
  keywordsJson: text("keywords_json").default("[]").notNull(),
  rawText: text("raw_text"),
  url: text("url"),
  source: text("source").default("text").notNull(),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 5. ATS Reports Table
export const atsReports = sqliteTable("ats_reports", {
  id: text("id").primaryKey(),
  resumeId: text("resume_id").notNull(),
  jdId: text("jd_id"),
  atsScore: integer("ats_score").notNull(),
  formattingScore: integer("formatting_score").notNull(),
  keywordsScore: integer("keywords_score").notNull(),
  contentScore: integer("content_score").notNull(),
  grammarScore: integer("grammar_score").notNull(),
  completenessScore: integer("completeness_score").notNull(),
  recommendationsJson: text("recommendations_json").default("[]").notNull(),
  missingKeywordsJson: text("missing_keywords_json").default("[]").notNull(),
  matchedKeywordsJson: text("matched_keywords_json").default("[]").notNull(),
  weakSectionsJson: text("weak_sections_json").default("[]").notNull(),
  jdMatchPercent: integer("jd_match_percent"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 6. Cover Letters Table
export const coverLetters = sqliteTable("cover_letters", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  template: text("template").default("modern").notNull(),
  content: text("content").notNull(),
  resumeId: text("resume_id"),
  jdId: text("jd_id"),
  company: text("company"),
  role: text("role"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 7. Interview Packages Table
export const interviewPackages = sqliteTable("interview_packages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  resumeId: text("resume_id"),
  jdId: text("jd_id"),
  company: text("company"),
  role: text("role"),
  questionsJson: text("questions_json").default("[]").notNull(),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 8. AI Providers Table
export const aiProviders = sqliteTable("ai_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  providerType: text("provider_type").notNull(),
  apiUrl: text("api_url"),
  apiKeyEncrypted: text("api_key_encrypted"),
  headersJson: text("headers_json"),
  parametersJson: text("parameters_json"),
  modelName: text("model_name"),
  priority: integer("priority").default(10).notNull(),
  isActive: integer("is_active").default(1).notNull(),
  isBuiltIn: integer("is_built_in").default(0).notNull(),
  timeout: integer("timeout").default(30000).notNull(),
  maxTokens: integer("max_tokens").default(4096).notNull(),
  temperature: real("temperature").default(0.7).notNull(),
  status: text("status").default("healthy").notNull(),
  usageRequests: integer("usage_requests").default(0).notNull(),
  usageTokens: integer("usage_tokens").default(0).notNull(),
  usageErrors: integer("usage_errors").default(0).notNull(),
  usageAvgLatencyMs: integer("usage_avg_latency_ms").default(0).notNull(),
  createdAt: text("created_at").default("datetime('now')").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
  baseUrl: text("base_url"),
  streamingEnabled: integer("streaming_enabled").default(0).notNull(),
  isDefault: integer("is_default").default(0).notNull(),
  costPerInputToken: real("cost_per_input_token").default(0.0),
  costPerOutputToken: real("cost_per_output_token").default(0.0),
  authType: text("auth_type").default("apiKey").notNull(),
  providerCategory: text("provider_category").default("generic").notNull(),
  supportsReasoning: integer("supports_reasoning").default(0).notNull(),
  supportsVision: integer("supports_vision").default(0).notNull(),
  supportsJson: integer("supports_json").default(0).notNull(),
  supportsStreaming: integer("supports_streaming").default(0).notNull(),
  healthCheckUrl: text("health_check_url"),
  lastHealthyAt: text("last_healthy_at"),
  isFallback: integer("is_fallback").default(0).notNull(),
});

// 9. Prompt Templates Table
export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  content: text("content").notNull(),
  providerId: text("provider_id"),
  version: integer("version").default(1).notNull(),
  isActive: integer("is_active").default(1).notNull(),
  variablesJson: text("variables_json").default("[]").notNull(),
  createdAt: text("created_at").default("datetime('now')").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 10. Branding Table
export const branding = sqliteTable("branding", {
  id: integer("id").primaryKey(),
  appName: text("app_name").default("ResumeAI Pro").notNull(),
  tagline: text("tagline").default("Land the offer. Beat the bots. Free forever.").notNull(),
  primaryColor: text("primary_color").default("#1154A3").notNull(),
  accentColor: text("accent_color").default("#F59E0B").notNull(),
  logoUrl: text("logo_url").default("/brand/logo.svg").notNull(),
  emailFromName: text("email_from_name").default("ResumeAI Pro").notNull(),
  emailFromAddress: text("email_from_address").default("hello@resumeai.pro").notNull(),
  pdfFooterText: text("pdf_footer_text").default("Generated by ResumeAI Pro — resumeai.pro").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
  providerSettingsJson: text("provider_settings_json"),
  optimizerDirectiveJson: text("optimizer_directive_json"),
  fallbackChainJson: text("fallback_chain_json"),
});

// 11. Feature Flags Table
export const featureFlags = sqliteTable("feature_flags", {
  key: text("key").primaryKey(),
  value: integer("value").default(1).notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 12. Audit Logs Table
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").default("datetime('now')").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  category: text("category").notNull(),
  details: text("details"),
  severity: text("severity").default("info").notNull(),
});

// 13. AI Provider Logs Table
export const aiProviderLogs = sqliteTable("ai_provider_logs", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 14. AI Provider Settings Table
export const aiProviderSettings = sqliteTable("ai_provider_settings", {
  defaultProviderId: text("default_provider_id"),
  fallbackProviderIdsJson: text("fallback_provider_ids_json"),
  lastSyncAt: text("last_sync_at"),
});

// 15. AI Agent Settings Table
export const aiAgentSettings = sqliteTable("ai_agent_settings", {
  id: text("id").primaryKey(),
  agentType: text("agent_type").notNull(),
  providerId: text("provider_id"),
  modelName: text("model_name"),
  systemPrompt: text("system_prompt"),
  temperature: real("temperature").default(0.7).notNull(),
  maxTokens: integer("max_tokens").default(2048).notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 16. AI Agent History Table
export const aiAgentHistory = sqliteTable("ai_agent_history", {
  id: text("id").primaryKey(),
  agentType: text("agent_type").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  inputSummary: text("input_summary"),
  outputSummary: text("output_summary"),
  tokensUsed: integer("tokens_used"),
  latencyMs: integer("latency_ms"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 17. AI Agent Reports Table
export const aiAgentReports = sqliteTable("ai_agent_reports", {
  id: text("id").primaryKey(),
  reportType: text("report_type").notNull(),
  title: text("title").notNull(),
  dataJson: text("data_json").notNull(),
  score: integer("score"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 18. AI Tasks Table
export const aiTasks = sqliteTable("ai_tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  progress: integer("progress").default(0).notNull(),
  error: text("error"),
  branchName: text("branch_name"),
  commitHash: text("commit_hash"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
  username: text("username"),
});

// 19. Patch Jobs Table
export const patchJobs = sqliteTable("patch_jobs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  status: text("status").notNull(),
  diff: text("diff").notNull(),
  explanation: text("explanation"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 20. Build Jobs Table
export const buildJobs = sqliteTable("build_jobs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  status: text("status").notNull(),
  logOutput: text("log_output"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 21. Test Jobs Table
export const testJobs = sqliteTable("test_jobs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  status: text("status").notNull(),
  logOutput: text("log_output"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 22. Autonomous Debug Jobs Table
export const autonomousDebugJobs = sqliteTable("autonomous_debug_jobs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  status: text("status").notNull(),
  loopCount: integer("loop_count").default(0).notNull(),
  logOutput: text("log_output"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
});

// 23. Provider Sync State Table
export const providerSyncState = sqliteTable("provider_sync_state", {
  key: text("key").primaryKey(),
  lastSyncAt: text("last_sync_at").notNull(),
  syncStatus: text("sync_status").notNull(),
});

// 24. Career Materials Table
export const careerMaterials = sqliteTable("career_materials", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  contentText: text("content_text").notNull(),
  category: text("category").notNull(),
  createdAt: text("created_at").default("datetime('now')").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 25. Provider Tokens Table
export const providerTokens = sqliteTable("provider_tokens", {
  providerId: text("provider_id").primaryKey(),
  activeTokensJson: text("active_tokens_json").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 26. Provider Connections Table
export const providerConnections = sqliteTable("provider_connections", {
  providerId: text("provider_id").primaryKey(),
  isConnected: integer("is_connected").default(0).notNull(),
  connectionDetailsJson: text("connection_details_json"),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 27. Provider Models Table
export const providerModels = sqliteTable("provider_models", {
  providerId: text("provider_id").primaryKey(),
  modelsJson: text("models_json").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 28. Provider Health Table
export const providerHealth = sqliteTable("provider_health", {
  providerId: text("provider_id").primaryKey(),
  isHealthy: integer("is_healthy").default(1).notNull(),
  healthCheckDetailsJson: text("health_check_details_json"),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 29. Provider Capabilities Table
export const providerCapabilities = sqliteTable("provider_capabilities", {
  providerId: text("provider_id").primaryKey(),
  capabilitiesJson: text("capabilities_json").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});

// 30. Pipeline Jobs Table — durable queue for the optimization pipeline
// (Option 1). One row per (task, stage): the client runner claims jobs with
// a lease, checkpoints stage results into result_json, and re-queues
// failures with bounded backoff (next_run_at). Expired leases are re-queued
// automatically so a closed tab never orphans a run. Migration 0019.
export const pipelineJobs = sqliteTable("pipeline_jobs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").default("queued").notNull(), // queued|running|done|dead
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(5).notNull(),
  nextRunAt: text("next_run_at"),
  leaseExpiresAt: text("lease_expires_at"),
  lastError: text("last_error"),
  resultJson: text("result_json"),
  createdAt: text("created_at").default("datetime('now')").notNull(),
  updatedAt: text("updated_at").default("datetime('now')").notNull(),
});
