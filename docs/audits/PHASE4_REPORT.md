# Phase 4 — Enterprise AI Runtime
## Universal Provider Architecture
## Date: 2026-06-30

---

## Overview

Phase 4 redesigns ResumeAI Pro into a **provider-agnostic AI runtime**.

The application NEVER depends on a specific AI provider. All providers are interchangeable plugins managed by a unified runtime. Adding a new provider requires ZERO changes to the optimization pipeline.

## Architecture

```
Optimization Supervisor
        ↓
Enterprise AI Runtime  ← Agents call ONLY this
        ↓
Provider Registry  →  Capability Engine  →  Model Selection
        ↓
Auth Manager  →  Health Monitor  →  Circuit Breaker
        ↓
Failover Engine  →  Retry Manager
        ↓
Local Engine (always-available fallback)
```

## Files Created

| File | Purpose |
|------|---------|
| `types.ts` | Core types: AIProvider interface, model capabilities, auth, runtime config |
| `provider-registry.ts` | Auto-registration, dynamic discovery, model indexing, call stats |
| `capability-engine.ts` | Intelligent model selection based on quality/speed/cost requirements |
| `auth-manager.ts` | API key + OAuth + no-auth support, token refresh, header building |
| `health-monitor.ts` | Circuit breaker (closed/half-open/open), latency tracking, periodic checks |
| `retry-manager.ts` | Exponential backoff with jitter, per-call timeout |
| `failover-engine.ts` | 5-level failover: primary → retry → different model → different provider → local |
| `runtime.ts` | EnterpriseAIRuntime — unified facade that agents call instead of providers |
| `local-engine.ts` | Always-available fallback with basic text/keyword generation |
| `index.ts` | Barrel exports |
| `enterprise-ai-runtime.test.ts` (in `__tests__/`) | 57 tests covering all components |

## AIProvider Interface

```typescript
interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly models: ModelInfo[];

  initialize(config: ProviderConfig): Promise<void>;
  shutdown(): Promise<void>;

  authenticate(credentials: AuthCredentials): Promise<AuthStatus>;
  refresh(): Promise<AuthStatus>;

  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest, handler: StreamHandler): Promise<ChatResponse>;
  embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  vision(request: VisionRequest): Promise<VisionResponse>;
  reasoning(request: ReasoningRequest): Promise<ReasoningResponse>;
  tools(request: ChatRequest): Promise<ChatResponse>;

  supportsCapability(capability: keyof ModelCapabilities): boolean;

  estimateCost(model: string, inputTokens: number, outputTokens: number): CostEstimate;
  estimateLatency(model: string, inputTokens: number): LatencyEstimate;
  estimateQuality(model: string, task: string): QualityEstimate;

  health(): Promise<ProviderHealth>;
}
```

## Key Design Decisions

1. **No abstract base class** — Composition over inheritance. Providers implement the interface.
2. **Agents call ONLY EnterpriseAIRuntime** — never providers directly. The runtime handles provider selection, auth, retry, failover, health, and telemetry.
3. **Local engine is the LAST fallback** — always available, never blocks optimization.
4. **Circuit breaker** — automatically disables unhealthy providers, transitions through closed → open → half-open on recovery.
5. **Failover levels** — 0 (primary) → 1 (retry) → 2 (different model) → 3 (different provider) → 4 (emergency) → 5 (local engine).
6. **Telemetry-driven learning** — CapabilityEngine incorporates real usage data to improve model selection over time.

## Supported Providers

The interface is designed for **15+ providers**:
OpenAI, Anthropic Claude, Google Gemini, DeepSeek, OpenRouter, OpenCode, Antigravity CLI, Puter, ZAI, Grok, Mistral, Cohere, Ollama, LM Studio, Local Engine, and future providers.

Each provider only needs to implement `AIProvider` — no pipeline changes, no supervisor changes, no agent changes.

## Test Results

**931 / 931 tests pass** — 50 files, +57 Phase 4 tests, **zero regressions**
