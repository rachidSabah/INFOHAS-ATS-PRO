/**
 * antigravity-provider.ts — Antigravity CLI OAuthAIProvider implementation
 *
 * Implements the OAuthAIProvider interface for Antigravity CLI.
 * Uses Device Authorization Flow for authentication.
 * Integrates with the existing SessionManager, FallbackEngine, and ProviderRouter.
 */

import type { OAuthAIProvider, ProviderSession, ProviderAuthStatus } from "./interface";
import { ProviderAuthenticationError, createEmptySession } from "./interface";
import { saveSession, loadSession, clearSession } from "./session-manager";
import {
  initiateDeviceFlow,
  pollForToken,
  refreshAccessToken,
  fetchAntigravityModels,
  generateAntigravity,
  AntigravityRateLimitError,
  type DeviceCodeResponse,
} from "./antigravity-auth";

const PROVIDER_ID = "antigravity" as const;

export type { DeviceCodeResponse };
export { AntigravityRateLimitError };

export class AntigravityProvider implements OAuthAIProvider {
  readonly id = PROVIDER_ID;
  readonly name = "Antigravity CLI";

  private session: ProviderSession = createEmptySession("antigravity");

  constructor() {
    // Session restored on app startup via restore()
  }

  /**
   * Initiate the Device Authorization Flow.
   * Returns the device code data — caller must display user_code to user.
   */
  async initiateDeviceFlow(clientId?: string): Promise<DeviceCodeResponse> {
    return initiateDeviceFlow(clientId);
  }

  /**
   * Poll for token after the user authorizes via the device flow.
   * On success, stores the encrypted session.
   */
  async pollForToken(
    deviceCode: string,
    interval?: number,
    clientId?: string,
  ): Promise<{ status: string; session?: ProviderSession; error?: string }> {
    const result = await pollForToken(deviceCode, interval, clientId);

    if (result.status === "authorized" && result.token) {
      this.session = {
        provider: "antigravity",
        authenticated: true,
        email: null,
        userId: null,
        accessToken: result.token.accessToken,
        refreshToken: result.token.refreshToken || null,
        expiresAt: result.token.expiresIn ? Date.now() + result.token.expiresIn * 1000 : null,
        connectedAt: Date.now(),
        models: [],
        sharedAdminAccount: false,
        authMethod: "api_key",
        googleUserId: null,
        googlePicture: null,
      };

      await saveSession(this.session);
      try {
        this.session.models = await fetchAntigravityModels(result.token.accessToken);
      } catch (e) {
        console.warn("[Antigravity] Model discovery failed after auth:", e);
      }

      return { status: "authorized", session: this.session };
    }

    return { status: result.status, error: result.error };
  }

  // ===== OAuthAIProvider Interface =====

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

    const flowData = await this.initiateDeviceFlow();
    const result = await this.pollForToken(flowData.deviceCode, flowData.interval);
    if (result.status !== "authorized" || !result.session) {
      throw new ProviderAuthenticationError("login_failed", result.error || "Antigravity authentication failed", "antigravity");
    }
    return result.session;
  }

  async refresh(): Promise<ProviderSession> {
    if (!this.session.refreshToken) {
      this.session.authenticated = false;
      await clearSession("antigravity");
      return this.session;
    }

    try {
      const token = await refreshAccessToken(this.session.refreshToken);
      this.session.accessToken = token.accessToken;
      this.session.refreshToken = token.refreshToken || this.session.refreshToken;
      this.session.expiresAt = token.expiresIn ? Date.now() + token.expiresIn * 1000 : null;
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
      const models = await fetchAntigravityModels(this.session.accessToken);
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

    const model = opts.model || this.session.models[0] || "claude-sonnet-4";
    return generateAntigravity({
      accessToken: this.session.accessToken,
      model,
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.userPrompt,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    });
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
