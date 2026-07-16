// ============================================================================
// Executive Recruiter Report — Phase 8.1.4
//
// Generates a STRUCTURED ExecutiveReport from CandidateIntelligence and renders
// it to Markdown. PDF/Word rendering is delegated to the existing exporter in the
// UI follow-up; this module emits the structured object + Markdown (the
// engine-side deliverable). Pure — no AI.
// ============================================================================

import { COMPETENCY_LABELS, type CompetencyKey } from "@/lib/interview/adaptive";
import type { CandidateIntelligence, ExecutiveReport, HiringRecommendation } from "./recruiter-types";

export function generateExecutiveReport(ci: CandidateIntelligence): ExecutiveReport {
  const compEntries = (Object.keys(ci.competencySummary) as CompetencyKey[])
    .map((c) => ci.competencySummary[c])
    .sort((a, b) => b.score - a.score);

  const competencies = compEntries.map((rc) => ({
    label: rc.label,
    score: rc.score,
    confidence: rc.confidence,
    risk: rc.riskIndicator,
    improvement: rc.improvementSuggestions[0] ?? "No specific improvement noted.",
  }));

  const behavior = Object.values(ci.behavior.behaviors).map((b) => ({ label: b.label, score: b.score }));

  const strengths = ci.interview.strengths.map((c) => COMPETENCY_LABELS[c]);
  const weaknesses = ci.interview.weaknesses.map((c) => COMPETENCY_LABELS[c]);

  const riskLevel = ci.overall >= 70 ? "Low" : ci.overall >= 50 ? "Moderate" : "Elevated";
  const riskAssessment = `Overall readiness ${ci.overall}/100 → ${riskLevel} risk. Decision: ${ci.decision.status ?? "n/a"}. ${
    ci.decision.reason ?? ""
  }`;

  const trainingPlan = ci.interview.recommendedNextSteps.length
    ? ci.interview.recommendedNextSteps
    : weaknesses.map((w) => `Develop ${w} through targeted coaching and practice scenarios.`);

  return {
    generatedAt: ci.generatedAt,
    candidate: ci.candidate,
    executiveSummary: `Candidate ${ci.candidate.name ?? "(unnamed)"} scored ${ci.overall}/100 overall readiness for ${
      ci.candidate.role ?? "the role"
    } at ${ci.candidate.company ?? "the company"}. Recommendation: ${ci.decision.status ?? "n/a"} (confidence ${
      ci.decision.confidence != null ? Math.round(ci.decision.confidence * 100) : "n/a"
    }%).`,
    candidateSummary: `${ci.candidate.name ?? "Candidate"} — ${ci.candidate.role ?? "role n/a"}. Interview ${ci.interview.overallScore ?? "n/a"}/100 across ${
      ci.interview.questionCount ?? 0
    } questions. Employer pass likelihood ${ci.employerPassLikelihood}/100.`,
    interviewOverview: `Overall interview score ${ci.interview.overallScore ?? "n/a"}/100. Strengths: ${strengths.join(", ") || "n/a"}. Weaknesses: ${
      weaknesses.join(", ") || "n/a"
    }.`,
    resumeSummary: ci.resume.present
      ? `Resume overall ${ci.resume.overallScore ?? "n/a"}; job match ${ci.resume.jobMatchPercent ?? "n/a"}%; industry readiness ${ci.resume.industryReadiness ?? "n/a"}.`
      : "No resume report available.",
    atsSummary: ci.ats.present
      ? `ATS ${ci.ats.atsScore ?? "n/a"}; JD match ${ci.ats.jdMatchPercent ?? "n/a"}%. Missing keywords: ${ci.ats.missingKeywords.slice(0, 5).join(", ") || "none"}.`
      : "No ATS report available.",
    competencies,
    behaviorAnalysis: behavior,
    leadership: `Leadership ${ci.competencySummary.leadership?.score ?? 0}/100.`,
    communication: `Communication ${ci.competencySummary.communication?.score ?? 0}/100.`,
    safety: `Safety awareness ${ci.competencySummary.safetyAwareness?.score ?? 0}/100.`,
    strengths,
    weaknesses,
    riskAssessment,
    hiringRecommendation: (ci.decision.status === "reject" || ci.decision.status === "escalate"
      ? "reject"
      : ci.overall >= 80
        ? "strong_hire"
        : ci.overall >= 68
          ? "hire"
          : ci.overall >= 55
            ? "lean_hire"
            : ci.overall >= 40
              ? "hold"
              : "reject") as HiringRecommendation,
    followUpQuestions: ci.followUpQuestions,
    trainingPlan,
    developmentAreas: weaknesses,
  };
}

export function renderReportMarkdown(report: ExecutiveReport): string {
  const lines: string[] = [];
  lines.push(`# Executive Recruiter Report`);
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push("");
  lines.push(`## Executive Summary`);
  lines.push(report.executiveSummary);
  lines.push("");
  lines.push(`## Candidate Summary`);
  lines.push(report.candidateSummary);
  lines.push("");
  lines.push(`## Interview Overview`);
  lines.push(report.interviewOverview);
  lines.push("");
  lines.push(`## Resume Summary`);
  lines.push(report.resumeSummary);
  lines.push("");
  lines.push(`## ATS Summary`);
  lines.push(report.atsSummary);
  lines.push("");
  lines.push(`## Competencies`);
  for (const c of report.competencies) {
    lines.push(`- **${c.label}**: ${c.score}/100 (confidence ${c.confidence})${c.risk ? " · RISK" : ""} — ${c.improvement}`);
  }
  lines.push("");
  lines.push(`## Behavior Analysis`);
  for (const b of report.behaviorAnalysis) {
    lines.push(`- **${b.label}**: ${b.score}/100`);
  }
  lines.push("");
  lines.push(`## Leadership / Communication / Safety`);
  lines.push(report.leadership);
  lines.push(report.communication);
  lines.push(report.safety);
  lines.push("");
  lines.push(`## Strengths`);
  lines.push(report.strengths.length ? report.strengths.map((s) => `- ${s}`).join("\n") : "- None identified");
  lines.push("");
  lines.push(`## Weaknesses`);
  lines.push(report.weaknesses.length ? report.weaknesses.map((w) => `- ${w}`).join("\n") : "- None identified");
  lines.push("");
  lines.push(`## Risk Assessment`);
  lines.push(report.riskAssessment);
  lines.push("");
  lines.push(`## Hiring Recommendation: ${report.hiringRecommendation.toUpperCase()}`);
  lines.push("");
  lines.push(`## Follow-up Questions`);
  lines.push(report.followUpQuestions.length ? report.followUpQuestions.map((q) => `- ${q}`).join("\n") : "- None");
  lines.push("");
  lines.push(`## Training Plan`);
  lines.push(report.trainingPlan.map((t) => `- ${t}`).join("\n"));
  lines.push("");
  lines.push(`## Development Areas`);
  lines.push(report.developmentAreas.map((d) => `- ${d}`).join("\n"));
  return lines.join("\n");
}
