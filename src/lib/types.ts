// ResumeAI Pro — core domain types

export type Role = "guest" | "user" | "admin" | "super_admin";

export type UserStatus = "pending" | "approved" | "suspended" | "deleted";

export interface User {
  id: string;
  name: string;
  username?: string;
  email: string;
  passwordHash?: string;
  avatarUrl?: string;
  role: Role;
  status: UserStatus;
  provider: "email" | "puter";
  createdAt: string;
  updatedAt?: string;
  lastActiveAt: string;
  lastLoginAt?: string;
  usage: {
    resumesGenerated: number;
    atsChecks: number;
    coverLetters: number;
    interviewPreps: number;
    downloads: number;
  };
}

export interface ContactInfo {
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  linkedin?: string;
  github?: string;
  twitter?: string;
}

export interface ResumeExperience {
  id: string;
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate: string; // "Present" or "YYYY-MM"
  bullets: string[];
  old_bullets?: string[];
}

export interface ResumeEducation {
  id: string;
  institution: string;
  degree: string;
  field?: string;
  location?: string;
  startDate: string;
  endDate: string;
  gpa?: string;
  highlights?: string[];
}

export interface ResumeSkill {
  id: string;
  name: string;
  category?: string;
  level?: "beginner" | "intermediate" | "advanced" | "expert";
}

export interface ResumeProject {
  id: string;
  name: string;
  description?: string;
  url?: string;
  bullets: string[];
}

export interface ResumeCertification {
  id: string;
  name: string;
  issuer?: string;
  date?: string;
  url?: string;
}

export interface ResumeLanguage {
  id: string;
  name: string;
  proficiency: "basic" | "conversational" | "fluent" | "native";
}

export interface ResumeData {
  id: string;
  name: string;
  headline?: string;
  contact: ContactInfo;
  summary?: string;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: ResumeSkill[];
  projects: ResumeProject[];
  certifications: ResumeCertification[];
  languages: ResumeLanguage[];
  achievements?: string[];
  template: ResumeTemplate;
  accentColor?: string;
  photoUrl?: string; // optional profile photo for templates with image frame (infohas-pro)
  dateOfBirth?: string; // optional DOB line shown under contact (infohas-pro)
  createdAt: string;
  updatedAt: string;
  source?: "upload" | "manual" | "ai-optimized" | "ai-optimized-aviation" | "template";
  fileName?: string;
}

export type ResumeTemplate =
  | "ats-professional"
  | "executive"
  | "modern"
  | "corporate"
  | "europass"
  | "creative"
  | "minimal"
  | "infohas-pro"
  | "compact"
  | "tech"
  | "academic"
  | "consulting"
  | "startup"
  | "classic";

export interface JobDescription {
  id: string;
  title: string;
  company?: string;
  location?: string;
  employmentType?: string;
  salary?: string;
  responsibilities: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  technologies: string[];
  experienceYears?: string;
  education?: string;
  keywords: string[];
  rawText?: string;
  source?: "url" | "text" | "linkedin" | "indeed" | "glassdoor";
  url?: string;
  createdAt: string;
}

