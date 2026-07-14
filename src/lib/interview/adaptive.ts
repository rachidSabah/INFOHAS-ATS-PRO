// ============================================================================
// Adaptive Interview Engine — Phase 8.1.2
//
// Extends the SINGLE AI pipeline (callAI) and the SINGLE Prompt Builder
// (buildResumeContext / buildJdContext / buildAnalysisContext /
// buildCompanyContext / buildPersonaContext in ai.ts). No second orchestrator,
// no duplicate prompt builder, no new state management — this file is PURE
// logic + AI calls that feed the existing store and components.
//
// Architecture (per the brief):
//   START → Opening Question → Candidate Answer → AI Evaluation →
//   Competency Assessment → Difficulty Assessment → Confidence Assessment →
//   Knowledge Gap Detection → Decision Engine → Select Next Question →
//   (repeat) → Final Evaluation → Interview Report
//
// Determinism: every decision node is a PURE function of its inputs
// (scores + flags). The only non-deterministic source is the model itself;
// callers MUST pass an explicit temperature (the engine defaults to 0.2 for
// structured decisions). No Math.random, no Date.now in branching.
// ============================================================================

import { extractJSON } from "@/lib/ai";
import { recordAI, type RecordOptions } from "@/lib/ai/flight-recorder";
import {
  buildResumeContext,
  buildJdContext,
  buildAnalysisContext,
  buildCompanyContext,
  type CompanyProfile,
  type InterviewContext,
} from "@/lib/interview/ai";
import {
  INTERVIEW_PERSONAS,
  PERSONAS_BY_ID,
  type InterviewPersona,
} from "@/lib/interview/personas";
import { uid } from "@/lib/store";
import type {
  ATSReport,
  InterviewPackage,
  InterviewQuestion,
  JobDescription,
  ResumeData,
  ResumeReviewReport,
} from "@/lib/types";

// ----------------------------------------------------------------------------
// Competency model (Step 3) — fixed, ordered, deterministic
// ----------------------------------------------------------------------------

export const COMPETENCIES = [
  "technicalKnowledge",
  "behaviouralCompetency",
  "customerService",
  "safetyAwareness",
  "communication",
  "leadership",
  "problemSolving",
  "teamwork",
  "professionalism",
  "confidence",
  "stressHandling",
  "adaptability",
] as const;

export type CompetencyKey = (typeof COMPETENCIES)[number];

export const COMPETENCY_LABELS: Record<CompetencyKey, string> = {
  technicalKnowledge: "Technical Knowledge",
  behaviouralCompetency: "Behavioural Competency",
  customerService: "Customer Service",
  safetyAwareness: "Safety Awareness",
  communication: "Communication",
  leadership: "Leadership",
  problemSolving: "Problem Solving",
  teamwork: "Teamwork",
  professionalism: "Professionalism",
  confidence: "Confidence",
  stressHandling: "Stress Handling",
  adaptability: "Adaptability",
};

/** One competency's assessment for a single answer. All fields AI-derived. */
export interface CompetencyScore {
  score: number; // 0-100
  evidence: string; // AI-derived quote/observation
  confidence: number; // 0-100 — model's confidence in its own scoring
  improvementSuggestion: string;
  /** STAR structure quality (0-100) — used by the decision engine. */
  starStructure?: number;
}

/** Aggregate competency state across the whole interview (Step 6 memory). */
export interface CompetencyState {
  /** Running average per competency over answered questions. */
  scores: Record<CompetencyKey, number>;
  /** Evidence gathered so far, per competency (last N). */
  evidence: Partial<Record<CompetencyKey, string[]>>;
  /** Competencies never surfaced by the model — gap candidates. */
  missing: CompetencyKey[];
  /** Competencies repeatedly weak (avg < 50, seen >= 2). */
  repeatedWeaknesses: CompetencyKey[];
  /** Competencies repeatedly strong (avg >= 75, seen >= 2). */
  repeatedStrengths: CompetencyKey[];
}

