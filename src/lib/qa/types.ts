// ResumeAI Pro — QA System Type Definitions
// Unified type system for the QA, Debug, and Self-Healing infrastructure.

// ============================================================================
// Test Infrastructure
// ============================================================================

export type TestCategory =
  | "browser"
  | "api"
  | "pipeline"
  | "provider"
  | "export"
  | "persistence"
  | "performance"
  | "cache"
  | "ats"
  | "regression";

export type TestSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface QATestResult {
  id: string;
  name: string;
  category: TestCategory;
  severity: TestSeverity;
  passed: boolean;
  message: string;
  durationMs: number;
  timestamp: string;
  details?: Record<string, unknown>;
  error?: string;
  suggestion?: string;
}

export interface QATestSuite {
  name: string;
  category: TestCategory;
  results: QATestResult[];
  totalPassed: number;
  totalFailed: number;
  totalDurationMs: number;
}

export interface QARunReport {
  status: "passed" | "failed" | "partial";
  timestamp: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDurationMs: number;
  suites: QATestSuite[];
  allResults: QATestResult[];
  criticalFailures: QATestResult[];
  suggestions: string[];
  coverage: Record<TestCategory, { total: number; passed: number; failed: number }>;
}

// ============================================================================
// Provider Tests
// ============================================================================

export interface ProviderTestResult {
  providerId: string;
  providerName: string;
  providerType: string;
  reachable: boolean;
  aiResponseReceived: boolean;
  responseLength: number;
  responseTimeMs: number;
  networkErrors: string[];
  authErrors: string[];
  rateLimitHit: boolean;
  passed: boolean;
  message: string;
}

export const EXPECTED_PROVIDERS = [
  "puter",
  "openai",
  "gemini",
  "anthropic",
  "openrouter",
  "deepseek",
  "nvidia",
  "groq",
  "mistral",
  "opencode",
  "cohere",
  "custom",
] as const;

// ============================================================================
// Pipeline Tests
// ============================================================================

export interface PipelineStageResult {
  stage: string;
  stageIndex: number;
  completed: boolean;
  durationMs: number;
  outputValid: boolean;
  error?: string;
}

export const PIPELINE_STAGES = [
  "Resume Upload & Parsing",
  "Job Intelligence",
  "Company Intelligence",
  "Skill Gap Analysis",
  "ATS Analysis (Before)",
  "Resume Optimizer",
  "Quality Assurance",
  "Reflection",
  "Export",
] as const;

// ============================================================================
// Export Tests
// ============================================================================

export interface ExportTestResult {
  format: "pdf" | "docx" | "doc" | "txt";
  generated: boolean;
  contentLength: number;
  pageCount: number;
  sectionsIntact: boolean;
  textAlignmentPreserved: boolean;
  noTruncation: boolean;
  identicalContent: boolean;
  error?: string;
}

// ============================================================================
// Cache Tests
// ============================================================================

export interface CacheTestResult {
  cacheName: string;
  totalEntries: number;
  expiredEntries: number;
  offlineOptimizationsCached: boolean;
  failedOptimizationsCached: boolean;
  keyStructureValid: boolean;
  missingKeyComponents: string[];
  passed: boolean;
  message: string;
}

export const REQUIRED_CACHE_KEY_COMPONENTS = [
  "userId",
  "resumeHash",
  "jobHash",
  "provider",
  "model",
  "industryMode",
  "directiveHash",
] as const;

// ============================================================================
// Silent Failure Detection
// ============================================================================

export interface SilentFailureMatch {
  file: string;
  line: number;
  column: number;
  pattern: string;
  snippet: string;
  severity: TestSeverity;
  suggestion: string;
}

export interface SilentFailureReport {
  totalMatches: number;
  criticalMatches: number;
  matches: SilentFailureMatch[];
  passed: boolean;
}

export const SILENT_FAILURE_PATTERNS = [
  { regex: /catch\s*\([^)]*\)\s*\{\s*\}/g, pattern: "catch(e){}", severity: "critical" as const, suggestion: "Add error logging and reporting" },
  { regex: /catch\s*\(\s*\)\s*\{/g, pattern: "catch() {", severity: "critical" as const, suggestion: "Catch must capture and handle the error" },
  { regex: /catch\s*\(\w+\)\s*\{\s*\}/g, pattern: "catch(e) {}", severity: "critical" as const, suggestion: "Empty catch block — log, surface, or report the error" },
  { regex: /return\s+fallback\b/gi, pattern: "return fallback", severity: "high" as const, suggestion: "Fallback without logging the original error" },
  { regex: /return\s+preview\b/gi, pattern: "return preview", severity: "high" as const, suggestion: "Preview fallback may hide real failures" },
  { regex: /return\s+snippet\b/gi, pattern: "return snippet", severity: "high" as const, suggestion: "Snippet fallback may hide real failures" },
  { regex: /return\s+localOptimization\b/gi, pattern: "return localOptimization", severity: "critical" as const, suggestion: "Local optimization fallback hides provider failures" },
  { regex: /return\s+cachedOptimization\b/gi, pattern: "return cachedOptimization", severity: "high" as const, suggestion: "Cached optimization fallback — log the failure first" },
];

