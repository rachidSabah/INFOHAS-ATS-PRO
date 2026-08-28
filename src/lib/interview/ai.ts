// ============================================================================
// Interview AI — question generation + answer evaluation.
//
// CLAUDE.md mandate: a SINGLE AI orchestration pipeline. This module is the
// ONLY AI entrypoint for the Interview feature. It calls the existing
// `callAI` / `extractJSON` from "@/lib/ai" (which routes through
// ProviderRouter). No new provider abstractions, no second pipeline.
//
// Part 2 (generator) and Part 6 (evaluator) both live here and reuse the
// resume/JD/ATS/competency data already held in the shared store.
// ============================================================================

import { extractJSON } from "@/lib/ai";
import { recordAI, type RecordOptions } from "@/lib/ai/flight-recorder";
import { detectIndustry, INDUSTRY_PROFILES } from "@/lib/industry-ats";
import { analyzeCompanyIntelligence, type CompanyIntelligence } from "@/lib/agents/company-skill-agents";
import { analyzeJobIntelligence, type JobIntelligence } from "@/lib/job-intelligence";
import { uid } from "@/lib/store";
import { runWithParseRepair } from "@/lib/agents/structured-output";
import {
  INTERVIEW_PERSONAS,
  PERSONAS_BY_ID,
  buildPersonaContext,
  type InterviewPersona,
} from "@/lib/interview/personas";
import type {
  ATSReport,
  InterviewPackage,
  InterviewQuestion,
  InterviewQuestionSubType,
  JobDescription,
  ResumeData,
  ResumeReviewReport,
} from "@/lib/types";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Difficulty levels requested by the brief (extends the base union usage). */
export type InterviewDifficulty = "easy" | "medium" | "hard" | "adaptive";

export interface InterviewContext {
  resume: ResumeData;
  jd?: JobDescription;
  atsReport?: ATSReport;
  reviewReport?: ResumeReviewReport;
  /** Interviewer personas to simulate (HR, Cabin Crew Manager, ...). */
  personaIds?: string[];
  /**
   * Extensible company knowledge. When omitted but a JD with a company is
   * present, generateInterviewQuestions derives it from analyzeCompanyIntelligence
   * (never hard-coded). Supplied here to avoid recomputation when known.
   */
  companyProfile?: CompanyProfile;
  /** Override difficulty distribution; defaults to balanced. */
  difficultyBias?: InterviewDifficulty;
}

/**
 * Extensible company knowledge — the foundation of every interview.
 * Built from analyzeCompanyIntelligence + analyzeJobIntelligence so the same
 * scaffold works for ANY company. No hard-coded company logic lives here.
 */
export interface CompanyProfile {
  companyName: string;
  values: string[];
  culture: string;
  leadershipPrinciples: string[];
  servicePhilosophy: string;
  roleCompetencies: string[];
  behaviouralCompetencies: string[];
  interviewFocusAreas: string[];
  /** Short positioning advice for this candidate → company. */
  positioningAdvice: string;
  /** Source intelligence (so analytics/Flight Recorder can trace origin). */
  source: CompanyIntelligence;
  jobIntelligence: JobIntelligence;
}

export interface GeneratedQuestion extends InterviewQuestion {
  /** Present only for follow-up style; surfaced to the UI as a hint. */
  isFollowUp?: boolean;
  /** Interviewer persona that posed the question (8.1.1 multi-persona). */
  personaId?: string;
  personaName?: string;
  /**
   * Sub-type tag from the 10-question-family Sonru taxonomy. Always present on
   * freshly generated packages (post-v2); legacy packages may lack it. UI code
   * should fall back to `category` when undefined.
   */
  subType?: InterviewQuestionSubType;
}

export interface GeneratedPackage {
  questions: GeneratedQuestion[];
  readinessScore: number;
  strengths: string[];
  weaknesses: string[];
  topicsToReview: string[];
  skillsToReview: string[];
  focusAreas: string[];
  /** Short rationale the AI used to adapt the set to this candidate. */
  adaptationNote: string;
}

// ---- Part 6: answer evaluation (11 dimensions) ----------------------------

export interface VideoDerivedMetrics {
  /** 0..1 estimated eye-contact ratio (from vision model or null). */
  eyeContact?: number | null;
  /** Words per minute estimate (from transcript). */
  wordsPerMinute?: number | null;
  /** Filler-word count from transcript. */
  fillerWordCount?: number | null;
  /** Whether a video stream was present at all. */
  videoAvailable: boolean;
}

export interface AnswerEvaluation {
  communication: number; // 0-100
  confidence: number;
  grammar: number;
  fluency: number;
  professionalism: number;
  eyeContact: number | null; // null when video unavailable / no vision model
  speakingSpeed: number | null; // 0-100 (normalized from WPM)
  fillerWords: number | null; // 0-100 (lower filler = higher score)
  contentRelevance: number;
  starStructure: number;
  roleFit: number;
  /** Weighted overall answer score (video-only dims excluded when null). */
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  idealAnswer: string;
  /** Per-dimension note shown to the candidate. */
  notes: Partial<Record<keyof Omit<AnswerEvaluation, "strengths" | "weaknesses" | "suggestions" | "idealAnswer" | "overallScore" | "notes">, string>>;
}

export interface EvaluateAnswerInput {
  question: InterviewQuestion;
  answerText: string;
  resume?: ResumeData;
  jd?: JobDescription;
  /** Optional transcript-derived / vision-derived signals. */
  videoMetrics?: VideoDerivedMetrics;
}

// ----------------------------------------------------------------------------
// Context builder — reuses ATS analysis, missing skills, competencies, company
// ----------------------------------------------------------------------------

const AIRLINE_PRESETS_DEPRECATED = {}; // removed: company logic is now AI-derived, not hard-coded
void AIRLINE_PRESETS_DEPRECATED;