export interface CoverLetter {
  id: string;
  title: string;
  template: "modern" | "traditional" | "executive" | "email";
  content: string;
  resumeId?: string;
  jdId?: string;
  company?: string;
  role?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewQuestion {
  id: string;
  category: "technical" | "behavioral" | "situational" | "hr" | "company";
  question: string;
  difficulty: "easy" | "medium" | "hard";
  recommendedAnswer: string;
  talkingPoints: string[];
  starExample?: { situation: string; task: string; action: string; result: string };
  followUps: string[];
}

export interface InterviewPackage {
  id: string;
  resumeId?: string;
  jdId?: string;
  company?: string;
  role?: string;
  questions: InterviewQuestion[];
  createdAt: string;
}

export interface ATSScoreBreakdown {
  ats: number;
  formatting: number;
  keywords: number;
  content: number;
  grammar: number;
  completeness: number;
}

export interface ATSRecommendation {
  id: string;
  severity: "critical" | "warning" | "info" | "success";
  category: string;
  title: string;
  description: string;
  fix?: string;
}

export interface ATSReport {
  id: string;
  resumeId: string;
  scores: ATSScoreBreakdown;
  recommendations: ATSRecommendation[];
  missingKeywords: string[];
  matchedKeywords: string[];
  weakSections: string[];
  jdMatchPercent?: number;
  createdAt: string;
}

// ============================================================================
// ResumeReviewReport — comprehensive multi-module AI Resume Review Platform
// Stores the full output of all 10 modules in a single JSON blob per review.
// Persisted to localStorage (`resumeai-review-reports-backup`) and best-effort
// synced to the existing ats_reports D1 table (extra metadata in
// recommendations_json until a dedicated column is added).
// ============================================================================

/** Module 1 — ATS Review */
export interface ReviewATSModule {
  atsScore: number;             // 0-100
  keywordMatch: number;         // 0-100
  missingKeywords: string[];
  formattingIssues: string[];
  sectionDetection: { section: string; detected: boolean; confidence: number }[];
  parsingRisks: string[];
  graphicsRisks: string[];
  tablesRisks: string[];
  fileCompatibility: string[];  // e.g. ["PDF: ✓", "DOCX: ✓", "ATS-friendly: ✓"]
  passProbability: number;      // 0-100 — probability of passing ATS screening
  recommendations: string[];
}

/** Module 2 — Recruiter Review */
export interface ReviewSectionFeedback {
  section: string;              // "Headline" | "Summary" | "Experience" | ...
  score: number;                // 0-10
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}
export interface ReviewRecruiterModule {
  overallScore: number;         // 0-10
  sections: ReviewSectionFeedback[];
}

/** Module 3 — Job Match Review (only when a JD is present) */
export type ReviewJobMatchModule = {
  overallMatch: number;         // 0-100
  atsMatch: number;             // 0-100
  experienceMatch: number;      // 0-100
  skillMatch: number;           // 0-100
  educationMatch: number;       // 0-100
  industryMatch: number;        // 0-100
  missingSkills: string[];
  missingKeywords: string[];
  missingCertifications: string[];
} | null;                       // null when no JD available

/** Module 4 — Industry Benchmark */
export interface ReviewBenchmarkModule {
  industry: string;
  role: string;
  seniority: string;            // "Entry" | "Mid" | "Senior" | "Lead" | "Executive"
  country: string;
  industryReadinessScore: number;  // 0-100
  benchmarkComparisons: { metric: string; candidate: number; industryAverage: number; topPercentile: number }[];
  insights: string[];
}

/** Module 5 — Resume Improvements */
export interface ReviewImprovementsModule {
  betterSummary: string;
  betterHeadlines: string[];    // 3 alternatives
  betterSkills: string[];       // suggested additions
  betterBulletPoints: { original: string; improved: string }[];
  betterAchievements: string[];
  actionVerbs: string[];
  metrics: string[];            // suggested metrics to add
  highValueKeywords: string[];
}

/** Module 6 — Priority Action Plan */
export interface ReviewActionPlanModule {
  criticalFixes: { fix: string; impact: string }[];
  highPriorityFixes: { fix: string; impact: string }[];
  optionalImprovements: { fix: string; impact: string }[];
  expectedAtsIncrease: number;  // estimated points gained if all fixes applied
}

/** Module 8 — Interview Readiness */
export interface ReviewInterviewReadinessModule {
  likelyQuestions: string[];
  weakAreas: string[];
  talkingPoints: string[];
  preparationAdvice: string[];
}

/** Composite report — all 10 modules in one blob */
export interface ResumeReviewReport {
  id: string;
  userId: string;
  resumeId: string;             // primary resume reviewed
  optimizedResumeId?: string;   // optional optimized resume
  jdId?: string;                // optional job description
  companyName?: string;
  industryProfile: string;      // detected industry label
  createdAt: string;
  updatedAt: string;
  // Module data
  ats: ReviewATSModule;
  recruiter: ReviewRecruiterModule;
  jobMatch: ReviewJobMatchModule;
  benchmark: ReviewBenchmarkModule;
  improvements: ReviewImprovementsModule;
  actionPlan: ReviewActionPlanModule;
  interviewReadiness: ReviewInterviewReadinessModule;
  // Aggregate dashboard scores (denormalized for quick UI access)
  dashboard: {
    atsScore: number;
    recruiterScore: number;
    jobMatch: number | null;
    formattingScore: number;
    readabilityScore: number;
    industryBenchmark: number;
  };
}

export type AIProviderType =
  | "puter"
  | "openai"
  | "gemini"
  | "claude"
  | "deepseek"
  | "groq"
  | "mistral"
  | "cohere"
  | "perplexity"
  | "openrouter"
  | "together"
  | "huggingface"
  | "ollama"
  | "azure-openai"
  | "bedrock"
  | "opencode"
  | "opencode-zen"
  | "zencode"
  | "nvidia"
  | "custom";


export interface AIProvider {
  id: string;
  name: string;
  type: AIProviderType;
  // ============================================================
  // PROVIDER CLASSIFICATION (Category A vs Category B)
  // ============================================================
  // Category A: "api" — uses API keys, can run server-side (OpenAI, DeepSeek, etc.)
  // Category B: "browser_auth" — requires browser session (Puter.js)
  providerCategory: "api" | "browser_auth";

