"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge, Icon } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import type { ResumeData, JobDescription } from "@/lib/types";
import { computeATSReadiness } from "@/components/optimizer/ATSScoreSimulator";

interface Props {
  resume: ResumeData;
  jd?: JobDescription | null;
  onAddKeyword?: (keyword: string, section: string) => void;
}

interface SectionFeedback {
  name: string;
  score: number;
  missingKeywords: string[];
  suggestions: string[];
}

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function ATSScoreInline({ resume, jd, onAddKeyword }: Props) {
  const [expanded, setExpanded] = useState(false);

  const score = useMemo(() => {
    if (!jd) return null;
    return computeATSReadiness(resume, jd);
  }, [resume, jd]);

  const sections: SectionFeedback[] = useMemo(() => {
    if (!score) return [];

    const summaryText = (resume.summary || "").toLowerCase();
    const skillsText = (resume.skills || []).map((s) => s.name).join(" ").toLowerCase();
    const expText = (resume.experience || []).flatMap((e) => e.bullets).join(" ").toLowerCase();

    const allKeywords = score.missingKeywords || [];

    return [
      {
        name: "Summary",
        score: score.sectionBreakdown?.summary?.score ?? 50,
        missingKeywords: allKeywords.filter((kw) => !summaryText.includes(kw.toLowerCase())).slice(0, 4),
        suggestions: score.sectionBreakdown?.summary?.suggestion ? [score.sectionBreakdown.summary.suggestion] : [],
      },
      {
        name: "Skills",
        score: score.sectionBreakdown?.skills?.score ?? 50,
        missingKeywords: allKeywords.filter((kw) => !skillsText.includes(kw.toLowerCase())).slice(0, 4),
        suggestions: score.sectionBreakdown?.skills?.suggestion ? [score.sectionBreakdown.skills.suggestion] : [],
      },
      {
        name: "Experience",
        score: score.sectionBreakdown?.experience?.score ?? 50,
        missingKeywords: allKeywords.filter((kw) => !expText.includes(kw.toLowerCase())).slice(0, 4),
        suggestions: score.sectionBreakdown?.experience?.suggestion ? [score.sectionBreakdown.experience.suggestion] : [],
      },
    ];
  }, [score, resume]);

  const hasJd = !!jd;
  const overall = score?.readinessScore ?? null;

  const scoreColor =
    overall !== null
      ? overall >= 80
        ? "text-emerald-600"
        : overall >= 50
          ? "text-amber-600"
          : "text-red-600"
      : "text-muted-foreground";

  if (!hasJd) return null;

  return (
    <Card className="border-muted mb-2">
      <CardHeader className="p-2.5 pb-1.5 flex flex-row items-center justify-between gap-2 cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-2">
          <Icon name="Target" className="w-3.5 h-3.5 text-brand" />
          <span className="text-xs font-semibold flex items-center gap-1.5">
            ATS Score
            {overall !== null && (
              <span className={cn("text-sm", scoreColor)}>{overall}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {overall !== null && overall >= 80 ? (
            <Badge variant="success" className="text-[9px] h-4">Excellent</Badge>
          ) : overall !== null && overall >= 50 ? (
            <Badge variant="warning" className="text-[9px] h-4">Needs Work</Badge>
          ) : overall !== null ? (
            <Badge variant="danger" className="text-[9px] h-4">Critical</Badge>
          ) : null}
          <button className="text-muted-foreground hover:text-foreground transition" aria-label={expanded ? "Collapse" : "Expand"}>
            <Icon name={expanded ? "ChevronUp" : "ChevronDown"} className="w-3 h-3" />
          </button>
        </div>
      </CardHeader>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <CardContent className="p-2.5 pt-0 space-y-2">
              {sections.map((section) => (
                <div key={section.name}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-medium flex-1">{section.name}</span>
                    <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          section.score >= 80
                            ? "bg-emerald-500"
                            : section.score >= 50
                              ? "bg-amber-400"
                              : "bg-red-400"
                        )}
                        style={{ width: `${Math.min(section.score, 100)}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-semibold w-5 text-right",
                        section.score >= 80
                          ? "text-emerald-600"
                          : section.score >= 50
                            ? "text-amber-600"
                            : "text-red-600"
                      )}
                    >
                      {section.score}
                    </span>
                  </div>

                  {/* Actionable keyword chips */}
                  {section.missingKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 ml-1">
                      {section.missingKeywords.map((kw) => (
                        <button
                          key={kw}
                          onClick={() => onAddKeyword?.(kw, section.name)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 
                            hover:bg-amber-100 hover:border-amber-300 transition-colors flex items-center gap-0.5"
                          title={`Add "${kw}" to ${section.name}`}
                        >
                          <Icon name="Plus" className="w-2 h-2" />
                          {kw}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Suggestions */}
                  {section.suggestions.length > 0 && (
                    <div className="text-[10px] text-muted-foreground flex gap-1 items-start ml-1">
                      <Icon name="Lightbulb" className="w-2.5 h-2.5 text-amber-500 shrink-0 mt-0.5" />
                      <span>{section.suggestions[0]}</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Overall missing keywords summary */}
              {score && score.missingKeywords.length > 0 && (
                <div className="pt-1.5 border-t border-border/40">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                    All missing ({score.missingKeywords.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {score.missingKeywords.slice(0, 12).map((kw) => (
                      <button
                        key={kw}
                        onClick={() => onAddKeyword?.(kw, "Summary")}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200
                          hover:bg-red-100 transition-colors"
                        title={`Add "${kw}" to Summary`}
                      >
                        {kw}
                      </button>
                    ))}
                    {score.missingKeywords.length > 12 && (
                      <span className="text-[9px] text-muted-foreground px-1 py-0.5">
                        +{score.missingKeywords.length - 12} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
