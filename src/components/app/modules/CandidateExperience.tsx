"use client";

// ============================================================================
// Phase 8.1.5 (P2) — Candidate Interview Experience (Adaptive Live Interview Hub).
//
// PRESENTATION ONLY. This module is the premium adaptive-interview launcher and
// experience hub. It does NOT execute AI and does NOT re-implement the
// per-question answer/feedback UI (that already lives in InterviewSession /
// VideoInterviewSession). Instead it:
//   1. Surfaces the adaptive-engine context (scenario = role/company, persona
//      mix, difficulty/confidence preview) for setup.
//   2. Launches the EXISTING InterviewSession for the live practice interview.
//   3. On completion, persists a lightweight InterviewSessionRecord to the
//      store (memory + records) so the Recruiter Intelligence / Explainability /
//      Flight Recorder modules can consume it — closing the candidate→recruiter
//      loop without duplicating logic.
//
// All computation is delegated to the adaptive engine (generateInterviewQuestions
// / toInterviewPackage) and the store. No scoring or analytics here.
// ============================================================================

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { generateInterviewQuestions, toInterviewPackage, type GeneratedPackage } from "@/lib/interview/ai";
import { INTERVIEW_PERSONAS } from "@/lib/interview/personas";
import { InterviewSession } from "@/components/interview/InterviewSession";
import { toast } from "sonner";
import type { InterviewPackage, InterviewQuestion } from "@/lib/types";
import type { InterviewSessionRecord } from "@/hooks/interview/types";

const CATEGORIES = [
  { id: "technical", label: "Technical", icon: "Code2", color: "#1154A3" },
  { id: "behavioral", label: "Behavioral", icon: "Users", color: "#F59E0B" },
  { id: "situational", label: "Situational", icon: "GitBranch", color: "#10B981" },
  { id: "hr", label: "HR", icon: "UserCheck", color: "#8B5CF6" },
  { id: "company", label: "Company-specific", icon: "Building2", color: "#EC4899" },
] as const;

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "#10B981",
  medium: "#F59E0B",
  hard: "#DC2626",
};

