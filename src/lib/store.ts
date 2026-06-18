// ResumeAI Pro — global Zustand store (cloud-backed, no localStorage persistence)
"use client";

import { create } from "zustand";
import type {
  User, ResumeData, JobDescription, AIProvider, AIProviderLog, AIProviderSettings, PromptTemplate,
  BrandingConfig, FeatureFlags, AuditLog, ViewKey, CoverLetter, InterviewPackage, ATSReport,
  OptimizerDirectiveConfig,
} from "./types";
import {
  SEED_USER, SEED_RESUMES, SEED_JDS, SEED_PROVIDERS, SEED_PROVIDER_LOGS, SEED_PROVIDER_SETTINGS,
  SEED_PROMPTS, SEED_BRANDING, SEED_FLAGS, SEED_LOGS, SEED_COVER_LETTERS, SEED_INTERVIEW, SEED_ATS_REPORTS,
  SEED_OPTIMIZER_DIRECTIVE,
} from "./mock-data";
import { BRAND, getRoleForEmail } from "./brand";
import { hashPassword, verifyPassword, SUPER_ADMIN_SEED, canSignIn, canAccessApp } from "./auth-utils";
import type { UserStatus as US } from "./types";
import { setUserId, clearUserId, api as cloudApi, cloudApiSafe } from "./cloud-api";

// Destructure cloud API methods so the existing cloudApiSafe(createResume)(...) call sites
// in this file resolve to the real functions. Each of these is an async function that hits
// the Cloudflare Worker → D1. cloudApiSafe wraps them so they never throw or reject.
const {
  createResume,
  updateResume,
  deleteResume,
  createJobDescription,
  deleteJobDescription,
  createCoverLetter,
  updateCoverLetter,
  deleteCoverLetter,
  createInterview,
  deleteInterview,
  createATSReport,
  createProvider,
  updateProvider,
  deleteProvider,
  createPrompt,
  updatePrompt,
  deletePrompt,
  updateBranding,
  updateFlag,
  createAuditLog,
} = cloudApi;

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
  optimizerDirective: OptimizerDirectiveConfig;
  logs: AuditLog[];

  // ui
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
  synced: boolean; // whether cloud data has been loaded

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
  toggleTheme: () => void;
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
  updateOptimizerDirective: (patch: Partial<OptimizerDirectiveConfig>) => void;
  resetOptimizerDirective: () => void;

  // logs
  log: (entry: Omit<AuditLog, "id" | "timestamp">) => void;
  clearLogs: () => void;

  // usage tracking
  incUsage: (k: "resumesGenerated" | "atsChecks" | "coverLetters" | "interviewPreps" | "downloads") => void;
}

const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

