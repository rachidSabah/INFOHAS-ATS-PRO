"use client";

// ============================================================================
// Phase 8.1.5 — shared UI hook that assembles InterviewIntelligenceInput from
// the store and returns CandidateIntelligence via the EXISTING builder.
// This centralizes the (presentational) assembly so recruiter / analytics /
// reports / explainability views don't duplicate it. NO business logic —
// buildCandidateIntelligence owns all computation.
// ============================================================================

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { buildCandidateIntelligence } from "@/lib/recruiter/candidate-intelligence";
import type { CandidateIntelligence, InterviewIntelligenceInput } from "@/lib/recruiter/recruiter-types";
import type { InterviewMemory } from "@/lib/interview/adaptive";
import type { FlightRecord } from "@/lib/ai/flight-recorder";
import type { InterviewSessionRecord } from "@/hooks/interview/types";

export interface SessionIntelligence {
  sessions: InterviewSessionRecord[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  activeSession: InterviewSessionRecord | null;
  ci: CandidateIntelligence | null;
}

export function useSessionIntelligence(): SessionIntelligence {
  const interviewSessions = useApp((s) => s.interviewSessions);
  const atsReports = useApp((s) => s.atsReports);
  const reviewReports = useApp((s) => s.reviewReports);
  const flightRecords = useApp((s) => s.flightRecords);

  const sessions = useMemo(
    () => interviewSessions.filter((s) => s.status === "completed" && s.memory),
    [interviewSessions],
  );

  const [selectedId, setSelectedId] = useState<string | null>(sessions[0]?.id ?? null);
  const activeSession = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;

  const ci = useMemo(() => {
    if (!activeSession) return null;
    const memory = activeSession.memory as InterviewMemory | undefined;
    const sessionRecords = (activeSession.records ?? []) as FlightRecord[];
    const records = [...sessionRecords, ...flightRecords];
    const resumeId = activeSession.resumeId;
    const atsReport = atsReports.find((a) => a.resumeId === resumeId) ?? null;
    const reviewReport =
      reviewReports.find((r) => r.resumeId === resumeId && (!r.jdId || r.jdId === activeSession.jdId)) ??
      reviewReports.find((r) => r.resumeId === resumeId) ??
      null;
    const companyProfile = (memory as unknown as { companyProfile?: InterviewIntelligenceInput["companyProfile"] } | undefined)?.companyProfile ?? null;
    const input: InterviewIntelligenceInput = {
      memory,
      records: records.length ? records : undefined,
      atsReport,
      reviewReport,
      companyProfile,
      scenario: activeSession.company,
      persona: activeSession.role,
      position: activeSession.role,
    };
    return buildCandidateIntelligence(input);
  }, [activeSession, atsReports, reviewReports, flightRecords]);

  return { sessions, selectedId: activeSession?.id ?? null, setSelectedId, activeSession, ci };
}
