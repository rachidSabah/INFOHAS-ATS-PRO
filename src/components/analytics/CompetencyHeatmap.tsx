"use client";

// Phase 8.1.5 (P5) — Competency Heatmap. Pure viz of competencySummary.

import type { CandidateIntelligence } from "@/lib/recruiter/recruiter-types";

const COLOR = (s: number) =>
  s >= 75 ? "rgba(16,185,129,0.85)" : s >= 55 ? "rgba(245,158,11,0.8)" : "rgba(220,38,38,0.8)";

export function CompetencyHeatmap({ ci }: { ci: CandidateIntelligence }) {
  const entries = Object.values(ci.competencySummary);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {entries.map((c) => (
        <div
          key={c.key}
          className="rounded-lg p-3 text-white flex flex-col justify-between min-h-[72px]"
          style={{ background: COLOR(c.score) }}
          title={`${c.label}: ${c.score}/100`}
        >
          <div className="text-xs font-medium leading-tight">{c.label}</div>
          <div className="text-2xl font-bold">{c.score}</div>
        </div>
      ))}
    </div>
  );
}