export function buildResumeContext(resume: ResumeData): string {
  return JSON.stringify({
    name: resume.name,
    headline: resume.headline,
    summary: resume.summary,
    experience: resume.experience.map((e) => ({
      title: e.title,
      company: e.company,
      location: e.location,
      bullets: e.bullets,
    })),
    skills: resume.skills.map((s) => s.name),
    education: resume.education.map((ed) => ({ degree: ed.degree, institution: ed.institution })),
    languages: resume.languages.map((l) => l.name),
    certifications: resume.certifications.map((c) => c.name),
  });
}

export function buildJdContext(jd?: JobDescription): string {
  if (!jd) return "No specific job description provided — generate general, role-appropriate questions.";
  return (
    jd.rawText ??
    JSON.stringify({
      title: jd.title,
      company: jd.company,
      responsibilities: jd.responsibilities,
      requiredSkills: jd.requiredSkills,
      preferredSkills: jd.preferredSkills,
      keywords: jd.keywords,
    })
  );
}

/** Pull the ATS / competency signals the brief asks the generator to use. */
export function buildAnalysisContext(
  resume: ResumeData,
  jd?: JobDescription,
  atsReport?: ATSReport,
  reviewReport?: ResumeReviewReport
): string {
  const parts: string[] = [];

  if (atsReport) {
    parts.push(
      `ATS ANALYSIS (resume vs this JD):
- ATS score: ${atsReport.scores.ats}/100
- Keyword match: ${atsReport.scores.keywords}/100
- Missing keywords: ${atsReport.missingKeywords.join(", ") || "none"}
- Matched keywords: ${atsReport.matchedKeywords.join(", ") || "none"}
- Weak sections: ${atsReport.weakSections.join(", ") || "none"}
- JD match: ${atsReport.jdMatchPercent ?? "n/a"}%`
    );
  }

  if (reviewReport?.jobMatch) {
    const jm = reviewReport.jobMatch;
    parts.push(
      `JOB MATCH ANALYSIS:
- Overall match: ${jm.overallMatch}/100
- Skill match: ${jm.skillMatch}/100
- Missing skills: ${jm.missingSkills.join(", ") || "none"}
- Missing keywords: ${jm.missingKeywords.join(", ") || "none"}
- Missing certifications: ${jm.missingCertifications.join(", ") || "none"}`
    );
  }

  if (jd) {
    parts.push(
      `REQUIRED COMPETENCIES (from JD):
- Required skills: ${jd.requiredSkills.join(", ") || "none"}
- Preferred skills: ${jd.preferredSkills.join(", ") || "none"}
- Technologies: ${jd.technologies.join(", ") || "none"}`
    );
  }

  // Company info from JD.
  if (jd?.company) {
    parts.push(
      `COMPANY INFORMATION:
- Company: ${jd.company}
- Location: ${jd.location ?? "n/a"}
- Employment type: ${jd.employmentType ?? "n/a"}
- Known for: ${jd.keywords.slice(0, 8).join(", ") || "n/a"}`
    );
  }

  return parts.join("\n\n");
}

function buildIndustryContext(resume: ResumeData, jd?: JobDescription): string {
  if (!jd) return "";
  const jdText = jd.rawText ?? jd.keywords.join(" ");
  const resumeText = `${resume.name} ${resume.headline ?? ""} ${resume.summary ?? ""} ${
    resume.experience.map((e) => e.title + " " + e.company).join(" ")
  }`;
  const det = detectIndustry(jdText, resumeText);
  if (!det) return "";
  const profile = INDUSTRY_PROFILES[det.industryId];
  if (!profile) return "";
  return `INDUSTRY: ${profile.label}
INDUSTRY KEYWORDS: ${profile.priorityKeywords.join(", ")}
INDUSTRY WRITING GUIDANCE: ${profile.writingGuidance}`;
}

export function buildCompanyContext(profile?: CompanyProfile | null): string {
  if (!profile) return "";
  const parts: string[] = [];
  parts.push(
    `COMPANY PROFILE (${profile.companyName}):
- Values: ${profile.values.join(", ") || "n/a"}
- Culture: ${profile.culture || "n/a"}
- Leadership principles: ${profile.leadershipPrinciples.join(", ") || "n/a"}
- Service philosophy: ${profile.servicePhilosophy || "n/a"}`
  );
  parts.push(
    `ROLE COMPETENCIES expected by ${profile.companyName}: ${profile.roleCompetencies.join(", ") || "n/a"}
BEHAVIOURAL COMPETENCIES valued: ${profile.behaviouralCompetencies.join(", ") || "n/a"}
INTERVIEW FOCUS AREAS: ${profile.interviewFocusAreas.join(", ") || "n/a"}`
  );
  // Role competencies from the JD's job intelligence (extensible, no hard-coding).
  const ji = profile.jobIntelligence;
  if (ji) {
    parts.push(
      `JOB INTELLIGENCE (role competencies):
- Required competencies: ${ji.requiredCompetencies.join(", ") || "n/a"}
- Required soft skills: ${ji.requiredSoftSkills.join(", ") || "n/a"}
- Recruiter intent: ${ji.recruiterIntent || "n/a"}`
    );
  }
  if (profile.positioningAdvice) {
    parts.push(`POSITIONING ADVICE: ${profile.positioningAdvice}`);
  }
  parts.push(
    "- Generate company-specific questions that probe these values, leadership principles, and role/behavioural competencies. Do NOT invent company facts not listed above — work only from this profile."
  );
  return parts.join("\n\n");
}

/**
 * Derive an extensible CompanyProfile from the JD using the existing
 * company-intelligence + job-intelligence agents. Never hard-codes company
 * details. Returns null when no company can be identified.
 */
