// ============================================================================
// Candidate Benchmarking — Phase 8.1.4
//
// Compares candidates using their EXISTING CandidateIntelligence analytics. Pure
// cohort comparison — no AI, no score regeneration. Groupable by company /
// scenario / role / department / experience.
// ============================================================================

import type {
  CandidateIntelligence,
  BenchmarkResult,
  BenchmarkEntry,
  BenchmarkGroupBy,
  CompetencyKey,
} from "./recruiter-types";
import { percentileRank } from "./candidate-intelligence";

function groupValue(ci: CandidateIntelligence, groupBy: BenchmarkGroupBy): string {
  switch (groupBy) {
    case "company":
      return ci.candidate.company ?? ci.candidate.targetCompany ?? "unknown";
    case "scenario":
      return ci.scenario ?? "unknown";
    case "role":
      return ci.candidate.role ?? "unknown";
    case "department":
      // Department approximated from role/company when not explicit.
      return ci.candidate.role ?? "unknown";
    case "experience":
      // Experience approximated from resume (not always present) → "unknown".
      return "unknown";
  }
}

function entryFrom(ci: CandidateIntelligence, groupBy: BenchmarkGroupBy): BenchmarkEntry {
  const c = ci.competencySummary;
  const get = (k: CompetencyKey) => c[k]?.score ?? 0;
  return {
    candidateId: ci.candidate.resumeId ?? ci.candidate.name ?? ci.generatedAt,
    label: ci.candidate.name ?? ci.candidate.resumeId ?? "candidate",
    interviewScore: ci.interview.overallScore ?? 0,
    resumeScore: ci.resume.recruiterScore != null ? Math.round(ci.resume.recruiterScore * 10) : ci.resume.overallScore ?? 0,
    atsMatch: ci.ats.atsScore ?? ci.ats.jdMatchPercent ?? 0,
    companyMatch: ci.companyMatch?.overallCompanyReadiness ?? 0,
    leadership: get("leadership"),
    communication: get("communication"),
    safety: get("safetyAwareness"),
    professionalism: get("professionalism"),
    customerService: get("customerService"),
    adaptability: get("adaptability"),
    group: groupValue(ci, groupBy),
  };
}

export function benchmarkCandidates(candidates: CandidateIntelligence[], groupBy: BenchmarkGroupBy = "company"): BenchmarkResult {
  const entries = candidates.map((c) => entryFrom(c, groupBy));
  const ranking = [...entries].sort((a, b) => b.interviewScore - a.interviewScore);

  const pool = entries.map((e) => e.interviewScore);
  const percentiles: Record<string, number> = {};
  for (const e of entries) percentiles[e.candidateId] = percentileRank(e.interviewScore, pool);

  const n = entries.length || 1;
  const cohortAverage = {
    interviewScore: Math.round(entries.reduce((s, e) => s + e.interviewScore, 0) / n),
    resumeScore: Math.round(entries.reduce((s, e) => s + e.resumeScore, 0) / n),
    atsMatch: Math.round(entries.reduce((s, e) => s + e.atsMatch, 0) / n),
    companyMatch: Math.round(entries.reduce((s, e) => s + e.companyMatch, 0) / n),
  };

  // Trend: placeholder delta vs cohort average (real trend needs historical
  // snapshots; here we expose the per-candidate deviation as a proxy).
  const trend = entries.map((e) => ({ candidateId: e.candidateId, delta: e.interviewScore - cohortAverage.interviewScore }));

  return { groupBy, entries, ranking, percentiles, cohortAverage, trend };
}
