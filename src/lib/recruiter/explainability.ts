// ============================================================================
// Explainability — Phase 8.1.4
//
// Builds an evidence tree for every recommendation. Each node exposes its
// evidence + child nodes (supporting competencies / answers / resume / ats /
// company / decision / flight). Pure read-model composition — no AI. The UI
// follow-up binds expand/collapse/inspect/trace to this structure.
// ============================================================================

import { type CompetencyKey } from "@/lib/interview/adaptive";
import type { CandidateIntelligence, ExplainabilityNode } from "./recruiter-types";

export function buildExplainability(ci: CandidateIntelligence): ExplainabilityNode {
  const root: ExplainabilityNode = {
    id: "root",
    label: `Hiring recommendation: ${ci.decision.status ?? "n/a"}`,
    kind: "recommendation",
    detail: ci.decision.reason ?? `Overall readiness ${ci.overall}/100.`,
    children: [],
    expandable: true,
  };

  // Competency evidence.
  const compChildren: ExplainabilityNode[] = (Object.keys(ci.competencySummary) as CompetencyKey[]).map((c) => {
    const rc = ci.competencySummary[c];
    return {
      id: `comp-${c}`,
      label: rc.label,
      kind: "competency" as const,
      detail: `Score ${rc.score}/100 · confidence ${rc.confidence}/100${rc.riskIndicator ? " · RISK" : ""}`,
      children: rc.evidence.slice(0, 3).map((e, i) => ({
        id: `comp-${c}-ev-${i}`,
        label: "Evidence",
        kind: "evidence" as const,
        detail: e,
        children: [],
        expandable: false,
      })),
      expandable: rc.evidence.length > 0,
    };
  });
  root.children.push({ id: "competencies", label: "Competencies", kind: "competency", detail: `${compChildren.length} assessed`, children: compChildren, expandable: true });

  // Answers.
  const answerNodes: ExplainabilityNode[] = Object.values(ci.competencySummary)
    .flatMap((rc) => rc.supportingAnswers)
    .slice(0, 5)
    .map((a, i) => ({
      id: `answer-${i}`,
      label: `Answer ${i + 1}`,
      kind: "answer" as const,
      detail: a.slice(0, 200),
      children: [],
      expandable: false,
    }));
  if (answerNodes.length) root.children.push({ id: "answers", label: "Supporting Answers", kind: "answer", detail: `${answerNodes.length} answers`, children: answerNodes, expandable: true });

  // Resume.
  if (ci.resume.present) {
    root.children.push({
      id: "resume",
      label: "Resume",
      kind: "resume",
      detail: `Overall ${ci.resume.overallScore ?? "n/a"} · Job match ${ci.resume.jobMatchPercent ?? "n/a"}%`,
      children: ci.resume.topStrengths.slice(0, 3).map((s, i) => ({ id: `resume-s-${i}`, label: "Strength", kind: "evidence" as const, detail: s, children: [], expandable: false })),
      expandable: true,
    });
  }

  // ATS.
  if (ci.ats.present) {
    root.children.push({
      id: "ats",
      label: "ATS",
      kind: "ats",
      detail: `ATS ${ci.ats.atsScore ?? "n/a"} · JD match ${ci.ats.jdMatchPercent ?? "n/a"}%`,
      children: ci.ats.missingKeywords.slice(0, 3).map((k, i) => ({ id: `ats-m-${i}`, label: "Missing keyword", kind: "evidence" as const, detail: k, children: [], expandable: false })),
      expandable: true,
    });
  }

  // Company.
  if (ci.companyMatch) {
    root.children.push({
      id: "company",
      label: "Company Intelligence",
      kind: "company",
      detail: `${ci.companyMatch.company} · readiness ${ci.companyMatch.overallCompanyReadiness}/100`,
      children: ci.companyMatch.evidence.map((e, i) => ({ id: `company-e-${i}`, label: "Evidence", kind: "evidence" as const, detail: e, children: [], expandable: false })),
      expandable: true,
    });
  }

  // Decision.
  if (ci.decision.present) {
    root.children.push({
      id: "decision",
      label: "Decision Engine",
      kind: "decision",
      detail: `${ci.decision.status} · confidence ${ci.decision.confidence ?? "n/a"}`,
      children: (ci.decision.evidence ? [{ id: "decision-ev", label: "Evidence", kind: "evidence" as const, detail: ci.decision.evidence, children: [], expandable: false }] : []),
      expandable: true,
    });
  }

  // Flight recorder.
  if (ci.flight.present) {
    root.children.push({
      id: "flight",
      label: "Flight Recorder",
      kind: "flight",
      detail: `Provider ${ci.flight.provider ?? "n/a"} · model ${ci.flight.model ?? "n/a"} · ${ci.flight.durationMs ?? 0}ms`,
      children: [],
      expandable: false,
    });
  }

  return root;
}