  // Capabilities (what the provider supports)
  supportsServerSide: boolean;     // can execute from Worker/backend
  supportsClientSide: boolean;     // can execute from browser
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsJsonMode: boolean;
  requiresBrowserAuth: boolean;    // true for Puter (needs user session)
  requiresApiKey: boolean;         // true for API providers

  apiUrl?: string;
  baseUrl?: string;
  apiKey?: string;
  /** Alternate API keys tried when primary key hits rate limit (429).
   * Each key is tried in order before marking the provider as rate-limited. */
  alternateApiKeys?: string[];
  headersJson?: string;
  parametersJson?: string;
  requestTemplate?: string;
  responsePath?: string;
  streamingEnabled?: boolean;
  modelName?: string;
  priority: number;
  isActive: boolean;
  isDefault?: boolean;
  isFallback?: boolean;
  isBuiltIn?: boolean;
  timeout: number;
  maxTokens: number;
  temperature: number;
  retryAttempts?: number;
  rateLimitPerMinute?: number;
  applicationId?: string;
  clientId?: string;
  redirectUri?: string;
  enabledModels?: string[];
  authType?: "bearer" | "header" | "query" | "none";
  allowedForRegularUsers?: boolean;
  costPerInputToken?: number;
  costPerOutputToken?: number;
  status: "healthy" | "degraded" | "down" | "untested";
  usage: { requests: number; tokens: number; errors: number; avgLatencyMs: number; cost: number };
  lastUsedAt?: string;
  // Health tracking (for Provider Health Dashboard)
  health?: {
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastError?: string;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    rateLimitedUntil?: string;
  };
}

export interface AIProviderLog {
  id: string;
  providerId: string;
  providerName: string;
  requestType: "chat" | "test" | "stream" | "embed";
  modelName?: string;
  status: "success" | "error" | "timeout" | "rate_limited";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
  requestPreview?: string; // first 200 chars of the prompt
  responsePreview?: string; // first 200 chars of the response
  createdAt: string;
}

export interface AIProviderSettings {
  defaultProviderId: string | null;
  defaultModel: string;
  fallbackProviderIds: string[]; // ordered
  retryAttempts: number;
  timeout: number;
  rateLimitPerMinute: number;
  enableFailover: boolean;
  enableCaching: boolean;
  enableCostTracking: boolean;
}

// ============================================================================
// FALLBACK CHAIN CONFIGURATION
//
// User-configurable fallback chain stored in D1 and synced to all pipelines,
// routes, and agents. Replaces the hardcoded fallback logic in ai.ts.
//
// The chain is an ordered list of entries. When the primary provider fails,
// the chain is traversed in order. Each entry specifies:
//   - which provider to use
//   - which model to use (overrides the provider's default model)
//   - whether the entry is enabled
//   - optional generation parameters (temperature, maxTokens, etc.)
// ============================================================================

export interface FallbackChainEntry {
  /** Unique ID for this chain entry (not the provider ID) */
  id: string;
  /** The provider ID to use for this fallback entry */
  providerId: string;
  /** The model to use (overrides the provider's default model) */
  model: string;
  /** Whether this entry is active (disabled entries are skipped) */
  enabled: boolean;
  /** Optional: override the provider's temperature for this fallback */
  temperature?: number;
  /** Optional: override the provider's maxTokens for this fallback */
  maxTokens?: number;
  /** Optional: override the provider's timeout (ms) for this fallback */
  timeoutMs?: number;
  /** Optional: top_p value (0-1) */
  topP?: number;
}

export interface FallbackChainConfig {
  /** Ordered list of fallback entries (index 0 = highest priority) */
  entries: FallbackChainEntry[];
  /** Whether the fallback chain is enabled (if false, uses legacy hardcoded logic) */
  enabled: boolean;
  /** Whether to include Puter as a last-resort fallback before local engine */
  includePuterLastResort: boolean;
  /** Whether to fall back to local engine if all providers fail */
  includeLocalEngineLastResort: boolean;
  /** When true, respects the user's selected primary model and only uses fallback on failure */
  respectPrimarySelection: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  category: "resume" | "ats" | "rewrite" | "translation" | "cover-letter" | "interview" | "summary" | "bullets" | "keywords";
  content: string;
  providerId?: string;
  version: number;
  isActive: boolean;
  variables: string[];
}

export interface BrandingConfig {
  appName: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  emailFromName: string;
  emailFromAddress: string;
  pdfFooterText: string;
}

export interface FeatureFlags {
  enableResumeBuilder: boolean;
  enableATSChecker: boolean;
  enableOptimizer: boolean;
  enableCoverLetter: boolean;
  enableInterviewPrep: boolean;
  enableJDScraper: boolean;
  enableAIFailover: boolean;
  enableDonations: boolean;
  enableAds: boolean;
  maintenanceMode: boolean;
  /**
   * P3: Real-time pipeline updates via WebSocket.
   * When true, the dashboard subscribes to a Durable Object and receives
   * push events for agent status changes (instead of polling every 2s).
   * Default: false — requires the pipeline worker to be deployed.
   */
  pipeline_websocket_enabled?: boolean;
}

/**
 * Optimizer Directive Configuration — tunable parameters that control the
 * InfoHAS Pro resume layout. Super admins can edit these via the
 * "Optimizer Directive" settings page instead of changing source code.
 *
 * When the optimizer runs, these values are injected into the AI prompt
 * (overriding the hardcoded OPTIMIZER_DIRECTIVE defaults) AND into the
 * rendering components (EditableA4Preview, A4Preview, PDF exporter).
 *
 * All measurements are in the units noted in the field name (mm for margins,
 * pt for font sizes, etc.).
 */
export interface OptimizerDirectiveConfig {
  // === PAGE ===
  pageSize: "A4" | "Letter";
  marginTopMm: number;       // top margin in mm
  marginBottomMm: number;    // bottom margin in mm
  marginLeftMm: number;      // left margin in mm
  marginRightMm: number;     // right margin in mm

