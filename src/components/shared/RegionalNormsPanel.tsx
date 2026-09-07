"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import type { ContactInfo, ResumeData, ResumeRegion } from "@/lib/types";
import {
  REGION_NORMS,
  REGION_OPTIONS,
  computeRegionalNormReport,
  buildRegionalFixPatch,
  getResumeRegion,
  type RegionalFieldNorm,
  type RegionalNormIssue,
} from "@/lib/regional-norms";

// ─── Props ───────────────────────────────────────────────────────────────────

interface RegionalNormsPanelProps {
  resume: ResumeData;
  /** Builder's patch fn — merges a Partial<ResumeData> into the resume. */
  onPatch: (p: Partial<ResumeData>) => void;
  /** full = Basics tab (selector + inputs + fixes + advice); compact = ATS-audit strip. */
  variant?: "full" | "compact";
  /** Compact mode CTA — jumps to the Basics tab when a region must be set / fields added. */
  onOpenBasics?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreTier(score: number): { label: string; text: string; bar: string } {
  if (score >= 85) return { label: "Compliant", text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" };
  if (score >= 60) return { label: "Needs Work", text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" };
  return { label: "At Risk", text: "text-red-600 dark:text-red-400", bar: "bg-red-500" };
}

const STANCE_BADGE: Record<RegionalFieldNorm["stance"], { label: string; cls: string }> = {
  expected: { label: "Expected", cls: "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" },
  optional: { label: "Optional", cls: "border-border bg-secondary/50 text-secondary-foreground" },
  discouraged: { label: "Discouraged", cls: "border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" },
  avoid: { label: "Avoid", cls: "border-red-200 bg-red-50/60 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function RegionalNormsPanel({ resume, onPatch, variant = "full", onOpenBasics }: RegionalNormsPanelProps) {
  const region = getResumeRegion(resume);
  const report = computeRegionalNormReport(resume);

  const setRegion = (value: string) => {
    const contact = { ...(resume.contact || {}) } as ContactInfo;
    if (value) {
      contact.region = value as ResumeRegion;
    } else {
      delete contact.region;
    }
    onPatch({ contact });
  };

  const applyFix = (issue: RegionalNormIssue) => {
    const patch = buildRegionalFixPatch(resume, issue);
    if (patch) onPatch(patch);
  };

  const setPersonalDetail = (label: string, value: string) => {
    const contact = (resume.contact || {}) as ContactInfo;
    const pd = { ...(contact.personalDetails || {}) };
    pd[label] = value;
    onPatch({ contact: { ...contact, personalDetails: pd } });
  };

  const pdValue = (label: string): string => {
    const pd = (resume.contact as ContactInfo | undefined)?.personalDetails;
    if (!pd) return "";
    const hit = Object.keys(pd).find((k) => k.trim().toLowerCase() === label.trim().toLowerCase());
    return hit ? pd[hit] ?? "" : "";
  };

  // ── Region selector (full variant only) ────────────────────────────────────
  const selector = (
    <select
      value={region ?? ""}
      onChange={(e) => setRegion(e.target.value)}
      className="w-full h-8 px-2 rounded border border-input bg-background text-xs"
      aria-label="Target market / regional format"
    >
      {REGION_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );

  // ── Dormant state ──────────────────────────────────────────────────────────
  if (!region) {
    if (variant === "compact") {
      return (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-2">
          <span className="text-[10px] text-muted-foreground">
            <Icon name="Globe" className="w-3 h-3 inline mr-1 -mt-0.5" />
            No target market set — regional format checks are off.
          </span>
          {onOpenBasics && (
            <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0" onClick={onOpenBasics}>
              Set market
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-border p-3 space-y-2 bg-secondary/10">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold flex items-center gap-1.5">
            <Icon name="Globe" className="w-3.5 h-3.5 text-brand" /> Regional format
          </h4>
        </div>
        {selector}
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Pick a target market to enable region-aware personal-data checks — a photo is standard on Gulf
          CVs but a liability in North America; nationality and visa status are Gulf screening fields.
        </p>
      </div>
    );
  }

  const tier = scoreTier(report.score);
  const norms = REGION_NORMS[region];
  const removes = report.issues.filter((i) => i.kind === "remove");
  const adds = report.issues.filter((i) => i.kind === "add");

  // ── Issue row (shared by both variants) ────────────────────────────────────
  const renderIssue = (issue: RegionalNormIssue) => (
    <div key={issue.id} className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon name={issue.kind === "remove" ? "XCircle" : "PlusCircle"} className={`w-3.5 h-3.5 shrink-0 ${issue.severity === "warning" ? "text-amber-500" : "text-blue-500"}`} />
          <span className="text-[11px] font-semibold text-foreground">
            {issue.kind === "remove" ? `Remove ${issue.label.toLowerCase()}` : `Add ${issue.label.toLowerCase()}`}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{issue.message}</p>
      </div>
      {issue.kind === "remove" ? (
        <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0" onClick={() => applyFix(issue)}>
          Remove
        </Button>
      ) : (
        onOpenBasics && variant === "compact" && (
          <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0" onClick={onOpenBasics}>
            Add
          </Button>
        )
      )}
    </div>
  );

  // ── Compact strip (ATS Audit tab) ──────────────────────────────────────────
  if (variant === "compact") {
    return (
      <div className="rounded-lg border border-border bg-secondary/10 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <Icon name="Globe" className="w-3.5 h-3.5 text-brand" /> Regional format — {norms.label}
          </span>
          <Badge variant={report.score >= 85 ? "success" : report.score >= 60 ? "warning" : "danger"} className="text-[10px] font-mono">
            {report.score}/100
          </Badge>
        </div>
        <div className="h-1 rounded-full bg-secondary overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${tier.bar}`} style={{ width: `${report.score}%` }} />
        </div>
        {report.issues.length === 0 ? (
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Icon name="CheckCircle2" className="w-3.5 h-3.5" /> Matches {norms.label} conventions.
          </p>
        ) : (
          <div className="space-y-1.5">{report.issues.map(renderIssue)}</div>
        )}
      </div>
    );
  }

  // ── Full panel (Basics tab) ────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-border p-3 space-y-3 bg-secondary/10">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Icon name="Globe" className="w-3.5 h-3.5 text-brand" /> Regional format
        </h4>
        <span className="text-[10px] text-muted-foreground">{norms.tagline}</span>
      </div>
      {selector}

      {/* Compliance header */}
      <div className="flex items-center gap-2">
        <Badge variant={report.score >= 85 ? "success" : report.score >= 60 ? "warning" : "danger"} className="text-[10px] font-mono shrink-0">
          {report.score}/100
        </Badge>
        <span className={`text-[11px] font-semibold ${tier.text}`}>{tier.label}</span>
        <span className="text-[10px] text-muted-foreground">
          {report.issues.length === 0 ? "matches regional conventions" : `${report.issues.length} fixable issue${report.issues.length > 1 ? "s" : ""}`}
        </span>
      </div>
      <div className="h-1 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${tier.bar}`} style={{ width: `${report.score}%` }} />
      </div>

      {/* Issues + quick fixes */}
      {removes.length > 0 && <div className="space-y-1.5">{removes.map(renderIssue)}</div>}
      {adds.length > 0 && <div className="space-y-1.5">{adds.map(renderIssue)}</div>}

      {/* Field inputs — every norm field of the region gets an editor */}
      <div className="space-y-2 pt-1">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Personal data for this market</div>
        {report.fields.map((f) => {
          const stance = STANCE_BADGE[f.stance];
          if (f.key === "photo") {
            const hasPhoto = !!resume.photoUrl?.trim();
            return (
              <div key={f.key} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[11px] font-medium">{f.label}</span>{" "}
                  <span className={`text-[9px] px-1 py-0.5 rounded border ${stance.cls}`}>{stance.label}</span>
                  <p className="text-[10px] text-muted-foreground leading-snug">{hasPhoto ? "Photo attached (set it in Design)." : "No photo attached."}</p>
                </div>
                {hasPhoto && f.stance !== "expected" && f.stance !== "optional" && (
                  <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0" onClick={() => onPatch({ photoUrl: "" })}>
                    Remove
                  </Button>
                )}
              </div>
            );
          }
          if (f.key === "dateOfBirth") {
            return (
              <div key={f.key}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-medium">{f.label}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded border ${stance.cls}`}>{stance.label}</span>
                </div>
                <Input
                  value={resume.dateOfBirth ?? ""}
                  onChange={(e) => onPatch({ dateOfBirth: e.target.value })}
                  placeholder="YYYY-MM-DD"
                  className="h-7 text-xs"
                />
              </div>
            );
          }
          return (
            <div key={f.key}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[11px] font-medium">{f.label}</span>
                <span className={`text-[9px] px-1 py-0.5 rounded border ${stance.cls}`}>{stance.label}</span>
              </div>
              <Input
                value={pdValue(f.label)}
                onChange={(e) => setPersonalDetail(f.label, e.target.value)}
                placeholder={f.key === "visaStatus" ? "e.g. UAE residence visa — transferable" : f.key === "nationality" ? "e.g. Moroccan" : ""}
                className="h-7 text-xs"
              />
            </div>
          );
        })}
      </div>

      {/* Market advice */}
      <div className="rounded-lg bg-background border border-border p-2.5 space-y-1">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{norms.label} conventions</div>
        <ul className="space-y-0.5">
          {report.advice.map((a) => (
            <li key={a} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
              <Icon name="Check" className="w-3 h-3 text-brand shrink-0 mt-0.5" /> {a}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
