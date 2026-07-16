// ============================================================================
// Enterprise Recruiter Intelligence & Analytics Platform — Phase 8.1.4
//
// SHARED TYPES for the recruiter read-model. This platform is PURE and
// READ-ONLY: it consumes EXISTING interview/AI-core outputs (InterviewMemory,
// InterviewPackage, FlightRecord reflection/qa/validation/decision blocks,
// CompanyProfile, ATSReport, ResumeReviewReport). It NEVER executes AI, NEVER
// calls ProviderRouter, and NEVER regenerates scores or competencies.
//
// `CandidateIntelligence` is the single source of truth; every other view
// (dashboard, competency analytics, decision analytics, timeline, benchmark,
// explainability, executive report) derives from it.
// ============================================================================

import type { CompetencyKey } from "@/lib/interview/adaptive";
import type { InterviewMemory } from "@/lib/interview/adaptive";
import type { InterviewPackage } from "@/lib/types";
import type { FlightRecord } from "@/lib/ai/flight-recorder";
import type { FlightDecision } from "@/lib/ai/flight-recorder";
import type { CompanyProfile } from "@/lib/interview/ai";
import type { ATSReport, ResumeReviewReport, ResumeData, JobDescription } from "@/lib/types";

export type { CompetencyKey };

// ----------------------------------------------------------------------------
// Input (normalized — works from live memory OR persisted package)
// ----------------------------------------------------------------------------

export interface InterviewIntelligenceInput {
  /** Live interview memory (richest source). Preferred when present. */
  memory?: InterviewMemory;
  /** Persisted package fallback (questions only — no scores). */
  package?: InterviewPackage;
  /** Stored FlightRecords (reflection/qa/validation/decision + timeline). */
  records?: FlightRecord[];
  /** Resume data (for resume summary). */
  resume?: ResumeData;
  /** Job description (role/company/position). */
  jd?: JobDescription;
  /** Company profile (for company match). */
  companyProfile?: CompanyProfile | null;
  /** ATS report (for ATS summary). */
  atsReport?: ATSReport | null;
  /** Resume review report (for resume summary). */
  reviewReport?: ResumeReviewReport | null;
  /** Scenario label (if known). */
  scenario?: string;
  /** Persona label(s) (if known). */
  persona?: string;
  /** Position / role title (if known). */
  position?: string;
}

// ----------------------------------------------------------------------------
// Competency analytics
// ----------------------------------------------------------------------------

export type CompetencyTrend = "up" | "down" | "flat" | "unknown";

export interface RecruiterCompetency {
  key: CompetencyKey;
  label: string;
  /** 0-100 aggregate score. */
  score: number;
  /** 0-100 model confidence in the score. */
  confidence: number;
  trend: CompetencyTrend;
  evidence: string[];
  supportingAnswers: string[];
  weakEvidence: string[];
  strongEvidence: string[];
  improvementSuggestions: string[];
  /** true when this competency is a repeated weakness (avg < 50, seen >= 2). */
  riskIndicator: boolean;
  /** Benchmark label/score for this competency (if available). */
  benchmark?: number;
  /** Recruiter-editable notes (empty by default). */
  recruiterNotes?: string;
  /** Historical progress (score per prior evaluation, oldest → newest). */
  historicalProgress: number[];
}

export interface CompetencyAnalytics {
  competencies: Record<CompetencyKey, RecruiterCompetency>;
  /** Ordered for heatmap/radar (by COMPETENCIES order). */
  order: CompetencyKey[];
  /** Score distribution buckets (0-20, 21-40, 41-60, 61-80, 81-100). */
  scoreDistribution: number[];
  /** Radar chart data: [{ label, score, benchmark? }]. */
  radar: { label: string; score: number; benchmark?: number }[];
  /** Heatmap data: [{ key, label, score, risk }]. */
  heatmap: { key: CompetencyKey; label: string; score: number; risk: boolean }[];
  strongest: CompetencyKey[];
  weakest: CompetencyKey[];
  missing: CompetencyKey[];
}

// ----------------------------------------------------------------------------
// Behavioral intelligence (16 dimensions, derived — no AI)
// ----------------------------------------------------------------------------

