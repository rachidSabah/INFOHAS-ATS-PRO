// ============================================================================
// Pipeline Profile Resolution — makes Pipeline Profiles LIVE at runtime.
//
// Directive (Task 7): "The Supervisor Agent loads the selected profile at the
// start of each pipeline run" and "changes take effect immediately — no
// restart required". Until now the Pipeline Profiles UI was a declarative
// surface only — the orchestrator decided the locked pipeline via an env var
// and hardcoded retry counts. This module resolves the SELECTED profile from
// the app store and derives the runtime decisions the orchestrator consumes:
//
//   - useLockedPipeline            (was: NEXT_PUBLIC_USE_LOCKED_PIPELINE env)
//   - maxOptimizeAttempts          (was: hardcoded 4)
//   - enableV3PostOptimization     (was: implicit — skipped whenever locked)
//   - enableTargetedRegeneration   (was: always on)
//   - matchingStrategy + threshold (was: fixed ID→fingerprint cascade)
//   - reflectionConfidenceThreshold (was: hardcoded 75)
//
// NON-REGRESSION: when no profile can be resolved, the fallback reproduces
// the exact pre-existing behavior (locked pipeline ON via env, V3 skipped on
// the locked path, 4 attempts, threshold 75).
// ============================================================================

import type { PipelineProfile } from "../pipeline-orchestration-types";
import { useApp } from "../store";

export type MatchingStrategy = "strict" | "hybrid" | "fuzzy";

export interface ProfileRuntimeConfig {
  profileId: string;
  profileName: string;
  useLockedPipeline: boolean;
  /** Total optimizer attempts (1 initial + retries). Clamped to 1..6. */
  maxOptimizeAttempts: number;
  enableV3PostOptimization: boolean;
  enableTargetedRegeneration: boolean;
  matchingStrategy: MatchingStrategy;
  hybridMatchingThreshold: number;
  /** QA confidence below which the Reflection Agent triggers. */
  reflectionConfidenceThreshold: number;
  /** Where this configuration came from (observability in pipeline logs). */
  source: "selected-profile" | "env-fallback";
}

/** Read the currently selected profile from the app store (null-safe). */
export function getSelectedProfile(): PipelineProfile | null {
  try {
    const state = useApp.getState();
    const profiles = state?.pipelineProfiles ?? [];
    const selectedId = state?.selectedProfileId;
    return profiles.find((p) => p.id === selectedId) ?? profiles.find((p) => p.isDefault) ?? profiles[0] ?? null;
  } catch {
    return null;
  }
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/**
 * Resolve the runtime pipeline decisions.
 *
 * @param profile the selected profile (or null → env fallback reproducing
 *                the pre-profile behavior).
 * @param envLockedRaw raw value of NEXT_PUBLIC_USE_LOCKED_PIPELINE
 *        (undefined/"anything but false" = enabled, "false" = disabled).
 *        Only consulted in the env-fallback path.
 */
export function resolveProfileRuntime(
  profile?: PipelineProfile | null,
  envLockedRaw?: string | null,
): ProfileRuntimeConfig {
  if (profile) {
    const thresholds = profile.validationThresholds;
    return {
      profileId: profile.id,
      profileName: profile.name,
      useLockedPipeline: profile.useLockedPipeline,
      maxOptimizeAttempts: clamp(profile.maxRetries ?? 4, 1, 6),
      // Profile-truthful V3 gating: the profile flag alone decides. This makes
      // Hybrid (locked + V3) actually run V3 agents after the locked pipeline
      // (the V3 path re-applies enforceLockedFields — safe by construction),
      // while Locked (V3: OFF) and Legacy V2 (V3: OFF) skip it.
      enableV3PostOptimization: profile.enableV3PostOptimization,
      enableTargetedRegeneration: profile.enableTargetedRegeneration,
      matchingStrategy: profile.matchingStrategy ?? "hybrid",
      hybridMatchingThreshold: profile.hybridMatchingThreshold ?? 75,
      reflectionConfidenceThreshold: thresholds?.minConfidenceScore ?? 75,
      source: "selected-profile",
    };
  }

  // === ENV FALLBACK — exact pre-profile behavior ===
  const envLocked = envLockedRaw !== "false"; // default: enabled
  return {
    profileId: "env-fallback",
    profileName: "Env Fallback (legacy)",
    useLockedPipeline: envLocked,
    maxOptimizeAttempts: 4,
    // Pre-profile rule: V3 ran only when the locked pipeline did NOT produce
    // the resume (orchestrator skipped V3 whenever locked output existed).
    enableV3PostOptimization: !envLocked,
    enableTargetedRegeneration: true,
    matchingStrategy: "hybrid",
    hybridMatchingThreshold: 75,
    reflectionConfidenceThreshold: 75,
    source: "env-fallback",
  };
}

/** One-line summary for pipeline logs / supervisor dashboard. */
export function describeProfileRuntime(cfg: ProfileRuntimeConfig): string {
  const parts = [
    cfg.useLockedPipeline ? "locked" : "legacy",
    `V3=${cfg.enableV3PostOptimization ? "ON" : "OFF"}`,
    `regen=${cfg.enableTargetedRegeneration ? "ON" : "OFF"}`,
    `matching=${cfg.matchingStrategy}`,
    `retries=${cfg.maxOptimizeAttempts}`,
    `reflect<${cfg.reflectionConfidenceThreshold}`,
  ];
  return `${cfg.profileName} [${parts.join(", ")}]`;
}
