"use client";

// Phase 8.1.5 (P5) — Competency Radar. Pure visualization of the existing
// CandidateIntelligence.competencySummary. No computation.

import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from "recharts";
import type { CandidateIntelligence } from "@/lib/recruiter/recruiter-types";

export function CompetencyRadar({ ci, height = 320 }: { ci: CandidateIntelligence; height?: number }) {
  const data = Object.values(ci.competencySummary).map((c) => ({
    subject: c.label,
    score: c.score,
    fullMark: 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="78%">
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={90} />
        <Radar name="Score" dataKey="score" stroke="hsl(var(--brand))" fill="hsl(var(--brand))" fillOpacity={0.35} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
