// ============================================================================
// AuthManager — API keys, OAuth, Puter, token management, encrypted storage
// ============================================================================

import type { AuthCredentials, AuthStatus, ProviderConfig } from "./types";

export interface StoredCredentials {
  providerId: string;
  credentials: AuthCredentials;
  label?: string;
}

/**
 * AuthManager — unified authentication for all AI providers.
 *
 * Supports:
 * - API keys (Bearer token, header, query param)
 * - OAuth 2.0 (Authorization Code, Device Flow)
 * - Puter.js (authenticated and anonymous)
 * - No-auth (local engine, custom providers with authType=none)
 *
 * Credentials are stored in memory during the session.
 * Persistence is delegated to the app's D1/KV storage layer.
 */
export class AuthManager {
  private credentials = new Map<string, AuthCredentials>();
  private statuses = new Map<string, AuthStatus>();

  // ── Store / Retrieve ─────────────────────────────────────────────────

  /**
   * Store credentials for a provider.
   */
  store(providerId: string, credentials: AuthCredentials): void {
    this.credentials.set(providerId, credentials);
    this.statuses.set(providerId, {
      authenticated: this.isAuthenticated(credentials),
      expiresAt: credentials.expiresAt,
      needsRefresh: this.needsRefresh(credentials),
    });
  }

  /**
   * Get stored credentials for a provider.
   */
  get(providerId: string): AuthCredentials | undefined {
    return this.credentials.get(providerId);
  }

  /**
   * Remove credentials for a provider (logout).
   */
  remove(providerId: string): void {
    this.credentials.delete(providerId);
    this.statuses.delete(providerId);
  }

  /**
   * Check if a provider has valid credentials.
   */
  hasValidCredentials(providerId: string): boolean {
    const creds = this.credentials.get(providerId);
    if (!creds) return false;
    if (!this.isAuthenticated(creds)) return false;
    if (this.isExpired(creds)) return false;
    return true;
  }

  /**
   * Get the auth status for a provider.
   */
  getStatus(providerId: string): AuthStatus {
    return (
      this.statuses.get(providerId) ?? {
        authenticated: false,
        needsRefresh: false,
      }
    );
  }

  // ── Auth Header Builder ──────────────────────────────────────────────

  /**
   * Build the authorization headers for an API call.
   */
  buildHeaders(providerId: string): Record<string, string> {
    const creds = this.credentials.get(providerId);
    if (!creds) return {};

    switch (creds.type) {
      case "api-key":
        return { Authorization: `Bearer ${creds.apiKey || ""}` };
      case "oauth":
        return { Authorization: `Bearer ${creds.accessToken || ""}` };
      case "device-flow":
        return { Authorization: `Bearer ${creds.accessToken || ""}` };
      case "puter-auth":
      case "puter-anon":
      case "none":
        return {};
      default:
        return {};
    }
  }

  // ── Refresh Token Management ─────────────────────────────────────────

  /**
   * Check if a provider's token needs refreshing.
   */
  needsRefresh(credentials: AuthCredentials): boolean {
    if (!credentials.expiresAt) return false;
    // Refresh if within 5 minutes of expiry
    return Date.now() > credentials.expiresAt - 5 * 60 * 1000;
  }

  /**
   * Update the access token after a refresh.
   */
  updateToken(providerId: string, accessToken: string, expiresAt?: number): void {
    const creds = this.credentials.get(providerId);
    if (!creds) return;
    creds.accessToken = accessToken;
    if (expiresAt) creds.expiresAt = expiresAt;
    this.store(providerId, creds);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private isAuthenticated(credentials: AuthCredentials): boolean {
    switch (credentials.type) {
      case "api-key":
        return !!credentials.apiKey && credentials.apiKey.trim().length > 0;
      case "oauth":
      case "device-flow":
        return !!credentials.accessToken;
      case "puter-auth":
        return true; // Puter handles its own auth via window.puter
      case "puter-anon":
      case "none":
        return true;
      default:
        return false;
    }
  }

  private isExpired(credentials: AuthCredentials): boolean {
    if (!credentials.expiresAt) return false;
    return Date.now() > credentials.expiresAt;
  }

  // ── Bulk Operations ──────────────────────────────────────────────────

  /**
   * Initialize auth for all providers from config.
   */
  initializeFromConfig(configs: ProviderConfig[]): void {
    for (const config of configs) {
      this.store(config.id, config.auth);
    }
  }

  /**
   * Get all providers with valid credentials.
   */
  getAuthenticatedProviders(): string[] {
    const result: string[] = [];
    for (const [id] of this.credentials) {
      if (this.hasValidCredentials(id)) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * Clear all stored credentials.
   */
  clearAll(): void {
    this.credentials.clear();
    this.statuses.clear();
  }
}
