// ============================================================================
// FailoverEngine — retry → different model → different provider → local
// ============================================================================

import type {
  AIProvider,
  ProviderId,
  ModelId,
  ChatRequest,
  ChatResponse,
  ExecutionPlan,
  ExecutionResult,
  FailoverLevel,
} from "./types";
import { FAILOVER_LEVELS } from "./types";
import { ProviderRegistry } from "./provider-registry";
import { HealthMonitor } from "./health-monitor";
import { RetryManager } from "./retry-manager";

/**
 * FailoverEngine — ensures optimization NEVER blocks.
 *
 * Failover sequence:
 * 0 - Primary: try selected provider + model
 * 1 - Retry: same provider + model with backoff
 * 2 - Different model: same provider, different model
 * 3 - Different provider: try another provider
 * 4 - Emergency fallback: any available provider
 * 5 - Local engine: always available fallback
 */
export class FailoverEngine {
  private registry: ProviderRegistry;
  private healthMonitor: HealthMonitor;
  private retryManager: RetryManager;
  private localProvider: AIProvider | null = null;

  constructor(
    registry: ProviderRegistry,
    healthMonitor: HealthMonitor,
    retryManager: RetryManager,
    localProvider?: AIProvider,
  ) {
    this.registry = registry;
    this.healthMonitor = healthMonitor;
    this.retryManager = retryManager;
    this.localProvider = localProvider || null;
  }

  /**
   * Register the local engine as the final fallback.
   */
  setLocalProvider(provider: AIProvider): void {
    this.localProvider = provider;
  }

  /**
   * Execute a chat request with full failover.
   */
  async executeWithFailover(
    request: ChatRequest,
    plan: ExecutionPlan,
  ): Promise<ExecutionResult> {
    const warnings: string[] = [];
    const startTime = Date.now();

    // Level 0: Primary
    const primaryProvider = this.registry.getProvider(plan.providerId);
    if (primaryProvider && this.healthMonitor.isAllowed(plan.providerId)) {
      try {
        const result = await this.tryProvider(
          primaryProvider,
          plan.providerId,
          plan.modelId,
          request,
          FAILOVER_LEVELS.PRIMARY,
        );
        if (result) return result;
      } catch {
        warnings.push(`Primary provider ${plan.providerId} failed`);
      }
    }

    // Level 1: Retry same provider + model
    if (primaryProvider) {
      try {
        const retryResult = await this.retryManager.execute(async () => {
          const r = await primaryProvider.chat(request);
          return r;
        });
        if (retryResult.success && retryResult.result) {
          return {
            response: retryResult.result,
            plan,
            retries: retryResult.attempts - 1,
            failoverLevel: FAILOVER_LEVELS.SAME_PROVIDER_RETRY,
            totalLatencyMs: Date.now() - startTime,
            warnings,
          };
        }
      } catch {
        warnings.push(`Retry on ${plan.providerId} failed`);
      }
    }

    // Level 2: Different model on same provider
    if (primaryProvider) {
      const altModels = this.registry
        .getModelsByProvider(plan.providerId)
        .filter((m) => m.id !== plan.modelId && m.available);

      for (const altModel of altModels) {
        try {
          const result = await primaryProvider.chat({
            ...request,
            model: altModel.id,
          });
          return {
            response: result,
            plan: { ...plan, modelId: altModel.id, reasoning: `Fallback to ${altModel.id}` },
            retries: 1,
            failoverLevel: FAILOVER_LEVELS.DIFFERENT_MODEL,
            totalLatencyMs: Date.now() - startTime,
            warnings,
          };
        } catch {
          warnings.push(`Alt model ${altModel.id} failed`);
        }
      }
    }

    // Level 3: Different provider
    const altProviders = this.registry.getAllHealthy().filter(
      (p) => p.config.id !== plan.providerId,
    );

    for (const alt of altProviders) {
      if (!this.healthMonitor.isAllowed(alt.config.id)) continue;
      try {
        const altModels = this.registry.getModelsByProvider(alt.config.id);
        if (altModels.length === 0) continue;

        const result = await alt.provider.chat({
          ...request,
          model: altModels[0].id,
        });
        return {
          response: result,
          plan: {
            ...plan,
            providerId: alt.config.id,
            modelId: altModels[0].id,
            reasoning: `Failover to ${alt.config.id}`,
          },
          retries: 2,
          failoverLevel: FAILOVER_LEVELS.DIFFERENT_PROVIDER,
          totalLatencyMs: Date.now() - startTime,
          warnings,
        };
      } catch {
        warnings.push(`Alt provider ${alt.config.id} failed`);
      }
    }

    // Level 5: Local engine (final fallback, always available)
    if (this.localProvider) {
      try {
        const result = await this.localProvider.chat(request);
        return {
          response: result,
          plan: { ...plan, providerId: "local", modelId: "local", reasoning: "Local engine fallback" },
          retries: 3,
          failoverLevel: FAILOVER_LEVELS.LOCAL_ENGINE,
          totalLatencyMs: Date.now() - startTime,
          warnings: [...warnings, "All providers failed, using local engine"],
        };
      } catch {
        warnings.push("Local engine also failed");
      }
    }

    // All failover exhausted
    throw new Error(
      `All AI providers exhausted after failover. Warnings: ${warnings.join("; ")}`,
    );
  }

  private async tryProvider(
    provider: AIProvider,
    providerId: ProviderId,
    modelId: ModelId,
    request: ChatRequest,
    failoverLevel: FailoverLevel,
  ): Promise<ExecutionResult | null> {
    try {
      const startTime = Date.now();
      const response = await provider.chat({
        ...request,
        model: modelId,
      });
      this.healthMonitor.recordSuccess(providerId, response.latencyMs);
      return {
        response,
        plan: {
          providerId,
          modelId,
          estimatedCost: { estimatedInputCost: 0, estimatedOutputCost: 0, totalEstimatedCost: 0, currency: "micro-dollars" },
          estimatedLatency: { estimatedMs: response.latencyMs, confidence: "medium" },
          estimatedQuality: { estimatedScore: 80, confidence: "medium" },
          reasoning: `Direct call to ${providerId}/${modelId}`,
        },
        retries: 0,
        failoverLevel,
        totalLatencyMs: Date.now() - startTime,
        warnings: [],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.healthMonitor.recordFailure(providerId, errMsg);
      return null;
    }
  }
}
