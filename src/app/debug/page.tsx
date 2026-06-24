"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

// ── Types ──────────────────────────────────────────────────────────────────

interface DebugResponse {
  timestamp: string;
  runtime: "edge";
  environment: {
    nodeEnv: string | undefined;
    hasDatabase: boolean;

    providerCount: number;
    configuredProviders: string[];
  };
  silentFailureScan: {
    patterns: string[];
    note: string;
  };
  codebaseHealth: {
    catchBlockPatterns: string[];
    fallbackPatterns: string[];
    riskLevel: "low" | "medium" | "high";
  };
  providerDiagnostics: {
    serverSide: Array<{ name: string; configured: boolean; envVar: string }>;
    clientSide: string[];
    failoverChain: string;
  };
  cacheDiagnostics: {
    type: string;
    ttlMinutes: number;
    maxEntries: number;
    layers: string[];
    integrityChecks: string[];
  };
  exportDiagnostics: {
    formats: string[];
    onePageEnforcement: boolean;
    layoutModel: string;
  };
  pipelineDiagnostics: {
    version: string;
    agents: string[];
    qualityGates: number;
    reflectionTrigger: string;
  };
  selfHealingDiagnostics: {
    actions: string[];
    maxRetries: number;
    cooldownMinutes: number;
    neverFakeSuccess: boolean;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${
        ok
          ? "bg-green-500 dark:bg-green-400"
          : "bg-red-500 dark:bg-red-400"
      }`}
    />
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 text-green-500 dark:text-green-400 shrink-0 mt-0.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const cls =
    level === "low"
      ? "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-green-200 dark:border-green-800"
      : level === "medium"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800"
      : "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400 border-red-200 dark:border-red-800";

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${cls}`}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          level === "low"
            ? "bg-green-500"
            : level === "medium"
            ? "bg-amber-500"
            : "bg-red-500"
        }`}
      />
      {level.charAt(0).toUpperCase() + level.slice(1)} Risk
    </span>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function DebugDashboardPage() {
  const [data, setData] = useState<DebugResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/debug")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DebugResponse) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Loading diagnostics...
          </p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="max-w-md w-full bg-card border border-destructive/30 rounded-xl p-6">
          <h2 className="text-lg font-bold text-destructive mb-2">
            Debug endpoint unavailable
          </h2>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Debug Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              {new Date(data.timestamp).toLocaleString()}
            </p>
          </div>
          <Badge
            variant="outline"
            className="w-fit font-mono text-xs border-border"
          >
            Runtime: {data.runtime}
          </Badge>
        </div>

        <Separator />

        {/* ── Environment Card ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
              Environment
            </CardTitle>
            <CardDescription>
              Current runtime environment configuration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm text-muted-foreground">
                    Node Environment
                  </span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {data.environment.nodeEnv ?? "undefined"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm text-muted-foreground">
                    Database
                  </span>
                  <Badge
                    className={`text-xs ${
                      data.environment.hasDatabase
                        ? "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-green-200 dark:border-green-800"
                        : "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400 border-red-200 dark:border-red-800"
                    }`}
                    variant="outline"
                  >
                    {data.environment.hasDatabase ? "Connected" : "Missing"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm text-muted-foreground">
                    Provider Count
                  </span>
                  <span className="text-sm font-semibold">
                    {data.environment.providerCount}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">
                  Configured Providers
                </p>
                {data.environment.configuredProviders.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {data.environment.configuredProviders.map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className="bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400 border-green-200 dark:border-green-800"
                      >
                        {p}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No providers configured
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Provider Diagnostics Card ──────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
                />
              </svg>
              Provider Diagnostics
            </CardTitle>
            <CardDescription>
              AI provider configuration and failover status
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Server-side providers table */}
            <div>
              <p className="text-sm font-medium mb-3">Server-Side Providers</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Env Variable
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.providerDiagnostics.serverSide.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            p.configured
                              ? "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-green-200 dark:border-green-800"
                              : "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          {p.configured ? "Configured" : "Not set"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
                        {p.envVar}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Client-side providers */}
            <div>
              <p className="text-sm font-medium mb-2">Client-Side Providers</p>
              <div className="flex flex-wrap gap-2">
                {data.providerDiagnostics.clientSide.map((p) => (
                  <Badge key={p} variant="outline" className="text-xs">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Failover chain */}
            <div>
              <p className="text-sm font-medium mb-2">Failover Chain</p>
              <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                {data.providerDiagnostics.failoverChain}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Cache Diagnostics Card ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                />
              </svg>
              Cache Diagnostics
            </CardTitle>
            <CardDescription>
              Caching layer configuration and integrity checks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Type</p>
                <p className="text-sm font-medium">
                  {data.cacheDiagnostics.type}
                </p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">TTL</p>
                <p className="text-sm font-medium">
                  {data.cacheDiagnostics.ttlMinutes} min
                </p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">
                  Max Entries
                </p>
                <p className="text-sm font-medium">
                  {data.cacheDiagnostics.maxEntries}
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Cache Layers</p>
              <div className="flex flex-wrap gap-2">
                {data.cacheDiagnostics.layers.map((l) => (
                  <Badge key={l} variant="outline" className="text-xs">
                    {l}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-3">Integrity Checks</p>
              <ul className="space-y-2">
                {data.cacheDiagnostics.integrityChecks.map((check) => (
                  <li
                    key={check}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <CheckIcon />
                    <span>{check}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* ── Export Diagnostics Card ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Export Diagnostics
            </CardTitle>
            <CardDescription>
              Document export formats and layout enforcement
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-sm font-medium mb-2">Export Formats</p>
              <div className="flex flex-wrap gap-2">
                {data.exportDiagnostics.formats.map((f) => (
                  <Badge
                    key={f}
                    variant="outline"
                    className="bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400 border-green-200 dark:border-green-800 text-xs"
                  >
                    {f}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm text-muted-foreground">
                  One-Page Enforcement
                </span>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    data.exportDiagnostics.onePageEnforcement
                      ? "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-green-200 dark:border-green-800"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                  }`}
                >
                  {data.exportDiagnostics.onePageEnforcement
                    ? "Enabled"
                    : "Disabled"}
                </Badge>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">
                  Layout Model
                </p>
                <p className="text-sm font-medium">
                  {data.exportDiagnostics.layoutModel}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Pipeline Diagnostics Card ──────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
                />
              </svg>
              Pipeline Diagnostics
            </CardTitle>
            <CardDescription>
              Optimization pipeline agents and quality gates
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">
                  Pipeline Version
                </p>
                <p className="text-sm font-medium font-mono">
                  {data.pipelineDiagnostics.version}
                </p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">
                  Quality Gates
                </p>
                <p className="text-sm font-semibold">
                  {data.pipelineDiagnostics.qualityGates}
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-3">Agents</p>
              <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {data.pipelineDiagnostics.agents.map((agent, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50"
                  >
                    <span className="mt-0.5 shrink-0 w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                      {i + 1}
                    </span>
                    <span className="text-sm text-foreground">{agent}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Reflection Trigger</p>
              <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                {data.pipelineDiagnostics.reflectionTrigger}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Self-Healing Diagnostics Card ──────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
              Self-Healing Diagnostics
            </CardTitle>
            <CardDescription>
              Autonomous recovery actions and safety constraints
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-sm font-medium mb-3">Available Actions</p>
              <ul className="space-y-2">
                {data.selfHealingDiagnostics.actions.map((action, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50"
                  >
                    <StatusDot ok={!action.toLowerCase().includes("abort")} />
                    <span className="text-sm text-muted-foreground">
                      {action}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">
                  Max Retries
                </p>
                <p className="text-sm font-semibold">
                  {data.selfHealingDiagnostics.maxRetries}
                </p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">
                  Cooldown Period
                </p>
                <p className="text-sm font-semibold">
                  {data.selfHealingDiagnostics.cooldownMinutes} min
                </p>
              </div>
            </div>

            {/* Never Fake Success — prominent */}
            <div
              className={`p-4 rounded-xl border-2 ${
                data.selfHealingDiagnostics.neverFakeSuccess
                  ? "bg-green-50 border-green-300 dark:bg-green-950/20 dark:border-green-700"
                  : "bg-red-50 border-red-300 dark:bg-red-950/20 dark:border-red-700"
              }`}
            >
              <div className="flex items-center gap-3">
                {data.selfHealingDiagnostics.neverFakeSuccess ? (
                  <CheckIcon />
                ) : (
                  <svg
                    className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                )}
                <div>
                  <p
                    className={`text-sm font-bold ${
                      data.selfHealingDiagnostics.neverFakeSuccess
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-700 dark:text-red-400"
                    }`}
                  >
                    &quot;Never Fake Success&quot; Policy
                  </p>
                  <p
                    className={`text-xs mt-0.5 ${
                      data.selfHealingDiagnostics.neverFakeSuccess
                        ? "text-green-600 dark:text-green-500"
                        : "text-red-600 dark:text-red-500"
                    }`}
                  >
                    {data.selfHealingDiagnostics.neverFakeSuccess
                      ? "ENFORCED — The system will never return fabricated success responses"
                      : "WARNING — Policy not enforced; success responses may be unreliable"}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Silent Failure Scanner Card ────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              Silent Failure Scanner
            </CardTitle>
            <CardDescription>
              Patterns scanned for hidden failures
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-3">
                Patterns Being Scanned
              </p>
              <div className="space-y-2">
                {data.silentFailureScan.patterns.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
                  >
                    <svg
                      className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <code className="text-xs font-mono bg-muted/70 px-2 py-0.5 rounded text-foreground">
                      {p}
                    </code>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                <span className="font-semibold">Note:</span>{" "}
                {data.silentFailureScan.note}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Codebase Health Card ───────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              Codebase Health
            </CardTitle>
            <CardDescription>
              Static analysis results and risk assessment
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Risk Level</p>
              <RiskBadge level={data.codebaseHealth.riskLevel} />
            </div>

            <div>
              <p className="text-sm font-medium mb-3">Catch Block Patterns</p>
              <ul className="space-y-2">
                {data.codebaseHealth.catchBlockPatterns.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <StatusDot ok={!p.toLowerCase().includes("empty")} />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-sm font-medium mb-3">Fallback Patterns</p>
              <ul className="space-y-2">
                {data.codebaseHealth.fallbackPatterns.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <CheckIcon />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="text-center text-xs text-muted-foreground py-4">
          Debug Dashboard &middot; Edge Runtime &middot; Generated at{" "}
          {new Date(data.timestamp).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
