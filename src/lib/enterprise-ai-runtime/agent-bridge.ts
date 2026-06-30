// ============================================================================
// AgentBridge — drop-in replacement agents use instead of calling callAI()
// ============================================================================
// This is the Phase 4 migration bridge. Agents import runtimeCallAI() instead
// of callAI() from "../../ai". All calls route through EnterpriseAIRuntime.
//
// Migration checklist:
//   1. import { runtimeCallAI } from "...enterprise-ai-runtime/agent-bridge"
//   2. Replace callAI(opts) with runtimeCallAI(opts)
//   3. Test passes; old code path unchanged for non-migrated callers.

import type { AIProvider, ChatRequest, ProviderConfig } from "./types";
import { EnterpriseAIRuntime } from "./runtime";
import { StoreProviderAdapter } from "./provider-adapter-factory";

// ── Singleton Runtime Instance ───────────────────────────────────────────

let _runtime: EnterpriseAIRuntime | null = null;
let _initializing = false;

/**
 * Get or create the singleton EnterpriseAIRuntime instance.
 * Lazily initializes from the Zustand store on first call.
 */
export async function getRuntime(): Promise<EnterpriseAIRuntime> {
  if (_runtime) {
    return _runtime;
  }
  if (_initializing) {
    // Wait for in-flight initialization
    await new Promise<void>((resolve) => {
      const check = () => {
        if (_runtime?.["initialized" as keyof EnterpriseAIRuntime]) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
    return _runtime!;
  }

  _initializing = true;
  try {
    _runtime = new EnterpriseAIRuntime({
      maxRetries: 3,
      timeoutMs: 120000,
      enableCircuitBreaker: true,
      enableTelemetry: true,
    });

    // Register the local engine
    const { LocalEngineProvider } = await import("./local-engine");
    const local = new LocalEngineProvider();
    await _runtime.registerProvider(local, {
      id: "local",
      name: "Local Engine",
      type: "local",
      auth: { type: "none", apiKey: undefined },
      timeout: 30000,
      maxRetries: 1,
      rateLimitPerMinute: 60,
    });

    await _runtime.initializeFromStore();

    // Fallback: ensure initialized even if no store providers found
    if (!_runtime) {
      _runtime = new EnterpriseAIRuntime();
      (_runtime as any).initialize([]);
    }
  } catch (err) {
    console.warn("[AgentBridge] Runtime initialization failed:", err);
    // Create minimal runtime nonetheless
    if (!_runtime) {
      _runtime = new EnterpriseAIRuntime();
    }
  } finally {
    _initializing = false;
  }

  return _runtime!;
}

/**
 * Reset the runtime instance (for testing).
 */
export function resetRuntime(): void {
  _runtime = null;
  _initializing = false;
}

// ── Bridge Functions ─────────────────────────────────────────────────────

export interface RuntimeCallOptions {
  userPrompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  taskCategory?: string;
}

export interface RuntimeCallResult {
  text: string;
  provider: string;
  latencyMs: number;
  tokensEstimate: number;
  isLocalEngine?: boolean;
}

/**
 * Drop-in replacement for callAI(). Routes through EnterpriseAIRuntime
 * with full failover, health monitoring, and circuit breaking.
 */
export async function runtimeCallAI(opts: RuntimeCallOptions): Promise<RuntimeCallResult> {
  const runtime = await getRuntime();
  const start = Date.now();

  const messages: ChatRequest["messages"] = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: opts.userPrompt });

  const result = await runtime.chat(
    {
      messages,
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens ?? 4096,
    },
    undefined,
    opts.taskCategory || "document",
  );

  return {
    text: result.response.text,
    provider: result.response.provider,
    latencyMs: Date.now() - start,
    tokensEstimate: result.response.inputTokens ?? 0,
    isLocalEngine: result.response.provider === "local-engine",
  };
}

/**
 * Register a custom provider adapter with the runtime.
 * Call this after getRuntime() to add providers that aren't in the store.
 */
export async function registerProviderWithRuntime(
  provider: AIProvider,
  config: ProviderConfig,
): Promise<void> {
  const runtime = await getRuntime();
  await runtime.registerProvider(provider, config);
}

// Re-export the runtime and StoreProviderAdapter for convenience
export { EnterpriseAIRuntime, StoreProviderAdapter };
