// ============================================================================
// Provider-Aware Benchmark Engine (directives #11, #20)
//
// "Run Benchmark Ping" must NEVER send one model id to every provider. For
// each eligible provider this engine:
//   requested model  →  provider registry  →  provider-compatible model
//     →  cooldown check  →  REAL ping (single-provider pinned — a provider's
//     model can never leak into another's request)  →  latency  →
//     classify result  →  update health state  →  optional Auto-Heal → re-ping
//
// Benchmark results are per-provider rows: model, status, latency, error,
// health, last checked, auto-heal status — never a single generic failure.
// ============================================================================

import { useApp } from "../../store";
import type { AIProvider } from "../../types";
import { ProviderRouter } from "../services/router";
import { getProviderCatalogEntry } from "../provider-catalog";
import { classifyProviderFailure, chipForClassification, type HealthChip } from "./error-classifier";
import { ProviderHealer, providerInCooldown, cooldownRemainingSeconds, type HealerDeps, type HealReportEntry } from "./provider-healer";
import { rateLimitTracker } from "../../rate-limit-tracker";

export type BenchmarkStatus =
  | "pass" | "cooldown" | "model_error" | "endpoint_error" | "auth_error"
  | "rate_limited" | "unavailable" | "failed" | "skipped" | "healed" | "heal_failed";

export interface BenchmarkRow {
  providerId: string;
  providerName: string;
  providerType: string;
  /** The provider-compatible model actually used for this ping. */
  resolvedModel: string;
  /** How the model was resolved (configured model / enabledModels / catalog). */
  modelSource: "configured" | "enabled" | "catalog" | "none";
  status: BenchmarkStatus;
  chip: HealthChip;
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
  /** Human diagnosis (never replaces the raw error — both are shown). */
  diagnosis?: string;
  health: AIProvider["status"];
  healState?: string;
  lastCheckedAt: string;
  /** Auto-heal outcome for this row (undefined = no heal attempted). */
  autoHeal?: { attempted: boolean; repaired: boolean; note: string; report?: HealReportEntry };
}

export interface BenchmarkReport {
  at: string;
  rows: BenchmarkRow[];
  allFailed: boolean;
  totalMs: number;
}

/**
 * Resolve the model this specific provider should be pinged with.
 *
 * BUG FIX (model selection authority): the provider's own configured
 * `modelName` — typically picked from the provider's LIVE catalog via
 * "Fetch models" — is now pinged FIRST. Previously this preferred
 * `enabledModels[0]`, i.e. the first entry of the static seed list, which
 * frequently holds a RETIRED model id. That made every benchmark/heal cycle
 * fail with model errors even when the provider was correctly configured.
 */
export function resolveProviderBenchmarkModel(provider: AIProvider): { model: string; source: BenchmarkRow["modelSource"] } {
  if (provider.modelName && provider.modelName.trim() !== "") {
    return { model: provider.modelName, source: "configured" };
  }
  const enabled = provider.enabledModels ?? [];
  if (enabled.length > 0 && enabled[0]) return { model: enabled[0], source: "enabled" };
  const catalogDefault = getProviderCatalogEntry(provider.type).defaultModel;
  if (catalogDefault) return { model: catalogDefault, source: "catalog" };
  return { model: "(none configured)", source: "none" };
}

function statusForClassification(kind: string, ok: boolean): BenchmarkStatus {
  if (ok) return "pass";
  switch (kind) {
    case "rate_limited": return "rate_limited";
    case "model_error":
    case "api_version_error": return "model_error";
    case "endpoint_error": return "endpoint_error";
    case "auth_error": return "auth_error";
    case "provider_unavailable":
    case "network_error":
    case "proxy_error": return "unavailable";
    default: return "failed";
  }
}

/**
 * Run the provider-aware benchmark across all eligible providers.
 * Every ping is pinned to its provider (singleProvider) with a model
 * resolved from THAT provider's own registry — cross-provider model
 * propagation is structurally impossible.
 */
