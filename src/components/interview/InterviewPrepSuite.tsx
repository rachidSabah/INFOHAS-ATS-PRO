"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { callAI, extractJSON } from "@/lib/ai";
import { toast } from "sonner";
import type { ResumeData, JobDescription, InterviewPackage, InterviewQuestion } from "@/lib/types";
import { useApp, uid } from "@/lib/store";

// ============================================================================
// Types
// ============================================================================

interface WebSearchResult {
  query: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface InterviewPrepResult {
  readinessScore: number;
  companyInsights: string[];
  likelyTopics: string[];
  skillsToReview: string[];
  questions: InterviewQuestion[];
}

interface InterviewPrepSuiteProps {
  optimizedResume: ResumeData;
  jd: JobDescription;
  onClose: () => void;
}

const CATEGORIES = [
  { id: "technical", label: "Technical", icon: "Code2", color: "#1154A3" },
  { id: "behavioral", label: "Behavioral", icon: "Users", color: "#F59E0B" },
  { id: "situational", label: "Situational", icon: "GitBranch", color: "#10B981" },
  { id: "hr", label: "HR", icon: "UserCheck", color: "#8B5CF6" },
  { id: "company", label: "Company-specific", icon: "Building2", color: "#EC4899" },
] as const;

const DIFFICULTY_COLORS: Record<string, string> = { easy: "#10B981", medium: "#F59E0B", hard: "#DC2626" };

// ============================================================================
// Main component
// ============================================================================

export function InterviewPrepSuite({ optimizedResume, jd, onClose }: InterviewPrepSuiteProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepResult, setPrepResult] = useState<InterviewPrepResult | null>(null);
  const [webResults, setWebResults] = useState<WebSearchResult[]>([]);
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [showMockInterview, setShowMockInterview] = useState(false);

  const addInterview = useApp((s) => s.addInterview);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const company = jd.company || "";
  const jobTitle = jd.title || "";

  // === Generate interview prep package ===
  const generatePrep = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPrepResult(null);
    setWebResults([]);

    try {
      // Step 1: Web research (parallel with AI generation)
      const webSearchPromise = fetch("/api/web-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, jobTitle, industry: "" }),
      }).then((r) => r.json()).catch(() => ({ results: [] }));

      // Step 2: AI generates the interview prep package
      const resumeContext = JSON.stringify({
        name: optimizedResume.name,
        headline: optimizedResume.headline,
        summary: optimizedResume.summary,
        experience: optimizedResume.experience.map((e) => ({
          title: e.title,
          company: e.company,
          bullets: e.bullets,
        })),
        skills: optimizedResume.skills.map((s) => s.name),
        education: optimizedResume.education.map((ed) => ({ degree: ed.degree, institution: ed.institution })),
        languages: optimizedResume.languages.map((l) => l.name),
      });

      const jdContext = jd.rawText ?? JSON.stringify({
        title: jd.title,
        company: jd.company,
        responsibilities: jd.responsibilities,
        requiredSkills: jd.requiredSkills,
        keywords: jd.keywords,
      });

      const result = await callAI({
        systemPrompt: `You are an expert interview coach. Generate a comprehensive interview preparation package for a ${jobTitle} role${company ? ` at ${company}` : ""}. Use the candidate's resume and the job description to generate TAILORED questions that align with their actual experience and skills. NEVER ask about technologies or experiences not present in the resume. Return ONLY valid JSON.`,
        userPrompt: `CANDIDATE'S OPTIMIZED RESUME:
${resumeContext}

JOB DESCRIPTION:
${jdContext}

Generate an interview preparation package with 9-15 questions. Distribution:
- 3-5 Technical questions (about technologies in the resume)
- 3-5 Behavioral questions (STAR method, past experiences from the resume)
- 2-3 Situational questions (hypothetical scenarios relevant to the role)
- 1-3 Company-specific questions (about the company's values, culture, products)

For each question, provide:
- category: "technical" | "behavioral" | "situational" | "hr" | "company"
- question: the interview question
- difficulty: "easy" | "medium" | "hard"
- recommendedAnswer: a recruiter-grade answer using the candidate's REAL experience
- talkingPoints: 3-5 bullet points for the answer
- starExample: { situation, task, action, result } (for behavioral questions)
- followUps: 2-3 follow-up questions the interviewer might ask

Also provide:
- readinessScore: 0-100 (how prepared the candidate is for this role)
- companyInsights: 3-5 insights about the company/role
- likelyTopics: 5-8 topics likely to come up in the interview
- skillsToReview: 3-5 skills the candidate should brush up on

Return JSON:
{
  "readinessScore": 78,
  "companyInsights": ["insight1", "insight2", ...],
  "likelyTopics": ["topic1", "topic2", ...],
  "skillsToReview": ["skill1", "skill2", ...],
  "questions": [
    {
      "category": "technical",
      "question": "...",
      "difficulty": "medium",
      "recommendedAnswer": "...",
      "talkingPoints": ["...", "..."],
      "starExample": { "situation": "...", "task": "...", "action": "...", "result": "..." },
      "followUps": ["...", "..."]
    }
  ]
}`,
        maxTokens: 6000,
        temperature: 0.5,
        taskCategory: "document",
      });