export async function deriveCompanyProfile(
  jd: JobDescription,
  ji?: JobIntelligence | null
): Promise<CompanyProfile | null> {
  const jobIntelligence = ji ?? (jd.company?.trim() ? await analyzeJobIntelligence(jd) : null);
  const company = await analyzeCompanyIntelligence(jd, jobIntelligence);
  if (!company) return null;
  return {
    companyName: company.companyName,
    values: company.values,
    culture: company.culture,
    leadershipPrinciples: company.leadershipPrinciples,
    servicePhilosophy: company.positioningAdvice || company.businessFocus || "",
    roleCompetencies: company.valuedCompetencies,
    behaviouralCompetencies: company.interviewFocusAreas,
    interviewFocusAreas: company.interviewFocusAreas,
    positioningAdvice: company.positioningAdvice,
    source: company,
    jobIntelligence: jobIntelligence ?? (await analyzeJobIntelligence(jd)),
  };
}

// ----------------------------------------------------------------------------
// Part 2 — Question generator
// ----------------------------------------------------------------------------

export async function generateInterviewQuestions(
  ctx: InterviewContext
): Promise<GeneratedPackage> {
  const { resume, jd, atsReport, reviewReport, personaIds, companyProfile, difficultyBias } = ctx;

  // Resolve personas (default: full rotation if none supplied).
  const personas: InterviewPersona[] = (personaIds && personaIds.length
    ? personaIds.map((id) => PERSONAS_BY_ID[id]).filter(Boolean)
    : INTERVIEW_PERSONAS
  ) as InterviewPersona[];

  // Extensible company profile: derive if not supplied but a JD+company exists.
  let profile: CompanyProfile | null = companyProfile ?? null;
  if (!profile && jd?.company?.trim()) {
    profile = await deriveCompanyProfile(jd);
  }

  const analysisCtx = buildAnalysisContext(resume, jd, atsReport, reviewReport);
  const industryCtx = buildIndustryContext(resume, jd);
  const companyCtx = buildCompanyContext(profile);
  const personaCtx = buildPersonaContext(personas);
  const difficultyNote = difficultyBias
    ? `DIFFICULTY BIAS: lean the set toward "${difficultyBias}" questions where it makes sense.`
    : "";

  const systemPrompt = `You are an Expert Interview Coach and Senior Recruiter. You generate highly personalized interview preparation packages tailored to the candidate's resume and the job description.
You NEVER ask about technologies or experiences not present in the resume.
You NEVER fabricate answers — all answers reference real experience from the resume.
You ADAPT questions to the detected industry, the ATS analysis, the candidate's missing skills, and the required competencies.
Questions MUST change depending on the resume, the job description, the candidate's experience, the ATS score, and (when provided) previous answers.
Always return ONLY valid JSON.

${industryCtx}
${companyCtx}
${personaCtx}
${difficultyNote}`;

  const userPrompt = `CANDIDATE'S RESUME (primary source — use ONLY this information for answers):
${buildResumeContext(resume)}

JOB DESCRIPTION:
${buildJdContext(jd)}

COMPANY: ${jd?.company || profile?.companyName || "the company"}
JOB TITLE: ${jd?.title || "the role"}
${analysisCtx}

Generate a comprehensive, ADAPTIVE interview preparation package with 10-16 questions that varies every time based on the inputs above. Cover ALL 10 question families required by the Sonru Video & Voice Screen Simulator spec:

1. HR questions (category="hr", subType="hr") — icebreakers, motivation, salary, notice period, work authorization. 1-3 questions.
2. Behavioral questions (category="behavioral", subType="behavioral") — past experiences from the resume. 2-3 questions.
3. STAR questions (category="behavioral", subType="star") — explicit STAR-method prompts with quantified outcomes. 1-2 questions.
4. Technical questions (category="technical", subType="technical") — about technologies/skills IN the resume OR required by the JD. 2-3 questions.
5. Situational questions (category="situational", subType="situational") — hypothetical scenarios relevant to the role. 1-2 questions.
6. Company-fit questions (category="company", subType="company-fit") — about the company's values/culture/products. 1-2 questions.
7. Leadership questions (category="behavioral", subType="leadership") — only if the resume shows leadership experience OR the JD requires it; otherwise OMIT. 0-2 questions.
8. Problem-solving questions (category="situational", subType="problem-solving") — a concrete problem to walk through. 1-2 questions.
9. Resume-specific questions (category="hr" or "behavioral", subType="resume-specific") — drill into a specific bullet from the candidate's resume. 1-2 questions.
10. Job-description-specific questions (category="technical" or "company", subType="jd-specific") — probe a specific responsibility/requirement from the JD. 1-2 questions.

For each question provide:
- category: "technical" | "behavioral" | "situational" | "hr" | "company" (legacy 5)
- subType: one of "hr" | "behavioral" | "star" | "technical" | "situational" | "company-fit" | "leadership" | "problem-solving" | "resume-specific" | "jd-specific"
- question: the interview question
- difficulty: "easy" | "medium" | "hard" | "adaptive"
- recommendedAnswer: recruiter-grade answer using the candidate's REAL experience
- talkingPoints: 3-5 bullet points for the answer
- starExample: { situation, task, action, result } (for behavioral/situational/star/leadership)
- followUps: 2-3 follow-up questions
- personaId: the id of the most appropriate interviewer persona from the panel above
- personaName: the display name of that persona

Also provide:
- readinessScore: 0-100 (how prepared the candidate is, considering the ATS match)
- strengths: 3-5 areas where the candidate is strong
- weaknesses: 3-5 areas to improve (tie to missing skills where possible)
- topicsToReview: 3-5 topics to study before the interview
- skillsToReview: 3-5 skills to brush up on
- focusAreas: 3-5 likely interview focus areas for this role/company
- adaptationNote: 1-2 sentences explaining how this set was tailored to this candidate

Return JSON:
{
  "questions": [ { "category": "...", "subType": "...", "question": "...", "difficulty": "...", "recommendedAnswer": "...", "talkingPoints": [...], "starExample": {...}, "followUps": [...], "personaId": "...", "personaName": "..." } ],
  "readinessScore": 78,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "topicsToReview": ["..."],
  "skillsToReview": ["..."],
  "focusAreas": ["..."],
  "adaptationNote": "..."
}`;

  const result = await recordAI(
    {
      systemPrompt,
      userPrompt,
      maxTokens: 6000,
      temperature: 0.5,
      taskCategory: "document",
    },
    {
      resumeId: resume.id,
      jdId: jd?.id,
      company: jd?.company ?? profile?.companyName,
      personaId: personas[0]?.id,
      interview: {
        questionType: "package",
        company: jd?.company ?? profile?.companyName,
        persona: personas.map((p) => p.name).join(", "),
        interviewState: "generation",
      },
      scope: "interview",
    }
  );

  let data: any;
  try {
    // STRUCTURED OUTPUT: robust cascade + ONE bounded parse-error repair
    // round before surfacing an error to the user (previously a single parse
    // failure — prose wrap, truncation, trailing comma — threw immediately).
    const { data: parsed } = await runWithParseRepair<any>(
      async (repairFeedback) => {
        const retry = repairFeedback
          ? await recordAI(
              {
                systemPrompt,
                userPrompt: `${userPrompt}\n\n${repairFeedback}`,
                maxTokens: 6000,
                temperature: 0.5,
                taskCategory: "document",
              },
              {
                resumeId: resume.id,
                jdId: jd?.id,
                company: jd?.company ?? profile?.companyName,
                scope: "interview",
              }
            )
          : result;
        return retry.text ?? "";
      },
      {
        type: "object",
        required: ["questions"],
        properties: { questions: { type: "array", minLength: 1 } },
        label: "interview package",
      },
      { label: "Interview package", maxRepairRounds: 1 }
    );
    data = parsed;
  } catch {
    throw new Error("Failed to parse AI response after one repair round. Please try again.");
  }

  const questions: GeneratedQuestion[] = (data.questions ?? []).map((q: any) => ({
    id: uid("q"),
    category: q.category || "hr",
    subType: normalizeSubType(q.subType, q.category),
    question: q.question || "",
    difficulty: q.difficulty || "medium",
    recommendedAnswer: q.recommendedAnswer || "",
    talkingPoints: Array.isArray(q.talkingPoints) ? q.talkingPoints : [],
    starExample: q.starExample,
    followUps: Array.isArray(q.followUps) ? q.followUps : [],
    personaId: q.personaId || personas[0]?.id,
    personaName: q.personaName || personas[0]?.name,
  }));

  if (!questions.length) throw new Error("AI returned no questions.");

  return {
    questions,
    readinessScore: data.readinessScore ?? 75,
    strengths: data.strengths ?? [],
    weaknesses: data.weaknesses ?? [],
    topicsToReview: data.topicsToReview ?? [],
    skillsToReview: data.skillsToReview ?? [],
    focusAreas: data.focusAreas ?? [],
    adaptationNote: data.adaptationNote ?? "",
  };
}

