// ============================================================================
// Zustand Store — Applications Slice (job application tracker)
// ============================================================================

"use client";

import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import {
  appendHistory,
  sanitizeApplication,
  toApiBody,
  type ApplicationRecord,
  type ApplicationStatus,
} from "../applications-logic";
import { api as cloudApi, cloudApiSafe, userScopedKey } from "../cloud-api";

const BACKUP_KEY = "resumeai-applications-backup";
const BACKUP_CAP = 200;

export interface ApplicationsSlice {
  applications: ApplicationRecord[];

  addApplication: (a: Partial<ApplicationRecord>) => ApplicationRecord;
  updateApplication: (id: string, patch: Partial<ApplicationRecord>) => void;
  /** Move an application to a new status — records a history entry. */
  moveApplication: (id: string, status: ApplicationStatus) => void;
  removeApplication: (id: string) => void;
  /** Clear a satisfied follow-up (keep note history free — drop the reminder). */
  dismissFollowUp: (id: string) => void;
}

function writeBackup(apps: ApplicationRecord[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(userScopedKey(BACKUP_KEY), JSON.stringify(apps.slice(0, BACKUP_CAP)));
  } catch (e) {
    console.warn("[store] Applications backup write failed:", e);
  }
}

function readBackup(): ApplicationRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(userScopedKey(BACKUP_KEY)) || "[]");
    return Array.isArray(raw) ? raw.map((r: any) => sanitizeApplication(r)) : [];
  } catch {
    return [];
  }
}

export const createApplicationsSlice: StateCreator<AppState, [], [], ApplicationsSlice> = (set, get) => ({
  applications: [],

  addApplication: (a) => {
    const record = sanitizeApplication({ ...a, createdAt: a.createdAt ?? new Date().toISOString() });
    set((s) => ({ applications: [record, ...s.applications.filter((x) => x.id !== record.id)] }));
    cloudApiSafe(cloudApi.createApplication)(toApiBody(record)).catch((e) => {
      console.warn("[store] Application cloud sync failed:", e);
    });
    writeBackup([record, ...readBackup().filter((x) => x.id !== record.id)]);
    return record;
  },

  updateApplication: (id, patch) => {
    const updatedAt = new Date().toISOString();
    set((s) => ({
      applications: s.applications.map((x) =>
        x.id === id ? sanitizeApplication({ ...x, ...patch, updatedAt }) : x
      ),
    }));
    const updated = get().applications.find((x) => x.id === id);
    if (updated) {
      cloudApiSafe(cloudApi.updateApplication)(id, toApiBody(updated)).catch((e) => {
        console.warn("[store] Application cloud update failed:", e);
      });
      writeBackup(readBackup().map((x) => (x.id === id ? updated : x)));
    }
  },

  moveApplication: (id, status) => {
    const current = get().applications.find((x) => x.id === id);
    if (!current || current.status === status) return;
    const updatedAt = new Date().toISOString();
    const moved = sanitizeApplication({
      ...current,
      status,
      history: appendHistory(current.history, status, updatedAt, current.status),
      updatedAt,
    });
    set((s) => ({ applications: s.applications.map((x) => (x.id === id ? moved : x)) }));
    cloudApiSafe(cloudApi.updateApplication)(id, toApiBody(moved)).catch((e) => {
      console.warn("[store] Application cloud move failed:", e);
    });
    writeBackup(readBackup().map((x) => (x.id === id ? moved : x)));
  },

  removeApplication: (id) => {
    set((s) => ({ applications: s.applications.filter((x) => x.id !== id) }));
    cloudApiSafe(cloudApi.deleteApplication)(id).catch((e) => {
      console.warn("[store] Application cloud delete failed:", e);
    });
    writeBackup(readBackup().filter((x) => x.id !== id));
  },

  dismissFollowUp: (id) => {
    get().updateApplication(id, { nextActionAt: null, nextActionNote: "" });
  },
});
