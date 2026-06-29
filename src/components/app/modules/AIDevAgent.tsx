"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { toast } from "sonner";
import { fetchProviderModels, buildFallbackModelChain, describeModel, type DetectedModel } from "@/lib/provider-model-detection";
import {
  scanCode, analyzeErrors, inspectRoutes, inspectDatabase,
  scanSecurity, analyzePerformance, validateDeployment,
  generateFeature, generatePatch, generateTests,
  computeHealthDashboard,
} from "@/lib/ai-dev-agent";
import { extractJSON } from "@/lib/ai";
import type { AIDevReport, AIDevIssue, AIDevPatch, AIDevFeature } from "@/lib/types";

type Tab =
  | "overview"
  | "code-audit"
  | "error-analysis"
  | "route-inspector"
  | "database-inspector"
  | "security-scanner"
  | "performance-analyzer"
  | "feature-generator"
  | "patch-generator"
  | "test-generator"
  | "deployment-validator"
  | "audit-history"
  | "settings";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "LayoutDashboard" },
  { key: "code-audit", label: "Code Audit", icon: "FileSearch" },
  { key: "error-analysis", label: "Error Analysis", icon: "AlertCircle" },
  { key: "route-inspector", label: "Route Inspector", icon: "Route" },
  { key: "database-inspector", label: "Database Inspector", icon: "Database" },
  { key: "security-scanner", label: "Security Scanner", icon: "Shield" },
  { key: "performance-analyzer", label: "Performance Analyzer", icon: "Gauge" },
  { key: "feature-generator", label: "Feature Generator", icon: "Sparkles" },
  { key: "patch-generator", label: "Patch Generator", icon: "GitBranch" },
  { key: "test-generator", label: "Test Generator", icon: "FlaskConical" },
  { key: "deployment-validator", label: "Deployment Validator", icon: "Cloud" },
  { key: "audit-history", label: "Audit History", icon: "History" },
  { key: "settings", label: "Settings", icon: "Settings" },
];

