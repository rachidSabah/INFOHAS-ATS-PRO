// ============================================================================
// Plugin SDK — Type Definitions
// ============================================================================
// SDK-specific types. ResumeData and related domain types are imported
// from the project's canonical types.ts (src/lib/types.ts) to avoid drift.
// ============================================================================

import type {
  ResumeData as ProjectResumeData,
  ResumeExperience as ProjectResumeExperience,
  ResumeEducation as ProjectResumeEducation,
  ResumeSkill as ProjectResumeSkill,
  ResumeLanguage as ProjectResumeLanguage,
  ResumeCertification as ProjectResumeCertification,
  ResumeProject as ProjectResumeProject,
  DynamicSection as ProjectDynamicSection,
} from '../types';

// Re-export the project's canonical types
export type ResumeData = ProjectResumeData;
export type ResumeExperience = ProjectResumeExperience;
export type ResumeEducation = ProjectResumeEducation;
export type ResumeSkill = ProjectResumeSkill;
export type ResumeLanguage = ProjectResumeLanguage;
export type ResumeCertification = ProjectResumeCertification;
export type ResumeProject = ProjectResumeProject;
export type DynamicSection = ProjectDynamicSection;

// Helper types used by the plugin SDK that don't exist in the project
export interface ResumeContact {
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  website?: string;
  [key: string]: unknown;
}

export interface DynamicSectionItem {
  id: string;
  title?: string;
  subtitle?: string;
  date?: string;
  description?: string;
  bullets?: string[];
  [key: string]: unknown;
}

export interface BlueprintSection {
  type: string;
  raw: string;
  normalizedTitle: string;
  items: BlueprintItem[];
}

export interface BlueprintItem {
  id: string;
  raw: string;
  fields: Record<string, string>;
  confidence: number;
}

// ============================================================================
// Plugin Manifest
// ============================================================================

export interface PluginManifest {
  id: string;                 // e.g. "provider.anthropic-claude"
  name: string;
  version: string;            // semver
  author: string;
  description: string;
  capabilities: string[];     // e.g. ["reasoning", "json", "streaming"]
  dependencies: PluginDependency[];
  entry: string;              // module path, resolved at build time
  configuration: PluginConfigSchema;
  permissions: PluginPermission[];
}

export interface PluginDependency {
  id: string;
  versionRange: string;       // semver range, e.g. ">=1.0.0 <2.0.0"
}

export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    required?: boolean;
    default?: unknown;
    enum?: string[];
  }>;
  required?: string[];
}

export type PluginPermission =
  | `d1:read:${string}`
  | `d1:write:${string}`
  | `kv:read:${string}`
  | `kv:write:${string}`
  | 'secrets:ai_provider_keys'
  | 'network:fetch';

// ============================================================================
// Provider Capabilities
// ============================================================================

export interface ProviderCapabilities {
  reasoning: boolean;
  vision: boolean;
  json: boolean;
  streaming: boolean;
  functionCalling: boolean;
  maxTokens: number;
  contextWindow: number;
  cost: ProviderCost;
  latencyMs: number;
  authentication: 'apiKey' | 'oauth' | 'none';
  reliability: number;       // 0-1
  availability: number;      // 0-1
  structuredOutput: boolean;
}

export interface ProviderCost {
  input: number;    // $ per 1K tokens
  output: number;   // $ per 1K tokens
}

// ============================================================================
// Provider Request/Response
// ============================================================================

export interface ProviderRequest {
  model: string;
  messages: ProviderMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  jsonMode?: boolean;
  stop?: string[];
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

// ============================================================================
// Pipeline Context
// ============================================================================

export interface PipelineContext {
  resumeId: string;
  resume: ResumeData;
  directive: OptimizationDirective;
  blueprint?: Record<string, unknown>;
  optimizationResult?: ResumeData;
  providerResults?: Array<{
    providerId: string;
    result: ProviderResponse;
    durationMs: number;
  }>;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Optimization Directive
// ============================================================================

export interface OptimizationDirective {
  id: string;
  resumeId: string;
  version: number;
  targetJobTitle?: string;
  targetCompany?: string;
  jobDescription?: string;
  industry?: string;
  tone?: 'professional' | 'concise' | 'achievement-focused' | string;
  atsStrictness?: 'low' | 'medium' | 'high';
  language?: string;
  customInstructions?: string;
  createdAt: string;
}

// ============================================================================
// Pipeline Events
// ============================================================================

export type PipelineEvent =
  | { type: 'OptimizationStarted'; resumeId: string }
  | { type: 'OptimizationCompleted'; resumeId: string; durationMs: number }
  | { type: 'ProviderChanged'; from: string; to: string; reason: string }
  | { type: 'PluginLoaded'; pluginId: string; version: string }
  | { type: 'PluginFailed'; pluginId: string; error: string }
  | { type: 'ExportStarted'; resumeId: string; format: ExportFormat }
  | { type: 'ExportCompleted'; resumeId: string; format: ExportFormat }
  | { type: 'GuardianRejected'; resumeId: string; reason: string }
  | { type: 'ATSCompleted'; resumeId: string; score: number }
  | { type: 'ParserCompleted'; resumeId: string; sectionCount: number }
  | { type: 'DirectiveApplied'; resumeId: string; directiveId: string; agentsNotified: string[] };

export type ExportFormat = 'preview' | 'docx' | 'pdf' | 'html' | 'txt' | 'markdown' | 'json';

// ============================================================================
// Guardian Result
// ============================================================================

export interface GuardianResult {
  passed: boolean;
  violations: GuardianViolation[];
  warnings: string[];
}

export interface GuardianViolation {
  severity: 'critical' | 'high' | 'medium' | 'low';
  field: string;
  message: string;
  expected: unknown;
  actual: unknown;
}

// ============================================================================
// Export Result
// ============================================================================

export interface ExportResult {
  ok: boolean;
  format: ExportFormat;
  pages?: number;
  error?: string;
  data?: Blob | string | Uint8Array;
}

// ============================================================================
// ATS Score
// ============================================================================

export interface ATSScore {
  overall: number;
  categories: Record<string, number>;
  suggestions: string[];
}

// ============================================================================
// Industry Vocabulary
// ============================================================================

export interface IndustryVocabulary {
  industry: string;
  competencies: string[];
  keywords: string[];
  atsVocabulary: string[];
  professionalTerms: string[];
}

// ============================================================================
// Health Status
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

// ============================================================================
// Auth
// ============================================================================

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  error?: string;
}

// ============================================================================
// Rendered Document
// ============================================================================

export interface RenderedDocument {
  type: 'html' | 'xml' | 'json';
  content: string;
  pageCount?: number;
  metadata: Record<string, unknown>;
}
