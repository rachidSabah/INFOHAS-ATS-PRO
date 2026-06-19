"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { toast } from "sonner";
import {
  PROJECT_TREE, listDirectory, searchFiles,
  executeTask, applyPatch, rollbackPatch, approvePatch, rejectPatch,
  runBuild, runTests, createStagingBranch, getCommitHistory, getBranches,
  runAutonomousDebug,
} from "@/lib/ai-builder-agent";
import type { AITask, AIWorkspacePatch, AIFile } from "@/lib/types";

type Tab =
  | "overview"
  | "repository"
  | "editor"
  | "tasks"
  | "patches"
  | "build"
  | "tests"
  | "git"
  | "rollback"
  | "debug"
  | "settings";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "LayoutDashboard" },
  { key: "repository", label: "Repository", icon: "FolderTree" },
  { key: "editor", label: "File Editor", icon: "FileCode" },
  { key: "tasks", label: "AI Tasks", icon: "ListTodo" },
  { key: "patches", label: "Patch Center", icon: "GitBranch" },
  { key: "build", label: "Build Manager", icon: "Hammer" },
  { key: "tests", label: "Test Runner", icon: "FlaskConical" },
  { key: "git", label: "Git Manager", icon: "GitBranch" },
  { key: "rollback", label: "Rollback", icon: "Undo2" },
  { key: "debug", label: "Autonomous Debug", icon: "Bug" },
  { key: "settings", label: "Settings", icon: "Settings" },
];

