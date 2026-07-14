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

Generate a comprehensive, ADAPTIVE interview preparation package with 9-15 questions that varies every time based on the inputs above:
- 3-5 Technical questions (about technologies/skills IN the resume OR required by the JD)
- 3-5 Behavioral questions (STAR method, past experiences from the resume)
- 2-3 Situational questions (hypothetical scenarios relevant to the role)
- 1-3 Role-specific / Company-specific questions (about the company's values/culture/products or the specific role)
- Include follow-up questions that probe deeper on weak areas flagged by the ATS/missing-skills analysis

For each question provide:
- category: "technical" | "behavioral" | "situational" | "hr" | "company"
- question: the interview question
- difficulty: "easy" | "medium" | "hard" | "adaptive"
- recommendedAnswer: recruiter-grade answer using the candidate's REAL experience
- talkingPoints: 3-5 bullet points for the answer
- starExample: { situation, task, action, result } (for behavioral/situational)
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
  "questions": [ { "category": "...", "question": "...", "difficulty": "...", "recommendedAnswer": "...", "talkingPoints": [...], "starExample": {...}, "followUps": [...], "personaId": "...", "personaName": "..." } ],
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
    data = extractJSON<any>(result.text);
  } catch {
    throw new Error("Failed to parse AI response. Please try again.");
  }

  const questions: GeneratedQuestion[] = (data.questions ?? []).map((q: any) => ({
    id: uid("q"),
    category: q.category || "hr",
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
