"use client";

// Phase 8.1.5 (P6) — Explainability tree. Renders buildExplainability(ci)
// as a recursive expand/collapse tree (Accordion/Collapsible pattern, hand-
// rolled to avoid an extra dependency). Read-only.

import { useState } from "react";
import { Icon } from "@/components/shared";
import type { CandidateIntelligence, ExplainabilityNode } from "@/lib/recruiter/recruiter-types";
import { buildExplainability } from "@/lib/recruiter/explainability";

const KIND_COLOR: Record<ExplainabilityNode["kind"], string> = {
  recommendation: "#10B981",
  competency: "#1154A3",
  answer: "#8B5CF6",
  resume: "#EC4899",
  ats: "#0EA5E9",
  company: "#F59E0B",
  decision: "#DC2626",
  flight: "#6B7280",
  evidence: "#64748B",
};

function Node({ node, depth }: { node: ExplainabilityNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.expandable && node.children.length > 0;
  return (
    <div className="border-l border-border pl-3 ml-1" style={{ marginLeft: depth ? 8 : 0 }}>
      <div className="flex items-start gap-2 py-1.5">
        {hasChildren ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 text-muted-foreground hover:text-foreground"
            aria-label={open ? "Collapse" : "Expand"}
          >
            <Icon name={open ? "ChevronDown" : "ChevronRight"} className="w-4 h-4" />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ background: KIND_COLOR[node.kind] }} />
        <div className="min-w-0">
          <div className="text-sm font-medium">{node.label}</div>
          {node.detail && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{node.detail}</div>}
        </div>
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplainabilityTree({ ci }: { ci: CandidateIntelligence }) {
  const root = buildExplainability(ci);
  return (
    <div className="space-y-1">
      {root.children.map((c) => (
        <Node key={c.id} node={c} depth={0} />
      ))}
    </div>
  );
}
