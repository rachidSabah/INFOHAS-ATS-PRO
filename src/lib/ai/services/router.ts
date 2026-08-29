// ProviderRouter — the single entrypoint for all AI requests in the app.
// No feature should ever call a provider adapter directly — always go through router.chat().
//
//   const response = await ProviderRouter.chat({ messages: [...] });
//
// The router:
//   1. Builds the provider chain (default → fallbacks → others by priority)
//   2. Tries each in order, with retries per provider per the retry policy
//   3. Logs every attempt to the provider logs store
//   4. Throws only if all providers in the chain fail
"use client";

import type { AIProvider, AIProviderSettings, AIProviderLog } from "../../types";
import type { ChatRequest, ChatResponse, ProviderConfig } from "../providers/interface";
import { ProviderFactory, ProviderError } from "./factory";
import { FallbackManager, toProviderConfig } from "./fallback";
import { useApp, uid } from "../../store";
import { modelRegistry } from "../../model-registry";
import { rateLimitTracker } from "../../rate-limit-tracker";

// Advanced routing & failover imports (ADR-001):
import { localGenerate } from "../../local-engine";
import {
  isProviderInCooldown,
  getProviderCooldownRemainingMs,
  getProviderCooldownClass,
  markProvider429Cooldown,
  markProvider401Cooldown,
  markProviderTimeoutCooldown,
  recordTrafficCooldownFromError,
  clearProviderCooldownOnSuccess,
  isTimeoutError,
  type ProviderCooldownClass,
} from "../../provider-cooldown";
import { globalEventBus } from "../../agent-event-bus";
import {
  acquireProviderSlot,
  releaseProviderSlot,
  getProviderInFlight,
  getProviderConcurrencyOpts,
  getEffectiveProviderCap,
  getConfiguredProviderCap,
  recordProviderRateLimitHit,
  recordProviderTrafficSuccess,
} from "../../provider-concurrency";
import { getPromptCache, setPromptCache, buildPromptHash } from "../../prompt-cache";
import { tryRotateProviderToken, isRotatableAuthError } from "../../token-rotation";
import { withTimeout, OptimizationProviderExhaustedError, AI_CALL_TIMEOUT_MS } from "../../pipeline-watchdog";
import { truncatePromptToTokenLimit, MAX_INPUT_TOKENS } from "../../ai-diagnostics";
import { isOpenCodeZenFree } from "../../provider-capabilities";
import { shouldSkipForOptimization, EMERGENCY_ONLY_PROVIDERS } from "../../circuit-breaker";

export interface RouterOptions {
  /** Override the default provider for this single call. */
  preferredProviderId?: string;
  /** Caller-facing provider pin (mirrored from AICallOptions.providerId). */
  providerId?: string;
  /** Skip the failover chain — only try this one provider. */
  singleProvider?: boolean;
  /** Mark this request as a "test" rather than "chat" in logs. */
  requestType?: AIProviderLog["requestType"];
  /** Agent task for capability-weighted model selection (summary, skills, etc.) */
  agentTask?: string;

  // Options from AICallOptions:
  preferLocal?: boolean;
  preferServer?: boolean;
  taskCategory?: "document" | "interactive" | "development";
  isOptimizerCall?: boolean;
  timeoutMs?: number;
  excludeProviderIds?: string[];
  enableRetries?: boolean;
  enableProviderSwitch?: boolean;
  agentType?: "optimizer" | "supervisor" | "guardian" | "assembler" | "emergency" | "simple" | "reasoning";
  modelOverride?: string;
}

