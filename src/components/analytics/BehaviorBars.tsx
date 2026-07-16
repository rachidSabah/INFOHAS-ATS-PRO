"use client";

// Phase 8.1.5 (P5) — Behavioral Intelligence bars (16 dimensions). Pure viz.

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { BehavioralIntelligence } from "@/lib/recruiter/recruiter-types";

const COLOR = (s: number) => (s >= 75 ? "#10B981" : s >= 55 ? "#F59E0B" : "#DC2626");

export function BehaviorBars({ behavior, height = 360 }: { behavior: BehavioralIntelligence; height?: number }) {
  const data = Object.values(behavior.behaviors)
    .map((b) => ({ label: b.label, score: b.score }))
    .sort((a, b) => b.score - a.score);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
          cursor={{ fill: "hsl(var(--accent))" }}
        />
        <Bar dataKey="score" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.label} fill={COLOR(d.score)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
