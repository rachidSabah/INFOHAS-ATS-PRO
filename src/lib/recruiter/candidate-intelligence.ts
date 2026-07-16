// ============================================================================
// Candidate Intelligence — Phase 8.1.4
//
// The SINGLE recruiter read-model builder. Consumes EXISTING interview/AI-core
// outputs and produces a `CandidateIntelligence` object. EVERY other view
// (dashboard, competency analytics, decision analytics, timeline, benchmark,
// explainability, executive report) derives from this object.
//
// MANDATE: no AI, no ProviderRouter, no score/competency regeneration. Competency
// aggregation REUSES `recomputeCompetencies` + `buildReport` from the Adaptive
// Interview Engine. Decision/Reflection/QA/Validation are SURFACED from the
// FlightRecord blocks (never recomputed). Company match is a PURE comparison.
// ============================================================================

import {
  COMPETENCIES,
  COMPETENCY_LABELS,
  recomputeCompetencies,
  buildReport,
  type CompetencyKey,
  type CompetencyScore,
  type InterviewMemory,
} from "@/lib/interview/adaptive";
import type { FlightRecord, FlightDecision } from "@/lib/ai/flight-recorder";
import type {
  CandidateIntelligence,
  InterviewIntelligenceInput,
  RecruiterCompetency,
  BehavioralIntelligence,
  BehaviorKey,
  BehaviorDimension,
  CompanyMatchIntel,
  ResumeSummary,
  ATSSummary,
  DecisionSummary,
  ReflectionSummary,
  QASummary,
  ValidationSummary,
  FlightMetadataSummary,
  InterviewSummary,
  CandidateProfile,
  HiringRecommendation,
  RecruiterDashboard,
} from "./recruiter-types";

// ----------------------------------------------------------------------------
// Input normalization
// ----------------------------------------------------------------------------

function answeredFromInput(input: InterviewIntelligenceInput) {
  if (input.memory) return input.memory.answered;
  return [];
}

function primaryRecord(records?: FlightRecord[]): FlightRecord | undefined {
  if (!records || records.length === 0) return undefined;
  // Prefer a record that carries a decision block, else the last.
  return records.find((r) => r.decision) ?? records[records.length - 1];
}

// ----------------------------------------------------------------------------
// Competency mapping (reuses recomputeCompetencies)
// ----------------------------------------------------------------------------

function buildCompetencySummary(input: InterviewIntelligenceInput): Record<CompetencyKey, RecruiterCompetency> {
  const answered = answeredFromInput(input);
  const state = recomputeCompetencies(answered);

  const out = {} as Record<CompetencyKey, RecruiterCompetency>;
  for (const c of COMPETENCIES) {
    const score = state.scores[c] ?? 0;
    const evidenceList = state.evidence[c] ?? [];
    const csList: CompetencyScore[] = answered
      .map((a) => a.competencies[c])
      .filter((x): x is CompetencyScore => Boolean(x));

    const confidences = csList.map((x) => x.confidence).filter((n) => n > 0);
    const confidence = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0;

    const strong = evidenceList.filter((e) => /strong|excellent|clear|well|effective/i.test(e));
    const weak = evidenceList.filter((e) => /weak|missing|lack|unclear|poor|failed/i.test(e));
    const improvements = csList.map((x) => x.improvementSuggestion).filter(Boolean);

    // Trend: compare first vs last evaluation score for this competency.
    const hist = csList.map((x) => x.score);
    let trend: RecruiterCompetency["trend"] = "unknown";
    if (hist.length >= 2) {
      const delta = hist[hist.length - 1] - hist[0];
      trend = delta > 3 ? "up" : delta < -3 ? "down" : "flat";
    }

    out[c] = {
      key: c,
      label: COMPETENCY_LABELS[c],
      score,
      confidence,
      trend,
      evidence: evidenceList,
      supportingAnswers: answered
        .filter((a) => a.competencies[c])
        .map((a) => `Q: ${a.question}\nA: ${a.answer.slice(0, 200)}`),
      weakEvidence: weak.length ? weak : evidenceList.slice(0, 1),
      strongEvidence: strong.length ? strong : evidenceList.slice(0, 1),
      improvementSuggestions: [...new Set(improvements)],
      riskIndicator: state.repeatedWeaknesses.includes(c),
      benchmark: undefined,
      historicalProgress: hist,
    };
  }
  return out;
}

