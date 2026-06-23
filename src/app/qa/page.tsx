"use client";

import { useEffect, useState } from "react";

interface QATestResult {
  name: string;
  passed: boolean;
  message: string;
  durationMs?: number;
}

interface QAResponse {
  status: "passed" | "failed" | "partial";
  timestamp: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: QATestResult[];
  suggestions: string[];
  durationMs?: number;
}

interface HealthCheck {
  status: string;
  detail?: string;
  [key: string]: unknown;
}

interface HealthResponse {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
  checks: Record<string, HealthCheck>;
}

export default function QAPage() {
  const [qaResult, setQaResult] = useState<QAResponse | null>(null);
  const [healthResult, setHealthResult] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/qa/run").then((r) => r.json()),
      fetch("/api/health").then((r) => r.json()),
    ])
      .then(([qa, health]) => {
        setQaResult(qa);
        setHealthResult(health);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Running diagnostics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="max-w-md w-full bg-card border border-destructive/30 rounded-xl p-6">
          <h2 className="text-lg font-bold text-destructive mb-2">Diagnostics unavailable</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const allPassed = qaResult?.status === "passed";
  const healthOk = healthResult?.status === "ok" || healthResult?.status === "degraded";

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">QA Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {qaResult?.timestamp ? new Date(qaResult.timestamp).toLocaleString() : ""}
            </p>
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            allPassed && healthOk ? "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400" : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
          }`}>
            {allPassed && healthOk ? "All systems nominal" : "Issues detected"}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-2xl font-bold">{qaResult?.passedTests ?? "—"}</div>
            <div className="text-xs text-muted-foreground">Tests passed</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-2xl font-bold">{qaResult?.failedTests ?? "—"}</div>
            <div className="text-xs text-muted-foreground">Tests failed</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-2xl font-bold">{healthResult?.uptimeSeconds ? `${Math.floor(healthResult.uptimeSeconds / 60)}m` : "—"}</div>
            <div className="text-xs text-muted-foreground">Uptime</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-2xl font-bold capitalize">{qaResult?.status ?? "—"}</div>
            <div className="text-xs text-muted-foreground">QA Status</div>
          </div>
        </div>

        {/* Test Results */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-4">Test Results</h2>
          <div className="space-y-2">
            {qaResult?.results.map((test) => (
              <div key={test.name} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
                <span className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  test.passed ? "bg-green-100 text-green-600 dark:bg-green-950/30 dark:text-green-400" : "bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                }`}>
                  {test.passed ? "✓" : "✗"}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{test.name.replace(/_/g, " ")}</div>
                  <div className="text-xs text-muted-foreground break-words">{test.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Health Checks */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-4">System Health</h2>
          <div className="space-y-2">
            {healthResult && Object.entries(healthResult.checks).map(([key, check]) => (
              <div key={key} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
                <span className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  check.status === "ok" ? "bg-green-100 text-green-600 dark:bg-green-950/30 dark:text-green-400" :
                  check.status === "degraded" ? "bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400" :
                  "bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                }`}>
                  {check.status === "ok" ? "✓" : check.status === "degraded" ? "!" : "✗"}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium capitalize">{key}</div>
                  <div className="text-xs text-muted-foreground break-words">{check.detail ?? check.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Suggestions */}
        {qaResult?.suggestions && qaResult.suggestions.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-2">Suggestions</h2>
            <ul className="space-y-1">
              {qaResult.suggestions.map((s, i) => (
                <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-primary">→</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Runtime Info */}
        <div className="text-center text-xs text-muted-foreground">
          Runtime: {healthResult ? "Edge" : "Unknown"} | Tests completed in {qaResult?.durationMs ?? "?"}ms
        </div>
      </div>
    </div>
  );
}
