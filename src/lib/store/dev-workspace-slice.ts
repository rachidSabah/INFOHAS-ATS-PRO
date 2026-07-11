// ============================================================================
// Zustand Store — Dev Workspace, UI, and Jobs Slice
// ============================================================================

"use client";

import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type {
  AIDevAgentSettings, AIDevAgentHistory, AIDevReport,
  AITask, AIWorkspacePatch, AIGitBranch, AIGitCommit, AIRollback,
  AIHealingIssue, AIHealingReport, AuditLog, ViewKey, AIProvider
} from "../types";
import type { ResumeSnapshot } from "../resume-snapshot-engine";
import {
  SEED_AI_DEV_SETTINGS, SEED_AI_DEV_HISTORY, SEED_AI_DEV_REPORTS,
  SEED_AI_TASKS, SEED_AI_PATCHES, SEED_AI_BRANCHES, SEED_AI_COMMITS,
  SEED_AI_ROLLBACKS, SEED_LOGS
} from "../mock-data";
import { uid, _hasPendingRehydration } from "./helpers";
import { api as cloudApi, cloudApiSafe } from "../cloud-api";

const { createAuditLog, updateBranding } = cloudApi;

export interface DevWorkspaceSlice {
  aiDevSettings: AIDevAgentSettings;
  snapshots: ResumeSnapshot[];
  aiDevHistory: AIDevAgentHistory[];
  aiDevReports: AIDevReport[];
  aiTasks: AITask[];
  aiPatches: AIWorkspacePatch[];
  aiBranches: AIGitBranch[];
  aiCommits: AIGitCommit[];
  aiRollbacks: AIRollback[];
  aiHealingIssues: AIHealingIssue[];
  aiHealingReport: AIHealingReport | null;
  aiHealingProgress: {
    status: "idle" | "scanning" | "classifying" | "analyzing" | "fixing" | "validating" | "completed";
    currentStep: string;
    progressPercent: number;
  };
  logs: AuditLog[];
  backgroundJobs: {
    id: string;
    type: string;
    payload: any;
    priority: "high" | "normal" | "low";
    createdAt: string;
    retryCount: number;
    maxRetries: number;
    status: "queued" | "running" | "success" | "failed";
    durationMs?: number;
    error?: string;
  }[];
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
  synced: boolean;
  view: ViewKey;
  landingSection: string | null;
  _needsRehydrate: boolean;
  _lastProviderHash: string;
  fallbackOfferOpen: boolean;
  fallbackOfferChoices: AIProvider[];
  fallbackOfferCurrentProviderId: string | null;

  setView: (v: ViewKey) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setLandingSection: (s: string | null) => void;
  updateAIDevSettings: (patch: Partial<AIDevAgentSettings>) => void;
  addSnapshot: (snapshot: ResumeSnapshot) => void;
  restoreSnapshot: (snapshotId: string) => any;
  clearSnapshots: (resumeId?: string) => void;
  addAIDevHistory: (entry: Omit<AIDevAgentHistory, "id" | "createdAt">) => void;
  addAIDevReport: (report: Omit<AIDevReport, "id" | "createdAt">) => void;
  addAITask: (task: Omit<AITask, "id" | "createdAt" | "updatedAt">) => void;
  updateAITask: (id: string, patch: Partial<AITask>) => void;
  removeAITask: (id: string) => void;
  addAIPatch: (patch: Omit<AIWorkspacePatch, "id" | "createdAt">) => void;
  updateAIPatch: (id: string, patch: Partial<AIWorkspacePatch>) => void;
  addAIRollback: (rollback: Omit<AIRollback, "id" | "rolledBackAt">) => void;
  setAIHealingIssues: (issues: AIHealingIssue[]) => void;
  updateAIHealingIssue: (id: string, patch: Partial<AIHealingIssue>) => void;
  setAIHealingReport: (report: AIHealingReport | null) => void;
  setAIHealingProgress: (progress: {
    status: "idle" | "scanning" | "classifying" | "analyzing" | "fixing" | "validating" | "completed";
    currentStep: string;
    progressPercent: number;
  }) => void;
  log: (entry: Omit<AuditLog, "id" | "timestamp">) => void;
  clearLogs: () => void;
  incUsage: (k: "resumesGenerated" | "atsChecks" | "coverLetters" | "interviewPreps" | "downloads") => void;
  enqueueJob: (type: string, payload: any, options?: { priority?: "high" | "normal" | "low" }) => string;
  runWorkerQueue: () => Promise<void>;
  clearJobHistory: () => void;
}