/** Build a persistable InterviewPackage from a generated set. */
export function toInterviewPackage(
  generated: GeneratedPackage,
  ctx: InterviewContext
): InterviewPackage {
  return {
    id: uid("iv"),
    resumeId: ctx.resume.id,
    jdId: ctx.jd?.id,
    company: ctx.jd?.company ?? ctx.companyProfile?.companyName,
    role: ctx.jd?.title,
    questions: generated.questions,
    createdAt: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Part 6 — Answer evaluation (11 dimensions)
// ----------------------------------------------------------------------------

function buildEvaluationPrompt(
  input: EvaluateAnswerInput
): { systemPrompt: string; userPrompt: string } {
  const { question, answerText, resume, jd, videoMetrics } = input;

  const videoSection = videoMetrics
    ? `VIDEO-DERIVED SIGNALS:
- Video available: ${videoMetrics.videoAvailable}
- Eye-contact ratio: ${videoMetrics.eyeContact != null ? videoMetrics.eyeContact : "not analyzed"}
- Speaking speed: ${videoMetrics.wordsPerMinute != null ? videoMetrics.wordsPerMinute + " wpm" : "not measured"}
- Filler-word count: ${videoMetrics.fillerWordCount != null ? videoMetrics.fillerWordCount : "not measured"}
If eyeContact / speakingSpeed / fillerWords are not analyzed, set those scores to null — do NOT fabricate them.`
    : `VIDEO-DERIVED SIGNALS: none provided (text/voice answer only). Set eyeContact, speakingSpeed, and fillerWords to null.`;

  const systemPrompt = `You are an expert interview coach and evaluator. Evaluate the candidate's answer across 11 dimensions and return ONLY valid JSON.
Score every dimension 0-100. Set a dimension to null ONLY when the required signal is genuinely unavailable (e.g. eye contact without video).
Focus heavily on STAR structure (Situation, Task, Action, Result) with quantified outcomes where applicable.
Never fabricate scores for missing signals.`;

  const userPrompt = `QUESTION:
${question.question}
Category: ${question.category}
Difficulty: ${question.difficulty}

CANDIDATE'S ANSWER:
${answerText}

${resume ? `CANDIDATE RESUME (context): ${resume.headline ?? resume.name} — skills: ${resume.skills.map((s) => s.name).join(", ")}` : ""}
${jd ? `TARGET ROLE: ${jd.title} at ${jd.company}` : ""}

${videoSection}

Evaluate and return JSON:
{
  "communication": 0-100,
  "confidence": 0-100,
  "grammar": 0-100,
  "fluency": 0-100,
  "professionalism": 0-100,
  "eyeContact": null-or-0-100,
  "speakingSpeed": null-or-0-100,
  "fillerWords": null-or-0-100,
  "contentRelevance": 0-100,
  "starStructure": 0-100,
  "roleFit": 0-100,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "suggestions": ["..."],
  "idealAnswer": "A model answer incorporating the talking points",
  "notes": {
    "communication": "short note",
    "starStructure": "short note",
    "roleFit": "short note"
  }
}`;

  return { systemPrompt, userPrompt };
}

export async function evaluateAnswer(input: EvaluateAnswerInput): Promise<AnswerEvaluation> {
  const { systemPrompt, userPrompt } = buildEvaluationPrompt(input);

  const result = await recordAI(
    {
      systemPrompt,
      userPrompt,
      maxTokens: 1800,
      temperature: 0.4,
      taskCategory: "document",
    },
    {
      resumeId: input.resume?.id,
      jdId: input.jd?.id,
      company: input.jd?.company,
      interview: {
        questionType: input.question.category,
        difficulty: input.question.difficulty,
        competency: input.question.category,
        company: input.jd?.company,
        interviewState: "evaluation",
        overallScore: undefined,
      },
      scope: "interview",
    }
  );

  let data: any;
  try {
    data = extractJSON<any>(result.text);
  } catch {
    throw new Error("Could not parse AI feedback. Please try again.");
  }

  // Weighted overall; exclude null (video-only) dimensions from the average.
  const weighted: Array<number> = [
    data.communication,
    data.confidence,
    data.grammar,
    data.fluency,
    data.professionalism,
    data.contentRelevance,
    data.starStructure,
    data.roleFit,
  ].filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (data.eyeContact != null) weighted.push(data.eyeContact);
  if (data.speakingSpeed != null) weighted.push(data.speakingSpeed);
  if (data.fillerWords != null) weighted.push(data.fillerWords);

  const overall =
    weighted.length > 0
      ? Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length)
      : 0;

  return {
    communication: num(data.communication),
    confidence: num(data.confidence),
    grammar: num(data.grammar),
    fluency: num(data.fluency),
    professionalism: num(data.professionalism),
    eyeContact: nullable(data.eyeContact),
    speakingSpeed: nullable(data.speakingSpeed),
    fillerWords: nullable(data.fillerWords),
    contentRelevance: num(data.contentRelevance),
    starStructure: num(data.starStructure),
    roleFit: num(data.roleFit),
    overallScore: overall,
    strengths: arr(data.strengths),
    weaknesses: arr(data.weaknesses),
    suggestions: arr(data.suggestions),
    idealAnswer: typeof data.idealAnswer === "string" ? data.idealAnswer : "",
    notes: typeof data.notes === "object" && data.notes ? data.notes : {},
  };
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function nullable(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

function arr(v: any): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

// ----------------------------------------------------------------------------
// Sub-type normalisation — coerce arbitrary model output into the 10-family
// Sonru taxonomy. Falls back to the legacy category when the sub-type is
// missing or unrecognized. Non-throwing.
// ----------------------------------------------------------------------------

const VALID_SUB_TYPES: ReadonlySet<InterviewQuestionSubType> = new Set([
  "hr",
  "behavioral",
  "star",
  "technical",
  "situational",
  "company-fit",
  "leadership",
  "problem-solving",
  "resume-specific",
  "jd-specific",
]);

/**
 * Map a legacy 5-bucket `category` to the closest 10-family `subType`. Used
 * when the model omits `subType` or returns an invalid value.
 */
function fallbackSubTypeForCategory(category: string): InterviewQuestionSubType {
  switch (category) {
    case "technical":
      return "technical";
    case "behavioral":
      return "behavioral";
    case "situational":
      return "situational";
    case "hr":
      return "hr";
    case "company":
      return "company-fit";
    default:
      return "hr";
  }
}

function normalizeSubType(
  raw: unknown,
  category: unknown
): InterviewQuestionSubType | undefined {
  if (typeof raw === "string" && VALID_SUB_TYPES.has(raw as InterviewQuestionSubType)) {
    return raw as InterviewQuestionSubType;
  }
  if (typeof category === "string") {
    return fallbackSubTypeForCategory(category);
  }
  return undefined;
}

// ----------------------------------------------------------------------------
// Match-score helper — produces the structured resume↔JD breakdown surfaced on
// the Interview Prep page (Phase E3). Reuses ATS report + review report data
// already computed by the ATS Scanner; never re-runs the AI.
// ----------------------------------------------------------------------------

export interface InterviewMatchScore {
  /** Overall 0-100 fit score for THIS resume against THIS JD. */
  overall: number;
  /** 0-100 skill overlap (matched / (matched + missing)). */
  skillMatch: number;
  /** 0-100 ATS keyword match. */
  keywordMatch: number;
  /** 0-100 experience-years alignment vs JD requirement. */
  experienceMatch: number;
  /** 0-100 education alignment vs JD requirement. */
  educationMatch: number;
  /** 0-100 industry alignment (detected industry vs JD industry). */
  industryMatch: number;
  /** Required skills the candidate already has. */
  matchedSkills: string[];
  /** Required skills the candidate is missing. */
  missingSkills: string[];
  /** ATS keywords missing from the resume. */
  missingKeywords: string[];
  /** Certifications required by the JD but absent from the resume. */
  missingCertifications: string[];
  /** Detected experience level (entry / mid / senior / lead). */
  seniority: "entry" | "mid" | "senior" | "lead" | "unknown";
  /** Detected industry label (e.g. "Aviation", "Information Technology"). */
  industry: string;
  /** Education summary line for the resume. */
  education: string;
  /** Certifications the candidate already holds. */
  certifications: string[];
}

/**
 * Derive a structured resume↔JD match score WITHOUT any AI call. Reuses the
 * existing ATS report and review report when available; otherwise performs a
 * local heuristic comparison of skill lists. Pure function — safe to call in
 * render.
 */
export function buildInterviewMatchScore(
  resume: ResumeData,
  jd?: JobDescription | null,
  atsReport?: ATSReport | null,
  reviewReport?: ResumeReviewReport | null
): InterviewMatchScore {
  // ---- skills ----
  const resumeSkills = new Set(
    (resume.skills ?? [])
      .map((s) => (typeof s === "string" ? (s as string) : s.name))
      .map((s: string) => s.toLowerCase().trim())
      .filter(Boolean)
  );
  const requiredSkills = (jd?.requiredSkills ?? []).map((s) => s.toLowerCase().trim());
  const matchedSkills = requiredSkills.filter((s) => resumeSkills.has(s));
  const missingSkills = requiredSkills.filter((s) => !resumeSkills.has(s));
  const skillMatch = requiredSkills.length
    ? Math.round((matchedSkills.length / requiredSkills.length) * 100)
    : 100;

  // ---- ATS keywords ----
  const missingKeywords = atsReport?.missingKeywords ?? [];
  const matchedKeywords = atsReport?.matchedKeywords ?? [];
  const totalKeywords = missingKeywords.length + matchedKeywords.length;
  const keywordMatch = atsReport
    ? totalKeywords
      ? Math.round((matchedKeywords.length / totalKeywords) * 100)
      : atsReport.scores.keywords
    : jd?.keywords?.length
    ? Math.round(
        (jd.keywords.filter((k) => resumeSkills.has(k.toLowerCase().trim())).length /
          jd.keywords.length) *
          100
      )
    : 100;

  // ---- experience years ----
  const requiredYears = parseYears(jd?.experienceYears);
  const candidateYears = estimateExperienceYears(resume);
  const experienceMatch = requiredYears
    ? Math.min(100, Math.round((candidateYears / requiredYears) * 100))
    : 100;

  // ---- education ----
  const educationMatch = jd?.education
    ? matchEducation(resume, jd.education)
    : 100;
  const education = (resume.education ?? [])
    .map((e) => `${e.degree}${e.institution ? ` — ${e.institution}` : ""}`)
    .join("; ") || "Not specified";

  // ---- certifications ----
  const resumeCertifications = (resume.certifications ?? []).map((c) => c.name.toLowerCase().trim());
  const requiredCertifications = (reviewReport?.jobMatch?.missingCertifications ?? []).map((c) =>
    c.toLowerCase().trim()
  );
  const missingCertifications = requiredCertifications.filter(
    (c) => !resumeCertifications.some((rc) => rc.includes(c) || c.includes(rc))
  );

  // ---- industry ----
  let industryLabel = "Generic";
  let industryMatch = 100;
  if (jd) {
    const jdText = jd.rawText ?? jd.keywords.join(" ");
    const resumeText = `${resume.name} ${resume.headline ?? ""} ${resume.summary ?? ""} ${
      resume.experience.map((e) => e.title + " " + e.company).join(" ")
    }`;
    const det = detectIndustry(jdText, resumeText);
    if (det) {
      const profile = INDUSTRY_PROFILES[det.industryId];
      industryLabel = profile?.label ?? "Generic";
      // Confidence from the detector scaled to 0..100; same industry = 100,
      // otherwise weight by the detector's own confidence.
      industryMatch = Math.round(det.confidence);
    }
  }

  // ---- seniority ----
  const seniority = estimateSeniority(resume, jd);

  // ---- overall ----
  const componentScores = [
    skillMatch,
    keywordMatch,
    experienceMatch,
    educationMatch,
    industryMatch,
  ].filter((n) => Number.isFinite(n));
  const overall =
    reviewReport?.jobMatch?.overallMatch ??
    (componentScores.length
      ? Math.round(componentScores.reduce((a, b) => a + b, 0) / componentScores.length)
      : 75);

  return {
    overall,
    skillMatch,
    keywordMatch,
    experienceMatch,
    educationMatch,
    industryMatch,
    matchedSkills: matchedSkills.map(titleCase),
    missingSkills: missingSkills.map(titleCase),
    missingKeywords,
    missingCertifications,
    seniority,
    industry: industryLabel,
    education,
    certifications: (resume.certifications ?? []).map((c) => c.name),
  };
}

function parseYears(raw?: string): number | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function estimateExperienceYears(resume: ResumeData): number {
  // Heuristic: count years from earliest to latest experience entry. Falls
  // back to number-of-roles when dates are missing.
  const exps = resume.experience ?? [];
  if (exps.length === 0) return 0;
  // Try to parse start dates; if none have dates, assume 2 years per role.
  const dated = exps.filter((e) => (e as any).startDate || (e as any).endDate);
  if (dated.length === 0) return exps.length * 2;
  const years = dated.map((e) => {
    const start = parseYear((e as any).startDate);
    const end = parseYear((e as any).endDate) ?? new Date().getFullYear();
    if (!start) return 0;
    return Math.max(0, end - start);
  });
  return years.reduce((a, b) => a + b, 0);
}

function parseYear(s?: string): number | null {
  if (!s) return null;
  const m = String(s).match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

function matchEducation(resume: ResumeData, required: string): number {
  const req = required.toLowerCase();
  const has = (resume.education ?? []).some((e) => {
    const deg = `${e.degree} ${e.institution ?? ""}`.toLowerCase();
    if (req.includes("phd") || req.includes("doctorate")) {
      return deg.includes("phd") || deg.includes("doctor");
    }
    if (req.includes("master")) {
      return deg.includes("master") || deg.includes("mba") || deg.includes("phd");
    }
    if (req.includes("bachelor") || req.includes("degree")) {
      return (
        deg.includes("bachelor") ||
        deg.includes("master") ||
        deg.includes("mba") ||
        deg.includes("phd") ||
        deg.includes("license") ||
        deg.includes("engineer")
      );
    }
    if (req.includes("diploma") || req.includes("high school")) {
      return true; // any education satisfies a diploma requirement
    }
    return true;
  });
  return has ? 100 : 40;
}

function estimateSeniority(
  resume: ResumeData,
  jd?: JobDescription | null
): "entry" | "mid" | "senior" | "lead" | "unknown" {
  const years = estimateExperienceYears(resume);
  const title = (resume.headline ?? jd?.title ?? "").toLowerCase();
  if (/(director|head of|vp|vice president|chief|principal)/.test(title)) return "lead";
  if (/(senior|sr\.?|lead|staff)/.test(title)) return "senior";
  if (/(junior|jr\.?|intern|trainee|entry)/.test(title)) return "entry";
  if (years >= 8) return "lead";
  if (years >= 4) return "senior";
  if (years >= 1) return "mid";
  if (years > 0) return "entry";
  return "unknown";
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ----------------------------------------------------------------------------
// Hiring recommendation — aggregates per-question evaluations into a final
// interview report. Makes ONE AI call when `useAI: true` (default) so the
// narrative is coherent; falls back to a deterministic heuristic if the AI
// call fails or when `useAI: false`.
// ----------------------------------------------------------------------------

export type HiringVerdict =
  | "strong-yes"
  | "yes"
  | "lean-yes"
  | "no"
  | "strong-no";

export interface InterviewFinalReport {
  /** Overall 0-100 interview score (avg of per-question overallScore). */
  overallScore: number;
  /** Hiring recommendation verdict. */
  verdict: HiringVerdict;
  /** Human-readable verdict label (e.g. "Strong Yes — Hire"). */
  verdictLabel: string;
  /** ATS readiness % — how ready the candidate is to pass an ATS rescan. */
  atsReadiness: number;
  /** Per-category average scores. */
  categoryAverages: Record<string, number>;
  /** Top 3 strengths across all answers. */
  topStrengths: string[];
  /** Top 3 weaknesses across all answers. */
  topWeaknesses: string[];
  /** Top 3 actionable improvements. */
  actionItems: string[];
  /** 1-2 sentence narrative summary. */
  narrative: string;
  /** Number of questions answered vs total. */
  answeredCount: number;
  /** Number of questions skipped. */
  skippedCount: number;
  /** Total questions in the package. */
  totalCount: number;
}

export interface FinalReportInput {
  /** Per-question evaluations keyed by questionId. */
  evaluations: Array<{
    questionId: string;
    category: string;
    subType?: string;
    overallScore: number;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  }>;
  totalCount: number;
  skippedCount?: number;
  /** Resume↔JD match score (from buildInterviewMatchScore). Optional. */
  matchScore?: InterviewMatchScore | null;
  /** When true, calls the AI to produce the narrative. Default true. */
  useAI?: boolean;
  /** Resume id (for Flight Recorder attribution). */
  resumeId?: string;
  /** JD id (for Flight Recorder attribution). */
  jdId?: string;
  /** Company name (for Flight Recorder attribution). */
  company?: string;
}

const VERDICT_LABELS: Record<HiringVerdict, string> = {
  "strong-yes": "Strong Yes — Hire",
  yes: "Yes — Hire",
  "lean-yes": "Lean Yes — Hire with Reservations",
  no: "No — Do Not Hire",
  "strong-no": "Strong No — Do Not Hire",
};

function verdictFromScore(score: number, atsReadiness: number): HiringVerdict {
  // Combine interview score (weight 0.7) and ATS readiness (weight 0.3).
  const blended = score * 0.7 + atsReadiness * 0.3;
  if (blended >= 85) return "strong-yes";
  if (blended >= 72) return "yes";
  if (blended >= 60) return "lean-yes";
  if (blended >= 45) return "no";
  return "strong-no";
}

/**
 * Aggregate per-question evaluations into a final interview report.
 *
 * Strategy:
 * 1. Always compute the deterministic parts (overall, category averages, top
 *    strengths/weaknesses, verdict, ATS readiness) locally — no AI needed.
 * 2. If `useAI` is true (default), make ONE additional `recordAI` call to
 *    produce a polished narrative + curated action items. If that call fails
 *    or returns garbage, fall back to a heuristic narrative.
 */
export async function generateHiringRecommendation(
  input: FinalReportInput
): Promise<InterviewFinalReport> {
  const { evaluations, totalCount, skippedCount = 0, matchScore, useAI = true } = input;

  const answeredCount = evaluations.length;
  const overallScore = answeredCount
    ? Math.round(
        evaluations.reduce((sum, e) => sum + (e.overallScore ?? 0), 0) / answeredCount
      )
    : 0;

  // ---- per-category averages ----
  const byCat = new Map<string, number[]>();
  for (const e of evaluations) {
    const arr = byCat.get(e.category) ?? [];
    arr.push(e.overallScore ?? 0);
    byCat.set(e.category, arr);
  }
  const categoryAverages: Record<string, number> = {};
  for (const [cat, scores] of byCat) {
    categoryAverages[cat] = Math.round(
      scores.reduce((a, b) => a + b, 0) / scores.length
    );
  }

  // ---- ATS readiness — combine interview score with match-score keyword coverage ----
  const atsReadiness = matchScore
    ? Math.round(overallScore * 0.5 + matchScore.keywordMatch * 0.3 + matchScore.skillMatch * 0.2)
    : overallScore;

  // ---- top strengths / weaknesses (frequency-weighted) ----
  const strengthCounts = new Map<string, number>();
  const weaknessCounts = new Map<string, number>();
  const suggestionCounts = new Map<string, number>();
  for (const e of evaluations) {
    for (const s of e.strengths ?? []) {
      const key = s.trim();
      if (key) strengthCounts.set(key, (strengthCounts.get(key) ?? 0) + 1);
    }
    for (const w of e.weaknesses ?? []) {
      const key = w.trim();
      if (key) weaknessCounts.set(key, (weaknessCounts.get(key) ?? 0) + 1);
    }
    for (const s of e.suggestions ?? []) {
      const key = s.trim();
      if (key) suggestionCounts.set(key, (suggestionCounts.get(key) ?? 0) + 1);
    }
  }
  const topStrengths = topN(strengthCounts, 3);
  const topWeaknesses = topN(weaknessCounts, 3);
  const actionItems = topN(suggestionCounts, 3);

  const verdict = verdictFromScore(overallScore, atsReadiness);
  const verdictLabel = VERDICT_LABELS[verdict];

  // ---- narrative ----
  const heuristicNarrative = buildHeuristicNarrative({
    overallScore,
    verdict,
    answeredCount,
    totalCount,
    topStrengths,
    topWeaknesses,
    matchScore,
  });

  let narrative = heuristicNarrative;
  if (useAI && answeredCount > 0) {
    try {
      const aiNarrative = await generateNarrativeViaAI({
        overallScore,
        verdict,
        categoryAverages,
        topStrengths,
        topWeaknesses,
        actionItems,
        matchScore,
        answeredCount,
        totalCount,
        skippedCount,
        resumeId: input.resumeId,
        jdId: input.jdId,
        company: input.company,
      });
      if (aiNarrative) narrative = aiNarrative;
    } catch {
      // Fall back to the heuristic narrative.
    }
  }

  return {
    overallScore,
    verdict,
    verdictLabel,
    atsReadiness,
    categoryAverages,
    topStrengths,
    topWeaknesses,
    actionItems,
    narrative,
    answeredCount,
    skippedCount,
    totalCount,
  };
}

function topN(counts: Map<string, number>, n: number): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
}

function buildHeuristicNarrative(args: {
  overallScore: number;
  verdict: HiringVerdict;
  answeredCount: number;
  totalCount: number;
  topStrengths: string[];
  topWeaknesses: string[];
  matchScore?: InterviewMatchScore | null;
}): string {
  const { overallScore, verdict, answeredCount, totalCount, topStrengths, topWeaknesses, matchScore } = args;
  const parts: string[] = [];
  parts.push(
    `The candidate answered ${answeredCount} of ${totalCount} questions with an overall interview score of ${overallScore}/100.`
  );
  parts.push(`Hiring recommendation: ${VERDICT_LABELS[verdict]}.`);
  if (topStrengths.length) {
    parts.push(`Key strengths: ${topStrengths.join("; ")}.`);
  }
  if (topWeaknesses.length) {
    parts.push(`Areas to develop: ${topWeaknesses.join("; ")}.`);
  }
  if (matchScore) {
    parts.push(
      `Resume↔JD match: ${matchScore.overall}/100 (skills ${matchScore.skillMatch}, keywords ${matchScore.keywordMatch}, experience ${matchScore.experienceMatch}).`
    );
  }
  return parts.join(" ");
}

async function generateNarrativeViaAI(args: {
  overallScore: number;
  verdict: HiringVerdict;
  categoryAverages: Record<string, number>;
  topStrengths: string[];
  topWeaknesses: string[];
  actionItems: string[];
  matchScore?: InterviewMatchScore | null;
  answeredCount: number;
  totalCount: number;
  skippedCount: number;
  resumeId?: string;
  jdId?: string;
  company?: string;
}): Promise<string | null> {
  const {
    overallScore,
    verdict,
    categoryAverages,
    topStrengths,
    topWeaknesses,
    actionItems,
    matchScore,
    answeredCount,
    totalCount,
    skippedCount,
    resumeId,
    jdId,
    company,
  } = args;

  const systemPrompt =
    "You are a senior hiring committee scribe. Given structured interview metrics, write a single cohesive 60-90 word narrative that a recruiter can paste into an ATS note. Be specific, factual, and free of fluff. Do not invent details. Return ONLY the narrative paragraph (no JSON, no markdown headings).";

  const userPrompt = `INTERVIEW METRICS:
- Overall score: ${overallScore}/100
- Verdict: ${VERDICT_LABELS[verdict]}
- Questions answered: ${answeredCount}/${totalCount} (skipped: ${skippedCount})
- Category averages: ${Object.entries(categoryAverages)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ") || "n/a"}
- Top strengths: ${topStrengths.join("; ") || "n/a"}
- Top weaknesses: ${topWeaknesses.join("; ") || "n/a"}
- Action items: ${actionItems.join("; ") || "n/a"}
${
  matchScore
    ? `- Resume↔JD match: ${matchScore.overall}/100 (skills ${matchScore.skillMatch}, keywords ${matchScore.keywordMatch}, experience ${matchScore.experienceMatch}, industry ${matchScore.industryMatch})
- Seniority: ${matchScore.seniority} · Industry: ${matchScore.industry}
- Missing skills: ${matchScore.missingSkills.join(", ") || "none"}
- Missing keywords: ${matchScore.missingKeywords.join(", ") || "none"}`
    : ""
}

Write the narrative now.`;

  const result = await recordAI(
    {
      systemPrompt,
      userPrompt,
      maxTokens: 400,
      temperature: 0.4,
      taskCategory: "document",
    },
    {
      resumeId,
      jdId,
      company,
      interview: {
        questionType: "final-report",
        company,
        interviewState: "final-report",
      },
      scope: "interview",
    }
  );
  const text = (result?.text ?? "").trim();
  return text || null;
}