  // === FONTS ===
  fontFamily: string;        // e.g. "Times New Roman"
  bodyFontSizePt: number;    // body text size (10-11pt typical)
  sectionTitleSizePt: number; // section header size (12-13pt typical)
  nameSizePt: number;        // candidate name size (14pt typical)

  // === COLORS ===
  nameColor: string;         // hex color for candidate name (e.g. "#8B0000")
  sectionTitleColor: string; // hex color for section headers
  bodyTextColor: string;     // hex color for body text

  // === SPACING ===
  lineHeight: number;        // CSS line-height (1.2 = tight, 1.5 = loose)
  sectionGapMm: number;      // gap between sections in mm
  bulletIndentMm: number;    // bullet indent from left margin in mm

  // === PHOTO ===
  photoEnabled: boolean;     // whether to show photo frame
  photoWidthMm: number;      // photo width in mm
  photoHeightMm: number;     // photo height in mm
  showPlaceholderIfNoPhoto: boolean; // show empty box if no photo uploaded

  // === CONTENT LIMITS ===
  summaryMinWords: number;   // minimum words in summary
  summaryMaxWords: number;   // maximum words in summary
  skillsMaxGroups: number;   // max skill category groups
  experienceMaxEntries: number; // max experience entries
  experienceBulletsPerEntry: number; // bullets per experience entry
  educationMaxEntries: number; // max education entries
  languagesMaxEntries: number; // max language entries

