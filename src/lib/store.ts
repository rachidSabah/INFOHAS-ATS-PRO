// ResumeAI Pro — global Zustand store with localStorage persistence
"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  User, ResumeData, JobDescription, AIProvider, AIProviderLog, AIProviderSettings, PromptTemplate,
  BrandingConfig, FeatureFlags, AuditLog, ViewKey, CoverLetter, InterviewPackage, ATSReport,
} from "./types";
import {
  SEED_USER, SEED_RESUMES, SEED_JDS, SEED_PROVIDERS, SEED_PROVIDER_LOGS, SEED_PROVIDER_SETTINGS,
  SEED_PROMPTS, SEED_BRANDING, SEED_FLAGS, SEED_LOGS, SEED_COVER_LETTERS, SEED_INTERVIEW, SEED_ATS_REPORTS,
} from "./mock-data";
import { BRAND, getRoleForEmail } from "./brand";
import { hashPassword, verifyPassword, SUPER_ADMIN_SEED, canSignIn, canAccessApp, type UserStatus } from "./auth-utils";
import type { UserStatus as US } from "./types";

interface AppState {
  // session
  user: User | null;
  isAuthed: boolean;
  authOpen: boolean;

  // user registry — all registered users (for admin management)
  users: User[];

  // navigation
  view: ViewKey;
  activeResumeId: string | null;
  activeJdId: string | null;
  activeCoverLetterId: string | null;
  activeInterviewId: string | null;
  landingSection: string | null;

  // collections
  resumes: ResumeData[];
  jobDescriptions: JobDescription[];
  coverLetters: CoverLetter[];
  interviews: InterviewPackage[];
  atsReports: ATSReport[];

  // admin
  providers: AIProvider[];
  providerLogs: AIProviderLog[];
  providerSettings: AIProviderSettings;
  prompts: PromptTemplate[];
  branding: BrandingConfig;
  flags: FeatureFlags;
  logs: AuditLog[];

  // ui
  theme: "light" | "dark";
  sidebarCollapsed: boolean;

  // actions
  setView: (v: ViewKey) => void;
  openAuth: () => void;
  closeAuth: () => void;
  signIn: (user: User) => void;
  signOut: () => void;
  // email/password auth
  signInWithEmail: (email: string, password: string) => { ok: boolean; error?: string; user?: User };
  registerWithEmail: (email: string, password: string, name: string, username?: string) => { ok: boolean; error?: string; user?: User };
  signInWithPuter: () => Promise<{ ok: boolean; error?: string; user?: User }>;
  // account self-service
  updateUserName: (newName: string) => void;
  updateUserEmail: (newEmail: string) => void;
  changePassword: (currentPassword: string, newPassword: string) => { ok: boolean; error?: string };
  /** Re-check the signed-in user's role against the email allowlist. Call on app load. */
  reconcileRole: () => void;
  toggleSidebar: () => void;
  setLandingSection: (s: string | null) => void;
  // admin user management
  approveUser: (userId: string) => void;
  suspendUser: (userId: string) => void;
  unsuspendUser: (userId: string) => void;
  deleteUser: (userId: string) => void;
  promoteToAdmin: (userId: string) => void;
  demoteToUser: (userId: string) => void;
  resetUserPassword: (userId: string, newPassword: string) => void;
  updateUserStatus: (userId: string, status: US) => void;

  // resumes
  addResume: (r: ResumeData) => void;
  updateResume: (id: string, patch: Partial<ResumeData>) => void;
  removeResume: (id: string) => void;
  setActiveResume: (id: string | null) => void;

  // jd
  addJD: (j: JobDescription) => void;
  removeJD: (id: string) => void;
  setActiveJD: (id: string | null) => void;

  // cover letters
  addCoverLetter: (c: CoverLetter) => void;
  updateCoverLetter: (id: string, patch: Partial<CoverLetter>) => void;
  removeCoverLetter: (id: string) => void;
  setActiveCoverLetter: (id: string | null) => void;

  // interviews
  addInterview: (i: InterviewPackage) => void;
  removeInterview: (id: string) => void;
  setActiveInterview: (id: string | null) => void;

  // ats
  addATSReport: (r: ATSReport) => void;

  // providers
  addProvider: (p: AIProvider) => void;
  updateProvider: (id: string, patch: Partial<AIProvider>) => void;
  removeProvider: (id: string) => void;
  duplicateProvider: (id: string) => string | null;
  setDefaultProvider: (id: string) => void;
  toggleFallback: (id: string) => void;
  reorderFallback: (id: string, direction: "up" | "down") => void;
  // provider logs
  addProviderLog: (l: AIProviderLog) => void;
  clearProviderLogs: (providerId?: string) => void;
  // provider settings
  updateProviderSettings: (patch: Partial<AIProviderSettings>) => void;

