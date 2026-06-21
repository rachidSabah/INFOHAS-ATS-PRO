"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useApp } from "@/lib/store";
import {
  getSupervisorState,
  subscribeToSupervisor,
  setContext,
} from "@/lib/agents/supervisor";
import type { GlobalPipelineContext, AgentState } from "@/lib/agents/pipeline-context";
import type { UserProfile } from "@/lib/agents/memory-agent";
import type { ResumeData, JobDescription } from "@/lib/types";

/**
 * usePipelineContext — the single hook every career module uses to:
 *
 *   1. Auto-detect the active resume, JD, company, and industry (no manual
 *      copy/paste required).
 *   2. Read the shared GlobalPipelineContext (intelligence from all agents).
 *   3. Read the user's persistent memory profile (skills, certs, history).
 *   4. Read every agent's status (for the pipeline visualization).
 *   5. Update the context when the user changes their selection.
 *
 * Usage:
 *   const { context, profile, agents, setResume, setJD } = usePipelineContext();
 */
export function usePipelineContext() {
  // Subscribe to the supervisor's external store (useSyncExternalStore is
  // React 19's recommended way to subscribe to external state — no tearing,
  // no concurrent-mode bugs).
  const supervisorState = useSyncExternalStore(
    subscribeToSupervisor,
    getSupervisorState,
    getSupervisorState, // server snapshot (same — SSR-safe because the store starts empty)
  );

  // Also subscribe to the Zustand store so we auto-detect when resumes/JDs change
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const activeResumeId = useApp((s) => s.activeResumeId);
  const activeJdId = useApp((s) => s.activeJdId);

  // Auto-detect the active resume + JD (fall back to most recent)
  const activeResume: ResumeData | null =
    resumes.find((r) => r.id === activeResumeId) ??
    resumes.find((r) => r.source !== "ai-optimized") ??
    resumes[0] ??
    null;
  const activeJD: JobDescription | null =
    jds.find((j) => j.id === activeJdId) ??
    jds[0] ??
    null;

  // Auto-sync the supervisor context whenever the active resume or JD changes
  // (but only if the supervisor doesn't already have a more specific selection).
  useEffect(() => {
    const ctx = supervisorState.context;
    const resumeChanged = activeResume && ctx.resumeId !== activeResume.id;
    const jdChanged = activeJD && ctx.jobId !== activeJD.id;
    if (resumeChanged || jdChanged) {
      setContext({
        resume: activeResume,
        jd: activeJD,
        companyName: activeJD?.company ?? null,
      });
    }
  }, [activeResumeId, activeJdId]);

  return {
    // === Shared context (intelligence from all agents) ===
    context: supervisorState.context as GlobalPipelineContext,
    // === User memory profile ===
    profile: supervisorState.profile as UserProfile,
    // === Agent statuses (for pipeline visualization) ===
    agents: supervisorState.agents as Record<string, AgentState>,
    // === Auto-detected active selections ===
    activeResume,
    activeJD,
    activeCompany: supervisorState.context.companyName ?? activeJD?.company ?? null,
    activeIndustry: supervisorState.context.industry ?? null,
    activeJobTitle: supervisorState.context.jobTitle ?? activeJD?.title ?? null,
    // === Is any agent currently running? ===
    isRunning: supervisorState.isRunning,
    // === Recent events ===
    events: supervisorState.events,
    // === Context setters ===
    setResume: (resume: ResumeData | null) => setContext({ resume }),
    setJD: (jd: JobDescription | null) => setContext({ jd }),
    setCompany: (company: string | null) => setContext({ companyName: company }),
    setIndustry: (industry: string | null) => setContext({ industry }),
  };
}