  // === ONE-PAGE ENFORCEMENT ===
  enforceOnePage: boolean;   // assert(pdf.pages === 1)
  minFontSizePt: number;     // never go below this font size when compressing

  // === SECTION CHARACTER LIMITS (fine-tunable) ===
  // Per-section min/max character targets for balanced page utilization.
  // The AI prompt includes these limits. QA validates against them.
  // The user can override these in the Optimizer Directive tab.
  sectionLimits: {
    header: { min: number; max: number };         // name + contact line
    summary: { min: number; max: number };         // professional summary
    skills: { min: number; max: number };           // core competencies
    experience: { min: number; max: number };       // all experience entries combined
    education: { min: number; max: number };        // all education entries
    languages: { min: number; max: number };        // languages section
    total: { min: number; max: number };            // total resume chars
  };

  // === CUSTOM DIRECTIVE (ADVANCED) ===
  // If non-empty, this COMPLETELY REPLACES the generated directive text.
  // Use for advanced fine-tuning that the structured fields above can't express.
  customDirectiveOverride: string;

  // === PER-AGENT DIRECTIVES ===
  // Configurable directives for each agent in the multi-agent pipeline.
  // These control what each agent is allowed to do, with what aggressiveness,
  // and with what constraints. They are injected into each agent's prompt.
  agentDirectives: AgentDirectives;
}

/**
 * Per-agent directive configuration.
 * Each agent has its own set of knobs that control its behavior.
 */
export interface AgentDirectives {
  supervisor: SupervisorDirective;
  summary: SummaryAgentDirective;
  skills: SkillsAgentDirective;
  experience: ExperienceAgentDirective;
  education: EducationAgentDirective;
  languages: LanguagesAgentDirective;
}

/**
 * Supervisor Directive — controls the orchestration behavior.
 */
export interface SupervisorDirective {
  /** If true, pipeline hard-fails on any critical issue (no graceful degradation) */
  strictMode: boolean;
  /** If true, retry failed optimization attempts with a different provider */
  enableRetries: boolean;
  /** If true, switch to next provider when current one fails/times out */
  enableProviderSwitch: boolean;
  /** If true, immutable entities (company, dates, education) are enforced post-optimization */
  enforceImmutableEntities: boolean;
  /** If true, emit detailed debug logs to console */
  enableDebugLogs: boolean;
  /** If true, show before/after diff viewer in the UI */
  enableDiffViewer: boolean;
  /** Optional supervisor LLM generation temperature override */
  temperature?: number;
  /** Optional supervisor optimization strictness level (0-100) */
  strictness?: number;
}

/**
 * Summary Agent Directive — controls summary rewriting.
 */
export interface SummaryAgentDirective {
  /** 0-100: how aggressively to inject ATS keywords (0 = minimal, 100 = maximal) */
  atsAggressiveness: number;
  /** If true, never add facts not present in the source resume */
  preserveFacts: boolean;
  /** Maximum character count for the summary */
  maxCharacters: number;
  /** Minimum character count for the summary */
  minCharacters: number;
}

/**
 * Skills Agent Directive — controls skills enrichment.
 */
export interface SkillsAgentDirective {
  /** Maximum number of skills to include */
  maxKeywords: number;
  /** If true, add transferable skills that bridge JD gaps */
  allowTransferableSkills: boolean;
  /** If true, allow company names as skills (FORBIDDEN — always false) */
  allowCompanyKeywords: boolean;
  /** If true, allow location names as skills (FORBIDDEN — always false) */
  allowLocationKeywords: boolean;
}

/**
 * Experience Agent Directive — controls bullet rewriting.
 */
export interface ExperienceAgentDirective {
  /** If true, only rewrite bullets (never title/company/dates/location) */
  rewriteBulletsOnly: boolean;
  /** If true, allow title rewriting (FORBIDDEN in locked pipeline) */
  rewriteTitle: boolean;
  /** If true, allow company rewriting (FORBIDDEN in locked pipeline) */
  rewriteCompany: boolean;
  /** If true, allow date rewriting (FORBIDDEN in locked pipeline) */
  rewriteDates: boolean;
  /** If true, allow location rewriting (FORBIDDEN in locked pipeline) */
  rewriteLocation: boolean;
  /** Max percentage by which bullets can expand vs original (0 = no expansion, 50 = allow 50% longer) */
  maxExpansionPercent: number;
}

/**
 * Education Agent Directive — formatting only, no inference.
 */
export interface EducationAgentDirective {
  /** If true, only format education (never add/infer entries) */
  formatOnly: boolean;
}

/**
 * Languages Agent Directive — formatting only, no inference.
 */
export interface LanguagesAgentDirective {
  /** If true, only format languages (never add/infer entries) */
  formatOnly: boolean;
}

/**
 * ResumeLayoutModel — single source of truth for ALL export layout parameters.
 * Both PDF and DOCX exporters consume this model.
 * Never duplicate layout logic between exporters.
 */
export interface ResumeLayoutModel {
  pageSize: "A4" | "Letter";
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;

