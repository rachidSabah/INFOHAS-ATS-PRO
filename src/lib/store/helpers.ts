// ============================================================================
// Zustand Store Helpers & Seeds
// ============================================================================

"use client";

import type { User, JobDescription } from "../types";
import { hashPassword } from "../auth-utils";
import { SUPER_ADMIN_SEED } from "../auth-utils";
import { setUserId } from "../cloud-api";

export const SESSION_KEY = "resumeai-session";

export const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

export function normalizeJD<T extends Record<string, any>>(jd: T): T {
  if (!jd || typeof jd !== "object") return jd;
  const toArray = (v: any): any[] => Array.isArray(v) ? v : [];
  const toStr = (v: any): string | undefined => (v === null || v === undefined) ? undefined : String(v);
  return {
    ...jd,
    id: jd.id || uid("jd"),
    title: typeof jd.title === "string" ? jd.title : (jd.title ? String(jd.title) : "Untitled role"),
    company: toStr(jd.company),
    location: toStr(jd.location),
    employmentType: toStr(jd.employmentType),
    salary: toStr(jd.salary),
    experienceYears: toStr(jd.experienceYears),
    education: toStr(jd.education),
    rawText: toStr(jd.rawText),
    url: toStr(jd.url),
    source: typeof jd.source === "string" ? jd.source : "text",
    createdAt: jd.createdAt || new Date().toISOString(),
    responsibilities: toArray(jd.responsibilities),
    requiredSkills: toArray(jd.requiredSkills),
    preferredSkills: toArray(jd.preferredSkills),
    technologies: toArray(jd.technologies),
    keywords: toArray(jd.keywords),
  } as T;
}

export function persistSession(user: User) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      user,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }));
  } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
}

export function restoreSession(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.expiresAt && Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    if (session.user && session.user.id) {
      return session.user as User;
    }
    return null;
  } catch (sessionErr) {
    console.warn("[store] Session restore failed:", sessionErr);
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
}

export const _restoredUser = restoreSession();
if (_restoredUser && typeof window !== "undefined") {
  try { setUserId(_restoredUser.id); } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
}
export const _hasPendingRehydration = !!_restoredUser;

export const INITIAL_SUPER_ADMIN: User = {
  id: "u_superadmin",
  name: SUPER_ADMIN_SEED.name,
  username: SUPER_ADMIN_SEED.username,
  email: SUPER_ADMIN_SEED.email,
  passwordHash: hashPassword(SUPER_ADMIN_SEED.password),
  role: "super_admin",
  status: "approved",
  provider: "email",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  lastLoginAt: undefined,
  usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
};
