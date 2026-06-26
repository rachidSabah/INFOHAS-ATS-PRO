// ============================================================================
// Pipeline Orchestration Types
//
// Additive types for the enhanced Supervisor Agent architecture.
// These types do NOT replace any existing types — they extend the platform
// with configurable pipeline profiles, per-agent configuration, shared
// memory, prompt versioning, confidence scoring, targeted regeneration,
// hybrid matching, and weighted quality gates.
//
// All configuration is stored in D1 and editable from the UI.
// ============================================================================

"use client";

// ============================================================================
// 1. PIPELINE PROFILES
// ============================================================================

export type PipelineProfileType =
  | "legacy-v2"      // Old V2 pipeline (standard optimizer only)
  | "legacy-v3"      // V2 + V3 post-optimization agents
  | "locked"         // Locked pipeline (bullet-only optimizer + assembler)
  | "hybrid"         // Locked pipeline + V3 agents + targeted regeneration (recommended)
  | "custom";        // Full manual configuration

export interface PipelineProfile {
  id: string;
  name: string;
  description: string;
  type: PipelineProfileType;
  /** Agent IDs enabled in this profile, in execution order */
  enabledAgents: string[];
  /** Agents that can run in parallel (grouped by execution stage) */
  parallelGroups: string[][];
  /** Whether V3 post-optimization agents run after the main optimizer */
  enableV3PostOptimization: boolean;
  /** Whether the locked pipeline (bullet-only optimizer) is used */
  useLockedPipeline: boolean;
  /** Whether targeted regeneration is enabled (section-level retry) */
  enableTargetedRegeneration: boolean;
  /** Matching strategy for entity restoration */
  matchingStrategy: "strict" | "hybrid" | "fuzzy";
  /** Confidence threshold for hybrid matching fallback (0-100) */
  hybridMatchingThreshold: number;
  /** Retry policy */
  maxRetries: number;
  /** Validation thresholds for quality gates */
  validationThresholds: ValidationThresholds;
  /** Whether this profile is user-editable (built-in profiles are read-only) */
  isBuiltIn: boolean;
  /** Whether this is the currently selected profile */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationThresholds {
  minAtsScore: number;           // 0-100
  minFactualConsistency: number; // 0-100
  minKeywordCoverage: number;    // 0-100
  minHtmlValidation: number;     // 0-100
  minGrammarScore: number;       // 0-100
  minRecruiterReadability: number; // 0-100
  minSemanticSimilarity: number; // 0-100
  minConfidenceScore: number;    // 0-100
  minQualityScore: number;       // 0-100
  enforceOnePage: boolean;
}

// ============================================================================
// 2. PER-AGENT CONFIGURATION
// ============================================================================

export type AgentType =
  | "supervisor"
  | "parser"
  | "entity-lock"
  | "job-intelligence"
  | "company-intelligence"
  | "skill-gap"
  | "ats-analysis"
  | "summary-optimizer"
  | "skills-optimizer"
  | "experience-optimizer"
  | "education-languages"
  | "additional-info"
  | "resume-assembler"
  | "structure-guardian"
  | "entity-restoration"
  | "factual-consistency"
  | "quality-assurance"
  | "reflection"
  | "cover-letter"
  | "interview-prep"
  | "career-coach"
  | "recovery";

export interface AgentConfig {
  id: string;
  agentType: AgentType;
  displayName: string;
  description: string;
  version: string;
  executionOrder: number;
  enabled: boolean;
  /** Whether this agent can run in parallel with others in its group */
  parallelExecution: boolean;
  /** Agent IDs that must complete before this agent starts */
  dependencies: string[];
  /** Only run when required (skip if input doesn't need this agent) */
  runOnlyWhenRequired: boolean;
  enableLogging: boolean;
  enableDebugMode: boolean;

  // === Provider & Model ===
  providerId: string;
  model: string;
  /** Quality mode preset */
  qualityMode: "fast" | "balanced" | "high-quality";

  // === Generation Parameters ===
  temperature: number;
  topP: number;
  topK?: number;
  presencePenalty: number;
  frequencyPenalty: number;
  maxTokens: number;
  contextLength: number;
  seed?: number;
  stopSequences: string[];

  // === Reasoning ===
  reasoningEnabled: boolean;
  reasoningEffort: "low" | "medium" | "high" | "maximum";
  maxThinkingTokens: number;
  reasoningTimeoutMs: number;

  // === Streaming ===
  streamingEnabled: boolean;
  streamPartialResponses: boolean;
  streamThinkingProcess: boolean;
  streamTokenStatistics: boolean;

  // === Retry ===
  maxRetryCount: number;
  retryDelayMs: number;
  exponentialBackoff: boolean;
  retryOnTimeout: boolean;
  retryOnRateLimit: boolean;
  retryOnNetworkError: boolean;
  retryOnInvalidOutput: boolean;

  // === Timeout ===
  requestTimeoutMs: number;
  totalAgentTimeoutMs: number;
  maxQueueWaitMs: number;

