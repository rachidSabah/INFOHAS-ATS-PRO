// ============================================================================
// Interview Timeline — Phase 8.1.4
//
// Builds an ordered, inspectable timeline of an interview execution by MERGING
// existing sources: the interview `answered` questions (with difficulty/branches)
// and the FlightRecord `timeline` (reflection/qa/validation/decision/flight
// spans). Pure read-only composition — no new execution, no AI.
//
// Supports filterBy / zoom / inspect (the UI follow-up binds to these).
// ============================================================================

import { DIFFICULTY_TO_LABEL, type InterviewMemory, type CompetencyKey } from "@/lib/interview/adaptive";
import type { FlightRecord } from "@/lib/ai/flight-recorder";
import type { InterviewIntelligenceInput, TimelineAnalytics, TimelineEvent, TimelineEventKind } from "./recruiter-types";

function uid(prefix: string, i: number): string {
  return `${prefix}-${i}`;
}

export function buildTimeline(input: InterviewIntelligenceInput): TimelineAnalytics {
  const memory: InterviewMemory | undefined = input.memory;
  const records = input.records ?? [];
  const events: TimelineEvent[] = [];

  let idx = 0;

  // 1. Interview start.
  if (memory || input.package) {
    events.push({
      id: uid("start", idx++),
      kind: "interview_start",
      at: 0,
      label: "Interview started",
      detail: input.package?.role ?? memory?.jd?.title ?? "Interview session",
      source: "interview",
    });
  }

  // 2. Per-question events (with difficulty + adaptive branch).
  const answered = memory?.answered ?? [];
  for (const a of answered) {
    events.push({
      id: uid("q", idx++),
      kind: "question",
      at: idx * 1000,
      label: `Q: ${a.question.slice(0, 80)}`,
      detail: `Category ${a.category} · Difficulty ${DIFFICULTY_TO_LABEL[a.difficulty]} · Score ${a.overallScore} · ${a.personaName ?? "interviewer"}`,
      source: "interview",
      refs: { competency: Object.keys(a.competencies)[0] as CompetencyKey },
    });
    if (a.followUpsAsked?.length) {
      events.push({
        id: uid("branch", idx++),
        kind: "adaptive_branch",
        at: idx * 1000,
        label: "Adaptive follow-up branch",
        detail: a.followUpsAsked.join(" | "),
        source: "interview",
      });
    }
  }

  // 3. Flight recorder timeline spans (reflection/qa/validation/decision/flight).
  const SPAN_TO_KIND: Record<string, TimelineEventKind> = {
    reflection: "reflection",
    qa: "qa",
    validation: "validation",
    decision: "decision",
    response: "flight",
  };
  for (const rec of records) {
    for (const span of rec.timeline ?? []) {
      const kind = SPAN_TO_KIND[span.name];
      if (!kind) continue;
      events.push({
        id: uid("span", idx++),
        kind,
        at: span.at,
        label: `${kind[0].toUpperCase()}${kind.slice(1)} event`,
        detail: span.detail ?? rec.executionId,
        source: "flight_recorder",
        refs: { recordExecutionId: rec.executionId },
      });
    }
  }

  // 4. Final recommendation from decision.
  const decisionRec = records.find((r) => r.decision);
  if (decisionRec?.decision) {
    events.push({
      id: uid("final", idx++),
      kind: "final_recommendation",
      at: idx * 1000,
      label: `Final recommendation: ${decisionRec.decision.status}`,
      detail: decisionRec.decision.reason,
      source: "decision",
      refs: { recordExecutionId: decisionRec.executionId },
    });
  }

  events.sort((a, b) => a.at - b.at);

  const startAt = events[0]?.at;
  const endAt = events[events.length - 1]?.at;

  const analytics: TimelineAnalytics = {
    events,
    startAt,
    endAt,
    filterBy(kind: TimelineEventKind): TimelineAnalytics {
      return { ...analytics, events: events.filter((e) => e.kind === kind) };
    },
    zoom(from: number, to: number): TimelineAnalytics {
      return { ...analytics, events: events.filter((e) => e.at >= from && e.at <= to) };
    },
    inspect(eventId: string): TimelineEvent | undefined {
      return events.find((e) => e.id === eventId);
    },
  };
  return analytics;
}
