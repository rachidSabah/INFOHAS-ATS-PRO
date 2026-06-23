"use client";

import { useState, useEffect, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

interface QATestResult {
  name: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  passed: boolean;
  message: string;
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

interface TestRun {
  id: string;
  timestamp: string;
  status: "passed" | "failed" | "partial";
  passRate: number;
  durationMs: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
}

// ============================================================================
// Constants
// ============================================================================

const TEST_CATEGORIES = [
  { id: "api", label: "API Tests", description: "Endpoint availability & self-healing" },
  { id: "pipeline", label: "Pipeline Tests", description: "Optimizer stages & quality gates" },
  { id: "provider", label: "Provider Tests", description: "AI provider config & failover" },
  { id: "export", label: "Export Tests", description: "PDF/DOCX format & layout" },
  { id: "cache", label: "Cache Tests", description: "Key structure & integrity" },
  { id: "ats", label: "ATS Industry Tests", description: "Industry profiles & auto-detect" },
  { id: "performance", label: "Performance Tests", description: "Thresholds & latency checks" },
  { id: "persistence", label: "Persistence Tests", description: "Database & dual storage" },
] as const;

const CATEGORY_ICONS: Record<string, string> = {
  api: "M6 18L18 6M6 6l12 12",
  pipeline: "M12 4v16m8-8H4",
  provider: "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4",
  export: "M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  cache: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
  ats: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  performance: "M13 10V3L4 14h7v7l9-11h-7z",
  persistence: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-500/30", label: "CRITICAL" },
  high: { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", border: "border-orange-500/30", label: "HIGH" },
  medium: { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/30", label: "MEDIUM" },
  low: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30", label: "LOW" },
  info: { bg: "bg-slate-500/10", text: "text-slate-600 dark:text-slate-400", border: "border-slate-500/30", label: "INFO" },
};

// ============================================================================
// Helper Components (inline SVG icons)
// ============================================================================

function IconCheck({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconX({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconChevronDown({ className = "w-4 h-4", rotated = false }: { className?: string; rotated?: boolean }) {
  return (
    <svg className={`${className} transition-transform duration-200 ${rotated ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconPlay({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconLoader({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

function IconAlertTriangle({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconClock({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconShield({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconActivity({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function CategoryIcon({ categoryId, className = "w-4 h-4" }: { categoryId: string; className?: string }) {
  const d = CATEGORY_ICONS[categoryId];
  if (!d) return null;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ============================================================================
// Main Component
// ============================================================================

export default function TestRunnerPage() {
  // ---- State ----
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTestName, setCurrentTestName] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [results, setResults] = useState<QAResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testHistory, setTestHistory] = useState<TestRun[]>([]);
  const [autoRun, setAutoRun] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showCriticalFirst, setShowCriticalFirst] = useState(true);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const hasAutoRunRef = useRef(false);

  // ---- Auto-run on load ----
  useEffect(() => {
    if (autoRun && !hasAutoRunRef.current) {
      hasAutoRunRef.current = true;
      const all = new Set(TEST_CATEGORIES.map((c) => c.id));
      setSelectedCategories(all);
      // Use a timeout to ensure state is updated before running
      setTimeout(() => {
        executeTests(all);
      }, 100);
    }
  }, [autoRun]);

  // ---- Timer ----
  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  // ---- Toggle category ----
  function toggleCategory(id: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // ---- Select all / regression suite ----
  function selectAll() {
    setSelectedCategories(new Set(TEST_CATEGORIES.map((c) => c.id)));
  }

  function deselectAll() {
    setSelectedCategories(new Set());
  }

  // ---- Toggle expanded category in results ----
  function toggleExpanded(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  // ---- Run tests ----
  async function executeTests(cats: Set<string>) {
    if (cats.size === 0) return;

    setIsRunning(true);
    setProgress(0);
    setCurrentTestName("Initializing test runner...");
    setResults(null);
    setError(null);
    setExpandedCategories(new Set());

    // Simulate progress steps
    const categoryLabels = Array.from(cats).map(
      (id) => TEST_CATEGORIES.find((c) => c.id === id)?.label ?? id
    );
    let step = 0;
    const totalSteps = cats.size + 2;
    const progressInterval = setInterval(() => {
      step++;
      if (step < totalSteps) {
        setProgress(Math.min(Math.round((step / totalSteps) * 85), 85));
        if (step <= categoryLabels.length) {
          setCurrentTestName(`Running ${categoryLabels[step - 1]}...`);
        } else {
          setCurrentTestName("Compiling results...");
        }
      }
    }, 400);

    try {
      const response = await fetch("/api/qa/run");
      if (!response.ok) throw new Error(`API returned ${response.status}`);

      const data: QAResponse = await response.json();

      clearInterval(progressInterval);

      // Filter results by selected categories
      const filteredResults = data.results.filter((r) => cats.has(r.category));
      const filteredCritical = data.criticalFailures.filter((r) => cats.has(r.category));
      const filteredCoverage: Record<string, { total: number; passed: number; failed: number }> = {};
      for (const [key, val] of Object.entries(data.coverage)) {
        if (cats.has(key)) {
          filteredCoverage[key] = val;
        }
      }

      const passedTests = filteredResults.filter((r) => r.passed).length;
      const failedTests = filteredResults.filter((r) => !r.passed).length;
      const status: "passed" | "failed" | "partial" =
        failedTests === 0 ? "passed" : passedTests > 0 ? "partial" : "failed";

      const finalData: QAResponse = {
        ...data,
        status,
        totalTests: filteredResults.length,
        passedTests,
        failedTests,
        results: filteredResults,
        criticalFailures: filteredCritical,
        coverage: filteredCoverage,
      };

      // Animate progress to 100%
      setProgress(100);
      setCurrentTestName("Complete");
      setResults(finalData);

      // Add to history
      const run: TestRun = {
        id: generateId(),
        timestamp: data.timestamp,
        status,
        passRate: finalData.totalTests > 0 ? Math.round((passedTests / finalData.totalTests) * 100) : 0,
        durationMs: data.durationMs,
        totalTests: finalData.totalTests,
        passedTests,
        failedTests,
      };
      setTestHistory((prev) => [run, ...prev].slice(0, 5));

      // Auto-expand categories with failures
      const failedCats = new Set(filteredResults.filter((r) => !r.passed).map((r) => r.category));
      setExpandedCategories(failedCats);

    } catch (err) {
      clearInterval(progressInterval);
      setError(err instanceof Error ? err.message : "Unknown error occurred");
      setProgress(0);
    } finally {
      setIsRunning(false);
    }
  }

  function handleRunTests() {
    executeTests(selectedCategories);
  }

  // ---- Group results by category ----
  const groupedResults = results
    ? results.results.reduce<Record<string, QATestResult[]>>((acc, r) => {
        if (!acc[r.category]) acc[r.category] = [];
        acc[r.category].push(r);
        return acc;
      }, {})
    : {};

  // Sort categories: if showCriticalFirst, put categories with failures first
  const sortedCategories = Object.keys(groupedResults).sort((a, b) => {
    if (showCriticalFirst) {
      const aFailed = groupedResults[a].some((r) => !r.passed);
      const bFailed = groupedResults[b].some((r) => !r.passed);
      if (aFailed && !bFailed) return -1;
      if (!aFailed && bFailed) return 1;
    }
    return a.localeCompare(b);
  });

  // ---- Status color helpers ----
  const statusColor = (status: string) => {
    switch (status) {
      case "passed": return "text-emerald-500";
      case "failed": return "text-red-500";
      case "partial": return "text-amber-500";
      default: return "text-muted-foreground";
    }
  };

  const statusBg = (status: string) => {
    switch (status) {
      case "passed": return "bg-emerald-500/10 border-emerald-500/20";
      case "failed": return "bg-red-500/10 border-red-500/20";
      case "partial": return "bg-amber-500/10 border-amber-500/20";
      default: return "bg-muted border-border";
    }
  };

  // ---- Render ----
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* ================================================================ */}
        {/* Header */}
        {/* ================================================================ */}
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <IconShield className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Test Runner
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Run comprehensive QA tests across the entire application
              </p>
            </div>
          </div>
        </header>

        {/* ================================================================ */}
        {/* Auto-run toggle */}
        {/* ================================================================ */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-card border border-border">
          <div className="flex items-center gap-3">
            <IconActivity className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Auto-run on page load</p>
              <p className="text-xs text-muted-foreground">
                Automatically execute all tests when the page opens
              </p>
            </div>
          </div>
          <button
            role="switch"
            aria-checked={autoRun}
            onClick={() => setAutoRun(!autoRun)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              autoRun ? "bg-emerald-500" : "bg-input"
            }`}
          >
            <span
              className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                autoRun ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* ================================================================ */}
        {/* Category Selection */}
        {/* ================================================================ */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Select Test Categories</h2>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-xs px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Select All
              </button>
              <button
                onClick={deselectAll}
                className="text-xs px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TEST_CATEGORIES.map((cat) => {
              const isSelected = selectedCategories.has(cat.id);
              const coverage = results?.coverage[cat.id];
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  className={`group relative flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-150 ${
                    isSelected
                      ? "bg-emerald-500/5 border-emerald-500/30 shadow-sm"
                      : "bg-card border-border hover:border-border/80 hover:bg-muted/30"
                  }`}
                >
                  {/* Checkbox indicator */}
                  <div
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                      isSelected
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-input bg-background"
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{cat.label}</span>
                      {coverage && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          coverage.failed > 0
                            ? "bg-red-500/10 text-red-600 dark:text-red-400"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        }`}>
                          {coverage.passed}/{coverage.total}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {cat.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Regression Suite button */}
          <button
            onClick={selectAll}
            className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed transition-all duration-150 ${
              selectedCategories.size === TEST_CATEGORIES.length
                ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                : "border-border hover:border-emerald-500/30 hover:bg-emerald-500/5 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
            <span className="text-sm font-medium">
              Regression Suite — Run All {TEST_CATEGORIES.length} Categories
            </span>
            {selectedCategories.size === TEST_CATEGORIES.length && (
              <IconCheck className="w-4 h-4" />
            )}
          </button>
        </section>

        {/* ================================================================ */}
        {/* Run Button */}
        {/* ================================================================ */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleRunTests}
            disabled={isRunning || selectedCategories.size === 0}
            className={`inline-flex items-center gap-2.5 px-8 py-3.5 rounded-xl text-base font-semibold transition-all duration-200 ${
              isRunning
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : selectedCategories.size === 0
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40"
            }`}
          >
            {isRunning ? (
              <>
                <IconLoader className="w-5 h-5" />
                Running Tests...
              </>
            ) : (
              <>
                <IconPlay className="w-5 h-5" />
                Run Tests
                {selectedCategories.size > 0 && (
                  <span className="ml-1 text-sm opacity-75">
                    ({selectedCategories.size} {selectedCategories.size === 1 ? "category" : "categories"})
                  </span>
                )}
              </>
            )}
          </button>

          {selectedCategories.size === 0 && !isRunning && (
            <p className="text-xs text-muted-foreground">
              Select at least one category to run tests
            </p>
          )}
        </div>

        {/* ================================================================ */}
        {/* Progress Section */}
        {/* ================================================================ */}
        {isRunning && (
          <section className="p-6 rounded-xl bg-card border border-border space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center gap-3">
              <IconLoader className="w-5 h-5 text-emerald-500" />
              <h3 className="text-base font-semibold">Running Tests</h3>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{currentTestName}</span>
                <span className="font-mono text-xs tabular-nums">{progress}%</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Elapsed time */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconClock className="w-4 h-4" />
              <span className="font-mono tabular-nums">
                Elapsed: {formatDuration(elapsedMs)}
              </span>
            </div>
          </section>
        )}

        {/* ================================================================ */}
        {/* Error */}
        {/* ================================================================ */}
        {error && (
          <section className="p-6 rounded-xl bg-red-500/5 border border-red-500/20 space-y-2">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <IconX className="w-5 h-5" />
              <h3 className="font-semibold">Test Run Failed</h3>
            </div>
            <p className="text-sm text-muted-foreground">{error}</p>
          </section>
        )}

        {/* ================================================================ */}
        {/* Results Section */}
        {/* ================================================================ */}
        {results && !isRunning && (
          <section className="space-y-6 animate-in fade-in duration-500">
            {/* ---- Overall Status ---- */}
            <div className={`p-6 rounded-xl border ${statusBg(results.status)} flex items-center gap-5`}>
              <div className={`shrink-0 ${statusColor(results.status)}`}>
                {results.status === "passed" ? (
                  <div className="p-3 rounded-full bg-emerald-500/10">
                    <IconCheck className="w-10 h-10" />
                  </div>
                ) : results.status === "failed" ? (
                  <div className="p-3 rounded-full bg-red-500/10">
                    <IconX className="w-10 h-10" />
                  </div>
                ) : (
                  <div className="p-3 rounded-full bg-amber-500/10">
                    <IconAlertTriangle className="w-10 h-10" />
                  </div>
                )}
              </div>
              <div>
                <h2 className="text-xl font-bold">
                  {results.status === "passed"
                    ? "All Tests Passed"
                    : results.status === "failed"
                    ? "Tests Failed"
                    : "Partial Pass"}
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {results.status === "passed"
                    ? "All selected test categories passed successfully."
                    : results.status === "failed"
                    ? "One or more critical tests have failed. Review the details below."
                    : "Some tests passed, but failures were detected. Review the details below."}
                </p>
              </div>
            </div>

            {/* ---- Summary Cards ---- */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-card border border-border">
                <div className="text-2xl font-bold tabular-nums">{results.totalTests}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Total Tests</div>
              </div>
              <div className="p-4 rounded-xl bg-card border border-border">
                <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {results.passedTests}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Passed</div>
              </div>
              <div className="p-4 rounded-xl bg-card border border-border">
                <div className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                  {results.failedTests}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Failed</div>
              </div>
              <div className="p-4 rounded-xl bg-card border border-border">
                <div className="text-2xl font-bold tabular-nums">{formatDuration(results.durationMs)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Duration</div>
              </div>
            </div>

            {/* ---- Critical Failures (highlighted) ---- */}
            {results.criticalFailures.length > 0 && (
              <div className="p-5 rounded-xl bg-red-500/5 border-2 border-red-500/30 space-y-3">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <IconAlertTriangle className="w-5 h-5" />
                  <h3 className="font-semibold">
                    Critical Failures ({results.criticalFailures.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {results.criticalFailures.map((cf, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20"
                    >
                      <IconX className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                          {cf.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </p>
                        <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                          {cf.message}
                        </p>
                        {cf.suggestion && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
                            <span className="shrink-0">&#128161;</span>
                            <span>{cf.suggestion}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---- Results by Category ---- */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Results by Category</h3>
                <button
                  onClick={() => setShowCriticalFirst(!showCriticalFirst)}
                  className="text-xs px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {showCriticalFirst ? "Sort: Failures First" : "Sort: Alphabetical"}
                </button>
              </div>

              {sortedCategories.map((category) => {
                const catResults = groupedResults[category];
                const catPassed = catResults.filter((r) => r.passed).length;
                const catFailed = catResults.filter((r) => !r.passed).length;
                const isExpanded = expandedCategories.has(category);
                const catLabel =
                  TEST_CATEGORIES.find((c) => c.id === category)?.label ?? category;

                return (
                  <div
                    key={category}
                    className={`rounded-xl border bg-card overflow-hidden transition-colors ${
                      catFailed > 0 ? "border-red-500/20" : "border-border"
                    }`}
                  >
                    {/* Category header */}
                    <button
                      onClick={() => toggleExpanded(category)}
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
                    >
                      <IconChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" rotated={isExpanded} />
                      <CategoryIcon categoryId={category} className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium flex-1">{catLabel}</span>
                      {/* Mini status bar */}
                      <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1 h-2 w-24 rounded-full overflow-hidden bg-muted">
                          {catResults.length > 0 && (
                            <>
                              <div
                                className="h-full bg-emerald-500 transition-all"
                                style={{
                                  width: `${(catPassed / catResults.length) * 100}%`,
                                }}
                              />
                              <div
                                className="h-full bg-red-500 transition-all"
                                style={{
                                  width: `${(catFailed / catResults.length) * 100}%`,
                                }}
                              />
                            </>
                          )}
                        </div>
                        <span className="text-xs font-mono tabular-nums">
                          <span className="text-emerald-600 dark:text-emerald-400">{catPassed}</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-foreground">{catResults.length}</span>
                        </span>
                        {catFailed > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
                            {catFailed} failed
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Expanded results */}
                    {isExpanded && (
                      <div className="border-t border-border">
                        <div className="max-h-96 overflow-y-auto">
                          {catResults.map((result, idx) => {
                            const severity = SEVERITY_STYLES[result.severity] ?? SEVERITY_STYLES.info;
                            return (
                              <div
                                key={idx}
                                className={`flex items-start gap-3 px-4 py-3 text-sm border-b border-border/50 last:border-b-0 ${
                                  !result.passed ? "bg-red-500/[0.02] dark:bg-red-500/[0.04]" : ""
                                }`}
                              >
                                {/* Status icon */}
                                <div className="mt-0.5 shrink-0">
                                  {result.passed ? (
                                    <IconCheck className="w-4 h-4 text-emerald-500" />
                                  ) : (
                                    <IconX className="w-4 h-4 text-red-500" />
                                  )}
                                </div>

                                {/* Content */}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-sm">
                                      {result.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                    </span>
                                    <span
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${severity.bg} ${severity.text} border ${severity.border}`}
                                    >
                                      {severity.label}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5 break-words">
                                    {result.message}
                                  </p>
                                  {result.suggestion && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
                                      <span className="shrink-0">&#128161;</span>
                                      <span>{result.suggestion}</span>
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ---- Suggestions ---- */}
            {results.suggestions.length > 0 && (
              <div className="p-5 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-3">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <IconAlertTriangle className="w-5 h-5" />
                  <h3 className="font-semibold">Suggestions</h3>
                </div>
                <ul className="space-y-2">
                  {results.suggestions.map((s, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-amber-500 shrink-0 mt-0.5">&#8594;</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ================================================================ */}
        {/* Test History */}
        {/* ================================================================ */}
        {testHistory.length > 0 && (
          <section className="space-y-4">
            <h3 className="text-lg font-semibold">Recent Test Runs</h3>
            <div className="space-y-2">
              {testHistory.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:bg-muted/20 transition-colors"
                >
                  {/* Status icon */}
                  <div className="shrink-0">
                    {run.status === "passed" ? (
                      <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <IconCheck className="w-4 h-4 text-emerald-500" />
                      </div>
                    ) : run.status === "failed" ? (
                      <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                        <IconX className="w-4 h-4 text-red-500" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                        <IconAlertTriangle className="w-4 h-4 text-amber-500" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium capitalize">{run.status}</span>
                      <span className="text-xs text-muted-foreground">&#8226;</span>
                      <span className="text-xs text-muted-foreground">
                        {run.passedTests}/{run.totalTests} tests passed
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <IconClock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(run.timestamp)}
                      </span>
                    </div>
                  </div>

                  {/* Pass rate & duration */}
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold tabular-nums ${
                      run.passRate === 100
                        ? "text-emerald-600 dark:text-emerald-400"
                        : run.passRate >= 80
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                    }`}>
                      {run.passRate}%
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(run.durationMs)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ================================================================ */}
        {/* Empty State */}
        {/* ================================================================ */}
        {!results && !isRunning && !error && (
          <div className="text-center py-16 space-y-3">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-muted flex items-center justify-center">
              <IconShield className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-muted-foreground">No test results yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Select the test categories you want to run and click &quot;Run Tests&quot; to begin the QA analysis.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