// ----------------------------------------------------------------------------
// Difficulty model (Step 4) — continuous 1..5 ladder
// ----------------------------------------------------------------------------

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const DIFFICULTY_TO_LABEL: Record<Difficulty, string> = {
  1: "easy",
  2: "easy",
  3: "medium",
  4: "hard",
  5: "hard",
};

/** Pure: next difficulty from current score (0-100) + current difficulty. */
export function nextDifficulty(current: Difficulty, lastScore: number | null): Difficulty {
  if (lastScore == null) return current;
  let next = current;
  if (lastScore >= 80) next = Math.min(5, current + 1) as Difficulty; // perform well → harder
  else if (lastScore < 50) next = Math.max(1, current - 1) as Difficulty; // struggle → easier
  return next;
}

// ----------------------------------------------------------------------------
// Interview memory (Step 6) — single source of truth for a live session
// ----------------------------------------------------------------------------

export interface AnsweredQuestion {
  id: string;
  question: string;
  category: InterviewQuestion["category"];
  difficulty: Difficulty;
  personaId?: string;
  personaName?: string;
  answer: string;
  /** 11-dim evaluation overall (for difficulty). */
  overallScore: number;
  /** Per-competency scores from the evaluation. */
  competencies: Partial<Record<CompetencyKey, CompetencyScore>>;
  /** Whether a STAR clarification was requested for this answer. */
  starClarified?: boolean;
  /** Follow-up questions already asked (to avoid repeats). */
  followUpsAsked: string[];
}

export interface InterviewMemory {
  resume: ResumeData;
  jd?: JobDescription;
  atsReport?: ATSReport;
  reviewReport?: ResumeReviewReport;
  companyProfile?: CompanyProfile | null;
  personas: InterviewPersona[];
  answered: AnsweredQuestion[];
  difficulty: Difficulty;
  askedQuestionTexts: string[]; // dedupe keys
  competencies: CompetencyState;
}

// ----------------------------------------------------------------------------
// Decision engine output (Step 2 / Step 7)
// ----------------------------------------------------------------------------

export type Branch =
  | { kind: "next"; reason: string }
  | { kind: "star-clarification"; reason: string }
  | { kind: "safety-branch"; reason: string }
  | { kind: "leadership-branch"; reason: string }
  | { kind: "recovery"; reason: string }
  | { kind: "final"; reason: string };