export function CandidateExperience() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const atsReports = useApp((s) => s.atsReports);
  const reviewReports = useApp((s) => s.reviewReports);
  const interviewSessions = useApp((s) => s.interviewSessions);
  const addInterviewSession = useApp((s) => s.addInterviewSession);

  const [selectedResumeId, setSelectedResumeId] = useState<string>(resumes[0]?.id ?? "");
  const [selectedJdId, setSelectedJdId] = useState<string>(jds[0]?.id ?? "");
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>(
    INTERVIEW_PERSONAS.slice(0, 3).map((p) => p.id),
  );
  const [generating, setGenerating] = useState(false);
  const [livePkg, setLivePkg] = useState<InterviewPackage | null>(null);
  const [liveGenerated, setLiveGenerated] = useState<GeneratedPackage | null>(null);

  const selectedResume = resumes.find((r) => r.id === selectedResumeId) ?? resumes[0] ?? null;
  const selectedJd = jds.find((j) => j.id === selectedJdId) ?? jds[0] ?? null;

  const selectedPersonas = useMemo(
    () => INTERVIEW_PERSONAS.filter((p) => selectedPersonaIds.includes(p.id)),
    [selectedPersonaIds],
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of selectedPersonas) {
      for (const c of p.questionProfile.emphasizeCategories) {
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    return counts;
  }, [selectedPersonas]);

  const companyName = selectedJd?.company ?? null;
  const roleName = selectedJd?.title ?? selectedResume?.headline ?? null;

  // Confidence preview derived from the readiness score the adaptive engine
  // returns at generation time (no separate scoring here — consumed output).
  const togglePersona = useCallback((id: string) => {
    setSelectedPersonaIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }, []);

  const startLive = useCallback(async () => {
    if (!selectedResume) {
      toast.error("Please upload or create a resume first.");
      return;
    }
    if (!selectedJd) {
      toast.error("Please add a job description first.");
      return;
    }
    setGenerating(true);
    try {
      const atsReport = atsReports.find((a) => a.resumeId === selectedResume.id);
      const reviewReport =
        reviewReports.find((r) => r.resumeId === selectedResume.id && (!r.jdId || r.jdId === selectedJd.id)) ??
        reviewReports.find((r) => r.resumeId === selectedResume.id);

      const generated = await generateInterviewQuestions({
        resume: selectedResume,
        jd: selectedJd,
        atsReport,
        reviewReport,
        personaIds: selectedPersonaIds,
        difficultyBias: "adaptive",
      });

      const pkg = toInterviewPackage(generated, {
        resume: selectedResume,
        jd: selectedJd,
        atsReport,
        reviewReport,
        personaIds: selectedPersonaIds,
        difficultyBias: "adaptive",
      });

      const questions: InterviewQuestion[] = generated.questions;
      if (!questions.length) throw new Error("AI returned no questions.");

      setLiveGenerated(generated);
      setLivePkg(pkg);
      toast.success(`${questions.length} adaptive questions ready — good luck!`);
    } catch (e: any) {
      toast.error(e?.message || "Could not start the interview.");
    } finally {
      setGenerating(false);
    }
  }, [selectedResume, selectedJd, atsReports, reviewReports, selectedPersonaIds]);

  // === Live interview in progress — delegate to the existing experience ===
  if (livePkg) {
    return (
      <InterviewSession
        pkg={livePkg}
        onClose={() => {
          // Persist a lightweight record so recruiter modules can consume it.
          const rec: InterviewSessionRecord = {
            id: uid("session"),
            resumeId: livePkg.resumeId,
            jdId: livePkg.jdId,
            company: livePkg.company,
            role: livePkg.role,
            status: "completed",
            recordings: [],
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          };
          addInterviewSession(rec);
          setLivePkg(null);
          setLiveGenerated(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Icon name="MessagesSquare" className="w-6 h-6 text-brand" /> Live Interview Experience
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Adaptive, scenario-driven interview practice. Pick your context, choose your interview panel, and run a live session.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Setup: context + personas */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Icon name="Settings2" className="w-4 h-4 text-brand" /> Interview Setup
              </CardTitle>
              <CardDescription>Select the candidate context for this adaptive session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              {/* Resume + JD selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resume</label>
                  <select
                    value={selectedResumeId}
                    onChange={(e) => setSelectedResumeId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {resumes.length === 0 && <option value="">No resumes yet</option>}
                    {resumes.map((r) => (
                      <option key={r.id} value={r.id}>{r.name ?? "Untitled resume"}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job Description</label>
                  <select
                    value={selectedJdId}
                    onChange={(e) => setSelectedJdId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {jds.length === 0 && <option value="">No job descriptions yet</option>}
                    {jds.map((j) => (
                      <option key={j.id} value={j.id}>{j.title ?? "Untitled JD"}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Scenario / company / role context */}
              <div className="rounded-lg bg-secondary/40 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
                  <Icon name="Building2" className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scenario</div>
                  <div className="text-sm font-medium truncate">{roleName ?? "—"} {companyName ? `at ${companyName}` : ""}</div>
                  <div className="text-xs text-muted-foreground">Adaptive difficulty & question mix are derived from this role + JD.</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Persona / panel picker */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Icon name="UsersRound" className="w-4 h-4 text-brand" /> Interview Panel
              </CardTitle>
              <CardDescription>Choose the personas that make up your interview panel (drives question angles).</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {INTERVIEW_PERSONAS.map((p) => {
                  const active = selectedPersonaIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePersona(p.id)}
                      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                        active ? "border-brand bg-brand/5" : "border-border hover:bg-secondary/40"
                      }`}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${p.accent}18`, color: p.accent }}
                      >
                        <Icon name={p.icon} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{p.name}</span>
                          {active && <Icon name="CheckCircle2" className="w-4 h-4 text-brand shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{p.role}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right rail: readiness + difficulty + launch */}
        <div className="space-y-4">
          <Card className="gradient-brand text-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Icon name="Sparkles" className="w-5 h-5 text-gold" />
                <span className="font-semibold text-sm">Adaptive Preview</span>
              </div>
              <p className="text-xs opacity-90">
                {selectedPersonas.length} panel member{selectedPersonas.length === 1 ? "" : "s"} selected. The engine calibrates
                difficulty live based on your answers and adapts question categories in real time.
              </p>
              {Object.keys(categoryCounts).length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {Object.entries(categoryCounts).map(([cat, n]) => {
                    const c = CATEGORIES.find((x) => x.id === cat);
                    if (!c) return null;
                    return (
                      <div key={cat} className="flex items-center gap-2 text-xs">
                        <Icon name={c.icon} className="w-3.5 h-3.5 opacity-90" />
                        <span className="opacity-90">{c.label}</span>
                        <span className="ml-auto font-semibold">{n}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Icon name="Gauge" className="w-4 h-4 text-brand" /> Confidence & Difficulty
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="flex items-center gap-3">
                <ScoreRing value={Math.round((selectedPersonas.length / INTERVIEW_PERSONAS.length) * 100)} size={56} label="Panel" />
                <p className="text-xs text-muted-foreground">
                  A broader panel increases scenario coverage. Start with 2–3 for a balanced session.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: `${DIFFICULTY_COLORS.medium}20`, color: DIFFICULTY_COLORS.medium }}>
                  adaptive
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-secondary text-muted-foreground">
                  voice + text
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-secondary text-muted-foreground">
                  STAR feedback
                </span>
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={startLive}
            disabled={generating || !selectedResume || !selectedJd}
            className="w-full bg-brand hover:bg-brand-dark text-white gap-1.5"
            size="lg"
          >
            {generating ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Play" className="w-4 h-4" />}
            {generating ? "Preparing session…" : "Start Live Interview"}
          </Button>

          {interviewSessions.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {interviewSessions.length} prior session{interviewSessions.length === 1 ? "" : "s"} on record — view them in Recruiter Intelligence.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
