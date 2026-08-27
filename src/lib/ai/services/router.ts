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
import type { ChatRequest, ChatResponse } from "../providers/interface";
import { ProviderFactory, ProviderError } from "./factory";
import { FallbackManager, toProviderConfig } from "./fallback";
import { useApp, uid } from "../../store";
import { modelRegistry } from "../../model-registry";
import { rateLimitTracker } from "../../rate-limit-tracker";

// Advanced routing & failover imports (ADR-001):
import { localGenerate } from "../../local-engine";
import {
  isProviderInCooldown,
  markProvider429Cooldown,
  markProvider401Cooldown,
  markProviderTimeoutCooldown,
  isTimeoutError,
} from "../../provider-cooldown";
import { getPromptCache, setPromptCache, buildPromptHash } from "../../prompt-cache";
import { tryRotateProviderToken, isRotatableAuthError } from "../../token-rotation";
import { withTimeout, OptimizationProviderExhaustedError, AI_CALL_TIMEOUT_MS } from "../../pipeline-watchdog";
import { truncatePromptToTokenLimit, MAX_INPUT_TOKENS } from "../../ai-diagnostics";
import { isOpenCodeZenFree } from "../../provider-capabilities";
import { shouldSkipForOptimization, EMERGENCY_ONLY_PROVIDERS } from "../../circuit-breaker";

export interface RouterOptions {
  /** Override the default provider for this single call. */
  preferredProviderId?: string;
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
      
      // Skip rate-limited / cooldown providers
      if (rateLimitTracker.isRateLimited(provider.id) || isProviderInCooldown(cooldownId)) {
        const remainingSec = rateLimitTracker.isRateLimited(provider.id)
          ? Math.ceil(rateLimitTracker.getCooldownRemainingMs(provider.id) / 1000)
          : 60; // default to 60s for other cooldowns
        errors.push(`${provider.name}: in cooldown (${remainingSec}s remaining)`);
        continue;
      }

      // Check budget constraint: if total elapsed time exceeds the callTimeout budget,
      // skip this provider and fallback immediately.
      const elapsedMs = Math.round(performance.now() - t0);
      if (elapsedMs >= callTimeoutMs) {
        console.warn(`[AI] Budget exhausted (${elapsedMs}ms ≥ ${callTimeoutMs}ms). Skipping remaining chain.`);
        break;
      }