// ----------------------------------------------------------------------------
// Behavioral intelligence (16 dimensions derived from 12 competencies — no AI)
// ----------------------------------------------------------------------------

const BEHAVIOR_LABELS: Record<BehaviorKey, string> = {
  leadership: "Leadership",
  communication: "Communication",
  customerService: "Customer Service",
  safety: "Safety",
  professionalism: "Professionalism",
  stressManagement: "Stress Management",
  adaptability: "Adaptability",
  decisionMaking: "Decision Making",
  conflictResolution: "Conflict Resolution",
  ownership: "Ownership",
  criticalThinking: "Critical Thinking",
  starUsage: "STAR Usage",
  resilience: "Resilience",
  emotionalIntelligence: "Emotional Intelligence",
  listening: "Listening",
  teamwork: "Teamwork",
};

function buildBehavior(comp: Record<CompetencyKey, RecruiterCompetency>): BehavioralIntelligence {
  const get = (k: CompetencyKey) => comp[k]?.score ?? 0;
  const ev = (k: CompetencyKey) => comp[k]?.evidence ?? [];

  const def = (key: BehaviorKey, derived: CompetencyKey[], score: number, evidence: string[]): BehaviorDimension => ({
    key,
    label: BEHAVIOR_LABELS[key],
    score: Math.round(score),
    evidence,
    derivedFrom: derived,
  });

  const behaviors: Record<BehaviorKey, BehaviorDimension> = {
    leadership: def("leadership", ["leadership"], get("leadership"), ev("leadership")),
    communication: def("communication", ["communication"], get("communication"), ev("communication")),
    customerService: def("customerService", ["customerService"], get("customerService"), ev("customerService")),
    safety: def("safety", ["safetyAwareness"], get("safetyAwareness"), ev("safetyAwareness")),
    professionalism: def("professionalism", ["professionalism"], get("professionalism"), ev("professionalism")),
    stressManagement: def("stressManagement", ["stressHandling"], get("stressHandling"), ev("stressHandling")),
    adaptability: def("adaptability", ["adaptability"], get("adaptability"), ev("adaptability")),
    decisionMaking: def("decisionMaking", ["problemSolving", "leadership"], (get("problemSolving") + get("leadership")) / 2, [...ev("problemSolving"), ...ev("leadership")]),
    conflictResolution: def("conflictResolution", ["teamwork", "communication"], (get("teamwork") + get("communication")) / 2, [...ev("teamwork"), ...ev("communication")]),
    ownership: def("ownership", ["professionalism", "problemSolving"], (get("professionalism") + get("problemSolving")) / 2, [...ev("professionalism"), ...ev("problemSolving")]),
    criticalThinking: def("criticalThinking", ["problemSolving", "technicalKnowledge"], (get("problemSolving") + get("technicalKnowledge")) / 2, [...ev("problemSolving"), ...ev("technicalKnowledge")]),
    starUsage: def("starUsage", ["behaviouralCompetency"], comp.behaviouralCompetency?.historicalProgress.at(-1) ?? 0, ev("behaviouralCompetency")),
    resilience: def("resilience", ["stressHandling", "adaptability"], (get("stressHandling") + get("adaptability")) / 2, [...ev("stressHandling"), ...ev("adaptability")]),
    emotionalIntelligence: def("emotionalIntelligence", ["communication", "teamwork"], (get("communication") + get("teamwork")) / 2, [...ev("communication"), ...ev("teamwork")]),
    listening: def("listening", ["communication", "behaviouralCompetency"], (get("communication") + get("behaviouralCompetency")) / 2, [...ev("communication"), ...ev("behaviouralCompetency")]),
    teamwork: def("teamwork", ["teamwork"], get("teamwork"), ev("teamwork")),
  };

  const vals = Object.values(behaviors).map((b) => b.score);
  const overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  return { behaviors, overall };
}

// ----------------------------------------------------------------------------
// Company match (pure comparison — no AI)
// ----------------------------------------------------------------------------

