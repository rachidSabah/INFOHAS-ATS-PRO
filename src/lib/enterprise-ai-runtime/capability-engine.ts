// ============================================================================
// CapabilityEngine — model capabilities, intelligent model selection
// ============================================================================

import type {
  ModelInfo,
  ModelCapabilities,
  CapabilityRequirement,
  ExecutionPlan,
  CostEstimate,
  LatencyEstimate,
  QualityEstimate,
  TelemetryEntry,
} from "./types";
import { ProviderRegistry } from "./provider-registry";

export class CapabilityEngine {
  private registry: ProviderRegistry;

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
  }

  // ── Model Selection ──────────────────────────────────────────────────
  /**
   * Find the best model for the given capability requirements.
   * Selection is based on: quality, speed, context, availability,
   * reasoning, vision, tool support, and historical performance.
   *
   * Never hardcodes model names. All selection is criteria-based.
   */
  selectModel(
    requirements: CapabilityRequirement,
    _task?: string,
  ): { providerId: string; modelId: string; model: ModelInfo; reasoning: string } | null {
    const candidates = this.registry.getAllHealthy();
    if (candidates.length === 0) return null;

    let best: {
      providerId: string;
      modelId: string;
      model: ModelInfo;
      score: number;
      reasoning: string;
    } | null = null;

    for (const reg of candidates) {
      for (const model of this.registry.getModelsByProvider(reg.config.id)) {
        if (!this.meetsRequirements(model, requirements)) continue;

        const score = this.scoreModel(model, requirements, _task);
        const reasons: string[] = [];
        reasons.push(`${model.id} scores ${score.toFixed(0)}`);
        if (model.quality > 80) reasons.push("high quality");
        if (model.reliability > 80) reasons.push("high reliability");
        if (model.speed > 80) reasons.push("fast");

        if (!best || score > best.score) {
          best = {
            providerId: reg.config.id,
            modelId: model.id,
            model,
            score,
            reasoning: reasons.join(", "),
          };
        }
      }
    }

    if (!best) return null;
    return {
      providerId: best.providerId,
      modelId: best.modelId,
      model: best.model,
      reasoning: best.reasoning,
    };
  }

  /**
   * Build a full execution plan with cost, latency, and quality estimates.
   */
  buildPlan(
    requirements: CapabilityRequirement,
    inputTokens: number,
    task?: string,
  ): ExecutionPlan | null {
    const selection = this.selectModel(requirements, task);
    if (!selection) return null;

    // Estimate output tokens (rough 2:1 ratio for chat)
    const outputTokens = Math.round(inputTokens * 0.5);

    return {
      providerId: selection.providerId,
      modelId: selection.modelId,
      estimatedCost: this.estimateCost(
        selection.model,
        inputTokens,
        outputTokens,
      ),
      estimatedLatency: this.estimateLatency(
        selection.model,
        inputTokens,
      ),
      estimatedQuality: this.estimateQuality(selection.model, task),
      reasoning: selection.reasoning,
    };
  }

  // ── Capability Checks ────────────────────────────────────────────────

  meetsRequirements(model: ModelInfo, req: CapabilityRequirement): boolean {
    if (req.minContext !== undefined && model.contextSize < req.minContext) return false;
    if (req.reasoning && !model.capabilities.reasoning) return false;
    if (req.vision && !model.capabilities.vision) return false;
    if (req.streaming && !model.capabilities.streaming) return false;
    if (req.jsonMode && !model.capabilities.jsonMode) return false;
    if (req.toolCalling && !model.capabilities.toolCalling) return false;
    if (req.minQuality !== undefined && model.quality < req.minQuality) return false;
    if (req.minReliability !== undefined && model.reliability < req.minReliability) return false;
    if (req.maxCost !== undefined && model.costPerOutputToken > req.maxCost) return false;
    return true;
  }

  supportsCapability(model: ModelInfo, capability: keyof ModelCapabilities): boolean {
    return model.capabilities[capability] === true;
  }

  // ── Scoring ──────────────────────────────────────────────────────────

  private scoreModel(
    model: ModelInfo,
    req: CapabilityRequirement,
    _task?: string,
  ): number {
    let score = 0;

    // Quality (0-40)
    score += model.quality * 0.4;

    // Reliability (0-20)
    score += model.reliability * 0.2;

    // Speed (0-15)
    score += model.speed * 0.15;

    // Context size (0-15) — log scale
    const ctxScore = Math.min(15, Math.log2(model.contextSize / 1024) * 3);
    score += ctxScore;

    // Cost penalty (0-10)
    const costPenalty = Math.min(10, model.costPerOutputToken / 100);
    score -= costPenalty;

    // Bonus for exact capability match
    if (req.reasoning && model.capabilities.reasoning) score += 5;
    if (req.vision && model.capabilities.vision) score += 5;
    if (req.toolCalling && model.capabilities.toolCalling) score += 3;
    if (req.jsonMode && model.capabilities.jsonMode) score += 2;

    return Math.max(0, score);
  }

  // ── Estimates ────────────────────────────────────────────────────────

  estimateCost(model: ModelInfo, inputTokens: number, outputTokens: number): CostEstimate {
    const inputCost = inputTokens * model.costPerInputToken;
    const outputCost = outputTokens * model.costPerOutputToken;
    return {
      estimatedInputCost: inputCost,
      estimatedOutputCost: outputCost,
      totalEstimatedCost: inputCost + outputCost,
      currency: "micro-dollars" as const,
    };
  }

  estimateLatency(model: ModelInfo, inputTokens: number): LatencyEstimate {
    const base = 500;
    const perToken = (inputTokens / 100) * 50;
    const estimatedMs = (base + perToken) / (model.speed / 50);

    const confidence: "low" | "medium" | "high" =
      model.reliability > 80 ? "high"
      : model.reliability > 50 ? "medium"
      : "low";

    return { estimatedMs, confidence };
  }

  estimateQuality(model: ModelInfo, _task?: string): QualityEstimate {
    const confidence: "low" | "medium" | "high" =
      model.quality > 80 ? "high"
      : model.quality > 50 ? "medium"
      : "low";

    return { estimatedScore: model.quality, confidence };
  }

  // ── Learning from Telemetry ──────────────────────────────────────────

  incorporateTelemetry(entries: TelemetryEntry[]): void {
    const byModel = new Map<string, TelemetryEntry[]>();
    for (const e of entries) {
      const key = `${e.providerId}:${e.modelId}`;
      const list = byModel.get(key) || [];
      list.push(e);
      byModel.set(key, list);
    }

    for (const [key, list] of byModel) {
      const [, modelId] = key.split(":");
      const model = this.registry.getModel(modelId);
      if (!model) continue;

      const successCount = list.filter((e) => e.success).length;
      const avgLatency = list.reduce((s, e) => s + e.latencyMs, 0) / list.length;
      const avgQuality = list.reduce((s, e) => s + e.qualityScore, 0) / list.length;

      model.reliability = Math.round(
        model.reliability * 0.7 + (successCount / list.length) * 100 * 0.3,
      );
      model.quality = Math.round(
        model.quality * 0.8 + avgQuality * 0.2,
      );

      if (avgLatency > 0) {
        const observedSpeed = Math.max(1, Math.min(100, (5000 / avgLatency) * 20));
        model.speed = Math.round(model.speed * 0.7 + observedSpeed * 0.3);
      }
    }
  }
}
