/**
 * antigravity-provider.ts — Antigravity CLI OAuthAIProvider implementation
 *
 * Uses Google OAuth 2.0 + PKCE via Cloudflare Worker callback.
 * Integrates with SessionManager, FallbackEngine, and ProviderRouter.
 */

import type { OAuthAIProvider, ProviderSession, ProviderAuthStatus } from "./interface";
import { ProviderAuthenticationError, createEmptySession } from "./interface";
import { saveSession, loadSession, clearSession } from "./session-manager";
import {
  refreshAntigravityToken,
  discoverAntigravityModels,
  generateAntigravity,
  AntigravityRateLimitError,
  buildAuthorizationURL,
  exchangeAuthorizationCode,
} from "./antigravity-auth";
import { recordSuccess, recordFailure, recordRateLimit, resetHealth } from "./antigravity-health";

const PROVIDER_ID = "antigravity" as const;

export { AntigravityRateLimitError };

export class AntigravityProvider implements OAuthAIProvider {
  readonly id = PROVIDER_ID;
  readonly name = "Antigravity CLI";

  private session: ProviderSession = createEmptySession("antigravity");

  /**
   * Build the Google OAuth authorization URL.
   * User will be redirected to Google login, then to the worker callback.
   */
  async buildAuthUrl(redirectUri: string): Promise<{ url: string; verifier: string; state: string }> {
    return buildAuthorizationURL(redirectUri);
  }

  /**
   * Exchange an authorization code for tokens (called by the Worker callback).
   */
  async exchangeCode(
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<{ type: "success" | "failed"; error?: string; session?: ProviderSession }> {
    const result = await exchangeAuthorizationCode(code, state, redirectUri);
    if (result.type === "failed") {
      return { type: "failed", error: result.error };
    }

    this.session = {
      provider: "antigravity",
      authenticated: true,
      email: result.email || null,
      userId: null,
      accessToken: result.accessToken || null,
      refreshToken: result.refreshToken || null,
      expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : null,
      connectedAt: Date.now(),
      models: [],
      sharedAdminAccount: false,
      authMethod: "api_key",
      googleUserId: null,
      googlePicture: null,
    };

    await saveSession(this.session);

    // Auto-discover models
    try {
      if (result.accessToken) {
        this.session.models = await discoverAntigravityModels(result.accessToken);
      }
    } catch { /* non-fatal */ }

    return { type: "success", session: this.session };
  }

  // === OAuthAIProvider Interface ===

  async login(providedKey?: string): Promise<ProviderSession> {
    if (providedKey) {
      this.session = {
        provider: "antigravity",
        authenticated: true,
        email: null,
        userId: null,
        accessToken: providedKey,
        refreshToken: null,
        expiresAt: null,
        connectedAt: Date.now(),
        models: [],
        sharedAdminAccount: false,
        authMethod: "api_key",
        googleUserId: null,
        googlePicture: null,
      };
      await saveSession(this.session);
      return this.session;
    }
    // OAuth flow: build URL and redirect — handled by worker/UI
    throw new ProviderAuthenticationError("login_failed", "Use the 'Connect Antigravity' button in Settings to authenticate via Google OAuth.", "antigravity");
  }

  async saveRefreshToken(refreshToken: string, expiresInSeconds: number): Promise<void> {
    this.session.refreshToken = refreshToken;
    this.session.expiresAt = Date.now() + expiresInSeconds * 1000;
    await saveSession(this.session);
  }

  async refresh(): Promise<ProviderSession> {
    if (!this.session.refreshToken) {
      this.session.authenticated = false;
      await clearSession("antigravity");
      return this.session;
    }

    try {
      const result = await refreshAntigravityToken(this.session.refreshToken);
      if (result.type === "failed") {
        throw new Error(result.error || "Refresh failed");
      }
      this.session.accessToken = result.accessToken || null;
      this.session.expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : null;
      this.session.authenticated = true;
      await saveSession(this.session);
    } catch (e: any) {
      console.warn("[Antigravity] Token refresh failed:", e?.message);
      this.session.authenticated = false;
      await clearSession("antigravity");
    }
    return this.session;
  }

  async logout(): Promise<void> {
    this.session = createEmptySession("antigravity");
    await clearSession("antigravity");
  }

  async restore(): Promise<ProviderSession | null> {
    try {
      const saved = await loadSession("antigravity");
      if (saved && saved.provider === "antigravity") {
        this.session = saved;
        if (saved.expiresAt && saved.expiresAt < Date.now()) {
          if (saved.refreshToken) {
            return await this.refresh();
          }
          this.session.authenticated = false;
        }
        return this.session;
      }
    } catch (e) {
      console.warn("[Antigravity] Session restore failed:", e);
    }
    return null;
  }

  async listModels(): Promise<string[]> {
    if (!this.session.authenticated || !this.session.accessToken) {
      throw new ProviderAuthenticationError("auth_required", "Antigravity not authenticated", "antigravity");
    }
    try {
      const models = await discoverAntigravityModels(this.session.accessToken);
      this.session.models = models;
      return models;
    } catch (e: any) {
      console.warn("[Antigravity] Model list failed:", e?.message);
      return this.session.models;
    }
  }

  async generate(opts: {
    systemPrompt?: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<{ text: string; provider: string; latencyMs: number }> {
    if (!this.session.authenticated || !this.session.accessToken) {
      throw new ProviderAuthenticationError("auth_required", "Antigravity not authenticated. Please connect Antigravity CLI.", "antigravity");
    }

    const model = opts.model || this.session.models[0] || "gemini-2.5-flash";
    try {
      const result = await generateAntigravity({
        accessToken: this.session.accessToken,
        model,
        systemPrompt: opts.systemPrompt,
        userPrompt: opts.userPrompt,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      });
      recordSuccess(model, result.latencyMs);
      return result;
    } catch (e: any) {
      if (e instanceof AntigravityRateLimitError) {
        recordRateLimit(model);
      } else {
        recordFailure(model);
      }
      throw e;
    }
  }

  getStatus(): ProviderAuthStatus {
    return {
      connected: this.session.authenticated,
      authenticated: this.session.authenticated,
      email: this.session.email,
      expiresAt: this.session.expiresAt,
      models: this.session.models,
      sharedAdminAccount: this.session.sharedAdminAccount,
      authMethod: this.session.authMethod,
      googleUserId: this.session.googleUserId,
      googlePicture: this.session.googlePicture,
      accounts: this.session.accounts,
      autoRotate: this.session.autoRotate,
      useGlobally: this.session.useGlobally,
    };
  }

  isAuthenticated(): boolean {
    if (!this.session.authenticated) return false;
    if (this.session.expiresAt && this.session.expiresAt < Date.now()) return false;
    return true;
  }

  async tryRefresh(): Promise<boolean> {
    if (this.session.authenticated && this.session.expiresAt && this.session.expiresAt > Date.now()) {
      return true;
    }
    if (this.session.refreshToken) {
      await this.refresh();
      return this.session.authenticated;
    }
    return false;
  }
}

let instance: AntigravityProvider | null = null;

export function getAntigravityProvider(): AntigravityProvider {
  if (!instance) instance = new AntigravityProvider();
  return instance;
}