function buildCompanyMatch(input: InterviewIntelligenceInput, comp: Record<CompetencyKey, RecruiterCompetency>): CompanyMatchIntel | null {
  const cp = input.companyProfile ?? input.memory?.companyProfile ?? null;
  if (!cp) return null;
  const get = (k: CompetencyKey) => comp[k]?.score ?? 0;

  const evidence: string[] = [];
  const roleComps = cp.roleCompetencies ?? [];
  const behavioralComps = cp.behaviouralCompetencies ?? [];

  // Values/culture/leadership match from competency coverage vs company asks.
  const coveredRole = roleComps.filter((rc) => {
    const key = (COMPETENCIES as readonly string[]).includes(rc) ? (rc as CompetencyKey) : null;
    return key ? get(key) >= 60 : false;
  });
  const valuesMatch = roleComps.length ? Math.round((coveredRole.length / roleComps.length) * 100) : 60;
  evidence.push(`Role competencies covered: ${coveredRole.length}/${roleComps.length}.`);

  const leadershipMatch = clamp(get("leadership"));
  const safetyMatch = clamp(get("safetyAwareness"));
  const customerExperienceMatch = clamp(get("customerService"));
  const cultureMatch = Math.round((valuesMatch + clamp(get("communication")) + clamp(get("professionalism"))) / 3);
  const luxuryServiceMatch = Math.round((customerExperienceMatch + clamp(get("communication"))) / 2);
  const brandRepresentation = clamp(get("professionalism"));
  const professionalStandards = clamp(get("professionalism"));

  const overall = Math.round(
    (cultureMatch + valuesMatch + safetyMatch + leadershipMatch + luxuryServiceMatch + customerExperienceMatch + brandRepresentation + professionalStandards) / 8
  );

  const reasoning = `Overall company readiness ${overall}/100 derived from candidate competencies vs ${cp.companyName} profile (${roleComps.length} role competencies, ${behavioralComps.length} behavioral).`;

  return {
    company: cp.companyName,
    cultureMatch,
    valuesMatch,
    safetyMatch,
    leadershipMatch,
    luxuryServiceMatch,
    customerExperienceMatch,
    brandRepresentation,
    professionalStandards,
    overallCompanyReadiness: overall,
    evidence,
    reasoning,
  };
}

// ----------------------------------------------------------------------------
// Summary builders (surface existing outputs — never regenerate)
// ----------------------------------------------------------------------------

function buildResumeSummary(input: InterviewIntelligenceInput): ResumeSummary {
  const rr = input.reviewReport ?? input.memory?.reviewReport ?? null;
  const resume = input.resume ?? input.memory?.resume;
  if (!rr && !resume) {
    return { present: false, topStrengths: [], topWeaknesses: [], missingSkills: [] };
  }
  return {
    present: true,
    overallScore: rr?.recruiter?.overallScore != null ? Math.round(rr.recruiter.overallScore * 10) : undefined,
    recruiterScore: rr?.recruiter?.overallScore,
    jobMatchPercent: rr?.jobMatch?.overallMatch,
    industryReadiness: rr?.benchmark?.industryReadinessScore,
    topStrengths: (rr?.recruiter?.sections ?? []).flatMap((s) => s.strengths).slice(0, 5),
    topWeaknesses: (rr?.recruiter?.sections ?? []).flatMap((s) => s.weaknesses).slice(0, 5),
    missingSkills: rr?.jobMatch?.missingSkills ?? [],
  };
}

function buildATSSummary(input: InterviewIntelligenceInput): ATSSummary {
  const ats = input.atsReport ?? input.memory?.atsReport ?? null;
  if (!ats) return { present: false, matchedKeywords: [], missingKeywords: [], weakSections: [] };
  return {
    present: true,
    atsScore: ats.scores?.ats,
    jdMatchPercent: ats.jdMatchPercent,
    matchedKeywords: ats.matchedKeywords ?? [],
    missingKeywords: ats.missingKeywords ?? [],
    weakSections: ats.weakSections ?? [],
  };
}

function buildDecisionSummary(rec?: FlightRecord): DecisionSummary {
  const d = rec?.decision as FlightDecision | undefined;
  if (!d) return { present: false };
  return {
    present: true,
    status: d.status,
    reason: d.reason,
    confidence: d.confidence,
    evidence: d.evidence,
  };
}

function buildReflectionSummary(rec?: FlightRecord): ReflectionSummary {
  const r = rec?.reflection;
  if (!r) return { present: false };
  return {
    present: true,
    outcome: r.outcome,
    score: r.score,
    confidence: r.confidence,
    summary: r.summary,
    retryRecommended: r.retryRecommended,
  };
}

