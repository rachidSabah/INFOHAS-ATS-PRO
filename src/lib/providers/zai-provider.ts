// ResumeAI Pro — Z.ai Direct OAuth Provider
// Implements OAuthAIProvider for Z.ai Direct.
// Z.ai provides a REST API at api.z.ai with API key authentication.
// We also support Google OAuth via Z.ai's web platform.
//
// IMPORTANT: Z.ai's official authentication uses API keys (bearer tokens).
// There is no public OAuth/session API for Z.ai — the authentication
// is via API key, which we encrypt and store securely.

"use client";

import type { OAuthAIProvider, ProviderSession, ProviderAuthStatus } from "./interface";
import { ProviderAuthenticationError, createEmptySession } from "./interface";
import { saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon } from "./session-manager";

// Z.ai available models (per official documentation)
const ZAI_MODELS = [
  "glm-4.6",
  "glm-5",
  "glm-5.1",
  "glm-5.2",
  "glm-5-air",
  "glm-5-flash",
  "glm-5-long",
  "glm-5-thinking",
  "glm-5.1-thinking",
  "codegeex-4",
];

// Session TTL — Z.ai API keys don't expire, but we refresh
// the session periodically to verify the key is still valid
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class ZaiProvider implements OAuthAIProvider {
  readonly id = "zai-direct" as const;
  readonly name = "Z.ai Direct";

  private session: ProviderSession = createEmptySession("zai-direct");

  /**
   * "Sign in" to Z.ai by validating the API key.
   * Z.ai doesn't have OAuth — authentication is via API key.
   * We validate the key by making a test call to the API.
   * @param providedKey Optional API key from user input. If not provided,
   *   falls back to env var or stored session key.
   */
  async login(providedKey?: string): Promise<ProviderSession> {
    // Get the API key from user input, environment, or stored session
    const apiKey = providedKey || this.getZaiApiKey();
    if (!apiKey) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Z.ai API key not found. Set NEXT_PUBLIC_ZAI_API_KEY in environment or enter it in Provider Settings.",
        "zai-direct",
      );
    }

    try {
      // Validate the API key by making a minimal test call.
      // Use the smallest possible request to minimize token consumption.
      // We send a 1-token prompt and request only 1 max_token.
      const testResponse = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "glm-5-flash", // Use the lightest/cheapest model for validation
          messages: [{ role: "user", content: "Hi" }], // Minimal prompt
          max_tokens: 1, // Only request 1 token back
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!testResponse.ok) {
        const errText = await testResponse.text().catch(() => "");
        if (testResponse.status === 401 || testResponse.status === 403) {
          throw new ProviderAuthenticationError(
            "login_failed",
            `Z.ai API key is invalid or unauthorized (${testResponse.status}). Please check your API key.`,
            "zai-direct",
          );
        }
        throw new ProviderAuthenticationError(
          "login_failed",
          `Z.ai API returned status ${testResponse.status}: ${errText.slice(0, 200)}`,
          "zai-direct",
        );
      }

      // Key is valid — create session
      this.session = {
        provider: "zai-direct",
        authenticated: true,
        email: "api-key@z.ai", // API key auth doesn't have email
        userId: "zai-api-key",
        accessToken: apiKey, // Will be encrypted by SessionManager
        refreshToken: null, // Z.ai doesn't use refresh tokens
        expiresAt: Date.now() + SESSION_TTL_MS,
        connectedAt: Date.now(),
        models: ZAI_MODELS,
        sharedAdminAccount: false,
      };

      await saveSession(this.session);

      console.log(
        `[Z.ai] Connected as ${this.session.email}`,
      );
      console.log("[Z.ai] Authenticated provider ready.");

      return this.session;
    } catch (e: any) {
      if (e instanceof ProviderAuthenticationError) throw e;
      throw new ProviderAuthenticationError(
        "login_failed",
        `Z.ai login failed: ${e?.message || "Unknown error"}`,
        "zai-direct",
      );
    }
  }

  /**
   * Refresh the Z.ai session by re-validating the API key.
   */
  async refresh(): Promise<ProviderSession> {
    const apiKey = this.getZaiApiKey();
    if (!apiKey) {
      this.session = createEmptySession("zai-direct");
      await saveSession(this.session);
      throw new ProviderAuthenticationError(
        "refresh_failed",
        "Z.ai API key not found. Cannot refresh session.",
        "zai-direct",
      );
    }

    try {
      // Quick validation call — use the cheapest model and minimal tokens
      const testResponse = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "glm-5-flash", // Lightest model for validation
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!testResponse.ok) {
        this.session.authenticated = false;
        await saveSession(this.session);
        throw new ProviderAuthenticationError(
          "refresh_failed",
          `Z.ai API key validation failed (${testResponse.status}). Session expired.`,
          "zai-direct",
        );
      }

      // Extend session
      this.session.authenticated = true;
      this.session.accessToken = apiKey;
      this.session.expiresAt = Date.now() + SESSION_TTL_MS;
      this.session.models = ZAI_MODELS;

      await saveSession(this.session);

      console.log("[PROVIDER AUTH] session refreshed");
      return this.session;
    } catch (e: any) {
      if (e instanceof ProviderAuthenticationError) throw e;
      throw new ProviderAuthenticationError(
        "refresh_failed",
        `Session refresh failed: ${e?.message || "Unknown error"}`,
        "zai-direct",
      );
    }
  }

  /**
   * Disconnect from Z.ai.
   */
  async logout(): Promise<void> {
    this.session = createEmptySession("zai-direct");
    await clearSession("zai-direct");
    console.log("[PROVIDER AUTH] Z.ai session cleared");
  }

  /**
   * Restore a previously stored session on app startup.
   */
  async restore(): Promise<ProviderSession | null> {
    const stored = await loadSession("zai-direct");
    if (!stored || !stored.authenticated) {
      // Try auto-login with env var API key
      const apiKey = this.getZaiApiKey();
      if (apiKey) {
        try {
          return await this.login();
        } catch {
          // Auto-login failed — user must manually connect
        }
      }
      this.session = createEmptySession("zai-direct");
      return null;
    }

    this.session = stored;

    // Check if session is expired
    if (isSessionExpired(stored)) {
      try {
        const refreshed = await this.refresh();
        console.log("[PROVIDER AUTH] session restored (refreshed)");
        return refreshed;
      } catch {
        this.session.authenticated = false;
        this.session.expiresAt = null;
        await saveSession(this.session);
        console.log("[PROVIDER AUTH] session expired");
        return this.session;
      }
    }

    // Proactively refresh if expiring soon
    if (isSessionExpiringSoon(stored)) {
      this.refresh().catch(() => {});
    }

    console.log("[PROVIDER AUTH] session restored");
    return this.session;
  }

  /**
   * List available Z.ai models.
   */
  async listModels(): Promise<string[]> {
    if (!this.isAuthenticated()) return [];
    return ZAI_MODELS;
  }

  /**
   * Generate a completion using the Z.ai API directly.
   * MUST check authentication before execution.
   */
  async generate(opts: {
    systemPrompt?: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<{ text: string; provider: string; latencyMs: number }> {
    // AUTH CHECK — no silent fallback
    if (!this.isAuthenticated()) {
      throw new ProviderAuthenticationError(
        "auth_required",
        "Z.ai authentication required. Please connect from Provider Settings.",
        "zai-direct",
      );
    }

    const apiKey = this.getZaiApiKey();
    if (!apiKey) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Z.ai API key not found.",
        "zai-direct",
      );
    }

    const t0 = performance.now();

    const messages = [
      { role: "system", content: opts.systemPrompt || "You are ResumeAI Pro, a helpful assistant for resume and career tasks." },
      { role: "user", content: opts.userPrompt },
    ];

    const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model || "glm-4.6",
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        this.session.authenticated = false;
        await saveSession(this.session);
        throw new ProviderAuthenticationError(
          "session_expired",
          "Z.ai session expired. Please reconnect.",
          "zai-direct",
        );
      }
      const errText = await res.text().catch(() => "");
      throw new ProviderAuthenticationError(
        "auth_required",
        `Z.ai API error (${res.status}): ${errText.slice(0, 200)}`,
        "zai-direct",
      );
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";

    if (!text || text.trim().length === 0) {
      // Empty response is NOT necessarily an auth error — it could be
      // a rate limit, content filter, or model error. Use a distinct code.
      throw new ProviderAuthenticationError(
        "session_expired",
        "Z.ai returned an empty response. This may indicate a rate limit, content filter, or model error. Please try again.",
        "zai-direct",
      );
    }

    return {
      text,
      provider: "Z.ai Direct",
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  /**
   * Get the current authentication status.
   */
  getStatus(): ProviderAuthStatus {
    return {
      connected: this.session.authenticated,
      authenticated: this.session.authenticated,
      email: this.session.email,
      expiresAt: this.session.expiresAt,
      models: this.session.models,
      sharedAdminAccount: this.session.sharedAdminAccount,
    };
  }

  /**
   * Check if currently authenticated.
   * Returns false when session is expired — no TOCTOU race.
   * Use tryRefresh() to attempt a refresh before checking.
   */
  isAuthenticated(): boolean {
    if (!this.session.authenticated) return false;
    if (isSessionExpired(this.session)) {
      // Session is expired — do NOT return true while refreshing.
      // That creates a TOCTOU race where callers see "true" but the
      // session is actually invalid. Instead, return false and let
      // the caller decide whether to refresh.
      return false;
    }
    return true;
  }

  /**
   * Attempt to refresh an expired session.
   * Returns true if the session is now valid (either still valid or successfully refreshed).
   * Should be called before isAuthenticated() when the caller wants auto-refresh.
   */
  async tryRefresh(): Promise<boolean> {
    if (!this.session.authenticated) return false;
    if (!isSessionExpired(this.session)) return true;
    try {
      await this.refresh();
      return true;
    } catch {
      this.session.authenticated = false;
      return false;
    }
  }

  /**
   * Set shared admin account mode.
   */
  async setSharedAdminAccount(enabled: boolean): Promise<void> {
    this.session.sharedAdminAccount = enabled;
    await saveSession(this.session);
  }

  /**
   * Get the Z.ai API key from environment or session.
   */
  private getZaiApiKey(): string | null {
    // Try env var first (baked into build via NEXT_PUBLIC_)
    const envKey = process.env.NEXT_PUBLIC_ZAI_API_KEY;
    if (envKey) return envKey;
    // Fall back to stored session
    return this.session.accessToken;
  }
}

// Singleton instance
let instance: ZaiProvider | null = null;

export function getZaiProvider(): ZaiProvider {
  if (!instance) {
    instance = new ZaiProvider();
  }
  return instance;
}
