// ============================================================================
// Zustand Store — Resumes & Materials Slice
// ============================================================================

"use client";

import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type {
  ResumeData, JobDescription, CoverLetter, InterviewPackage, ATSReport,
  ResumeReviewReport, CareerMaterial
} from "../types";
import {
  SEED_RESUMES, SEED_JDS, SEED_COVER_LETTERS, SEED_INTERVIEW, SEED_ATS_REPORTS
} from "../mock-data";
import { normalizeJD, persistSession } from "./helpers";
import { api as cloudApi, cloudApiSafe } from "../cloud-api";
import { loadUserProfile, saveUserProfile } from "../agents/memory-agent";

const {
  createResume, updateResume: cloudUpdateResume, deleteResume,
  createJobDescription, deleteJobDescription,
  createCoverLetter, updateCoverLetter: cloudUpdateCoverLetter, deleteCoverLetter,
  createInterview, deleteInterview,
  createATSReport,
} = cloudApi;

export interface ResumesSlice {
  resumes: ResumeData[];
  jobDescriptions: JobDescription[];
  coverLetters: CoverLetter[];
  interviews: InterviewPackage[];
  atsReports: ATSReport[];
  careerMaterials: CareerMaterial[];
  reviewReports: ResumeReviewReport[];

  activeResumeId: string | null;
  activeJdId: string | null;
  activeCoverLetterId: string | null;
  activeInterviewId: string | null;

  addCareerMaterial: (title: string, contentText: string, category: "resume" | "cover_letter" | "certificate" | "project") => void;
  deleteCareerMaterial: (id: string) => void;
  fetchCareerMaterials: () => Promise<void>;

  addResume: (r: ResumeData) => void;
  updateResume: (id: string, patch: Partial<ResumeData>) => void;
  removeResume: (id: string) => void;
  setActiveResume: (id: string | null) => void;

  addJD: (j: JobDescription) => void;
  removeJD: (id: string) => void;
  setActiveJD: (id: string | null) => void;

  addCoverLetter: (c: CoverLetter) => void;
  updateCoverLetter: (id: string, patch: Partial<CoverLetter>) => void;
  removeCoverLetter: (id: string) => void;
  setActiveCoverLetter: (id: string | null) => void;

  addInterview: (i: InterviewPackage) => void;
  removeInterview: (id: string) => void;
  setActiveInterview: (id: string | null) => void;

  addATSReport: (r: ATSReport) => void;

  addReviewReport: (r: ResumeReviewReport) => void;
  updateReviewReport: (id: string, patch: Partial<ResumeReviewReport>) => void;
  removeReviewReport: (id: string) => void;
}

