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

export interface RouterOptions {
  /** Override the default provider for this single call. */
  preferredProviderId?: string;
  /** Skip the failover chain — only try this one provider. */
  singleProvider?: boolean;
  /** Mark this request as a "test" rather than "chat" in logs. */
  requestType?: AIProviderLog["requestType"];
  /** Agent task for capability-weighted model selection (summary, skills, etc.) */
  agentTask?: string;
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
    const state = useApp.getState();
    const allProviders = state.providers;
    const settings = state.providerSettings;
    const user = state.user;

    // Filter providers by user role
    const isSuperAdmin = user?.role === "super_admin";
    const providers = isSuperAdmin
      ? allProviders // super admin sees everything
      : allProviders.filter((p) => p.allowedForRegularUsers === true); // regular users only see allowed providers

    if (!settings.enableFailover || opts.singleProvider) {
      const target = opts.preferredProviderId
        ? providers.find((p) => p.id === opts.preferredProviderId)!
        : providers.find((p) => p.id === settings.defaultProviderId)!;
      if (!target) throw new Error("No provider available. Sign in with Puter.js (free) to enable AI features.");
      return this.tryProvider(target, req, settings, opts.requestType);
    }

    const chain = FallbackManager.buildChain(providers, settings);
    if (opts.preferredProviderId) {
      const pref = providers.find((p) => p.id === opts.preferredProviderId);
      if (pref) chain.unshift(pref);
    }

    if (chain.length === 0) {
      throw new Error(
        isSuperAdmin
          ? "No active AI providers. Configure one in Super Admin → AI Providers."
          : "No AI providers available for your account. Use Puter.js (free) by signing in with Google via the Puter button."
      );
    }

    const errors: string[] = [];
    for (const provider of chain) {
      // Skip rate-limited providers
      if (rateLimitTracker.isRateLimited(provider.id)) {
        const cooldownMs = rateLimitTracker.getCooldownRemainingMs(provider.id);
        errors.push(`${provider.name}: rate-limited (${Math.ceil(cooldownMs / 1000)}s remaining)`);
        continue;
      }
      try {
        return await this.tryProvider(provider, req, settings, opts.requestType);
      } catch (e: any) {
        errors.push(`${provider.name}: ${e?.message ?? e}`);
        // Mark 429 in rate-limit tracker for future calls
        if (e?.statusCode === 429 || /429/.test(e?.message ?? "") || /rate.?limit/i.test(e?.message ?? "")) {
          rateLimitTracker.record429(provider.id, provider.modelName ?? "default");
        }
        // Continue to next provider in chain
      }
    }
    throw new Error(`All providers failed:\n${errors.join("\n")}`);
  }

  /**
   * Try a single provider with retries.
   */
  private static async tryProvider(
    provider: AIProvider,
    req: ChatRequest,
    settings: AIProviderSettings,
    requestType: AIProviderLog["requestType"] = "chat"
  ): Promise<ChatResponse> {
    const adapter = ProviderFactory.get(provider.type);
    const config = toProviderConfig(provider);
    const maxAttempts = (provider.retryAttempts ?? settings.retryAttempts ?? 2) + 1;

    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await adapter.chat(req, config);
        // Record success in rate-limit tracker (resets consecutive 429 count)
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
        const decision = FallbackManager.shouldRetry(e, attempt, settings);
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
        if (!decision.retry) break;
        await new Promise((r) => setTimeout(r, FallbackManager.backoffDelay(attempt)));
      }
    }
    throw lastError ?? new Error(`Provider ${provider.name} failed`);
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

export { ProviderError };
