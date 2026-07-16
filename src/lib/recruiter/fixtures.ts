// ============================================================================
// Test fixtures for Phase 8.1.4 Recruiter Intelligence.
//
// Builds a realistic InterviewMemory + FlightRecord from REAL type shapes (no AI
// mocks). Reused across the recruiter test suite.
// ============================================================================

import {
  COMPETENCIES,
  type CompetencyKey,
  type CompetencyScore,
  type InterviewMemory,
  type AnsweredQuestion,
} from "@/lib/interview/adaptive";
import type { InterviewContext } from "@/lib/interview/ai";
import type { FlightRecord, FlightDecision } from "@/lib/ai/flight-recorder";
import type { ResumeData, JobDescription, ATSReport, ResumeReviewReport } from "@/lib/types";
import type { CompanyProfile } from "@/lib/interview/ai";

function cs(score: number, evidence: string, confidence = 70, improvement = "Practice more."): CompetencyScore {
  return { score, evidence, confidence, improvementSuggestion: improvement };
}

export function makeAnswered(overrides: Partial<AnsweredQuestion> = {}): AnsweredQuestion {
  const competencies: Partial<Record<CompetencyKey, CompetencyScore>> = {};
  for (const c of COMPETENCIES) {
    competencies[c] = cs(70, `Evidence for ${c}.`, 70);
  }
  return {
    id: "a1",
    question: "Tell me about a time you led a team through a difficult change.",
    category: "behavioral",
    difficulty: 3,
    personaName: "Sarah (Hiring Manager)",
    answer: "I led a cross-functional team through a system migration, coordinating daily standups and unblocking stakeholders.",
    overallScore: 72,
    competencies,
    followUpsAsked: ["Can you quantify the impact?"],
    ...overrides,
  };
}

export function makeMemory(): InterviewMemory {
  const answered = [
    makeAnswered({
      id: "a1",
      overallScore: 80,
      competencies: Object.fromEntries(
        COMPETENCIES.map((c) => [c, cs(c === "leadership" ? 85 : 70, `Evidence ${c}`, 80)])
      ) as Partial<Record<CompetencyKey, CompetencyScore>>,
    }),
    makeAnswered({
      id: "a2",
      category: "situational",
      overallScore: 65,
      competencies: Object.fromEntries(
        COMPETENCIES.map((c) => [c, cs(c === "safetyAwareness" ? 40 : 65, `Evidence ${c}`, 60)])
      ) as Partial<Record<CompetencyKey, CompetencyScore>>,
    }),
    makeAnswered({
      id: "a3",
      category: "technical",
      overallScore: 90,
      competencies: Object.fromEntries(
        COMPETENCIES.map((c) => [c, cs(c === "technicalKnowledge" ? 92 : 78, `Evidence ${c}`, 85)])
      ) as Partial<Record<CompetencyKey, CompetencyScore>>,
    }),
  ];

  const resume: ResumeData = {
    id: "r1",
    name: "Jordan Lee",
    headline: "Senior Operations Lead",
    skills: [{ name: "Leadership" }, { name: "Communication" }, { name: "Safety" }],
  } as unknown as ResumeData;

  const jd: JobDescription = {
    id: "jd1",
    title: "Hotel Operations Manager",
    company: "Luxury Suites Group",
  } as unknown as JobDescription;

  const companyProfile: CompanyProfile = {
    companyName: "Luxury Suites Group",
    values: ["Excellence", "Integrity"],
    culture: "Service-oriented luxury hospitality.",
    leadershipPrinciples: ["Ownership", "Customer obsession"],
    servicePhilosophy: "Anticipate guest needs.",
    roleCompetencies: ["leadership", "communication", "customerService", "safetyAwareness"],
    behaviouralCompetencies: ["leadership", "communication"],
    interviewFocusAreas: ["luxury service", "safety"],
    positioningAdvice: "Emphasize hospitality leadership.",
    source: {} as any,
    jobIntelligence: {} as any,
  };

  return {
    resume,
    jd,
    atsReport: undefined,
    reviewReport: undefined,
    companyProfile,
    personas: [{ id: "p1", name: "Sarah (Hiring Manager)", role: "Hiring Manager" } as any],
    answered,
    difficulty: 3,
    askedQuestionTexts: answered.map((a) => a.question),
    competencies: {} as any, // recomputed by engine
  };
}

export function makeDecision(status: FlightDecision["status"] = "accept"): FlightDecision {
  return {
    decisionId: "dcx-1",
    enabled: true,
    status,
    reason: "All engines passed.",
    confidence: 0.9,
    evidence: "validation=passed qa=passed reflection=ok",
    trace: [{ ruleId: "dec.all-engines-pass", triggered: true, status: "accept" }],
    rules: [{ ruleId: "dec.all-engines-pass", profile: "interview", status: "accept", confidence: 0.9, reason: "All engines passed.", evidence: "", triggered: true }],
    supportingReflection: "ok (score 88)",
    supportingQA: "passed (score 90)",
    supportingValidation: "passed (score 85)",
    deterministic: true,
    version: "8.1.3.6",
    durationMs: 1,
    errors: [],
  };
}