      try {
        const attemptTimeout = chain.length > 1 ? Math.min(25000, callTimeoutMs - elapsedMs) : callTimeoutMs - elapsedMs;
        const res = await this.tryProviderWithRotations(
          provider,
          req,
          settings,
          opts.requestType || "chat",
          attemptTimeout,
          opts
        );

        // Success path
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

        // Record cooldowns
        if (e?.statusCode === 429 || /429/.test(eMsg) || /rate.?limit/i.test(eMsg) || /FreeUsageLimitError/i.test(eMsg)) {
          rateLimitTracker.record429(provider.id, provider.modelName ?? "default");
          markProvider429Cooldown(cooldownId);
        } else if (e?.statusCode === 401 || /401/.test(eMsg) || /CreditsError/i.test(eMsg)) {
          markProvider401Cooldown(cooldownId);
        } else if (isTimeoutError(e)) {
          markProviderTimeoutCooldown(cooldownId);
        }
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

      if (rateLimitTracker.isRateLimited(provider.id) || isProviderInCooldown(cooldownId)) {
        const remainingSec = rateLimitTracker.isRateLimited(provider.id)
          ? Math.ceil(rateLimitTracker.getCooldownRemainingMs(provider.id) / 1000)
          : 60;
        errors.push(`${provider.name}: in cooldown (${remainingSec}s remaining)`);
        continue;
      }

      const elapsedMs = Math.round(performance.now() - t0);
      if (elapsedMs >= callTimeoutMs) {
        console.warn(`[AI Stream] Budget exhausted (${elapsedMs}ms ≥ ${callTimeoutMs}ms). Skipping remaining chain.`);
        break;
      }

      try {
        const attemptTimeout = chain.length > 1 ? Math.min(25000, callTimeoutMs - elapsedMs) : callTimeoutMs - elapsedMs;
        const adapter = ProviderFactory.get(provider.type);
        const config = toProviderConfig(provider);

        let res: ChatResponse;
        if (typeof (adapter as any).stream === "function" && provider.type !== "local") {
          res = await withTimeout(
            (adapter as any).stream({ ...req, model: opts.modelOverride || req.model }, config, onChunk),
            attemptTimeout,
            `${provider.name}.stream`
          );
        } else {
          res = await withTimeout(
            adapter.chat({ ...req, model: opts.modelOverride || req.model }, config),
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

        return res;
      } catch (e: any) {
        const eMsg = e?.message ?? String(e);
        errors.push(`${provider.name}: ${eMsg}`);
        console.warn(`[AI Stream] Provider ${provider.name} failed: ${eMsg}`);
        if (e?.statusCode === 429 || /429/.test(eMsg) || /rate.?limit/i.test(eMsg) || /FreeUsageLimitError/i.test(eMsg)) {
          rateLimitTracker.record429(provider.id, provider.modelName ?? "default");
          markProvider429Cooldown(cooldownId);
        } else if (e?.statusCode === 401 || /401/.test(eMsg) || /CreditsError/i.test(eMsg)) {
          markProvider401Cooldown(cooldownId);
        } else if (isTimeoutError(e)) {
          markProviderTimeoutCooldown(cooldownId);
        }
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
   * Try a single provider with retries and alternate key/model/token rotations.
   */
  private static async tryProviderWithRotations(
    provider: AIProvider,
    req: ChatRequest,
    settings: AIProviderSettings,
    requestType: AIProviderLog["requestType"],
    timeoutMs: number,
    opts: RouterOptions
  ): Promise<ChatResponse> {
    const adapter = ProviderFactory.get(provider.type);
    const config = toProviderConfig(provider);
    const maxAttempts = (provider.retryAttempts ?? settings.retryAttempts ?? 2) + 1;

    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Run with timeout watchdog
        const res = await withTimeout(
          adapter.chat({ ...req, model: opts.modelOverride || req.model }, config),
          timeoutMs,
          `${provider.name}.generate`
        );

        // Record success in rate-limit tracker
        rateLimitTracker.recordSuccess(provider.id, res.model || config.modelName || "default");
        
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
        const eMsg = e?.message || String(e);

        // Check if rate/quota/auth error
        const isRateOrQuotaOrAuthError =
          e?.statusCode === 429 ||
          e?.statusCode === 401 ||
          e?.statusCode === 403 ||
          /429/.test(eMsg) ||
          /rate.?limit/i.test(eMsg) ||
          /quota/i.test(eMsg) ||
          /billing/i.test(eMsg) ||
          /limit/i.test(eMsg) ||
          /auth/i.test(eMsg) ||
          /key/i.test(eMsg) ||
          /FreeUsageLimitError/i.test(eMsg);

        if (isRateOrQuotaOrAuthError) {
          // A. Try alternate API keys rotation
          const alternateKeys = provider.alternateApiKeys as string[] | undefined;
          if (alternateKeys && alternateKeys.length > 0) {
            console.log(`[PROVIDER] Rotating API keys for ${provider.name} due to rate-limit/auth error...`);
            for (let ki = 0; ki < alternateKeys.length; ki++) {
              const altKey = alternateKeys[ki];
              if (!altKey || altKey.trim() === "") continue;
              console.log(`[PROVIDER] Trying alternate API key #${ki + 1} for ${provider.name}...`);
              try {
                const altConfig = { ...config, apiKey: altKey };
                const res = await withTimeout(
                  adapter.chat({ ...req, model: opts.modelOverride || req.model }, altConfig),
                  timeoutMs,
                  `${provider.name}.generate`
                );
                
                // Swap alternate key with current primary key in store
                const currentPrimaryKey = provider.apiKey || "";
                const newAlternateKeys = [...(provider.alternateApiKeys || [])];
                newAlternateKeys[ki] = currentPrimaryKey;
                useApp.getState().updateProvider(provider.id, {
                  apiKey: altKey,
                  alternateApiKeys: newAlternateKeys,
                });
                console.info(`[PROVIDER] Store updated: primary key replaced with alternate key #${ki + 1}`);

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

          // B. Silent Token Rotation
          if (isRotatableAuthError(e) && typeof window !== "undefined") {
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
                    adapter.chat({ ...req, model: opts.modelOverride || req.model }, rotatedConfig),
                    timeoutMs,
                    `${provider.name}.generate`
                  );
                  return res;
                } catch (retryErr: any) {
                  console.warn(`[TokenRotation] ${provider.name}: post-rotation retry failed: ${retryErr?.message || retryErr}`);
                }
              }
            } catch (rotErr: any) {
              console.warn(`[TokenRotation] ${provider.name}: rotation error (non-fatal): ${rotErr?.message || rotErr}`);
            }
          }

          // C. Try Model Rotation
          const enabledModels = provider.enabledModels as string[] | undefined;
          const currentModel = opts.modelOverride || req.model || config.modelName || "";
          if (enabledModels && enabledModels.length > 1) {
            const otherModels = enabledModels.filter((m: string) => m !== currentModel);
            const maxAltModels = otherModels.slice(0, 3);
            for (const altModel of maxAltModels) {
              console.log(`[PROVIDER] Rotating model to "${altModel}" for ${provider.name}...`);
              try {
                const altConfig = { ...config, modelName: altModel };
                const res = await withTimeout(
                  adapter.chat({ ...req, model: altModel }, altConfig),
                  timeoutMs,
                  `${provider.name}.generate`
                );
                
                // Update store default model
                useApp.getState().updateProvider(provider.id, { modelName: altModel });
                return res;
              } catch (modelErr: any) {
                console.warn(`[PROVIDER] Model "${altModel}" failed for ${provider.name}: ${modelErr?.message || modelErr}`);
              }
            }
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
        if (err?.statusCode === 429 || /429/.test(errMsg) || /rate.?limit/i.test(errMsg) || /FreeUsageLimitError/i.test(errMsg)) {
          markProvider429Cooldown(provId);
        } else if (err?.statusCode === 401 || /401/.test(errMsg) || /billing/i.test(errMsg) || /payment/i.test(errMsg) || /CreditsError/i.test(errMsg)) {
          markProvider401Cooldown(provId);
        } else if (isTimeoutError(err)) {
          markProviderTimeoutCooldown(provId);
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
  excludeIds?: string[]
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
    const maxTier = tierMax[agentType] ?? 3;
    eligible = eligible.filter((p: any) => getProviderTier(p) <= maxTier);
  }

  eligible = eligible.sort((a: any, b: any) => (a.priority ?? 50) - (b.priority ?? 50));

  if (eligible.length > 0) return eligible[0];

  return selectProvider(excludeIds);
}

export { ProviderError };
