// ============================================================================
// Provider Auto-Heal Engine (directives #1–#9, #13, #14)
//
// When a provider fails, this engine:
//   1. Captures the complete error (fresh diagnosis ping if needed)
//   2. Classifies it (error-classifier)
//   3. Repairs ONLY what is safe: stale model ids (catalog refresh +
//      compatible replacement), stale endpoints (known catalog URL), and
//      post-cooldown revalidation
//   4. Validates the repaired configuration with a REAL lightweight request
//   5. Marks the provider recovered only after a successful validation
//   6. Records everything in the Heal History + provider health state
//
// NEVER: deletes/exposes API keys, disables providers, blindly overwrites
// unknown configuration, or retries in a loop (single validated retry only).
// ============================================================================

import { useApp } from "../../store";
import type { AIProvider } from "../../types";
import { ProviderRouter } from "../services/router";
import { ProviderManager } from "../services/manager";
import { getProviderCatalogEntry } from "../provider-catalog";
import { classifyProviderFailure, type FailureKind } from "./error-classifier";
import { recordHealEvent, type HealEvent } from "./heal-history";
import { rateLimitTracker } from "../../rate-limit-tracker";
import { isProviderInCooldown } from "../../provider-cooldown";
import { getCooldownRemaining, resetCircuitBreaker } from "../../circuit-breaker";
import { recordSuccess as recordHealthSuccess, recordFailure as recordHealthFailure } from "../../provider-health";

// ============================================================================
// Types
// ============================================================================

export type HealResult = "recovered" | "cooldown" | "manual_required" | "failed" | "skipped";

export interface HealReportEntry {
  providerId: string;
  providerName: string;
  problem: string;
  failureKind: FailureKind | "cooldown";
  diagnosis: string;
  action: string;
  previousModel?: string;
  newModel?: string;
  previousEndpoint?: string;
  newEndpoint?: string;
  result: HealResult;
  latencyMs?: number;
  mode: "auto" | "manual";
  technical?: string;
}

export interface PingOutcome {
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
}

/** Injectable dependencies — keeps the engine unit-testable. */
export interface HealerDeps {
  /** Real lightweight validation request against ONE provider. */
  ping?: (provider: AIProvider, model?: string) => Promise<PingOutcome>;
  /** Provider model catalog fetch (live API with static fallback lists). */
  fetchCatalog?: (provider: AIProvider) => Promise<{ ok: boolean; models: string[]; error?: string }>;
}

