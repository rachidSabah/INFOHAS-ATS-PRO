"use client";

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import type { PipelineResult } from "@/lib/agents";

/**
 * Phase11Reports — displays Live JD Fetch indicator, Eligibility Gap Checker,
 * and Guardian Strict anti-fabrication report.
 *
 * These components are additive to existing PipelineResults and never block
 * rendering — they return null when data is not present.
 */

interface Phase11ReportsProps {
  result: PipelineResult;
}

export function Phase11Reports({ result }: Phase11ReportsProps) {
  const { liveFetchAttempted, liveJDFetchUrl, eligibilityReport, guardianStrictReport } = result;

  const hasAnyData = liveFetchAttempted || eligibilityReport || guardianStrictReport;
  if (!hasAnyData) return null;

  return (
    <>
      {/* === Live JD Fetch Indicator + Eligibility Gap Checker === */}
      {(liveFetchAttempted || eligibilityReport) && (
        <Card className="border-2 border-sky-200 dark:border-sky-900 bg-gradient-to-br from-sky-50/50 to-blue-50/50 dark:from-sky-950/10 dark:to-blue-950/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Globe" className="w-4 h-4 text-sky-600" />
              Live JD Intelligence
              {liveFetchAttempted && (
                <Badge variant="success" className="text-[10px] ml-auto">
                  Live Data ✓
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              {liveJDFetchUrl
                ? `JD enriched from live career page: ${liveJDFetchUrl}`
                : liveFetchAttempted
                  ? "Live JD search was attempted and enriched the pipeline"
                  : "Eligibility check against the job description"}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {/* Eligibility Report */}
            {eligibilityReport && (
              <>
                {/* Summary banner */}
                <div className={`rounded-lg p-3 flex items-center gap-3 ${
                  eligibilityReport.blockers.length > 0
                    ? "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900"
                    : eligibilityReport.gaps.length > 0
                      ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900"
                      : "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900"
                }`}>
                  <Icon
                    name={
                      eligibilityReport.blockers.length > 0
                        ? "AlertOctagon"
                        : eligibilityReport.gaps.length > 0
                          ? "AlertTriangle"
                          : "CheckCircle2"
                    }
                    className={`w-5 h-5 shrink-0 ${
                      eligibilityReport.blockers.length > 0
                        ? "text-red-600"
                        : eligibilityReport.gaps.length > 0
                          ? "text-amber-600"
                          : "text-emerald-600"
                    }`}
                  />
                  <div>
                    <div className={`text-sm font-semibold ${
                      eligibilityReport.blockers.length > 0
                        ? "text-red-700 dark:text-red-400"
                        : eligibilityReport.gaps.length > 0
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-emerald-700 dark:text-emerald-400"
                    }`}>
                      {eligibilityReport.blockers.length > 0
                        ? `${eligibilityReport.blockers.length} Blocking Issue(s) Found`
                        : eligibilityReport.gaps.length > 0
                          ? `${eligibilityReport.gaps.length} Gap(s) to Address`
                          : "Candidate Appears Eligible ✓"}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Based on {eligibilityReport.extractedRequirements.length} requirement(s) extracted from the job description
                    </p>
                  </div>
                </div>

                {/* Detailed breakdown in 3-column grid */}
                <div className="grid sm:grid-cols-3 gap-3 text-xs">
                  {/* Blockers — hard no */}
                  {eligibilityReport.blockers.length > 0 && (
                    <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/10 p-2.5">
                      <div className="text-red-600 uppercase text-[9px] mb-1 font-semibold flex items-center gap-1">
                        <Icon name="AlertOctagon" className="w-3 h-3" />
                        Blockers ({eligibilityReport.blockers.length})
                      </div>
                      <div className="space-y-1.5">
                        {eligibilityReport.blockers.map((b, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className="text-red-600 shrink-0 mt-0.5">•</span>
                            <div>
                              <span className="font-medium">{b.requirement}</span>
                              <p className="text-muted-foreground">{b.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Gaps — should address */}
                  {eligibilityReport.gaps.length > 0 && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/10 p-2.5">
                      <div className="text-amber-600 uppercase text-[9px] mb-1 font-semibold flex items-center gap-1">
                        <Icon name="AlertTriangle" className="w-3 h-3" />
                        Gaps ({eligibilityReport.gaps.length})
                      </div>
                      <div className="space-y-1.5">
                        {eligibilityReport.gaps.map((g, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className="text-amber-600 shrink-0 mt-0.5">•</span>
                            <div>
                              <span className="font-medium">{g.requirement}</span>
                              <p className="text-muted-foreground">{g.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Met requirements */}
                  {eligibilityReport.met.length > 0 && (
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/10 p-2.5">
                      <div className="text-emerald-600 uppercase text-[9px] mb-1 font-semibold flex items-center gap-1">
                        <Icon name="CheckCircle2" className="w-3 h-3" />
                        Met ({eligibilityReport.met.length})
                      </div>
                      <div className="space-y-1.5">
                        {eligibilityReport.met.slice(0, 8).map((m, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className="text-emerald-600 shrink-0 mt-0.5">✓</span>
                            <div>
                              <span className="font-medium">{m.requirement}</span>
                              <p className="text-muted-foreground">{m.detail}</p>
                            </div>
                          </div>
                        ))}
                        {eligibilityReport.met.length > 8 && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            +{eligibilityReport.met.length - 8} more requirements met
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Empty columns when one section is empty */}
                  {eligibilityReport.blockers.length === 0 && (
                    <div className="rounded-lg border border-border bg-card/30 p-2.5 text-muted-foreground text-center">
                      <Icon name="ShieldCheck" className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
                      No blockers found
                    </div>
                  )}
                  {eligibilityReport.gaps.length === 0 && (
                    <div className="rounded-lg border border-border bg-card/30 p-2.5 text-muted-foreground text-center">
                      <Icon name="ShieldCheck" className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
                      No gaps found
                    </div>
                  )}
                  {eligibilityReport.met.length === 0 && (
                    <div className="rounded-lg border border-border bg-card/30 p-2.5 text-muted-foreground text-center">
                      <Icon name="Info" className="w-4 h-4 mx-auto mb-1" />
                      No requirements automatically confirmed
                    </div>
                  )}
                </div>
              </>
            )}

            {/* No eligibility report placeholder */}
            {!eligibilityReport && (
              <p className="text-xs text-muted-foreground">
                Live JD fetch was attempted but eligibility data was not generated.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* === Guardian Strict Anti-Fabrication === */}
      {guardianStrictReport && <GuardianStrictCard report={guardianStrictReport} />}
    </>
  );
}

/**
 * Guardian Strict card — rendered separately so it can safely access
 * guardianStrict sub-properties with optional chaining.
 */
function GuardianStrictCard({ report }: { report: NonNullable<PipelineResult["guardianStrictReport"]> }) {
  // Safari-guard: if guardianStrict is missing, don't crash — show nothing
  const gs = (report as any)?.guardianStrict;
  if (!gs) return null;

  const violations: Array<{ type: string; value: string; location: string; reason: string; severity: string }> =
    gs.violations ?? [];
  // GuardianStrictReport has `violations` with a `severity` field.
  // Derive warnings from violations where severity === "warning" for backwards compat.
  const warnings = violations.filter((v) => v.severity === "warning");
  const hardViolations = violations.filter((v) => v.severity === "violation" || !v.severity);

  const passed = !report.passed === false ? report.passed : true;
  // Derive verdict: if report.passed is true => CLEAN, else use gs.verdict
  const verdict: string = report.passed ? "CLEAN" : (gs.verdict ?? "VIOLATION");
  const totalViolations = gs.totalViolations ?? violations.length;
  const sourceFingerprint = gs.sourceFingerprint;

  return (
    <Card className={`border-2 ${
      passed
        ? "border-emerald-200 dark:border-emerald-900"
        : verdict === "FLAGGED"
          ? "border-amber-200 dark:border-amber-900"
          : "border-red-200 dark:border-red-900"
    }`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon name="Fingerprint" className="w-4 h-4 text-brand" />
          Guardian Strict — Anti-Fabrication
          <Badge
            variant={passed ? "success" : verdict === "FLAGGED" ? "warning" : "danger"}
            className="ml-auto text-[10px]"
          >
            {passed ? "PASSED" : verdict === "FLAGGED" ? "FLAGGED" : `${totalViolations} VIOLATIONS`}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Every metric, award, and credential in the optimized resume is traced back to the original source.
          {passed
            ? " All values verified against source."
            : ` ${totalViolations} untraceable value(s) found.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Verdict banner */}
        <div className={`rounded-lg p-3 flex items-center gap-3 ${
          passed
            ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900"
            : verdict === "FLAGGED"
              ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900"
              : "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900"
        }`}>
          <Icon
            name={passed ? "ShieldCheck" : verdict === "FLAGGED" ? "AlertTriangle" : "AlertOctagon"}
            className={`w-5 h-5 shrink-0 ${
              passed
                ? "text-emerald-600"
                : verdict === "FLAGGED"
                  ? "text-amber-600"
                  : "text-red-600"
            }`}
          />
          <div>
            <div className={`text-sm font-semibold ${
              passed
                ? "text-emerald-700 dark:text-emerald-400"
                : verdict === "FLAGGED"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-red-700 dark:text-red-400"
            }`}>
              {passed
                ? "All Metrics Verified"
                : verdict === "FLAGGED"
                  ? `${warnings.length} Value(s) Flagged`
                  : `${totalViolations} Untraceable Value(s)`}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {passed
                ? "Every number, metric, award, and certification was traced back to the source resume. No fabrication detected."
                : "Some values in the optimized resume could not be traced back to the source. Review flagged items below."}
            </p>
          </div>
        </div>

        {/* Violations list */}
        {hardViolations.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-red-600 flex items-center gap-1.5">
              <Icon name="AlertOctagon" className="w-3.5 h-3.5" />
              Violations ({hardViolations.length})
            </div>
            {hardViolations.map((v, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-red-50/50 dark:bg-red-950/10 border border-red-100 dark:border-red-950">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{v.value}</div>
                  <div className="text-[10px] text-muted-foreground">{v.reason}</div>
                  {v.location && (
                    <div className="text-[9px] text-muted-foreground mt-0.5">in: {v.location}</div>
                  )}
                </div>
                <Badge variant={v.severity === "violation" ? "danger" : "warning"} className="text-[9px] shrink-0">
                  {v.type}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {/* Warnings list (derived from violations with severity === "warning") */}
        {warnings.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-amber-600 flex items-center gap-1.5">
              <Icon name="AlertTriangle" className="w-3.5 h-3.5" />
              Warnings ({warnings.length})
            </div>
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-950">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{w.value}</div>
                  <div className="text-[10px] text-muted-foreground">{w.reason}</div>
                  {w.location && (
                    <div className="text-[9px] text-muted-foreground mt-0.5">in: {w.location}</div>
                  )}
                </div>
                <Badge variant="warning" className="text-[9px] shrink-0">
                  {w.type}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {/* Source summary */}
        {sourceFingerprint && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
              Source Fingerprint ({sourceFingerprint.numbers?.size ?? 0} numbers,{" "}
              {sourceFingerprint.awards?.size ?? 0} awards,{" "}
              {sourceFingerprint.certifications?.size ?? 0} certifications)
            </summary>
            <div className="mt-2 p-2 rounded-lg bg-secondary/30 space-y-1">
              {(sourceFingerprint.numbers?.size ?? 0) > 0 && (
                <div>
                  <span className="font-medium">Numbers:</span>{" "}
                  {Array.from(sourceFingerprint.numbers ?? []).slice(0, 20).join(", ")}
                  {(sourceFingerprint.numbers?.size ?? 0) > 20 && (
                    <span className="text-muted-foreground"> +{(sourceFingerprint.numbers?.size ?? 0) - 20} more</span>
                  )}
                </div>
              )}
              {(sourceFingerprint.awards?.size ?? 0) > 0 && (
                <div>
                  <span className="font-medium">Awards/Recognition:</span>{" "}
                  {Array.from(sourceFingerprint.awards ?? []).slice(0, 10).join(", ")}
                </div>
              )}
              {(sourceFingerprint.certifications?.size ?? 0) > 0 && (
                <div>
                  <span className="font-medium">Certifications:</span>{" "}
                  {Array.from(sourceFingerprint.certifications ?? []).slice(0, 10).join(", ")}
                </div>
              )}
            </div>
          </details>
        )}

        {gs.assessedAt && (
          <p className="text-[9px] text-muted-foreground">
            Assessed at: {new Date(gs.assessedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
