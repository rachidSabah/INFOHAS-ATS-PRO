"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import type { ResumeData, JobDescription } from "@/lib/types";
import { useATSMatchScore } from "./useATSMatchScore";

// ─── Props ───────────────────────────────────────────────────────────────────

interface ATSMatchMeterProps {
  resume: ResumeData;
  jd?: JobDescription | null;
  /** Optional className for layout */
  className?: string;
}

// ─── Theme helpers ───────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, "success" | "warning" | "danger"> = {
  Excellent: "success",
  Good: "success",
  "Needs Work": "warning",
  Critical: "danger",
};

function tierColor(label: string) {
  return TIER_COLORS[label] ?? "warning";
}

function scoreColor(score: number): string {
  if (score >= 85) return "text-emerald-600";
  if (score >= 70) return "text-green-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ATSMatchMeter({ resume, jd, className }: ATSMatchMeterProps) {
  const { score, label, breakdown, stale, hasJD } = useATSMatchScore(resume, jd);
  const [expanded, setExpanded] = useState(false);

  // Top missing keywords (up to 8)
  const missingTop = useMemo(
    () => (breakdown?.missingKeywords ?? []).slice(0, 8),
    [breakdown],
  );

  const matchedTop = useMemo(
    () => (breakdown?.matchedKeywords ?? []).slice(0, 6),
    [breakdown],
  );

  // Section scores
  const sections = useMemo(() => {
    if (!breakdown?.sectionBreakdown) return [];
    return Object.entries(breakdown.sectionBreakdown).map(([name, s]) => ({
      name,
      score: s.score,
      status: s.status,
      suggestion: s.suggestion,
    }));
  }, [breakdown]);

  if (!hasJD) {
    return (
      <div className={className}>
        <Card className="border-dashed border-border/60">
          <CardContent className="p-4 text-center">
            <Icon name="Search" className="w-5 h-5 text-muted-foreground/40 mx-auto" />
            <p className="text-xs text-muted-foreground mt-1.5">
              Add a job description to see your ATS match score in real time.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={className}>
      <Card className={stale ? "opacity-60 transition-opacity" : ""}>
        <CardHeader className="p-3 pb-0 flex-row items-center justify-between gap-2">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Icon name="Target" className="w-3.5 h-3.5 text-brand" />
            ATS Match
            {stale && (
              <span className="text-[10px] font-normal text-muted-foreground animate-pulse">
                computing…
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {score !== null && (
              <Badge variant={tierColor(label)} className="text-[10px]">
                {label}
              </Badge>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground transition"
            >
              <Icon
                name={expanded ? "ChevronUp" : "ChevronDown"}
                className="w-3.5 h-3.5"
              />
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-3">
          {/* Score ring + summary */}
          <div className="flex items-center gap-3">
            <ScoreRing
              value={score ?? 0}
              size={44}
              stroke={4}
            />
            <div className="min-w-0 flex-1">
              <div className={cn("text-lg font-bold leading-tight", scoreColor(score ?? 0))}>
                {score ?? "—"}
                <span className="text-xs font-normal text-muted-foreground ml-0.5">/100</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                {breakdown
                  ? `${breakdown.matchedKeywords.length}/${breakdown.matchedKeywords.length + breakdown.missingKeywords.length} keywords matched`
                  : "Analyzing…"}
              </div>
            </div>
          </div>

          {/* Missing keywords (always visible, compact) */}
          {missingTop.length > 0 && (
            <div className="mt-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Missing keywords
              </div>
              <div className="flex flex-wrap gap-1">
                {missingTop.map((kw) => (
                  <span
                    key={kw}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200"
                  >
                    {kw}
                  </span>
                ))}
                {breakdown && breakdown.missingKeywords.length > 8 && (
                  <span className="text-[10px] text-muted-foreground px-1">
                    +{breakdown.missingKeywords.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Expanded detail */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {/* Matched keywords */}
                {matchedTop.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Matched keywords
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {matchedTop.map((kw) => (
                        <span
                          key={kw}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section breakdown */}
                {sections.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      Section completeness
                    </div>
                    <div className="space-y-1.5">
                      {sections.map((s) => (
                        <div key={s.name} className="flex items-center gap-2">
                          <div className="flex-1 text-[11px] capitalize truncate">{s.name}</div>
                          <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden shrink-0">
                            <div
                              className={`h-full rounded-full transition-all ${
                                s.score >= 80
                                  ? "bg-emerald-500"
                                  : s.score >= 50
                                    ? "bg-amber-400"
                                    : "bg-red-400"
                              }`}
                              style={{ width: `${s.score}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              "text-[10px] font-semibold w-6 text-right",
                              s.score >= 80
                                ? "text-emerald-600"
                                : s.score >= 50
                                  ? "text-amber-600"
                                  : "text-red-600",
                            )}
                          >
                            {s.score}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggestions */}
                {sections.filter((s) => s.suggestion).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Quick tips
                    </div>
                    <ul className="space-y-1">
                      {sections
                        .filter((s) => s.suggestion)
                        .slice(0, 4)
                        .map((s) => (
                          <li key={s.name} className="text-[10px] text-muted-foreground flex gap-1.5">
                            <Icon name="Lightbulb" className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                            <span>{s.suggestion}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Inline cn helper (avoids import from utils) ─────────────────────────────

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
