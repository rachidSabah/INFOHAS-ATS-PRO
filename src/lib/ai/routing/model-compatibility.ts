// ============================================================================
// Model Compatibility — provider+canonical-model pair validation (directives
// #6, #7, #8).
//
// Provider and model are NOT independent fields: they form a
// PROVIDER + CANONICAL MODEL PAIR. The UI and the router must never allow an
// impossible combination:
//   - never present model Y as valid for provider X when X doesn't support it
//   - never silently send Y to X
//   - never rotate into Y after a provider-level failure
//   - never save an invalid pair as a valid configuration
//
// Compatibility rules (in order):
//   1. A model id must be a plausible canonical identifier (non-empty, no
//      whitespace, no display-label artifacts).
//   2. A model is COMPATIBLE with a provider instance when the provider
//      declares it (enabledModels/modelName) OR the health registry has
//      validated a real execution (HEALTHY/AVAILABLE/LOCKED) for the pair.
//   3. Known-dead model ids are never compatible (retired catalog entries
//      such as nemotron-3-ultra-free / hy3-free / big-pickle on ZenCode —
//      directive #8 evidence).
// ============================================================================

import { aiHealthManager } from "../health/ai-health-manager";

/** Catalog ids that providers have proven NOT to support (directive #11). */
export const KNOWN_INVALID_MODEL_IDS = new Set<string>([
  "nemotron-3-ultra-free",
  "hy3-free",
  "big-pickle",
]);

export interface ProviderLike {
  id: string;
  name?: string;
  type: string;
  modelName?: string;
  enabledModels?: string[] | null;
  status?: string;
  isActive?: boolean;
}

export interface CompatibilityResult {
  compatible: boolean;
  /** Machine-readable reason — safe to show in the UI (no secrets). */
  reason?: string;
  /** Where compatibility evidence came from. */
  evidence: "provider-declared" | "health-validated" | "unknown" | "invalid-id" | "known-dead";
}

/** A plausible canonical model id: non-empty, trimmed, no spaces/labels. */
export function isPlausibleCanonicalModelId(modelId: string | undefined | null): boolean {
  if (!modelId) return false;
  const m = modelId.trim();
  if (m.length === 0 || m.length > 200) return false;
  if (/\s/.test(m)) return false; // canonical ids never contain whitespace
  if (/^(model|select|none|default)$/i.test(m)) return false; // UI placeholders
  return true;
}

/**
 * Validate an exact provider + canonical model pair.
 * This is the single gate used by: the Agent Configuration Center model
 * selector, bulk assignment, the router's rotation candidates and the
 * benchmark. If this returns false the pair MUST NOT execute.
 */
export function checkModelCompatibility(
  provider: ProviderLike | undefined | null,
  modelId: string | undefined | null,
): CompatibilityResult {
  if (!provider) {
    return { compatible: false, reason: "Unknown provider", evidence: "unknown" };
  }
  if (!isPlausibleCanonicalModelId(modelId)) {
    return { compatible: false, reason: "Invalid or missing model id", evidence: "invalid-id" };
  }
  const model = (modelId as string).trim();

  if (KNOWN_INVALID_MODEL_IDS.has(model)) {
    return { compatible: false, reason: `Model "${model}" is a known-retired id`, evidence: "known-dead" };
  }

  // Health registry evidence beats declarations: a pair that passed a real
  // execution is compatible even if the static list is stale.
  const health = aiHealthManager.getHealth(provider.id, model);
  if (health.state === "healthy" || health.availability === "HEALTHY" || health.availability === "AVAILABLE" || health.availability === "LOCKED") {
    return { compatible: true, evidence: "health-validated" };
  }
  if (health.errorCategory === "unsupported_model") {
    return { compatible: false, reason: `Provider reported model not supported by provider`, evidence: "unknown" };
  }

  // Provider-declared support: enabledModels list (preferred) or modelName.
  const declared = (provider.enabledModels ?? []).map((m) => (m ?? "").trim()).filter(Boolean);
  const primary = (provider.modelName ?? "").trim();
  if (declared.length > 0) {
    if (declared.includes(model)) return { compatible: true, evidence: "provider-declared" };
    return {
      compatible: false,
      reason: `Model not in ${provider.name || provider.id}'s enabled models`,
      evidence: "provider-declared",
    };
  }
  if (primary) {
    if (primary === model) return { compatible: true, evidence: "provider-declared" };
    // No list declared: only the primary model is provably supported.
    return {
      compatible: false,
      reason: `Provider declares only "${primary}" — cannot verify "${model}"`,
      evidence: "provider-declared",
    };
  }

  // Provider declares nothing at all: pair cannot be verified (fail closed —
  // do not trust static catalogs, directive #8).
  return {
    compatible: false,
    reason: "Provider exposes no model metadata — pair cannot be verified",
    evidence: "unknown",
  };
}

/** Boolean convenience for the router hot path. */
export function isModelCompatible(provider: ProviderLike | undefined | null, modelId: string | undefined | null): boolean {
  return checkModelCompatibility(provider, modelId).compatible;
}

/**
 * The models a provider legitimately offers — used by every model selector
 * (Agent Configuration Center, bulk assignment, AI Models module). Filters
 * placeholder/dead ids; the UI must never present an impossible pair.
 */
export function modelsForProvider(provider: ProviderLike | undefined | null): string[] {
  if (!provider) return [];
  const declared = (provider.enabledModels ?? []).map((m) => (m ?? "").trim()).filter(Boolean);
  const primary = (provider.modelName ?? "").trim();
  const all = declared.length > 0 ? declared : primary ? [primary] : [];
  return all.filter((m) => isPlausibleCanonicalModelId(m) && !KNOWN_INVALID_MODEL_IDS.has(m));
}

/**
 * Filter a rotation candidate list down to genuinely compatible models
 * (directive #12 — only validated candidates may enter rotation).
 */
export function filterCompatibleRotationCandidates(
  provider: ProviderLike,
  candidateModels: string[],
  exclude: Set<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of candidateModels) {
    const id = (m ?? "").trim();
    if (!id || exclude.has(id) || seen.has(id)) continue;
    seen.add(id);
    const verdict = checkModelCompatibility(provider, id);
    if (verdict.compatible) out.push(id);
  }
  return out;
}