  // === Fallback Chain (per-agent) ===
  fallbackChain: AgentFallbackEntry[];

  // === Prompt ===
  promptId: string;       // References PromptVersion.id
  promptVersion: number;  // Specific version number

  // === Validation Rules ===
  minConfidenceScore: number;
  minQualityScore: number;
  minAtsScore: number;
  minSemanticSimilarity: number;
  minHtmlValidationScore: number;
  onFailureAction: "retry" | "reflect" | "regenerate-targeted" | "fallback-model" | "stop-pipeline";

  // === Memory ===
  readFromSharedMemory: boolean;
  writeToSharedMemory: boolean;
  memorySectionsUsed: string[];
  cacheResults: boolean;
  cacheDurationMs: number;
  persistIntermediateResults: boolean;

  // === Output ===
  outputFormat: "json" | "html" | "markdown" | "plain-text";
  outputVisibility: "public" | "internal" | "supervisor-only";

  // === Monitoring (runtime metrics — not user-configured) ===
  metrics?: AgentMetrics;
  lastExecutedAt?: string;
  averageExecutionTimeMs?: number;
  averageTokenUsage?: number;
  successRate?: number;
  failureRate?: number;

  createdAt: string;
  updatedAt: string;
}

export interface AgentFallbackEntry {
  id: string;
  providerId: string;
  model: string;
  temperature: number;
  contextLength: number;
  maxTokens: number;
  timeoutMs: number;
  enabled: boolean;
}

export interface AgentMetrics {
  currentProvider?: string;
  currentModel?: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  executionTimeMs: number;
  costEstimate: number;
  retryCount: number;
  fallbackUsed: boolean;
  confidenceScore: number;
  qualityScore: number;
}

// ============================================================================
// 3. SHARED STRUCTURED MEMORY (Supervisor Memory)
// ============================================================================

export interface SupervisorMemory {
  /** Unique execution ID for this pipeline run */
  executionId: string;
  /** Timestamp when the pipeline started */
  startedAt: string;
  /** Timestamp when the pipeline completed (set at end) */
  completedAt?: string;

  // === Input data (immutable after pipeline start) ===
  resumeJson?: any;              // The parsed source resume
  jobDescriptionJson?: any;      // The parsed job description
  rawResumeText?: string;        // Original resume text (for fallback)

  // === Intelligence (produced by intelligence agents) ===
  companyIntelligence?: any;
  jobIntelligence?: any;
  skillGapAnalysis?: any;
  atsKeywords?: string[];
  atsAnalysis?: any;

  // === Optimization output (produced by optimizer agents) ===
  optimizerOutput?: any;         // Raw LLM output
  assembledResume?: any;         // Merged resume from assembler

  // === Validation results ===
  qaResults?: any;
  reflectionNotes?: any;
  factualConsistency?: any;
  structureGuardianResult?: any;
  fingerprintValidation?: any;

  // === Layout & export ===
  layoutMetadata?: {
    charCount: number;
    pageFill: number;
    onePageValid: boolean;
    renderedHeightPx?: number;
  };
  exportMetadata?: {
    pdfPages?: number;
    docxValid?: boolean;
    htmlValid?: boolean;
  };