export interface DecisionResult {
  branch: Branch;
  nextDifficulty: Difficulty;
  /** Preferred category for the next question (used by the generator). */
  preferredCategory: InterviewQuestion["category"];
  /** If star-clarification, the clarification prompt. */
  clarificationQuestion?: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function emptyCompetencyState(): CompetencyState {
  const scores = {} as Record<CompetencyKey, number>;
  for (const c of COMPETENCIES) scores[c] = 0;
  return { scores, evidence: {}, missing: [...COMPETENCIES], repeatedWeaknesses: [], repeatedStrengths: [] };
}

/** Recompute aggregate competency state from answered questions (pure). */
export function recomputeCompetencies(answered: AnsweredQuestion[]): CompetencyState {
  const state = emptyCompetencyState();
  const sums: Record<string, { total: number; n: number }> = {};
  const seen: Record<string, Set<string>> = {};
  for (const a of answered) {
    for (const c of COMPETENCIES) {
      const cs = a.competencies[c];
      if (!cs) continue;
      sums[c] = sums[c] || { total: 0, n: 0 };
      sums[c].total += cs.score;
      sums[c].n += 1;
      state.evidence[c] = state.evidence[c] || [];
      if (cs.evidence) state.evidence[c]!.push(cs.evidence);
    }
  }
  for (const c of COMPETENCIES) {
    const s = sums[c];
    if (s && s.n > 0) {
      state.scores[c] = Math.round(s.total / s.n);
      state.missing = state.missing.filter((m) => m !== c);
      if (s.n >= 2) {
        if (state.scores[c] < 50) state.repeatedWeaknesses.push(c);
        if (state.scores[c] >= 75) state.repeatedStrengths.push(c);
      }
    }
  }
  return state;
}

/** Build a fresh InterviewMemory from an InterviewContext (Step 6 init). */
export function initMemory(ctx: InterviewContext): InterviewMemory {
  const personas: InterviewPersona[] = (ctx.personaIds && ctx.personaIds.length
    ? ctx.personaIds.map((id) => PERSONAS_BY_ID[id]).filter(Boolean)
    : INTERVIEW_PERSONAS) as InterviewPersona[];
  return {
    resume: ctx.resume,
    jd: ctx.jd,
    atsReport: ctx.atsReport,
    reviewReport: ctx.reviewReport,
    companyProfile: ctx.companyProfile ?? null,
    personas,
    answered: [],
    difficulty: 3,
    askedQuestionTexts: [],
    competencies: emptyCompetencyState(),
  };
}

// ----------------------------------------------------------------------------
// Opening question (START node)
// ----------------------------------------------------------------------------

export async function generateOpeningQuestion(
  memory: InterviewMemory,
  ctx: InterviewContext
): Promise<GeneratedQuestion> {
  return generateQuestion(memory, ctx, {
    purpose: "opening",
    preferredCategory: "hr",
    difficulty: 3,
  });
}

// ----------------------------------------------------------------------------
// Step 3 — Competency Assessment (per answer)
// ----------------------------------------------------------------------------

export interface CompetencyEvaluation {
  overallScore: number;
  competencies: Record<CompetencyKey, CompetencyScore>;
}

/**
 * Evaluate ONE answer across all 12 competencies. Reuses callAI (single
 * pipeline). No random scoring — every score/evidence/suggestion is extracted
 * from the model response. Returns null on parse failure so the caller can
 * fall back (never fabricates).
 */
export async function evaluateCompetencies(
  memory: InterviewMemory,
  question: InterviewQuestion,
  answerText: string
): Promise<CompetencyEvaluation | null> {
  const competencyLines = COMPETENCIES.map(
    (c) => `- ${c} (${COMPETENCY_LABELS[c]})`
  ).join("\n");

  const systemPrompt = `You are an expert interview evaluator. Assess the candidate's answer across EXACTLY these competencies and return ONLY valid JSON.
${competencyLines}

For EACH competency provide: score (0-100), evidence (one observed quote/behaviour from the answer), confidence (0-100 — your confidence in the score), improvementSuggestion (one concrete tip).
Do NOT invent competencies beyond the list. Do NOT fabricate evidence — quote only what is present.`;

  const userPrompt = `QUESTION:
${question.question}
Category: ${question.category}
Difficulty: ${question.difficulty}
${question.personaName ? `Interviewer: ${question.personaName}` : ""}

CANDIDATE ANSWER:
${answerText}

CANDIDATE RESUME (context): ${memory.resume.headline ?? memory.resume.name} — skills: ${memory.resume.skills.map((s) => s.name).join(", ")}
${memory.jd ? `TARGET ROLE: ${memory.jd.title} at ${memory.jd.company}` : ""}

Return JSON:
{
  "overallScore": 0-100,
  "competencies": {
    "technicalKnowledge": { "score": 0-100, "evidence": "...", "confidence": 0-100, "improvementSuggestion": "..." },
    "behaviouralCompetency": { ... },
    "customerService": { ... },
    "safetyAwareness": { ... },
    "communication": { ... },
    "leadership": { ... },
    "problemSolving": { ... },
    "teamwork": { ... },
    "professionalism": { ... },
    "confidence": { ... },
    "stressHandling": { ... },
    "adaptability": { ... }
  }
}`;

  const result = await recordAI(
    {
      systemPrompt,
      userPrompt,
      maxTokens: 2000,
      temperature: 0.2,
      taskCategory: "document",
    },
    interviewRecordOptions(memory, question, "evaluate")
  );

  let data: any;
  try {
    data = extractJSON<any>(result.text);
  } catch {
    return null;
  }

  const competencies = {} as Record<CompetencyKey, CompetencyScore>;
  const globalStar = typeof data?.starStructure === "number" ? clamp(data.starStructure) : undefined;
  for (const c of COMPETENCIES) {
    const raw = data?.competencies?.[c];
    if (raw && typeof raw.score === "number") {
      competencies[c] = {
        score: clamp(raw.score),
        evidence: typeof raw.evidence === "string" ? raw.evidence : "",
        confidence: typeof raw.confidence === "number" ? clamp(raw.confidence) : 50,
        improvementSuggestion: typeof raw.improvementSuggestion === "string" ? raw.improvementSuggestion : "",
        // Attach STAR structure to the behavioural competency (decision engine reads it).
        starStructure: c === "behaviouralCompetency" ? globalStar : undefined,
      };
    } else {
      // Missing competency from this answer — leave absent (counts as not-yet-covered).
      competencies[c] = { score: 0, evidence: "", confidence: 0, improvementSuggestion: "" };
    }
  }

  return {
    overallScore: typeof data?.overallScore === "number" ? clamp(data.overallScore) : 50,
    competencies,
  };
}

// ----------------------------------------------------------------------------
// Step 7 — Decision Engine (deterministic branching)
// ----------------------------------------------------------------------------

/**
 * Pure decision function. Given the live memory + last evaluation, decide the
 * next branch. All rules are deterministic (no randomness). Branching order:
 *   1. Not enough answers yet → keep going (next)
 *   2. STAR failed (behavioural/situational + starStructure < 50) → STAR clarification
 *   3. Safety knowledge missing (safetyAwareness < 50 on a safety-relevant Q) → safety branch
 *   4. Leadership shown (leadership >= 75) → leadership branch
 *   5. Struggling (overall < 50) → recovery (easier, fundamentals)
 *   6. Enough coverage / questions → final
 *   7. Otherwise → next (adapt difficulty)
 */
export function decideNext(
  memory: InterviewMemory,
  lastEval: CompetetencyEvalLite | null,
  opts: { maxQuestions: number; minQuestions: number }
): DecisionResult {
  const answeredCount = memory.answered.length;
  const last = memory.answered[answeredCount - 1];
  const lastScore = lastEval?.overallScore ?? last?.overallScore ?? null;

  const newDifficulty = nextDifficulty(memory.difficulty, lastScore);

  // 6. Enough questions answered → final.
  if (answeredCount >= opts.maxQuestions) {
    return { branch: { kind: "final", reason: `Reached max questions (${opts.maxQuestions}).` }, nextDifficulty: newDifficulty, preferredCategory: last?.category ?? "hr" };
  }
  // Still warming up on first question → plain next.
  if (answeredCount < opts.minQuestions && answeredCount > 0) {
    return { branch: { kind: "next", reason: "Warming up — continue standard progression." }, nextDifficulty: newDifficulty, preferredCategory: pickCategory(memory, newDifficulty) };
  }

  if (last) {
    const cat = last.category;
    const star = (last.competencies.behaviouralCompetency?.starStructure
      ?? last.competencies.behaviouralCompetency?.score
      ?? 100);
    const safety = last.competencies.safetyAwareness?.score ?? 100;
    const leadership = last.competencies.leadership?.score ?? 0;

    // 2. STAR clarification.
    if ((cat === "behavioral" || cat === "situational") && star < 50 && !last.starClarified) {
      return {
        branch: { kind: "star-clarification", reason: "Behavioural answer lacked STAR structure." },
        nextDifficulty: newDifficulty,
        preferredCategory: "behavioral",
        clarificationQuestion:
          "Your answer would be stronger with the STAR method. Walk me through the actual Situation, the Task you owned, the specific Actions you took, and the measurable Result. What happened in the end?",
      };
    }
    // 3. Safety branch.
    if (safety < 50 && (cat === "situational" || cat === "behavioral" || last.question.toLowerCase().includes("safety") || last.question.toLowerCase().includes("emergency"))) {
      return {
        branch: { kind: "safety-branch", reason: "Low safety awareness detected — branching into safety assessment." },
        nextDifficulty: newDifficulty,
        preferredCategory: "situational",
      };
    }
    // 4. Leadership branch.
    if (leadership >= 75) {
      return {
        branch: { kind: "leadership-branch", reason: "Strong leadership signal — transition to leadership scenarios." },
        nextDifficulty: newDifficulty,
        preferredCategory: "behavioral",
      };
    }
    // 5. Recovery.
    if ((lastScore ?? 100) < 50) {
      return {
        branch: { kind: "recovery", reason: "Candidate struggling — reduce difficulty and focus on fundamentals." },
        nextDifficulty: Math.max(1, (newDifficulty - 1)) as Difficulty,
        preferredCategory: "hr",
      };
    }
  }

  // 7. Standard next.
  return {
    branch: { kind: "next", reason: "Standard adaptive progression." },
    nextDifficulty: newDifficulty,
    preferredCategory: pickCategory(memory, newDifficulty),
  };
}

interface CompetetencyEvalLite {
  overallScore: number;
}

/** Deterministic category picker that fills the weakest uncovered competency. */
function pickCategory(memory: InterviewMemory, difficulty: Difficulty): InterviewQuestion["category"] {
  // Prefer a competency that is weak AND not yet covered.
  const weakUncovered = memory.competencies.missing
    .filter((c) => (memory.competencies.scores[c] < 50))
    .sort((a, b) => memory.competencies.scores[a] - memory.competencies.scores[b]);
  if (weakUncovered.length) {
    return competencyToCategory(weakUncovered[0]);
  }
  // Otherwise rotate by difficulty bias.
  if (difficulty >= 4) return Math.random() < 0.5 ? "situational" : "behavioral";
  if (difficulty <= 2) return Math.random() < 0.5 ? "hr" : "technical";
  return Math.random() < 0.4 ? "technical" : Math.random() < 0.7 ? "behavioral" : "situational";
}

function competencyToCategory(c: CompetencyKey): InterviewQuestion["category"] {
  switch (c) {
    case "technicalKnowledge": return "technical";
    case "behaviouralCompetency": return "behavioral";
    case "customerService": return "company";
    case "safetyAwareness": return "situational";
    case "leadership": return "behavioral";
    case "problemSolving": return "situational";
    case "teamwork": return "behavioral";
    case "communication": return "hr";
    case "professionalism": return "hr";
    case "confidence": return "hr";
    case "stressHandling": return "situational";
    case "adaptability": return "situational";
  }
}

// ----------------------------------------------------------------------------
// Step 5 — Dynamic Follow-up Engine
// ----------------------------------------------------------------------------

export interface GeneratedQuestion extends InterviewQuestion {
  isFollowUp?: boolean;
  personaId?: string;
  personaName?: string;
}

/**
 * Generate the NEXT question (or a follow-up) based on live memory + decision.
 * Reuses the SAME prompt builder context functions as the static generator.
 * Deterministic given identical inputs + model + temperature.
 */
export async function generateQuestion(
  memory: InterviewMemory,
  ctx: InterviewContext,
  opts: {
    purpose: "opening" | "adaptive" | "followup" | "star-clarification" | "safety" | "leadership" | "recovery";
    preferredCategory: InterviewQuestion["category"];
    difficulty: Difficulty;
    clarificationQuestion?: string;
  }
): Promise<GeneratedQuestion> {
  const analysisCtx = buildAnalysisContext(memory.resume, memory.jd, memory.atsReport, memory.reviewReport);
  const companyCtx = buildCompanyContext(memory.companyProfile);
  const personaCtx = `${memory.personas.map((p, i) => `${i + 1}. ${p.name} (${p.role})`).join("\n")}`;

  // Build interview history (Step 8 injection) — compact, ordered.
  const history = memory.answered
    .map(
      (a, i) =>
        `Q${i + 1} [${a.category}/${DIFFICULTY_TO_LABEL[a.difficulty]}] (${a.personaName ?? "?"}): ${a.question}\nA${i + 1}: ${a.answer.slice(0, 240)}${a.answer.length > 240 ? "…" : ""}\nScore: ${a.overallScore}`
    )
    .join("\n\n");

  const competencySummary = COMPETENCIES.map((c) => {
    const s = memory.competencies.scores[c];
    const covered = !memory.competencies.missing.includes(c);
    return `- ${COMPETENCY_LABELS[c]}: ${covered ? s + "/100" : "not yet assessed"}`;
  }).join("\n");

  const purposeInstruction: Record<typeof opts.purpose, string> = {
    opening: "This is the OPENING question — warm, accessible, behavioural/HR to ease the candidate in.",
    adaptive: "Generate a fresh adaptive question tuned to the candidate's live competency profile.",
    followup: "Generate a conversational follow-up that probes a detected competency GAP. Do NOT repeat a previous question.",
    "star-clarification": "The candidate's behavioural answer lacked STAR structure. Ask them to re-explain using Situation/Task/Action/Result.",
    safety: "Branch into a SAFETY-focused scenario (emergency response, compliance, CRM).",
    leadership: "Transition into a LEADERSHIP scenario (leading a team, decision under pressure).",
    recovery: "Easier RECOVERY question on fundamentals — build confidence, avoid impossible jumps.",
  };

  const systemPrompt = `You are an Expert Interview Coach running a LIVE adaptive interview. Generate ONE next question.
Rules:
- Reuse the interviewer personas listed below; assign the most appropriate personaId/personaName.
- Difficulty label MUST match: ${DIFFICULTY_TO_LABEL[opts.difficulty]}.
- NEVER repeat a question already asked (see History).
- NEVER ask the exact same follow-up twice.
- All content must be grounded in the resume, JD, and company profile.
- ${purposeInstruction[opts.purpose]}
Return ONLY valid JSON.`;

  const userPrompt = `CANDIDATE RESUME:
${buildResumeContext(memory.resume)}

JOB DESCRIPTION:
${buildJdContext(memory.jd)}

COMPANY CONTEXT:
${companyCtx || "(none)"}

INTERVIEWER PERSONAS:
${personaCtx}

ATS / SKILL ANALYSIS:
${analysisCtx}

CURRENT COMPETENCY STATE:
${competencySummary}

DIFFICULTY LEVEL: ${DIFFICULTY_TO_LABEL[opts.difficulty]} (ladder ${opts.difficulty}/5)
${opts.clarificationQuestion ? `CLARIFICATION PROMPT TO DELIVER: ${opts.clarificationQuestion}\n` : ""}
INTERVIEW HISTORY (do not repeat):
${history || "(no questions asked yet — this is the first)"}

Generate exactly ONE question of category "${opts.preferredCategory}". Return JSON:
{
  "question": "...",
  "category": "${opts.preferredCategory}",
  "difficulty": "${DIFFICULTY_TO_LABEL[opts.difficulty]}",
  "recommendedAnswer": "...",
  "talkingPoints": ["...","...","..."],
  "starExample": { "situation": "...", "task": "...", "action": "...", "result": "..." },
  "followUps": ["...","..."],
  "personaId": "...",
  "personaName": "..."
}`;

  const result = await recordAI(
    {
      systemPrompt,
      userPrompt,
      maxTokens: 1800,
      temperature: 0.3,
      taskCategory: "document",
    },
    interviewRecordOptions(memory, openingQuestionLike(opts), opts.purpose)
  );

  let data: any;
  try {
    data = extractJSON<any>(result.text);
  } catch {
    throw new Error("Failed to parse adaptive question. Please try again.");
  }

  const q: GeneratedQuestion = {
    id: uid("q"),
    category: data.category || opts.preferredCategory,
    question: data.question || opts.clarificationQuestion || "",
    difficulty: data.difficulty || DIFFICULTY_TO_LABEL[opts.difficulty],
    recommendedAnswer: data.recommendedAnswer || "",
    talkingPoints: Array.isArray(data.talkingPoints) ? data.talkingPoints : [],
    starExample: data.starExample,
    followUps: Array.isArray(data.followUps) ? data.followUps : [],
    isFollowUp: opts.purpose !== "opening" && opts.purpose !== "adaptive",
    personaId: data.personaId || memory.personas[0]?.id,
    personaName: data.personaName || memory.personas[0]?.name,
  };
  if (!q.question) throw new Error("AI returned an empty question.");
  return q;
}

// ----------------------------------------------------------------------------
// Final evaluation + report (terminal node)
// ----------------------------------------------------------------------------

export interface InterviewReport {
  overallScore: number;
  competencyScores: Record<CompetencyKey, number>;
  strengths: CompetencyKey[];
  weaknesses: CompetencyKey[];
  missingCompetencies: CompetencyKey[];
  recommendedNextSteps: string[];
  questionCount: number;
  difficultyProgression: Difficulty[];
}

export function buildReport(memory: InterviewMemory): InterviewReport {
  const comps = recomputeCompetencies(memory.answered);
  const scores = comps.scores;
  const vals = COMPETENCIES.map((c) => scores[c]).filter((n) => !Number.isNaN(n));
  const overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  const strengths = [...COMPETENCIES].filter((c) => scores[c] >= 75).sort((a, b) => scores[b] - scores[a]);
  const weaknesses = [...COMPETENCIES].filter((c) => scores[c] < 50).sort((a, b) => scores[a] - scores[b]);
  const missing = comps.missing;
  const recommendedNextSteps = weaknesses.slice(0, 4).map(
    (c) => `Strengthen ${COMPETENCY_LABELS[c]} (currently ${scores[c]}/100).`
  );
  const difficultyProgression = memory.answered.map((a) => a.difficulty);
  return {
    overallScore: overall,
    competencyScores: scores,
    strengths,
    weaknesses,
    missingCompetencies: missing,
    recommendedNextSteps,
    questionCount: memory.answered.length,
    difficultyProgression,
  };
}

/** Persistable package from a finished adaptive interview. */
export function toInterviewPackageFromMemory(memory: InterviewMemory, report: InterviewReport): InterviewPackage {
  const questions: InterviewQuestion[] = memory.answered.map((a) => ({
    id: a.id,
    category: a.category,
    question: a.question,
    difficulty: (a.difficulty ? DIFFICULTY_TO_LABEL[a.difficulty] : "medium") as InterviewQuestion["difficulty"],
    recommendedAnswer: "",
    talkingPoints: [],
    followUps: a.followUpsAsked,
  }));
  return {
    id: uid("iv"),
    resumeId: memory.resume.id,
    jdId: memory.jd?.id,
    company: memory.jd?.company ?? memory.companyProfile?.companyName,
    role: memory.jd?.title,
    questions,
    createdAt: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

/** Build a pseudo-question descriptor for the opening/generated call so the
 *  recorder can tag competency/branch metadata without a real answered record. */
function openingQuestionLike(opts: {
  purpose: "opening" | "adaptive" | "followup" | "star-clarification" | "safety" | "leadership" | "recovery";
  preferredCategory: InterviewQuestion["category"];
  difficulty: Difficulty;
}): { category: InterviewQuestion["category"]; difficulty: string } {
  return { category: opts.preferredCategory, difficulty: DIFFICULTY_TO_LABEL[opts.difficulty] };
}

/**
 * Translate live interview memory into Flight Recorder RecordOptions. This is
 * the ONLY place the recorder learns interview context — the engine stays the
 * owner of execution; the recorder only receives references + metadata.
 */
function interviewRecordOptions(
  memory: InterviewMemory,
  q: { category: InterviewQuestion["category"]; difficulty: string },
  purpose: string
): RecordOptions {
  const last = memory.answered[memory.answered.length - 1];
  return {
    resumeId: memory.resume.id,
    jdId: memory.jd?.id,
    personaId: memory.personas[0]?.id,
    company: memory.jd?.company ?? memory.companyProfile?.companyName,
    interviewSessionId: (memory as any).sessionId,
    interview: {
      questionType: q.category,
      difficulty: q.difficulty,
      competency: last ? summarizeWeakest(memory) : undefined,
      branch: purpose,
      persona: memory.personas[0]?.name,
      company: memory.jd?.company ?? memory.companyProfile?.companyName,
      interviewState: memory.answered.length === 0 ? "opening" : "adaptive",
      overallScore: last?.overallScore,
      confidence: last?.competencies.confidence?.score,
      missingCompetencies: memory.competencies.missing,
    },
    scope: "interview",
  };
}

function summarizeWeakest(memory: InterviewMemory): string {
  const weak = memory.competencies.repeatedWeaknesses[0] ?? COMPETENCIES.find((c) => memory.competencies.scores[c] < 50);
  return weak ?? "n/a";
}

function clamp(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
}