export type BehaviorKey =
  | "leadership"
  | "communication"
  | "customerService"
  | "safety"
  | "professionalism"
  | "stressManagement"
  | "adaptability"
  | "decisionMaking"
  | "conflictResolution"
  | "ownership"
  | "criticalThinking"
  | "starUsage"
  | "resilience"
  | "emotionalIntelligence"
  | "listening"
  | "teamwork";

export interface BehaviorDimension {
  key: BehaviorKey;
  label: string;
  score: number;
  evidence: string[];
  /** Which source competency(ies) this dimension is derived from. */
  derivedFrom: CompetencyKey[];
}

export interface BehavioralIntelligence {
  behaviors: Record<BehaviorKey, BehaviorDimension>;
  overall: number;
}

// ----------------------------------------------------------------------------
// Company matching (heuristic compare — no AI)
// ----------------------------------------------------------------------------

export interface CompanyMatchIntel {
  company: string;
  cultureMatch: number;
  valuesMatch: number;
  safetyMatch: number;
  leadershipMatch: number;
  luxuryServiceMatch: number;
  customerExperienceMatch: number;
  brandRepresentation: number;
  professionalStandards: number;
  overallCompanyReadiness: number;
  evidence: string[];
  reasoning: string;
}

// ----------------------------------------------------------------------------
// Summary blocks (surfaced from existing outputs — never regenerated)
// ----------------------------------------------------------------------------

export interface ResumeSummary {
  present: boolean;
  overallScore?: number;
  recruiterScore?: number;
  jobMatchPercent?: number;
  industryReadiness?: number;
  topStrengths: string[];
  topWeaknesses: string[];
  missingSkills: string[];
}

export interface ATSSummary {
  present: boolean;
  atsScore?: number;
  jdMatchPercent?: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  weakSections: string[];
}

export interface DecisionSummary {
  present: boolean;
  status?: FlightDecision["status"];
  reason?: string;
  confidence?: number;
  evidence?: string;
}

export interface ReflectionSummary {
  present: boolean;
  outcome?: string;
  score?: number;
  confidence?: number;
  summary?: string;
  retryRecommended?: boolean;
}

export interface QASummary {
  present: boolean;
  outcome?: string;
  score?: number;
  confidence?: number;
  failRecommended?: boolean;
}

export interface ValidationSummary {
  present: boolean;
  outcome?: string;
  score?: number;
  failRecommended?: boolean;
  criticalFailures?: number;
}

export interface FlightMetadataSummary {
  present: boolean;
  executionId?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  latencyMs?: number;
  tokenUsage?: number;
  questionCount?: number;
  completionRate?: number;
}

export interface InterviewSummary {
  present: boolean;
  overallScore?: number;
  questionCount?: number;
  difficultyProgression?: number[];
  strengths: CompetencyKey[];
  weaknesses: CompetencyKey[];
  missingCompetencies: CompetencyKey[];
  recommendedNextSteps: string[];
}

export interface CandidateProfile {
  resumeId?: string;
  jdId?: string;
  name?: string;
  company?: string;
  role?: string;
  targetCompany?: string;
}

// ----------------------------------------------------------------------------
// Candidate Intelligence — the single read-model
// ----------------------------------------------------------------------------

export interface CandidateIntelligence {
  candidate: CandidateProfile;
  interview: InterviewSummary;
  competencySummary: Record<CompetencyKey, RecruiterCompetency>;
  behavior: BehavioralIntelligence;
  resume: ResumeSummary;
  ats: ATSSummary;
  companyMatch: CompanyMatchIntel | null;
  scenario?: string;
  persona?: string;
  position?: string;
  decision: DecisionSummary;
  reflection: ReflectionSummary;
  qa: QASummary;
  validation: ValidationSummary;
  flight: FlightMetadataSummary;
  /** 0-100 blended overall readiness (interview + resume + ats + company). */
  overall: number;
  /** 0-100 likelihood the candidate would pass the real employer interview. */
  employerPassLikelihood: number;
  /** Suggested follow-up questions (from adaptive followUps + weaknesses). */
  followUpQuestions: string[];
  generatedAt: string;
}

// ----------------------------------------------------------------------------
// Recruiter Dashboard
// ----------------------------------------------------------------------------

export type HiringRecommendation = "strong_hire" | "hire" | "lean_hire" | "hold" | "reject";

