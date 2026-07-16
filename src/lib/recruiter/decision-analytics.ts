// ============================================================================
// Decision Analytics — Phase 8.1.4
//
// Consumes the Decision Engine output (FlightRecord.decision block) and surfaces
// it for recruiter inspection. NEVER regenerates a decision — it only reads the
// existing structured verdict + its trace/rules + supporting upstream references.
// ============================================================================

import type { FlightRecord, FlightDecision } from "@/lib/ai/flight-recorder";
import type { CandidateIntelligence, CompetencyKey, DecisionAnalytics } from "./recruiter-types";

export function buildDecisionAnalytics(input: { record?: FlightRecord; decision?: FlightDecision; ci?: CandidateIntelligence }): DecisionAnalytics {
  const d = input.decision ?? (input.record?.decision as FlightDecision | undefined);
  if (!d) {
    return {
      present: false,
      trace: [],
      rules: [],
      supportingCompetencies: [],
      supportingATS: undefined,
      supportingResume: undefined,
      supportingCompanyIntelligence: undefined,
    };
  }

  // Supporting competencies: those flagged as repeatedWeaknesses/strong from CI.
  const ci = input.ci;
  const supportingCompetencies: CompetencyKey[] = ci
    ? [...ci.interview.weaknesses, ...ci.interview.strengths]
    : [];

  return {
    present: true,
    status: d.status,
    confidence: d.confidence,
    reason: d.reason,
    evidence: d.evidence,
    trace: d.trace ?? [],
    rules: d.rules ?? [],
    supportingReflection: d.supportingReflection,
    supportingQA: d.supportingQA,
    supportingValidation: d.supportingValidation,
    supportingCompetencies,
    supportingATS: ci?.ats.present ? `ATS ${ci.ats.atsScore ?? ci.ats.jdMatchPercent ?? "n/a"}` : undefined,
    supportingResume: ci?.resume.present ? `Resume ${ci.resume.overallScore ?? "n/a"}` : undefined,
    supportingCompanyIntelligence: ci?.companyMatch ? `Company ${ci.companyMatch.overallCompanyReadiness}/100` : undefined,
  };
}