  fontFamily: string;
  fallbackFontFamily: string;
  nameSizePt: number;
  sectionTitleSizePt: number;
  bodyFontSizePt: number;

  nameColor: string;
  sectionTitleColor: string;
  bodyTextColor: string;
  contactColor: string;

  lineHeightMm: number;
  sectionGapMm: number;
  headerGapMm: number;
  bulletIndentMm: number;
  paragraphSpacingMm: number;

  photoWidthMm: number;
  photoHeightMm: number;

  enforceOnePage: boolean;
  minFontSizePt: number;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  category: "auth" | "ai" | "resume" | "admin" | "system" | "export";
  details: string;
  severity: "info" | "warning" | "error";
}

// ============================================================================
// AI Development Agent — production-grade autonomous engineering assistant
// ============================================================================

/** Settings for the AI Development Agent. Stored in D1 (ai_agent_settings). */
export interface AIDevAgentSettings {
  providerId: string;          // ID of the AI provider to use (from AI Providers)
  modelName: string;           // e.g. "deepseek-v4-flash"
  temperature: number;         // 0.0 - 2.0
  maxTokens: number;           // max output tokens
  timeout: number;             // request timeout in seconds
  streaming: boolean;          // stream responses
  reasoningLevel: "none" | "minimal" | "low" | "medium" | "high";
  systemPrompt: string;        // custom system prompt for the agent
  fallbackProviderId: string;  // fallback provider if primary fails
  fallbackModel: string;       // fallback model name
  autoScanEnabled: boolean;    // run scheduled scans automatically
  autoReportEnabled: boolean;  // generate reports automatically
  safeApplyEnabled: boolean;   // require staging + approval before applying
  requireApprovalEnabled: boolean; // require super admin approval for changes
}

/** A single issue found during a code audit, security scan, etc. */
export interface AIDevIssue {
  id: string;
  type: "code" | "error" | "route" | "database" | "security" | "performance" | "deployment";
  severity: "info" | "warning" | "error" | "critical";
  file?: string;
  line?: number;
  title: string;
  description: string;
  recommendedFix?: string;
  status: "open" | "fixing" | "fixed" | "ignored";
}

/** A generated patch (unified diff format). */
export interface AIDevPatch {
  id: string;
  title: string;
  description: string;
  diff: string;               // unified git diff
  modifiedFiles: string[];
  newFiles: string[];
  deletedFiles: string[];
  impactAnalysis: string;
  riskAnalysis: "low" | "medium" | "high";
  status: "draft" | "staging" | "tested" | "approved" | "applied" | "rejected";
  generatedTests?: string;    // test code generated for this patch
  createdAt: string;
}

/** A generated feature (UI + API + DB + tests). */
export interface AIDevFeature {
  id: string;
  title: string;
  description: string;
  request: string;            // the original user request
  files: Array<{
    path: string;
    content: string;
    type: "component" | "api" | "migration" | "test" | "config" | "other";
  }>;
  status: "draft" | "staging" | "tested" | "approved" | "applied" | "rejected";
  createdAt: string;
}

/** Health check result for a specific area. */
export interface HealthCheck {
  area: "frontend" | "backend" | "api" | "database" | "security" | "performance" | "accessibility";
  score: number;              // 0-100
  status: "healthy" | "degraded" | "down";
  details: string;
  lastChecked: string;
}

/** Overall application health dashboard data. */
export interface AppHealthDashboard {
  overall: number;            // 0-100
  checks: HealthCheck[];
  lastFullScan: string;
}

/** Audit history entry — stored in D1 (ai_agent_history). */
export interface AIDevAgentHistory {
  id: string;
  userId: string;
  provider: string;           // provider name
  model: string;              // model name
  action: string;             // e.g. "code_audit", "security_scan", "feature_generation"
  prompt: string;             // the prompt sent to the AI
  response: string;           // the AI's response (truncated if very long)
  patch?: string;             // generated patch (if any)
  status: "success" | "failed" | "pending" | "approved" | "rejected";
  createdAt: string;
}

/** Scan report — stored result of an audit/scan. */
export interface AIDevReport {
  id: string;
  type: "code_audit" | "error_analysis" | "route_inspector" | "database_inspector" | "security_scan" | "performance" | "deployment_validation";
  title: string;
  summary: string;
  issues: AIDevIssue[];
  score?: number;             // 0-100 for health metrics
  createdAt: string;
  createdBy: string;
}

// ============================================================================
// AI Workspace — full AI Builder Agent (OpenCode/Cursor-style)
// ============================================================================

/** A file in the repository explorer. */
export interface AIFile {
  path: string;          // e.g. "src/lib/ai.ts"
  content?: string;      // file content (empty for directories)
  type: "file" | "directory";
  language?: string;     // ts, tsx, js, json, sql, css, md, etc.
  size?: number;         // bytes
  lastModified?: string;
}

/** An AI task — a unit of work the AI Builder Agent executes. */
export interface AITask {
  id: string;
  title: string;
  description: string;
  type: "feature" | "fix" | "refactor" | "test" | "migration" | "route" | "api" | "docs";
  status: "draft" | "analyzing" | "planning" | "generating" | "testing" | "ready" | "approved" | "applied" | "rejected" | "failed";
  request: string;       // the original user request
  plan?: string;         // the AI's execution plan
  affectedFiles: string[]; // files that will be modified/created
  generatedPatch?: string;  // unified diff
  generatedTests?: string;  // test code
  buildResult?: AIBuildResult;
  testResult?: AITestResult;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

/** Build validation result. */
export interface AIBuildResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  duration: number;      // ms
  output: string;        // build log (truncated)
  timestamp: string;
}

/** Test run result. */
export interface AITestResult {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;      // ms
  output: string;        // test output (truncated)
  failures: Array<{ name: string; error: string }>;
  timestamp: string;
}

/** A patch in the Patch Center. */
export interface AIWorkspacePatch {
  id: string;
  taskId: string;
  title: string;
  description: string;
  diff: string;          // unified git diff
  modifiedFiles: string[];
  newFiles: string[];
  deletedFiles: string[];
  impactAnalysis: string;
  riskAnalysis: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "applied" | "rolled_back";
  buildResult?: AIBuildResult;
  testResult?: AITestResult;
  appliedAt?: string;
  appliedBy?: string;
  rolledBackAt?: string;
  createdAt: string;
  createdBy: string;
}

/** A git branch in the staging system. */
export interface AIGitBranch {
  name: string;
  isCurrent: boolean;
  isStaging: boolean;    // true for staging branches created by the AI
  lastCommit: string;
  commitCount: number;
  createdAt: string;
}

/** A commit in git history. */
export interface AIGitCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
  filesChanged: number;
}

