"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// ── Types ────────────────────────────────────────────────────────────────────

interface QATestResult {
  name: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  passed: boolean;
  message: string;
  durationMs?: number;
  suggestion?: string;
}

interface QAResponse {
  status: "passed" | "failed" | "partial";
  timestamp: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  results: QATestResult[];
  criticalFailures: QATestResult[];
  suggestions: string[];
  coverage: Record<string, { total: number; passed: number; failed: number }>;
}

interface SubsystemHealth {
  status: "ok" | "degraded" | "down" | "unknown";
  detail: string;
  latencyMs?: number;
  metrics?: Record<string, number>;
}

interface HealthResponse {
  status: "ok" | "degraded" | "down" | "unknown";
  timestamp: string;
  uptimeSeconds: number;
  runtime: string;
  version: string;
  checks: Record<string, SubsystemHealth>;
  providers: {
    configured: string[];
    total: number;
    serverSide: number;
    clientSide: number;
  };
  cache: {
    type: string;
    statsAvailable: boolean;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusColor(status: string) {
  switch (status) {
    case "passed":
    case "ok":
      return "text-green-500 dark:text-green-400";
    case "partial":
    case "degraded":
      return "text-amber-500 dark:text-amber-400";
    case "failed":
    case "down":
      return "text-red-500 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}

function statusBg(status: string) {
  switch (status) {
    case "passed":
    case "ok":
      return "bg-green-500/10 border-green-500/20 dark:bg-green-500/15 dark:border-green-500/25";
    case "partial":
    case "degraded":
      return "bg-amber-500/10 border-amber-500/20 dark:bg-amber-500/15 dark:border-amber-500/25";
    case "failed":
    case "down":
      return "bg-red-500/10 border-red-500/20 dark:bg-red-500/15 dark:border-red-500/25";
    default:
      return "bg-muted border-border";
  }
}

function statusDot(status: string) {
  switch (status) {
    case "passed":
    case "ok":
      return "bg-green-500";
    case "partial":
    case "degraded":
      return "bg-amber-500";
    case "failed":
    case "down":
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
}

function severityBadge(severity: string) {
  const map: Record<string, { bg: string; text: string }> = {
    critical: { bg: "bg-red-500/15 border-red-500/25", text: "text-red-600 dark:text-red-400" },
    high: { bg: "bg-orange-500/15 border-orange-500/25", text: "text-orange-600 dark:text-orange-400" },
    medium: { bg: "bg-yellow-500/15 border-yellow-500/25", text: "text-yellow-600 dark:text-yellow-400" },
    low: { bg: "bg-sky-500/15 border-sky-500/25", text: "text-sky-600 dark:text-sky-400" },
    info: { bg: "bg-muted border-border", text: "text-muted-foreground" },
  };
  const s = map[severity] ?? map.info;
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${s.bg} ${s.text}`}>
      {severity}
    </span>
  );
}

function categoryBadge(category: string) {
  const map: Record<string, string> = {
    api: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    pipeline: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25",
    provider: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25",
    export: "bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/25",
    cache: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/25",
    ats: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
    performance: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25",
    persistence: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25",
  };
  const cls = map[category] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {category}
    </span>
  );
}

const CATEGORY_ICONS: Record<string, string> = {
  api: "🔌",
  pipeline: "🔄",
  provider: "🤖",
  export: "📄",
  cache: "⚡",
  ats: "🎯",
  performance: "🚀",
  persistence: "💾",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function QADashboardPage() {
  const [qaResult, setQaResult] = useState<QAResponse | null>(null);
  const [healthResult, setHealthResult] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [qaRes, healthRes] = await Promise.all([
        fetch("/api/qa/run").then((r) => r.json()),
        fetch("/api/health").then((r) => r.json()),
      ]);
      setQaResult(qaRes);
      setHealthResult(healthRes);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    } finally {
      setLoading(false);
      setRerunning(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRerun = () => {
    setRerunning(true);
    fetchData();
  };

  // ── Loading State ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="relative w-12 h-12 mx-auto">
            <div className="absolute inset-0 rounded-full border-2 border-muted" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Running QA Diagnostics</p>
            <p className="text-xs text-muted-foreground mt-1">Analyzing all subsystems…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full border-red-500/30">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Diagnostics Unavailable</CardTitle>
            <CardDescription>Could not reach QA or health endpoints</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRerun}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overallOk = qaResult?.status === "passed" && healthResult?.status === "ok";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6 md:px-8 md:py-8 space-y-6">

        {/* ═══════════════════════════════════════════════════════════════════
            1. HEADER
        ═══════════════════════════════════════════════════════════════════ */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">QA Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {qaResult?.timestamp
                ? new Date(qaResult.timestamp).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "No timestamp available"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${statusBg(qaResult?.status ?? "unknown")}`}>
              <span className={`h-2 w-2 rounded-full ${statusDot(qaResult?.status ?? "unknown")}`} />
              <span className={statusColor(qaResult?.status ?? "unknown")}>
                {overallOk
                  ? "All Systems Nominal"
                  : qaResult?.status === "partial"
                    ? "Partial — Issues Detected"
                    : qaResult?.status === "failed"
                      ? "Failures Detected"
                      : "Unknown"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRerun}
              disabled={rerunning}
              className="gap-1.5"
            >
              {rerunning ? (
                <>
                  <span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                  Re-run Tests
                </>
              )}
            </Button>
          </div>
        </header>

        {/* ═══════════════════════════════════════════════════════════════════
            2. CRITICAL FAILURES (prominent, at the top)
        ═══════════════════════════════════════════════════════════════════ */}
        {qaResult?.criticalFailures && qaResult.criticalFailures.length > 0 && (
          <Card className="border-red-500/40 bg-red-500/5 dark:bg-red-500/10">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                {qaResult.criticalFailures.length} Critical Failure{qaResult.criticalFailures.length > 1 ? "s" : ""}
              </CardTitle>
              <CardDescription className="text-red-500/80 dark:text-red-400/80">
                Immediate attention required
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {qaResult.criticalFailures.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-red-500/20 bg-red-500/5 dark:bg-red-500/10 p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                        {f.name.replace(/_/g, " ")}
                      </span>
                      {severityBadge(f.severity)}
                      {categoryBadge(f.category)}
                    </div>
                    <p className="text-sm text-red-600/80 dark:text-red-400/80">{f.message}</p>
                    {f.suggestion && (
                      <p className="text-xs text-red-500/60 dark:text-red-400/50 flex items-start gap-1">
                        <span className="shrink-0 mt-0.5">💡</span>
                        <span>{f.suggestion}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            3. SUMMARY CARDS (4 across)
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Tests Passed */}
          <Card className="border-green-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tests Passed</p>
                  <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">
                    {qaResult?.passedTests ?? "—"}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600 dark:text-green-400"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
                </div>
              </div>
              {qaResult && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  of {qaResult.totalTests} total
                </p>
              )}
            </CardContent>
          </Card>

          {/* Tests Failed */}
          <Card className={(qaResult?.failedTests ?? 0) > 0 ? "border-red-500/20" : ""}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tests Failed</p>
                  <p className={`text-3xl font-bold mt-1 ${(qaResult?.failedTests ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                    {qaResult?.failedTests ?? "—"}
                  </p>
                </div>
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${(qaResult?.failedTests ?? 0) > 0 ? "bg-red-500/10" : "bg-muted"}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={(qaResult?.failedTests ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                </div>
              </div>
              {qaResult && qaResult.failedTests === 0 && (
                <p className="text-[11px] text-green-600/70 dark:text-green-400/70 mt-2">No failures detected</p>
              )}
            </CardContent>
          </Card>

          {/* Uptime */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Uptime</p>
                  <p className="text-3xl font-bold mt-1">
                    {healthResult?.uptimeSeconds
                      ? formatUptime(healthResult.uptimeSeconds)
                      : "—"}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-400"><path d="M12 12l3.5-3.5"/><path d="M20.3 18c.4-1 .7-2.2.7-3.4C21 9.8 17 6 12 6s-9 3.8-9 8.6c0 1.2.3 2.4.7 3.4"/></svg>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Runtime: {healthResult?.runtime ?? "edge"}
              </p>
            </CardContent>
          </Card>

          {/* QA Status */}
          <Card className={statusBg(qaResult?.status ?? "unknown")}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">QA Status</p>
                  <p className={`text-3xl font-bold mt-1 capitalize ${statusColor(qaResult?.status ?? "unknown")}`}>
                    {qaResult?.status ?? "—"}
                  </p>
                </div>
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${statusBg(qaResult?.status ?? "unknown")}`}>
                  {qaResult?.status === "passed" ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600 dark:text-green-400"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
                  ) : qaResult?.status === "partial" ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 dark:text-amber-400"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600 dark:text-red-400"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                  )}
                </div>
              </div>
              {qaResult && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Pass rate: {((qaResult.passedTests / Math.max(qaResult.totalTests, 1)) * 100).toFixed(0)}%
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            4. COVERAGE GRID
        ═══════════════════════════════════════════════════════════════════ */}
        {qaResult?.coverage && Object.keys(qaResult.coverage).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Coverage by Category</CardTitle>
              <CardDescription>Test results grouped by subsystem</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {Object.entries(qaResult.coverage)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([cat, cov]) => {
                    const pct = cov.total > 0 ? (cov.passed / cov.total) * 100 : 0;
                    const allPassed = cov.failed === 0;
                    return (
                      <div
                        key={cat}
                        className={`rounded-lg border p-3 space-y-2 transition-colors ${
                          allPassed
                            ? "border-green-500/15 bg-green-500/5 dark:bg-green-500/10"
                            : "border-red-500/15 bg-red-500/5 dark:bg-red-500/10"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">{CATEGORY_ICONS[cat] ?? "📦"}</span>
                          <span className="text-sm font-semibold capitalize">{cat}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              <span className="text-green-600 dark:text-green-400 font-medium">{cov.passed}</span>
                              {" / "}
                              <span className="font-medium">{cov.total}</span>
                            </span>
                            <span className={`font-medium ${allPassed ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                          <Progress
                            value={pct}
                            className={`h-1.5 ${allPassed ? "[&>div]:bg-green-500" : "[&>div]:bg-red-500"}`}
                          />
                        </div>
                        {cov.failed > 0 && (
                          <p className="text-[10px] text-red-500/80 dark:text-red-400/70">
                            {cov.failed} failed
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            5. TEST RESULTS TABLE (expandable)
        ═══════════════════════════════════════════════════════════════════ */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Test Results</CardTitle>
                <CardDescription>
                  {qaResult?.totalTests ?? 0} tests — click to expand details
                </CardDescription>
              </div>
              {qaResult && (
                <Badge variant="secondary" className="text-xs">
                  {((qaResult.passedTests / Math.max(qaResult.totalTests, 1)) * 100).toFixed(0)}% pass rate
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Table Header */}
            <div className="hidden md:grid md:grid-cols-[2.5rem_1fr_5rem_5rem_1fr] gap-2 px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border mb-1">
              <div>Status</div>
              <div>Name</div>
              <div>Category</div>
              <div>Severity</div>
              <div>Message</div>
            </div>

            {/* Results */}
            <div className="max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
              <Accordion type="multiple" className="w-full">
                {qaResult?.results.map((test, idx) => (
                  <AccordionItem
                    key={test.name}
                    value={test.name}
                    className="border-b border-border/50 last:border-b-0"
                  >
                    <AccordionTrigger className="py-2.5 px-3 hover:no-underline hover:bg-muted/40 rounded-md">
                      <div className="flex items-center gap-2 w-full text-left">
                        {/* Status icon */}
                        <span className={`shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                          test.passed
                            ? "bg-green-500/15 text-green-600 dark:text-green-400"
                            : "bg-red-500/15 text-red-600 dark:text-red-400"
                        }`}>
                          {test.passed ? "✓" : "✗"}
                        </span>

                        {/* Name */}
                        <span className="text-sm font-medium truncate flex-1 min-w-0">
                          {test.name.replace(/_/g, " ")}
                        </span>

                        {/* Category badge - visible on md+ */}
                        <span className="hidden md:inline-flex">{categoryBadge(test.category)}</span>

                        {/* Severity badge - visible on md+ */}
                        <span className="hidden md:inline-flex">{severityBadge(test.severity)}</span>

                        {/* Message preview - visible on md+ */}
                        <span className="hidden md:block text-xs text-muted-foreground truncate max-w-[260px]">
                          {test.message}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3">
                      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                        {/* Mobile-only fields */}
                        <div className="md:hidden flex items-center gap-2 flex-wrap">
                          {categoryBadge(test.category)}
                          {severityBadge(test.severity)}
                        </div>
                        <div className="md:hidden">
                          <p className="text-sm text-foreground">{test.message}</p>
                        </div>
                        {/* Desktop: full message */}
                        <div className="hidden md:block">
                          <p className="text-sm text-foreground">{test.message}</p>
                        </div>
                        {test.suggestion && (
                          <div className="flex items-start gap-1.5 pt-1 border-t border-border/50">
                            <span className="shrink-0 text-amber-500 dark:text-amber-400 text-sm mt-px">💡</span>
                            <p className="text-xs text-amber-700 dark:text-amber-300/80">{test.suggestion}</p>
                          </div>
                        )}
                        {test.durationMs !== undefined && (
                          <p className="text-[10px] text-muted-foreground">
                            Duration: {formatDuration(test.durationMs)}
                          </p>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </CardContent>
        </Card>

        {/* ═══════════════════════════════════════════════════════════════════
            6. HEALTH CHECKS
        ═══════════════════════════════════════════════════════════════════ */}
        {healthResult?.checks && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">System Health</CardTitle>
                  <CardDescription>
                    Subsystem status from /api/health
                  </CardDescription>
                </div>
                <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${statusBg(healthResult.status)}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot(healthResult.status)}`} />
                  <span className={statusColor(healthResult.status)}>{healthResult.status.toUpperCase()}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(healthResult.checks).map(([key, check]) => {
                  const isOk = check.status === "ok";
                  const isDegraded = check.status === "degraded";
                  return (
                    <div
                      key={key}
                      className={`rounded-lg border p-3 space-y-1.5 ${
                        isOk
                          ? "border-border bg-card"
                          : isDegraded
                            ? "border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/10"
                            : "border-red-500/20 bg-red-500/5 dark:bg-red-500/10"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${statusDot(check.status)}`} />
                        <span className="text-sm font-semibold capitalize">
                          {key.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        <span className="ml-auto">
                          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            isOk
                              ? "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400"
                              : isDegraded
                                ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                                : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
                          }`}>
                            {check.status}
                          </span>
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{check.detail}</p>
                      {check.metrics && Object.keys(check.metrics).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {Object.entries(check.metrics).map(([mk, mv]) => (
                            <span key={mk} className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              <span className="font-medium">{mk}</span>
                              <span>{String(mv)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            7. SELF-HEALING STATUS
        ═══════════════════════════════════════════════════════════════════ */}
        {healthResult?.checks?.selfHealing && (
          <Card className="border-emerald-500/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-400"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
                </div>
                <div>
                  <CardTitle className="text-base">Self-Healing Engine</CardTitle>
                  <CardDescription>Automated recovery and resilience</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${statusDot(healthResult.checks.selfHealing.status)}`} />
                  <span className={`text-sm font-medium capitalize ${statusColor(healthResult.checks.selfHealing.status)}`}>
                    {healthResult.checks.selfHealing.status}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{healthResult.checks.selfHealing.detail}</p>
                {healthResult.checks.selfHealing.metrics && (
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    {Object.entries(healthResult.checks.selfHealing.metrics).map(([mk, mv]) => (
                      <div key={mk} className="rounded-lg border border-border bg-muted/30 p-2.5 text-center">
                        <p className="text-lg font-bold text-foreground">{String(mv)}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                          {mk.replace(/([A-Z])/g, " $1").trim()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            8. SUGGESTIONS
        ═══════════════════════════════════════════════════════════════════ */}
        {qaResult?.suggestions && qaResult.suggestions.length > 0 && (
          <Card className="border-amber-500/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 dark:text-amber-400"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
                </div>
                <div>
                  <CardTitle className="text-base">Suggestions</CardTitle>
                  <CardDescription>Recommended actions to improve system health</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {qaResult.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-amber-500/10 bg-amber-500/5 dark:bg-amber-500/5">
                    <span className="shrink-0 h-5 w-5 rounded-full bg-amber-500/15 flex items-center justify-center text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-sm text-foreground leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            9. RUNTIME INFO (Footer)
        ═══════════════════════════════════════════════════════════════════ */}
        <footer className="border-t border-border pt-4 pb-8">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Runtime: {healthResult?.runtime ?? "edge"}
            </span>
            <span className="flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Duration: {qaResult?.durationMs ? formatDuration(qaResult.durationMs) : "—"}
            </span>
            <span className="flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              Version: {healthResult?.version ?? "—"}
            </span>
            <span className="flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>
              Providers: {healthResult?.providers?.configured?.length ?? 0} configured
            </span>
            <span className="flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              Uptime: {healthResult?.uptimeSeconds ? formatUptime(healthResult.uptimeSeconds) : "—"}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