export const createResumesSlice: StateCreator<AppState, [], [], ResumesSlice> = (set, get) => ({
  resumes: SEED_RESUMES,
  jobDescriptions: SEED_JDS,
  coverLetters: SEED_COVER_LETTERS,
  interviews: SEED_INTERVIEW,
  atsReports: SEED_ATS_REPORTS,
  careerMaterials: [],
  reviewReports: [],

  activeResumeId: SEED_RESUMES[0]?.id ?? null,
  activeJdId: SEED_JDS[0]?.id ?? null,
  activeCoverLetterId: SEED_COVER_LETTERS[0]?.id ?? null,
  activeInterviewId: SEED_INTERVIEW[0]?.id ?? null,

  addCareerMaterial: (title, contentText, category) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const newItem: CareerMaterial = {
      id,
      title,
      contentText,
      category,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    set((s) => ({ careerMaterials: [newItem, ...s.careerMaterials] }));
    cloudApiSafe(cloudApi.createCareerMaterial)(newItem).catch((e) => {
      console.warn("[store] Career material cloud sync failed:", e);
    });
  },

  deleteCareerMaterial: (id) => {
    set((s) => ({ careerMaterials: s.careerMaterials.filter((m) => m.id !== id) }));
    cloudApiSafe(cloudApi.deleteCareerMaterial)(id).catch((e) => {
      console.warn("[store] Career material cloud delete failed:", e);
    });
  },

  fetchCareerMaterials: async () => {
    try {
      const resp = await cloudApi.getCareerMaterials();
      if (resp && resp.careerMaterials) {
        set({ careerMaterials: resp.careerMaterials });
      }
    } catch (e) {
      console.warn("[store] Failed to fetch career materials:", e);
    }
  },

  addResume: (r) => {
    set((s) => ({ resumes: [r, ...s.resumes] }));
    cloudApiSafe(createResume)(r).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-resumes-backup") || "[]");
        localStorage.setItem("resumeai-resumes-backup", JSON.stringify([r, ...existing.filter((x: any) => x.id !== r.id)].slice(0, 50)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  updateResume: (id, patch) => {
    try {
      const currentResume = get().resumes.find((r) => r.id === id);
      if (currentResume) {
        if (patch.experience) {
          const profile = loadUserProfile();
          let profileChanged = false;

          for (const patchedExp of patch.experience) {
            const currentExp = currentResume.experience.find(e => e.id === patchedExp.id);
            if (currentExp && patchedExp.bullets && currentExp.bullets) {
              const minLen = Math.min(patchedExp.bullets.length, currentExp.bullets.length);
              for (let i = 0; i < minLen; i++) {
                const original = currentExp.bullets[i]?.trim();
                const edited = patchedExp.bullets[i]?.trim();
                if (original && edited && original !== edited) {
                  if (original.length > 10 && edited.length > 10) {
                    const exists = (profile.manualOverrides || []).some((o: any) => o.original === original);
                    if (!exists) {
                      if (!profile.manualOverrides) profile.manualOverrides = [];
                      profile.manualOverrides.push({
                        original,
                        edited,
                        timestamp: new Date().toISOString()
                      });
                      if (profile.manualOverrides.length > 20) {
                        profile.manualOverrides.shift();
                      }
                      profileChanged = true;
                    }
                  }
                }
              }
            }
          }

          if (profileChanged) {
            saveUserProfile(profile);
            console.log(`[MemoryAgent] Saved user writing style preference from manual override.`);
          }
        }
      }
    } catch (e) {
      console.warn("[store] Failed to learn from user edits:", e);
    }

    set((s) => ({
      resumes: s.resumes.map((r) =>
        r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
      ),
    }));
    cloudApiSafe(cloudUpdateResume)(id, patch).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-resumes-backup") || "[]");
        const updated = existing.map((r: any) => r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r);
        localStorage.setItem("resumeai-resumes-backup", JSON.stringify(updated));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  removeResume: (id) => {
    set((s) => ({
      resumes: s.resumes.filter((r) => r.id !== id),
      activeResumeId: s.activeResumeId === id ? s.resumes[0]?.id ?? null : s.activeResumeId,
    }));
    cloudApiSafe(deleteResume)(id).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
  },

  setActiveResume: (id) => set({ activeResumeId: id }),

  addJD: (j) => {
    const safeJ = normalizeJD(j);
    set((s) => ({ jobDescriptions: [safeJ, ...s.jobDescriptions] }));
    cloudApiSafe(createJobDescription)(safeJ).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-jds-backup") || "[]");
        localStorage.setItem("resumeai-jds-backup", JSON.stringify([safeJ, ...existing.filter((x: any) => x.id !== safeJ.id)].slice(0, 100)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  removeJD: (id) => {
    set((s) => ({
      jobDescriptions: s.jobDescriptions.filter((j) => j.id !== id),
      activeJdId: s.activeJdId === id ? (s.jobDescriptions.find((j) => j.id !== id)?.id ?? null) : s.activeJdId,
    }));
    cloudApiSafe(deleteJobDescription)(id).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-jds-backup") || "[]");
        localStorage.setItem("resumeai-jds-backup", JSON.stringify(existing.filter((x: any) => x.id !== id)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  setActiveJD: (id) => set({ activeJdId: id }),

  addCoverLetter: (c) => {
    set((s) => ({ coverLetters: [c, ...s.coverLetters] }));
    cloudApiSafe(createCoverLetter)(c).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-coverletters-backup") || "[]");
        localStorage.setItem("resumeai-coverletters-backup", JSON.stringify([c, ...existing.filter((x: any) => x.id !== c.id)].slice(0, 50)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  updateCoverLetter: (id, patch) => {
    set((s) => ({
      coverLetters: s.coverLetters.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c
      ),
    }));
    cloudApiSafe(cloudUpdateCoverLetter)(id, patch).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-coverletters-backup") || "[]");
        const updated = existing.map((x: any) => x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x);
        localStorage.setItem("resumeai-coverletters-backup", JSON.stringify(updated));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  removeCoverLetter: (id) => {
    set((s) => ({ coverLetters: s.coverLetters.filter((c) => c.id !== id) }));
    cloudApiSafe(deleteCoverLetter)(id).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-coverletters-backup") || "[]");
        localStorage.setItem("resumeai-coverletters-backup", JSON.stringify(existing.filter((x: any) => x.id !== id)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  setActiveCoverLetter: (id) => set({ activeCoverLetterId: id }),

  addInterview: (i) => {
    set((s) => ({ interviews: [i, ...s.interviews] }));
    cloudApiSafe(createInterview)(i).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-interviews-backup") || "[]");
        localStorage.setItem("resumeai-interviews-backup", JSON.stringify([i, ...existing.filter((x: any) => x.id !== i.id)].slice(0, 50)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  removeInterview: (id) => {
    set((s) => ({ interviews: s.interviews.filter((i) => i.id !== id) }));
    cloudApiSafe(deleteInterview)(id).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-interviews-backup") || "[]");
        localStorage.setItem("resumeai-interviews-backup", JSON.stringify(existing.filter((x: any) => x.id !== id)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  setActiveInterview: (id) => set({ activeInterviewId: id }),

  addATSReport: (r) => {
    set((s) => ({ atsReports: [r, ...s.atsReports] }));
    cloudApiSafe(createATSReport)(r).catch((e) => { console.warn("[store] Cloud sync failed:", e); });
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-ats-backup") || "[]");
        localStorage.setItem("resumeai-ats-backup", JSON.stringify([r, ...existing.filter((x: any) => x.id !== r.id)].slice(0, 50)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  addReviewReport: (r) => {
    set((s) => ({ reviewReports: [r, ...s.reviewReports] }));
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-review-reports-backup") || "[]");
        localStorage.setItem("resumeai-review-reports-backup", JSON.stringify([r, ...existing.filter((x: any) => x.id !== r.id)].slice(0, 30)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  updateReviewReport: (id, patch) => {
    set((s) => ({
      reviewReports: s.reviewReports.map((r) =>
        r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
      ),
    }));
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-review-reports-backup") || "[]");
        const updated = existing.map((r: any) => r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r);
        localStorage.setItem("resumeai-review-reports-backup", JSON.stringify(updated));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },

  removeReviewReport: (id) => {
    set((s) => ({ reviewReports: s.reviewReports.filter((r) => r.id !== id) }));
    if (typeof localStorage !== "undefined") {
      try {
        const existing = JSON.parse(localStorage.getItem("resumeai-review-reports-backup") || "[]");
        localStorage.setItem("resumeai-review-reports-backup", JSON.stringify(existing.filter((x: any) => x.id !== id)));
      } catch (syncErr) { console.warn("[store] Operation failed:", syncErr); }
    }
  },
});