      // Parse the AI response
      let parsed: InterviewPrepResult;
      try {
        const data = extractJSON<any>(result.text);
        parsed = {
          readinessScore: typeof data.readinessScore === "number" ? data.readinessScore : 75,
          companyInsights: Array.isArray(data.companyInsights) ? data.companyInsights : [],
          likelyTopics: Array.isArray(data.likelyTopics) ? data.likelyTopics : [],
          skillsToReview: Array.isArray(data.skillsToReview) ? data.skillsToReview : [],
          questions: (Array.isArray(data.questions) ? data.questions : []).map((q: any) => ({
            id: uid("q"),
            category: q.category || "hr",
            question: q.question || "",
            difficulty: q.difficulty || "medium",
            recommendedAnswer: q.recommendedAnswer || "",
            talkingPoints: Array.isArray(q.talkingPoints) ? q.talkingPoints : [],
            starExample: q.starExample,
            followUps: Array.isArray(q.followUps) ? q.followUps : [],
          })),
        };
      } catch {
        throw new Error("Failed to parse interview prep response. Please try again.");
      }

      if (!parsed.questions.length) {
        throw new Error("No questions generated. Please try again.");
      }

      // Get web search results
      const webData = await webSearchPromise;
      setWebResults(webData.results || []);

      setPrepResult(parsed);

      // Save to store
      const pkg: InterviewPackage = {
        id: uid("iv"),
        resumeId: optimizedResume.id,
        jdId: jd.id,
        company,
        role: jobTitle,
        questions: parsed.questions,
        createdAt: new Date().toISOString(),
      };
      addInterview(pkg);
      incUsage("interviewPreps");
      log({
        actor: "you",
        action: "Interview prep generated",
        category: "ai",
        details: `${parsed.questions.length} questions for ${jobTitle}${company ? ` at ${company}` : ""} · readiness ${parsed.readinessScore}/100`,
        severity: "info",
      });

