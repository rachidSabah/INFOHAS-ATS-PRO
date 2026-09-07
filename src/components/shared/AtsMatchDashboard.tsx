"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon, ScoreRing } from "@/components/shared";
import type { ATSDashboard, MatchGroup, TermMatch, TermPriority } from "@/lib/ats-match";

// ─── Props ───────────────────────────────────────────────────────────────────

interface AtsMatchDashboardProps {
  dashboard: ATSDashboard | null;
  /** True while the user is still typing (computation is debounced) */
  stale: boolean;
  hasJD: boolean;
  /** JD term currently being woven by AI (spinner state on that chip) */
  busyTerm: string | null;
  /** Lowercased resume skill names — drives the "already a skill" state */
  skillNamesLower: string[];
  onAddSkill: (term: string) => void;
  onWeave: (term: string, target: "summary" | "experience") => void;
  onAddMustHaves: (terms: string[]) => void;
  /** Optional JD selector node rendered when no target job is active */
  jdPicker?: ReactNode;
  jdMeta?: { title: string; company?: string } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tier(score: number): { label: string; text: string; ring: string } {
  if (score >= 85) return { label: "Excellent", text: "text-emerald-600 dark:text-emerald-400", ring: "text-emerald-500" };
  if (score >= 70) return { label: "Good", text: "text-green-600 dark:text-green-400", ring: "text-green-500" };
  if (score >= 50) return { label: "Needs Work", text: "text-amber-600 dark:text-amber-400", ring: "text-amber-500" };
  return { label: "Critical", text: "text-red-600 dark:text-red-400", ring: "text-red-500" };
}

function barColor(percent: number): string {
  if (percent >= 75) return "bg-emerald-500";
  if (percent >= 50) return "bg-amber-500";
  return "bg-red-500";
}

const GROUP_CHIP_STYLES: Record<TermPriority, string> = {
  required: "border-red-200 bg-red-50/60 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  technology: "border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  preferred: "border-border bg-secondary/50 text-secondary-foreground",
  keyword: "border-border bg-background text-muted-foreground",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function AtsMatchDashboard({
  dashboard,
  stale,
  hasJD,
  busyTerm,
  skillNamesLower,
  onAddSkill,
  onWeave,
  onAddMustHaves,
  jdPicker,
  jdMeta,
}: AtsMatchDashboardProps) {
  if (!hasJD || !dashboard) {
    return (
      <div className="flex flex-col h-[calc(100vh-220px)] border border-border rounded-xl bg-card p-4 overflow-y-auto scrollbar-thin">
        <div className="rounded-xl border border-dashed border-border p-5 text-center space-y-3 bg-secondary/20">
          <Icon name="Gauge" className="w-8 h-8 text-muted-foreground/50 mx-auto" />
          <div className="text-xs font-bold text-foreground">No Target Job Selected</div>
          <p className="text-[10px] text-muted-foreground max-w-[240px] mx-auto leading-relaxed">
            Pick a saved job description to see a live, priority-weighted match dashboard — must-have
            skills, core technologies, per-section coverage, and one-click AI gap filling.
          </p>
          {jdPicker}
        </div>
      </div>
    );
  }

  const t = tier(dashboard.overall);
  const matchedCount = dashboard.matched.length;
  const total = dashboard.totalTerms;
  const groupsWithGaps = dashboard.groups.filter((g) => g.total > g.matched);

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] border border-border rounded-xl bg-card p-4 overflow-y-auto space-y-4 scrollbar-thin">
      {/* Header — overall match */}
      <div className={`flex items-center gap-3 border-b border-border pb-3 ${stale ? "opacity-60" : ""} transition-opacity`}>
        <ScoreRing value={dashboard.overall} size={72} stroke={6} label="Match" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-bold ${t.text}`}>{t.label}</span>
            {stale && (
              <span className="text-[10px] font-normal text-muted-foreground animate-pulse">updating…</span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {matchedCount}/{total} JD terms matched
            {jdMeta?.title ? ` · ${jdMeta.title}${jdMeta.company ? ` @ ${jdMeta.company}` : ""}` : ""}
          </div>
        </div>
      </div>

      {/* Priority-weighted group breakdown */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <Icon name="Layers" className="w-3.5 h-3.5 text-brand" /> Match by priority
        </div>
        {dashboard.groups.map((g: MatchGroup) => (
          <div key={g.priority} className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold text-foreground/90">{g.label}</span>
              <span className="font-mono text-muted-foreground">
                {g.matched}/{g.total} · {g.percent}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor(g.percent)}`}
                style={{ width: `${g.percent}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Per-section coverage */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <Icon name="Map" className="w-3.5 h-3.5 text-brand" /> Where your JD terms live
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {dashboard.sectionCoverage.map((s) => (
            <div key={s.section} className="rounded-lg border border-border bg-secondary/10 p-1.5 text-center">
              <div className={`text-[11px] font-bold ${s.percent > 0 ? "text-foreground" : "text-muted-foreground/60"}`}>
                {s.percent}%
              </div>
              <div className="text-[9px] text-muted-foreground truncate" title={s.label}>{s.label}</div>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground leading-relaxed">
          Share of all {total} JD terms found in each section. ATS parsers weigh skills and bullets heavily —
          spread keywords across sections instead of stuffing one.
        </p>
      </div>

      {/* Missing chips by priority */}
      {groupsWithGaps.length > 0 && (
        <div className="space-y-2.5">
          <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <Icon name="Crosshair" className="w-3.5 h-3.5 text-brand" /> Close the gaps
          </div>
          {groupsWithGaps.map((g) => (
            <div key={g.priority} className="space-y-1.5">
              <div className="text-[10px] font-semibold text-muted-foreground">
                {g.label} — {g.total - g.matched} missing
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.terms.filter((tm) => !tm.matched).map((tm: TermMatch) => {
                  const alreadySkill = skillNamesLower.includes(tm.term.toLowerCase());
                  const busy = busyTerm === tm.term;
                  return (
                    <span
                      key={tm.term}
                      className={`inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full border text-[10px] font-medium ${GROUP_CHIP_STYLES[g.priority]}`}
                      title={tm.sections.length > 0 ? `Found in: ${tm.sections.join(", ")}` : "Not in resume yet"}
                    >
                      {tm.term}
                      {busy ? (
                        <Icon name="Loader2" className="w-3 h-3 animate-spin shrink-0" />
                      ) : alreadySkill ? (
                        <Icon name="Check" className="w-3 h-3 text-emerald-500 shrink-0" />
                      ) : (
                        <span className="inline-flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => onAddSkill(tm.term)}
                            className="p-0.5 rounded-full hover:bg-foreground/10 transition"
                            title="Add as a skill"
                          >
                            <Icon name="Plus" className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onWeave(tm.term, "summary")}
                            className="p-0.5 rounded-full hover:bg-foreground/10 transition"
                            title="Weave into Summary with AI"
                          >
                            <Icon name="Sparkles" className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onWeave(tm.term, "experience")}
                            className="p-0.5 rounded-full hover:bg-foreground/10 transition"
                            title="Weave into Experience bullets with AI"
                          >
                            <Icon name="Briefcase" className="w-3 h-3" />
                          </button>
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          {dashboard.mustHaveMissing.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-[11px] gap-1.5"
              onClick={() => onAddMustHaves(dashboard.mustHaveMissing)}
            >
              <Icon name="PlusCircle" className="w-3.5 h-3.5" />
              Add all {dashboard.mustHaveMissing.length} must-have gaps as skills
            </Button>
          )}
        </div>
      )}

      {/* Matched chips */}
      {dashboard.matched.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <Icon name="BadgeCheck" className="w-3.5 h-3.5 text-emerald-500" /> Matched ({dashboard.matched.length})
          </div>
          <div className="flex flex-wrap gap-1.5 pb-1">
            {dashboard.matched.map((tm: TermMatch) => (
              <span
                key={tm.term}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-emerald-200/60 bg-emerald-50/50 text-[10px] font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                title={`Found in: ${tm.sections.join(", ") || "resume"}`}
              >
                <Icon name="Check" className="w-3 h-3 shrink-0" />
                {tm.term}
              </span>
            ))}
          </div>
        </div>
      )}

      {groupsWithGaps.length === 0 && total > 0 && (
        <Card className="border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <CardContent className="p-3 text-center">
            <Icon name="PartyPopper" className="w-5 h-5 text-emerald-500 mx-auto" />
            <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 mt-1">
              Every JD term is covered!
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Export and apply — then track it in the Application Tracker.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
