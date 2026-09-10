// ============================================================================
// Zustand Store — Auth Domain Slice
// ============================================================================

"use client";

import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type { User, UserStatus as US, Role } from "../types";
import {
  persistSession, clearSession, restoreSession, uid, INITIAL_SUPER_ADMIN
} from "./helpers";
import {
  hashPassword, verifyPassword, canSignIn, validatePassword
} from "../auth-utils";
import { getRoleForEmail } from "../brand";
import {
  setUserId, clearUserId, api as cloudApi, cloudApiSafe, userScopedKey
} from "../cloud-api";
import { ensurePuterLoaded } from "../puter-loader";

/**
 * Privacy barrier for identity switches: wipes the previous account's
 * in-memory business data so a new sign-in NEVER starts from another user's
 * session state. The signed-in user's own cloud sync (syncAllFromCloud) then
 * repopulates the store. Crash-recovery backups on disk are user-scoped
 * (userScopedKey), so a different user's backup can never be restored here.
 */
function resetUserDataForSignIn(set: (partial: Partial<AppState>) => void) {
  set({
    resumes: [],
    jobDescriptions: [],
    coverLetters: [],
    interviews: [],
    interviewSessions: [],
    atsReports: [],
    reviewReports: [],
    careerMaterials: [],
    applications: [],
    activeResumeId: null,
    activeJdId: null,
    activeCoverLetterId: null,
    activeInterviewId: null,
    synced: false,
  } as Partial<AppState>);
}

const { createUser, updateUser } = cloudApi;

export interface AuthSlice {
  user: User | null;
  isAuthed: boolean;
  authOpen: boolean;
  users: User[];

  rehydrateSession: () => void;
  openAuth: () => void;
  closeAuth: () => void;
  signIn: (user: User) => void;
  signOut: () => void;
  signInWithEmail: (email: string, password: string) => { ok: boolean; error?: string; user?: User };
  registerWithEmail: (email: string, password: string, name: string, username?: string) => { ok: boolean; error?: string; user?: User };
  /** Super-admin manual user creation from User Management (no self sign-in). */
  adminCreateUser: (input: {
    name: string;
    email: string;
    username?: string;
    password: string;
    role: Role;
    status: "approved" | "pending" | "suspended";
  }) => { ok: boolean; error?: string; user?: User };
  signInWithPuter: () => Promise<{ ok: boolean; error?: string; user?: User }>;
  reconcileRole: () => void;
  approveUser: (userId: string) => void;
  suspendUser: (userId: string) => void;
  unsuspendUser: (userId: string) => void;
  deleteUser: (userId: string) => void;
  promoteToAdmin: (userId: string) => void;
  demoteToUser: (userId: string) => void;
  resetUserPassword: (userId: string, newPassword: string) => void;
  updateUserStatus: (userId: string, status: US) => void;
  updateUserName: (newName: string) => void;
  updateUserEmail: (newEmail: string) => void;
  changePassword: (currentPassword: string, newPassword: string) => { ok: boolean; error?: string };
}

