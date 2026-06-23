// ResumeAI Pro — Puter.js OAuth Provider
// Implements OAuthAIProvider for Puter.js browser-auth.
// Uses the official puter.auth API for sign-in, session management,
// and puter.ai.chat() for completions.

"use client";

import type { OAuthAIProvider, ProviderSession, ProviderAuthStatus } from "./interface";
import { ProviderAuthenticationError, createEmptySession } from "./interface";
import { saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon } from "./session-manager";

// Available models on Puter (per official docs)
const PUTER_MODELS = [
  "claude-sonnet-4-5",
  "gpt-5.4-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-2.5-flash",
  "deepseek-chat",
  "deepseek-reasoner",
  "meta-llama/Llama-3.3-70B-Instruct",
];

// Session TTL — Puter sessions typically last ~1 hour
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export class PuterProvider implements OAuthAIProvider {
  readonly id = "puter" as const;
  readonly name = "Puter.js";

  private session: ProviderSession = createEmptySession("puter");

  /**
   * Sign in with Puter using the official puter.auth.signIn() API.
   * This opens a popup for Google OAuth or email/password.
   */
  async login(): Promise<ProviderSession> {
    if (typeof window === "undefined" || !window.puter) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Puter.js is not loaded. Please refresh the page and try again.",
        "puter",
      );
    }

    try {
      // Use Puter's official auth API
      // puter.auth.signIn() opens the OAuth popup
      await window.puter.auth.signIn();

      // Get user info after sign-in
      const user = await window.puter.auth.getUser();
      if (!user || !user.username) {
        throw new ProviderAuthenticationError(
          "login_failed",
          "Puter sign-in did not return user information. Please try again.",
          "puter",
        );
      }

      this.session = {
        provider: "puter",
        authenticated: true,
        email: user.email || `${user.username}@puter.com`,
        userId: String(user.id || user.username),
        accessToken: await this.extractAccessToken(),
        refreshToken: null, // Puter manages refresh internally
        expiresAt: Date.now() + SESSION_TTL_MS,
        connectedAt: Date.now(),
        models: PUTER_MODELS,
        sharedAdminAccount: false,
        authMethod: "puter_oauth",
        googleUserId: null,
        googlePicture: null,
      };

      await saveSession(this.session);

      console.log(
        `[Puter] Connected as ${this.session.email}`,
      );
      console.log("[Puter] Authenticated provider ready.");

      return this.session;
    } catch (e: any) {
      if (e instanceof ProviderAuthenticationError) throw e;
      throw new ProviderAuthenticationError(
        "login_failed",
        `Puter login failed: ${e?.message || "Unknown error"}`,
        "puter",
      );
    }
  }

  /**
   * Refresh the Puter session.
   * Puter manages its own sessions internally via puter.auth,
   * so we verify the current auth state and extend the expiry.
   */
  async refresh(): Promise<ProviderSession> {
    if (typeof window === "undefined" || !window.puter) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Puter.js is not loaded.",
        "puter",
      );
    }

    try {
      // Check if still signed in
      const isSignedIn = window.puter.auth?.isSignedIn
        ? window.puter.auth.isSignedIn()
        : false;

      if (!isSignedIn) {
        // DO NOT call signIn() here — it opens a popup which will be blocked
        // by popup blockers when called from a non-user-gesture context (like
        // a background refresh). Instead, mark as unauthenticated and require
        // the user to explicitly sign in again.
        this.session = createEmptySession("puter");
        this.session.authenticated = false;
        await saveSession(this.session);
        throw new ProviderAuthenticationError(
          "session_expired",
          "Puter session expired. Please sign in again from Provider Settings.",
          "puter",
        );
      }

      // Extend the session
      const user = await window.puter.auth.getUser();
      this.session.authenticated = true;
      this.session.email = user?.email || this.session.email;
      this.session.expiresAt = Date.now() + SESSION_TTL_MS;
      this.session.models = PUTER_MODELS;

      await saveSession(this.session);

      console.log("[PROVIDER AUTH] session refreshed");
      return this.session;
    } catch (e: any) {
      if (e instanceof ProviderAuthenticationError) throw e;
      throw new ProviderAuthenticationError(
        "refresh_failed",
        `Session refresh failed: ${e?.message || "Unknown error"}`,
        "puter",
      );
    }
  }

  /**
   * Disconnect from Puter.
   */
  async logout(): Promise<void> {
    try {
      if (typeof window !== "undefined" && window.puter?.auth?.signOut) {
        await window.puter.auth.signOut();
      }
    } catch (err) {
      console.warn("[puterProvider] SignOut failed:", err instanceof Error ? err.message : err);
      // SignOut may not be available — just clear the session
    }

    this.session = createEmptySession("puter");
    await clearSession("puter");

    console.log("[PROVIDER AUTH] Puter session cleared");
  }

  /**
   * Restore a previously stored session on app startup.
   */
  async restore(): Promise<ProviderSession | null> {
    const stored = await loadSession("puter");
    if (!stored || !stored.authenticated) {
      this.session = createEmptySession("puter");
      return null;
    }

    this.session = stored;

    // Ensure new fields exist on sessions from older versions
    if (!this.session.authMethod) {
      this.session.authMethod = "puter_oauth";
    }
    if (!this.session.googleUserId) {
      this.session.googleUserId = null;
    }
    if (!this.session.googlePicture) {
      this.session.googlePicture = null;
    }

    // Check if session is expired
    if (isSessionExpired(stored)) {
      // Try to refresh
      try {
        const refreshed = await this.refresh();
        console.log("[PROVIDER AUTH] session restored (refreshed)");
        return refreshed;
      } catch (err) {
        console.warn("[puterProvider] Session refresh failed:", err instanceof Error ? err.message : err);
        // Refresh failed — mark as unauthenticated
        this.session.authenticated = false;
        this.session.expiresAt = null;
        await saveSession(this.session);
        console.log("[PROVIDER AUTH] session expired");
        return this.session;
      }
    }

    // Proactively refresh if expiring soon
    if (isSessionExpiringSoon(stored)) {
      this.refresh().catch(() => {
        // Background refresh failed — session still valid for now
      });
    }

    console.log("[PROVIDER AUTH] session restored");
    return this.session;
  }

  /**
   * List available Puter models.
   */
  async listModels(): Promise<string[]> {
    if (!this.isAuthenticated()) {
      return [];
    }
    return PUTER_MODELS;
  }

  /**
   * Generate a completion using Puter.ai.chat().
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
        "Puter authentication required. Please sign in from Provider Settings.",
        "puter",
      );
    }

    if (typeof window === "undefined" || !window.puter?.ai?.chat) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Puter.js is not available. Please refresh the page.",
        "puter",
      );
    }

    const t0 = performance.now();

    const messages = opts.systemPrompt
      ? [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ]
      : [{ role: "user", content: opts.userPrompt }];

    const chatOpts: any = {
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.model) {
      chatOpts.model = opts.model;
    }

    const resp: any = await window.puter.ai.chat(messages, chatOpts);

    // Parse the response
    let text = "";
    if (typeof resp === "string") {
      text = resp;
    } else if (resp?.message?.content) {
      text = Array.isArray(resp.message.content)
        ? resp.message.content.map((c: any) => c?.text ?? "").join("")
        : String(resp.message.content);
    } else if (resp?.text) {
      text = resp.text;
    } else if (resp?.message?.role === "assistant" && typeof resp.message.content === "string") {
      text = resp.message.content;
    } else if (resp?.toString && typeof resp.toString === "function") {
      const str = resp.toString();
      if (str && str !== "[object Object]") text = str;
    }

    if (!text) {
      try { text = JSON.stringify(resp); } catch (err) { console.warn("[puterProvider] Response JSON.stringify failed:", err instanceof Error ? err.message : err); text = String(resp ?? ""); }
    }

    return {
      text,
      provider: "Puter.js",
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
      authMethod: this.session.authMethod,
      googleUserId: this.session.googleUserId,
      googlePicture: this.session.googlePicture,
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
    } catch (err) {
      console.warn("[puterProvider] Session tryRefresh failed:", err instanceof Error ? err.message : err);
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

  // Private helpers

  private async extractAccessToken(): Promise<string | null> {
    try {
      // Puter doesn't expose a traditional access token,
      // but we can get a session token for API calls
      if (typeof window !== "undefined" && window.puter?.auth?.getUser) {
        const user = await window.puter.auth.getUser();
        return user?.token || user?.accessToken || null;
      }
    } catch (err) {
      console.warn("[puterProvider] Token extraction failed:", err instanceof Error ? err.message : err);
      // Token extraction is best-effort
    }
    return null;
  }
}

// Singleton instance
let instance: PuterProvider | null = null;

export function getPuterProvider(): PuterProvider {
  if (!instance) {
    instance = new PuterProvider();
  }
  return instance;
}
