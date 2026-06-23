// ResumeAI Pro — Google OAuth Helper
// Uses Google Identity Services (GIS) for popup-based sign-in.
// This allows Z.ai to offer "Sign in with Google" like Puter does.
//
// Flow:
// 1. Load GIS library from accounts.google.com/gsi/client
// 2. Initialize token client with our client_id
// 3. On user gesture, request access token (popup)
// 4. Exchange access token for user info (email, sub, name)
// 5. Associate Google identity with Z.ai API key
//
// Requirements:
// - NEXT_PUBLIC_GOOGLE_CLIENT_ID must be set in environment

"use client";

// ============================================================================
// Types
// ============================================================================

export interface GoogleUserInfo {
  /** Google's unique user ID (sub claim) */
  sub: string;
  /** User's email */
  email: string;
  /** Whether email is verified */
  email_verified: boolean;
  /** User's display name */
  name: string;
  /** User's given name */
  given_name: string;
  /** User's family name */
  family_name: string;
  /** User's profile picture URL */
  picture: string;
  /** Locale */
  locale: string;
}

export interface GoogleOAuthResult {
  accessToken: string;
  userInfo: GoogleUserInfo;
}

// ============================================================================
// GIS Library Loader
// ============================================================================

let gisLoaded = false;
let gisLoadPromise: Promise<void> | null = null;

/**
 * Load the Google Identity Services library.
 * Returns a promise that resolves when the library is ready.
 */
export function loadGoogleGIS(): Promise<void> {
  if (gisLoaded && typeof window !== "undefined" && (window as any).google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Cannot load Google GIS in server environment"));
      return;
    }

    // Check if already loaded
    if ((window as any).google?.accounts?.oauth2) {
      gisLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      gisLoaded = true;
      resolve();
    };
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error("Failed to load Google Identity Services library"));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

// ============================================================================
// Google OAuth Sign-In
// ============================================================================

/**
 * Sign in with Google using the GIS popup flow.
 * Must be called from a user gesture (click handler) due to popup blockers.
 *
 * @param clientId Google OAuth 2.0 Client ID
 * @returns Google user info and access token
 */
export async function signInWithGoogle(clientId?: string): Promise<GoogleOAuthResult> {
  const actualClientId = clientId || getGoogleClientId();
  if (!actualClientId) {
    throw new Error(
      "Google OAuth is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in your environment variables.",
    );
  }

  // Load the GIS library
  await loadGoogleGIS();

  // Verify the library loaded
  if (!(window as any).google?.accounts?.oauth2) {
    throw new Error(
      "Google Identity Services library failed to load. Please check your network connection and ad blockers.",
    );
  }

  return new Promise<GoogleOAuthResult>((resolve, reject) => {
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: actualClientId,
      scope: "openid email profile",
      callback: async (response: any) => {
        if (response.error) {
          reject(new Error(`Google OAuth error: ${response.error} — ${response.error_description || ""}`));
          return;
        }

        const accessToken = response.access_token;
        if (!accessToken) {
          reject(new Error("Google OAuth did not return an access token"));
          return;
        }

        try {
          // Fetch user info using the access token
          const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000),
          });

          if (!userInfoRes.ok) {
            reject(new Error(`Failed to fetch Google user info (${userInfoRes.status})`));
            return;
          }

          const userInfo: GoogleUserInfo = await userInfoRes.json();

          if (!userInfo.sub || !userInfo.email) {
            reject(new Error("Google OAuth returned incomplete user info"));
            return;
          }

          resolve({ accessToken, userInfo });
        } catch (e: any) {
          reject(new Error(`Failed to get Google user info: ${e?.message || "Unknown error"}`));
        }
      },
      error_callback: (error: any) => {
        reject(new Error(`Google OAuth failed: ${error?.message || error?.type || "Unknown error"}`));
      },
    });

    // This opens the popup — MUST be called from a user gesture
    tokenClient.requestAccessToken();
  });
}

// ============================================================================
// Google ID Token Verification (server-side)
// ============================================================================

/**
 * Verify a Google ID token server-side.
 * Called from an API route to validate the token before trusting it.
 * Uses Google's public tokeninfo endpoint (no Google SDK needed).
 */
export async function verifyGoogleTokenServerSide(
  idToken: string,
  expectedClientId: string,
): Promise<GoogleUserInfo | null> {
  try {
    // Use Google's tokeninfo endpoint to verify the token
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!res.ok) return null;

    const payload = await res.json();

    // Verify the audience matches our client ID
    if (payload.aud !== expectedClientId) {
      console.warn("[Google OAuth] Token audience mismatch:", payload.aud, "≠", expectedClientId);
      return null;
    }

    // Verify token is not expired
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      console.warn("[Google OAuth] Token expired");
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified,
      name: payload.name || "",
      given_name: payload.given_name || "",
      family_name: payload.family_name || "",
      picture: payload.picture || "",
      locale: payload.locale || "en",
    };
  } catch (e) {
    console.warn("[Google OAuth] Token verification failed:", e);
    return null;
  }
}

// ============================================================================
// Environment & Config
// ============================================================================

/**
 * Get the Google OAuth Client ID from environment.
 */
export function getGoogleClientId(): string | null {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  }
  return null;
}

/**
 * Check if Google OAuth is configured.
 */
export function isGoogleOAuthConfigured(): boolean {
  return !!getGoogleClientId();
}