function defaultDeps(): Required<HealerDeps> {
  return {
    async ping(provider: AIProvider, model?: string): Promise<PingOutcome> {
      const t0 = Date.now();
      try {
        const res = await ProviderRouter.chat(
          {
            messages: [
              { role: "system", content: "Respond in exactly one word: 'READY'. Do not write anything else." },
              { role: "user", content: "status check" },
            ],
            model,
            maxTokens: 5,
          },
          {
            preferredProviderId: provider.id,
            singleProvider: true,
            requestType: "test",
            timeoutMs: Math.min(15000, provider.timeout || 15000),
          }
        );
        return { ok: true, latencyMs: Date.now() - t0, reply: res.text.trim().slice(0, 40) };
      } catch (e: any) {
        return { ok: false, latencyMs: Date.now() - t0, error: e?.message ?? String(e) };
      }
    },
    async fetchCatalog(provider: AIProvider) {
      return ProviderManager.fetchModels(provider);
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** True when the provider is currently in a rate-limit / cooldown window. */
export function providerInCooldown(provider: AIProvider): boolean {
  const rlUntil = provider.health?.rateLimitedUntil;
  const rlActive = !!(rlUntil && new Date(rlUntil) > new Date());
  return rlActive || rateLimitTracker.isRateLimited(provider.id) || isProviderInCooldown(provider.id || provider.name || provider.type);
}

/** Seconds remaining in the current cooldown window (for UI display). */
export function cooldownRemainingSeconds(provider: AIProvider): number {
  const rlUntil = provider.health?.rateLimitedUntil;
  const fromHealth = rlUntil ? Math.ceil((new Date(rlUntil).getTime() - Date.now()) / 1000) : 0;
  return Math.max(fromHealth, Math.ceil(rateLimitTracker.getCooldownRemainingMs(provider.id) / 1000), getCooldownRemaining(provider.id || provider.name || provider.type));
}

/** Choose the best compatible replacement model from a catalog. */
export function pickReplacementModel(provider: AIProvider, catalogModels: string[], failedModel?: string): string | undefined {
  const enabled = (provider.enabledModels ?? []).filter((m) => m && m !== failedModel);
  if (enabled.length > 0) return enabled[0];
  const pool = (catalogModels ?? []).filter((m) => m && m !== failedModel);
  if (pool.length === 0) return getProviderCatalogEntry(provider.type).defaultModel || undefined;
  // Prefer model families known to work well for ATS/optimization workloads.
  const family = /deepseek|llama|gpt|gemini|mistral|qwen|nemotron|claude|glm/i;
  return pool.find((m) => family.test(m)) ?? pool[0];
}

function patchHealth(provider: AIProvider, patch: NonNullable<AIProvider["health"]> extends infer H ? Partial<H> : never): void {
  const current = provider.health || { consecutiveFailures: 0, consecutiveSuccesses: 0 };
  useApp.getState().updateProvider(provider.id, { health: { ...current, ...patch } as AIProvider["health"] });
}

// ============================================================================
// The engine
// ============================================================================

export class ProviderHealer {
  private static pendingRetests = new Map<string, ReturnType<typeof setTimeout>>();

  /** AUTO-HEAL toggle (settings.autoHealProviders, default ON). */
  static autoHealEnabled(): boolean {
    return useApp.getState().providerSettings?.autoHealProviders !== false;
  }

  /**
   * Diagnose + repair + validate a single provider.
   * @param trigger optional raw error that triggered this heal (skips the
   *                fresh diagnosis ping when provided by the caller).
   */
  static async healProvider(
    providerOrId: AIProvider | string,
    mode: "auto" | "manual",
    trigger?: string,
    deps: HealerDeps = {}
  ): Promise<HealReportEntry> {
    const d = { ...defaultDeps(), ...deps };
    const state = useApp.getState();
    const provider = typeof providerOrId === "string"
      ? state.providers.find((p) => p.id === providerOrId)
      : providerOrId;

    if (!provider) {
      return {
        providerId: typeof providerOrId === "string" ? providerOrId : providerOrId.id,
        providerName: typeof providerOrId === "string" ? providerOrId : providerOrId.name,
        problem: "Provider not found", failureKind: "unknown",
        diagnosis: "The provider no longer exists in the configuration.", action: "None.",
        result: "failed", mode,
      };
    }

    const base = {
      providerId: provider.id,
      providerName: provider.name,
      mode,
    };

    // === Cooldown gate: temporary condition, NEVER a config problem ===
    if (providerInCooldown(provider)) {
      const remaining = cooldownRemainingSeconds(provider);
      patchHealth(provider, {
        healState: "cooldown",
        lastDiagnosis: `Temporary cooldown — ${remaining}s remaining. No configuration change required; the router moves to other providers meanwhile.`,
        lastFailureKind: "rate_limited",
      });
      this.scheduleCooldownRetest(provider.id, remaining * 1000);
      const entry: HealReportEntry = {
        ...base,
        problem: "Temporary cooldown / rate limit",
        failureKind: "cooldown",
        diagnosis: `Provider is in cooldown (${remaining}s remaining). This is a temporary usage condition, not a configuration failure.`,
        action: `No destructive configuration change. Automatic re-test scheduled in ~${remaining}s.`,
        result: "cooldown",
      };
      recordHealEvent({ ...entry, technical: trigger });
      return entry;
    }

    // === STEP 1-2: capture + classify ===
    let rawError = trigger || provider.health?.lastError || "";
    let cls = classifyProviderFailure(rawError, { providerType: provider.type });
    if (!rawError) {
      // No stored error — run a fresh diagnosis ping to get a REAL failure.
      const probe = await d.ping(provider);
      if (probe.ok) {
        // Provider actually works — just mark healthy, nothing to heal.
        await this.markRecovered(provider, probe.latencyMs, "Diagnosis ping succeeded");
        const entry: HealReportEntry = {
          ...base, problem: "Reported unhealthy but ping succeeds", failureKind: "unknown",
          diagnosis: "A fresh validation request succeeded — the provider is healthy.",
          action: "Health state rebuilt from a real response.", result: "recovered", latencyMs: probe.latencyMs,
        };
        recordHealEvent(entry);
        return entry;
      }
      rawError = probe.error ?? "";
      cls = classifyProviderFailure(rawError, { providerType: provider.type });
    }

    patchHealth(provider, {
      healState: "healing",
      lastDiagnosis: cls.humanMessage,
      lastFailureKind: cls.kind,
    });

    // === STEP 3-7: safe repairs per failure kind ===
    switch (cls.kind) {
      case "model_error":
      case "api_version_error": {
        const previousModel = provider.modelName;
        const catalog = await d.fetchCatalog(provider);
        const replacement = pickReplacementModel(provider, catalog.ok ? catalog.models : [], previousModel);
        if (!replacement || replacement === previousModel) {
          patchHealth(provider, {
            healState: "configuration_error",
            lastDiagnosis: `Auto-Heal could not find a compatible replacement model${catalog.ok ? "" : ` (catalog fetch failed: ${catalog.error ?? "unknown"})`}.`,
            autoHealAttempts: (provider.health?.autoHealAttempts ?? 0) + 1,
            failedRepairs: (provider.health?.failedRepairs ?? 0) + 1,
            lastHealAt: new Date().toISOString(),
          });
          const entry: HealReportEntry = {
            ...base, problem: `Invalid model id: ${previousModel || "(empty)"}`, failureKind: cls.kind,
            diagnosis: cls.humanMessage,
            action: catalog.ok ? "No compatible replacement found in the provider's catalog — Manual Heal required." : `Model catalog refresh failed (${catalog.error ?? "unknown"}) — Manual Heal required.`,
            previousModel, result: "manual_required", technical: rawError,
          };
          recordHealEvent(entry);
          return entry;
        }

        // Safe repair: update the model mapping (never keys/endpoints here).
        const enabled = provider.enabledModels ?? [];
        useApp.getState().updateProvider(provider.id, {
          modelName: replacement,
          enabledModels: enabled.includes(replacement) ? enabled : [...enabled, replacement],
        });
        const validate = await d.ping(provider, replacement);
        if (validate.ok) {
          await this.markRecovered(provider, validate.latencyMs, `Repaired model mapping: ${previousModel} → ${replacement}`, {
            autoHealAttempts: (provider.health?.autoHealAttempts ?? 0) + 1,
            successfulRepairs: (provider.health?.successfulRepairs ?? 0) + 1,
            lastHealAt: new Date().toISOString(),
          });
          const entry: HealReportEntry = {
            ...base, problem: `Invalid model id: ${previousModel || "(empty)"}`, failureKind: cls.kind,
            diagnosis: cls.humanMessage,
            action: `Refreshed model catalog and replaced the invalid model mapping (validated with a real request${validate.reply ? ` — replied "${validate.reply}"` : ""}).`,
            previousModel, newModel: replacement, result: "recovered", latencyMs: validate.latencyMs, technical: rawError,
          };
          recordHealEvent(entry);
          return entry;
        }

        // Replacement ALSO failed — classify the new failure honestly.
        const vCls = classifyProviderFailure(validate.error ?? "", { providerType: provider.type });
        patchHealth(provider, {
          healState: vCls.kind === "auth_error" ? "auth_error" : vCls.kind === "endpoint_error" ? "endpoint_error" : "configuration_error",
          lastDiagnosis: vCls.humanMessage,
          lastError: validate.error,
          autoHealAttempts: (provider.health?.autoHealAttempts ?? 0) + 1,
          failedRepairs: (provider.health?.failedRepairs ?? 0) + 1,
          lastHealAt: new Date().toISOString(),
        });
        recordHealthFailure(provider.id, validate.error ?? "validation failed");
        const entry: HealReportEntry = {
          ...base, problem: `Invalid model id: ${previousModel || "(empty)"}`, failureKind: cls.kind,
          diagnosis: cls.humanMessage,
          action: `Replaced model ${previousModel} → ${replacement}, but validation still failed (${vCls.kind}). Auto-Heal could not repair this provider — Manual Heal required.`,
          previousModel, newModel: replacement, result: "manual_required", latencyMs: validate.latencyMs, technical: validate.error ?? rawError,
        };
        recordHealEvent(entry);
        return entry;
      }

      case "endpoint_error": {
        const previousEndpoint = provider.baseUrl || provider.apiUrl;
        const catalogEntry = getProviderCatalogEntry(provider.type);
        const knownGood = catalogEntry.defaultUrl;
        // Safe repair ONLY when the type is a known catalog type AND the
        // current URL drifted from it. Never touches custom/self-hosted URLs.
        if (knownGood && previousEndpoint && previousEndpoint.replace(/\/$/, "") !== knownGood.replace(/\/$/, "") && provider.type !== "custom") {
          useApp.getState().updateProvider(provider.id, { baseUrl: knownGood });
          const validate = await d.ping(provider);
          if (validate.ok) {
            await this.markRecovered(provider, validate.latencyMs, `Repaired endpoint: ${previousEndpoint} → ${knownGood}`, {
              autoHealAttempts: (provider.health?.autoHealAttempts ?? 0) + 1,
              successfulRepairs: (provider.health?.successfulRepairs ?? 0) + 1,
              lastHealAt: new Date().toISOString(),
            });
            const entry: HealReportEntry = {
              ...base, problem: "API endpoint returned 404", failureKind: cls.kind,
              diagnosis: cls.humanMessage,
              action: `Validated the Base URL against the provider catalog and restored the current endpoint (validated with a real request).`,
              previousEndpoint, newEndpoint: knownGood, result: "recovered", latencyMs: validate.latencyMs, technical: rawError,
            };
            recordHealEvent(entry);
            return entry;
          }
          // Restored URL still fails — revert to the user's URL (never destroy user config).
          useApp.getState().updateProvider(provider.id, { baseUrl: previousEndpoint });
        }
        patchHealth(provider, {
          healState: "configuration_error",
          lastDiagnosis: "Endpoint error could not be safely repaired automatically. Verify the Base URL and API version manually.",
          autoHealAttempts: (provider.health?.autoHealAttempts ?? 0) + 1,
          failedRepairs: (provider.health?.failedRepairs ?? 0) + 1,
          lastHealAt: new Date().toISOString(),
        });
        const entry: HealReportEntry = {
          ...base, problem: "API endpoint returned 404", failureKind: cls.kind,
          diagnosis: cls.humanMessage,
          action: provider.type === "custom"
            ? "Custom/self-hosted endpoint — Auto-Heal never modifies unknown URLs. Manual Heal required."
            : "No safe automatic endpoint repair possible (URL matches the catalog or provider is custom). Manual Heal required.",
          previousEndpoint, result: "manual_required", technical: rawError,
        };
        recordHealEvent(entry);
        return entry;
      }

      case "auth_error": {
        patchHealth(provider, {
          healState: "auth_error",
          lastDiagnosis: cls.humanMessage,
          autoHealAttempts: (provider.health?.autoHealAttempts ?? 0) + 1,
          lastHealAt: new Date().toISOString(),
        });
        const entry: HealReportEntry = {
          ...base, problem: "Authentication / billing failure", failureKind: cls.kind,
          diagnosis: cls.humanMessage,
          action: "None — Auto-Heal never modifies API keys or billing. Verify the key in provider settings, then re-run Heal.",
          result: "manual_required", technical: rawError,
        };
        recordHealEvent(entry);
        return entry;
      }

      case "rate_limited": {
        const remaining = 60;
        patchHealth(provider, {
          healState: "cooldown",
          lastDiagnosis: cls.humanMessage,
          lastFailureKind: "rate_limited",
        });
        recordHealthFailure(provider.id, rawError.slice(0, 300), true);
        this.scheduleCooldownRetest(provider.id, remaining * 1000);
        const entry: HealReportEntry = {
          ...base, problem: "Rate limit / quota", failureKind: cls.kind,
          diagnosis: cls.humanMessage,
          action: "No configuration change. Cooldown applied; automatic re-test scheduled after the window.",
          result: "cooldown", technical: rawError,
        };
        recordHealEvent(entry);
        return entry;
      }

      case "provider_unavailable":
      case "network_error":
      case "proxy_error": {
        // Temporary — the router's retry/backoff handles these. No repair.
        patchHealth(provider, {
          healState: "unavailable",
          lastDiagnosis: cls.humanMessage,
          lastFailureKind: cls.kind,
        });
        recordHealthFailure(provider.id, rawError.slice(0, 300));
        const entry: HealReportEntry = {
          ...base, problem: cls.kind === "proxy_error" ? "Proxy failure" : "Provider temporarily unavailable",
          failureKind: cls.kind, diagnosis: cls.humanMessage,
          action: "No configuration change — temporary failure; the retry engine handles backoff and failover.",
          result: "skipped", technical: rawError,
        };
        recordHealEvent(entry);
        return entry;
      }

      default: {
        patchHealth(provider, {
          healState: "configuration_error",
          lastDiagnosis: cls.humanMessage,
          lastFailureKind: cls.kind,
          autoHealAttempts: (provider.health?.autoHealAttempts ?? 0) + 1,
          lastHealAt: new Date().toISOString(),
        });
        const entry: HealReportEntry = {
          ...base, problem: `Unclassified failure (${cls.kind})`, failureKind: cls.kind,
          diagnosis: cls.humanMessage,
          action: "Auto-Heal stays conservative — no configuration was modified. Review the technical details.",
          result: "manual_required", technical: rawError,
        };
        recordHealEvent(entry);
        return entry;
      }
    }
  }

  /**
   * HEAL ALL — manual recovery sweep (directive #7): scans every provider,
   * heals the unhealthy/degraded ones, leaves healthy ones untouched.
   */
  static async healAllProviders(mode: "auto" | "manual" = "manual", deps: HealerDeps = {}): Promise<HealReportEntry[]> {
    const providers = useApp.getState().providers || [];
    const needsHeal = providers.filter((p) => {
      if (!p.isActive) return false;
      if (providerInCooldown(p)) return true; // include cooldowns so they get scheduled re-tests
      const hs = p.health?.healState;
      if (hs && hs !== "healthy" && hs !== "untested") return true;
      if (p.health?.lastError) return true;
      return p.status === "degraded" || p.status === "down";
    });
    const reports: HealReportEntry[] = [];
    for (const p of needsHeal) {
      // Sequential — avoids hammering providers in parallel during recovery.
      reports.push(await ProviderHealer.healProvider(p, mode, undefined, deps));
    }
    return reports;
  }

  /**
   * Schedule an automatic post-cooldown re-test (directive #6): when the
   * cooldown expires the provider is validated with a real ping and returns
   * to HEALTHY without a page reload. Deduplicated per provider.
   */
  static scheduleCooldownRetest(providerId: string, remainingMs: number, deps: HealerDeps = {}): void {
    const existing = this.pendingRetests.get(providerId);
    if (existing) clearTimeout(existing);
    const wait = Math.min(Math.max(remainingMs, 1000), 5 * 60 * 1000);
    const t = setTimeout(async () => {
      this.pendingRetests.delete(providerId);
      const provider = useApp.getState().providers.find((p) => p.id === providerId);
      if (!provider) return;
      const d = { ...defaultDeps(), ...deps };
      const probe = await d.ping(provider);
      if (probe.ok) {
        resetCircuitBreaker(providerId);
        await this.markRecovered(provider, probe.latencyMs, "Post-cooldown re-test succeeded");
        recordHealEvent({
          providerId, providerName: provider.name, failureKind: "cooldown",
          diagnosis: "Cooldown expired.", action: "Automatic post-cooldown re-test passed.",
          result: "recovered", latencyMs: probe.latencyMs, mode: "auto",
        });
      } else {
        patchHealth(provider, {
          healState: "degraded",
          lastDiagnosis: "Post-cooldown re-test failed — provider still not healthy.",
          lastError: probe.error?.slice(0, 300),
        });
      }
    }, wait);
    this.pendingRetests.set(providerId, t);
  }

  /** Mark a provider healthy in BOTH health layers + clear error state.
   *  `extra` merges additional counters (heal attempts/repairs) atomically. */
  static async markRecovered(provider: AIProvider, latencyMs: number, note: string, extra?: Record<string, unknown>): Promise<void> {
    recordHealthSuccess(provider.id, latencyMs);
    resetCircuitBreaker(provider.id || provider.name || provider.type);
    const current = provider.health || { consecutiveFailures: 0, consecutiveSuccesses: 0 };
    patchHealth(provider, {
      healState: "recovered",
      lastDiagnosis: note,
      lastFailureKind: undefined,
      lastError: undefined,
      consecutiveFailures: 0,
      consecutiveSuccesses: (current.consecutiveSuccesses ?? 0) + 1,
      ...(extra ?? {}),
    });
  }

  /** True when a provider should be surfaced as needing attention in the UI. */
  static needsAttention(p: AIProvider): boolean {
    if (!p.isActive) return false;
    if (providerInCooldown(p)) return true;
    const hs = p.health?.healState;
    return !!hs && hs !== "healthy" && hs !== "recovered" && hs !== "untested";
  }
}

export type HealEventRecord = HealEvent;