export class ProviderRouter {
  /**
   * Send a chat request through the AI gateway.
   * Reads providers + settings from the Zustand store.
   *
   * ACCESS CONTROL:
   *   - Super admins can use ALL active providers
   *   - Regular users (and admins) can ONLY use providers with allowedForRegularUsers=true
   *     (typically Puter.js, OpenCode, ZenCode, and the Z.ai fallback)
   */
  static async chat(req: ChatRequest, opts: RouterOptions = {}): Promise<ChatResponse> {
    const t0 = performance.now();
    const state = useApp.getState();
    const allProviders = state.providers;
    const settings = state.providerSettings;
    const user = state.user;

    // Filter providers by user role
    const isSuperAdmin = user?.role === "super_admin";
    const providers = isSuperAdmin
      ? allProviders // super admin sees everything
      : allProviders.filter((p) => p.allowedForRegularUsers === true); // regular users only see allowed providers

    // === 1. Token Limit Checking & Truncation ===
    const systemPrompt = req.messages.find((m) => m.role === "system")?.content ?? "";
    let userPrompt = req.messages.find((m) => m.role === "user")?.content ?? "";
    const totalTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
    if (totalTokens > MAX_INPUT_TOKENS) {
      const systemTokens = Math.ceil(systemPrompt.length / 4);
      const userBudget = Math.max(0, MAX_INPUT_TOKENS - systemTokens);
      userPrompt = truncatePromptToTokenLimit(userPrompt, userBudget);
      // Rebuild messages list with truncated prompt
      req.messages = req.messages.map((m) => {
        if (m.role === "user") return { ...m, content: userPrompt };
        return m;
      });
    }

    // === 2. Cache check ===
    let cacheHash = "";
    if (opts.isOptimizerCall && typeof window !== "undefined") {
      try {
        cacheHash = buildPromptHash({
          systemPrompt,
          userPrompt,
          modelOverride: opts.modelOverride ?? req.model,
        });
        const cached = getPromptCache(cacheHash);
        if (cached) {
          console.info("[AI] Prompt cache hit — returning instantly without API call");
          return {
            text: cached.text,
            provider: cached.provider,
            model: opts.modelOverride ?? req.model ?? "cached",
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
          };
        }
      } catch (cacheErr) {
        console.warn("[AI] Cache read error (non-fatal):", cacheErr);
      }
    }

    // === 3. Prefer Local / Local Fallback Check ===
    if (opts.preferLocal) {
      const localText = localGenerate({
        systemPrompt,
        userPrompt,
        preferLocal: true,
      });
      return {
        text: localText,
        provider: "Local Engine (offline mode)",
        model: "local",
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    // === 4. Speculative Parallel Race ===
    if (opts.isOptimizerCall && !opts.preferredProviderId && !opts.excludeProviderIds?.length && typeof window !== "undefined") {
      try {
        const raceTimeout = opts.timeoutMs ?? AI_CALL_TIMEOUT_MS;
        const raceRes = await this.runSpeculativeRace(req, opts, raceTimeout, t0);
        if (raceRes) {
          if (cacheHash) {
            setPromptCache(cacheHash, {
              text: raceRes.text,
              provider: raceRes.provider,
              latencyMs: raceRes.latencyMs,
              tokensEstimate: Math.ceil(raceRes.text.length / 4),
            });
          }
          return raceRes;
        }
      } catch (raceErr) {
        console.warn("[AI] Speculative race error:", raceErr);
      }
    }

    // === 5. Build Fallback Chain (shared with stream()) ===
    let chain = await ProviderRouter.resolveChain(providers, settings, req, opts);

    if (chain.length === 0) {
      throw new Error(
        isSuperAdmin
          ? "No active AI providers. Configure one in Super Admin → AI Providers."
          : "No AI providers available for your account. Use Puter.js (free) by signing in with Google via the Puter button."
      );
    }

    // === 6. Execution Loop with Fallovers ===
    const errors: string[] = [];
    const callTimeoutMs = opts.timeoutMs ?? AI_CALL_TIMEOUT_MS;

    for (const provider of chain) {
      const cooldownId = provider.id || provider.name || provider.type;

      // Skip rate-limited / cooldown providers — REAL TRAFFIC ONLY.
      // Probes (requestType "test": preflight / benchmark / heal pings) must
      // reach the provider even while it is cooled down: cooldowns gate
      // traffic, not evidence. Blocking probes made heal/benchmark pings fail
      // with an unclassifiable "in cooldown (Xs remaining)" error and meant a
      // cooled provider could never be re-tested (or early-cleared) again.
      const isProbe = opts.requestType === "test";
      if (!isProbe) {
        const trackerLimited = rateLimitTracker.isRateLimited(provider.id);
        const sessionCool = isProviderInCooldown(cooldownId);
        if (trackerLimited || sessionCool) {
          // S2 — structured, ACCURATE skip reason (the old code guessed a
          // hardcoded "60s" for the session layer). Feeds the trajectory
          // panel: WHY was this provider skipped, and until when.
          const layer: "tracker" | "session" = trackerLimited ? "tracker" : "session";
          const remainingMs = trackerLimited
            ? rateLimitTracker.getCooldownRemainingMs(provider.id)
            : getProviderCooldownRemainingMs(cooldownId);
          const cls: ProviderCooldownClass | "tracker-backoff" = trackerLimited
            ? "tracker-backoff"
            : (getProviderCooldownClass(cooldownId) ?? "unknown");
          try {
            globalEventBus.emit({
              agent: "ProviderRouter",
              action: "skip_provider",
              resumeId: provider.name,
              provider: provider.name,
              success: false,
              metadata: {
                reason: "cooldown",
                layer,
                class: cls,
                remainingMs,
                requestType: opts.requestType ?? "chat",
              },
            });
          } catch { /* event bus must never break routing */ }
          errors.push(`${provider.name}: in cooldown (${Math.max(1, Math.ceil(remainingMs / 1000))}s remaining)`);
          continue;
        }
      }

      // Check budget constraint: if total elapsed time exceeds the callTimeout budget,
      // skip this provider and fallback immediately.
      const elapsedMs = Math.round(performance.now() - t0);
      if (elapsedMs >= callTimeoutMs) {
        console.warn(`[AI] Budget exhausted (${elapsedMs}ms ≥ ${callTimeoutMs}ms). Skipping remaining chain.`);
        break;
      }

      // S3 — per-provider concurrency cap. Parallel pipeline agents (the
      // intelligence stage, the locked pipeline's optimizer stage) can fire
      // several requests at ONE provider simultaneously — on free tiers that
      // self-inflicts 429s indistinguishable from quota exhaustion. Traffic
      // waits up to maxWaitMs for a slot, then falls through; probes bypass.
      // Task 19: the cap is per-PROVIDER configurable (AIProvider.concurrencyCap).
      const slotAcquired = await acquireProviderSlot(cooldownId, { probe: isProbe, cap: provider.concurrencyCap });
      if (!slotAcquired) {
        const inFlight = getProviderInFlight(cooldownId);
        try {
          globalEventBus.emit({
            agent: "ProviderRouter",
            action: "skip_provider",
            resumeId: provider.name,
            provider: provider.name,
            success: false,
            metadata: {
              reason: "provider_busy",
              inFlight,
              cap: getEffectiveProviderCap(cooldownId, provider.concurrencyCap),
              waitedMs: getProviderConcurrencyOpts().maxWaitMs,
              requestType: opts.requestType ?? "chat",
            },
          });
        } catch { /* event bus must never break routing */ }
        errors.push(`${provider.name}: provider busy (${inFlight} in-flight, concurrency cap)`);
        continue;
      }

      try {
        const attemptTimeout = chain.length > 1 ? Math.min(25000, callTimeoutMs - elapsedMs) : callTimeoutMs - elapsedMs;
        const res = await this.tryProviderWithRotations(
          provider,
          req,
          settings,
          opts.requestType || "chat",
          attemptTimeout,
          opts,
          ProviderRouter.modelForProvider(provider, opts, req)
        );

        // Success path — evidence of recovery clears any stale cooldown.
        clearProviderCooldownOnSuccess(cooldownId);
        // Task 20 — adaptive cap: consecutive real-traffic successes step the
        // cap back up toward the configured ceiling (AIMD additive increase).
        try {
          const capCh = recordProviderTrafficSuccess(cooldownId, getConfiguredProviderCap(cooldownId, provider.concurrencyCap));
          if (capCh.changed) {
            globalEventBus.emit({
              agent: "ProviderRouter",
              action: "cap_recover",
              resumeId: provider.name,
              provider: provider.name,
              success: true,
              metadata: { from: capCh.from, to: capCh.to, ceiling: capCh.ceiling, consecutiveSuccesses: capCh.consecutiveSuccesses },
            });
          }
        } catch { /* event bus must never break routing */ }
        if (cacheHash) {
          setPromptCache(cacheHash, {
            text: res.text,
            provider: res.provider,
            latencyMs: res.latencyMs,
            tokensEstimate: (res.inputTokens ?? 0) + (res.outputTokens ?? 0) || Math.ceil(res.text.length / 4),
          });
        }
        return res;
      } catch (e: any) {
        const eMsg = e?.message ?? String(e);
        errors.push(`${provider.name}: ${eMsg}`);
        console.warn(`[AI] Provider ${provider.name} failed: ${eMsg}`);

        // Record cooldowns — REAL traffic only. Probe requests (requestType
        // "test": preflight / benchmark / heal pings) record health evidence
        // via the benchmark/heal machinery but NEVER arm router cooldowns —
        // otherwise free-tier providers 429 the probe and get stuck in a
        // perpetual "cooldown without usage" cycle (see provider-cooldown.ts).
        // Task 20 — adaptive cap: the returned evidence class also tightens
        // the per-provider concurrency cap on 429-family errors (AIMD
        // multiplicative decrease). Probes return null → never tighten.
        const armedClass = recordTrafficCooldownFromError({
          cooldownId,
          providerId: provider.id,
          modelName: provider.modelName,
          error: e,
          statusCode: e?.statusCode,
          isTimeout: isTimeoutError(e),
          requestType: opts.requestType,
        });
        if (armedClass === "429") {
          try {
            const capCh = recordProviderRateLimitHit(cooldownId, getConfiguredProviderCap(cooldownId, provider.concurrencyCap));
            if (capCh.changed) {
              globalEventBus.emit({
                agent: "ProviderRouter",
                action: "cap_tighten",
                resumeId: provider.name,
                provider: provider.name,
                success: true,
                metadata: { from: capCh.from, to: capCh.to, ceiling: capCh.ceiling, cause: "429", requestType: opts.requestType ?? "chat" },
              });
            }
          } catch { /* event bus must never break routing */ }
        }
      } finally {
        // S3 — the slot covers exactly one provider attempt (rotations are
        // sequential inside tryProviderWithRotations, so this only throttles
        // DIFFERENT pipeline agents racing for the same provider).
        releaseProviderSlot(cooldownId);
      }
    }

    // === 7. Last Resort Fallback: Local Engine ===
    console.warn("[AI] All providers failed. Falling back to local engine.");
    const localText = localGenerate({
      systemPrompt,
      userPrompt,
      preferLocal: true,
    });
    if (localText) {
      return {
        text: localText,
        provider: "Local Engine (fallback)",
        model: "local",
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    throw new OptimizationProviderExhaustedError(
      `All AI providers failed for this request:\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`
    );
  }

  /**
   * STREAMING entrypoint — Phase 8.1.3.2B.
   * Reuses the EXACT same fallback chain, cooldowns, provider selection,
   * capability-weighted model routing, and timeouts as `chat()` (no duplicate
   * router). The only difference is response delivery: when an adapter
   * implements `stream()`, text chunks are piped through `onChunk` as they
   * arrive; otherwise the adapter's full response is emitted as chunks so every
   * consumer still receives progressive text through a single code path.
   */
  static async stream(
    req: ChatRequest,
    opts: RouterOptions = {},
    onChunk: (text: string) => void = () => {}
  ): Promise<ChatResponse> {
    const t0 = performance.now();
    const state = useApp.getState();
    const allProviders = state.providers;
    const isSuperAdmin = state.user?.role === "super_admin";
    const providers = isSuperAdmin
      ? allProviders
      : allProviders.filter((p) => p.allowedForRegularUsers === true);

    // === 1. Token-limit truncation (same as chat) ===
    const systemPrompt = req.messages.find((m) => m.role === "system")?.content ?? "";
    let userPrompt = req.messages.find((m) => m.role === "user")?.content ?? "";
    const totalTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
    if (totalTokens > MAX_INPUT_TOKENS) {
      const systemTokens = Math.ceil(systemPrompt.length / 4);
      const userBudget = Math.max(0, MAX_INPUT_TOKENS - systemTokens);
      userPrompt = truncatePromptToTokenLimit(userPrompt, userBudget);
      req.messages = req.messages.map((m) => (m.role === "user" ? { ...m, content: userPrompt } : m));
    }

    // === 2. Resolve the fallback chain (shared logic with chat) ===
    const chain = await ProviderRouter.resolveChain(providers, state.providerSettings, req, opts);
    if (chain.length === 0) {
      throw new Error(
        isSuperAdmin
          ? "No active AI providers. Configure one in Super Admin → AI Providers."
          : "No AI providers available for your account. Use Puter.js (free) by signing in with Google via the Puter button."
      );
    }

    // === 3. Execution loop with fallovers (streaming delivery) ===
    const errors: string[] = [];
    const callTimeoutMs = opts.timeoutMs ?? AI_CALL_TIMEOUT_MS;

    for (const provider of chain) {
      const cooldownId = provider.id || provider.name || provider.type;

      // Same probe-vs-traffic rule as chat(): cooldowns gate traffic, not
      // evidence — probes must reach cooled-down providers.
      const isProbe = opts.requestType === "test";
      if (!isProbe) {
        const trackerLimited = rateLimitTracker.isRateLimited(provider.id);
        const sessionCool = isProviderInCooldown(cooldownId);
        if (trackerLimited || sessionCool) {
          // S2 — structured, accurate skip reason (chat-path parity).
          const layer: "tracker" | "session" = trackerLimited ? "tracker" : "session";
          const remainingMs = trackerLimited
            ? rateLimitTracker.getCooldownRemainingMs(provider.id)
            : getProviderCooldownRemainingMs(cooldownId);
          const cls: ProviderCooldownClass | "tracker-backoff" = trackerLimited
            ? "tracker-backoff"
            : (getProviderCooldownClass(cooldownId) ?? "unknown");
          try {
            globalEventBus.emit({
              agent: "ProviderRouter",
              action: "skip_provider",
              resumeId: provider.name,
              provider: provider.name,
              success: false,
              metadata: {
                reason: "cooldown",
                layer,
                class: cls,
                remainingMs,
                requestType: opts.requestType ?? "chat",
              },
            });
          } catch { /* event bus must never break routing */ }
          errors.push(`${provider.name}: in cooldown (${Math.max(1, Math.ceil(remainingMs / 1000))}s remaining)`);
          continue;
        }
      }

      const elapsedMs = Math.round(performance.now() - t0);
      if (elapsedMs >= callTimeoutMs) {
        console.warn(`[AI Stream] Budget exhausted (${elapsedMs}ms ≥ ${callTimeoutMs}ms). Skipping remaining chain.`);
        break;
      }

      // S3 — per-provider concurrency cap (chat-path parity). Probes bypass.
      // Task 19: the cap is per-PROVIDER configurable (AIProvider.concurrencyCap).
      const slotAcquired = await acquireProviderSlot(cooldownId, { probe: isProbe, cap: provider.concurrencyCap });
      if (!slotAcquired) {
        const inFlight = getProviderInFlight(cooldownId);
        try {
          globalEventBus.emit({
            agent: "ProviderRouter",
            action: "skip_provider",
            resumeId: provider.name,
            provider: provider.name,
            success: false,
            metadata: {
              reason: "provider_busy",
              inFlight,
              cap: getEffectiveProviderCap(cooldownId, provider.concurrencyCap),
              waitedMs: getProviderConcurrencyOpts().maxWaitMs,
              requestType: opts.requestType ?? "chat",
            },
          });
        } catch { /* event bus must never break routing */ }
        errors.push(`${provider.name}: provider busy (${inFlight} in-flight, concurrency cap)`);
        continue;
      }

      // Per-provider rotation state — same dedup semantics as chat().
      const modelForAttempt = ProviderRouter.modelForProvider(provider, opts, req);
      const rotationState = {
        triedKeys: new Set<string>([provider.apiKey || ""]),
        triedModels: new Set<string>([modelForAttempt || provider.modelName || ""]),
        tokenRotationTried: false,
      };

      try {
        const attemptTimeout = chain.length > 1 ? Math.min(25000, callTimeoutMs - elapsedMs) : callTimeoutMs - elapsedMs;
        const adapter = ProviderFactory.get(provider.type);
        const config = toProviderConfig(provider);

        let res: ChatResponse;
        if (typeof (adapter as any).stream === "function" && provider.type !== "local") {
          res = await withTimeout(
            (adapter as any).stream({ ...req, model: modelForAttempt }, config, onChunk),
            attemptTimeout,
            `${provider.name}.stream`
          );
        } else {
          res = await withTimeout(
            adapter.chat({ ...req, model: modelForAttempt }, config),
            attemptTimeout,
            `${provider.name}.generate`
          );
          // Non-streaming adapter: emit the full text as tokens so the consumer
          // still receives progressive output through the single onChunk path.
          for (const token of res.text.split(/(\s+)/)) onChunk(token);
        }

        this.log({
          providerId: provider.id,
          providerName: provider.name,
          requestType: opts.requestType || "chat",
          modelName: res.model,
          status: "success",
          latencyMs: res.latencyMs,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          requestPreview: req.messages[req.messages.length - 1]?.content?.slice(0, 200),
          responsePreview: res.text.slice(0, 200),
        });

        // Evidence of recovery clears any stale cooldown (stream path).
        clearProviderCooldownOnSuccess(cooldownId);
        // Task 20 — adaptive cap recovery (chat-path parity).
        try {
          const capCh = recordProviderTrafficSuccess(cooldownId, getConfiguredProviderCap(cooldownId, provider.concurrencyCap));
          if (capCh.changed) {
            globalEventBus.emit({
              agent: "ProviderRouter",
              action: "cap_recover",
              resumeId: provider.name,
              provider: provider.name,
              success: true,
              metadata: { from: capCh.from, to: capCh.to, ceiling: capCh.ceiling, consecutiveSuccesses: capCh.consecutiveSuccesses },
            });
          }
        } catch { /* event bus must never break routing */ }
        return res;
      } catch (e: any) {
        const eMsg = e?.message ?? String(e);
        errors.push(`${provider.name}: ${eMsg}`);
        console.warn(`[AI Stream] Provider ${provider.name} failed: ${eMsg}`);
        // Same traffic-vs-probe rule as chat(): probes never arm cooldowns.
        // Task 20 — adaptive cap tighten on 429-family evidence (chat-path parity).
        const armedClass = recordTrafficCooldownFromError({
          cooldownId,
          providerId: provider.id,
          modelName: provider.modelName,
          error: e,
          statusCode: e?.statusCode,
          isTimeout: isTimeoutError(e),
          requestType: opts.requestType,
        });
        if (armedClass === "429") {
          try {
            const capCh = recordProviderRateLimitHit(cooldownId, getConfiguredProviderCap(cooldownId, provider.concurrencyCap));
            if (capCh.changed) {
              globalEventBus.emit({
                agent: "ProviderRouter",
                action: "cap_tighten",
                resumeId: provider.name,
                provider: provider.name,
                success: true,
                metadata: { from: capCh.from, to: capCh.to, ceiling: capCh.ceiling, cause: "429", requestType: opts.requestType ?? "chat" },
              });
            }
          } catch { /* event bus must never break routing */ }
        }

        // === Rotation fallbacks (same as chat) ===
        // A broken stream cannot be resumed, so a rotated retry is delivered
        // as chunks via the shared onChunk path (same as non-streaming
        // adapters). Previously streaming had NO key/token/model rotation.
        const attemptTimeout = chain.length > 1 ? Math.min(25000, callTimeoutMs - Math.round(performance.now() - t0)) : callTimeoutMs - Math.round(performance.now() - t0);
        const { keyRotation, modelRotation } = this.classifyRotationError(e);
        if (keyRotation || modelRotation) {
          try {
            const rotated = await this.tryRotationFallbacks(
              provider,
              req,
              toProviderConfig(provider),
              e,
              attemptTimeout,
              opts,
              opts.requestType || "chat",
              rotationState,
              modelForAttempt
            );
            if (rotated) {
              for (const token of rotated.text.split(/(\s+)/)) onChunk(token);
              return rotated;
            }
          } catch (rotErr: any) {
            console.warn(`[AI Stream] Rotation fallbacks failed for ${provider.name}: ${rotErr?.message || rotErr}`);
          }
        }
      } finally {
        // S3 — the slot covers exactly one provider attempt (rotation
        // fallbacks above are sequential and part of the same attempt).
        releaseProviderSlot(cooldownId);
      }
    }

    // === 4. Last-resort local fallback (emit as chunks) ===
    console.warn("[AI Stream] All providers failed. Falling back to local engine.");
    const localText = localGenerate({ systemPrompt, userPrompt, preferLocal: true });
    if (localText) {
      for (const token of localText.split(/(\s+)/)) onChunk(token);
      return {
        text: localText,
        provider: "Local Engine (fallback)",
        model: "local",
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    throw new OptimizationProviderExhaustedError(
      `All AI providers failed for this streaming request:\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`
    );
  }

  /**
   * Shared fallback-chain resolution used by BOTH `chat()` and `stream()`.
   * Builds the ordered provider chain (preferred → agent route → capability-
   * weighted model → default), applying cooldown-safe mutation on a copy so the
   * caller's array is untouched.
   */
  private static async resolveChain(
    providers: any[],
    settings: any,
    req: ChatRequest,
    opts: RouterOptions
  ): Promise<any[]> {
    let chain = FallbackManager.buildChain(providers, settings);

    // === EXPLICIT SINGLE-PROVIDER PIN ===
    // When `singleProvider` is set (benchmark pings, preflight validation,
    // diagnostics), the chain is cut to EXACTLY the preferred provider. This
    // makes it structurally impossible for one provider's request — and its
    // model override — to leak into other providers' configurations.
    if (opts.singleProvider && opts.preferredProviderId) {
      const pinned = chain.find((p) => p.id === opts.preferredProviderId);
      if (pinned) return [pinned];
      const found = providers.find((p) => p.id === opts.preferredProviderId);
      return found ? [found] : [];
    }

    const prefId = opts.preferredProviderId;
    if (prefId) {
      const pref = providers.find((p) => p.id === prefId);
      if (pref) {
        chain = chain.filter((p) => p.id !== prefId);
        chain.unshift(pref);
      }
      return chain;
    }

    let agentType = opts.agentType;
    if (!agentType) {
      if (opts.isOptimizerCall) {
        agentType = "optimizer";
      } else if (req.messages.some((m) => /quality assurance|qa|reflection/i.test(m.content))) {
        agentType = "supervisor";
      } else if (req.messages.some((m) => /guardian|anti-fabrication/i.test(m.content))) {
        agentType = "guardian";
      } else if (req.messages.some((m) => /format|assemble/i.test(m.content))) {
        agentType = "assembler";
      }
    }

    if (agentType) {
      const agentProvider = await selectProviderForAgent(agentType as any, opts.excludeProviderIds);
      if (agentProvider) {
        chain = chain.filter((p) => p.id !== agentProvider.id);
        chain.unshift(agentProvider);
      }
    }

    if (opts.agentTask && modelRegistry.size() > 0) {
      const bestModel = modelRegistry.getBestForTask(opts.agentTask);
      if (bestModel) {
        const bestProvider = providers.find((p) => p.id === bestModel.providerId);
        if (bestProvider && !rateLimitTracker.isRateLimited(bestProvider.id)) {
          chain = chain.filter((p) => p.id !== bestProvider.id);
          chain.unshift(bestProvider);
        }
      }
    }

    return chain;
  }

  /**
   * MODEL-ROUTING SAFETY — never propagate one model id across providers.
   *
   * A model override / requested model is only valid for the provider it was
   * resolved against (the pinned provider). Every OTHER provider in the chain
   * must use its own configured model — previously `hy3-free` (a ZenCode free
   * model) leaked into the whole fallback chain and produced model_error 404s
   * on NVIDIA/Google/Mistral/Groq ("The model `hy3-free` does not exist").
   *
   * Returns the model to use for THIS provider, or undefined to let the
   * adapter fall back to the provider's own configured model.
   */
  static modelForProvider(provider: AIProvider, opts: RouterOptions, req: ChatRequest): string | undefined {
    const requested = opts.modelOverride || req.model;
    if (opts.preferredProviderId && provider.id === opts.preferredProviderId) {
      // The pinned provider is the one the request was resolved against —
      // honour the override/requested model there.
      return requested;
    }
    if (!opts.preferredProviderId) {
      // No explicit pin: the chain reflects the user's own fallback config, so
      // the requested model is honoured only when this provider supports it.
      const supported = (provider.enabledModels as string[] | undefined) || [];
      if (requested && supported.length > 0 && !supported.includes(requested)) {
        return undefined; // provider's own default model instead
      }
      return requested;
    }
    // A different, non-pinned provider downstream of a pinned request: always
    // use that provider's own configured model.
    return undefined;
  }

  /**
   * Classify whether an error is worth rotating credentials/models for.
   *
   * Deliberately NARROW. The previous matcher treated ANY error message
   * containing "limit" or "key" as rotatable — so "context length limit
   * exceeded" or an unrelated 400 with "key" in the prose triggered key
   * swaps AND permanently rewrote the provider's default model. Errors that
   * merely mention those words are no longer rotation triggers.
   *
   *   keyRotation   — 401/402/403/429, rate-limit, quota, billing, credits,
   *                   unauthorized, invalid API key: a DIFFERENT KEY may help.
   *   modelRotation — 429 / rate-limit / quota: a DIFFERENT MODEL may have a
   *                   separate quota. Auth/credit errors exclude this (another
   *                   model on the same dead credential won't help).
   *                   MODEL ERRORS ("model X not found / not supported /
   *                   invalid model") now ALSO trigger model rotation: trying
   *                   the provider's other enabledModels is exactly the safe
   *                   first-line repair for a stale model id (directive #3/#11).
   */
  private static classifyRotationError(e: any): { keyRotation: boolean; modelRotation: boolean } {
    const statusCode = e?.statusCode || e?.status || 0;
    const eMsg = e?.message || String(e ?? "");
    const keyRotation =
      statusCode === 401 || statusCode === 402 || statusCode === 403 || statusCode === 429 ||
      /429/.test(eMsg) ||
      /rate.?limit/i.test(eMsg) ||
      /quota/i.test(eMsg) ||
      /billing/i.test(eMsg) ||
      /credits?/i.test(eMsg) ||
      /unauthorized/i.test(eMsg) ||
      /invalid.?(api.?)?key/i.test(eMsg) ||
      /FreeUsageLimitError/i.test(eMsg);
    const modelRotation =
      statusCode === 429 ||
      /429/.test(eMsg) ||
      /rate.?limit/i.test(eMsg) ||
      /quota/i.test(eMsg) ||
      /FreeUsageLimitError/i.test(eMsg) ||
      /model[s]?[\s`"'/.\w-]{0,60}?(?:not.?found|does.?not.?exist|is.?not.?supported|unsupported|error\b)|not.?found.?for.?api.?version|invalid.?model|decommissioned/i.test(eMsg);
    return { keyRotation, modelRotation };
  }

  /**
   * Try the three rotation fallbacks for a failed provider attempt:
   *   A. Alternate API keys (skip keys already tried — dedup across retries)
   *   B. Silent session-token rotation (Puter / ZenCode guest / refreshUrl)
   *   C. Model rotation within enabledModels (skip models already tried)
   *
   * Returns the successful response, or null when every rotation failed.
   * Shared by chat() (via tryProviderWithRotations) and stream() so BOTH
   * paths rotate identically — previously streaming had NO rotations at all.
   */
  private static async tryRotationFallbacks(
    provider: AIProvider,
    req: ChatRequest,
    config: ProviderConfig,
    primaryError: any,
    timeoutMs: number,
    opts: RouterOptions,
    requestType: AIProviderLog["requestType"],
    rotationState: { triedKeys: Set<string>; triedModels: Set<string>; tokenRotationTried: boolean },
    modelForAttempt?: string
  ): Promise<ChatResponse | null> {
    const adapter = ProviderFactory.get(provider.type);

    // === A. Alternate API keys rotation ===
    const alternateKeys = (provider.alternateApiKeys as string[] | undefined) || [];
    if (alternateKeys.length > 0) {
      console.log(`[PROVIDER] Rotating API keys for ${provider.name} due to rate-limit/auth error...`);
      for (let ki = 0; ki < alternateKeys.length; ki++) {
        const altKey = alternateKeys[ki];
        if (!altKey || altKey.trim() === "" || rotationState.triedKeys.has(altKey)) continue;
        rotationState.triedKeys.add(altKey);
        console.log(`[PROVIDER] Trying alternate API key #${ki + 1} for ${provider.name}...`);
        try {
          const altConfig = { ...config, apiKey: altKey };
          const res = await withTimeout(
            adapter.chat({ ...req, model: modelForAttempt }, altConfig),
            timeoutMs,
            `${provider.name}.generate`
          );

          // Swap alternate key with current primary key in store so future
          // requests start with the key that actually works.
          const currentPrimaryKey = provider.apiKey || "";
          const newAlternateKeys = [...alternateKeys];
          newAlternateKeys[ki] = currentPrimaryKey;
          useApp.getState().updateProvider(provider.id, {
            apiKey: altKey,
            alternateApiKeys: newAlternateKeys,
          });
          console.info(`[PROVIDER] Store updated: primary key replaced with alternate key #${ki + 1}`);

          rateLimitTracker.recordSuccess(provider.id, res.model || config.modelName || "default");
          this.log({
            providerId: provider.id,
            providerName: provider.name,
            requestType,
            modelName: res.model,
            status: "success",
            latencyMs: res.latencyMs,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            requestPreview: req.messages[req.messages.length - 1]?.content?.slice(0, 200),
            responsePreview: res.text.slice(0, 200),
          });
          return res;
        } catch (altErr: any) {
          console.warn(`[PROVIDER] Alternate key #${ki + 1} failed for ${provider.name}: ${altErr?.message || altErr}`);
        }
      }
    }

    // === B. Silent session-token rotation ===
    if (isRotatableAuthError(primaryError) && typeof window !== "undefined" && !rotationState.tokenRotationTried) {
      rotationState.tokenRotationTried = true;
      console.info(`[TokenRotation] Detected auth error for ${provider.name} — attempting silent token rotation...`);
      try {
        const rotationResult = await tryRotateProviderToken(provider);
        if (rotationResult.success) {
          console.info(`[TokenRotation] ${provider.name}: rotation succeeded — retrying...`);
          const rotatedConfig = rotationResult.newToken
            ? { ...config, apiKey: rotationResult.newToken }
            : config;
          try {
            const res = await withTimeout(
              adapter.chat({ ...req, model: modelForAttempt }, rotatedConfig),
              timeoutMs,
              `${provider.name}.generate`
            );
            rateLimitTracker.recordSuccess(provider.id, res.model || config.modelName || "default");
            this.log({
              providerId: provider.id,
              providerName: provider.name,
              requestType,
              modelName: res.model,
              status: "success",
              latencyMs: res.latencyMs,
              inputTokens: res.inputTokens,
              outputTokens: res.outputTokens,
              requestPreview: req.messages[req.messages.length - 1]?.content?.slice(0, 200),
              responsePreview: res.text.slice(0, 200),
            });
            return res;
          } catch (retryErr: any) {
            console.warn(`[TokenRotation] ${provider.name}: post-rotation retry failed: ${retryErr?.message || retryErr}`);
          }
        }
      } catch (rotErr: any) {
        console.warn(`[TokenRotation] ${provider.name}: rotation error (non-fatal): ${rotErr?.message || rotErr}`);
      }
    }

    // === C. Model rotation ===
    const enabledModels = (provider.enabledModels as string[] | undefined) || [];
    const currentModel = modelForAttempt || req.model || config.modelName || "";
    if (enabledModels.length > 1) {
      const otherModels = enabledModels.filter((m: string) => m !== currentModel && !rotationState.triedModels.has(m));
      const maxAltModels = otherModels.slice(0, 3);
      for (const altModel of maxAltModels) {
        rotationState.triedModels.add(altModel);
        console.log(`[PROVIDER] Rotating model to "${altModel}" for ${provider.name}...`);
        try {
          const altConfig = { ...config, modelName: altModel };
          const res = await withTimeout(
            adapter.chat({ ...req, model: altModel }, altConfig),
            timeoutMs,
            `${provider.name}.generate`
          );

          // Update store default model — the rotated model works.
          useApp.getState().updateProvider(provider.id, { modelName: altModel });

          rateLimitTracker.recordSuccess(provider.id, res.model || altModel);
          this.log({
            providerId: provider.id,
            providerName: provider.name,
            requestType,
            modelName: res.model,
            status: "success",
            latencyMs: res.latencyMs,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            requestPreview: req.messages[req.messages.length - 1]?.content?.slice(0, 200),
            responsePreview: res.text.slice(0, 200),
          });
          return res;
        } catch (modelErr: any) {
          console.warn(`[PROVIDER] Model "${altModel}" failed for ${provider.name}: ${modelErr?.message || modelErr}`);
        }
      }
    }

    return null;
  }

  /**
   * Try a single provider with retries and alternate key/model/token rotations.
   */
  private static async tryProviderWithRotations(
    provider: AIProvider,
    req: ChatRequest,
    settings: AIProviderSettings,
    requestType: AIProviderLog["requestType"],
    timeoutMs: number,
    opts: RouterOptions,
    modelForAttempt?: string
  ): Promise<ChatResponse> {
    const adapter = ProviderFactory.get(provider.type);
    const config = toProviderConfig(provider);
    const maxAttempts = (provider.retryAttempts ?? settings.retryAttempts ?? 2) + 1;

    // Rotation dedup state — shared across retry attempts so an alternate key
    // or model that already failed is NOT retried on the next attempt
    // (previously: up to 3 attempts × (1 + N keys + 1 + 3 models) calls).
    const rotationState = {
      triedKeys: new Set<string>([config.apiKey || ""]),
      triedModels: new Set<string>([modelForAttempt || req.model || config.modelName || ""]),
      tokenRotationTried: false,
    };

    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Run with timeout watchdog
        const res = await withTimeout(
          adapter.chat({ ...req, model: modelForAttempt }, config),
          timeoutMs,
          `${provider.name}.generate`
        );

        // Record success in rate-limit tracker
        rateLimitTracker.recordSuccess(provider.id, res.model || config.modelName || "default");
        // Evidence of recovery clears any stale cooldown (P1 early-clear).
        clearProviderCooldownOnSuccess(provider.id || provider.name || provider.type);

        // Log success
        this.log({
          providerId: provider.id,
          providerName: provider.name,
          requestType,
          modelName: res.model,
          status: "success",
          latencyMs: res.latencyMs,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          requestPreview: req.messages[req.messages.length - 1]?.content?.slice(0, 200),
          responsePreview: res.text.slice(0, 200),
        });

        return res;
      } catch (e: any) {
        lastError = e;

        const { keyRotation, modelRotation } = this.classifyRotationError(e);
        if (keyRotation || modelRotation) {
          const rotated = await this.tryRotationFallbacks(
            provider, req, config, e, timeoutMs, opts, requestType, rotationState, modelForAttempt
          );
          if (rotated) {
            // Rotation success is still success — clear stale cooldowns.
            clearProviderCooldownOnSuccess(provider.id || provider.name || provider.type);
            return rotated;
          }
        }

        // Log the failure
        this.log({
          providerId: provider.id,
          providerName: provider.name,
          requestType,
          modelName: config.modelName,
          status: e?.statusCode === 429 ? "rate_limited" : (e?.name === "AbortError" || /timeout/i.test(e?.message ?? "")) ? "timeout" : "error",
          latencyMs: e?.latencyMs ?? 0,
          errorMessage: e?.message?.slice(0, 500),
          requestPreview: req.messages[req.messages.length - 1]?.content?.slice(0, 200),
        });

        // FailoverManager decision
        const decision = FallbackManager.shouldRetry(e, attempt, settings);
        if (!decision.retry) break;
        await new Promise((r) => setTimeout(r, FallbackManager.backoffDelay(attempt)));
      }
    }
    throw lastError ?? new Error(`Provider ${provider.name} failed`);
  }

  /**
   * Run a parallel speculative race across the top free providers.
   */
  private static async runSpeculativeRace(
    req: ChatRequest,
    opts: RouterOptions,
    callTimeoutMs: number,
    t0: number
  ): Promise<ChatResponse | null> {
    const state = useApp.getState();
    const providers: any[] = state?.providers || [];

    // Filter available free/non-local providers
    const available = providers.filter((p: any) => {
      const cooldownId = p.id || p.name || p.type;
      return (
        isAvailableForSelection(p, opts.excludeProviderIds) &&
        p.type !== "puter" &&
        !isProviderInCooldown(cooldownId)
      );
    });

    if (available.length < 2) {
      return null;
    }

    // Sort by priority and take the top 3
    const candidates = available
      .sort((a: any, b: any) => (a.priority ?? 50) - (b.priority ?? 50))
      .slice(0, 3);

    console.log(`[ROUTER] Speculative parallel race starting with: ${candidates.map((c) => c.name).join(", ")}`);

    const globalAc = new AbortController();
    const raceTimer = setTimeout(() => globalAc.abort(), Math.min(30000, callTimeoutMs));

    const promises = candidates.map(async (prov) => {
      const provId = prov.id || prov.name || prov.type;
      try {
        const adapter = ProviderFactory.get(prov.type);
        const config = toProviderConfig(prov);
        
        const candidateReq: ChatRequest = {
          ...req,
          signal: globalAc.signal
        };

        const res = await withTimeout(
          adapter.chat(candidateReq, config),
          20000,
          `${prov.name}.generate`
        );

        if (!res.text || res.text.trim().length === 0) throw new Error("Empty response");

        // Winner! Cancel others
        globalAc.abort();
        clearTimeout(raceTimer);

        // Evidence of recovery clears any stale cooldown (race winner).
        clearProviderCooldownOnSuccess(provId);
        // Task 20 — adaptive cap recovery (race winner is real traffic success).
        try { recordProviderTrafficSuccess(provId, getConfiguredProviderCap(provId, prov.concurrencyCap)); } catch { /* never break the race */ }

        console.log(`[ROUTER] Speculative race won by: ${prov.name} in ${Math.round(performance.now() - t0)}ms`);
        return {
          text: res.text,
          provider: `${prov.name} (Speculative Race)`,
          model: res.model,
          latencyMs: Math.round(performance.now() - t0),
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
        };
      } catch (err: any) {
        if (globalAc.signal.aborted && !isTimeoutError(err)) {
          throw new Error("Aborted by race winner");
        }
        const errMsg = err?.message || String(err);
        // Task 20 — adaptive cap tighten on 429-family evidence (race path,
        // silent — aborted losers throw before reaching this point).
        const armedClass = recordTrafficCooldownFromError({
          cooldownId: provId,
          providerId: provId,
          error: err,
          statusCode: err?.statusCode,
          isTimeout: isTimeoutError(err),
          requestType: opts.requestType,
          // The race historically also matched billing/payment wording.
          authExtra: /billing|payment/i,
        });
        if (armedClass === "429") {
          try { recordProviderRateLimitHit(provId, getConfiguredProviderCap(provId, prov.concurrencyCap)); } catch { /* never break the race */ }
        }
        throw err;
      }
    });

    try {
      const result = await Promise.any(promises);
      return result;
    } catch (err) {
      console.warn("[ROUTER] All speculative race candidates failed. Falling back to sequential execution.");
      clearTimeout(raceTimer);
      return null;
    }
  }

  /**
   * Test a single provider's connection — used by the "Test Connection" button.
   */
  static async testConnection(provider: AIProvider): Promise<{ ok: boolean; latencyMs: number; message: string; response?: string }> {
    const adapter = ProviderFactory.get(provider.type);
    const config = toProviderConfig(provider);
    const result = await adapter.testConnection(config);
    // Log the test
    this.log({
      providerId: provider.id,
      providerName: provider.name,
      requestType: "test",
      modelName: provider.modelName,
      status: result.ok ? "success" : "error",
      latencyMs: result.latencyMs,
      errorMessage: result.ok ? undefined : result.message,
      responsePreview: result.response?.slice(0, 200),
      requestPreview: "Test prompt: 'Reply with: OK'",
    });
    return result;
  }

  /**
   * Write a log entry to the store.
   */
  private static log(entry: Omit<AIProviderLog, "id" | "createdAt">) {
    useApp.getState().addProviderLog({
      id: uid("pl"),
      createdAt: new Date().toISOString(),
      ...entry,
    });
  }
}

// ============================================================================
// Core provider-selection static helpers (exported for backwards compatibility)
// ============================================================================

export function hasValidApiKey(p: any): boolean {
  if (!p) return false;
  if (p.type === "puter" || p.type === "local") return true;
  if (p.type === "opencode") return true;
  if (p.type === "custom" && p.authType === "none") return true;
  if (p.requiresApiKey === false) return true;
  const key = p.apiKey;
  if (key === undefined || key === null) return false;
  if (typeof key !== "string") return false;
  const trimmed = key.trim();
  if (trimmed === "" || trimmed === "undefined" || trimmed === "null") return false;
  return true;
}

export function getFallbackChain(): any | null {
  try {
    const state: any = useApp.getState();
    const chain = state?.fallbackChain;
    if (!chain || !chain.enabled) return null;
    return chain;
  } catch {
    return null;
  }
}

export const PROVIDER_ALIASES: Record<string, string[]> = {
  p_google: ["p_google_gemini"],
  p_google_gemini: ["p_google"],
  p_zencode: ["p_opencode", "zencode"],
  p_opencode: ["p_zencode"],
};

export function getOrderedFallbackProviders(excludeProviderIdOrIds?: string | string[]): Array<{
  provider: any;
  model: string;
  overrides: { temperature?: number; maxTokens?: number; timeoutMs?: number; topP?: number };
}> {
  const state: any = useApp.getState();
  const allProviders: any[] = state?.providers || [];
  const chain = getFallbackChain();

  const excludeIds = typeof excludeProviderIdOrIds === "string"
    ? [excludeProviderIdOrIds]
    : (excludeProviderIdOrIds || []);

  const isProviderExcluded = (p: any) => {
    if (excludeIds.length === 0) return false;
    const pid = p.id || p.name || p.type;
    return (p.id && excludeIds.includes(p.id)) ||
           (p.name && excludeIds.includes(p.name)) ||
           (p.type && excludeIds.includes(p.type)) ||
           (pid && excludeIds.includes(pid));
  };

  if (!chain || !chain.entries || chain.entries.length === 0) {
    const active = allProviders
      .filter((p) => p.isActive && p.type !== "puter" && p.type !== "local" && hasValidApiKey(p) && !isProviderExcluded(p));

    const reliabilityRank: Record<string, number> = {
      gemini: 1,
      mistral: 2,
      nvidia: 3,
      openrouter: 4,
      zencode: 5,
      opencode: 6,
    };
    active.sort((a, b) => {
      const isFreeA = isOpenCodeZenFree(a);
      const isFreeB = isOpenCodeZenFree(b);
      if (isFreeA !== isFreeB) return isFreeA ? -1 : 1;
      const rankA = reliabilityRank[a.type] ?? 100;
      const rankB = reliabilityRank[b.type] ?? 100;
      return rankA - rankB;
    });

    return active.map((p) => ({ provider: p, model: p.modelName || "", overrides: {} }));
  }

  const result: Array<{ provider: any; model: string; overrides: any }> = [];
  for (const entry of chain.entries) {
    if (!entry.enabled) continue;
    if (isProviderExcluded({ id: entry.providerId })) continue;

    let provider = allProviders.find((p) => p.id === entry.providerId);

    if (!provider) {
      const entryType = entry.providerId.replace(/^p_/, "").replace(/_/g, "-");
      provider = allProviders.find((p) =>
        p.type === entryType ||
        p.type === entry.providerId.replace(/^p_/, "")
      );
    }

    if (!provider) {
      const cleanEntryId = entry.providerId.toLowerCase().replace(/^p_/, "").replace(/_/g, " ").replace(/-/g, " ");
      provider = allProviders.find((p) => {
        const pName = (p.name || "").toLowerCase();
        return pName.includes(cleanEntryId) || cleanEntryId.includes(pName);
      });
    }

    if (!provider) {
      provider = allProviders.find((p) =>
        p.enabledModels?.includes(entry.model) || p.modelName === entry.model
      );
    }

    if (!provider) {
      const aliases = PROVIDER_ALIASES[entry.providerId] || [];
      for (const alias of aliases) {
        provider = allProviders.find((p) => p.id === alias);
        if (provider) break;

        const aliasType = alias.replace(/^p_/, "").replace(/_/g, "-");
        provider = allProviders.find((p) =>
          p.type === aliasType ||
          p.type === alias.replace(/^p_/, "") ||
          p.id?.includes(aliasType) ||
          (p.name && p.name.toLowerCase().includes(aliasType))
        );
        if (provider) break;
      }
    }

    if (!provider) continue;
    if (!provider.isActive) continue;
    if (!hasValidApiKey(provider)) continue;

    result.push({
      provider,
      model: entry.model || provider.modelName || "",
      overrides: {
        temperature: entry.temperature,
        maxTokens: entry.maxTokens,
        timeoutMs: entry.timeoutMs,
        topP: entry.topP,
      },
    });
  }

  if (result.length === 0) {
    const active = allProviders
      .filter((p) => p.isActive && p.type !== "puter" && p.type !== "local" && hasValidApiKey(p) && !isProviderExcluded(p));

    const reliabilityRank: Record<string, number> = {
      gemini: 1,
      mistral: 2,
      nvidia: 3,
      "opencode-zen": 4,
      openrouter: 5,
      zencode: 6,
      opencode: 7,
    };
    active.sort((a, b) => {
      const isFreeA = isOpenCodeZenFree(a);
      const isFreeB = isOpenCodeZenFree(b);
      if (isFreeA !== isFreeB) return isFreeA ? -1 : 1;
      const rankA = reliabilityRank[a.type] ?? 100;
      const rankB = reliabilityRank[b.type] ?? 100;
      return rankA - rankB;
    });

    return active.map((p) => ({ provider: p, model: p.modelName || "", overrides: {} }));
  }

  return result;
}

const TIER_PRIORITY_MAX = [35, 65, 200, Infinity];

export function getProviderTier(p: any): number {
  const pri = p.priority ?? 50;
  if (pri <= TIER_PRIORITY_MAX[0]) return 1;
  if (pri <= TIER_PRIORITY_MAX[1]) return 2;
  if (pri <= TIER_PRIORITY_MAX[2]) return 3;
  return 4;
}

export function isAvailableForSelection(p: any, excludeIds?: string[]): boolean {
  const pid = p.id || p.name || p.type;
  const excluded = excludeIds?.some((eid) =>
    pid === eid || p.id === eid || p.name === eid || p.type === eid
  );
  return (
    p.isActive &&
    p.type !== "local" &&
    !EMERGENCY_ONLY_PROVIDERS.has(p.id) &&
    !EMERGENCY_ONLY_PROVIDERS.has(p.type) &&
    !shouldSkipForOptimization(p.id) &&
    !shouldSkipForOptimization(p.type) &&
    hasValidApiKey(p) &&
    !excluded
  );
}

export async function selectProvider(excludeIds?: string[]): Promise<any> {
  const state: any = useApp.getState();
  const providers: any[] = state?.providers || [];
  const settings = state?.providerSettings || {};

  const available = providers
    .filter((p: any) => isAvailableForSelection(p, excludeIds))
    .sort((a: any, b: any) => (a.priority ?? 50) - (b.priority ?? 50));

  if (available.length > 0) {
    const defaultId = settings.defaultProviderId;
    const defaultProv = defaultId ? available.find((p) => p.id === defaultId) : null;
    if (defaultProv) return defaultProv;
    return available[0];
  }

  return { id: "local-engine", name: "Local Engine (offline mode)", type: "local" };
}

export async function selectProviderForAgent(
  agentType: "optimizer" | "supervisor" | "guardian" | "assembler" | "emergency" | "simple" | "reasoning",
  excludeIds?: string[],
  opts?: { tierMax?: number }
): Promise<any> {
  const state: any = useApp.getState();
  const settings = state?.providerSettings;
  const providers: any[] = state?.providers || [];

  if (agentType !== "emergency" && settings?.agentRoutes?.[agentType] && settings.agentRoutes[agentType] !== "default") {
    const routeId = settings.agentRoutes[agentType];
    const routedProvider = providers.find((p: any) => p.id === routeId);
    if (routedProvider && isAvailableForSelection(routedProvider, excludeIds)) {
      return routedProvider;
    }
  }

  if (agentType === "emergency") {
    const emergency = providers.find(
      (p: any) => EMERGENCY_ONLY_PROVIDERS.has(p.id) || EMERGENCY_ONLY_PROVIDERS.has(p.type)
    );
    if (emergency && isAvailableForSelection(emergency, excludeIds)) return emergency;
  }

  const tierMax: Record<string, number> = {
    optimizer: 2,
    supervisor: 3,
    guardian: 3,
    assembler: 3,
    reasoning: 2,
    simple: 4,
  };

  let eligible = providers.filter((p: any) => isAvailableForSelection(p, excludeIds));

  if (agentType === "simple") {
    const cheapEligible = eligible.filter((p: any) => getProviderTier(p) <= 2);
    if (cheapEligible.length > 0) {
      eligible = cheapEligible;
    }
  } else {
    // TWO-TIER ROUTING: the caller may tighten or relax the tier ceiling for
    // its role (e.g. "fast" draft mode caps the optimizer at tier 1-2 cheap
    // providers; "high-quality" mode allows the strongest tier for drafts).
    // Verification agents (supervisor/guardian) keep their stricter defaults.
    const maxTier = Math.max(1, Math.min(4, opts?.tierMax ?? tierMax[agentType] ?? 3));
    const tierFiltered = eligible.filter((p: any) => getProviderTier(p) <= maxTier);
    if (tierFiltered.length > 0) {
      eligible = tierFiltered;
    }
    // Empty after tier filter → fall through with the unfiltered list (better
    // any provider than none — the caller's budget/healing still protects).
  }

  eligible = eligible.sort((a: any, b: any) => (a.priority ?? 50) - (b.priority ?? 50));

  if (eligible.length > 0) return eligible[0];

  return selectProvider(excludeIds);
}

export { ProviderError };