export function AIWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Icon name="Code2" className="w-6 h-6 text-brand" /> AI Workspace
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Full AI Builder Agent — read code, generate code, edit files, create features, validate builds, and manage patches in a staging environment.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap ${
              tab === t.key ? "bg-brand text-white" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <Icon name={t.icon} className="w-3.5 h-3.5" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "repository" && <RepositoryTab />}
      {tab === "editor" && <EditorTab />}
      {tab === "tasks" && <TasksTab />}
      {tab === "patches" && <PatchesTab />}
      {tab === "build" && <BuildTab />}
      {tab === "tests" && <TestsTab />}
      {tab === "git" && <GitTab />}
      {tab === "rollback" && <RollbackTab />}
      {tab === "debug" && <DebugTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab() {
  const tasks = useApp((s) => s.aiTasks);
  const patches = useApp((s) => s.aiPatches);
  const branches = useApp((s) => s.aiBranches);
  const rollbacks = useApp((s) => s.aiRollbacks);

  const pendingPatches = patches.filter((p) => p.status === "pending").length;
  const appliedPatches = patches.filter((p) => p.status === "applied").length;
  const activeTasks = tasks.filter((t) => !["applied", "rejected", "failed"].includes(t.status)).length;

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Tasks" value={activeTasks} icon="ListTodo" color="#3B82F6" />
        <StatCard label="Pending Patches" value={pendingPatches} icon="GitBranch" color="#F59E0B" />
        <StatCard label="Applied Patches" value={appliedPatches} icon="CheckCircle2" color="#10B981" />
        <StatCard label="Git Branches" value={branches.length} icon="GitBranch" color="#8B5CF6" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Safe Apply Workflow</CardTitle>
          <CardDescription>Every AI change goes through this pipeline before reaching production.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {["User Request", "AI Analysis", "Execution Plan", "Generate Patch", "Generate Tests", "Build Validation", "Test Validation", "Show Diff", "Approval", "Apply"].map((step, i, arr) => (
              <div key={step} className="flex items-center gap-2">
                <div className="px-3 py-1.5 rounded-md bg-secondary font-medium">{step}</div>
                {i < arr.length - 1 && <Icon name="ArrowRight" className="w-3 h-3 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet. Create one in the AI Tasks tab.</p>
            ) : (
              <div className="space-y-2">
                {tasks.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{t.title}</span>
                    <Badge variant={t.status === "applied" ? "success" : t.status === "ready" ? "brand" : "outline"} className="text-[10px] capitalize ml-2 shrink-0">{t.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Patches</CardTitle>
          </CardHeader>
          <CardContent>
            {patches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No patches yet.</p>
            ) : (
              <div className="space-y-2">
                {patches.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{p.title}</span>
                    <Badge variant={p.status === "applied" ? "success" : p.status === "pending" ? "warning" : p.status === "rejected" || p.status === "rolled_back" ? "danger" : "outline"} className="text-[10px] capitalize ml-2 shrink-0">{p.status.replace("_", " ")}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold font-display" style={{ color }}>{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
            <Icon name={icon} className="w-5 h-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Repository Explorer Tab
// ============================================================================

function RepositoryTab() {
  const [currentPath, setCurrentPath] = useState("src");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<AIFile | null>(null);

  const items = searchQuery ? searchFiles(searchQuery) : listDirectory(currentPath);

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      {/* File tree */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Icon name="FolderTree" className="w-4 h-4 text-brand" /> Repository</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="text-sm"
          />
          {!searchQuery && (
            <div className="text-xs text-muted-foreground font-mono">
              /{currentPath}
              {currentPath !== "" && (
                <button onClick={() => setCurrentPath(currentPath.split("/").slice(0, -1).join("/"))} className="ml-2 text-brand hover:underline">
                  ↑ up
                </button>
              )}
            </div>
          )}
          <div className="space-y-0.5 max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">No files found.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.path}
                  onClick={() => {
                    if (item.type === "directory") {
                      setCurrentPath(item.path);
                      setSearchQuery("");
                    } else {
                      setSelectedFile(item);
                    }
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded text-sm hover:bg-secondary text-left"
                >
                  <Icon name={item.type === "directory" ? "Folder" : "FileCode"} className={`w-3.5 h-3.5 shrink-0 ${item.type === "directory" ? "text-amber-500" : "text-blue-500"}`} />
                  <span className="truncate">{item.path.split("/").pop()}</span>
                  {item.language && <Badge variant="outline" className="text-[9px] ml-auto shrink-0">{item.language}</Badge>}
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* File preview */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Icon name="FileCode" className="w-4 h-4 text-brand" />
            {selectedFile ? selectedFile.path : "Select a file"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedFile ? (
            <div className="text-center py-12">
              <Icon name="FileCode" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground mt-2">Select a file from the repository to preview it.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">{selectedFile.language || "file"}</Badge>
                <span>{selectedFile.size || 0} bytes</span>
              </div>
              <div className="rounded-lg bg-secondary/40 p-4 text-xs font-mono overflow-auto max-h-96">
                <p className="text-muted-foreground">// File preview not available in demo mode.</p>
                <p className="text-muted-foreground">// In production, this would show the file content with syntax highlighting.</p>
                <p className="mt-2">File: {selectedFile.path}</p>
                <p>Language: {selectedFile.language}</p>
                <p>Size: {selectedFile.size} bytes</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// File Editor Tab
// ============================================================================

function EditorTab() {
  const [filePath, setFilePath] = useState("");
  const [content, setContent] = useState("");
  const [diff, setDiff] = useState("");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="FileCode" className="w-4 h-4 text-brand" /> AI File Editor</CardTitle>
          <CardDescription>Edit files with syntax highlighting, diff viewer, and AI suggestions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>File Path</Label>
            <Input value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="src/lib/ai.ts" className="mt-1 font-mono text-sm" />
          </div>
          <div>
            <Label>Content</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              className="mt-1 font-mono text-xs"
              placeholder="File content..."
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Icon name="Wand2" className="w-4 h-4" /> AI Suggestion
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDiff("// Diff viewer would show changes here")}>
              <Icon name="GitCompare" className="w-4 h-4" /> Show Diff
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Icon name="Undo2" className="w-4 h-4" /> Undo
            </Button>
          </div>
        </CardContent>
      </Card>

      {diff && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Diff Viewer</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs p-3 rounded-lg bg-secondary/40 overflow-auto max-h-80 font-mono">{diff}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// AI Tasks Tab
// ============================================================================

function TasksTab() {
  const tasks = useApp((s) => s.aiTasks);
  const addTask = useApp((s) => s.addAITask);
  const updateTask = useApp((s) => s.updateAITask);
  const addPatch = useApp((s) => s.addAIPatch);
  const log = useApp((s) => s.log);
  const user = useApp((s) => s.user);
  const [request, setRequest] = useState("");
  const [taskType, setTaskType] = useState<AITask["type"]>("feature");
  const [executing, setExecuting] = useState(false);

  const execute = async () => {
    if (request.trim().length < 10) {
      toast.error("Please describe the task (at least 10 characters).");
      return;
    }
    setExecuting(true);
    try {
      const task = await executeTask(request, taskType);
      addTask({
        title: task.title,
        description: task.description,
        type: task.type,
        status: "ready",
        request: task.request,
        plan: task.plan,
        affectedFiles: task.affectedFiles,
        generatedPatch: task.generatedPatch,
        generatedTests: task.generatedTests,
        buildResult: task.buildResult,
        testResult: task.testResult,
        createdBy: user?.email || "system",
      });

      // Also create a patch in the Patch Center
      if (task.generatedPatch) {
        addPatch({
          taskId: task.id,
          title: task.title,
          description: task.description,
          diff: task.generatedPatch,
          modifiedFiles: task.affectedFiles,
          newFiles: [],
          deletedFiles: [],
          impactAnalysis: "Generated by AI Builder Agent",
          riskAnalysis: "medium",
          status: "pending",
          buildResult: task.buildResult,
          testResult: task.testResult,
          createdBy: user?.email || "system",
        });
      }

      log({ actor: user?.email ?? "admin", action: "AI task executed", category: "admin", details: `Task: ${task.title}`, severity: "info" });
      toast.success(`Task "${task.title}" executed. Patch ready for approval.`);
      setRequest("");
    } catch (e: any) {
      toast.error(`Task failed: ${e?.message || "unknown error"}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="ListTodo" className="w-4 h-4 text-brand" /> Create AI Task</CardTitle>
          <CardDescription>Describe what you want the AI to build/fix, and it will analyze, plan, generate code, and create a patch for approval.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Task Type</Label>
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as AITask["type"])}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
            >
              <option value="feature">Feature (new functionality)</option>
              <option value="fix">Fix (bug repair)</option>
              <option value="refactor">Refactor (code improvement)</option>
              <option value="test">Test (generate tests)</option>
              <option value="migration">Migration (database change)</option>
              <option value="route">Route (new page/route)</option>
              <option value="api">API (new endpoint)</option>
              <option value="docs">Documentation</option>
            </select>
          </div>
          <Textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={4}
            placeholder="e.g. Create a Resume Templates Marketplace where users can browse and select resume templates"
          />
          <Button onClick={execute} disabled={executing} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name={executing ? "Loader2" : "Play"} className={`w-4 h-4 ${executing ? "animate-spin" : ""}`} />
            {executing ? "Executing..." : "Execute Task"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tasks ({tasks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet. Create one above.</p>
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => (
                <div key={t.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{t.title}</div>
                      <div className="text-xs text-muted-foreground">{t.description}</div>
                    </div>
                    <Badge variant={t.status === "applied" ? "success" : t.status === "ready" ? "brand" : "outline"} className="text-[10px] capitalize shrink-0">{t.status}</Badge>
                  </div>
                  {t.affectedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {t.affectedFiles.map((f) => (
                        <Badge key={f} variant="outline" className="text-[9px] font-mono">{f}</Badge>
                      ))}
                    </div>
                  )}
                  {t.buildResult && (
                    <div className="text-xs mt-2 flex items-center gap-2">
                      <Icon name={t.buildResult.success ? "CheckCircle2" : "XCircle"} className={`w-3 h-3 ${t.buildResult.success ? "text-emerald-500" : "text-red-500"}`} />
                      Build: {t.buildResult.success ? "passed" : "failed"}
                      {t.testResult && (
                        <>
                          <span className="mx-1">·</span>
                          <Icon name={t.testResult.success ? "CheckCircle2" : "XCircle"} className={`w-3 h-3 ${t.testResult.success ? "text-emerald-500" : "text-red-500"}`} />
                          Tests: {t.testResult.passed}/{t.testResult.total} passed
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Patch Center Tab
// ============================================================================

function PatchesTab() {
  const patches = useApp((s) => s.aiPatches);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected" | "applied" | "rolled_back">("all");

  const filtered = filter === "all" ? patches : patches.filter((p) => p.status === filter);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-2 flex-wrap">
          {["all", "pending", "approved", "rejected", "applied", "rolled_back"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize ${filter === f ? "bg-brand text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
            >
              {f.replace("_", " ")} ({f === "all" ? patches.length : patches.filter((p) => p.status === f).length})
            </button>
          ))}
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Icon name="GitBranch" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">No patches in this category.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => <PatchCard key={p.id} patch={p} />)}
        </div>
      )}
    </div>
  );
}

function PatchCard({ patch }: { patch: AIWorkspacePatch }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="font-medium text-sm">{patch.title}</div>
            <div className="text-xs text-muted-foreground">{patch.description}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={patch.riskAnalysis === "low" ? "success" : patch.riskAnalysis === "medium" ? "warning" : "danger"} className="text-[10px] capitalize">
              Risk: {patch.riskAnalysis}
            </Badge>
            <Badge
              variant={patch.status === "applied" ? "success" : patch.status === "pending" ? "warning" : patch.status === "rejected" || patch.status === "rolled_back" ? "danger" : "outline"}
              className="text-[10px] capitalize"
            >
              {patch.status.replace("_", " ")}
            </Badge>
          </div>
        </div>

        {patch.modifiedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {patch.modifiedFiles.map((f) => <Badge key={f} variant="warning" className="text-[9px] font-mono">M {f}</Badge>)}
            {patch.newFiles.map((f) => <Badge key={f} variant="success" className="text-[9px] font-mono">+ {f}</Badge>)}
            {patch.deletedFiles.map((f) => <Badge key={f} variant="danger" className="text-[9px] font-mono">- {f}</Badge>)}
          </div>
        )}

        <div className="flex items-center gap-2 mt-2">
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)} className="gap-1">
            <Icon name={expanded ? "ChevronUp" : "ChevronDown"} className="w-3 h-3" />
            {expanded ? "Hide" : "Show"} diff
          </Button>
          {patch.status === "pending" && (
            <>
              <Button size="sm" variant="outline" className="gap-1 text-emerald-600" onClick={() => { approvePatch(patch.id); toast.success("Patch approved"); }}>
                <Icon name="Check" className="w-3 h-3" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="gap-1 text-red-600" onClick={() => { rejectPatch(patch.id, "Rejected by admin"); toast.success("Patch rejected"); }}>
                <Icon name="X" className="w-3 h-3" /> Reject
              </Button>
            </>
          )}
          {patch.status === "approved" && (
            <Button size="sm" className="bg-brand text-white gap-1" onClick={() => { const r = applyPatch(patch.id); toast[r.success ? "success" : "error"](r.message); }}>
              <Icon name="Upload" className="w-3 h-3" /> Apply to production
            </Button>
          )}
          {patch.status === "applied" && (
            <Button size="sm" variant="outline" className="gap-1 text-amber-600" onClick={() => { const r = rollbackPatch(patch.id, "Manual rollback"); toast[r.success ? "success" : "error"](r.message); }}>
              <Icon name="Undo2" className="w-3 h-3" /> Rollback
            </Button>
          )}
        </div>

        {expanded && (
          <pre className="text-xs p-3 rounded-lg bg-secondary/40 overflow-auto max-h-64 font-mono mt-2">{patch.diff || "(empty)"}</pre>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Build Manager Tab
// ============================================================================

function BuildTab() {
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    setBuilding(true);
    try {
      const r = await runBuild();
      setResult(r);
      toast[r.success ? "success" : "error"](`Build ${r.success ? "passed" : "failed"} in ${Math.round(r.duration / 1000)}s`);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Icon name="Hammer" className="w-4 h-4 text-brand" /> Build Manager</CardTitle>
        <CardDescription>Run a build and validate the output.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={building} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name={building ? "Loader2" : "Play"} className={`w-4 h-4 ${building ? "animate-spin" : ""}`} />
          {building ? "Building..." : "Run Build"}
        </Button>
        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon name={result.success ? "CheckCircle2" : "XCircle"} className={`w-5 h-5 ${result.success ? "text-emerald-500" : "text-red-500"}`} />
              <span className="font-medium">{result.success ? "Build succeeded" : "Build failed"}</span>
              <span className="text-xs text-muted-foreground">({Math.round(result.duration / 1000)}s)</span>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                <div className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">ERRORS ({result.errors.length})</div>
                {result.errors.map((e: string, i: number) => <div key={i} className="text-xs text-red-800 dark:text-red-200 font-mono">{e}</div>)}
              </div>
            )}
            <pre className="text-xs p-3 rounded-lg bg-secondary/40 overflow-auto max-h-64 font-mono">{result.output}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Test Runner Tab
// ============================================================================

function TestsTab() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    setRunning(true);
    try {
      const r = await runTests();
      setResult(r);
      toast[r.success ? "success" : "error"](`Tests ${r.success ? "passed" : "failed"}: ${r.passed}/${r.total}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Icon name="FlaskConical" className="w-4 h-4 text-brand" /> Test Runner</CardTitle>
        <CardDescription>Run the test suite (Vitest) and view results.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={running} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name={running ? "Loader2" : "Play"} className={`w-4 h-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Running tests..." : "Run Tests"}
        </Button>
        {result && (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg bg-secondary p-2 text-center">
                <div className="text-lg font-bold text-emerald-500">{result.passed}</div>
                <div className="text-[10px] text-muted-foreground">Passed</div>
              </div>
              <div className="rounded-lg bg-secondary p-2 text-center">
                <div className="text-lg font-bold text-red-500">{result.failed}</div>
                <div className="text-[10px] text-muted-foreground">Failed</div>
              </div>
              <div className="rounded-lg bg-secondary p-2 text-center">
                <div className="text-lg font-bold text-amber-500">{result.skipped}</div>
                <div className="text-[10px] text-muted-foreground">Skipped</div>
              </div>
              <div className="rounded-lg bg-secondary p-2 text-center">
                <div className="text-lg font-bold text-blue-500">{Math.round(result.duration / 1000)}s</div>
                <div className="text-[10px] text-muted-foreground">Duration</div>
              </div>
            </div>
            {result.failures.length > 0 && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                <div className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">FAILURES</div>
                {result.failures.map((f: any, i: number) => (
                  <div key={i} className="text-xs text-red-800 dark:text-red-200 mb-1">
                    <span className="font-mono">{f.name}</span>: {f.error}
                  </div>
                ))}
              </div>
            )}
            <pre className="text-xs p-3 rounded-lg bg-secondary/40 overflow-auto max-h-64 font-mono">{result.output}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Git Manager Tab
// ============================================================================

function GitTab() {
  const branches = useApp((s) => s.aiBranches);
  const commits = useApp((s) => s.aiCommits);

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Icon name="GitBranch" className="w-4 h-4 text-brand" /> Branches ({branches.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {branches.map((b) => (
                <div key={b.name} className="flex items-center justify-between p-2 rounded-lg border border-border">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon name="GitBranch" className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-mono truncate">{b.name}</span>
                    {b.isCurrent && <Badge variant="brand" className="text-[9px]">current</Badge>}
                    {b.isStaging && <Badge variant="warning" className="text-[9px]">staging</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{b.commitCount} commits</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Icon name="GitCommit" className="w-4 h-4 text-brand" /> Commit History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {commits.map((c) => (
                <div key={c.hash} className="flex items-start gap-2 p-2 rounded-lg border border-border">
                  <Badge variant="outline" className="text-[9px] font-mono shrink-0 mt-0.5">{c.hash.slice(0, 7)}</Badge>
                  <div className="min-w-0">
                    <div className="text-sm truncate">{c.message}</div>
                    <div className="text-xs text-muted-foreground">{c.author} · {new Date(c.timestamp).toLocaleString()} · {c.filesChanged} files</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Rollback Tab
// ============================================================================

function RollbackTab() {
  const rollbacks = useApp((s) => s.aiRollbacks);
  const patches = useApp((s) => s.aiPatches);
  const appliedPatches = patches.filter((p) => p.status === "applied");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Undo2" className="w-4 h-4 text-brand" /> Rollback Manager</CardTitle>
          <CardDescription>Rollback applied patches to restore previous state.</CardDescription>
        </CardHeader>
        <CardContent>
          {appliedPatches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applied patches to rollback.</p>
          ) : (
            <div className="space-y-2">
              {appliedPatches.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                  <span className="text-sm truncate">{p.title}</span>
                  <Button size="sm" variant="outline" className="gap-1 text-amber-600" onClick={() => { const r = rollbackPatch(p.id, "Manual rollback from Rollback Manager"); toast[r.success ? "success" : "error"](r.message); }}>
                    <Icon name="Undo2" className="w-3 h-3" /> Rollback
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rollback History ({rollbacks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rollbacks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rollbacks yet.</p>
          ) : (
            <div className="space-y-2">
              {rollbacks.map((r) => (
                <div key={r.id} className="p-2 rounded-lg border border-border">
                  <div className="font-medium text-sm">{r.patchTitle}</div>
                  <div className="text-xs text-muted-foreground">Reason: {r.reason}</div>
                  <div className="text-xs text-muted-foreground">By: {r.rolledBackBy} · {new Date(r.rolledBackAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Autonomous Debug Tab
// ============================================================================

function DebugTab() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    setRunning(true);
    try {
      const r = await runAutonomousDebug();
      setResult(r);
      toast.success(`Debug scan complete: ${r.issues.length} issues found, ${r.generatedPatches.length} patches generated`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Icon name="Bug" className="w-4 h-4 text-brand" /> Autonomous Debug Mode</CardTitle>
        <CardDescription>The AI scans logs, routes, APIs, build output, and console errors — then generates fixes (requires approval before applying).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={running} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name={running ? "Loader2" : "Bug"} className={`w-4 h-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Scanning..." : "Run Debug Scan"}
        </Button>
        {result && (
          <div className="space-y-3">
            {result.issues.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-2">Issues Found ({result.issues.length})</div>
                <div className="space-y-2">
                  {result.issues.map((issue: any, i: number) => (
                    <div key={i} className="rounded-lg border border-border p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={issue.severity === "critical" || issue.severity === "error" ? "danger" : "warning"} className="text-[10px] capitalize">{issue.severity}</Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">{issue.area}</Badge>
                      </div>
                      <div className="text-sm">{issue.description}</div>
                      <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">Fix: {issue.suggestedFix}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.generatedPatches.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-2">Generated Patches ({result.generatedPatches.length})</div>
                <div className="space-y-2">
                  {result.generatedPatches.map((p: any, i: number) => (
                    <div key={i} className="rounded-lg border border-border p-2">
                      <div className="text-sm font-medium">{p.title}</div>
                      <pre className="text-xs p-2 rounded bg-secondary/40 overflow-auto max-h-40 font-mono mt-1">{p.diff}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Icon name="Settings" className="w-4 h-4 text-brand" /> AI Workspace Settings</CardTitle>
        <CardDescription>Configure the AI Builder Agent provider and model.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Provider</Label>
            <select
              value={settings.providerId}
              onChange={(e) => update({ providerId: e.target.value })}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
            >
              <option value="">Auto-select (DeepSeek first)</option>
              {providers.filter((p) => p.isActive).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Model</Label>
            <Input value={settings.modelName} onChange={(e) => update({ modelName: e.target.value })} className="mt-1 font-mono text-sm" />
          </div>
          <div>
            <Label>Temperature</Label>
            <Input type="number" step={0.1} min={0} max={2} value={settings.temperature} onChange={(e) => update({ temperature: parseFloat(e.target.value) || 0 })} className="mt-1" />
          </div>
          <div>
            <Label>Max Tokens</Label>
            <Input type="number" step={500} value={settings.maxTokens} onChange={(e) => update({ maxTokens: parseInt(e.target.value) || 8000 })} className="mt-1" />
          </div>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
          <div>
            <Label>Safe Apply Mode</Label>
            <p className="text-xs text-muted-foreground">All AI changes must go through staging + approval before production</p>
          </div>
          <Badge variant={settings.safeApplyEnabled ? "success" : "danger"}>{settings.safeApplyEnabled ? "ENABLED" : "DISABLED"}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
