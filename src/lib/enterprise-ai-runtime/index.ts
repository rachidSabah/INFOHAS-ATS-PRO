// ============================================================================
// Enterprise AI Runtime — Barrel Exports
// ============================================================================

// Core types
export type {
  AIProvider,
  ProviderConfig,
  ProviderHealth,
  ModelInfo,
  ModelCapabilities,
  CapabilityRequirement,
  ChatRequest,
  ChatResponse,
  StreamHandler,
  ExecutionPlan,
  ExecutionResult,
  EmbeddingRequest,
  EmbeddingResponse,
  VisionRequest,
  VisionResponse,
  ReasoningRequest,
  ReasoningResponse,
  AuthCredentials,
  AuthStatus,
  CostEstimate,
  LatencyEstimate,
  QualityEstimate,
  TelemetryEntry,
  FailoverLevel,
  RuntimeConfig,
} from "./types";

// Runtime modules
export { EnterpriseAIRuntime } from "./runtime";
export { ProviderRegistry } from "./provider-registry";
export { CapabilityEngine } from "./capability-engine";
export { AuthManager } from "./auth-manager";
export { HealthMonitor } from "./health-monitor";
export { RetryManager } from "./retry-manager";
export { FailoverEngine } from "./failover-engine";
export { LocalEngineProvider } from "./local-engine";

// Bridge and adapters
export {
  getRuntime,
  resetRuntime,
  runtimeCallAI,
  registerProviderWithRuntime,
  StoreProviderAdapter,
} from "./agent-bridge";

export {
  createProvidersFromStore,
  registerStoreProvidersWithRuntime,
} from "./provider-adapter-factory";