function buildQASummary(rec?: FlightRecord): QASummary {
  const q = rec?.qa;
  if (!q) return { present: false };
  return { present: true, outcome: q.outcome, score: q.score, confidence: q.confidence, failRecommended: q.failRecommended };
}

function buildValidationSummary(rec?: FlightRecord): ValidationSummary {
  const v = rec?.validation;
  if (!v) return { present: false };
  return { present: true, outcome: v.outcome, score: v.score, failRecommended: v.failRecommended, criticalFailures: v.criticalFailures };
}

function buildFlightSummary(input: InterviewIntelligenceInput, rec?: FlightRecord): FlightMetadataSummary {
  const answered = answeredFromInput(input);
  if (!rec && answered.length === 0) return { present: false };
  return {
    present: true,
    executionId: rec?.executionId,
    provider: rec?.provider,
    model: rec?.model,
    durationMs: rec?.durationMs,
    latencyMs: rec?.latencyMs,
    tokenUsage: rec?.tokenUsage,
    questionCount: answered.length || rec?.interview?.questionType ? (answered.length || undefined) : undefined,
    completionRate: answered.length ? 1 : undefined,
  };
}

function buildInterviewSummary(input: InterviewIntelligenceInput): InterviewSummary {
  const memory = input.memory;
  const answered = answeredFromInput(input);
  if (!memory && answered.length === 0 && !input.package) {
    return { present: false, strengths: [], weaknesses: [], missingCompetencies: [], recommendedNextSteps: [] };
  }
  if (memory) {
    const report = buildReport(memory);
    return {
      present: true,
      overallScore: report.overallScore,
      questionCount: report.questionCount,
      difficultyProgression: report.difficultyProgression,
      strengths: report.strengths,
      weaknesses: report.weaknesses,
      missingCompetencies: report.missingCompetencies,
      recommendedNextSteps: report.recommendedNextSteps,
    };
  }
  // Package-only fallback: no scores available.
  return {
    present: true,
    questionCount: input.package?.questions.length ?? 0,
    strengths: [],
    weaknesses: [],
    missingCompetencies: [],
    recommendedNextSteps: [],
  };
}

// ----------------------------------------------------------------------------
// Overall / blended scores
// ----------------------------------------------------------------------------

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildCandidateProfile(input: InterviewIntelligenceInput): CandidateProfile {
  const memory = input.memory;
  const resume = input.resume ?? memory?.resume;
  const jd = input.jd ?? memory?.jd;
  const cp = input.companyProfile ?? memory?.companyProfile;
  return {
    resumeId: input.package?.resumeId ?? memory?.resume.id,
    jdId: input.package?.jdId ?? memory?.jd?.id,
    name: resume?.name,
    company: input.package?.company ?? jd?.company,
    role: input.package?.role ?? jd?.title,
    targetCompany: cp?.companyName,
  };
}

// ----------------------------------------------------------------------------
// Main builder
// ----------------------------------------------------------------------------

