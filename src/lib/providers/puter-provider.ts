// ResumeAI Pro — Puter.js OAuth Provider
// Implements OAuthAIProvider for Puter.js browser-auth.
// Uses the official puter.auth API for sign-in, session management,
// and puter.ai.chat() for completions.

"use client";

import type { OAuthAIProvider, ProviderSession, ProviderAuthStatus } from "./interface";
import { ProviderAuthenticationError, createEmptySession } from "./interface";
import { saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon, encryptValue, decryptValue } from "./session-manager";
// Puter curated ids — SINGLE SOURCE OF TRUTH (src/lib/puter-models.ts).
import {
  PUTER_CURATED_MODEL_IDS,
  sanitizePuterChatOpts,
  isPuterTemperatureError,
} from "../puter-models";
// Per-user identity for the server-side account mirror — without this, ALL
// users' Puter accounts landed in the same "anonymous" bucket on the API.
import { getEffectiveUserId } from "../cloud-api";

// Available models on Puter — derived from the shared curated catalog.
const PUTER_MODELS: string[] = [...PUTER_CURATED_MODEL_IDS];

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
  private restorePromise: Promise<ProviderSession | null> | null = null;

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
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("puter_sessions", JSON.stringify({ accounts: encrypted, autoRotate: this.autoRotate, useGlobally: this.useGlobally }));
    }

    // Attempt to sync to KV / D1 via API endpoint
    try {
      const res = await fetch("/api/providers/puter/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getEffectiveUserId() },
        body: JSON.stringify({ accounts: encrypted, autoRotate: this.autoRotate, useGlobally: this.useGlobally }),
      });
      if (res.ok) {
        const rd = (await res.json().catch(() => null)) as any;
        if (rd?.ok === false) {
          console.warn("[PuterProvider] Server account sync unavailable (" + (rd.error || "unknown") + ") — accounts persist locally only.");
        }
      }
    } catch (e) {
      console.warn("Failed to sync puter accounts to API:", e instanceof Error ? e.message : e);
    }
  }

  async loadAccounts(): Promise<void> {
    try {
      let data: any = null;
      let localHadAccounts = false;

      // 1. localStorage first (canonical client-side store for browser-auth sessions).
      //    REGRESSION GUARD (Task 19): only a NON-empty accounts array is
      //    trusted. The old code accepted ANY truthy `accounts` field —
      //    including `[]` coming back from the server — which shadowed the
      //    local copy and wiped persisted accounts on every page refresh.
      if (typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem("puter_sessions");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
              data = parsed;
              localHadAccounts = true;
            } else if (parsed) {
              if (parsed.autoRotate !== undefined) this.autoRotate = parsed.autoRotate;
              if (parsed.useGlobally !== undefined) this.useGlobally = parsed.useGlobally;
            }
          }
        } catch (e) {
          console.warn("Failed to load puter accounts from localStorage:", e instanceof Error ? e.message : e);
        }
      }

      // 2. If no accounts found in localStorage, try cloud API.
      let apiHadAccounts = false;
      if (!data) {
        try {
          const res = await fetch("/api/providers/puter/accounts", {
            headers: { "X-User-Id": getEffectiveUserId() },
          });
          if (res.ok) {
            const apiData = (await res.json().catch(() => null)) as any;
            if (apiData && Array.isArray(apiData.accounts) && apiData.accounts.length > 0) {
              data = apiData;
              apiHadAccounts = true;
            } else if (apiData) {
              if (apiData.autoRotate !== undefined) this.autoRotate = apiData.autoRotate;
              if (apiData.useGlobally !== undefined) this.useGlobally = apiData.useGlobally;
            }
          }
        } catch (e) {
          console.warn("Failed to load puter accounts from API:", e instanceof Error ? e.message : e);
        }
      }

      if (data && Array.isArray(data.accounts) && data.accounts.length > 0) {
        this.accounts = await Promise.all(data.accounts.map(async (a: any) => {
          let decryptedAccess: string | null = null;
          let decryptedRefresh: string | null = null;
          try {
            decryptedAccess = a.accessToken ? await decryptValue(a.accessToken) : null;
          } catch {
            decryptedAccess = a.accessToken;
          }
          try {
            decryptedRefresh = a.refreshToken ? await decryptValue(a.refreshToken) : null;
          } catch {
            decryptedRefresh = a.refreshToken;
          }
          return {
            ...a,
            accessToken: decryptedAccess ?? a.accessToken,
            refreshToken: decryptedRefresh ?? a.refreshToken,
          };
        }));
        if (data.autoRotate !== undefined) this.autoRotate = data.autoRotate;
        if (data.useGlobally !== undefined) this.useGlobally = data.useGlobally;

        // 3. SELF-HEAL (Task 19) — the accounts came from the LOCAL copy while
        //    the server copy was empty (KV binding missing, or the POST
        //    silently no-op'd). Push the local copy up so the accounts also
        //    survive on the server and reach other browsers of the same user.
        if (localHadAccounts && !apiHadAccounts) {
          this.saveAccounts().catch((e) =>
            console.warn("[PuterProvider] Self-heal account sync to server failed:", e instanceof Error ? e.message : e)
          );
        }
      }
    } catch (e) {
      console.error("Failed to load Puter accounts:", e instanceof Error ? e.message : e);
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
      // Inject token into window.puter and localStorage if available
      try {
        if (typeof window !== "undefined") {
          if (window.puter) {
            const puterReady = (window.puter as any).ready !== false;
            if (puterReady) {
              if (typeof window.puter.setAuthToken === "function") {
                window.puter.setAuthToken(active.accessToken);
              }
              if (typeof window.puter.auth?.setAuthToken === "function") {
                window.puter.auth.setAuthToken(active.accessToken);
              }
              window.puter.authToken = active.accessToken;
              if (window.puter.auth) {
                window.puter.auth.token = active.accessToken;
                window.puter.auth.authToken = active.accessToken;
              }
            }
          }
          if (active.accessToken) {
            try {
              localStorage.setItem("puter.auth.token", active.accessToken);
              localStorage.setItem("puter_auth_token", active.accessToken);
            } catch (_) {}
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
    if (typeof window === "undefined") {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Puter.js requires a browser environment",
        "puter",
      );
    }

    // Ensure Puter script is loaded before checking sign-in status
    if (!window.puter?.auth) {
      try {
        await loadPuterScript();
      } catch (err) {
        console.warn("[PuterProvider] Puter script not ready during refresh:", err);
        return this.session;
      }
    }

    try {
      // Check if still signed in
      const isSignedIn = window.puter.auth?.isSignedIn
        ? window.puter.auth.isSignedIn()
        : false;

      if (!isSignedIn) {
        // Only mark unauthenticated if window.puter explicitly said false
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
      const user = await window.puter.auth.getUser().catch(() => null);
      this.session.authenticated = true;
      this.session.email = user?.email || this.session.email;
      this.session.expiresAt = Date.now() + SESSION_TTL_MS;
      this.session.models = PUTER_MODELS;

      // ROLL THE ACTIVE ACCOUNT'S EXPIRY TOO. The session is rebuilt from
      // the account record on every page load (syncActiveAccountToSession),
      // so a stale account.expiresAt made every refresh see "expired" again
      // and could permanently mark a still-valid account as expired.
      const activeAccount = this.accounts.find((a) => a.active);
      if (activeAccount) {
        activeAccount.expiresAt = this.session.expiresAt;
        if (activeAccount.status === "expired") activeAccount.status = "healthy";
        await this.saveAccounts();
      }

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
    // Deduplicate concurrent restores — the app bootstrap AND the AI
    // Providers module may both call restore() on mount; the account fetch
    // and the (possible) SDK load + refresh should only run once.
    if (!this.restorePromise) {
      this.restorePromise = this.restoreInner().finally(() => {
        this.restorePromise = null;
      });
    }
    return this.restorePromise;
  }

  private async restoreInner(): Promise<ProviderSession | null> {
    await this.loadAccounts();
    await this.syncActiveAccountToSession();
    
    if (!this.session.authenticated) {
      return null;
    }

    // Check if session is expired
    if (isSessionExpired(this.session)) {
      // The SDK must be loaded BEFORE refresh(): on a fresh page load
      // window.puter does not exist yet, and refresh() would throw
      // "Puter.js is not loaded" — which the old code treated as a dead
      // session and marked the (perfectly valid) account as expired.
      try {
        await loadPuterScript();
      } catch (scriptErr) {
        // Offline / script blocked — keep the restored accounts as-is and
        // let the first AI call surface the real error. Do NOT mark the
        // account expired: we simply could not verify it right now.
        console.warn("[PuterProvider] SDK unavailable during restore (offline?) — skipping refresh:", scriptErr instanceof Error ? scriptErr.message : scriptErr);
        return this.session;
      }
      // Try to refresh
      try {
        const refreshed = await this.refresh();
        console.log("[PROVIDER AUTH] session restored (refreshed)");
        return refreshed;
      } catch (err) {
        console.warn("[puterProvider] Session refresh failed:", err instanceof Error ? err.message : err);
        // Only mark active account as expired if Puter explicitly confirmed session expiration
        const active = this.accounts.find(a => a.active);
        if (active && (err as any)?.code === "session_expired") {
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
    /** Nucleus sampling (0-1). Phase 8.1.3.2A: accepted but Puter.js has no top_p knob. */
    topP?: number;
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

      const chatOpts: any = sanitizePuterChatOpts({
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
        ...(opts.model ? { model: opts.model } : {}),
      });

      try {
        // Wrap puter.ai.chat in a 30s timeout to prevent it hanging forever
        // when the WebSocket connection stalls or the server is overloaded.
        const PUTER_CALL_TIMEOUT_MS = 30_000;
        const callChat = (options: any) => {
          const chatPromise: Promise<any> = window.puter.ai.chat(messages, options);
          const timeoutPromise: Promise<never> = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Puter.ai.chat timed out after ${PUTER_CALL_TIMEOUT_MS / 1000}s`)), PUTER_CALL_TIMEOUT_MS)
          );
          return Promise.race([chatPromise, timeoutPromise]);
        };

        let resp: any;
        try {
          resp = await callChat(chatOpts);
        } catch (chatErr: any) {
          if (isPuterTemperatureError(chatErr) && "temperature" in chatOpts) {
            console.warn(`[Puter] Model ${opts.model || "default"} rejected temperature ${chatOpts.temperature}. Retrying without temperature.`);
            const retryOpts = { ...chatOpts };
            delete retryOpts.temperature;
            resp = await callChat(retryOpts);
          } else {
            throw chatErr;
          }
        }

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
        const msg = (e?.message || String(e ?? "")).toLowerCase();
        const isQuotaOrRateLimit =
          e?.statusCode === 429 ||
          e?.status === 429 ||
          /429/.test(msg) ||
          /no usage left/i.test(msg) ||
          /usage.?limit/i.test(msg) ||
          /quota/i.test(msg) ||
          /rate.?limit/i.test(msg) ||
          /daily.?limit/i.test(msg) ||
          /monthly.?limit/i.test(msg) ||
          /too many requests/i.test(msg) ||
          /insufficient.?credits?/i.test(msg) ||
          /credits?.?exhausted/i.test(msg) ||
          /usage.?exhausted/i.test(msg) ||
          /freeusagelimit/i.test(msg);

        if (isQuotaOrRateLimit) {
           console.log("[PUTER]\nRate limit or quota exhaustion detected:", msg);
           const active = this.accounts.find(a => a.active);
           if (active) {
             active.status = "rate_limited";
             // 1h cooldown before considering this account healthy again
             const baseCooldownMs = 60 * 60 * 1000;
             active.cooldownUntil = Date.now() + baseCooldownMs;
             await this.saveAccounts();
           }
           
           const rotated = await this.rotateToNextHealthyAccount();
           if (rotated) {
             attempts++;
             const nextActive = this.accounts.find(a => a.active);
             console.log(`[PUTER] Successfully auto-rotated to next account: ${nextActive?.email}`);
             if (typeof window !== "undefined") {
               window.dispatchEvent(new CustomEvent("puter:rotated", {
                 detail: {
                   fromEmail: active?.email,
                   toEmail: nextActive?.email,
                   reason: msg,
                 }
               }));
             }
             continue; // Retry with next account
           }
           // No healthy account found — break the loop and throw quota exhausted
           throw new ProviderAuthenticationError(
             "quota_exhausted",
             "All Puter accounts have exhausted their quota or reached rate limits. Please add another account or wait before retrying.",
             "puter"
           );
        }
        // Non-rate-limit error — propagate immediately
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

  /**
   * Proactively checks rate-limited Puter accounts with a lightweight check.
   * If quota has replenished, restores status to "healthy" automatically.
   */
  async probeRateLimitedAccounts(): Promise<number> {
    if (typeof window === "undefined" || !window.puter?.ai?.chat) return 0;
    const rateLimited = this.accounts.filter(a => a.status === "rate_limited");
    if (rateLimited.length === 0) return 0;

    let restored = 0;
    const currentActiveId = this.accounts.find(a => a.active)?.id;

    for (const acct of rateLimited) {
      try {
        if (acct.accessToken && typeof window.puter.setAuthToken === "function") {
          window.puter.setAuthToken(acct.accessToken);
        }
        // Lightweight probe
        await window.puter.ai.chat("ping", { model: "gpt-5-nano", test: true });
        acct.status = "healthy";
        acct.cooldownUntil = undefined;
        restored++;
      } catch (e: any) {
        // Still rate-limited or error; keep cooldown
      }
    }

    // Restore active account session
    if (currentActiveId) {
      const active = this.accounts.find(a => a.id === currentActiveId);
      if (active?.accessToken && typeof window.puter?.setAuthToken === "function") {
        window.puter.setAuthToken(active.accessToken);
      }
    }

    if (restored > 0) {
      await this.saveAccounts();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("puter:status_change", { detail: { restored } }));
      }
    }

    return restored;
  }

  // Private helpers
  private async extractAccessToken(): Promise<string | null> {
    try {
      if (typeof window !== "undefined") {
        if (window.puter?.auth?.getUser) {
          const user = await window.puter.auth.getUser().catch(() => null);
          if (user?.token || user?.accessToken) return user.token || user.accessToken;
        }
        if ((window.puter as any)?.authToken) return (window.puter as any).authToken;
        if ((window.puter as any)?.token) return (window.puter as any).token;
        if ((window.puter as any)?.auth?.token) return (window.puter as any).auth.token;
        if ((window.puter as any)?.auth?.authToken) return (window.puter as any).auth.authToken;
        const storedToken =
          localStorage.getItem("puter.auth.token") ||
          localStorage.getItem("puter_auth_token") ||
          localStorage.getItem("puter-auth-token") ||
          localStorage.getItem("token");
        if (storedToken) return storedToken;
      }
    } catch (err) {
      console.warn("[puterProvider] Token extraction failed:", err instanceof Error ? err.message : err);
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