  // prompts
  addPrompt: (p: PromptTemplate) => void;
  updatePrompt: (id: string, patch: Partial<PromptTemplate>) => void;
  removePrompt: (id: string) => void;

  // branding & flags
  updateBranding: (patch: Partial<BrandingConfig>) => void;
  updateFlag: (k: keyof FeatureFlags, v: boolean) => void;

  // logs
  log: (entry: Omit<AuditLog, "id" | "timestamp">) => void;
  clearLogs: () => void;

  // usage tracking
  incUsage: (k: "resumesGenerated" | "atsChecks" | "coverLetters" | "interviewPreps" | "downloads") => void;
}

const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthed: false,
      authOpen: false,

      // User registry — seeded with the super admin
      users: (() => {
        const sa: User = {
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
        return [sa];
      })(),

      view: "landing",
      activeResumeId: SEED_RESUMES[0]?.id ?? null,
      activeJdId: SEED_JDS[0]?.id ?? null,
      activeCoverLetterId: SEED_COVER_LETTERS[0]?.id ?? null,
      activeInterviewId: SEED_INTERVIEW[0]?.id ?? null,
      landingSection: null,

      resumes: SEED_RESUMES,
      jobDescriptions: SEED_JDS,
      coverLetters: SEED_COVER_LETTERS,
      interviews: SEED_INTERVIEW,
      atsReports: SEED_ATS_REPORTS,

      providers: SEED_PROVIDERS,
      providerLogs: SEED_PROVIDER_LOGS,
      providerSettings: SEED_PROVIDER_SETTINGS,
      prompts: SEED_PROMPTS,
      branding: SEED_BRANDING,
      flags: SEED_FLAGS,
      logs: SEED_LOGS,

      theme: "light",
      sidebarCollapsed: false,

      setView: (v) => set({ view: v, landingSection: null }),
      openAuth: () => set({ authOpen: true }),
      closeAuth: () => set({ authOpen: false }),

      signIn: (user) => {
        // Check if user can sign in (not suspended/deleted)
        const check = canSignIn(user);
        if (!check.allowed) {
          // Don't sign in — the caller should show the error message
          return;
        }
        // Update or add user in registry, update lastLoginAt
        const now = new Date().toISOString();
        const updatedUser = { ...user, lastLoginAt: now, lastActiveAt: now };
        set((s) => {
          const exists = s.users.find((u) => u.email === user.email);
          const users = exists
            ? s.users.map((u) => (u.email === user.email ? { ...u, ...updatedUser } : u))
            : [...s.users, updatedUser];
          return {
            users,
            user: updatedUser,
            isAuthed: true,
            authOpen: false,
            view: "dashboard",
          };
        });
        // Audit log
        useApp.getState().log({ actor: user.email, action: "User signed in", category: "auth", details: `Provider: ${user.provider}`, severity: "info" });
      },

      signOut: () => {
        const s = get();
        if (s.user) {
          useApp.getState().log({ actor: s.user.email, action: "User signed out", category: "auth", details: "", severity: "info" });
        }
        set({ user: null, isAuthed: false, view: "landing" });
      },

      // === Email/Password Sign In ===
      signInWithEmail: (email, password) => {
        const s = get();
        const normalizedEmail = email.trim().toLowerCase();
        const existing = s.users.find((u) => u.email.toLowerCase() === normalizedEmail);
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
        set((s) => ({
          users: s.users.map((u) => (u.id === existing.id ? updatedUser : u)),
          user: updatedUser,
          isAuthed: true,
          authOpen: false,
          view: "dashboard",
        }));
        useApp.getState().log({ actor: normalizedEmail, action: "User signed in", category: "auth", details: "Provider: email", severity: "info" });
        return { ok: true, user: updatedUser };
      },

      // === Email/Password Registration ===
      registerWithEmail: (email, password, name, username) => {
        const s = get();
        const normalizedEmail = email.trim().toLowerCase();
        const existing = s.users.find((u) => u.email.toLowerCase() === normalizedEmail);
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
          status: "pending", // New users start as pending — require admin approval
          provider: "email",
          createdAt: now,
          updatedAt: now,
          lastActiveAt: now,
          lastLoginAt: now,
          usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
        };
        set((s) => ({ users: [...s.users, newUser] }));
        useApp.getState().log({ actor: normalizedEmail, action: "User registered (pending approval)", category: "auth", details: `Name: ${newUser.name}`, severity: "warning" });
        // Auto-sign-in the new user (they'll see the pending approval screen)
        set({ user: newUser, isAuthed: true, authOpen: false, view: "dashboard" });
        return { ok: true, user: newUser };
      },

      // === Puter.js Sign In ===
      signInWithPuter: async () => {
        if (typeof window === "undefined" || !window.puter?.auth) {
          return { ok: false, error: "Puter.js is not loaded. Please refresh the page." };
        }
        try {
          await window.puter.auth.signIn();
          const puterUser = await window.puter.auth.getUser();
          const puterEmail = puterUser?.email || puterUser?.username || "";
          const puterName = puterUser?.username || puterUser?.name || puterEmail.split("@")[0];

          if (!puterEmail) {
            return { ok: false, error: "Could not retrieve your email from Puter. Please try again." };
          }

          const s = get();
          const existing = s.users.find((u) => u.email.toLowerCase() === puterEmail.toLowerCase());
          const now = new Date().toISOString();

          if (existing) {
            // Existing user — check status
            if (existing.status === "suspended") {
              return { ok: false, error: "Your account has been suspended. Please contact the administrator." };
            }
            if (existing.status === "deleted") {
              return { ok: false, error: "This account has been deleted." };
            }
            const updatedUser = { ...existing, lastLoginAt: now, lastActiveAt: now, avatarUrl: puterUser?.photo || existing.avatarUrl };
            set((s) => ({
              users: s.users.map((u) => (u.id === existing.id ? updatedUser : u)),
              user: updatedUser,
              isAuthed: true,
              authOpen: false,
              view: "dashboard",
            }));
            useApp.getState().log({ actor: puterEmail, action: "User signed in", category: "auth", details: "Provider: puter", severity: "info" });
            return { ok: true, user: updatedUser };
          } else {
            // New Puter user — create with pending status
            const newUser: User = {
              id: uid("u"),
              name: puterName,
              username: puterName,
              email: puterEmail,
              avatarUrl: puterUser?.photo || "",
              role: "user",
              status: "pending",
              provider: "puter",
              createdAt: now,
              updatedAt: now,
              lastActiveAt: now,
              lastLoginAt: now,
              usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
            };
            set((s) => ({ users: [...s.users, newUser], user: newUser, isAuthed: true, authOpen: false, view: "dashboard" }));
            useApp.getState().log({ actor: puterEmail, action: "User registered via Puter (pending approval)", category: "auth", details: `Name: ${newUser.name}`, severity: "warning" });
            return { ok: true, user: newUser };
          }
        } catch {
          return { ok: false, error: "Puter sign-in was cancelled or failed." };
        }
      },

      reconcileRole: () => {
        // Keep for backward compat — no-op now since roles are managed by admin actions
      },

      // === Admin: User Management Actions ===
      approveUser: (userId) => {
        set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status: "approved", updatedAt: new Date().toISOString() } : u)) }));
        const u = get().users.find((x) => x.id === userId);
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "User approved", category: "admin", details: u?.email ?? userId, severity: "info" });
      },
      suspendUser: (userId) => {
        set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status: "suspended", updatedAt: new Date().toISOString() } : u)) }));
        const u = get().users.find((x) => x.id === userId);
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "User suspended", category: "admin", details: u?.email ?? userId, severity: "warning" });
      },
      unsuspendUser: (userId) => {
        set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status: "approved", updatedAt: new Date().toISOString() } : u)) }));
        const u = get().users.find((x) => x.id === userId);
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "User unsuspended", category: "admin", details: u?.email ?? userId, severity: "info" });
      },
      deleteUser: (userId) => {
        set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status: "deleted", updatedAt: new Date().toISOString() } : u)) }));
        const u = get().users.find((x) => x.id === userId);
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "User deleted (soft)", category: "admin", details: u?.email ?? userId, severity: "error" });
      },
      promoteToAdmin: (userId) => {
        set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, role: "admin", updatedAt: new Date().toISOString() } : u)) }));
        const u = get().users.find((x) => x.id === userId);
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "User promoted to admin", category: "admin", details: u?.email ?? userId, severity: "info" });
      },
      demoteToUser: (userId) => {
        set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, role: "user", updatedAt: new Date().toISOString() } : u)) }));
        const u = get().users.find((x) => x.id === userId);
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "User demoted to user", category: "admin", details: u?.email ?? userId, severity: "info" });
      },
      resetUserPassword: (userId, newPassword) => {
        set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, passwordHash: hashPassword(newPassword), updatedAt: new Date().toISOString() } : u)) }));
        const u = get().users.find((x) => x.id === userId);
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "Password reset by admin", category: "admin", details: u?.email ?? userId, severity: "warning" });
      },
      updateUserStatus: (userId, status) => {
        set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, status, updatedAt: new Date().toISOString() } : u)) }));
      },
      updateUserName: (newName) => {
        const trimmed = newName.trim();
        if (trimmed.length < 2) return;
        set((s) => (s.user ? { user: { ...s.user, name: trimmed, lastActiveAt: new Date().toISOString() } } : s));
        useApp.getState().log({ actor: "you", action: "Username updated", category: "auth", details: `New name: ${trimmed}`, severity: "info" });
      },
      updateUserEmail: (newEmail) => {
        const trimmed = newEmail.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return;
        // Re-evaluate role based on new email
        const newRole = getRoleForEmail(trimmed);
        set((s) => (s.user ? { user: { ...s.user, email: trimmed, role: newRole, lastActiveAt: new Date().toISOString() } } : s));
        useApp.getState().log({ actor: "you", action: "Email updated", category: "auth", details: `New email: ${trimmed} (role: ${newRole})`, severity: "info" });
      },
      changePassword: (currentPassword, newPassword) => {
        const s = get();
        if (!s.user) return { ok: false, error: "Not signed in." };
        // Mock: in dev, accept any non-empty current password. In production, this would
        // verify against bcrypt-hash stored in the users table via Workers + D1.
        if (!currentPassword) return { ok: false, error: "Current password is required." };
        if (newPassword.length < 8) return { ok: false, error: "New password must be at least 8 characters." };
        if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) return { ok: false, error: "New password must contain letters and numbers." };
        if (newPassword === currentPassword) return { ok: false, error: "New password must differ from current." };
        // Persist mock hash
        const hash = `mock$${btoa(newPassword).slice(0, 24)}`;
        set({ user: { ...s.user, passwordHash: hash, lastActiveAt: new Date().toISOString() } });
        useApp.getState().log({ actor: "you", action: "Password changed", category: "auth", details: "Password updated successfully", severity: "info" });
        return { ok: true };
      },
      toggleTheme: () => {
        const next = get().theme === "light" ? "dark" : "light";
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", next === "dark");
        }
        set({ theme: next });
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setLandingSection: (s) => set({ landingSection: s }),

      addResume: (r) => set((s) => ({ resumes: [r, ...s.resumes] })),
      updateResume: (id, patch) =>
        set((s) => ({
          resumes: s.resumes.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
          ),
        })),
      removeResume: (id) =>
        set((s) => ({
          resumes: s.resumes.filter((r) => r.id !== id),
          activeResumeId: s.activeResumeId === id ? s.resumes[0]?.id ?? null : s.activeResumeId,
        })),
      setActiveResume: (id) => set({ activeResumeId: id }),

      addJD: (j) => set((s) => ({ jobDescriptions: [j, ...s.jobDescriptions] })),
      removeJD: (id) => set((s) => ({ jobDescriptions: s.jobDescriptions.filter((j) => j.id !== id) })),
      setActiveJD: (id) => set({ activeJdId: id }),

      addCoverLetter: (c) => set((s) => ({ coverLetters: [c, ...s.coverLetters] })),
      updateCoverLetter: (id, patch) =>
        set((s) => ({
          coverLetters: s.coverLetters.map((c) =>
            c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c
          ),
        })),
      removeCoverLetter: (id) => set((s) => ({ coverLetters: s.coverLetters.filter((c) => c.id !== id) })),
      setActiveCoverLetter: (id) => set({ activeCoverLetterId: id }),

      addInterview: (i) => set((s) => ({ interviews: [i, ...s.interviews] })),
      removeInterview: (id) => set((s) => ({ interviews: s.interviews.filter((i) => i.id !== id) })),
      setActiveInterview: (id) => set({ activeInterviewId: id }),

      addATSReport: (r) => set((s) => ({ atsReports: [r, ...s.atsReports] })),

      addProvider: (p) => set((s) => ({ providers: [...s.providers, p] })),
      updateProvider: (id, patch) =>
        set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)) })),
      removeProvider: (id) =>
        set((s) => ({
          providers: s.providers.filter((p) => p.id !== id),
          providerLogs: s.providerLogs.filter((l) => l.providerId !== id),
          providerSettings: {
            ...s.providerSettings,
            defaultProviderId: s.providerSettings.defaultProviderId === id ? null : s.providerSettings.defaultProviderId,
            fallbackProviderIds: s.providerSettings.fallbackProviderIds.filter((fid) => fid !== id),
          },
        })),
      duplicateProvider: (id) => {
        const src = get().providers.find((p) => p.id === id);
        if (!src) return null;
        const newId = uid("p");
        const copy: AIProvider = {
          ...src,
          id: newId,
          name: `${src.name} (copy)`,
          isDefault: false,
          isBuiltIn: false,
          isActive: false,
          status: "untested",
          usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
          lastUsedAt: undefined,
        };
        set((s) => ({ providers: [...s.providers, copy] }));
        return newId;
      },
      setDefaultProvider: (id) =>
        set((s) => ({
          providers: s.providers.map((p) => ({ ...p, isDefault: p.id === id })),
          providerSettings: { ...s.providerSettings, defaultProviderId: id },
        })),
      toggleFallback: (id) =>
        set((s) => {
          const isIn = s.providerSettings.fallbackProviderIds.includes(id);
          return {
            providers: s.providers.map((p) => (p.id === id ? { ...p, isFallback: !isIn } : p)),
            providerSettings: {
              ...s.providerSettings,
              fallbackProviderIds: isIn
                ? s.providerSettings.fallbackProviderIds.filter((fid) => fid !== id)
                : [...s.providerSettings.fallbackProviderIds, id],
            },
          };
        }),
      reorderFallback: (id, direction) =>
        set((s) => {
          const ids = [...s.providerSettings.fallbackProviderIds];
          const i = ids.indexOf(id);
          if (i < 0) return s;
          const j = direction === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= ids.length) return s;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          return { providerSettings: { ...s.providerSettings, fallbackProviderIds: ids } };
        }),
      addProviderLog: (l) =>
        set((s) => ({
          providerLogs: [l, ...s.providerLogs].slice(0, 1000),
          providers: s.providers.map((p) =>
            p.id === l.providerId
              ? {
                  ...p,
                  lastUsedAt: l.createdAt,
                  status: l.status === "success" ? "healthy" : l.status === "timeout" || l.status === "rate_limited" ? "degraded" : "down",
                  usage: {
                    ...p.usage,
                    requests: p.usage.requests + 1,
                    tokens: p.usage.tokens + (l.inputTokens ?? 0) + (l.outputTokens ?? 0),
                    errors: p.usage.errors + (l.status === "success" ? 0 : 1),
                    avgLatencyMs: Math.round((p.usage.avgLatencyMs * p.usage.requests + l.latencyMs) / (p.usage.requests + 1)),
                    cost: p.usage.cost + (l.inputTokens ?? 0) * (p.costPerInputToken ?? 0) + (l.outputTokens ?? 0) * (p.costPerOutputToken ?? 0),
                  },
                }
              : p
          ),
        })),
      clearProviderLogs: (providerId) =>
        set((s) => ({
          providerLogs: providerId ? s.providerLogs.filter((l) => l.providerId !== providerId) : [],
        })),
      updateProviderSettings: (patch) =>
        set((s) => ({ providerSettings: { ...s.providerSettings, ...patch } })),

      addPrompt: (p) => set((s) => ({ prompts: [...s.prompts, p] })),
      updatePrompt: (id, patch) =>
        set((s) => ({
          prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...patch, version: p.version + 1 } : p)),
        })),
      removePrompt: (id) => set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),

      updateBranding: (patch) => set((s) => ({ branding: { ...s.branding, ...patch } })),
      updateFlag: (k, v) => set((s) => ({ flags: { ...s.flags, [k]: v } })),

      log: (entry) =>
        set((s) => ({
          logs: [
            { id: uid("l"), timestamp: new Date().toISOString(), ...entry },
            ...s.logs,
          ].slice(0, 500),
        })),
      clearLogs: () => set({ logs: [] }),

      incUsage: (k) =>
        set((s) =>
          s.user
            ? { user: { ...s.user, usage: { ...s.user.usage, [k]: s.user.usage[k] + 1 } } }
            : s
        ),
    }),
    {
      name: "resumeai-pro",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        user: s.user,
        isAuthed: s.isAuthed,
        users: s.users,
        resumes: s.resumes,
        jobDescriptions: s.jobDescriptions,
        coverLetters: s.coverLetters,
        interviews: s.interviews,
        atsReports: s.atsReports,
        providers: s.providers,
        providerLogs: s.providerLogs,
        providerSettings: s.providerSettings,
        prompts: s.prompts,
        branding: s.branding,
        flags: s.flags,
        logs: s.logs,
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    }
  )
);

export { BRAND };
export { uid };
