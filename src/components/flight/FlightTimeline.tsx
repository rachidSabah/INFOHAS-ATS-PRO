"use client";

// Phase 8.1.5 (P4) — Flight execution timeline (read-only replay). Renders
// FlightRecord.timeline spans. No logic — pure visualization.

import type { FlightSpan } from "@/lib/ai/flight-recorder";

const SPAN_COLOR: Record<string, string> = {
  context: "#64748B",
  prompt: "#8B5CF6",
  provider: "#0EA5E9",
  model: "#1154A3",
  streaming: "#06B6D4",
  retry: "#F59E0B",
  reflection: "#A855F7",
  qa: "#EC4899",
  validation: "#10B981",
  decision: "#DC2626",
  response: "#22C55E",
  persist: "#6B7280",
};

export function FlightTimeline({ spans = [] }: { spans?: FlightSpan[] }) {
  if (!spans || spans.length === 0) return <p className="text-sm text-muted-foreground">No timeline recorded.</p>;
  const t0 = spans[0]?.at ?? 0;
  return (
    <ol className="space-y-1.5">
      {spans.map((s, i) => (
        <li key={`${s.name || "span"}-${i}`} className="flex items-center gap-3 text-sm">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: (s.name && SPAN_COLOR[s.name]) ? SPAN_COLOR[s.name] : "#6B7280" }} />
          <span className="w-24 font-medium capitalize">{s.name || "span"}</span>
          <span className="text-xs text-muted-foreground w-20">+{Math.max(0, (s.at || 0) - t0)}ms</span>
          {s.ms != null && <span className="text-xs text-muted-foreground">{s.ms}ms</span>}
          {s.detail && <span className="text-xs text-muted-foreground truncate">· {s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