export const useApp = create<AppState>()(
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
      optimizerDirective: SEED_OPTIMIZER_DIRECTIVE,
      logs: SEED_LOGS,

      theme: (typeof localStorage !== "undefined" && localStorage.getItem("resumeai-theme") === "dark") ? "dark" : "light",
      sidebarCollapsed: false,
      synced: false,

      setView: (v) => set({ view: v, landingSection: null }),
      openAuth: () => set({ authOpen: true }),
      closeAuth: () => set({ authOpen: false }),

      signIn: (user) => {
        const check = canSignIn(user);
        if (!check.allowed) return;
        const now = new Date().toISOString();
        const updatedUser = { ...user, lastLoginAt: now, lastActiveAt: now };
        setUserId(updatedUser.id); // Set user ID for API calls
        set((s) => {
          const exists = s.users.find((u) => u.email === user.email);
          const users = exists
            ? s.users.map((u) => (u.email === user.email ? { ...u, ...updatedUser } : u))
            : [...s.users, updatedUser];
          return { users, user: updatedUser, isAuthed: true, authOpen: false, view: "dashboard", synced: false };
        });
        useApp.getState().log({ actor: user.email, action: "User signed in", category: "auth", details: `Provider: ${user.provider}`, severity: "info" });
      },

      signOut: () => {
        const s = get();
        if (s.user) {
          useApp.getState().log({ actor: s.user.email, action: "User signed out", category: "auth", details: "", severity: "info" });
        }
        clearUserId();
        set({ user: null, isAuthed: false, view: "landing", synced: false });
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
          synced: false,
        }));
        setUserId(updatedUser.id);
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
        set({ user: newUser, isAuthed: true, authOpen: false, view: "dashboard", synced: false });
        return { ok: true, user: newUser };
      },

      // === Puter.js Sign In ===
      // Per https://docs.puter.com/Auth/signIn/ — signIn() must be called from a
      // user click handler (it opens a popup). This method is called from the
      // auth modal's "Sign in with Puter" button onClick, so it's user-initiated.
      signInWithPuter: async () => {
        if (typeof window === "undefined" || !window.puter?.auth) {
          return { ok: false, error: "Puter.js is not loaded. Please refresh the page and try again." };
        }
        try {
          // signIn() opens a popup — allowed because this is called from onClick
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
            // If this is a Puter-authenticated user who was previously stuck in
            // "pending" status (from the old approval flow), auto-approve them now.
            // Puter OAuth already verified their email, so admin approval is unnecessary.
            const shouldAutoApprove = existing.provider === "puter" && existing.status === "pending";
            // Reconcile role from the email allowlist — this ensures that if the
            // super admin / admin allowlists change, the user's role is updated
            // on their next Puter sign-in. (e.g. if relsabah@gmail.com was initially
            // created as a regular user but is now in the super admin allowlist,
            // this upgrades their role on sign-in.)
            const reconciledRole = getRoleForEmail(puterEmail);
            const roleChanged = reconciledRole !== existing.role;
            const updatedUser = {
              ...existing,
              status: shouldAutoApprove ? "approved" as const : existing.status,
              role: reconciledRole as any,
              lastLoginAt: now,
              lastActiveAt: now,
              avatarUrl: puterUser?.photo || existing.avatarUrl,
              updatedAt: (shouldAutoApprove || roleChanged) ? now : existing.updatedAt,
            };
            set((s) => ({
              users: s.users.map((u) => (u.id === existing.id ? updatedUser : u)),
              user: updatedUser,
              isAuthed: true,
              authOpen: false,
              view: "dashboard",
              synced: false,
            }));
            setUserId(updatedUser.id);
            if (shouldAutoApprove) {
              useApp.getState().log({ actor: puterEmail, action: "Puter user auto-approved on sign-in", category: "auth", details: `Name: ${updatedUser.name}`, severity: "info" });
            } else {
              useApp.getState().log({ actor: puterEmail, action: "User signed in", category: "auth", details: "Provider: puter", severity: "info" });
            }
            return { ok: true, user: updatedUser };
          } else {
            // New Puter user — AUTO-APPROVED.
            // Puter users authenticate via Google/GitHub/etc through Puter's OAuth,
            // so their email is already verified by the upstream provider. There's
            // no need for an admin approval step — they can use the app immediately.
            // (Email/password registrations still go through the pending approval flow.)
            // Role is assigned from the email allowlist: if the email is in
            // SUPER_ADMIN_EMAILS, they get super_admin; if in ADMIN_EMAILS, admin;
            // otherwise user.
            const newUser: User = {
              id: uid("u"),
              name: puterName,
              username: puterName,
              email: puterEmail,
              avatarUrl: puterUser?.photo || "",
              role: getRoleForEmail(puterEmail) as any, // Check allowlist for super_admin/admin
              status: "approved", // Auto-approved — Puter OAuth already verified the email
              provider: "puter",
              createdAt: now,
              updatedAt: now,
              lastActiveAt: now,
              lastLoginAt: now,
              usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
            };
            set((s) => ({ users: [...s.users, newUser], user: newUser, isAuthed: true, authOpen: false, view: "dashboard", synced: false }));
            setUserId(newUser.id);
            useApp.getState().log({ actor: puterEmail, action: "User registered via Puter (auto-approved)", category: "auth", details: `Name: ${newUser.name}`, severity: "info" });
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
        // Persist mock hash — use hashPassword for consistency
        const hash = hashPassword(newPassword);
        set({ user: { ...s.user, passwordHash: hash, lastActiveAt: new Date().toISOString() } });
        useApp.getState().log({ actor: "you", action: "Password changed", category: "auth", details: "Password updated successfully", severity: "info" });
        return { ok: true };
      },
      toggleTheme: () => {
        const next = get().theme === "light" ? "dark" : "light";
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", next === "dark");
        }
        // Theme is a UI preference — allowed in localStorage (not business data)
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("resumeai-theme", next);
        }
        set({ theme: next });
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setLandingSection: (s) => set({ landingSection: s }),

      addResume: (r) => {
        set((s) => ({ resumes: [r, ...s.resumes] }));
        cloudApiSafe(createResume)(r).catch(() => {});
      },
      updateResume: (id, patch) => {
        set((s) => ({
          resumes: s.resumes.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
          ),
        }));
        cloudApiSafe(updateResume)(id, patch).catch(() => {});
      },
      removeResume: (id) => {
        set((s) => ({
          resumes: s.resumes.filter((r) => r.id !== id),
          activeResumeId: s.activeResumeId === id ? s.resumes[0]?.id ?? null : s.activeResumeId,
        }));
        cloudApiSafe(deleteResume)(id).catch(() => {});
      },
      setActiveResume: (id) => set({ activeResumeId: id }),

      addJD: (j) => {
        set((s) => ({ jobDescriptions: [j, ...s.jobDescriptions] }));
        cloudApiSafe(createJobDescription)(j).catch(() => {});
      },
      removeJD: (id) => {
        set((s) => ({ jobDescriptions: s.jobDescriptions.filter((j) => j.id !== id) }));
        cloudApiSafe(deleteJobDescription)(id).catch(() => {});
      },
      setActiveJD: (id) => set({ activeJdId: id }),

      addCoverLetter: (c) => {
        set((s) => ({ coverLetters: [c, ...s.coverLetters] }));
        cloudApiSafe(createCoverLetter)(c).catch(() => {});
      },
      updateCoverLetter: (id, patch) => {
        set((s) => ({
          coverLetters: s.coverLetters.map((c) =>
            c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c
          ),
        }));
        cloudApiSafe(updateCoverLetter)(id, patch).catch(() => {});
      },
      removeCoverLetter: (id) => {
        set((s) => ({ coverLetters: s.coverLetters.filter((c) => c.id !== id) }));
        cloudApiSafe(deleteCoverLetter)(id).catch(() => {});
      },
      setActiveCoverLetter: (id) => set({ activeCoverLetterId: id }),

      addInterview: (i) => {
        set((s) => ({ interviews: [i, ...s.interviews] }));
        cloudApiSafe(createInterview)(i).catch(() => {});
      },
      removeInterview: (id) => {
        set((s) => ({ interviews: s.interviews.filter((i) => i.id !== id) }));
        cloudApiSafe(deleteInterview)(id).catch(() => {});
      },
      setActiveInterview: (id) => set({ activeInterviewId: id }),

      addATSReport: (r) => {
        set((s) => ({ atsReports: [r, ...s.atsReports] }));
        cloudApiSafe(createATSReport)(r).catch(() => {});
      },

      // === AI PROVIDERS — sync to D1 ===
      addProvider: (p) => {
        set((s) => ({ providers: [...s.providers, p] }));
        cloudApiSafe(createProvider)(p).catch(() => {});
      },
      updateProvider: (id, patch) => {
        set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)) }));
        cloudApiSafe(updateProvider)(id, patch).catch(() => {});
      },
      removeProvider: (id) => {
        set((s) => ({
          providers: s.providers.filter((p) => p.id !== id),
          providerLogs: s.providerLogs.filter((l) => l.providerId !== id),
          providerSettings: {
            ...s.providerSettings,
            defaultProviderId: s.providerSettings.defaultProviderId === id ? null : s.providerSettings.defaultProviderId,
            fallbackProviderIds: s.providerSettings.fallbackProviderIds.filter((fid) => fid !== id),
          },
        }));
        cloudApiSafe(deleteProvider)(id).catch(() => {});
      },
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
        cloudApiSafe(createProvider)(copy).catch(() => {});
        return newId;
      },
      setDefaultProvider: (id) => {
        set((s) => ({
          providers: s.providers.map((p) => ({ ...p, isDefault: p.id === id })),
          providerSettings: { ...s.providerSettings, defaultProviderId: id },
        }));
        // Update all providers in D1 (isDefault changed for multiple)
        get().providers.forEach((p) => cloudApiSafe(updateProvider)(p.id, { isDefault: p.id === id }).catch(() => {}));
      },
      toggleFallback: (id) => {
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
        });
        const p = get().providers.find((x) => x.id === id);
        if (p) cloudApiSafe(updateProvider)(id, { isFallback: p.isFallback }).catch(() => {});
      },
      reorderFallback: (id, direction) => {
        set((s) => {
          const ids = [...s.providerSettings.fallbackProviderIds];
          const i = ids.indexOf(id);
          if (i < 0) return s;
          const j = direction === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= ids.length) return s;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          return { providerSettings: { ...s.providerSettings, fallbackProviderIds: ids } };
        });
      },
      addProviderLog: (l) => {
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
        }));
      },
      clearProviderLogs: (providerId) =>
        set((s) => ({
          providerLogs: providerId ? s.providerLogs.filter((l) => l.providerId !== providerId) : [],
        })),
      updateProviderSettings: (patch) => {
        set((s) => ({ providerSettings: { ...s.providerSettings, ...patch } }));
        // Also sync the provider settings to D1 via branding/settings endpoint
      },

      addPrompt: (p) => {
        set((s) => ({ prompts: [...s.prompts, p] }));
        cloudApiSafe(createPrompt)(p).catch(() => {});
      },
      updatePrompt: (id, patch) => {
        set((s) => ({
          prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...patch, version: p.version + 1 } : p)),
        }));
        cloudApiSafe(updatePrompt)(id, patch).catch(() => {});
      },
      removePrompt: (id) => {
        set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) }));
        cloudApiSafe(deletePrompt)(id).catch(() => {});
      },

      updateBranding: (patch) => {
        set((s) => ({ branding: { ...s.branding, ...patch } }));
        cloudApiSafe(updateBranding)({ ...get().branding, ...patch }).catch(() => {});
      },
      updateFlag: (k, v) => {
        set((s) => ({ flags: { ...s.flags, [k]: v } }));
        cloudApiSafe(updateFlag)(k, v).catch(() => {});
      },
      updateOptimizerDirective: (patch) => {
        set((s) => ({ optimizerDirective: { ...s.optimizerDirective, ...patch } }));
        // Sync to D1 via the branding/settings endpoint (stored as a JSON blob)
        // We reuse the updateBranding cloud API since optimizerDirective is a
        // settings blob like branding. The cloud API stores it under a
        // dedicated key in the settings table.
        cloudApiSafe(cloudApi.updateBranding as any)({ optimizerDirective: { ...get().optimizerDirective, ...patch } }).catch(() => {});
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "Optimizer directive updated", category: "admin", details: Object.keys(patch).join(", "), severity: "info" });
      },
      resetOptimizerDirective: () => {
        set({ optimizerDirective: SEED_OPTIMIZER_DIRECTIVE });
        cloudApiSafe(cloudApi.updateBranding as any)({ optimizerDirective: SEED_OPTIMIZER_DIRECTIVE }).catch(() => {});
        useApp.getState().log({ actor: get().user?.email ?? "admin", action: "Optimizer directive reset to defaults", category: "admin", details: "All parameters restored to factory defaults", severity: "warning" });
      },

      log: (entry) => {
        set((s) => ({
          logs: [
            { id: uid("l"), timestamp: new Date().toISOString(), ...entry },
            ...s.logs,
          ].slice(0, 500),
        }));
        cloudApiSafe(createAuditLog)({ id: uid("l"), timestamp: new Date().toISOString(), ...entry }).catch(() => {});
      },
      clearLogs: () => set({ logs: [] }),

      incUsage: (k) =>
        set((s) =>
          s.user
            ? { user: { ...s.user, usage: { ...s.user.usage, [k]: s.user.usage[k] + 1 } } }
            : s
        ),
    })
);

export { BRAND };
export { uid };