export function buildCandidateIntelligence(input: InterviewIntelligenceInput): CandidateIntelligence {
  const comp = buildCompetencySummary(input);
  const behavior = buildBehavior(comp);
  const rec = primaryRecord(input.records);

  const interview = buildInterviewSummary(input);
  const resume = buildResumeSummary(input);
  const ats = buildATSSummary(input);
  const companyMatch = buildCompanyMatch(input, comp);
  const decision = buildDecisionSummary(rec);
  const reflection = buildReflectionSummary(rec);
  const qa = buildQASummary(rec);
  const validation = buildValidationSummary(rec);
  const flight = buildFlightSummary(input, rec);

  const candidate = buildCandidateProfile(input);

  // Blended overall: interview (50) + resume (20) + ats (15) + company (15).
  const interviewScore = interview.overallScore ?? 0;
  const resumeScore = resume.recruiterScore != null ? Math.round(resume.recruiterScore * 10) : resume.overallScore ?? 0;
  const atsScore = ats.atsScore ?? ats.jdMatchPercent ?? 0;
  const companyScore = companyMatch?.overallCompanyReadiness ?? 0;
  const overall = clamp(
    Math.round(interviewScore * 0.5 + resumeScore * 0.2 + atsScore * 0.15 + companyScore * 0.15)
  );

  // Employer pass likelihood: blend of interview + company + (decision acceptance).
  const decisionBoost = decision.status === "accept" ? 10 : decision.status === "reject" ? -25 : 0;
  const employerPassLikelihood = clamp(overall + decisionBoost);

  // Follow-up questions: adaptive followUps + weakness-based probes.
  const adaptiveFollowUps = answeredFromInput(input).flatMap((a) => a.followUpsAsked ?? []);
  const weaknessProbes = interview.weaknesses
    .slice(0, 3)
    .map((c) => `Probe deeper on ${COMPETENCY_LABELS[c]} with a behavioural scenario.`);
  const followUpQuestions = [...new Set([...adaptiveFollowUps, ...weaknessProbes])].slice(0, 8);

  return {
    candidate,
    interview,
    competencySummary: comp,
    behavior,
    resume,
    ats,
    companyMatch,
    scenario: input.scenario ?? input.memory?.personas[0]?.name,
    persona: input.persona,
    position: input.position ?? candidate.role,
    decision,
    reflection,
    qa,
    validation,
    flight,
    overall,
    employerPassLikelihood,
    followUpQuestions,
    generatedAt: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Recruiter Dashboard (top-line view derived from CandidateIntelligence)
// ----------------------------------------------------------------------------

export function buildRecruiterDashboard(ci: CandidateIntelligence): RecruiterDashboard {
  const comp = ci.competencySummary;
  const leadership = comp.leadership?.score ?? 0;
  const communication = comp.communication?.score ?? 0;
  const safety = comp.safetyAwareness?.score ?? 0;
  const professionalism = comp.professionalism?.score ?? 0;
  const customerService = comp.customerService?.score ?? 0;
  const adaptability = comp.adaptability?.score ?? 0;

  const interviewScore = ci.interview.overallScore ?? 0;
  const resumeScore = ci.resume.recruiterScore != null ? Math.round(ci.resume.recruiterScore * 10) : ci.resume.overallScore ?? 0;
  const atsMatch = ci.ats.atsScore ?? ci.ats.jdMatchPercent ?? 0;
  const companyMatch = ci.companyMatch?.overallCompanyReadiness ?? 0;

  // Hiring recommendation from decision status + overall score.
  const rec: HiringRecommendation =
    ci.decision.status === "reject" || ci.decision.status === "escalate"
      ? "reject"
      : ci.overall >= 80
        ? "strong_hire"
        : ci.overall >= 68
          ? "hire"
          : ci.overall >= 55
            ? "lean_hire"
            : ci.overall >= 40
              ? "hold"
              : "reject";

  // Risk = inverse of weakest competency floors + decision reject.
  const scores = COMPETENCIES.map((c) => comp[c]?.score ?? 0);
  const minScore = scores.length ? Math.min(...scores) : 0;
  const overallRisk = clamp(100 - minScore - (ci.decision.status === "reject" ? 20 : 0));

  // Potential = behavior overall + adaptability + leadership ceiling.
  const potential = clamp(Math.round((ci.behavior.overall + adaptability + leadership) / 3));

  // Recruiter confidence = decision confidence (or behavior consistency).
  const recruiterConfidence = ci.decision.confidence != null ? Math.round(ci.decision.confidence * 100) : Math.round(ci.behavior.overall);

  // Completion rate from flight metadata.
  const completionRate = ci.flight.completionRate ?? (ci.interview.questionCount ? 1 : 0);

  const overview = `${ci.candidate.name ?? "Candidate"} — ${ci.candidate.role ?? "role n/a"} at ${ci.candidate.company ?? "n/a"}. Overall readiness ${ci.overall}/100. Recommendation: ${rec}.`;

  return {
    candidate: ci.candidate,
    candidateOverview: overview,
    hiringRecommendation: rec,
    hiringConfidence: recruiterConfidence,
    interviewScore,
    resumeScore,
    atsMatch,
    companyMatch,
    overallRisk,
    potential,
    recruiterConfidence,
    completionRate,
    durationMs: ci.flight.durationMs ?? 0,
    targetCompany: ci.candidate.targetCompany,
    scenario: ci.scenario,
    persona: ci.persona,
    position: ci.position,
  };
}

/** Helper exported for analytics modules: percentiles for a numeric pool. */
export function percentileRank(value: number, pool: number[]): number {
  if (pool.length === 0) return 50;
  const below = pool.filter((n) => n < value).length;
  return Math.round((below / pool.length) * 100);
}
