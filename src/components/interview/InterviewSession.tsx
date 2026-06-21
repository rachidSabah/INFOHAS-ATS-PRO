"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { callAI, extractJSON } from "@/lib/ai";
import { toast } from "sonner";
import type { InterviewPackage, InterviewQuestion } from "@/lib/types";

// ============================================================================
// Types
// ============================================================================

interface AnswerFeedback {
  strengths: string[];
  improvements: string[];
  suggestedAnswer: string;
  starFeedback: { situation: string; task: string; action: string; result: string; note: string };
  score: number;
}

interface QuestionAnswer {
  questionId: string;
  answer: string;
  feedback?: AnswerFeedback;
  submitted: boolean;
}

interface InterviewSessionProps {
  pkg: InterviewPackage;
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

export function InterviewSession({ pkg, onClose }: InterviewSessionProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showFinalReport, setShowFinalReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = pkg.questions;
  const total = questions.length;
  const current = questions[currentIndex];
  const currentAnswer = answers[current?.id];

  const isLastQuestion = currentIndex === total - 1;
  const answeredCount = Object.values(answers).filter((a) => a.submitted).length;
  const percent = Math.round(((currentIndex + 1) / total) * 100);

  // === Answer management ===
  const setAnswerText = useCallback((questionId: string, text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        questionId,
        answer: text,
        submitted: prev[questionId]?.submitted ?? false,
      },
    }));
  }, []);

  // === Submit answer for AI feedback ===
  const submitAnswer = useCallback(async () => {
    if (!current || !currentAnswer?.answer?.trim()) {
      toast.error("Please write an answer before submitting.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await callAI({
        systemPrompt: "You are an expert interview coach. Evaluate the candidate's answer and provide constructive feedback. Return ONLY valid JSON.",
        userPrompt: `Question: ${current.question}
Category: ${current.category}
Difficulty: ${current.difficulty}

Candidate's answer:
${currentAnswer.answer}

Recommended answer (for reference):
${current.recommendedAnswer}

Talking points: ${current.talkingPoints?.join(", ") ?? ""}

Evaluate the candidate's answer. Return JSON:
{
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["improvement 1", "improvement 2"],
  "suggestedAnswer": "A model answer incorporating the talking points",
  "starFeedback": {
    "situation": "feedback on situation framing",
    "task": "feedback on task clarity",
    "action": "feedback on action description",
    "result": "feedback on result quantification",
    "note": "overall STAR feedback"
  },
  "score": 85
}

Score 0-100 based on: relevance, clarity, specificity, quantification, and STAR structure.`,
        maxTokens: 1500,
        temperature: 0.4,
        taskCategory: "document",
      });

      let feedback: AnswerFeedback;
      try {
        feedback = extractJSON<AnswerFeedback>(result.text);
      } catch {
        throw new Error("Could not parse AI feedback. Please try again.");
      }

      setAnswers((prev) => ({
        ...prev,
        [current.id]: {
          ...prev[current.id],
          feedback,
          submitted: true,
        },
      }));

      toast.success(`Answer scored ${feedback.score}/100`);
    } catch (e: any) {
      const msg = e?.message || "Failed to get feedback. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [current, currentAnswer]);

  // === Navigation ===
  const goNext = useCallback(() => {
    if (isLastQuestion) {
      setShowFinalReport(true);
    } else {
      setCurrentIndex((i) => Math.min(i + 1, total - 1));
      setError(null);
    }
  }, [isLastQuestion, total]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
    setError(null);
  }, []);

  // === Final report computation ===
  const finalReport = computeFinalReport(questions, answers);

  // === Render ===
  if (showFinalReport) {
    return <FinalReport pkg={pkg} report={finalReport} onClose={onClose} onRetry={() => setShowFinalReport(false)} />;
  }

  if (!current) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Icon name="AlertCircle" className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="mt-3 text-sm text-muted-foreground">No questions available.</p>
          <Button onClick={onClose} variant="outline" className="mt-4">Back</Button>
        </CardContent>
      </Card>
    );
  }

  const cat = CATEGORIES.find((c) => c.id === current.category) ?? CATEGORIES[0];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="MessagesSquare" className="w-5 h-5 text-brand shrink-0" />
              <div className="min-w-0">
                <h2 className="font-semibold text-sm sm:text-base truncate">{pkg.role ?? "Interview Prep"}{pkg.company ? ` at ${pkg.company}` : ""}</h2>
                <p className="text-xs text-muted-foreground">Practice mode — answer each question and get AI feedback</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 shrink-0">
              <Icon name="X" className="w-4 h-4" /> Exit
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Progress bar */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-medium text-muted-foreground">Question {currentIndex + 1} of {total}</span>
            <span className="font-bold text-brand">{percent}%</span>
          </div>
          <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-brand to-brand-dark rounded-full"
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
            <span>{answeredCount} answered</span>
            <span>{total - answeredCount} remaining</span>
          </div>
        </CardContent>
      </Card>

      {/* Question card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          <Card>
            <CardContent className="p-4 sm:p-6 space-y-4">
              {/* Category + difficulty badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: `${cat.color}15`, color: cat.color }}>
                  <Icon name={cat.icon} className="w-3.5 h-3.5" /> {cat.label}
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: `${DIFFICULTY_COLORS[current.difficulty]}20`, color: DIFFICULTY_COLORS[current.difficulty] }}>
                  {current.difficulty}
                </span>
              </div>

              {/* Question */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Question {currentIndex + 1}</div>
                <p className="text-base sm:text-lg font-semibold text-pretty">{current.question}</p>
              </div>

              {/* Talking points */}
              {current.talkingPoints && current.talkingPoints.length > 0 && (
                <div className="rounded-lg bg-secondary/40 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Icon name="Lightbulb" className="w-3.5 h-3.5 text-gold" /> Talking Points
                  </div>
                  <ul className="space-y-1">
                    {current.talkingPoints.map((t, j) => (
                      <li key={j} className="text-xs text-foreground/80 flex gap-2">
                        <span className="text-brand shrink-0">›</span> <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Follow-up questions */}
              {current.followUps && current.followUps.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Icon name="HelpCircle" className="w-3.5 h-3.5 text-amber-500" /> Follow-Up Questions
                  </div>
                  <ul className="space-y-1">
                    {current.followUps.map((f, j) => (
                      <li key={j} className="text-xs text-foreground/80 flex gap-2">
                        <span className="text-gold shrink-0">?</span> <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Answer textarea */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Answer</label>
                  <span className="text-[10px] text-muted-foreground">{currentAnswer?.answer?.length ?? 0} chars</span>
                </div>
                <Textarea
                  value={currentAnswer?.answer ?? ""}
                  onChange={(e) => setAnswerText(current.id, e.target.value)}
                  rows={5}
                  placeholder="Write your answer here. Use the STAR method (Situation, Task, Action, Result) for behavioral questions…"
                  disabled={submitting}
                  className="text-sm"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-2.5 flex items-start gap-2">
                  <Icon name="AlertCircle" className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span className="text-xs text-red-700 dark:text-red-400">{error}</span>
                </div>
              )}

              {/* AI Feedback (after submission) */}
              {currentAnswer?.feedback && (
                <FeedbackCard feedback={currentAnswer.feedback} recommendedAnswer={current.recommendedAnswer} />
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={goPrev} disabled={currentIndex === 0 || submitting} className="gap-1.5">
                  <Icon name="ArrowLeft" className="w-4 h-4" /> Previous
                </Button>
                <div className="flex gap-2">
                  {!currentAnswer?.submitted ? (
                    <Button size="sm" onClick={submitAnswer} disabled={submitting || !currentAnswer?.answer?.trim()} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
                      {submitting ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Send" className="w-4 h-4" />}
                      {submitting ? "Analyzing…" : "Submit Answer"}
                    </Button>
                  ) : (
                    <Badge variant="success" className="text-xs gap-1">
                      <Icon name="CheckCircle2" className="w-3 h-3" /> Scored {currentAnswer.feedback?.score}/100
                    </Badge>
                  )}
                  <Button size="sm" onClick={goNext} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
                    {isLastQuestion ? "Finish" : "Next"}
                    <Icon name={isLastQuestion ? "Flag" : "ArrowRight"} className="w-4 h-4" />
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

// ============================================================================
// Feedback Card
// ============================================================================

function FeedbackCard({ feedback, recommendedAnswer }: { feedback: AnswerFeedback; recommendedAnswer: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-brand/30 bg-brand/5 dark:bg-brand/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Sparkles" className="w-4 h-4 text-brand" />
          <span className="text-sm font-semibold">AI Feedback</span>
        </div>
        <ScoreRing value={feedback.score} size={48} label="Score" />
      </div>

      {feedback.strengths.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-1 flex items-center gap-1">
            <Icon name="CheckCircle2" className="w-3.5 h-3.5" /> Strengths
          </div>
          <ul className="space-y-0.5">
            {feedback.strengths.map((s, i) => (
              <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                <span className="text-emerald-600 shrink-0">✓</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.improvements.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-1 flex items-center gap-1">
            <Icon name="AlertTriangle" className="w-3.5 h-3.5" /> Areas for Improvement
          </div>
          <ul className="space-y-0.5">
            {feedback.improvements.map((imp, i) => (
              <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                <span className="text-amber-600 shrink-0">→</span> {imp}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.suggestedAnswer && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand mb-1 flex items-center gap-1">
            <Icon name="Lightbulb" className="w-3.5 h-3.5" /> Suggested Answer
          </div>
          <p className="text-xs text-foreground/90 text-pretty rounded-lg bg-card p-2.5">{feedback.suggestedAnswer}</p>
        </div>
      )}

      {feedback.starFeedback && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">STAR Feedback</div>
          <div className="rounded-lg bg-card p-2.5 space-y-1 text-xs">
            <div><span className="font-semibold text-brand">Situation:</span> {feedback.starFeedback.situation}</div>
            <div><span className="font-semibold text-brand">Task:</span> {feedback.starFeedback.task}</div>
            <div><span className="font-semibold text-brand">Action:</span> {feedback.starFeedback.action}</div>
            <div><span className="font-semibold text-brand">Result:</span> {feedback.starFeedback.result}</div>
            <div className="pt-1 border-t border-border mt-1"><span className="font-semibold">Overall:</span> {feedback.starFeedback.note}</div>
          </div>
        </div>
      )}

      {recommendedAnswer && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">Show original recommended answer</summary>
          <p className="mt-1.5 text-foreground/80 text-pretty">{recommendedAnswer}</p>
        </details>
      )}
    </motion.div>
  );
}

// ============================================================================
// Final Report
// ============================================================================

interface FinalReportData {
  overallScore: number;
  categoryScores: Record<string, { score: number; count: number }>;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  answeredCount: number;
  totalCount: number;
}

function computeFinalReport(questions: InterviewQuestion[], answers: Record<string, QuestionAnswer>): FinalReportData {
  const submittedAnswers = Object.values(answers).filter((a) => a.submitted && a.feedback);
  const totalScore = submittedAnswers.reduce((sum, a) => sum + (a.feedback?.score ?? 0), 0);
  const overallScore = submittedAnswers.length > 0 ? Math.round(totalScore / submittedAnswers.length) : 0;

  // Category breakdown
  const categoryScores: Record<string, { score: number; count: number }> = {};
  for (const q of questions) {
    const ans = answers[q.id];
    if (ans?.submitted && ans.feedback) {
      if (!categoryScores[q.category]) categoryScores[q.category] = { score: 0, count: 0 };
      categoryScores[q.category].score += ans.feedback.score;
      categoryScores[q.category].count += 1;
    }
  }
  for (const cat of Object.keys(categoryScores)) {
    categoryScores[cat].score = Math.round(categoryScores[cat].score / categoryScores[cat].count);
  }

  // Aggregate strengths + weaknesses
  const allStrengths = submittedAnswers.flatMap((a) => a.feedback?.strengths ?? []);
  const allImprovements = submittedAnswers.flatMap((a) => a.feedback?.improvements ?? []);
  const strengths = [...new Set(allStrengths)].slice(0, 5);
  const weaknesses = [...new Set(allImprovements)].slice(0, 5);

  // Recommendations
  const recommendations: string[] = [];
  if (overallScore >= 85) recommendations.push("Excellent performance — you're interview-ready for this role.");
  else if (overallScore >= 70) recommendations.push("Good performance — focus on the weak areas below to improve further.");
  else if (overallScore >= 50) recommendations.push("Moderate performance — practice more on your weak categories.");
  else recommendations.push("Needs significant improvement — review the suggested answers and practice again.");

  for (const [cat, data] of Object.entries(categoryScores)) {
    if (data.score < 60) {
      const catLabel = CATEGORIES.find((c) => c.id === cat)?.label ?? cat;
      recommendations.push(`Focus on ${catLabel} questions — your average was ${data.score}/100.`);
    }
  }

  return {
    overallScore,
    categoryScores,
    strengths,
    weaknesses,
    recommendations,
    answeredCount: submittedAnswers.length,
    totalCount: questions.length,
  };
}

function FinalReport({ pkg, report, onClose, onRetry }: {
  pkg: InterviewPackage;
  report: FinalReportData;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="gradient-brand text-white">
        <CardContent className="p-5 sm:p-6 text-center">
          <Icon name="Trophy" className="w-10 h-10 mx-auto mb-2 text-gold" />
          <h2 className="font-display text-xl sm:text-2xl font-bold">Interview Complete!</h2>
          <p className="text-sm opacity-90 mt-1">{pkg.role ?? "Interview Prep"}{pkg.company ? ` at ${pkg.company}` : ""}</p>
          <p className="text-xs opacity-75 mt-1">{report.answeredCount} of {report.totalCount} questions answered</p>
        </CardContent>
      </Card>

      {/* Overall score */}
      <Card>
        <CardContent className="p-5 sm:p-6 flex flex-col items-center">
          <ScoreRing value={report.overallScore} size={120} label="Overall Score" />
          <div className="mt-3 text-center">
            {report.overallScore >= 85 && <Badge variant="success" className="gap-1"><Icon name="Star" className="w-3 h-3" /> Excellent</Badge>}
            {report.overallScore >= 70 && report.overallScore < 85 && <Badge variant="brand" className="gap-1"><Icon name="ThumbsUp" className="w-3 h-3" /> Good</Badge>}
            {report.overallScore >= 50 && report.overallScore < 70 && <Badge variant="warning" className="gap-1"><Icon name="AlertCircle" className="w-3 h-3" /> Moderate</Badge>}
            {report.overallScore < 50 && <Badge variant="danger" className="gap-1"><Icon name="AlertTriangle" className="w-3 h-3" /> Needs Work</Badge>}
          </div>
        </CardContent>
      </Card>

      {/* Category scores */}
      {Object.keys(report.categoryScores).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Icon name="BarChart3" className="w-4 h-4 text-brand" /> Category Scores</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {Object.entries(report.categoryScores).map(([catId, data]) => {
              const cat = CATEGORIES.find((c) => c.id === catId);
              return (
                <div key={catId} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cat?.color}15`, color: cat?.color }}>
                    <Icon name={cat?.icon ?? "Circle"} className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{cat?.label ?? catId}</span>
                      <span className="font-bold">{data.score}/100</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${data.score}%`, background: data.score >= 70 ? "#10B981" : data.score >= 50 ? "#F59E0B" : "#DC2626" }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Strengths */}
      {report.strengths.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Icon name="CheckCircle2" className="w-4 h-4 text-emerald-600" /> Strengths</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1">
              {report.strengths.map((s, i) => (
                <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                  <span className="text-emerald-600 shrink-0">✓</span> {s}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Weaknesses */}
      {report.weaknesses.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Icon name="AlertTriangle" className="w-4 h-4 text-amber-600" /> Weaknesses</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1">
              {report.weaknesses.map((w, i) => (
                <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                  <span className="text-amber-600 shrink-0">→</span> {w}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Icon name="Lightbulb" className="w-4 h-4 text-brand" /> Recommendations</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1">
              {report.recommendations.map((r, i) => (
                <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                  <Icon name="ArrowRight" className="w-3 h-3 text-brand shrink-0 mt-0.5" /> {r}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-center">
        <Button variant="outline" onClick={onRetry} className="gap-1.5">
          <Icon name="RotateCcw" className="w-4 h-4" /> Review Answers
        </Button>
        <Button onClick={onClose} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
          <Icon name="Check" className="w-4 h-4" /> Done
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Loading skeleton (shown while generating)
// ============================================================================

export function InterviewSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded bg-secondary animate-pulse" />
            <div className="h-4 w-32 bg-secondary rounded animate-pulse" />
          </div>
          <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
            <div className="h-full w-1/4 bg-brand/30 rounded-full animate-pulse" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex gap-2">
            <div className="h-6 w-20 bg-secondary rounded-full animate-pulse" />
            <div className="h-6 w-16 bg-secondary rounded-full animate-pulse" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-24 bg-secondary rounded animate-pulse" />
            <div className="h-5 w-full bg-secondary rounded animate-pulse" />
            <div className="h-5 w-3/4 bg-secondary rounded animate-pulse" />
          </div>
          <div className="rounded-lg bg-secondary/40 p-3 space-y-1.5">
            <div className="h-3 w-28 bg-secondary rounded animate-pulse" />
            <div className="h-3 w-full bg-secondary rounded animate-pulse" />
            <div className="h-3 w-5/6 bg-secondary rounded animate-pulse" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-20 bg-secondary rounded animate-pulse" />
            <div className="h-20 w-full bg-secondary rounded animate-pulse" />
          </div>
          <div className="flex justify-between">
            <div className="h-8 w-24 bg-secondary rounded animate-pulse" />
            <div className="flex gap-2">
              <div className="h-8 w-28 bg-secondary rounded animate-pulse" />
              <div className="h-8 w-20 bg-secondary rounded animate-pulse" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