export const createAuthSlice: StateCreator<AppState, [], [], AuthSlice> = (set, get) => ({
  user: null,
  isAuthed: false,
  authOpen: false,
  users: [INITIAL_SUPER_ADMIN],

  rehydrateSession: () => {
    const restored = restoreSession();
    if (restored) {
      if (typeof document !== "undefined") {
        const savedTheme = localStorage.getItem("resumeai-theme");
        if (savedTheme === "dark") document.documentElement.classList.add("dark");
      }
      let restoredReports: any[] = [];
      try {
        restoredReports = JSON.parse(localStorage.getItem(userScopedKey("resumeai-review-reports-backup")) || "[]");
      } catch (parseErr) {
        console.warn("[store] Review reports backup parse failed:", parseErr);
        restoredReports = [];
      }
      const savedTheme = (typeof localStorage !== "undefined" && localStorage.getItem("resumeai-theme") === "dark") ? "dark" as const : "light" as const;
      set({
        user: restored,
        isAuthed: true,
        view: "dashboard",
        theme: savedTheme,
        reviewReports: restoredReports,
        _needsRehydrate: false,
      });
      get().fetchCareerMaterials();
    } else {
      set({ _needsRehydrate: false });
    }
  },
  openAuth: () => set({ authOpen: true }),
  closeAuth: () => set({ authOpen: false }),

  signIn: (user) => {
    const check = canSignIn(user);
    if (!check.allowed) return;
    const now = new Date().toISOString();
    const updatedUser = { ...user, lastLoginAt: now, lastActiveAt: now };
    setUserId(updatedUser.id);
    persistSession(updatedUser);
    get().fetchCareerMaterials();
    resetUserDataForSignIn(set);
    set((s) => {
      const exists = s.users.find((u) => u.email === user.email);
      const users = exists
        ? s.users.map((u) => (u.email === user.email ? { ...u, ...updatedUser } : u))
        : [...s.users, updatedUser];
      return { users, user: updatedUser, isAuthed: true, authOpen: false, view: "dashboard", synced: false };
    });
    get().log({ actor: user.email, action: "User signed in", category: "auth", details: `Provider: ${user.provider}`, severity: "info" });
  },

  signOut: () => {
    const s = get();
    if (s.user) {
      get().log({ actor: s.user.email, action: "User signed out", category: "auth", details: "", severity: "info" });
    }
    clearUserId();
    clearSession();
    try {
      import("../agents/supervisor").then(({ resetSupervisor }) => resetSupervisor());
    } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    set({
      user: null,
      isAuthed: false,
      view: "landing",
      synced: false,
      activeResumeId: null,
      activeJdId: null,
      activeCoverLetterId: null,
      activeInterviewId: null,
      careerMaterials: [],
      // Privacy: the signed-out browser must not retain any account's business
      // data in memory. Backups on disk are user-scoped (userScopedKey), so a
      // future sign-in cannot restore someone else's data either.
      resumes: [],
      jobDescriptions: [],
      coverLetters: [],
      interviews: [],
      interviewSessions: [],
      atsReports: [],
      reviewReports: [],
      applications: [],
    });
  },

  signInWithEmail: (email, password) => {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = get().users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!existing) {
      return { ok: false, error: "No account found with this email. Please register first." };
    }
    if (existing.status === "suspended") {
      return { ok: false, error: "Your account has been suspended. Please contact the administrator." };
    }
    if (existing.status === "deleted") {
      return { ok: false, error: "This account has been deleted." };
    }
    if (!existing.passwordHash || !verifyPassword(password, existing.passwordHash)) {
      return { ok: false, error: "Incorrect password." };
    }
    const now = new Date().toISOString();
    const updatedUser = { ...existing, lastLoginAt: now, lastActiveAt: now };
    // Privacy: wipe any previous account's in-memory data BEFORE switching
    // identity — each signed-in user starts from a clean slate and their own
    // cloud sync repopulates the store (see syncAllFromCloud in page.tsx).
    resetUserDataForSignIn(set);
    setUserId(updatedUser.id);
    persistSession(updatedUser);
    set((s) => ({
      users: s.users.map((u) => (u.id === existing.id ? updatedUser : u)),
      user: updatedUser,
      isAuthed: true,
      authOpen: false,
      view: "dashboard",
      synced: false,
    }));
    get().log({ actor: normalizedEmail, action: "User signed in", category: "auth", details: "Provider: email", severity: "info" });
    return { ok: true, user: updatedUser };
  },

  registerWithEmail: (email, password, name, username) => {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = get().users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (existing) {
      return { ok: false, error: "An account with this email already exists. Please sign in." };
    }
    const now = new Date().toISOString();
    const newUser: User = {
      id: uid("u"),
      name: name.trim() || normalizedEmail.split("@")[0],
      username: username?.trim() || normalizedEmail.split("@")[0],
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      role: "user",
      status: "pending",
      provider: "email",
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      lastLoginAt: now,
      usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
    };
    set((s) => ({ users: [...s.users, newUser] }));
    cloudApiSafe(createUser)(newUser).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: normalizedEmail, action: "User registered (pending approval)", category: "auth", details: `Name: ${newUser.name}`, severity: "warning" });
    setUserId(newUser.id);
    persistSession(newUser);
    // Fresh account — make sure no previous session's data is visible.
    resetUserDataForSignIn(set);
    set({ user: newUser, isAuthed: true, authOpen: false, view: "dashboard", synced: false });
    return { ok: true, user: newUser };
  },

  /**
   * Admin-side manual user creation (User Management → Add User).
   * Unlike registerWithEmail this does NOT sign the new user in, does not
   * touch the current session, and lets the admin pick role + initial
   * status up front. The account row is synced to D1 via createUser, so
   * the person can sign in from any device immediately.
   */
  adminCreateUser: (input) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    if (get().users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      return { ok: false, error: "An account with this email already exists." };
    }
    const check = validatePassword(input.password);
    if (!check.valid) {
      return { ok: false, error: `Password requirements: ${check.errors.join(", ")}` };
    }
    const now = new Date().toISOString();
    const newUser: User = {
      id: uid("u"),
      name: input.name.trim() || normalizedEmail.split("@")[0],
      username: input.username?.trim() || normalizedEmail.split("@")[0],
      email: normalizedEmail,
      passwordHash: hashPassword(input.password),
      role: input.role,
      status: input.status,
      provider: "email",
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      // lastLoginAt stays unset — the table shows "Never" until their first sign-in.
      usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
    };
    set((s) => ({ users: [...s.users, newUser] }));
    cloudApiSafe(createUser)(newUser).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({
      actor: get().user?.email ?? "admin",
      action: "User created manually by admin",
      category: "admin",
      details: `${newUser.email} (role: ${newUser.role}, status: ${newUser.status})`,
      severity: "info",
    });
    return { ok: true, user: newUser };
  },

  signInWithPuter: async () => {
    if (typeof window === "undefined") {
      return { ok: false, error: "Puter sign-in requires a browser environment." };
    }
    // Puter.js is lazy-loaded (no eager SDK in layout), so on a first visit
    // window.puter does not exist yet. Load it on demand instead of failing —
    // the old code told users to "refresh and try again", but refreshing
    // never loaded the SDK either, so the button was dead on first use.
    if (!window.puter?.auth) {
      try {
        await ensurePuterLoaded("auth");
      } catch (loadErr) {
        console.warn("[store] Puter.js load failed:", loadErr);
        return { ok: false, error: "Couldn't load Puter.js — check your internet connection and try again." };
      }
    }
    if (!window.puter?.auth) {
      return { ok: false, error: "Puter.js is unavailable right now. Please try again in a moment." };
    }
    try {
      await window.puter.auth.signIn();
      const puterUser = await window.puter.auth.getUser();
      const puterEmail = puterUser?.email || puterUser?.username || "";
      const puterName = puterUser?.username || puterUser?.name || puterEmail.split("@")[0];

      if (!puterEmail) {
        return { ok: false, error: "Could not retrieve your email from Puter. Please try again." };
      }

      const existing = get().users.find((u) => u.email.toLowerCase() === puterEmail.toLowerCase());
      const now = new Date().toISOString();

      // Privacy: wipe any previous account's in-memory data BEFORE switching
      // identity — each signed-in user gets their own data only.
      resetUserDataForSignIn(set);

      if (existing) {
        if (existing.status === "suspended") {
          return { ok: false, error: "Your account has been suspended. Please contact the administrator." };
        }
        if (existing.status === "deleted") {
          return { ok: false, error: "This account has been deleted." };
        }
        const shouldAutoApprove = existing.provider === "puter" && existing.status === "pending";
        const reconciledRole = getRoleForEmail(puterEmail);
        const roleChanged = reconciledRole !== existing.role;
        const updatedUser = {
          ...existing,
          status: shouldAutoApprove ? ("approved" as const) : existing.status,
          role: reconciledRole as any,
          lastLoginAt: now,
          lastActiveAt: now,
          avatarUrl: puterUser?.photo || existing.avatarUrl,
          updatedAt: (shouldAutoApprove || roleChanged) ? now : existing.updatedAt,
        };
        setUserId(updatedUser.id);
        persistSession(updatedUser);
        set((s) => ({
          users: s.users.map((u) => (u.id === existing.id ? updatedUser : u)),
          user: updatedUser,
          isAuthed: true,
          authOpen: false,
          view: "dashboard",
          synced: false,
        }));
        cloudApiSafe(updateUser)(updatedUser.id, {
          lastLoginAt: updatedUser.lastLoginAt,
          status: updatedUser.status,
          role: updatedUser.role,
        }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
        if (shouldAutoApprove) {
          get().log({ actor: puterEmail, action: "Puter user auto-approved on sign-in", category: "auth", details: `Name: ${updatedUser.name}`, severity: "info" });
        } else {
          get().log({ actor: puterEmail, action: "User signed in", category: "auth", details: "Provider: puter", severity: "info" });
        }
        return { ok: true, user: updatedUser };
      } else {
        const newUser: User = {
          id: uid("u"),
          name: puterName,
          username: puterName,
          email: puterEmail,
          avatarUrl: puterUser?.photo || "",
          role: getRoleForEmail(puterEmail) as any,
          status: "approved",
          provider: "puter",
          createdAt: now,
          updatedAt: now,
          lastActiveAt: now,
          lastLoginAt: now,
          usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
        };
        setUserId(newUser.id);
        persistSession(newUser);
        set((s) => ({ users: [...s.users, newUser], user: newUser, isAuthed: true, authOpen: false, view: "dashboard", synced: false }));
        cloudApiSafe(createUser)(newUser).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
        get().log({ actor: puterEmail, action: "User registered via Puter (auto-approved)", category: "auth", details: `Name: ${newUser.name}`, severity: "info" });
        return { ok: true, user: newUser };
      }
    } catch (puterErr) {
      console.warn("[store] Puter sign-in failed:", puterErr);
      return { ok: false, error: "Puter sign-in was cancelled or failed." };
    }
  },

  reconcileRole: () => {},

  approveUser: (userId) => {
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status: "approved", updatedAt: new Date().toISOString() } : u)) }));
    cloudApiSafe(updateUser)(userId, { status: "approved" }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const u = get().users.find((x) => x.id === userId);
    get().log({ actor: get().user?.email ?? "admin", action: "User approved", category: "admin", details: u?.email ?? userId, severity: "info" });
  },
  suspendUser: (userId) => {
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status: "suspended", updatedAt: new Date().toISOString() } : u)) }));
    cloudApiSafe(updateUser)(userId, { status: "suspended" }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const u = get().users.find((x) => x.id === userId);
    get().log({ actor: get().user?.email ?? "admin", action: "User suspended", category: "admin", details: u?.email ?? userId, severity: "warning" });
  },
  unsuspendUser: (userId) => {
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status: "approved", updatedAt: new Date().toISOString() } : u)) }));
    cloudApiSafe(updateUser)(userId, { status: "approved" }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const u = get().users.find((x) => x.id === userId);
    get().log({ actor: get().user?.email ?? "admin", action: "User unsuspended", category: "admin", details: u?.email ?? userId, severity: "info" });
  },
  deleteUser: (userId) => {
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status: "deleted", updatedAt: new Date().toISOString() } : u)) }));
    cloudApiSafe(updateUser)(userId, { status: "deleted" }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const u = get().users.find((x) => x.id === userId);
    get().log({ actor: get().user?.email ?? "admin", action: "User deleted (soft)", category: "admin", details: u?.email ?? userId, severity: "error" });
  },
  promoteToAdmin: (userId) => {
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, role: "admin", updatedAt: new Date().toISOString() } : u)) }));
    cloudApiSafe(updateUser)(userId, { role: "admin" }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const u = get().users.find((x) => x.id === userId);
    get().log({ actor: get().user?.email ?? "admin", action: "User promoted to admin", category: "admin", details: u?.email ?? userId, severity: "info" });
  },
  demoteToUser: (userId) => {
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, role: "user", updatedAt: new Date().toISOString() } : u)) }));
    cloudApiSafe(updateUser)(userId, { role: "user" }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const u = get().users.find((x) => x.id === userId);
    get().log({ actor: get().user?.email ?? "admin", action: "User demoted to user", category: "admin", details: u?.email ?? userId, severity: "info" });
  },
  resetUserPassword: (userId, newPassword) => {
    const hash = hashPassword(newPassword);
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, passwordHash: hash, updatedAt: new Date().toISOString() } : u)) }));
    cloudApiSafe(updateUser)(userId, { passwordHash: hash }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const u = get().users.find((x) => x.id === userId);
    get().log({ actor: get().user?.email ?? "admin", action: "Password reset by admin", category: "admin", details: u?.email ?? userId, severity: "warning" });
  },
  updateUserStatus: (userId, status) => {
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status, updatedAt: new Date().toISOString() } : u)) }));
  },

  updateUserName: (newName) => {
    const trimmed = newName.trim();
    if (trimmed.length < 2) return;
    const userId = get().user?.id;
    set((s) => ({
      user: s.user ? { ...s.user, name: trimmed, lastActiveAt: new Date().toISOString() } : s.user,
      users: s.users.map((u) => (u.id === userId ? { ...u, name: trimmed, updatedAt: new Date().toISOString() } : u)),
    }));
    if (userId) cloudApiSafe(updateUser)(userId, { name: trimmed }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const updated = get().user;
    if (updated) persistSession(updated);
    get().log({ actor: "you", action: "Username updated", category: "auth", details: `New name: ${trimmed}`, severity: "info" });
  },

  updateUserEmail: (newEmail) => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return;
    const newRole = getRoleForEmail(trimmed);
    const userId = get().user?.id;
    set((s) => ({
      user: s.user ? { ...s.user, email: trimmed, role: newRole, lastActiveAt: new Date().toISOString() } : s.user,
      users: s.users.map((u) => (u.id === userId ? { ...u, email: trimmed, role: newRole, updatedAt: new Date().toISOString() } : u)),
    }));
    if (userId) cloudApiSafe(updateUser)(userId, { email: trimmed }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const updated = get().user;
    if (updated) persistSession(updated);
    get().log({ actor: "you", action: "Email updated", category: "auth", details: `New email: ${trimmed} (role: ${newRole})`, severity: "info" });
  },

  changePassword: (currentPassword, newPassword) => {
    const s = get();
    if (!s.user) return { ok: false, error: "Not signed in." };
    const userInList = s.users.find((u) => u.id === s.user!.id);
    const storedHash = userInList?.passwordHash ?? s.user.passwordHash;
    if (!storedHash || !verifyPassword(currentPassword, storedHash)) {
      return { ok: false, error: "Current password is incorrect." };
    }
    if (newPassword.length < 8) return { ok: false, error: "New password must be at least 8 characters." };
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) return { ok: false, error: "New password must contain letters and numbers." };
    if (newPassword === currentPassword) return { ok: false, error: "New password must differ from current." };
    const hash = hashPassword(newPassword);
    const userId = s.user.id;
    set({
      user: { ...s.user, passwordHash: hash, lastActiveAt: new Date().toISOString() },
      users: s.users.map((u) => (u.id === userId ? { ...u, passwordHash: hash, updatedAt: new Date().toISOString() } : u)),
    });
    cloudApiSafe(updateUser)(userId, { passwordHash: hash }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    const updated = get().user;
    if (updated) persistSession(updated);
    get().log({ actor: "you", action: "Password changed", category: "auth", details: "Password updated successfully", severity: "info" });
    return { ok: true };
  },
});
