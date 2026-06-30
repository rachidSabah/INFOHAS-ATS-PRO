// ============================================================================
// Plugin SDK — Core Interfaces
// ============================================================================
// All cross-module dependencies in Phase 8 are typed against these interfaces,
// never against concrete classes. Implementations are bound in ServiceContainer.
// ============================================================================

import type {
  ProviderCapabilities, ProviderRequest, ProviderResponse,
  PipelineContext, ResumeData, ExportFormat, ExportResult,
  IndustryVocabulary, ATSScore, GuardianResult,
  AuthResult, RenderedDocument, HealthStatus,
} from '../types';

// ============================================================================
// AI Provider
// ============================================================================

export interface IAIProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  call(req: ProviderRequest): Promise<ProviderResponse>;
  healthCheck(): Promise<HealthStatus>;
}

// ============================================================================
// Agent (pipeline stage worker)
// ============================================================================

export interface IAgent {
  readonly id: string;
  run(ctx: PipelineContext): Promise<PipelineContext>;
}

// ============================================================================
// Exporter (output format)
// ============================================================================

export interface IExporter {
  readonly format: ExportFormat;
  export(data: ResumeData): Promise<ExportResult>;
}

// ============================================================================
// Template (rendering layout)
// ============================================================================

export interface ITemplate {
  readonly id: string;
  render(data: ResumeData): RenderedDocument;
}

// ============================================================================
// Industry Engine (vocabulary + knowledge graph)
// ============================================================================

export interface IIndustryEngine {
  readonly industry: string;
  getVocabulary(): IndustryVocabulary;
}

// ============================================================================
// ATS Scoring
// ============================================================================

export interface IATSProvider {
  score(data: ResumeData, jobDescription: string): Promise<ATSScore>;
}

// ============================================================================
// Guardian (output validation)
// ============================================================================

export interface IGuardian {
  readonly id: string;
  validate(original: ResumeData, optimized: ResumeData): GuardianResult;
}

// ============================================================================
// Parser (raw resume → blueprint)
// ============================================================================

export interface IParser {
  readonly id: string;
  parse(rawResume: Buffer | string): Promise<PipelineContext>;
}

// ============================================================================
// Renderer (section-level rendering)
// ============================================================================

export interface ISectionRenderer {
  render(section: unknown): RenderedNode;
}

export interface RenderedNode {
  type: string;
  props: Record<string, unknown>;
  children?: RenderedNode[];
  content?: string;
}

// ============================================================================
// Authentication
// ============================================================================

export interface IAuthenticationProvider {
  readonly id: string;
  authenticate(req: Request): Promise<AuthResult>;
}

// ============================================================================
// Storage (scoped D1/KV access)
// ============================================================================

export interface IStorageProvider {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}