      toast.success(`${parsed.questions.length} tailored interview questions generated!`);
    } catch (e: any) {
      setError(e?.message || "Failed to generate interview prep. Please try again.");
      toast.error(e?.message || "Failed to generate interview prep.");
    } finally {
      setLoading(false);
    }
  }, [optimizedResume, jd, company, jobTitle, addInterview, incUsage, log]);

  // === Start mock interview with preloaded questions ===
  const startMockInterview = () => {
    if (!prepResult) return;
    setShowMockInterview(true);
  };

  // === Render ===
  if (showMockInterview && prepResult) {
    // Dynamically load the mock interview with preloaded questions
    return (
      <PreloadedMockInterview
        questions={prepResult.questions}
        company={company}
        jobTitle={jobTitle}
        onClose={() => setShowMockInterview(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="GraduationCap" className="w-5 h-5 text-brand shrink-0" />
              <div className="min-w-0">
                <h2 className="font-semibold text-sm sm:text-base truncate">Interview Preparation Suite</h2>
                <p className="text-xs text-muted-foreground">{jobTitle}{company ? ` at ${company}` : ""} · AI-tailored questions + live web research</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 shrink-0">
              <Icon name="X" className="w-4 h-4" /> Back
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Generate button (if not yet generated) */}
      {!prepResult && !loading && (
        <Card>
          <CardContent className="p-5 sm:p-6 text-center">
            <Icon name="Sparkles" className="w-10 h-10 text-brand mx-auto" />
            <h3 className="mt-3 font-semibold text-base">Generate Your Interview Prep Package</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Get 9-15 tailored interview questions with recruiter-grade answers, talking points, STAR examples, and follow-up questions — all aligned with your optimized resume and the job description.
            </p>
            <Button onClick={generatePrep} className="bg-brand hover:bg-brand-dark text-white gap-2 mt-4">
              <Icon name="Wand2" className="w-4 h-4" /> Generate Interview Prep
            </Button>
            <p className="text-[10px] text-muted-foreground mt-2">Includes live web research for company-specific insights</p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-3 mb-4">
              <Icon name="Loader2" className="w-5 h-5 text-brand animate-spin" />
              <div>
                <div className="text-sm font-semibold">Generating interview prep package…</div>
                <div className="text-xs text-muted-foreground">Researching company + generating tailored questions</div>
              </div>
            </div>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-lg bg-secondary/40 p-3 animate-pulse">
                  <div className="flex gap-2 mb-2">
                    <div className="h-5 w-20 bg-secondary rounded-full" />
                    <div className="h-5 w-16 bg-secondary rounded-full" />
                  </div>
                  <div className="h-4 w-full bg-secondary rounded mb-1.5" />
                  <div className="h-3 w-3/4 bg-secondary rounded" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-red-200 dark:border-red-900">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="AlertCircle" className="w-5 h-5 text-red-600 shrink-0" />
              <span className="text-sm text-red-700 dark:text-red-400 truncate">{error}</span>
            </div>
            <Button size="sm" onClick={generatePrep} className="bg-red-600 hover:bg-red-700 text-white shrink-0">Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {prepResult && (
        <>
          {/* Readiness Score */}
          <Card>
            <CardContent className="p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-4">
              <ScoreRing value={prepResult.readinessScore} size={100} label="Readiness" />
              <div className="flex-1 text-center sm:text-left">
                <h3 className="font-semibold text-sm">Interview Readiness Score</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {prepResult.readinessScore >= 80 ? "Excellent — you're well-prepared for this interview!" :
                   prepResult.readinessScore >= 60 ? "Good — review the topics below to improve further." :
                   "Needs work — focus on the skills to review and practice the questions."}
                </p>
                <Button size="sm" onClick={startMockInterview} className="bg-brand hover:bg-brand-dark text-white gap-1.5 mt-3">
                  <Icon name="Mic" className="w-3.5 h-3.5" /> Start Mock Interview
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Company Insights + Likely Topics + Skills */}
          <div className="grid md:grid-cols-3 gap-4">
            {prepResult.companyInsights.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-1.5"><Icon name="Building2" className="w-3.5 h-3.5 text-brand" /> Company Insights</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <ul className="space-y-1">
                    {prepResult.companyInsights.map((insight, i) => (
                      <li key={i} className="text-xs text-foreground/80 flex gap-1.5"><span className="text-brand shrink-0">›</span> {insight}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            {prepResult.likelyTopics.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-1.5"><Icon name="ListChecks" className="w-3.5 h-3.5 text-amber-500" /> Likely Topics</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1">
                    {prepResult.likelyTopics.map((topic, i) => <Badge key={i} variant="outline" className="text-[10px]">{topic}</Badge>)}
                  </div>
                </CardContent>
              </Card>
            )}
            {prepResult.skillsToReview.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-1.5"><Icon name="BookOpen" className="w-3.5 h-3.5 text-emerald-600" /> Skills To Review</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1">
                    {prepResult.skillsToReview.map((skill, i) => <Badge key={i} variant="warning" className="text-[10px]">{skill}</Badge>)}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Web Research Results */}
          {webResults.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs flex items-center gap-1.5"><Icon name="Globe" className="w-3.5 h-3.5 text-brand" /> Live Web Research</CardTitle>
                <CardDescription className="text-[10px]">Real search results about {company || jobTitle} interviews</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {webResults.slice(0, 10).map((r, i) => (
                    <a key={i} href={r.url} target="_blank" rel="noreferrer noopener" className="block rounded-lg p-2 hover:bg-secondary/50 transition">
                      <div className="text-xs font-medium text-brand truncate">{r.title}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{r.source} — {r.snippet.slice(0, 100)}{r.snippet.length > 100 ? "…" : ""}</div>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Questions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><Icon name="MessagesSquare" className="w-4 h-4 text-brand" /> Interview Questions ({prepResult.questions.length})</CardTitle>
              <CardDescription className="text-xs">Tailored to your resume and the job description</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {prepResult.questions.map((q, i) => {
                  const cat = CATEGORIES.find((c) => c.id === q.category) ?? CATEGORIES[0];
                  const isOpen = expandedQuestion === q.id;
                  return (
                    <div key={q.id} className="rounded-xl border border-border overflow-hidden">
                      <button onClick={() => setExpandedQuestion(isOpen ? null : q.id)} className="w-full flex items-start gap-3 p-3 text-left hover:bg-secondary/50 transition">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cat.color}15`, color: cat.color }}>
                          <Icon name={cat.icon} className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <Badge variant="outline" className="text-[9px] uppercase tracking-wide">{cat.label}</Badge>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${DIFFICULTY_COLORS[q.difficulty]}20`, color: DIFFICULTY_COLORS[q.difficulty] }}>{q.difficulty}</span>
                          </div>
                          <div className="text-xs font-semibold text-pretty">{i + 1}. {q.question}</div>
                        </div>
                        <Icon name="ChevronDown" className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                      {isOpen && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="overflow-hidden">
                          <div className="p-3 pt-0 space-y-2.5 text-xs">
                            {q.recommendedAnswer && (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Recommended Answer</div>
                                <p className="text-foreground/90 text-pretty">{q.recommendedAnswer}</p>
                              </div>
                            )}
                            {q.talkingPoints.length > 0 && (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Talking Points</div>
                                <ul className="space-y-0.5">{q.talkingPoints.map((t, j) => <li key={j} className="flex gap-1.5"><span className="text-brand">›</span> {t}</li>)}</ul>
                              </div>
                            )}
                            {q.starExample && (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">STAR Example</div>
                                <div className="rounded-lg bg-secondary p-2 space-y-0.5 text-[11px]">
                                  <div><span className="font-semibold text-brand">Situation:</span> {q.starExample.situation}</div>
                                  <div><span className="font-semibold text-brand">Task:</span> {q.starExample.task}</div>
                                  <div><span className="font-semibold text-brand">Action:</span> {q.starExample.action}</div>
                                  <div><span className="font-semibold text-brand">Result:</span> {q.starExample.result}</div>
                                </div>
                              </div>
                            )}
                            {q.followUps.length > 0 && (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Follow-Up Questions</div>
                                <ul className="space-y-0.5">{q.followUps.map((f, j) => <li key={j} className="flex gap-1.5"><span className="text-gold">?</span> {f}</li>)}</ul>
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

          {/* Start Mock Interview */}
          <Card className="gradient-brand text-white">
            <CardContent className="p-5 text-center">
              <Icon name="Mic" className="w-8 h-8 mx-auto mb-2 text-gold" />
              <h3 className="font-semibold">Ready to practice?</h3>
              <p className="text-xs opacity-90 mt-0.5">Start a mock interview with these preloaded questions</p>
              <Button onClick={startMockInterview} className="bg-white text-brand hover:bg-white/90 gap-2 mt-3">
                <Icon name="Play" className="w-4 h-4" /> Start Mock Interview
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Preloaded Mock Interview — uses questions from the prep suite
// ============================================================================

function PreloadedMockInterview({ questions, company, jobTitle, onClose }: {
  questions: InterviewQuestion[];
  company: string;
  jobTitle: string;
  onClose: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { answer: string; submitted: boolean; feedback?: any }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  const total = questions.length;
  const current = questions[currentIndex];
  const isLast = currentIndex === total - 1;
  const percent = Math.round(((currentIndex + 1) / total) * 100);
  const answeredCount = Object.values(answers).filter((a) => a.submitted).length;

  const submitAnswer = useCallback(async () => {
    if (!current || !answers[current.id]?.answer?.trim()) {
      toast.error("Please write an answer before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await callAI({
        systemPrompt: "You are an expert interview coach. Evaluate the candidate's answer and provide feedback. Return ONLY valid JSON.",
        userPrompt: `Question: ${current.question}\nCandidate's answer: ${answers[current.id].answer}\nRecommended answer: ${current.recommendedAnswer}\n\nReturn JSON: { "strengths": ["..."], "improvements": ["..."], "score": 85 }`,
        maxTokens: 1000,
        temperature: 0.4,
        taskCategory: "document",
      });
      const feedback = extractJSON<any>(result.text);
      setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], feedback, submitted: true } }));
      toast.success(`Scored ${feedback.score}/100`);
    } catch (e: any) {
      setError(e?.message || "Failed to get feedback.");
    } finally {
      setSubmitting(false);
    }
  }, [current, answers]);

  if (showResults) {
    const scores = Object.values(answers).filter((a) => a.feedback).map((a) => a.feedback.score);
    const avg = scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0;
    return (
      <div className="space-y-4">
        <Card className="gradient-brand text-white">
          <CardContent className="p-5 text-center">
            <Icon name="Trophy" className="w-10 h-10 mx-auto mb-2 text-gold" />
            <h2 className="font-display text-xl font-bold">Mock Interview Complete!</h2>
            <p className="text-sm opacity-90 mt-1">{jobTitle}{company ? ` at ${company}` : ""}</p>
            <p className="text-xs opacity-75 mt-1">{answeredCount} of {total} questions answered</p>
          </CardContent>
        </Card>
        <Card><CardContent className="p-5 flex flex-col items-center">
          <ScoreRing value={avg} size={120} label="Overall Score" />
        </CardContent></Card>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => setShowResults(false)} className="gap-1.5"><Icon name="RotateCcw" className="w-4 h-4" /> Review Answers</Button>
          <Button onClick={onClose} className="bg-brand hover:bg-brand-dark text-white gap-1.5"><Icon name="Check" className="w-4 h-4" /> Done</Button>
        </div>
      </div>
    );
  }

  if (!current) return null;
  const cat = CATEGORIES.find((c) => c.id === current.category) ?? CATEGORIES[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="Mic" className="w-5 h-5 text-brand shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-sm truncate">Mock Interview — {jobTitle}{company ? ` at ${company}` : ""}</h2>
              <p className="text-xs text-muted-foreground">Preloaded from your interview prep package</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 shrink-0"><Icon name="X" className="w-4 h-4" /> Exit</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-medium text-muted-foreground">Question {currentIndex + 1} of {total}</span>
            <span className="font-bold text-brand">{percent}%</span>
          </div>
          <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
            <motion.div className="h-full bg-gradient-to-r from-brand to-brand-dark rounded-full" animate={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
            <span>{answeredCount} answered</span><span>{total - answeredCount} remaining</span>
          </div>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        <motion.div key={current.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
          <Card>
            <CardContent className="p-4 sm:p-5 space-y-3">
              <div className="flex gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[9px]">{cat.label}</Badge>
                <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ background: `${DIFFICULTY_COLORS[current.difficulty]}20`, color: DIFFICULTY_COLORS[current.difficulty] }}>{current.difficulty}</span>
              </div>
              <p className="text-sm sm:text-base font-semibold text-pretty">{current.question}</p>
              {current.talkingPoints.length > 0 && (
                <div className="rounded-lg bg-secondary/40 p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Talking Points</div>
                  <ul className="space-y-0.5">{current.talkingPoints.map((t, j) => <li key={j} className="text-xs flex gap-1.5"><span className="text-brand">›</span> {t}</li>)}</ul>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Answer</label>
                  <span className="text-[10px] text-muted-foreground">{answers[current.id]?.answer?.length ?? 0} chars</span>
                </div>
                <textarea
                  value={answers[current.id]?.answer ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [current.id]: { answer: e.target.value, submitted: prev[current.id]?.submitted ?? false } }))}
                  rows={5}
                  placeholder="Write your answer using the STAR method…"
                  disabled={submitting}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              {answers[current.id]?.feedback && (
                <div className="rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold flex items-center gap-1"><Icon name="Sparkles" className="w-3.5 h-3.5 text-brand" /> AI Feedback</span>
                    <Badge variant="success" className="text-[10px]">{answers[current.id].feedback.score}/100</Badge>
                  </div>
                  {answers[current.id].feedback.strengths?.length > 0 && (
                    <div className="mb-1.5"><div className="text-[10px] font-semibold text-emerald-600 mb-0.5">Strengths</div>
                    <ul className="space-y-0.5">{answers[current.id].feedback.strengths.map((s: string, j: number) => <li key={j} className="text-xs flex gap-1"><span className="text-emerald-600">✓</span> {s}</li>)}</ul></div>
                  )}
                  {answers[current.id].feedback.improvements?.length > 0 && (
                    <div><div className="text-[10px] font-semibold text-amber-600 mb-0.5">Areas to Improve</div>
                    <ul className="space-y-0.5">{answers[current.id].feedback.improvements.map((s: string, j: number) => <li key={j} className="text-xs flex gap-1"><span className="text-amber-600">→</span> {s}</li>)}</ul></div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setCurrentIndex((i) => Math.max(i - 1, 0))} disabled={currentIndex === 0 || submitting} className="gap-1.5"><Icon name="ArrowLeft" className="w-4 h-4" /> Prev</Button>
                <div className="flex gap-2">
                  {!answers[current.id]?.submitted ? (
                    <Button size="sm" onClick={submitAnswer} disabled={submitting || !answers[current.id]?.answer?.trim()} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
                      {submitting ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Send" className="w-4 h-4" />}
                      {submitting ? "Analyzing…" : "Submit"}
                    </Button>
                  ) : (
                    <Badge variant="success" className="text-xs gap-1"><Icon name="CheckCircle2" className="w-3 h-3" /> {answers[current.id].feedback.score}/100</Badge>
                  )}
                  <Button size="sm" onClick={() => isLast ? setShowResults(true) : setCurrentIndex((i) => i + 1)} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
                    {isLast ? "Finish" : "Next"} <Icon name={isLast ? "Flag" : "ArrowRight"} className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
