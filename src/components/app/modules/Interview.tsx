"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI, extractJSON } from "@/lib/ai";
import { detectIndustry, INDUSTRY_PROFILES } from "@/lib/industry-ats";
import { exportInterviewPDF, exportInterviewDOCX } from "@/lib/exporter";
import { InterviewSession, InterviewSkeleton } from "@/components/interview/InterviewSession";
import { toast } from "sonner";
import type { InterviewPackage, InterviewQuestion } from "@/lib/types";

const CATEGORIES = [
  { id: "technical", label: "Technical", icon: "Code2", color: "#1154A3" },
  { id: "behavioral", label: "Behavioral", icon: "Users", color: "#F59E0B" },
  { id: "situational", label: "Situational", icon: "GitBranch", color: "#10B981" },
  { id: "hr", label: "HR", icon: "UserCheck", color: "#8B5CF6" },
  { id: "company", label: "Company-specific", icon: "Building2", color: "#EC4899" },
] as const;

const DIFFICULTY_COLORS: Record<string, string> = { easy: "#10B981", medium: "#F59E0B", hard: "#DC2626" };

export function Interview() {
  const interviews = useApp((s) => s.interviews);
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const addInterview = useApp((s) => s.addInterview);
  const removeInterview = useApp((s) => s.removeInterview);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);
  const setView = useApp((s) => s.setView);

  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [practiceSession, setPracticeSession] = useState<InterviewPackage | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string>(resumes[0]?.id ?? "");
  const [selectedJdId, setSelectedJdId] = useState<string>(jds[0]?.id ?? "");
  const [completedQuestions, setCompletedQuestions] = useState<Set<string>>(new Set());
  const [readinessData, setReadinessData] = useState<{ score: number; strengths: string[]; weaknesses: string[]; topicsToReview: string[]; skillsToReview: string[]; focusAreas: string[] } | null>(null);

  // === Auto-detect context ===
  const selectedResume = resumes.find((r) => r.id === selectedResumeId) ?? resumes[0] ?? null;
  const selectedJd = jds.find((j) => j.id === selectedJdId) ?? jds[0] ?? null;

  const industryDetection = useMemo(() => {
    if (!selectedJd) return null;
    const jdText = selectedJd.rawText ?? selectedJd.keywords.join(" ");
    const resumeText = `${selectedResume?.name ?? ""} ${selectedResume?.headline ?? ""} ${selectedResume?.summary ?? ""} ${selectedResume?.experience.map((e) => e.title + " " + e.company).join(" ")}`;
    return detectIndustry(jdText, resumeText);
  }, [selectedJd, selectedResume]);

  const industryProfile = industryDetection ? INDUSTRY_PROFILES[industryDetection.industryId] : null;

  // === Generate interview prep package ===
  const generate = async () => {
    if (!selectedResume) {
      toast.error("Please upload or create a resume first.");
      return;
    }
    if (!selectedJd) {
      toast.error("Please add a job description first.");
      return;
    }

    setGenerating(true);
    setReadinessData(null);
    try {
      const resumeContext = JSON.stringify({
        name: selectedResume.name,
        headline: selectedResume.headline,
        summary: selectedResume.summary,
        experience: selectedResume.experience.map((e) => ({
          title: e.title,
          company: e.company,
          location: e.location,
          bullets: e.bullets,
        })),
        skills: selectedResume.skills.map((s) => s.name),
        education: selectedResume.education.map((ed) => ({ degree: ed.degree, institution: ed.institution })),
        languages: selectedResume.languages.map((l) => l.name),
        certifications: selectedResume.certifications.map((c) => c.name),
      });

      const jdContext = selectedJd.rawText ?? JSON.stringify({
        title: selectedJd.title,
        company: selectedJd.company,
        responsibilities: selectedJd.responsibilities,
        requiredSkills: selectedJd.requiredSkills,
        preferredSkills: selectedJd.preferredSkills,
        keywords: selectedJd.keywords,
      });

      const industryContext = industryProfile ? `
INDUSTRY: ${industryProfile.label}
INDUSTRY KEYWORDS: ${industryProfile.priorityKeywords.join(", ")}
INDUSTRY WRITING GUIDANCE: ${industryProfile.writingGuidance}
` : "";

      const result = await callAI({
        systemPrompt: `You are an Expert Interview Coach and Senior Recruiter. You generate highly personalized interview preparation packages tailored to the candidate's resume and the job description. You NEVER ask about technologies or experiences not present in the resume. You NEVER fabricate answers — all answers reference real experience from the resume. You adapt questions to the detected industry. Always return ONLY valid JSON.

${industryContext}`,
        userPrompt: `CANDIDATE'S RESUME (primary source — use ONLY this information for answers):
${resumeContext}

JOB DESCRIPTION:
${jdContext}

COMPANY: ${selectedJd.company || "the company"}
JOB TITLE: ${selectedJd.title || "the role"}
INDUSTRY: ${industryProfile?.label || "Generic"}

Generate a comprehensive interview preparation package with 9-15 questions:
- 3-5 Technical questions (about technologies/skills IN the resume)
- 3-5 Behavioral questions (STAR method, past experiences from the resume)
- 2-3 Situational questions (hypothetical scenarios relevant to the role)
- 1-3 Company-specific questions (about the company's values/culture/products)

For each question provide:
- category: "technical" | "behavioral" | "situational" | "hr" | "company"
- question: the interview question
- difficulty: "easy" | "medium" | "hard"
- recommendedAnswer: recruiter-grade answer using the candidate's REAL experience
- talkingPoints: 3-5 bullet points for the answer
- starExample: { situation, task, action, result } (for behavioral/situational)
- followUps: 2-3 follow-up questions

Also provide:
- readinessScore: 0-100 (how prepared the candidate is)
- strengths: 3-5 areas where the candidate is strong
- weaknesses: 3-5 areas to improve
- topicsToReview: 3-5 topics to study before the interview
- skillsToReview: 3-5 skills to brush up on
- focusAreas: 3-5 likely interview focus areas for this role/company

Return JSON:
{
  "questions": [ { "category": "...", "question": "...", "difficulty": "...", "recommendedAnswer": "...", "talkingPoints": [...], "starExample": {...}, "followUps": [...] } ],
  "readinessScore": 78,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "topicsToReview": ["..."],
  "skillsToReview": ["..."],
  "focusAreas": ["..."]
}`,
        maxTokens: 6000,
        temperature: 0.5,
        taskCategory: "document",
      });

      let data: { questions: any[]; readinessScore?: number; strengths?: string[]; weaknesses?: string[]; topicsToReview?: string[]; skillsToReview?: string[]; focusAreas?: string[] };
      try {
        data = extractJSON<any>(result.text);
      } catch {
        throw new Error("Failed to parse AI response. Please try again.");
      }

      const questions: InterviewQuestion[] = (data.questions ?? []).map((q: any) => ({
        id: uid("q"),
        category: q.category || "hr",
        question: q.question || "",
        difficulty: q.difficulty || "medium",
        recommendedAnswer: q.recommendedAnswer || "",
        talkingPoints: Array.isArray(q.talkingPoints) ? q.talkingPoints : [],
        starExample: q.starExample,
        followUps: Array.isArray(q.followUps) ? q.followUps : [],
      }));

      if (!questions.length) throw new Error("AI returned no questions.");

      const pkg: InterviewPackage = {
        id: uid("iv"),
        resumeId: selectedResume.id,
        jdId: selectedJd.id,
        company: selectedJd.company,
        role: selectedJd.title,
        questions,
        createdAt: new Date().toISOString(),
      };
      addInterview(pkg);
      setReadinessData({
        score: data.readinessScore ?? 75,
        strengths: data.strengths ?? [],
        weaknesses: data.weaknesses ?? [],
        topicsToReview: data.topicsToReview ?? [],
        skillsToReview: data.skillsToReview ?? [],
        focusAreas: data.focusAreas ?? [],
      });
      setCompletedQuestions(new Set());
      incUsage("interviewPreps");
      log({
        actor: "you",
        action: "Interview prep generated (dynamic)",
        category: "ai",
        details: `${questions.length} questions · ${industryProfile?.label ?? "Generic"} · readiness ${data.readinessScore ?? 75}/100 via ${result.provider}`,
        severity: "info",
      });
      toast.success(`${questions.length} questions generated — readiness ${data.readinessScore ?? 75}/100`);
    } catch (e: any) {
      toast.error(e?.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const toggleCompleted = (qId: string) => {
    setCompletedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  };

  const grouped = (pkg: InterviewPackage) => {
    const g: Record<string, InterviewQuestion[]> = {};
    for (const q of pkg.questions) (g[q.category] ||= []).push(q);
    return g;
  };

  const latestPkg = interviews[0] ?? null;
  const prepPercent = latestPkg ? Math.round((completedQuestions.size / latestPkg.questions.length) * 100) : 0;

  // === Practice session mode ===
  if (practiceSession) {
    return <InterviewSession pkg={practiceSession} onClose={() => setPracticeSession(null)} />;
  }

  // === No resume state ===
  if (resumes.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="MessagesSquare" className="w-6 h-6 text-brand" /> Interview Prep</h1>
          <p className="text-sm text-muted-foreground mt-1">Dynamic, context-aware interview preparation tailored to your resume and job description.</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Icon name="FileText" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <h3 className="mt-3 font-semibold">Optimize a resume first</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">Upload and optimize a resume to generate personalized interview preparation with tailored questions and answers.</p>
            <Button onClick={() => setView("optimizer")} className="bg-brand hover:bg-brand-dark text-white gap-2 mt-4">
              <Icon name="Wand2" className="w-4 h-4" /> Go to Resume Optimizer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="MessagesSquare" className="w-6 h-6 text-brand" /> Interview Prep</h1>
          <p className="text-sm text-muted-foreground mt-1">Dynamic, context-aware interview preparation tailored to your resume and job description.</p>
        </div>
        <Button onClick={generate} disabled={generating || !selectedResume || !selectedJd} className="bg-brand hover:bg-brand-dark text-white gap-2">
          {generating ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
          {generating ? "Generating…" : "Generate package"}
        </Button>
      </div>

      {/* === Context selection === */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Select Resume</label>
              <select value={selectedResumeId} onChange={(e) => setSelectedResumeId(e.target.value)} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.headline ? ` — ${r.headline}` : ""}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Select Target Job</label>
              <select value={selectedJdId} onChange={(e) => setSelectedJdId(e.target.value)} className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm">
                <option value="">No job selected</option>
                {jds.map((j) => <option key={j.id} value={j.id}>{j.title}{j.company ? ` — ${j.company}` : ""}</option>)}
              </select>
            </div>
          </div>
          {industryDetection && industryDetection.confidence >= 15 && (
            <div className="grid sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-secondary/40 p-2 flex items-center justify-between">
                <span className="text-muted-foreground">Company:</span>
                <span className="font-semibold">{selectedJd?.company ?? "N/A"}</span>
              </div>
              <div className="rounded-lg bg-secondary/40 p-2 flex items-center justify-between">
                <span className="text-muted-foreground">Industry:</span>
                <span className="font-semibold">{industryProfile?.label ?? "Generic"}</span>
              </div>
              <div className="rounded-lg bg-secondary/40 p-2 flex items-center justify-between">
                <span className="text-muted-foreground">Role:</span>
                <span className="font-semibold">{selectedJd?.title ?? "N/A"}</span>
              </div>
            </div>
          )}
          {(!selectedResume || !selectedJd) && (
            <p className="text-xs text-amber-600">
              {!selectedResume ? "Select a resume. " : ""}
              {!selectedJd ? "Add and select a job description for tailored questions." : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {/* === Readiness Dashboard === */}
      {readinessData && (
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-4 flex-wrap mb-4">
              <ScoreRing value={readinessData.score} size={80} label="Readiness" />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm">Interview Readiness Dashboard</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {readinessData.score >= 80 ? "Excellent — you're well-prepared!" : readinessData.score >= 60 ? "Good — review the topics below." : "Needs work — focus on the areas below."}
                </p>
              </div>
              {latestPkg && (
                <div className="text-right">
                  <div className="text-xs font-semibold text-brand">{completedQuestions.size}/{latestPkg.questions.length}</div>
                  <div className="text-[10px] text-muted-foreground">completed</div>
                </div>
              )}
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {readinessData.strengths.length > 0 && (
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 mb-1">Strengths</div>
                <ul className="space-y-0.5">{readinessData.strengths.map((s, i) => <li key={i} className="text-xs flex gap-1"><span className="text-emerald-600">✓</span> {s}</li>)}</ul></div>
              )}
              {readinessData.weaknesses.length > 0 && (
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 mb-1">Weaknesses</div>
                <ul className="space-y-0.5">{readinessData.weaknesses.map((w, i) => <li key={i} className="text-xs flex gap-1"><span className="text-amber-600">→</span> {w}</li>)}</ul></div>
              )}
              {readinessData.focusAreas.length > 0 && (
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-brand mb-1">Focus Areas</div>
                <div className="flex flex-wrap gap-1">{readinessData.focusAreas.map((f, i) => <Badge key={i} variant="outline" className="text-[9px]">{f}</Badge>)}</div></div>
              )}
              {readinessData.topicsToReview.length > 0 && (
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-amber-500 mb-1">Topics To Review</div>
                <div className="flex flex-wrap gap-1">{readinessData.topicsToReview.map((t, i) => <Badge key={i} variant="warning" className="text-[9px]">{t}</Badge>)}</div></div>
              )}
              {readinessData.skillsToReview.length > 0 && (
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-red-500 mb-1">Skills To Review</div>
                <div className="flex flex-wrap gap-1">{readinessData.skillsToReview.map((s, i) => <Badge key={i} variant="warning" className="text-[9px]">{s}</Badge>)}</div></div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Progress tracker === */}
      {latestPkg && prepPercent > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-muted-foreground">Preparation Progress</span>
              <span className="font-bold text-brand">{prepPercent}%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-brand to-emerald-500 rounded-full transition-all" style={{ width: `${prepPercent}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Loading skeleton === */}
      {generating && <InterviewSkeleton />}

      {/* === Empty state === */}
      {!generating && interviews.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Icon name="MessagesSquare" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <h3 className="mt-3 font-semibold">No interview packages yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              {selectedResume && selectedJd
                ? "Click \"Generate package\" to create personalized interview questions with tailored answers."
                : "Select a resume and job description above, then generate."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* === Interview packages === */}
      {!generating && interviews.map((pkg) => {
        const g = grouped(pkg);
        return (
          <Card key={pkg.id}>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Icon name="Package" className="w-4 h-4 text-brand" />
                    {pkg.role ?? "Interview Prep"}{pkg.company ? ` at ${pkg.company}` : ""}
                  </CardTitle>
                  <CardDescription>{pkg.questions.length} questions · generated {new Date(pkg.createdAt).toLocaleDateString()}</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setPracticeSession(pkg)} className="gap-1.5 border-brand text-brand hover:bg-brand-light" title="Start interactive practice session">
                    <Icon name="Play" className="w-3.5 h-3.5" /> Practice
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { exportInterviewDOCX(pkg); incUsage("downloads"); toast.success("DOCX exported."); }} className="gap-1.5"><Icon name="FileType" className="w-3.5 h-3.5" /> DOCX</Button>
                  <Button size="sm" onClick={() => { exportInterviewPDF(pkg); incUsage("downloads"); log({ actor: "you", action: "Interview prep exported (PDF)", category: "export", details: `${pkg.role}.pdf`, severity: "info" }); toast.success("PDF exported."); }} className="bg-brand hover:bg-brand-dark text-white gap-1.5"><Icon name="Download" className="w-3.5 h-3.5" /> PDF</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { removeInterview(pkg.id); toast.success("Deleted."); }}><Icon name="Trash2" className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Category summary */}
              <div className="flex flex-wrap gap-2 mb-4">
                {CATEGORIES.map((c) => {
                  const n = g[c.id]?.length ?? 0;
                  if (!n) return null;
                  return (
                    <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: `${c.color}15`, color: c.color }}>
                      <Icon name={c.icon} className="w-3.5 h-3.5" /> {c.label}: <span className="font-bold">{n}</span>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3">
                {pkg.questions.map((q, i) => {
                  const cat = CATEGORIES.find((c) => c.id === q.category) ?? CATEGORIES[0];
                  const isOpen = expanded === q.id;
                  const isCompleted = completedQuestions.has(q.id);
                  return (
                    <div key={q.id} className={`rounded-xl border overflow-hidden transition ${isCompleted ? "border-emerald-300 bg-emerald-50/30 dark:bg-emerald-950/10" : "border-border"}`}>
                      <div className="flex items-stretch">
                        <button
                          onClick={() => toggleCompleted(q.id)}
                          className="shrink-0 w-8 flex items-center justify-center hover:bg-secondary/50 transition"
                          title={isCompleted ? "Mark as not completed" : "Mark as completed"}
                        >
                          <Icon name={isCompleted ? "CheckCircle2" : "Circle"} className={`w-4 h-4 ${isCompleted ? "text-emerald-600" : "text-muted-foreground"}`} />
                        </button>
                        <button onClick={() => setExpanded(isOpen ? null : q.id)} className="flex-1 flex items-start gap-3 p-4 text-left hover:bg-secondary/50 transition min-w-0">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cat.color}15`, color: cat.color }}>
                            <Icon name={cat.icon} className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: cat.color }}>{cat.label}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${DIFFICULTY_COLORS[q.difficulty]}20`, color: DIFFICULTY_COLORS[q.difficulty] }}>{q.difficulty}</span>
                              {isCompleted && <span className="text-[10px] text-emerald-600 font-medium">✓ completed</span>}
                            </div>
                            <div className={`font-semibold text-sm text-pretty ${isCompleted ? "line-through opacity-60" : ""}`}>{i + 1}. {q.question}</div>
                          </div>
                          <Icon name="ChevronDown" className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                      {isOpen && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="overflow-hidden">
                          <div className="p-4 pt-0 space-y-3 text-sm">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Recommended Answer</div>
                              <p className="text-foreground/90 text-pretty">{q.recommendedAnswer}</p>
                            </div>
                            {q.talkingPoints?.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Talking Points</div>
                                <ul className="space-y-0.5">{q.talkingPoints.map((t, j) => <li key={j} className="flex gap-2"><span className="text-brand">›</span> <span>{t}</span></li>)}</ul>
                              </div>
                            )}
                            {q.starExample && (
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">STAR Example</div>
                                <div className="rounded-lg bg-secondary p-3 space-y-1 text-xs">
                                  <div><span className="font-semibold text-brand">Situation:</span> {q.starExample.situation}</div>
                                  <div><span className="font-semibold text-brand">Task:</span> {q.starExample.task}</div>
                                  <div><span className="font-semibold text-brand">Action:</span> {q.starExample.action}</div>
                                  <div><span className="font-semibold text-brand">Result:</span> {q.starExample.result}</div>
                                </div>
                              </div>
                            )}
                            {q.followUps?.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Follow-Up Questions</div>
                                <ul className="space-y-0.5">{q.followUps.map((f, j) => <li key={j} className="flex gap-2 text-xs"><span className="text-gold">?</span> <span>{f}</span></li>)}</ul>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
