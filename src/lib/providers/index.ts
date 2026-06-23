// ResumeAI Pro — Provider Auth Barrel Exports
// Unified access to the OAuth provider system.

export type { OAuthAIProvider, ProviderSession, ProviderAuthStatus, ProviderAuthError } from "./interface";
export { ProviderAuthenticationError, createEmptySession } from "./interface";
export { getPuterProvider, PuterProvider } from "./puter-provider";
export { getZaiProvider, ZaiProvider } from "./zai-provider";
export { saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon, getAllSessions } from "./session-manager";

import type { ProviderSession } from "./interface";
import { getPuterProvider } from "./puter-provider";
import { getZaiProvider } from "./zai-provider";

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

  // Restore Z.ai session
  try {
    const zaiProvider = getZaiProvider();
    const zaiSession = await zaiProvider.restore();
    if (zaiSession) sessions.push(zaiSession);
  } catch (e: any) {
    console.warn("[Provider Auth] Z.ai session restore failed:", e?.message);
  }

  return sessions;
}

/**
 * Check if ANY provider is authenticated.
 * Used by the AI routing pipeline to determine if we can
 * proceed with AI requests.
 */
export function isAnyProviderAuthenticated(): boolean {
  const puterProvider = getPuterProvider();
  const zaiProvider = getZaiProvider();
  return puterProvider.isAuthenticated() || zaiProvider.isAuthenticated();
}

/**
 * Get the authenticated provider for AI requests.
 * Returns the first authenticated provider in priority order,
 * or null if none are authenticated.
 */
export function getAuthenticatedProvider(): { provider: "puter" | "zai-direct"; generate: (opts: any) => Promise<{ text: string; provider: string; latencyMs: number }> } | null {
  // Check Z.ai first (it's an API provider — preferred for document tasks)
  const zaiProvider = getZaiProvider();
  if (zaiProvider.isAuthenticated()) {
    return { provider: "zai-direct", generate: (opts) => zaiProvider.generate(opts) };
  }

  // Then check Puter (browser-auth — works but may need popup)
  const puterProvider = getPuterProvider();
  if (puterProvider.isAuthenticated()) {
    return { provider: "puter", generate: (opts) => puterProvider.generate(opts) };
  }

  return null;
}
