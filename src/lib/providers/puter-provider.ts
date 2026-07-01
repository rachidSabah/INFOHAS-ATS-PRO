// ResumeAI Pro — Puter.js OAuth Provider
// Implements OAuthAIProvider for Puter.js browser-auth.
// Uses the official puter.auth API for sign-in, session management,
// and puter.ai.chat() for completions.

"use client";

import type { OAuthAIProvider, ProviderSession, ProviderAuthStatus } from "./interface";
import { ProviderAuthenticationError, createEmptySession } from "./interface";
import { saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon, encryptValue, decryptValue } from "./session-manager";

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

/**
 * Dynamically load the Puter.js SDK script and wait for it to be ready.
 * This avoids the automatic WebSocket connection that happens when the
 * script is loaded eagerly via <script> tag.
 */
function loadPuterScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Puter.js requires a browser environment"));
      return;
    }
    if (window.puter?.ai?.chat) {
      resolve(); // already loaded
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.async = true;
    script.onload = () => {
      const check = setInterval(() => {
        if (window.puter?.ai?.chat) {
          clearInterval(check);
          clearTimeout(timeout);
          // Suppress Puter's auto-connection banner
          try {
            if (window.puter && !(window.puter as any)._quietSet) {
              try { Object.defineProperty(window.puter, 'quiet', { value: true, writable: true, configurable: true }); }
              catch(e) { window.puter.quiet = true; }
              (window.puter as any)._quietSet = true;
            }
          } catch (_) { /* best-effort */ }
          resolve();
        }
      }, 50);
      const timeout = setTimeout(() => {
        clearInterval(check);
        if (window.puter?.ai?.chat) resolve();
        else reject(new Error("Puter.js SDK failed to initialize"));
      }, 15000);
    };
    script.onerror = () => reject(new Error("Failed to load Puter.js SDK script"));
    document.head.appendChild(script);
  });
}


export interface PuterAccount {
  id: string;
  email: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  connectedAt: number;
  active: boolean;
  status: "healthy" | "rate_limited" | "expired" | "disconnected";
  cooldownUntil?: number;
}

export class PuterProvider implements OAuthAIProvider {
  public accounts: PuterAccount[] = [];
  public autoRotate: boolean = true;
  public useGlobally: boolean = false;

  readonly id = "puter" as const;
  readonly name = "Puter.js";

  private session: ProviderSession = createEmptySession("puter");

  /**
   * Sign in with Puter using the official puter.auth.signIn() API.
   * This opens a popup for Google OAuth or email/password.
   */
  
