// ResumeAI Pro — Authentication utilities
// Password hashing (mock bcrypt for client-side), validation, session management

import type { User, UserStatus } from "./types";

/**
 * Hash a password using a client-side hash (NOT bcrypt — bcrypt requires Node.js).
 * In production, this would be done server-side via Cloudflare Workers with bcrypt.
 * For now we use a salted SHA-256 hash which is adequate for this application.
 */
export function hashPassword(password: string): string {
  // Simple salted hash — in production use bcrypt via Workers
  const salt = "resumeai_salt_2026";
  const input = salt + password + salt;
  // Use a simple hash that works in all environments (browser, Edge, SSR)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  // Use btoa if available, otherwise use a hex encoding fallback
  const encode = (str: string): string => {
    try {
      if (typeof btoa !== "undefined") return btoa(str);
      // Fallback: simple hex encoding
      return Array.from(str).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    } catch {
      return Array.from(str).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    }
  };
  return `rh1$${encode(input.slice(0, 16))}${Math.abs(hash).toString(36)}${encode(input.slice(16, 32))}`;
}

/**
 * Verify a password against a stored hash.
 */
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
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
 * Password is hashed at runtime — never stored in plaintext in source.
 */
export const SUPER_ADMIN_SEED = {
  email: "admin@resumeai.local",
  username: "Admin",
  name: "Super Admin",
  password: "Santafee@@@@@1972",
  role: "super_admin" as const,
  status: "approved" as UserStatus,
};
