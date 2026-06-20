"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI, extractJSON } from "@/lib/ai";
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

  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [practiceSession, setPracticeSession] = useState<InterviewPackage | null>(null);

  const generate = async () => {
    setGenerating(true);
    try {
      const resume = resumes[0];
      const jd = jds[0];
      const result = await callAI({
        systemPrompt: "You are an expert interview coach. Generate a balanced interview prep package. Return ONLY valid JSON.",
        userPrompt: `Generate an interview prep package for ${jd?.title ?? "the role"}${jd?.company ? ` at ${jd.company}` : ""}.\n\nCandidate resume:\n${resume ? JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, experience: resume.experience.map(e => ({ title: e.title, company: e.company, bullets: e.bullets })), skills: resume.skills.map(s => s.name) }) : "(no resume)"}\n\nJob description:\n${jd ? (jd.rawText ?? JSON.stringify({ title: jd.title, company: jd.company, responsibilities: jd.responsibilities, requiredSkills: jd.requiredSkills })) : "(no JD)"}\n\nReturn JSON: { "questions": [ { "category": "technical|behavioral|situational|hr|company", "question": "...", "difficulty": "easy|medium|hard", "recommendedAnswer": "...", "talkingPoints": ["...","...","..."], "starExample": { "situation": "...", "task": "...", "action": "...", "result": "..." }, "followUps": ["...","..."] } ] }\n\nInclude 3 technical, 3 behavioral, 2 situational, 2 HR, and 2 company-specific questions.`,
        maxTokens: 4000,
        taskCategory: "document",
      });

      let questions: InterviewQuestion[];
      try {
        // Use the robust extractJSON helper — handles prose preambles, fences,
        // trailing commentary. The local fallback engine already returns valid
        // JSON, so this will succeed for both AI and local-engine responses.
        const parsed = extractJSON<{ questions: any[] }>(result.text);
        questions = (parsed.questions ?? []).map((q: any) => ({ id: uid("q"), ...q }));
      } catch (parseErr: any) {
        console.warn("[Interview] extractJSON failed:", parseErr?.message);
        // Last resort: empty questions — the toast below will tell the user.
        questions = [];
      }

      if (!questions.length) throw new Error("AI returned no questions.");

      const pkg: InterviewPackage = {
        id: uid("iv"),
        resumeId: resume?.id,
        jdId: jd?.id,
        company: jd?.company,
        role: jd?.title,
        questions,
        createdAt: new Date().toISOString(),
      };
      addInterview(pkg);
      incUsage("interviewPreps");
      log({ actor: "you", action: "Interview prep generated", category: "ai", details: `${questions.length} questions via ${result.provider}`, severity: "info" });
      toast.success(`${questions.length} questions generated via ${result.provider}.`);
    } catch (e: any) {
      toast.error(e?.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const grouped = (pkg: InterviewPackage) => {
    const g: Record<string, InterviewQuestion[]> = {};
    for (const q of pkg.questions) (g[q.category] ||= []).push(q);
    return g;
  };

  return (
    <div className="space-y-6">
      {/* === Practice session mode (replaces the list view when active) === */}
      {practiceSession ? (
        <InterviewSession pkg={practiceSession} onClose={() => setPracticeSession(null)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="MessagesSquare" className="w-6 h-6 text-brand" /> Interview Prep</h1>
              <p className="text-sm text-muted-foreground mt-1">Technical, behavioral, situational, HR, and company-specific questions — with STAR answers and follow-ups.</p>
            </div>
            <Button onClick={generate} disabled={generating} className="bg-brand hover:bg-brand-dark text-white gap-2">
              {generating ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
              {generating ? "Generating…" : "Generate package"}
            </Button>
          </div>

      {generating ? (
        <InterviewSkeleton />
      ) : interviews.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Icon name="MessagesSquare" className="w-12 h-12 text-muted-foreground/40 mx-auto" />
            <h3 className="mt-3 font-semibold">No interview packages yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Click "Generate package" to create your first one.</p>
          </CardContent>
        </Card>
      ) : (
        interviews.map((pkg) => {
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
                    const cat = CATEGORIES.find((c) => c.id === q.category)!;
                    const isOpen = expanded === q.id;
                    return (
                      <motion.div key={q.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="rounded-xl border border-border overflow-hidden">
                        <button onClick={() => setExpanded(isOpen ? null : q.id)} className="w-full flex items-start gap-3 p-4 text-left hover:bg-secondary/50 transition">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cat.color}15`, color: cat.color }}>
                            <Icon name={cat.icon} className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: cat.color }}>{cat.label}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${DIFFICULTY_COLORS[q.difficulty]}20`, color: DIFFICULTY_COLORS[q.difficulty] }}>{q.difficulty}</span>
                            </div>
                            <div className="font-semibold text-sm text-pretty">{i + 1}. {q.question}</div>
                          </div>
                          <Icon name="ChevronDown" className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                        {isOpen && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="overflow-hidden">
                            <div className="p-4 pt-0 space-y-3 text-sm">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Recommended answer</div>
                                <p className="text-foreground/90 text-pretty">{q.recommendedAnswer}</p>
                              </div>
                              {q.talkingPoints?.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Talking points</div>
                                  <ul className="space-y-0.5">
                                    {q.talkingPoints.map((t, j) => <li key={j} className="flex gap-2"><span className="text-brand">›</span> <span>{t}</span></li>)}
                                  </ul>
                                </div>
                              )}
                              {q.starExample && (
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">STAR example</div>
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
                                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Follow-up questions</div>
                                  <ul className="space-y-0.5">
                                    {q.followUps.map((f, j) => <li key={j} className="flex gap-2 text-xs"><span className="text-gold">?</span> <span>{f}</span></li>)}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
        </>
      )}
    </div>
  );
}