  async saveAccounts(): Promise<void> {
    const encrypted = await Promise.all(this.accounts.map(async (a) => ({
      ...a,
      accessToken: await encryptValue(a.accessToken),
      refreshToken: await encryptValue(a.refreshToken),
    })));
    localStorage.setItem("puter_sessions", JSON.stringify({ accounts: encrypted, autoRotate: this.autoRotate, useGlobally: this.useGlobally }));
    
    // Attempt to sync to KV / D1 via API endpoint
    try {
      await fetch("/api/providers/puter/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: encrypted, autoRotate: this.autoRotate, useGlobally: this.useGlobally }),
      });
    } catch (e) {
      console.warn("Failed to sync puter accounts to API:", e);
    }
  }

  async loadAccounts(): Promise<void> {
    try {
      // First try API
      let data: any = null;
      try {
        const res = await fetch("/api/providers/puter/accounts");
        if (res.ok) {
          const apiData = await res.json();
          if (apiData.accounts) {
            data = apiData;
          }
        }
      } catch (e) {
        console.warn("Failed to load puter accounts from API, falling back to localStorage:", e);
      }

      if (!data) {
        const raw = localStorage.getItem("puter_sessions");
        if (raw) data = JSON.parse(raw);
      }

      if (data && Array.isArray(data.accounts)) {
        this.accounts = await Promise.all(data.accounts.map(async (a: any) => ({
          ...a,
          accessToken: await decryptValue(a.accessToken),
          refreshToken: await decryptValue(a.refreshToken),
        })));
        this.autoRotate = data.autoRotate ?? true;
        this.useGlobally = data.useGlobally ?? false;
      }
    } catch (e) {
      console.error("Failed to load Puter accounts:", e);
    }
  }

  async setActiveAccount(id: string): Promise<void> {
    this.accounts.forEach(a => {
      a.active = (a.id === id);
    });
    await this.saveAccounts();
    await this.syncActiveAccountToSession();
    
    try {
      await fetch("/api/providers/puter/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      console.debug("[PuterProvider] Non-fatal: switch API notification failed:", e instanceof Error ? e.message : e);
    }
  }

  async removeAccount(id: string): Promise<void> {
    const wasActive = this.accounts.find(a => a.id === id)?.active;
    this.accounts = this.accounts.filter(a => a.id !== id);
    if (wasActive && this.accounts.length > 0) {
      this.accounts[0].active = true;
    }
    await this.saveAccounts();
    await this.syncActiveAccountToSession();

    try {
      await fetch("/api/providers/puter/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      console.debug("[PuterProvider] Non-fatal: remove API notification failed:", e instanceof Error ? e.message : e);
    }
  }

  async rotateToNextHealthyAccount(): Promise<boolean> {
    if (!this.autoRotate) return false;
    const currentIndex = this.accounts.findIndex(a => a.active);
    for (let i = 1; i <= this.accounts.length; i++) {
      const nextIndex = (currentIndex + i) % this.accounts.length;
      const account = this.accounts[nextIndex];
      // Check cooldowns
      if (account.status === "rate_limited" && account.cooldownUntil && Date.now() > account.cooldownUntil) {
        account.status = "healthy";
        account.cooldownUntil = undefined;
      }
      if (account.status === "healthy" && !account.active) {
        console.log(`[PUTER] Auto rotating account.\n[PUTER] Switched: ${account.email}`);
        await this.setActiveAccount(account.id);
        
        try {
          await fetch("/api/providers/puter/rotate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: account.id }),
          });
        } catch (e) {
          console.debug("[PuterProvider] Non-fatal: rotate API notification failed:", e instanceof Error ? e.message : e);
        }
        
        return true;
      }
    }
    return false;
  }

  async syncActiveAccountToSession(): Promise<void> {
    const active = this.accounts.find(a => a.active);
    if (active) {
      // Inject token into window.puter if supported.
      // Guard with a ready-check to avoid triggering Puter's internal socket
      // reconnect while it's already connecting — this causes the
      // "WebSocket closed before connection established" race.
      try {
        if (typeof window !== "undefined" && window.puter) {
          // Only call setAuthToken / assign authToken if Puter is fully loaded.
          // Puter sets window.puter.ready when initialisation is complete.
          const puterReady = (window.puter as any).ready !== false;
          if (puterReady) {
            if (typeof window.puter.setAuthToken === "function") {
              window.puter.setAuthToken(active.accessToken);
            } else {
              window.puter.authToken = active.accessToken;
            }
          }
        }
      } catch (e) {
        console.debug("[PuterProvider] Non-fatal: setAuthToken failed (Puter not ready or API changed):", e instanceof Error ? e.message : e);
      }

      this.session.authenticated = true;
      this.session.email = active.email;
      this.session.userId = active.userId;
      this.session.accessToken = active.accessToken;
      this.session.refreshToken = active.refreshToken;
      this.session.expiresAt = active.expiresAt;
      this.session.connectedAt = active.connectedAt;
      this.session.authMethod = "puter_oauth";
    } else {
      this.session.authenticated = false;
      this.session.email = null;
      this.session.userId = null;
      this.session.accessToken = null;
      this.session.expiresAt = null;
    }
    await saveSession(this.session);
  }

  async login(): Promise<ProviderSession> {
    if (typeof window === "undefined") {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Puter.js requires a browser environment",
        "puter",
      );
    }

    // Dynamically load Puter script if not already loaded
    await loadPuterScript();

    if (!window.puter) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Puter.js failed to load. Please try again.",
        "puter",
      );
    }

    try {
      // Use Puter's official auth API
      // puter.auth.signIn({ prompt: "select_account" }) opens the OAuth popup
      await window.puter.auth.signIn({ prompt: "select_account" });

      // Get user info after sign-in
      const user = await window.puter.auth.getUser();
      if (!user || !user.username) {
        throw new ProviderAuthenticationError(
          "login_failed",
          "Puter sign-in did not return user information. Please try again.",
          "puter",
        );
      }

      const token = await this.extractAccessToken();

      const newAccount: PuterAccount = {
        id: crypto.randomUUID(),
        email: user.email || `${user.username}@puter.com`,
        userId: String(user.id || user.username),
        accessToken: token,
        refreshToken: null, // Puter manages refresh internally
        expiresAt: Date.now() + SESSION_TTL_MS,
        connectedAt: Date.now(),
        active: true,
        status: "healthy",
      };

      console.log(`[PUTER]\nConnected:\n${newAccount.email}`);

      // Deactivate others
      this.accounts.forEach(a => a.active = false);
      // Ensure we don't duplicate emails
      this.accounts = this.accounts.filter(a => a.email !== newAccount.email);
      this.accounts.push(newAccount);

      await this.saveAccounts();
      await this.syncActiveAccountToSession();

      // Notify server
      try {
        await fetch("/api/providers/puter/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: newAccount.email }),
        });
      } catch (e) {
        console.debug("[PuterProvider] Non-fatal: login API notification failed:", e instanceof Error ? e.message : e);
      }

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
    }

    const active = this.accounts.find(a => a.active);
    if (active) {
       await this.removeAccount(active.id);
    } else {
       this.session = createEmptySession("puter");
       await clearSession("puter");
    }

    console.log("[PROVIDER AUTH] Puter session cleared");
  }

  async restore(): Promise<ProviderSession | null> {
    await this.loadAccounts();
    await this.syncActiveAccountToSession();
    
    if (!this.session.authenticated) {
      return null;
    }

    // Check if session is expired
    if (isSessionExpired(this.session)) {
      // Try to refresh
      try {
        const refreshed = await this.refresh();
        console.log("[PROVIDER AUTH] session restored (refreshed)");
        return refreshed;
      } catch (err) {
        console.warn("[puterProvider] Session refresh failed:", err instanceof Error ? err.message : err);
        // Refresh failed — mark active account as expired
        const active = this.accounts.find(a => a.active);
        if (active) {
           active.status = "expired";
           await this.saveAccounts();
           await this.syncActiveAccountToSession();
        }
        console.log("[PROVIDER AUTH] session expired");
        return this.session;
      }
    }

    // Proactively refresh if expiring soon
    if (isSessionExpiringSoon(this.session)) {
      this.refresh().catch((err) => {
        console.warn("[PuterProvider] Proactive session refresh failed in background:", err instanceof Error ? err.message : err);
      });
    }

    console.log("[PROVIDER AUTH] session restored");
    return this.session;
  }

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
    // AUTH CHECK — try authenticated first, then anonymous fallback
    if (!this.isAuthenticated()) {
      // Try anonymous mode — Puter.js allows limited anonymous AI calls
      // This is the last resort when all API providers are rate-limited
      if (typeof window !== "undefined" && window.puter?.ai?.chat) {
        console.info("[Puter] Not authenticated — trying anonymous AI call (limited usage)");
        try {
          const result = await this.callPuterAI(opts);
          return { ...result, provider: "Puter.js (anonymous)" };
        } catch (anonErr: any) {
          console.warn("[Puter] Anonymous call failed:", anonErr?.message || anonErr);
          // Fall through to auth error
        }
      }
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

    return this.callPuterAI(opts);
  }

  /**
   * Call Puter AI — shared between authenticated and anonymous modes.
   */
  private async callPuterAI(opts: {
    systemPrompt?: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<{ text: string; provider: string; latencyMs: number }> {
    let attempts = 0;
    while (attempts <= this.accounts.length) {
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

      try {
        // Wrap puter.ai.chat in a 30s timeout to prevent it hanging forever
        // when the WebSocket connection stalls or the server is overloaded.
        const PUTER_CALL_TIMEOUT_MS = 30_000;
        const chatPromise: Promise<any> = window.puter.ai.chat(messages, chatOpts);
        const timeoutPromise: Promise<never> = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Puter.ai.chat timed out after ${PUTER_CALL_TIMEOUT_MS / 1000}s`)), PUTER_CALL_TIMEOUT_MS)
        );
        const resp: any = await Promise.race([chatPromise, timeoutPromise]);

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

        if (attempts > 0) {
           console.log("[PUTER]\nRetry successful.");
        }

        return {
          text,
          provider: "Puter.js",
          latencyMs: Math.round(performance.now() - t0),
        };
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (/429|quota|rate limit|usage exhausted/i.test(msg)) {
           console.log("[PUTER]\nRate limit detected.");
           const active = this.accounts.find(a => a.active);
           if (active) {
             active.status = "rate_limited";
             active.cooldownUntil = Date.now() + 60 * 60 * 1000; // 1 hour
             await this.saveAccounts();
           }
           
           const rotated = await this.rotateToNextHealthyAccount();
           if (rotated) {
             attempts++;
             continue; // Retry with next account
           }
        }
        throw e;
      }
    }

    throw new ProviderAuthenticationError(
      "quota_exhausted",
      "All Puter accounts have exhausted their quota or reached rate limits.",
      "puter"
    );
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
      accounts: this.accounts,
      autoRotate: this.autoRotate,
      useGlobally: this.useGlobally,
    };
  }

  isAuthenticated(): boolean {
    if (!this.session.authenticated) return false;
    if (isSessionExpired(this.session)) {
      return false;
    }
    return true;
  }

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

  
  async setAutoRotate(enabled: boolean): Promise<void> {
    this.autoRotate = enabled;
    await this.saveAccounts();
  }

  async setUseGlobally(enabled: boolean): Promise<void> {
    this.useGlobally = enabled;
    await this.saveAccounts();
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
