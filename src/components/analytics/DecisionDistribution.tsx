"use client";

// Phase 8.1.5 (P5) — Decision distribution + confidence. Pure viz from
// computeDecisionMetrics output.

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import type { DecisionMetrics } from "@/lib/ai/decision-metrics";

const STATUS_COLOR: Record<string, string> = {
  accept: "#10B981",
  retry: "#F59E0B",
  reject: "#DC2626",
  escalate: "#EF4444",
  human_review: "#8B5CF6",
  continue: "#6B7280",
  stop: "#374151",
};

export function DecisionDistribution({ metrics }: { metrics: DecisionMetrics }) {
  const data = Object.entries(metrics.decisionDistribution)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v }));

  if (data.length === 0) return <p className="text-sm text-muted-foreground">No decisions recorded.</p>;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={90} label>
          {data.map((d) => <Cell key={d.name} fill={STATUS_COLOR[d.name] ?? "#6B7280"} />)}
        </Pie>
        <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