// ============================================================================
// Optimization Quality Gates
// ============================================================================

export interface OptimizationQualityGate {
  name: string;
  passed: boolean;
  value: number | boolean | string;
  threshold?: number | string;
  message: string;
}

export const QUALITY_THRESHOLDS = {
  MIN_OPTIMIZATION_CHARS: 2200,
  MIN_CHARACTER_COUNT: 2400,
  MIN_PAGE_USAGE_PERCENT: 85,
  MIN_FACTUAL_CONSISTENCY: 80,
  MIN_OPTIMIZATION_DURATION_MS: 1000,
  MIN_RESPONSE_LENGTH: 2200,
} as const;

// ============================================================================
// Performance Metrics
// ============================================================================

export interface PerformanceMetric {
  name: string;
  valueMs: number;
  thresholdMs: number;
  passed: boolean;
  timestamp: string;
}

export interface PerformanceReport {
  apiLatency: PerformanceMetric[];
  pipelineDuration: PerformanceMetric[];
  exportDuration: PerformanceMetric[];
  renderDuration: PerformanceMetric[];
  allPassed: boolean;
  alertReasons: string[];
}

// ============================================================================
// Self-Healing
// ============================================================================

export type HealingAction =
  | "retry_provider"
  | "disable_provider_temporarily"
  | "purge_cache"
  | "restore_original"
  | "regenerate_export"
  | "abort_pipeline";

export interface HealingEvent {
  id: string;
  timestamp: string;
  trigger: string;
  action: HealingAction;
  result: "success" | "failed" | "pending";
  details: string;
  providerId?: string;
  resumeId?: string;
}

export interface SelfHealingState {
  recentEvents: HealingEvent[];
  disabledProviders: Map<string, { until: string; reason: string }>;
  cachePurges: number;
  restoresPerformed: number;
  exportsRegenerated: number;
  pipelineAborts: number;
}

// ============================================================================
// Health System
// ============================================================================

export type HealthStatus = "ok" | "degraded" | "down" | "unknown";

export interface SubsystemHealth {
  name: string;
  status: HealthStatus;
  detail: string;
  latencyMs?: number;
  lastCheck: string;
  metrics?: Record<string, number>;
}

export interface FullHealthReport {
  status: HealthStatus;
  timestamp: string;
  uptimeSeconds: number;
  runtime: string;
  subsystems: SubsystemHealth[];
  providers: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
    untested: number;
  };
  cache: {
    jobAnalysis: number;
    companyResearch: number;
    atsReport: number;
    totalEntries: number;
    expiredEntries: number;
  };
  database: {
    configured: boolean;
    reachable: boolean;
  };
  ai: {
    fallbackAvailable: boolean;
    lastProviderUsed: string | null;
  };
  exports: {
    formats: string[];
    allAvailable: boolean;
  };
  pipeline: {
    agentsOnline: number;
    lastRun: string | null;
    lastRunSuccess: boolean | null;
  };
  workers: {
    runtime: string;
    status: HealthStatus;
  };
}

// ============================================================================
// Debug System
// ============================================================================

export interface DebugSnapshot {
  timestamp: string;
  consoleErrors: string[];
  networkErrors: string[];
  uncaughtExceptions: string[];
  renderingIssues: string[];
  failedRequests: Array<{ url: string; status: number; error: string }>;
  brokenRoutes: string[];
  providerStatus: Array<{ name: string; status: string; lastError: string | null }>;
  cacheState: Record<string, number>;
  storeState: {
    resumes: number;
    jobDescriptions: number;
    coverLetters: number;
    interviewPackages: number;
    atsReports: number;
    providers: number;
  };
}

// ============================================================================
// Regression Suite
// ============================================================================

export interface RegressionTestConfig {
  runOnBuild: boolean;
  runOnDeploy: boolean;
  runDaily: boolean;
  runBeforeRelease: boolean;
  categories: TestCategory[];
  failFast: boolean;
  maxDurationMs: number;
}

export const DEFAULT_REGRESSION_CONFIG: RegressionTestConfig = {
  runOnBuild: true,
  runOnDeploy: true,
  runDaily: true,
  runBeforeRelease: true,
  categories: ["api", "pipeline", "provider", "export", "cache", "ats", "performance"],
  failFast: false,
  maxDurationMs: 120000,
};