export const createDevWorkspaceSlice: StateCreator<AppState, [], [], DevWorkspaceSlice> = (set, get) => ({
  aiDevSettings: (() => {
    if (typeof localStorage === "undefined") return SEED_AI_DEV_SETTINGS;
    try {
      const saved = localStorage.getItem("resumeai-ai-dev-settings");
      if (saved) {
        const ls = JSON.parse(saved);
        if (ls.providerId || ls.modelName) {
          return { ...SEED_AI_DEV_SETTINGS, ...ls };
        }
      }
    } catch {}
    return SEED_AI_DEV_SETTINGS;
  })(),
  snapshots: [],
  aiDevHistory: SEED_AI_DEV_HISTORY,
  aiDevReports: SEED_AI_DEV_REPORTS,
  aiTasks: SEED_AI_TASKS,
  aiPatches: SEED_AI_PATCHES,
  aiBranches: SEED_AI_BRANCHES,
  aiCommits: SEED_AI_COMMITS,
  aiRollbacks: SEED_AI_ROLLBACKS,
  aiHealingIssues: [],
  aiHealingReport: null,
  aiHealingProgress: {
    status: "idle",
    currentStep: "",
    progressPercent: 0,
  },
  logs: SEED_LOGS,
  backgroundJobs: [],
  theme: "light" as "light" | "dark",
  sidebarCollapsed: false,
  synced: false,
  view: "landing" as ViewKey,
  landingSection: null,
  _needsRehydrate: _hasPendingRehydration,
  _lastProviderHash: "",
  fallbackOfferOpen: false,
  fallbackOfferChoices: [],
  fallbackOfferCurrentProviderId: null,

  setView: (v) => set({ view: v, landingSection: null }),

  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", next === "dark");
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("resumeai-theme", next);
    }
    set({ theme: next });
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setLandingSection: (s) => set({ landingSection: s }),

  updateAIDevSettings: (patch) => {
    set((s) => ({ aiDevSettings: { ...s.aiDevSettings, ...patch } }));
    try { localStorage.setItem("resumeai-ai-dev-settings", JSON.stringify({ ...get().aiDevSettings, ...patch })); } catch {}
    cloudApiSafe(updateBranding)({ aiDevSettings: { ...get().aiDevSettings, ...patch } }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    get().log({ actor: get().user?.email ?? "admin", action: "AI Dev Agent settings updated", category: "admin", details: Object.keys(patch).join(", "), severity: "info" });
  },

  addSnapshot: (snapshot) => {
    set((s) => ({ snapshots: [...s.snapshots, snapshot] }));
    try {
      const existing = JSON.parse(localStorage.getItem("resumeai-snapshots") || "[]");
      existing.push(snapshot);
      if (existing.length > 50) existing.splice(0, existing.length - 50);
      localStorage.setItem("resumeai-snapshots", JSON.stringify(existing));
    } catch {}
  },

  restoreSnapshot: (snapshotId) => {
    const snapshot = get().snapshots.find((s) => s.snapshotId === snapshotId);
    if (!snapshot) return null;
    return JSON.parse(JSON.stringify(snapshot.fullResume));
  },

  clearSnapshots: (resumeId) => {
    set((s) => ({
      snapshots: resumeId
        ? s.snapshots.filter((sn) => sn.resumeId !== resumeId)
        : [],
    }));
    try {
      if (resumeId) {
        const existing = JSON.parse(localStorage.getItem("resumeai-snapshots") || "[]");
        localStorage.setItem("resumeai-snapshots",
          JSON.stringify(existing.filter((s: ResumeSnapshot) => s.resumeId !== resumeId)));
      } else {
        localStorage.removeItem("resumeai-snapshots");
      }
    } catch {}
  },

  addAIDevHistory: (entry) => {
    const full: AIDevAgentHistory = {
      ...entry,
      id: uid("h"),
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ aiDevHistory: [full, ...s.aiDevHistory].slice(0, 200) }));
  },

  addAIDevReport: (report) => {
    const full: AIDevReport = {
      ...report,
      id: uid("rpt"),
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ aiDevReports: [full, ...s.aiDevReports].slice(0, 100) }));
  },

  addAITask: (task) => {
    const now = new Date().toISOString();
    const full: AITask = { ...task, id: uid("t"), createdAt: now, updatedAt: now };
    set((s) => ({ aiTasks: [full, ...s.aiTasks].slice(0, 100) }));
  },

  updateAITask: (id, patch) => {
    set((s) => ({
      aiTasks: s.aiTasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)),
    }));
  },

  removeAITask: (id) => {
    set((s) => ({ aiTasks: s.aiTasks.filter((t) => t.id !== id) }));
  },

  addAIPatch: (patch) => {
    const full: AIWorkspacePatch = { ...patch, id: uid("p"), createdAt: new Date().toISOString() };
    set((s) => ({ aiPatches: [full, ...s.aiPatches].slice(0, 100) }));
  },

  updateAIPatch: (id, patch) => {
    set((s) => ({ aiPatches: s.aiPatches.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  },

  addAIRollback: (rollback) => {
    const full: AIRollback = { ...rollback, id: uid("rb"), rolledBackAt: new Date().toISOString() };
    set((s) => ({ aiRollbacks: [full, ...s.aiRollbacks].slice(0, 50) }));
  },

  setAIHealingIssues: (issues) => {
    set({ aiHealingIssues: issues });
  },

  updateAIHealingIssue: (id, patch) => {
    set((s) => ({
      aiHealingIssues: s.aiHealingIssues.map((issue) =>
        issue.id === id ? { ...issue, ...patch } : issue
      ),
    }));
  },

  setAIHealingReport: (report) => {
    set({ aiHealingReport: report });
  },

  setAIHealingProgress: (progress) => {
    set({ aiHealingProgress: progress });
  },

  log: (entry) => {
    set((s) => ({
      logs: [
        { id: uid("l"), timestamp: new Date().toISOString(), ...entry },
        ...s.logs,
      ].slice(0, 500),
    }));
    cloudApiSafe(createAuditLog)({ id: uid("l"), timestamp: new Date().toISOString(), ...entry }).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  clearLogs: () => set({ logs: [] }),

  incUsage: (k) =>
    set((s) => {
      if (!s.user) return s;
      const currentUsage = s.user.usage || { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 };
      const currentValue = (currentUsage as any)[k] || 0;
      return { user: { ...s.user, usage: { ...currentUsage, [k]: currentValue + 1 } } };
    }),

  enqueueJob: (type, payload, options) => {
    const jobId = "JOB_" + Math.random().toString(36).slice(2, 9).toUpperCase();
    const newJob = {
      id: jobId,
      type,
      payload,
      priority: options?.priority ?? "normal",
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: 3,
      status: "queued" as const,
    };
    set((s) => ({ backgroundJobs: [newJob, ...s.backgroundJobs] }));
    return jobId;
  },

  runWorkerQueue: async () => {
    const jobs = get().backgroundJobs.filter((j) => j.status === "queued");
    if (jobs.length === 0) return;

    for (const job of jobs) {
      set((s) => ({
        backgroundJobs: s.backgroundJobs.map((j) =>
          j.id === job.id ? { ...j, status: "running" } : j
        ),
      }));

      await new Promise((resolve) => setTimeout(resolve, 800));

      const success = Math.random() > 0.08;
      const durationMs = Math.round(150 + Math.random() * 400);

      set((s) => ({
        backgroundJobs: s.backgroundJobs.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: success ? "success" : "failed",
                durationMs,
                error: success ? undefined : "Worker timeout: failed to acquire lock on database row",
              }
            : j
        ),
      }));

      get().log({
        actor: "cloudflare-queue-worker",
        action: `Job processed: ${job.type}`,
        category: "system",
        details: `Job ${job.id} resolved with status: ${success ? "SUCCESS" : "FAILED"} in ${durationMs}ms`,
        severity: success ? "info" : "error",
      });
    }
  },

  clearJobHistory: () => set({ backgroundJobs: [] }),
});