export function makeFlightRecord(status: FlightDecision["status"] = "accept"): FlightRecord {
  return {
    executionId: "fx-1",
    timestamp: new Date().toISOString(),
    feature: "Interview",
    provider: "OpenAI",
    model: "gpt-4o",
    streaming: false,
    promptVersion: "x",
    promptHash: "h",
    contextHash: "c",
    durationMs: 1200,
    latencyMs: 1100,
    tokenUsage: 800,
    retryCount: 0,
    reflectionEnabled: true,
    qaEnabled: true,
    validationEnabled: true,
    decisionEnabled: true,
    decisionResult: status,
    status: "success" as any,
    warnings: [],
    errors: [],
    scope: "interview",
    prompt: { userPrompt: "" },
    parameters: {},
    timeline: [
      { name: "context", at: 0 },
      { name: "reflection", at: 100, detail: "ok" },
      { name: "qa", at: 200, detail: "passed" },
      { name: "validation", at: 300, detail: "passed" },
      { name: "decision", at: 400, detail: status },
    ],
    performance: { totalMs: 1200 },
    cost: { inputTokens: 400, outputTokens: 400, estimatedCost: 0.01, provider: "OpenAI", model: "gpt-4o" },
    reflection: {
      reflectionId: "rfx-1", enabled: true, score: 88, confidence: 85, summary: "Strong answer.",
      strengths: ["clear"], weaknesses: [], missingInformation: [], instructionViolations: [],
      formatViolations: [], reasoningIssues: [], hallucinationRisk: 0.1, determinismRisk: 0.1,
      suggestedActions: [], retryRecommended: false, retryReason: "", outcome: "ok",
      promptVersion: "x", durationMs: 100, latencyMs: 100, provider: "OpenAI", model: "gpt-4o",
      cost: 0, tokens: 100, errors: [],
    },
    qa: {
      qaId: "qfx-1", enabled: true, score: 90, confidence: 88, outcome: "passed", summary: "Good.",
      findings: [], hallucinationRisk: 0.1, policyRisk: 0.1, incompletenessRisk: 0.1,
      passed: true, failRecommended: false, failReason: "", promptVersion: "x",
      durationMs: 100, latencyMs: 100, provider: "OpenAI", model: "gpt-4o", cost: 0, tokens: 100, errors: [],
    },
    validation: {
      validationId: "vfx-1", enabled: true, score: 85, outcome: "passed", profile: "interview",
      rules: [], warnings: [], failures: [], reasons: [], criticalFailures: 0, passed: true,
      failRecommended: false, deterministic: true, version: "8.1.3.5", durationMs: 50, errors: [],
    },
    decision: makeDecision(status),
  } as unknown as FlightRecord;
}

export function makeATSReport(): ATSReport {
  return {
    id: "ats-1", resumeId: "r1", scores: { ats: 82, formatting: 90, keywords: 80, content: 85, grammar: 88, completeness: 80 },
    recommendations: [], missingKeywords: ["kubernetes"], matchedKeywords: ["leadership", "safety"], weakSections: [], jdMatchPercent: 78,
    createdAt: new Date().toISOString(),
  };
}

export function makeReviewReport(): ResumeReviewReport {
  return {
    id: "rr-1", userId: "u1", resumeId: "r1", industryProfile: "Hospitality",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ats: { atsScore: 82, keywordMatch: 80, missingKeywords: [], formattingIssues: [], sectionDetection: [], parsingRisks: [], graphicsRisks: [], tablesRisks: [], fileCompatibility: [], passProbability: 80, recommendations: [] },
    recruiter: { overallScore: 8, sections: [{ section: "Summary", score: 8, strengths: ["concise"], weaknesses: ["vague"], recommendations: [] }] },
    jobMatch: { overallMatch: 76, atsMatch: 78, experienceMatch: 80, skillMatch: 75, educationMatch: 70, industryMatch: 77, missingSkills: ["kubernetes"], missingKeywords: [], missingCertifications: [] },
    benchmark: { industry: "Hospitality", role: "Manager", seniority: "Senior", country: "US", industryReadinessScore: 74, benchmarkComparisons: [], insights: [] },
    improvements: { betterSummary: "", betterHeadlines: [], betterSkills: [], betterBulletPoints: [], betterAchievements: [], actionVerbs: [], metrics: [], highValueKeywords: [] },
    actionPlan: { criticalFixes: [], highPriorityFixes: [], optionalImprovements: [], expectedAtsIncrease: 0 },
    interviewReadiness: { likelyQuestions: [], weakAreas: [], talkingPoints: [], preparationAdvice: [] },
  } as unknown as ResumeReviewReport;
}

export function makeInterviewContext(): InterviewContext {
  return {} as InterviewContext;
}
