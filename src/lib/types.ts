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
}

export interface ResumeEducation {
  id: string;
  institution: string;
  degree: string;
  field?: string;
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
  source?: "upload" | "manual" | "ai-optimized" | "template";
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
  | "infohas-pro";

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
  | "custom"
  | "z-ai-fallback";

export interface AIProvider {
  id: string;
  name: string;
  type: AIProviderType;
  apiUrl?: string;          // base URL (alias of base_url)
  baseUrl?: string;         // base URL (canonical name from spec)
  apiKey?: string;          // encrypted at rest in production
  headersJson?: string;     // custom headers (JSON)
  parametersJson?: string;  // custom parameters (JSON)
  requestTemplate?: string; // for custom providers: request body template (JSON with {{vars}})
  responsePath?: string;    // for custom providers: JSON path to extract text (e.g. "choices[0].message.content")
  streamingEnabled?: boolean;
  modelName?: string;
  priority: number;
  isActive: boolean;
  isDefault?: boolean;      // default provider for new requests
  isFallback?: boolean;     // included in fallback chain
  isBuiltIn?: boolean;
  timeout: number;
  maxTokens: number;
  temperature: number;
  retryAttempts?: number;
  rateLimitPerMinute?: number;
  // Puter.js-specific fields
  applicationId?: string;
  clientId?: string;
  redirectUri?: string;
  enabledModels?: string[];
  // Auth type for custom providers
  authType?: "bearer" | "header" | "query" | "none";
  // Supports function calling
  supportsFunctionCalling?: boolean;
  // Whether regular (non-super-admin) users can use this provider.
  // Super admins control this flag per-provider. When false, only super admins
  // can route AI requests through this provider. Default: false (super-admin-only).
  allowedForRegularUsers?: boolean;
  // Cost estimation (USD per 1K tokens)
  costPerInputToken?: number;
  costPerOutputToken?: number;
  status: "healthy" | "degraded" | "down" | "untested";
  usage: { requests: number; tokens: number; errors: number; avgLatencyMs: number; cost: number };
  lastUsedAt?: string;
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
  | "downloads"
  | "settings";