  // === Execution log ===
  agentExecutions: AgentExecutionRecord[];
  /** Shared scratchpad for agents to pass data to each other */
  scratchpad: Record<string, any>;
}

export interface AgentExecutionRecord {
  agentId: string;
  agentType: AgentType;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  provider?: string;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
  confidenceScore?: number;
  qualityScore?: number;
  error?: string;
  retryCount?: number;
  fallbackUsed?: boolean;
}

// ============================================================================
// 4. PROMPT VERSIONING
// ============================================================================

export interface PromptVersion {
  id: string;
  /** Which agent this prompt is for */
  agentType: AgentType;
  name: string;
  description: string;
  version: number;
  /** The prompt content with {{variable}} placeholders */
  systemPrompt: string;
  developerPrompt?: string;
  userPromptTemplate: string;
  /** Available variables for substitution */
  variables: PromptVariable[];
  /** Whether this version is published (active) or a draft */
  status: "draft" | "published" | "archived";
  /** Who created/modified this prompt */
  createdBy: string;
  createdAt: string;
  lastModified: string;
  /** Test results for this prompt version */
  testResults?: PromptTestResult[];
}

export interface PromptVariable {
  name: string;
  description: string;
  defaultValue?: string;
  required: boolean;
}

export interface PromptTestResult {
  id: string;
  testedAt: string;
  testedBy: string;
  provider: string;
  model: string;
  inputPreview: string;
  outputPreview: string;
  confidenceScore?: number;
  qualityScore?: number;
  latencyMs?: number;
  tokensUsed?: number;
  passed: boolean;
  notes?: string;
}

// ============================================================================
// 5. CONFIDENCE SCORING
// ============================================================================

export interface ConfidenceResult {
  confidence: number;        // 0-100
  qualityScore: number;      // 0-100
  latency: number;           // seconds
  tokenUsage: number;
  promptTokens: number;
  completionTokens: number;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  retryCount: number;
  /** Breakdown of confidence by factor */
  factors: ConfidenceFactor[];
  timestamp: string;
}

export interface ConfidenceFactor {
  name: string;
  score: number;  // 0-100
  weight: number; // 0-1
  details?: string;
}

// ============================================================================
// 6. TARGETED REGENERATION
// ============================================================================

export type RegenerationTarget =
  | "summary"
  | "headline"
  | "skills"
  | "experience-entry"  // requires experienceIndex
  | "education"
  | "languages"
  | "formatting"
  | "export-layout";

export interface RegenerationRequest {
  id: string;
  target: RegenerationTarget;
  /** For experience-entry target, which entry index */
  experienceIndex?: number;
  /** Why regeneration was requested */
  reason: string;
  /** Which quality gate failed */
  failedGate?: string;
  /** Current attempt number */
  attempt: number;
  maxAttempts: number;
  /** Sections that are APPROVED and must NOT be touched */
  approvedSections: string[];
}

export interface RegenerationResult {
  request: RegenerationRequest;
  status: "success" | "failed" | "skipped";
  regeneratedSection: string;
  beforePreview: string;
  afterPreview: string;
  confidenceScore?: number;
  qualityScore?: number;
  error?: string;
}

// ============================================================================
// 7. HYBRID MATCHING
// ============================================================================

export interface MatchingResult {
  strategy: "strict" | "hybrid" | "fuzzy";
  matched: boolean;
  confidence: number;  // 0-100
  matchedEntry?: any;
  method: "id" | "fingerprint" | "title-company" | "index" | "none";
  warnings: string[];
  /** Log of all matching attempts (for debugging) */
  attempts: MatchingAttempt[];
}

export interface MatchingAttempt {
  strategy: "strict" | "hybrid" | "fuzzy";
  method: "id" | "fingerprint" | "title-company" | "index";
  confidence: number;
  matched: boolean;
  details: string;
}

// ============================================================================
// 8. QUALITY GATES
// ============================================================================

export type QualityGateType =
  | "ats-score"
  | "factual-consistency"
  | "keyword-coverage"
  | "html-validation"
  | "grammar"
  | "recruiter-readability"
  | "one-page"
  | "export-validation"
  | "semantic-similarity"
  | "confidence-score"
  | "quality-score";

export interface QualityGate {
  type: QualityGateType;
  name: string;
  description: string;
  weight: number;       // 0-1 (relative importance in overall score)
  threshold: number;    // 0-100 (minimum passing score)
  enabled: boolean;
  /** What to do when this gate fails */
  onFailureAction: "retry" | "reflect" | "regenerate-targeted" | "fallback-model" | "stop-pipeline";
  /** Which section to regenerate (for regenerate-targeted action) */
  regenerationTarget?: RegenerationTarget;
}

export interface QualityGateResult {
  gate: QualityGate;
  score: number;        // 0-100
  passed: boolean;
  details?: string;
  /** If failed, what regeneration is needed */
  regenerationNeeded?: RegenerationTarget;
}

export interface QualityGateEvaluation {
  results: QualityGateResult[];
  overallScore: number;  // weighted average
  passed: boolean;       // all enabled gates passed
  failedGates: QualityGateResult[];
}

// ============================================================================
// 9. PIPELINE EXECUTION PLAN (built by Supervisor)
// ============================================================================

export interface ExecutionPlan {
  executionId: string;
  profileId: string;
  profileName: string;
  /** Ordered stages of execution — agents within a stage run in parallel */
  stages: ExecutionStage[];
  /** Shared memory for this execution */
  memory: SupervisorMemory;
  /** Quality gates to evaluate */
  qualityGates: QualityGate[];
  createdAt: string;
}

export interface ExecutionStage {
  id: string;
  name: string;
  /** Agents in this stage (run in parallel if parallelExecution is true) */
  agents: string[];
  /** Whether agents in this stage run in parallel */
  parallel: boolean;
  /** Stages that must complete before this stage starts */
  dependencies: string[];
}

// ============================================================================
// 10. SUPERVISOR ORCHESTRATION RESULT
// ============================================================================

export interface SupervisorResult {
  executionId: string;
  status: "completed" | "failed" | "requires-manual-review";
  resume: any;  // ResumeData
  profile: PipelineProfile;
  qualityGates: QualityGateEvaluation;
  confidence: ConfidenceResult;
  memory: SupervisorMemory;
  regenerations: RegenerationResult[];
  provider: string;
  model: string;
  charCount: number;
  onePageValid: boolean;
  warnings: string[];
  errors: string[];
  /** Total execution time in ms */
  totalExecutionTimeMs: number;
  /** Total tokens used across all agents */
  totalTokensUsed: number;
  /** Estimated cost in USD */
  estimatedCost: number;
  completedAt: string;
}
