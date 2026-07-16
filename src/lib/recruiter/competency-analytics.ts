// ============================================================================
// Competency Analytics — Phase 8.1.4
//
// Transforms `CandidateIntelligence.competencySummary` into data structures for
// heatmap / radar / timeline / score-distribution visualizations. PURE — returns
// data arrays, never renders UI. Reuses the canonical COMPETENCIES order.
// ============================================================================

import { COMPETENCIES, COMPETENCY_LABELS, type CompetencyKey } from "@/lib/interview/adaptive";
import type { CandidateIntelligence, CompetencyAnalytics, RecruiterCompetency } from "./recruiter-types";

function bucket(score: number): number {
  if (score <= 20) return 0;
  if (score <= 40) return 1;
  if (score <= 60) return 2;
  if (score <= 80) return 3;
  return 4;
}

export function buildCompetencyAnalytics(ci: CandidateIntelligence): CompetencyAnalytics {
  const comp = ci.competencySummary;
  const order: CompetencyKey[] = [...COMPETENCIES];

  const distribution = [0, 0, 0, 0, 0];
  const radar: CompetencyAnalytics["radar"] = [];
  const heatmap: CompetencyAnalytics["heatmap"] = [];
  const strongest: CompetencyKey[] = [];
  const weakest: CompetencyKey[] = [];

  for (const c of order) {
    const rc: RecruiterCompetency = comp[c];
    if (!rc) continue;
    distribution[bucket(rc.score)]++;
    radar.push({ label: COMPETENCY_LABELS[c], score: rc.score, benchmark: rc.benchmark });
    heatmap.push({ key: c, label: rc.label, score: rc.score, risk: rc.riskIndicator });
  }

  const sorted = order
    .map((c) => comp[c])
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score);
  strongest.push(...sorted.slice(0, 3).map((x) => x!.key));
  weakest.push(...sorted.slice(-3).map((x) => x!.key));

  return { competencies: comp, order, scoreDistribution: distribution, radar, heatmap, strongest, weakest, missing: ci.interview.missingCompetencies };
}

/** Percentile (0-100) of a score within a cohort pool. */
export function benchmarkCompetency(score: number, pool: number[]): number {
  if (pool.length === 0) return 50;
  const below = pool.filter((n) => n < score).length;
  return Math.round((below / pool.length) * 100);
}
