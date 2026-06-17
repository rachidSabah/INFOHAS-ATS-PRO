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
import { BRAND } from "./brand";

interface AppState {
  // session
  user: User | null;
  isAuthed: boolean;
  authOpen: boolean;

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
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setLandingSection: (s: string | null) => void;

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
      signIn: (user) =>
        set({
          user,
          isAuthed: true,
          authOpen: false,
          view: "dashboard",
        }),
      signOut: () => set({ user: null, isAuthed: false, view: "landing" }),
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
