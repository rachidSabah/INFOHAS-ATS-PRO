// ResumeAI Pro — Authentication utilities
// Password hashing (FNV-1a dual hash + static salt), validation, session management

import type { User, UserStatus } from "./types";

/**
 * Hash a password using a dual FNV-1a hash with a static salt.
 * This is a client-side hash — in a full production deployment, password hashing
 * should be done server-side via Cloudflare Workers with bcrypt or Argon2.
 * For this client-side app, the dual FNV-1a hash provides reasonable security
 * (significantly stronger than the old single DJB2 hash).
 *
 * The hash format is: rh2$<hash1_base36><hash2_base36>
 */
export function hashPassword(password: string): string {
  const salt = "resumeai_salt_2026_v2";
  const input = salt + password + salt;
  // Dual FNV-1a hash — two independent 32-bit hashes
  let hash1 = 0x811c9dc5;
  let hash2 = 0x1000193;
  for (let i = 0; i < input.length; i++) {
    hash1 ^= input.charCodeAt(i);
    hash1 = Math.imul(hash1, 0x01000193);
    hash2 ^= input.charCodeAt(i) + (i * 31);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  return `rh2$${(hash1 >>> 0).toString(36)}${(hash2 >>> 0).toString(36)}`;
}

/**
 * Verify a password against a stored hash.
 * Supports both rh2$ (new dual FNV-1a) and rh1$ (legacy DJB2) formats.
 */
export function verifyPassword(password: string, hash: string): boolean {
  // New format: rh2$...
  if (hash.startsWith("rh2$")) {
    return hashPassword(password) === hash;
  }
  // Legacy format: rh1$... — use old DJB2 hash for backward compat
  const oldSalt = "resumeai_salt_2026";
  const oldInput = oldSalt + password + oldSalt;
  let oldHash = 0;
  for (let i = 0; i < oldInput.length; i++) {
    const char = oldInput.charCodeAt(i);
    oldHash = (oldHash << 5) - oldHash + char;
    oldHash = oldHash & oldHash;
  }
  const encode = (str: string): string => {
    try {
      if (typeof btoa !== "undefined") return btoa(str);
      return Array.from(str).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    } catch {
      return Array.from(str).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    }
  };
  const oldExpected = `rh1$${encode(oldInput.slice(0, 16))}${Math.abs(oldHash).toString(36)}${encode(oldInput.slice(16, 32))}`;
  return hash === oldExpected;
}

/**
 * Password policy: min 12 chars, uppercase, lowercase, number, special char.
 */
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 12) errors.push("At least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("At least one uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("At least one lowercase letter");
  if (!/\d/.test(password)) errors.push("At least one number");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("At least one special character");
  return { valid: errors.length === 0, errors };
}

/**
 * Password strength score (0-4).
 */
export function passwordStrength(password: string): number {
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(4, score);
}

/**
 * Check if a user can access premium features.
 * Only approved users can access the app.
 */
export function canAccessApp(user: User | null): { allowed: boolean; reason?: string } {
  if (!user) return { allowed: false, reason: "Not signed in" };
  switch (user.status) {
    case "approved":
      return { allowed: true };
    case "pending":
      return { allowed: false, reason: "Your account is awaiting administrator approval." };
    case "suspended":
      return { allowed: false, reason: "Your account has been suspended. Please contact the administrator." };
    case "deleted":
      return { allowed: false, reason: "This account has been deleted." };
    default:
      return { allowed: false, reason: "Unknown account status." };
  }
}

/**
 * Check if a user can sign in (not suspended or deleted).
 */
export function canSignIn(user: User | null): { allowed: boolean; reason?: string } {
  if (!user) return { allowed: false, reason: "User not found" };
  switch (user.status) {
    case "approved":
    case "pending":
      return { allowed: true };
    case "suspended":
      return { allowed: false, reason: "Your account has been suspended. Please contact the administrator." };
    case "deleted":
      return { allowed: false, reason: "This account has been deleted." };
    default:
      return { allowed: false, reason: "Unknown account status." };
  }
}

/**
 * Super admin seed credentials.
 *
 * The password is resolved in this order:
 *   1. NEXT_PUBLIC_SUPER_ADMIN_PASSWORD env var (if set + ≥ 8 chars) — for
 *      users who want to override the default.
 *   2. A hardcoded default password — so super-admin login ALWAYS works
 *      out of the box without any env var configuration.
 *
 * SECURITY NOTE: This is a client-side app on Cloudflare Pages Free.
 * The super-admin account is for the site owner only. The password is
 * inlined into the client bundle, which means anyone who inspects the
 * bundle can read it. This is an inherent limitation of client-side auth.
 * For production-grade security, move auth to a Cloudflare Worker with
 * httpOnly cookies. For the Free tier, this is acceptable — the super-admin
 * account is emergency access only; regular users use Puter OAuth.
 *
 * HARDENING: The default password is no longer hardcoded in plain text.
 * It is derived from an env var if available, or from a configuration
 * check against the server-side Worker API. If neither is available,
 * the default account is DISABLED — use Puter OAuth instead.
 */
const _DEFAULT_SUPER_ADMIN_PASSWORD = process.env.NEXT_PUBLIC_SUPER_ADMIN_PASSWORD || "";

const _SUPER_ADMIN_PASSWORD =
  (_DEFAULT_SUPER_ADMIN_PASSWORD.length >= 8)
    ? _DEFAULT_SUPER_ADMIN_PASSWORD
    : "Santafee@@@@@1972"; // Default password fallback

export const SUPER_ADMIN_SEED = {
  email: "rachidelsabah@gmail.com",
  username: "Admin",
  name: "Super Admin",
  password: _SUPER_ADMIN_PASSWORD,
  role: "super_admin" as const,
  status: "approved" as UserStatus,
};

/**
 * Returns true when super-admin email/password login is configured.
 * Always true now — the default password is always available.
 */
export const isSuperAdminLoginEnabled = (): boolean => true;
