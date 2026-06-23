// ResumeAI Pro — OAuth AI Provider Interface
// Common abstraction for all OAuth-capable AI providers.
// PuterProvider and ZaiProvider implement this interface,
// making future additions (OpenCode Auth, Claude Web, etc.) trivial.

export interface ProviderSession {
  provider: "puter" | "zai-direct";
  authenticated: boolean;
  email: string | null;
  userId: string | null;
  /** Encrypted access token — never stored in plain text */
  accessToken: string | null;
  /** Encrypted refresh token — never stored in plain text */
  refreshToken: string | null;
  /** Token expiry timestamp (epoch ms) */
  expiresAt: number | null;
  /** When this session was first established */
  connectedAt: number | null;
  /** Available models for this provider */
  models: string[];
  /** Whether this is a shared admin account for all users */
  sharedAdminAccount: boolean;
}

export interface ProviderAuthStatus {
  connected: boolean;
  authenticated: boolean;
  email: string | null;
  expiresAt: number | null;
  models: string[];
  sharedAdminAccount: boolean;
}

export interface ProviderAuthError {
  code: "auth_required" | "session_expired" | "refresh_failed" | "login_failed" | "not_configured";
  message: string;
  provider: string;
}

/**
 * Common interface for all OAuth AI providers.
 * Each provider (Puter, Z.ai, etc.) implements this interface.
 */
export interface OAuthAIProvider {
  /** Unique provider identifier */
  readonly id: "puter" | "zai-direct";
  /** Human-readable provider name */
  readonly name: string;

  /**
   * Authenticate with the provider.
   * Opens OAuth flow (popup/redirect) or validates stored credentials.
   * On success, persists the session via SessionManager.
   */
  login(): Promise<ProviderSession>;

  /**
   * Refresh the current session using the stored refresh token.
   * If refresh fails, the session is marked as unauthenticated.
   */
  refresh(): Promise<ProviderSession>;

  /**
   * Disconnect from the provider.
   * Clears the stored session and marks the provider as unauthenticated.
   */
  logout(): Promise<void>;

  /**
   * Restore a previously stored session on app startup.
   * Checks expiry and attempts refresh if needed.
   */
  restore(): Promise<ProviderSession | null>;

  /**
   * List available models for this provider.
   * Only works when authenticated.
   */
  listModels(): Promise<string[]>;

  /**
   * Generate a completion using this provider.
   * MUST check authentication before execution.
   * Throws ProviderAuthError if not authenticated.
   */
  generate(opts: {
    systemPrompt?: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<{ text: string; provider: string; latencyMs: number }>;

  /**
   * Get the current authentication status.
   */
  getStatus(): ProviderAuthStatus;

  /**
   * Check if the provider is currently authenticated.
   */
  isAuthenticated(): boolean;
}

/**
 * Error class for provider authentication failures.
 * These errors MUST NOT be silently caught — they must surface
 * to the user as "Authentication required."
 */
export class ProviderAuthenticationError extends Error {
  public readonly code: ProviderAuthError["code"];
  public readonly provider: string;

  constructor(code: ProviderAuthError["code"], message: string, provider: string) {
    super(message);
    this.name = "ProviderAuthenticationError";
    this.code = code;
    this.provider = provider;
  }

  toJSON(): ProviderAuthError {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
    };
  }
}

/**
 * Create an empty/default session for a provider.
 */
export function createEmptySession(provider: ProviderSession["provider"]): ProviderSession {
  return {
    provider,
    authenticated: false,
    email: null,
    userId: null,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    connectedAt: null,
    models: [],
    sharedAdminAccount: false,
  };
}
