"use client";

// Phase 8.1.5 (P5) — Benchmark comparison chart. Pure viz from
// benchmarkCandidates output.

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { BenchmarkResult } from "@/lib/recruiter/recruiter-types";

const COLOR = (s: number) => (s >= 75 ? "#10B981" : s >= 55 ? "#F59E0B" : "#DC2626");

export function BenchmarkChart({ result, height = 300 }: { result: BenchmarkResult; height?: number }) {
  const data = result.entries.map((e) => ({
    name: e.label,
    interview: e.interviewScore,
    resume: e.resumeScore,
    ats: e.atsMatch,
    company: e.companyMatch,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} cursor={{ fill: "hsl(var(--accent))" }} />
        <Bar dataKey="interview" name="Interview" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={COLOR(d.interview)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