export function AIDevAgent() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Icon name="Bot" className="w-6 h-6 text-brand" /> AI Development Agent
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Production-grade autonomous engineering assistant. Audits, debugs, tests, and generates patches using your configured AI providers.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              tab === t.key
                ? "bg-brand text-white"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <Icon name={t.icon} className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab />}
      {tab === "code-audit" && <ScanTab title="Code Audit" icon="FileSearch" scan={scanCode} reportType="code_audit" />}
      {tab === "error-analysis" && <ScanTab title="Error Analysis" icon="AlertCircle" scan={analyzeErrors} reportType="error_analysis" />}
      {tab === "route-inspector" && <ScanTab title="Route Inspector" icon="Route" scan={inspectRoutes} reportType="route_inspector" />}
      {tab === "database-inspector" && <ScanTab title="Database Inspector" icon="Database" scan={inspectDatabase} reportType="database_inspector" />}
      {tab === "security-scanner" && <ScanTab title="Security Scanner" icon="Shield" scan={scanSecurity} reportType="security_scan" />}
      {tab === "performance-analyzer" && <ScanTab title="Performance Analyzer" icon="Gauge" scan={analyzePerformance} reportType="performance" />}
      {tab === "feature-generator" && <FeatureGeneratorTab />}
      {tab === "patch-generator" && <PatchGeneratorTab />}
      {tab === "test-generator" && <TestGeneratorTab />}
      {tab === "deployment-validator" && <ScanTab title="Deployment Validator" icon="Cloud" scan={validateDeployment} reportType="deployment_validation" />}
      {tab === "audit-history" && <AuditHistoryTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

// ============================================================================
// Overview Tab — Health Dashboard
// ============================================================================

function OverviewTab() {
  const reports = useApp((s) => s.aiDevReports);
  const health = computeHealthDashboard(reports);

  const areaColors: Record<string, string> = {
    frontend: "#3B82F6",
    backend: "#8B5CF6",
    api: "#06B6D4",
    database: "#10B981",
    security: "#EF4444",
    performance: "#F59E0B",
    accessibility: "#EC4899",
  };

  return (
    <div className="space-y-6">
      {/* Overall health */}
      <Card>
        <CardContent className="p-6 flex flex-col items-center gap-4">
          <div className="text-center">
            <div className="text-sm text-muted-foreground uppercase tracking-wide mb-2">Application Health</div>
            <ScoreRing value={health.overall} size={120} />
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              Last full scan: {new Date(health.lastFullScan).toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Per-area health */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {health.checks.map((check) => (
          <Card key={check.area}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: areaColors[check.area] || "#64748B" }} />
                  <span className="font-semibold text-sm capitalize">{check.area}</span>
                </div>
                <Badge
                  variant={check.status === "healthy" ? "success" : check.status === "degraded" ? "warning" : "danger"}
                  className="text-[10px] capitalize"
                >
                  {check.status}
                </Badge>
              </div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-3xl font-bold font-display" style={{ color: areaColors[check.area] }}>
                  {check.score}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{check.details}</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                Checked: {new Date(check.lastChecked).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Run a scan or generate code</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <Button variant="outline" className="gap-2 justify-start" onClick={() => document.querySelector('[data-tab="code-audit"]')?.dispatchEvent(new Event("click"))}>
            <Icon name="FileSearch" className="w-4 h-4" /> Run Code Audit
          </Button>
          <Button variant="outline" className="gap-2 justify-start" onClick={() => {}}>
            <Icon name="Shield" className="w-4 h-4" /> Security Scan
          </Button>
          <Button variant="outline" className="gap-2 justify-start" onClick={() => {}}>
            <Icon name="Sparkles" className="w-4 h-4" /> Generate Feature
          </Button>
          <Button variant="outline" className="gap-2 justify-start" onClick={() => {}}>
            <Icon name="Cloud" className="w-4 h-4" /> Validate Deployment
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Generic Scan Tab — runs a scan and displays the report
// ============================================================================

function ScanTab({ title, icon, scan, reportType }: {
  title: string;
  icon: string;
  scan: () => Promise<AIDevReport>;
  reportType: AIDevReport["type"];
}) {
  const reports = useApp((s) => s.aiDevReports);
  const addReport = useApp((s) => s.addAIDevReport);
  const addHistory = useApp((s) => s.addAIDevHistory);
  const settings = useApp((s) => s.aiDevSettings);
  const user = useApp((s) => s.user);
  const [running, setRunning] = useState(false);
  const [currentReport, setCurrentReport] = useState<AIDevReport | null>(null);

  // Find the latest report of this type
  const latestReport = reports
    .filter((r) => r.type === reportType)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const displayReport = currentReport || latestReport;

  const runScan = async () => {
    setRunning(true);
    setCurrentReport(null);
    try {
      const report = await scan();
      addReport(report);
      addHistory({
        userId: user?.id || "unknown",
        provider: "DeepSeek",
        model: settings.modelName,
        action: reportType,
        prompt: `${title} scan`,
        response: report.summary,
        status: "success",
      });
      toast.success(`${title} completed. Found ${report.issues.length} issue(s).`);
    } catch (e: any) {
      toast.error(`Scan failed: ${e?.message || "unknown error"}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center">
              <Icon name={icon} className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-xs text-muted-foreground">
                Provider: {settings.modelName} · Auto-scan: {settings.autoScanEnabled ? "on" : "off"}
              </p>
            </div>
          </div>
          <Button onClick={runScan} disabled={running} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name={running ? "Loader2" : "Play"} className={`w-4 h-4 ${running ? "animate-spin" : ""}`} />
            {running ? "Scanning..." : "Run Scan"}
          </Button>
        </CardContent>
      </Card>

      {displayReport && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Latest Report</span>
              <span className="text-xs font-normal text-muted-foreground">
                {new Date(displayReport.createdAt).toLocaleString()}
              </span>
            </CardTitle>
            <CardDescription>{displayReport.summary}</CardDescription>
          </CardHeader>
          <CardContent>
            {displayReport.issues.length === 0 ? (
              <div className="text-center py-8">
                <Icon name="CheckCircle2" className="w-10 h-10 text-emerald-500 mx-auto" />
                <p className="text-sm text-muted-foreground mt-2">No issues found. All clear!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {displayReport.issues.map((issue, i) => (
                  <IssueCard key={issue.id || i} issue={issue} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IssueCard({ issue }: { issue: AIDevIssue }) {
  const severityColors: Record<string, string> = {
    info: "#3B82F6",
    warning: "#F59E0B",
    error: "#EF4444",
    critical: "#DC2626",
  };
  return (
    <div className="rounded-lg border border-border p-3 hover:bg-secondary/30">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: severityColors[issue.severity] }} />
          <span className="font-medium text-sm truncate">{issue.title}</span>
        </div>
        <Badge
          variant={issue.severity === "critical" || issue.severity === "error" ? "danger" : issue.severity === "warning" ? "warning" : "outline"}
          className="text-[10px] capitalize shrink-0"
        >
          {issue.severity}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-1">{issue.description}</p>
      {issue.file && (
        <div className="text-xs font-mono text-muted-foreground/80">
          {issue.file}{issue.line ? `:${issue.line}` : ""}
        </div>
      )}
      {issue.recommendedFix && (
        <div className="mt-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-2">
          <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mb-0.5">RECOMMENDED FIX</div>
          <div className="text-xs text-emerald-800 dark:text-emerald-200">{issue.recommendedFix}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Feature Generator Tab
// ============================================================================

function FeatureGeneratorTab() {
  const settings = useApp((s) => s.aiDevSettings);
  const addHistory = useApp((s) => s.addAIDevHistory);
  const user = useApp((s) => s.user);
  const [request, setRequest] = useState("");
  const [generating, setGenerating] = useState(false);
  const [feature, setFeature] = useState<AIDevFeature | null>(null);

  const generate = async () => {
    if (request.trim().length < 10) {
      toast.error("Please describe the feature you want (at least 10 characters).");
      return;
    }
    setGenerating(true);
    setFeature(null);
    try {
      const f = await generateFeature(request);
      setFeature(f);
      addHistory({
        userId: user?.id || "unknown",
        provider: "DeepSeek",
        model: settings.modelName,
        action: "feature_generation",
        prompt: request,
        response: `Generated ${f.files.length} files for "${f.title}"`,
        status: "success",
      });
      toast.success(`Generated ${f.files.length} files for "${f.title}"`);
    } catch (e: any) {
      toast.error(`Generation failed: ${e?.message || "unknown error"}`);
    } finally {
      setGenerating(false);
    }
  };

  const copyFile = (content: string, path: string) => {
    navigator.clipboard.writeText(content);
    toast.success(`Copied ${path} to clipboard`);
  };

  const downloadAll = () => {
    if (!feature) return;
    const blob = new Blob([JSON.stringify(feature, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${feature.title.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Feature downloaded as JSON");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Sparkles" className="w-4 h-4 text-brand" /> Feature Generator</CardTitle>
          <CardDescription>Describe a feature and the AI will generate UI, API, database, and test files.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={4}
            placeholder="e.g. Add LinkedIn Resume Import — allow users to import their LinkedIn profile as a resume"
          />
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-muted-foreground">
              Provider: {settings.modelName} · Safe Apply: {settings.safeApplyEnabled ? "on" : "off"}
            </p>
            <Button onClick={generate} disabled={generating} className="bg-brand hover:bg-brand-dark text-white gap-2">
              <Icon name={generating ? "Loader2" : "Wand2"} className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
              {generating ? "Generating..." : "Generate Feature"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {feature && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={downloadAll} className="gap-2">
                <Icon name="Download" className="w-4 h-4" /> Download all
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {feature.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files generated.</p>
            ) : (
              feature.files.map((f, i) => (
                <div key={i} className="rounded-lg border border-border overflow-hidden">
                  <div className="flex items-center justify-between bg-secondary/50 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="text-[10px] capitalize shrink-0">{f.type}</Badge>
                      <span className="text-xs font-mono truncate">{f.path}</span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => copyFile(f.content, f.path)} className="shrink-0 h-7 gap-1">
                      <Icon name="Copy" className="w-3 h-3" /> Copy
                    </Button>
                  </div>
                  <pre className="text-xs p-3 overflow-auto max-h-64 bg-secondary/20 font-mono">{f.content}</pre>
                </div>
              ))
            )}
            {settings.safeApplyEnabled && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-center gap-2">
                <Icon name="Shield" className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-xs text-amber-800 dark:text-amber-200">
                  Safe Apply is ON. These files must be reviewed, tested, and approved by a super admin before being applied to production.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Patch Generator Tab
// ============================================================================

function PatchGeneratorTab() {
  const settings = useApp((s) => s.aiDevSettings);
  const addHistory = useApp((s) => s.addAIDevHistory);
  const user = useApp((s) => s.user);
  const [issueDescription, setIssueDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [patch, setPatch] = useState<AIDevPatch | null>(null);

  const generate = async () => {
    if (issueDescription.trim().length < 10) {
      toast.error("Please describe the issue to fix (at least 10 characters).");
      return;
    }
    setGenerating(true);
    setPatch(null);
    try {
      const issue: AIDevIssue = {
        id: uid("iss"),
        type: "code",
        severity: "warning",
        title: "Custom issue",
        description: issueDescription,
        status: "open",
      };
      const p = await generatePatch(issue);
      setPatch(p);
      addHistory({
        userId: user?.id || "unknown",
        provider: "DeepSeek",
        model: settings.modelName,
        action: "patch_generation",
        prompt: issueDescription,
        response: p.title,
        patch: p.diff,
        status: "success",
      });
      toast.success("Patch generated successfully");
    } catch (e: any) {
      toast.error(`Generation failed: ${e?.message || "unknown error"}`);
    } finally {
      setGenerating(false);
    }
  };

  const copyDiff = () => {
    if (!patch) return;
    navigator.clipboard.writeText(patch.diff);
    toast.success("Diff copied to clipboard");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="GitBranch" className="w-4 h-4 text-brand" /> Patch Generator</CardTitle>
          <CardDescription>Describe an issue and the AI will generate a unified git diff patch + tests.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={issueDescription}
            onChange={(e) => setIssueDescription(e.target.value)}
            rows={4}
            placeholder="e.g. Fix the TypeScript error in src/lib/ai.ts line 249 — Property 'message' does not exist on type '{}'"
          />
          <Button onClick={generate} disabled={generating} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name={generating ? "Loader2" : "GitBranch"} className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating..." : "Generate Patch"}
          </Button>
        </CardContent>
      </Card>

      {patch && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-lg">{patch.title}</CardTitle>
                <CardDescription>{patch.description}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={patch.riskAnalysis === "low" ? "success" : patch.riskAnalysis === "medium" ? "warning" : "danger"} className="text-[10px] capitalize">
                  Risk: {patch.riskAnalysis}
                </Badge>
                <Button variant="outline" size="sm" onClick={copyDiff} className="gap-2">
                  <Icon name="Copy" className="w-4 h-4" /> Copy diff
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Impact analysis */}
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3">
              <div className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 mb-1">IMPACT ANALYSIS</div>
              <p className="text-xs text-blue-800 dark:text-blue-200">{patch.impactAnalysis || "No impact analysis provided."}</p>
            </div>

            {/* Files affected */}
            <div className="flex flex-wrap gap-2">
              {patch.modifiedFiles.map((f) => (
                <Badge key={f} variant="warning" className="text-[10px] font-mono">M {f}</Badge>
              ))}
              {patch.newFiles.map((f) => (
                <Badge key={f} variant="success" className="text-[10px] font-mono">+ {f}</Badge>
              ))}
              {patch.deletedFiles.map((f) => (
                <Badge key={f} variant="danger" className="text-[10px] font-mono">- {f}</Badge>
              ))}
            </div>

            {/* Diff */}
            <div>
              <div className="text-xs font-semibold mb-1">Unified Diff</div>
              <pre className="text-xs p-3 rounded-lg bg-secondary/40 overflow-auto max-h-80 font-mono">{patch.diff || "(empty)"}</pre>
            </div>

            {/* Generated tests */}
            {patch.generatedTests && (
              <div>
                <div className="text-xs font-semibold mb-1 flex items-center gap-1">
                  <Icon name="FlaskConical" className="w-3 h-3" /> Generated Tests
                </div>
                <pre className="text-xs p-3 rounded-lg bg-secondary/40 overflow-auto max-h-80 font-mono">{patch.generatedTests}</pre>
              </div>
            )}

            {settings.safeApplyEnabled && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-center gap-2">
                <Icon name="Shield" className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-xs text-amber-800 dark:text-amber-200">
                  Safe Apply: This patch must be applied to a staging branch, tested, and approved before merging to main.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Test Generator Tab
// ============================================================================

function TestGeneratorTab() {
  const settings = useApp((s) => s.aiDevSettings);
  const addHistory = useApp((s) => s.addAIDevHistory);
  const user = useApp((s) => s.user);
  const [filePath, setFilePath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [tests, setTests] = useState("");

  const generate = async () => {
    if (filePath.trim().length < 3) {
      toast.error("Please enter a file path (e.g. src/lib/ai.ts)");
      return;
    }
    setGenerating(true);
    setTests("");
    try {
      const result = await generateTests(filePath, fileContent || undefined);
      setTests(result);
      addHistory({
        userId: user?.id || "unknown",
        provider: "DeepSeek",
        model: settings.modelName,
        action: "test_generation",
        prompt: `Generate tests for ${filePath}`,
        response: result.slice(0, 200) + "...",
        status: "success",
      });
      toast.success("Tests generated");
    } catch (e: any) {
      toast.error(`Generation failed: ${e?.message || "unknown error"}`);
    } finally {
      setGenerating(false);
    }
  };

  const copyTests = () => {
    navigator.clipboard.writeText(tests);
    toast.success("Tests copied to clipboard");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="FlaskConical" className="w-4 h-4 text-brand" /> Test Generator</CardTitle>
          <CardDescription>Generate Vitest unit tests for any file. Optionally paste the file content for better results.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="filePath">File Path</Label>
            <Input id="filePath" value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="src/lib/ai.ts" className="mt-1 font-mono text-sm" />
          </div>
          <div>
            <Label htmlFor="fileContent">File Content (optional)</Label>
            <Textarea
              id="fileContent"
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              rows={6}
              placeholder="Paste the file content here for better test generation..."
              className="mt-1 font-mono text-xs"
            />
          </div>
          <Button onClick={generate} disabled={generating} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name={generating ? "Loader2" : "FlaskConical"} className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating..." : "Generate Tests"}
          </Button>
        </CardContent>
      </Card>

      {tests && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Generated Tests</CardTitle>
              <Button variant="outline" size="sm" onClick={copyTests} className="gap-2">
                <Icon name="Copy" className="w-4 h-4" /> Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-xs p-3 rounded-lg bg-secondary/40 overflow-auto max-h-96 font-mono">{tests}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Audit History Tab
// ============================================================================

function AuditHistoryTab() {
  const history = useApp((s) => s.aiDevHistory);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Icon name="History" className="w-4 h-4 text-brand" /> Audit History</CardTitle>
        <CardDescription>All AI Dev Agent actions — scans, audits, patches, approvals.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <div className="text-center py-8">
            <Icon name="History" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">No history yet. Run a scan to see entries here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="rounded-lg border border-border p-3 hover:bg-secondary/30">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px] capitalize shrink-0">{h.action.replace(/_/g, " ")}</Badge>
                    <span className="text-sm font-medium truncate">{h.response.slice(0, 100)}{h.response.length > 100 ? "..." : ""}</span>
                  </div>
                  <Badge
                    variant={h.status === "success" || h.status === "approved" ? "success" : h.status === "failed" || h.status === "rejected" ? "danger" : "warning"}
                    className="text-[10px] capitalize shrink-0"
                  >
                    {h.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                  <span>{h.provider} / {h.model}</span>
                  <span>·</span>
                  <span>{new Date(h.createdAt).toLocaleString()}</span>
                </div>
                {h.prompt && (
                  <div className="text-xs text-muted-foreground/80 mt-1 italic">"{h.prompt}"</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Settings Tab
// ============================================================================

function SettingsTab() {
  const settings = useApp((s) => s.aiDevSettings);
  const update = useApp((s) => s.updateAIDevSettings);
  const providers = useApp((s) => s.providers);
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const [detectedModels, setDetectedModels] = useState<DetectedModel[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectionSource, setDetectionSource] = useState<string>("");

  const patch = (p: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  const save = () => {
    update(draft);
    setDirty(false);
    toast.success("AI Dev Agent settings saved.");
  };

  const activeProviders = providers.filter((p) => p.isActive);

  const selectedProvider = providers.find((p) => p.id === draft.providerId) || activeProviders[0];
  const fallbackProvider = providers.find((p) => p.id === draft.fallbackProviderId);

  useEffect(() => {
    if (selectedProvider) {
      const fetchModels = async () => {
        try {
          const result = await fetchProviderModels(selectedProvider);
          if (result.models.length > 0) {
            setDetectedModels(result.models);
            setDetectionSource(result.source);
            // Update the store with fresh models
            useApp.getState().updateProvider(selectedProvider.id, {
              enabledModels: result.models.map((m) => m.id),
              status: result.source === "api" ? "healthy" : "degraded",
            });
            return;
          }
        } catch {
          // fall through to configured models
        }
        // Fallback: use configured enabledModels
        const fallback = selectedProvider.enabledModels || [];
        if (fallback.length > 0) {
          setDetectedModels(fallback.map((id) => ({ id, name: id, supportsStreaming: true })));
          setDetectionSource("configured");
        } else {
          setDetectedModels([]);
          setDetectionSource("");
        }
      };
      fetchModels();
    } else {
      setDetectedModels([]);
      setDetectionSource("");
    }
  }, [draft.providerId]);

  // === Model Detection ===
  const detectModels = async () => {
    if (activeProviders.length === 0) {
      toast.error("No active providers configured.");
      return;
    }

    setDetecting(true);
    try {
      const results = await Promise.allSettled(
        activeProviders.map(async (provider) => {
          const result = await fetchProviderModels(provider);
          return { provider, result };
        })
      );

      const allDetectedModels: DetectedModel[] = [];
      let successCount = 0;
      let apiSourceCount = 0;

      for (const r of results) {
        if (r.status === "fulfilled") {
          const { provider, result } = r.value;
          if (result.models.length > 0) {
            // Update the provider's enabledModels — use "degraded" if source is not live API
            useApp.getState().updateProvider(provider.id, {
              enabledModels: result.models.map((m) => m.id),
              status: result.source === "api" ? "healthy" : "degraded",
            });
            successCount++;
            if (result.source === "api") {
              apiSourceCount++;
            }
            // If this is the currently selected provider, populate local state for preview lists
            if (provider.id === (draft.providerId || activeProviders[0]?.id)) {
              setDetectedModels(result.models);
              setDetectionSource(result.source);
            }
            allDetectedModels.push(...result.models);
          }
        }
      }

      toast.success(
        `Discovered models across ${successCount}/${activeProviders.length} active providers (${apiSourceCount} via live APIs). ${activeProviders.length - apiSourceCount - (activeProviders.length - successCount)} providers using saved config.`
      );

      // Auto-select primary model name if missing
      if (allDetectedModels.length > 0 && !draft.modelName) {
        patch({ modelName: allDetectedModels[0].id });
      }
    } catch (e: any) {
      toast.error(`Model detection failed: ${e?.message || e}`);
    } finally {
      setDetecting(false);
    }
  };

  // === Auto-build fallback chain from detected models ===
  const autoBuildFallback = () => {
    if (detectedModels.length === 0) {
      toast.error("No models detected. Click 'Detect Models' first.");
      return;
    }
    if (!draft.modelName) {
      toast.error("No primary model selected. Select a model first.");
      return;
    }
    const fallbacks = buildFallbackModelChain(detectedModels, draft.modelName, 5);
    if (fallbacks.length === 0) {
      toast.info("No fallback models available (only one model detected).");
      return;
    }
    // Set the first fallback as the fallback model
    patch({
      fallbackProviderId: draft.providerId || activeProviders[0]?.id || "",
      fallbackModel: fallbacks[0].id,
    });
    toast.success(`Fallback model set to "${fallbacks[0].id}" (${fallbacks.length - 1} more available).`);
  };

  return (
    <div className="space-y-4">
      {/* Provider settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Cpu" className="w-4 h-4 text-brand" /> Provider</CardTitle>
          <CardDescription>Select the AI provider and model for the agent. Default: DeepSeek V4 Flash via OpenCode-compatible API.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Primary Provider</Label>
              <select
                value={draft.providerId}
                onChange={(e) => {
                  patch({ providerId: e.target.value });
                  setDetectedModels([]); // clear detected models when provider changes
                  setDetectionSource("");
                }}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
              >
                <option value="">Auto-select (DeepSeek first)</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.type}){!p.isActive ? " (inactive)" : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Model Name</Label>
              <div className="flex gap-2 mt-1">
                <Input value={draft.modelName} onChange={(e) => patch({ modelName: e.target.value })} className="font-mono text-sm flex-1" placeholder="deepseek-v4-flash" />
                {detectedModels.length > 0 && (
                  <select
                    value={draft.modelName}
                    onChange={(e) => patch({ modelName: e.target.value })}
                    className="h-9 px-2 rounded-md border border-input bg-background text-xs"
                    title="Select from detected models"
                  >
                    <option value="">(detected)</option>
                    {detectedModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.id}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* Model Detection Section */}
          <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="flex items-center gap-2">
                  <Icon name="Search" className="w-4 h-4" /> Model Detection
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fetch all available models from the provider's API. Detected models can be used for automatic fallback.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={detectModels} disabled={detecting} className="gap-2">
                  <Icon name={detecting ? "Loader" : "Search"} className={`w-4 h-4 ${detecting ? "animate-spin" : ""}`} />
                  {detecting ? "Detecting..." : "Detect Models"}
                </Button>
                <Button variant="outline" size="sm" onClick={autoBuildFallback} disabled={detectedModels.length === 0 || !draft.modelName} className="gap-2">
                  <Icon name="Shuffle" className="w-4 h-4" /> Auto-Build Fallback
                </Button>
              </div>
            </div>

            {detectionSource && (
              <div className="flex items-center gap-2">
                <Badge variant={detectionSource === "api" ? "success" : "warning"} className="text-[10px]">
                  {detectionSource === "api" ? "FROM API" : "FROM CONFIG"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {detectedModels.length} model(s) detected
                </span>
              </div>
            )}

            {detectedModels.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background">
                {detectedModels.map((model) => (
                  <div
                    key={model.id}
                    className={`flex items-center justify-between p-2 border-b border-border last:border-0 cursor-pointer hover:bg-secondary/30 ${
                      draft.modelName === model.id ? "bg-brand/5" : ""
                    }`}
                    onClick={() => patch({ modelName: model.id })}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono truncate">{model.id}</span>
                        {draft.modelName === model.id && (
                          <Badge variant="brand" className="text-[9px]">SELECTED</Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {describeModel(model)}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {model.supportsReasoning && <Badge variant="outline" className="text-[9px]">REASONING</Badge>}
                      {model.supportsVision && <Badge variant="outline" className="text-[9px]">VISION</Badge>}
                      {model.supportsToolCalling && <Badge variant="outline" className="text-[9px]">TOOLS</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fallback settings */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Fallback Provider</Label>
              <select
                value={draft.fallbackProviderId}
                onChange={(e) => patch({ fallbackProviderId: e.target.value })}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
              >
                <option value="">None</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type}){!p.isActive ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Fallback Model</Label>
              <div className="flex gap-2 mt-1">
                <Input value={draft.fallbackModel} onChange={(e) => patch({ fallbackModel: e.target.value })} className="font-mono text-sm flex-1" placeholder="gpt-4o-mini" />
                {fallbackProvider && fallbackProvider.enabledModels && fallbackProvider.enabledModels.length > 0 && (
                  <select
                    value={draft.fallbackModel}
                    onChange={(e) => patch({ fallbackModel: e.target.value })}
                    className="h-9 px-2 rounded-md border border-input bg-background text-xs"
                    title="Select fallback from fallback provider's models"
                  >
                    <option value="">(detected)</option>
                    {fallbackProvider.enabledModels
                      .filter((id) => id !== draft.modelName)
                      .map((id) => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generation parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Sliders" className="w-4 h-4 text-brand" /> Generation Parameters</CardTitle>
          <CardDescription>Control how the AI generates responses.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <Label>Temperature</Label>
            <Input type="number" step={0.1} min={0} max={2} value={draft.temperature} onChange={(e) => patch({ temperature: parseFloat(e.target.value) || 0 })} className="mt-1" />
          </div>
          <div>
            <Label>Max Tokens</Label>
            <Input type="number" step={500} min={1000} max={32000} value={draft.maxTokens} onChange={(e) => patch({ maxTokens: parseInt(e.target.value) || 8000 })} className="mt-1" />
          </div>
          <div>
            <Label>Timeout (seconds)</Label>
            <Input type="number" step={5} min={10} max={300} value={draft.timeout} onChange={(e) => patch({ timeout: parseInt(e.target.value) || 60 })} className="mt-1" />
          </div>
          <div>
            <Label>Reasoning Level</Label>
            <select
              value={draft.reasoningLevel}
              onChange={(e) => patch({ reasoningLevel: e.target.value as any })}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
            >
              <option value="none">None</option>
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Streaming</Label>
              <p className="text-xs text-muted-foreground">Stream responses in real-time</p>
            </div>
            <Switch checked={draft.streaming} onCheckedChange={(v) => patch({ streaming: v })} />
          </div>
        </CardContent>
      </Card>

      {/* System prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Brain" className="w-4 h-4 text-brand" /> System Prompt</CardTitle>
          <CardDescription>The base prompt sent to the AI for every Dev Agent call.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={draft.systemPrompt}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
            rows={10}
            className="font-mono text-xs"
          />
        </CardContent>
      </Card>

      {/* Safety settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Shield" className="w-4 h-4 text-brand" /> Safety & Automation</CardTitle>
          <CardDescription>Control how the agent applies changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Safe Apply Enabled</Label>
              <p className="text-xs text-muted-foreground">Require staging + approval before applying changes to production</p>
            </div>
            <Switch checked={draft.safeApplyEnabled} onCheckedChange={(v) => patch({ safeApplyEnabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Require Approval Enabled</Label>
              <p className="text-xs text-muted-foreground">Require super admin approval for file modifications, migrations, route changes</p>
            </div>
            <Switch checked={draft.requireApprovalEnabled} onCheckedChange={(v) => patch({ requireApprovalEnabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto Scan Enabled</Label>
              <p className="text-xs text-muted-foreground">Run scheduled audits automatically (daily/weekly/monthly)</p>
            </div>
            <Switch checked={draft.autoScanEnabled} onCheckedChange={(v) => patch({ autoScanEnabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto Report Enabled</Label>
              <p className="text-xs text-muted-foreground">Generate health/security/performance reports automatically</p>
            </div>
            <Switch checked={draft.autoReportEnabled} onCheckedChange={(v) => patch({ autoReportEnabled: v })} />
          </div>
        </CardContent>
      </Card>

      {/* Active Providers Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Layers" className="w-4 h-4 text-brand" /> Active Providers Status
          </CardTitle>
          <CardDescription>
            Live status, model counts, and health of all configured AI providers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase font-medium">
                  <th className="py-2 px-3">Provider</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Detected Models</th>
                  <th className="py-2 px-3">Default Model</th>
                  <th className="py-2 px-3">Health</th>
                  <th className="py-2 px-3">Fallback Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeProviders.map((p) => {
                  const fallbackChain = useApp.getState().fallbackChain;
                  const chainEntries = fallbackChain?.entries || [];
                  const positionIdx = chainEntries.findIndex((e) => e.providerId === p.id && e.enabled);
                  const fallbackPos = positionIdx >= 0 ? `#${positionIdx + 1}` : "Not in chain";
                  const detectedCount = p.enabledModels?.length || 0;

                  return (
                    <tr key={p.id} className="hover:bg-secondary/10">
                      <td className="py-2.5 px-3 font-medium">{p.name}</td>
                      <td className="py-2.5 px-3 font-mono text-xs">{p.type}</td>
                      <td className="py-2.5 px-3">
                        <Badge variant={p.isActive ? "success" : "default"}>
                          {p.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 font-medium">
                        {detectedCount} models
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs max-w-[150px] truncate" title={p.modelName}>
                        {p.modelName || "(none)"}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="flex items-center gap-1">
                          <span className={`w-2 h-2 rounded-full ${p.status === "healthy" ? "bg-emerald-500" : p.status === "degraded" ? "bg-amber-500" : "bg-rose-500"}`} />
                          <span className="capitalize">{p.status || "untested"}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge variant={positionIdx >= 0 ? "outline" : "default"}>
                          {fallbackPos}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Save bar */}
      {dirty && (
        <div className="sticky bottom-4 z-10">
          <Card className="bg-brand text-white border-brand shadow-premium">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <span className="text-sm font-medium flex items-center gap-2">
                <Icon name="AlertTriangle" className="w-4 h-4" /> You have unsaved changes
              </span>
              <Button size="sm" onClick={save} className="bg-white text-brand hover:bg-white/90 gap-2">
                <Icon name="Save" className="w-4 h-4" /> Save settings
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