/** Rollback entry — records what was rolled back. */
export interface AIRollback {
  id: string;
  patchId: string;
  patchTitle: string;
  reason: string;
  rolledBackBy: string;
  rolledBackAt: string;
  previousState: string;  // description of the state before rollback
}

export type ViewKey =
  | "landing"
  | "dashboard"
  | "resumes"
  | "ats-checker"
  | "builder"
  | "optimizer"
  | "cover-letter"
  | "interview"
  | "jd-scraper"
  | "ai-tools"
  | "ai-providers"
  | "ai-models"
  | "ai-settings"
  | "ai-logs"
  | "prompts"
  | "branding"
  | "admin"
  | "super-admin"
  | "analytics"
  | "users"
  | "user-approvals"
  | "suspended-users"
  | "logs"
  | "feature-flags"
  | "optimizer-directive"
  | "fallback-chain"
  | "pipeline-profiles"
  | "agent-config"
  | "ai-dev-agent"
  | "ai-workspace"
  | "ai-achievement"
  | "downloads"
  | "settings"
  | "linkedin-import"
  | "resume-versioning"
  | "multi-language"
  | "resume-sharing"
  | "ab-testing"
  | "bulk-generator"
  | "resume-analytics"
  | "app-tracker"
  | "salary-insights"
  | "skill-gap"
  | "career-path"
  | "company-research"
  | "job-alerts"
  | "cert-tracker"
  | "networking"
  | "ai-coach"
  | "ai-mock-interview"
  | "ai-salary-coach"
  | "ai-email-writer"
  | "ai-resume-review"
  | "ai-job-match"
  | "integrations";

export interface AIHealingIssue {
  id: string;
  file?: string;
  line?: number;
  area: "frontend" | "backend" | "api" | "database" | "provider" | "pipeline" | "security" | "performance" | "system";
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  description: string;
  suggestedFix: string;
  status: "open" | "fixed" | "needs_review" | "failed";
  rootCause?: string;
  confidence?: number;
  reasoning?: string;
  patch?: string; // Unified git diff
  buildStatus?: "PASS" | "FAIL" | "PENDING";
  testStatus?: "PASS" | "FAIL" | "PENDING";
  risk?: "LOW" | "MEDIUM" | "HIGH";
  code?: string;
}

export interface AIHealingReport {
  issuesFound: number;
  autoFixed: number;
  needsReview: number;
  failed: number;
  filesChanged: number;
  testsPassed: number;
  buildStatus: "PASS" | "FAIL";
}

