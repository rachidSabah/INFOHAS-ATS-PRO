// ResumeAI Pro — Provider Auth Barrel Exports
// Unified access to the OAuth provider system.

export type { OAuthAIProvider, ProviderSession, ProviderAuthStatus, ProviderAuthError } from "./interface";
export { ProviderAuthenticationError, createEmptySession } from "./interface";
export { getPuterProvider, PuterProvider } from "./puter-provider";

export { isGoogleOAuthConfigured, getGoogleClientId, signInWithGoogle } from "./google-oauth";
export type { GoogleUserInfo, GoogleOAuthResult } from "./google-oauth";
export { saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon, getAllSessions } from "./session-manager";

import type { ProviderSession } from "./interface";
import { getPuterProvider } from "./puter-provider";


/**
 * Restore all provider sessions on app startup.
 * Called once from the app initialization.
 */
export async function restoreAllProviderSessions(): Promise<ProviderSession[]> {
  const sessions: ProviderSession[] = [];

  // Restore Puter session
  try {
    const puterProvider = getPuterProvider();
    const puterSession = await puterProvider.restore();
    if (puterSession) sessions.push(puterSession);
  } catch (e: any) {
    console.warn("[Provider Auth] Puter session restore failed:", e?.message);
  }

  return sessions;
}

/**
 * Check if ANY provider is authenticated.
 * Uses tryRefresh() to handle expired sessions correctly (no TOCTOU race).
 * NOTE: This is async because tryRefresh() may need to make API calls.
 */
export async function isAnyProviderAuthenticated(): Promise<boolean> {
  const puterProvider = getPuterProvider();
  // Try refresh first — if session is expired, tryRefresh will attempt to renew it
  return await puterProvider.tryRefresh();
}

/**
 * Synchronous check — returns last known auth state without refresh.
 * Use when you just need a quick UI indicator and don't want to trigger API calls.
 */
export function isAnyProviderAuthenticatedSync(): boolean {
  const puterProvider = getPuterProvider();
  return puterProvider.isAuthenticated();
}

/**
 * Get the authenticated provider for AI requests.
 * Returns the first authenticated provider in priority order,
 * or null if none are authenticated.
 * Uses tryRefresh() to handle expired sessions.
 */
export async function getAuthenticatedProvider(): Promise<{ provider: "puter"; generate: (opts: any) => Promise<{ text: string; provider: string; latencyMs: number }> } | null> {
  // Then check Puter (browser-auth — works but may need popup)
  const puterProvider = getPuterProvider();
  if (await puterProvider.tryRefresh()) {
    return { provider: "puter", generate: (opts) => puterProvider.generate(opts) };
  }

  return null;
}
