// ResumeAI Pro — Z.ai Direct OAuth Provider
// Implements OAuthAIProvider for Z.ai Direct.
// Z.ai provides a REST API at api.z.ai with API key authentication.
// We also support Google OAuth via Google Identity Services (GIS).
//
// Authentication methods:
// 1. Google OAuth (preferred): Opens Google sign-in popup → links Google identity
//    to a Z.ai API key. Returning users get auto-connected.
// 2. API Key: Direct entry of Z.ai API key for users who prefer manual config.

"use client";

import type { OAuthAIProvider, ProviderSession, ProviderAuthStatus } from "./interface";
import { ProviderAuthenticationError, createEmptySession } from "./interface";
import { saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon } from "./session-manager";
import { signInWithGoogle, getGoogleClientId, isGoogleOAuthConfigured } from "./google-oauth";
import type { GoogleUserInfo } from "./google-oauth";

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

// Storage key for Google-Z.ai API key association
const GOOGLE_ZAI_KEY_PREFIX = "resumeai-google-zai-key-";

export class ZaiProvider implements OAuthAIProvider {
  readonly id = "zai-direct" as const;
  readonly name = "Z.ai Direct";

  private session: ProviderSession = createEmptySession("zai-direct");

  /**
   * "Sign in" to Z.ai by validating the API key.
   * Z.ai's primary authentication is via API key.
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
        authMethod: "api_key",
        googleUserId: null,
        googlePicture: null,
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
   * Sign in with Google OAuth.
   * Opens a Google sign-in popup. After authentication:
   * - If the user has previously linked a Z.ai API key to their Google account,
   *   the key is automatically restored and the session is established.
   * - If not, the user is prompted to enter their Z.ai API key, which is then
   *   linked to their Google identity for future auto-login.
   *
   * IMPORTANT: This MUST be called from a user gesture (click handler)
   * because it opens a popup window. Popup blockers will prevent it otherwise.
   */
  async loginWithGoogle(): Promise<ProviderSession> {
    if (!isGoogleOAuthConfigured()) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Google OAuth is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in your environment variables to enable Google sign-in for Z.ai.",
        "zai-direct",
      );
    }

    try {
      // Step 1: Sign in with Google (opens popup)
      console.log("[Z.ai Google OAuth] Opening Google sign-in popup...");
      const { accessToken: googleAccessToken, userInfo } = await signInWithGoogle();

      console.log(`[Z.ai Google OAuth] Authenticated as ${userInfo.email} (sub: ${userInfo.sub})`);

      // Step 2: Check if this Google user has a previously linked Z.ai API key
      const linkedApiKey = await this.getLinkedZaiApiKey(userInfo.sub);

      if (linkedApiKey) {
        // Step 3a: Validate the linked API key
        console.log("[Z.ai Google OAuth] Found linked API key, validating...");
        try {
          const isValid = await this.validateApiKey(linkedApiKey);
          if (isValid) {
            // Create session with Google identity + linked Z.ai API key
            this.session = {
              provider: "zai-direct",
              authenticated: true,
              email: userInfo.email,
              userId: `google:${userInfo.sub}`,
              accessToken: linkedApiKey,
              refreshToken: null,
              expiresAt: Date.now() + SESSION_TTL_MS,
              connectedAt: Date.now(),
              models: ZAI_MODELS,
              sharedAdminAccount: false,
              authMethod: "google_oauth",
              googleUserId: userInfo.sub,
              googlePicture: userInfo.picture,
            };

            await saveSession(this.session);

            console.log(`[Z.ai Google OAuth] Connected as ${userInfo.email} via Google OAuth`);
            return this.session;
          }
        } catch {
          // Linked key is no longer valid — fall through to prompt for new key
          console.warn("[Z.ai Google OAuth] Linked API key is no longer valid, prompting for new key");
        }
      }

      // Step 3b: No linked key or linked key is invalid.
      // We need the user to provide a Z.ai API key.
      // Open the Z.ai portal so the user can generate one.
      console.log("[Z.ai Google OAuth] No linked API key found, opening Z.ai portal...");

      // Open Z.ai's API key management portal
      const portalUrl = "https://open.bigmodel.cn/user-center/apikey";
      const popup = window.open(portalUrl, "zai-apikey-portal", "width=800,height=700,left=200,top=100");

      // Store the Google user info temporarily so we can link the key later
      this._pendingGoogleUser = userInfo;

      if (!popup) {
        throw new ProviderAuthenticationError(
          "login_failed",
          "Popup blocked. Please allow popups for this site, then try again. Alternatively, use the API Key method below.",
          "zai-direct",
        );
      }

      // Return a special "partial" session that indicates Google auth succeeded
      // but we still need the Z.ai API key
      this.session = {
        provider: "zai-direct",
        authenticated: false, // NOT fully authenticated yet — need API key
        email: userInfo.email,
        userId: `google:${userInfo.sub}`,
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        connectedAt: Date.now(),
        models: ZAI_MODELS,
        sharedAdminAccount: false,
        authMethod: "google_oauth",
        googleUserId: userInfo.sub,
        googlePicture: userInfo.picture,
      };

      // Throw a special error that the UI can catch to show the API key prompt
      throw new ProviderAuthenticationError(
        "not_configured",
        `GOOGLE_AUTH_SUCCESS_NEED_API_KEY:${userInfo.email}:${userInfo.sub}:${userInfo.picture || ""}`,
        "zai-direct",
      );
    } catch (e: any) {
      if (e instanceof ProviderAuthenticationError) throw e;
      throw new ProviderAuthenticationError(
        "login_failed",
        `Google OAuth sign-in failed: ${e?.message || "Unknown error"}`,
        "zai-direct",
      );
    }
  }

  /**
   * Complete Google OAuth login by providing the Z.ai API key.
   * Called after loginWithGoogle() returns the "need API key" special error.
   * Links the API key to the Google identity for future auto-login.
   */
  async completeGoogleLogin(apiKey: string): Promise<ProviderSession> {
    const googleUser = this._pendingGoogleUser;
    if (!googleUser) {
      throw new ProviderAuthenticationError(
        "login_failed",
        "No pending Google authentication. Please sign in with Google first.",
        "zai-direct",
      );
    }

    // Validate the provided API key
    const isValid = await this.validateApiKey(apiKey);
    if (!isValid) {
      throw new ProviderAuthenticationError(
        "login_failed",
        "The provided Z.ai API key is invalid. Please check your key and try again.",
        "zai-direct",
      );
    }

    // Link the API key to the Google identity
    await this.linkZaiApiKey(googleUser.sub, apiKey);

    // Create the session
    this.session = {
      provider: "zai-direct",
      authenticated: true,
      email: googleUser.email,
      userId: `google:${googleUser.sub}`,
      accessToken: apiKey,
      refreshToken: null,
      expiresAt: Date.now() + SESSION_TTL_MS,
      connectedAt: Date.now(),
      models: ZAI_MODELS,
      sharedAdminAccount: false,
      authMethod: "google_oauth",
      googleUserId: googleUser.sub,
      googlePicture: googleUser.picture,
    };

    await saveSession(this.session);
    this._pendingGoogleUser = null;

    console.log(`[Z.ai Google OAuth] Connected as ${googleUser.email} — API key linked to Google identity`);
    return this.session;
  }

  // Temporary storage for Google user info during the multi-step OAuth flow
  private _pendingGoogleUser: GoogleUserInfo | null = null;

  /**
   * Get the pending Google user info (for UI to show after partial Google auth).
   */
  getPendingGoogleUser(): GoogleUserInfo | null {
    return this._pendingGoogleUser;
  }

  /**
   * Clear the pending Google user info.
   */
  clearPendingGoogleUser(): void {
    this._pendingGoogleUser = null;
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
    // If authenticated via Google OAuth, also clear the Google-Z.ai key link
    if (this.session.authMethod === "google_oauth" && this.session.googleUserId) {
      await this.unlinkZaiApiKey(this.session.googleUserId);
    }

    this.session = createEmptySession("zai-direct");
    this._pendingGoogleUser = null;
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
        } catch (autoLoginErr) {
          console.warn("[Z.ai Provider] Auto-login failed — user must manually connect:", autoLoginErr instanceof Error ? autoLoginErr.message : autoLoginErr);
        }
      }
      this.session = createEmptySession("zai-direct");
      return null;
    }

    this.session = stored;

    // Ensure new fields exist on sessions from older versions
    if (!this.session.authMethod) {
      this.session.authMethod = "api_key";
    }
    if (!this.session.googleUserId) {
      this.session.googleUserId = null;
    }
    if (!this.session.googlePicture) {
      this.session.googlePicture = null;
    }

    // Check if session is expired
    if (isSessionExpired(stored)) {
      try {
        const refreshed = await this.refresh();
        console.log("[PROVIDER AUTH] session restored (refreshed)");
        return refreshed;
      } catch (refreshErr) {
        console.warn("[Z.ai Provider] Session refresh failed:", refreshErr instanceof Error ? refreshErr.message : refreshErr);
        this.session.authenticated = false;
        this.session.expiresAt = null;
        await saveSession(this.session);
        console.log("[PROVIDER AUTH] session expired");
        return this.session;
      }
    }

    // Proactively refresh if expiring soon
    if (isSessionExpiringSoon(stored)) {
      this.refresh().catch((e) => { console.warn("[Z.ai Provider] Proactive refresh failed:", e instanceof Error ? e.message : e); });
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

  // ============================================================================
  // Private Helpers
  // ============================================================================

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

  /**
   * Validate a Z.ai API key by making a minimal test call.
   */
  private async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "glm-5-flash",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15000),
      });
      return res.ok;
    } catch (validateErr) {
      console.warn("[Z.ai Provider] API key validation request failed:", validateErr instanceof Error ? validateErr.message : validateErr);
      return false;
    }
  }

  /**
   * Store a Z.ai API key linked to a Google user ID.
   * Uses localStorage with XOR obfuscation for secure storage.
   * Key format: resumeai-google-zai-key-{googleUserId}
   *
   * SECURITY NOTE: Client-side encryption is inherently limited — the decryption
   * key is also client-side. XOR obfuscation prevents casual snooping (DevTools
   * localStorage viewer) but is NOT equivalent to server-side encryption.
   * For true security, the API key should be stored server-side (D1) with
   * server-side AES-GCM encryption (as done in workers/api/index.ts).
   */
  private async linkZaiApiKey(googleUserId: string, apiKey: string): Promise<void> {
    try {
      const key = `${GOOGLE_ZAI_KEY_PREFIX}${googleUserId}`;
      // XOR-obfuscate the API key so it's not plaintext in localStorage.
      // The obfuscation key is derived from the Google user ID + app salt.
      const obfuscated = this.obfuscateApiKey(apiKey, googleUserId);
      localStorage.setItem(key, obfuscated);
      console.log(`[Z.ai Google OAuth] API key linked to Google user ${googleUserId}`);
    } catch (e) {
      console.warn("[Z.ai Google OAuth] Failed to link API key:", e);
    }
  }

  /**
   * Retrieve a Z.ai API key previously linked to a Google user ID.
   * De-obfuscates the stored value before returning.
   */
  private async getLinkedZaiApiKey(googleUserId: string): Promise<string | null> {
    try {
      const key = `${GOOGLE_ZAI_KEY_PREFIX}${googleUserId}`;
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      // Try de-obfuscation first. If it fails (legacy plaintext), return as-is.
      try {
        return this.deobfuscateApiKey(stored, googleUserId);
      } catch {
        // Legacy plaintext storage — return as-is for backwards compatibility
        console.warn("[Z.ai Provider] Legacy plaintext API key found — consider re-linking for obfuscated storage.");
        return stored;
      }
    } catch (storageErr) {
      console.warn("[Z.ai Provider] Failed to retrieve linked API key:", storageErr instanceof Error ? storageErr.message : storageErr);
      return null;
    }
  }

  /**
   * Remove the Z.ai API key linked to a Google user ID.
   */
  private async unlinkZaiApiKey(googleUserId: string): Promise<void> {
    try {
      const key = `${GOOGLE_ZAI_KEY_PREFIX}${googleUserId}`;
      localStorage.removeItem(key);
      console.log(`[Z.ai Google OAuth] API key unlinked from Google user ${googleUserId}`);
    } catch (unlinkErr) {
      console.warn("[Z.ai Provider] Failed to unlink API key:", unlinkErr instanceof Error ? unlinkErr.message : unlinkErr);
    }
  }

  // ============================================================================
  // XOR Obfuscation for API key storage in localStorage
  // ============================================================================

  /** App-specific salt for XOR obfuscation (NOT cryptographic — just prevents casual reading) */
  private static readonly OBFUSCATION_SALT = "ResumeAI-Pro-2024-ZAI-KEY-OBFUSCATION";

  /**
   * XOR-obfuscate an API key with a key derived from the user ID + salt.
   * Returns a base64-encoded string that is NOT human-readable.
   */
  private obfuscateApiKey(apiKey: string, userId: string): string {
    const key = userId + ZaiProvider.OBFUSCATION_SALT;
    const keyBytes = new TextEncoder().encode(key);
    const apiBytes = new TextEncoder().encode(apiKey);
    const result = new Uint8Array(apiBytes.length);
    for (let i = 0; i < apiBytes.length; i++) {
      result[i] = apiBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    // Prepend "enc:" marker so we can distinguish obfuscated from plaintext
    return "enc:" + btoa(String.fromCharCode(...result));
  }

  /**
   * De-obfuscate an API key. If the stored value doesn't start with "enc:",
   * it's a legacy plaintext key — throw so the caller can handle it.
   */
  private deobfuscateApiKey(stored: string, userId: string): string {
    if (!stored.startsWith("enc:")) {
      throw new Error("Not an obfuscated value — legacy plaintext");
    }
    const b64 = stored.slice(4);
    const encoded = atob(b64);
    const key = userId + ZaiProvider.OBFUSCATION_SALT;
    const keyBytes = new TextEncoder().encode(key);
    const result = new Uint8Array(encoded.length);
    for (let i = 0; i < encoded.length; i++) {
      result[i] = encoded.charCodeAt(i) ^ keyBytes[i % keyBytes.length];
    }
    return new TextDecoder().decode(result);
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