export async function runProviderAwareBenchmark(opts: {
  /** Limit to specific provider ids (e.g. one provider's Health Check). */
  providerIds?: string[];
  /** Per-ping timeout. */
  timeoutMs?: number;
  deps?: HealerDeps;
} = {}): Promise<BenchmarkReport> {
  const t0 = Date.now();
  const state = useApp.getState();
  const isSuperAdmin = state.user?.role === "super_admin";
  const autoHeal = state.providerSettings?.autoHealProviders !== false;

  const eligible = (state.providers || []).filter((p) => {
    if (!p.isActive) return false;
    if (p.type === "puter") return false; // browser-session provider — not pingeable server-side
    if (opts.providerIds) return opts.providerIds.includes(p.id);
    return isSuperAdmin || p.allowedForRegularUsers === true;
  });

  const rows: BenchmarkRow[] = [];

  for (const provider of eligible) {
    const { model, source } = resolveProviderBenchmarkModel(provider);
    const lastCheckedAt = new Date().toISOString();

    // === Cooldown check — report, don't punish (directive #6) ===
    if (providerInCooldown(provider)) {
      const remaining = cooldownRemainingSeconds(provider);
      rows.push({
        providerId: provider.id, providerName: provider.name, providerType: provider.type,
        resolvedModel: model, modelSource: source,
        status: "cooldown", chip: "COOLDOWN", ok: false,
        latencyMs: 0,
        diagnosis: `Temporary cooldown — ${remaining}s remaining. The router automatically moves to other providers and re-tests this one when the window expires.`,
        health: provider.status, healState: provider.health?.healState ?? "cooldown",
        lastCheckedAt,
        autoHeal: { attempted: true, repaired: false, note: "Cooldown — no config change; automatic re-test scheduled." },
      });
      ProviderHealer.scheduleCooldownRetest(provider.id, remaining * 1000, opts.deps);
      continue;
    }

    // === REAL ping — pinned to this provider, with ITS OWN model ===
    let pingError: string | undefined;
    let pingReply: string | undefined;
    let latencyMs = 0;
    let ok = false;
    const deps = opts.deps;
    if (deps?.ping) {
      const r = await deps.ping(provider, model);
      ok = r.ok; latencyMs = r.latencyMs; pingReply = r.reply; pingError = r.error;
    } else {
      const t = performance.now?.() ?? Date.now();
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
            timeoutMs: opts.timeoutMs ?? Math.min(15000, provider.timeout || 15000),
          }
        );
        ok = true;
        pingReply = res.text.trim().slice(0, 40);
        latencyMs = Math.round((performance.now?.() ?? Date.now()) - t);
      } catch (e: any) {
        pingError = e?.message ?? String(e);
        latencyMs = Math.round((performance.now?.() ?? Date.now()) - t);
      }
    }

    const cls = classifyProviderFailure(pingError ?? "", { providerType: provider.type });
    const status = statusForClassification(ok ? "ok" : cls.kind, ok);

    // === Update health state from the benchmark result ===
    if (ok) {
      rateLimitTracker.recordSuccess(provider.id, model);
      const current = provider.health || { consecutiveFailures: 0, consecutiveSuccesses: 0 };
      useApp.getState().updateProvider(provider.id, {
        status: "healthy",
        health: {
          ...current,
          consecutiveFailures: 0,
          consecutiveSuccesses: (current.consecutiveSuccesses ?? 0) + 1,
          lastSuccessAt: lastCheckedAt,
          lastError: undefined,
          healState: "healthy",
          lastFailureKind: undefined,
          lastDiagnosis: `Benchmark ping passed (${latencyMs}ms) on ${model}.`,
        },
      });
      rows.push({
        providerId: provider.id, providerName: provider.name, providerType: provider.type,
        resolvedModel: model, modelSource: source,
        status: "pass", chip: "PASS", ok: true, latencyMs, reply: pingReply,
        health: "healthy", healState: "healthy", lastCheckedAt,
      });
      continue;
    }

    // === Failure: record + classify + optional Auto-Heal (directives #3, #13) ===
    const current = provider.health || { consecutiveFailures: 0, consecutiveSuccesses: 0 };
    useApp.getState().updateProvider(provider.id, {
      // Both temporary and permanent failures keep the provider "degraded" —
      // only a PASS (or a healed re-ping) flips it back to "healthy".
      status: "degraded",
      health: {
        ...current,
        consecutiveFailures: (current.consecutiveFailures ?? 0) + 1,
        consecutiveSuccesses: 0,
        lastFailureAt: lastCheckedAt,
        lastError: pingError?.slice(0, 400),
        lastFailureKind: cls.kind,
        lastDiagnosis: cls.humanMessage,
        // BUG FIX (state honesty): a rate-limit result IS a cooldown — reflect
        // it in healState so the card matches the COOLDOWN row instead of
        // showing a stale CONFIGURATION ERROR from a previous cycle.
        ...(cls.kind === "rate_limited" ? { healState: "cooldown" as const } : {}),
      },
    });

    let autoHealInfo: BenchmarkRow["autoHeal"];
    let finalStatus = status;
    let finalOk = false;
    let finalLatency = latencyMs;
    let finalReply = pingReply;

    if (autoHeal && cls.healable) {
      const report = await ProviderHealer.healProvider(provider, "auto", pingError, opts.deps);
      if (report.result === "recovered") {
        // Re-ping with the REPAIRED configuration — benchmark continues (directive #20).
        const recheck = deps?.ping
          ? await deps.ping(provider)
          : await (async () => {
              const t = performance.now?.() ?? Date.now();
              try {
                const res = await ProviderRouter.chat(
                  {
                    messages: [
                      { role: "system", content: "Respond in exactly one word: 'READY'. Do not write anything else." },
                      { role: "user", content: "status check" },
                    ],
                    model: report.newModel,
                    maxTokens: 5,
                  },
                  {
                    preferredProviderId: provider.id,
                    singleProvider: true,
                    requestType: "test",
                    timeoutMs: opts.timeoutMs ?? 15000,
                  }
                );
                return { ok: true, latencyMs: Math.round((performance.now?.() ?? Date.now()) - t), reply: res.text.trim().slice(0, 40) };
              } catch (e: any) {
                return { ok: false, latencyMs: Math.round((performance.now?.() ?? Date.now()) - t), error: e?.message ?? String(e) };
              }
            })();
        if (recheck.ok) {
          finalStatus = "healed";
          finalOk = true;
          finalLatency = recheck.latencyMs;
          finalReply = recheck.reply;
          autoHealInfo = {
            attempted: true, repaired: true,
            note: `Auto-Healed: ${report.previousModel ?? "model"} → ${report.newModel ?? "model"}. Re-ping passed.`,
            report,
          };
        } else {
          finalStatus = "heal_failed";
          autoHealInfo = { attempted: true, repaired: false, note: "Auto-Heal repaired the mapping but validation still fails — Manual Heal required.", report };
        }
      } else if (report.result === "cooldown") {
        finalStatus = "cooldown";
        autoHealInfo = { attempted: true, repaired: false, note: report.action, report };
      } else if (report.result === "manual_required") {
        autoHealInfo = { attempted: true, repaired: false, note: report.action, report };
      } else {
        autoHealInfo = { attempted: true, repaired: false, note: report.action, report };
      }
    }

    rows.push({
      providerId: provider.id, providerName: provider.name, providerType: provider.type,
      resolvedModel: model, modelSource: source,
      status: finalStatus,
      chip: finalOk ? (finalStatus === "healed" ? "RECOVERED" : "PASS") : chipForClassification(cls),
      ok: finalOk,
      latencyMs: finalLatency,
      reply: finalReply,
      error: pingError,
      diagnosis: autoHealInfo?.note ?? cls.humanMessage,
      health: "degraded",
      healState: finalOk ? "recovered" : cls.kind,
      lastCheckedAt,
      autoHeal: autoHealInfo,
    });
  }

  const allFailed = rows.length > 0 && rows.every((r) => !r.ok && r.status !== "cooldown");
  return { at: lastCheckedStamp(rows), rows, allFailed, totalMs: Date.now() - t0 };
}

function lastCheckedStamp(rows: BenchmarkRow[]): string {
  return rows[0]?.lastCheckedAt ?? new Date().toISOString();
}
