// ResumeAI Pro — core domain types

export type Role = "guest" | "user" | "admin" | "super_admin";

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: Role;
  provider: "email" | "google" | "github" | "linkedin" | "puter" | "magic";
  createdAt: string;
  lastActiveAt: string;
  usage: {
    resumesGenerated: number;
    atsChecks: number;
    coverLetters: number;
    interviewPreps: number;
    downloads: number;
  };
  status: "active" | "suspended";
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
  apiUrl?: string;
  apiKey?: string; // encrypted in real impl; here we just store (sandbox)
  headersJson?: string;
  parametersJson?: string;
  modelName?: string;
  priority: number;
  isActive: boolean;
  isBuiltIn?: boolean;
  timeout: number;
  maxTokens: number;
  temperature: number;
  status: "healthy" | "degraded" | "down";
  usage: { requests: number; tokens: number; errors: number; avgLatencyMs: number };
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
  | "prompts"
  | "branding"
  | "admin"
  | "super-admin"
  | "analytics"
  | "users"
  | "logs"
  | "feature-flags"
  | "downloads"
  | "settings";