export interface RecruiterDashboard {
  candidate: CandidateProfile;
  candidateOverview: string;
  hiringRecommendation: HiringRecommendation;
  hiringConfidence: number;
  interviewScore: number;
  resumeScore: number;
  atsMatch: number;
  companyMatch: number;
  overallRisk: number;
  potential: number;
  recruiterConfidence: number;
  completionRate: number;
  durationMs: number;
  targetCompany?: string;
  scenario?: string;
  persona?: string;
  position?: string;
}

// ----------------------------------------------------------------------------
// Decision analytics (consumes decision block — never regenerates)
// ----------------------------------------------------------------------------

export interface DecisionAnalytics {
  present: boolean;
  status?: string;
  confidence?: number;
  reason?: string;
  evidence?: string;
  trace: { ruleId: string; triggered: boolean; status: string }[];
  rules: Array<{
    ruleId: string;
    profile: string;
    status: string;
    confidence: number;
    reason: string;
    evidence: string;
    triggered: boolean;
  }>;
  supportingReflection?: string;
  supportingQA?: string;
  supportingValidation?: string;
  supportingCompetencies: CompetencyKey[];
  supportingATS?: string;
  supportingResume?: string;
  supportingCompanyIntelligence?: string;
}

// ----------------------------------------------------------------------------
// Timeline
// ----------------------------------------------------------------------------

export type TimelineEventKind =
  | "interview_start"
  | "question"
  | "difficulty_change"
  | "adaptive_branch"
  | "reflection"
  | "qa"
  | "validation"
  | "decision"
  | "flight"
  | "final_recommendation";

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  at: number;
  label: string;
  detail?: string;
  source: "interview" | "flight_recorder" | "decision";
  /** Optional explainability refs for inspection. */
  refs?: { competency?: CompetencyKey; recordExecutionId?: string };
}

export interface TimelineAnalytics {
  events: TimelineEvent[];
  startAt?: number;
  endAt?: number;
  /** Return a filtered view (immutable). */
  filterBy(kind: TimelineEventKind): TimelineAnalytics;
  /** Return a zoomed view within [from, to] ms (immutable). */
  zoom(from: number, to: number): TimelineAnalytics;
  /** Inspect a single event by id (full detail). */
  inspect(eventId: string): TimelineEvent | undefined;
}

// ----------------------------------------------------------------------------
// Benchmark
// ----------------------------------------------------------------------------

export type BenchmarkGroupBy = "company" | "scenario" | "role" | "department" | "experience";

export interface BenchmarkEntry {
  candidateId: string;
  label: string;
  interviewScore: number;
  resumeScore: number;
  atsMatch: number;
  companyMatch: number;
  leadership: number;
  communication: number;
  safety: number;
  professionalism: number;
  customerService: number;
  adaptability: number;
  group: string;
}

export interface BenchmarkResult {
  groupBy: BenchmarkGroupBy;
  entries: BenchmarkEntry[];
  ranking: BenchmarkEntry[];
  /** Percentile (0-100) per candidate within the cohort, by interviewScore. */
  percentiles: Record<string, number>;
  cohortAverage: { interviewScore: number; resumeScore: number; atsMatch: number; companyMatch: number };
  trend: { candidateId: string; delta: number }[];
}

// ----------------------------------------------------------------------------
// Explainability
// ----------------------------------------------------------------------------

export interface ExplainabilityNode {
  id: string;
  label: string;
  kind: "recommendation" | "competency" | "answer" | "resume" | "ats" | "company" | "decision" | "flight" | "evidence";
  detail: string;
  children: ExplainabilityNode[];
  /** Whether this node can be expanded (has children). */
  expandable: boolean;
}

// ----------------------------------------------------------------------------
// Executive report
// ----------------------------------------------------------------------------

export interface ExecutiveReport {
  generatedAt: string;
  candidate: CandidateProfile;
  executiveSummary: string;
  candidateSummary: string;
  interviewOverview: string;
  resumeSummary: string;
  atsSummary: string;
  competencies: { label: string; score: number; confidence: number; risk: boolean; improvement: string }[];
  behaviorAnalysis: { label: string; score: number }[];
  leadership: string;
  communication: string;
  safety: string;
  strengths: string[];
  weaknesses: string[];
  riskAssessment: string;
  hiringRecommendation: HiringRecommendation;
  followUpQuestions: string[];
  trainingPlan: string[];
  developmentAreas: string[];
}
