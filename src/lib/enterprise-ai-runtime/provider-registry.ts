// ============================================================================
// ProviderRegistry — auto-registration, dynamic discovery, model indexing
// ============================================================================

import type {
  AIProvider,
  ProviderConfig,
  ProviderRegistration,
  ProviderId,
  ModelInfo,
  ModelId,
  ProviderHealth,
  ProviderStats,
} from "./types";

export class ProviderRegistry {
  private providers = new Map<ProviderId, ProviderRegistration>();
  private models = new Map<ModelId, ModelInfo>();

  // ── Registration ─────────────────────────────────────────────────────

  async register(
    provider: AIProvider,
    config: ProviderConfig,
  ): Promise<ProviderRegistration> {
    const health = await provider.health();
    const registration: ProviderRegistration = {
      provider,
      config,
      registeredAt: Date.now(),
      health,
      stats: this.defaultStats(),
    };
    this.providers.set(config.id, registration);

    // Index this provider's models
    for (const model of provider.models) {
      this.models.set(model.id, model);
    }

    return registration;
  }

  unregister(id: ProviderId): boolean {
    const reg = this.providers.get(id);
    if (!reg) return false;
    reg.provider.shutdown();
    // Remove indexed models from this provider
    for (const [modelId, model] of this.models.entries()) {
      if (model.provider === id) this.models.delete(modelId);
    }
    return this.providers.delete(id);
  }

  // ── Lookups ──────────────────────────────────────────────────────────

  get(id: ProviderId): ProviderRegistration | undefined {
    return this.providers.get(id);
  }

  getAll(): ProviderRegistration[] {
    return Array.from(this.providers.values());
  }

  getAllHealthy(): ProviderRegistration[] {
    return this.getAll().filter(
      (p) => p.health.status === "healthy" || p.health.status === "degraded",
    );
  }

  getProvider(id: ProviderId): AIProvider | undefined {
    return this.providers.get(id)?.provider;
  }

  getConfig(id: ProviderId): ProviderConfig | undefined {
    return this.providers.get(id)?.config;
  }

  // ── Model queries ────────────────────────────────────────────────────

  getModel(modelId: ModelId): ModelInfo | undefined {
    return this.models.get(modelId);
  }

  getAllModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  findModels(criteria: Partial<ModelInfo>): ModelInfo[] {
    return this.getAllModels().filter((m) => {
      for (const [key, value] of Object.entries(criteria)) {
        if ((m as any)[key] !== value) return false;
      }
      return true;
    });
  }

  getModelsByProvider(providerId: ProviderId): ModelInfo[] {
    return this.getAllModels().filter((m) => m.provider === providerId);
  }

  // ── Health tracking ──────────────────────────────────────────────────

  updateHealth(id: ProviderId, health: ProviderHealth): void {
    const reg = this.providers.get(id);
    if (reg) {
      reg.health = health;
    }
  }

  recordCall(
    id: ProviderId,
    success: boolean,
    latencyMs: number,
    cost: number,
    tokens: number,
    qualityScore: number,
  ): void {
    const reg = this.providers.get(id);
    if (!reg) return;
    const s = reg.stats;
    s.totalCalls++;
    if (success) s.successfulCalls++;
    else s.failedCalls++;
    s.totalTokens += tokens;
    s.totalCost += cost;
    s.averageLatencyMs =
      (s.averageLatencyMs * (s.totalCalls - 1) + latencyMs) / s.totalCalls;
    s.averageQualityScore =
      (s.averageQualityScore * (s.totalCalls - 1) + qualityScore) / s.totalCalls;
    s.lastUsed = Date.now();
  }

  // ── Stats ────────────────────────────────────────────────────────────

  getStats(id: ProviderId): ProviderStats | undefined {
    return this.providers.get(id)?.stats;
  }

  getProviderCount(): number {
    return this.providers.size;
  }

  getModelCount(): number {
    return this.models.size;
  }

  private defaultStats(): ProviderStats {
    return {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      averageLatencyMs: 0,
      averageQualityScore: 0,
      averageAtsImprovement: 0,
      lastUsed: 0,
    };
  }
}
