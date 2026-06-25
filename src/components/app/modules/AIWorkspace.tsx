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
import {
  runDetailedDebugScan, healIssue, healMultipleIssues
} from "@/lib/autonomous-healing";
import type { AITask, AIWorkspacePatch, AIFile, AIHealingIssue } from "@/lib/types";

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
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);

  const items = searchQuery ? searchFiles(searchQuery) : listDirectory(currentPath);

  const loadFileContent = async (file: AIFile) => {
    setSelectedFile(file);
    setLoadingContent(true);
    setFileContent("");
    try {
      const { readFile } = await import("@/lib/agent-runtime");
      const content = await readFile(file.path);
      setFileContent(content.content);
    } catch (e: any) {
      setFileContent(`Error loading file: ${e?.message || "unknown"}`);
    } finally {
      setLoadingContent(false);
    }
  };

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
                      loadFileContent(item);
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
                <span>{fileContent.length} chars</span>
              </div>
              {loadingContent ? (
                <div className="flex items-center justify-center py-8">
                  <Icon name="Loader2" className="w-5 h-5 animate-spin text-brand" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading file...</span>
                </div>
              ) : (
                <pre className="rounded-lg bg-secondary/40 p-4 text-xs font-mono overflow-auto max-h-96 whitespace-pre">{fileContent || "(empty file)"}</pre>
              )}
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
            <Button variant="outline" size="sm" className="gap-2" onClick={() => {
              if (!content) { toast.info("Enter content first to see a diff."); return; }
              setDiff(`--- original\n+++ edited\n@@ -1,1 +1,1 @@\n-${filePath} (original)\n+${filePath} (edited)\n\n(Enter file path and content above, then use this to generate a patch)`);
            }}>
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
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Task Card — shows task with honest status + generated code
// ============================================================================

function TaskCard({ task }: { task: AITask }) {
  const [expanded, setExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false);

  // Parse the generated patch to extract individual files
  const generatedFiles = task.generatedPatch
    ? task.generatedPatch.split(/diff --git a\//).slice(1).map((block) => {
        const pathMatch = block.match(/^([^ ]+)/);
        const path = pathMatch ? pathMatch[1].trim() : "unknown";
        const contentMatch = block.match(/^\+\+\+ b\/[^\n]+\n@@[^\n]+\n([\s\S]*?)(?:diff --git|$)/m);
        let content = "";
        if (contentMatch) {
          content = contentMatch[1].split("\n").map((l) => l.startsWith("+") ? l.slice(1) : "").join("\n").trim();
        }
        return { path, content };
      })
    : [];

  const copyFile = (path: string, content: string) => {
    navigator.clipboard.writeText(content);
    toast.success(`Copied ${path}`);
  };

  const downloadAll = () => {
    const blob = new Blob([task.generatedPatch || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${task.title.replace(/\s+/g, "_")}.patch`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Patch file downloaded");
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{task.title}</div>
          <div className="text-xs text-muted-foreground">{task.description}</div>
        </div>
        <Badge variant={task.status === "applied" ? "success" : task.status === "ready" ? "brand" : "outline"} className="text-[10px] capitalize shrink-0">{task.status}</Badge>
      </div>

      {task.affectedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {task.affectedFiles.map((f) => (
            <Badge key={f} variant="outline" className="text-[9px] font-mono">{f}</Badge>
          ))}
        </div>
      )}

      {/* HONEST build/test status */}
      {task.buildResult && (
        <div className="mt-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2">
          <div className="text-xs flex items-center gap-2 mb-1">
            <Icon name="AlertTriangle" className="w-3 h-3 text-amber-600 shrink-0" />
            <span className="font-medium text-amber-800 dark:text-amber-200">Code generated — NOT deployed</span>
          </div>
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            This feature is <strong>not visible in the app</strong>. The AI generated code but cannot create files or run builds (browser-based app).
            To make this feature live: copy the generated files to your project, run <code className="font-mono">npm run build</code>, commit and push.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)} className="gap-1 h-7">
          <Icon name={expanded ? "ChevronUp" : "ChevronDown"} className="w-3 h-3" />
          {expanded ? "Hide" : "Show"} plan
        </Button>
        {generatedFiles.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setShowCode(!showCode)} className="gap-1 h-7">
            <Icon name="FileCode" className="w-3 h-3" />
            {showCode ? "Hide" : "Show"} generated code ({generatedFiles.length} files)
          </Button>
        )}
        {task.generatedPatch && (
          <Button size="sm" variant="ghost" onClick={downloadAll} className="gap-1 h-7">
            <Icon name="Download" className="w-3 h-3" /> Download .patch
          </Button>
        )}
      </div>

      {/* Plan */}
      {expanded && task.plan && (
        <pre className="text-xs p-2 mt-2 rounded-md bg-secondary/40 overflow-auto max-h-40 font-mono whitespace-pre-wrap">{task.plan}</pre>
      )}

      {/* Generated code files */}
      {showCode && generatedFiles.length > 0 && (
        <div className="mt-3 space-y-2">
          {generatedFiles.map((file, i) => (
            <div key={i} className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between bg-secondary/50 px-3 py-1.5">
                <span className="text-xs font-mono truncate">{file.path}</span>
                <Button size="sm" variant="ghost" onClick={() => copyFile(file.path, file.content)} className="h-6 gap-1 shrink-0">
                  <Icon name="Copy" className="w-3 h-3" /> Copy
                </Button>
              </div>
              <pre className="text-xs p-2 overflow-auto max-h-60 font-mono bg-secondary/20">{file.content || "(empty)"}</pre>
            </div>
          ))}
        </div>
      )}
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
  const issues = useApp((s) => s.aiHealingIssues);
  const setIssues = useApp((s) => s.setAIHealingIssues);
  const updateIssue = useApp((s) => s.updateAIHealingIssue);
  
  const report = useApp((s) => s.aiHealingReport);
  const setReport = useApp((s) => s.setAIHealingReport);
  
  const progress = useApp((s) => s.aiHealingProgress);
  const setProgress = useApp((s) => s.setAIHealingProgress);

  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [editingPatchId, setEditingPatchId] = useState<string | null>(null);
  const [editingPatchContent, setEditingPatchContent] = useState<string>("");

  const selectedIssue = issues.find((i) => i.id === selectedIssueId);

  const runScan = async () => {
    setProgress({ status: "scanning", currentStep: "Scanning codebase for issues...", progressPercent: 5 });
    try {
      const results = await runDetailedDebugScan();
      setIssues(results);
      setReport(null);
      if (results.length > 0) {
        setSelectedIssueId(results[0].id);
      }
      toast.success(`Scan complete! Found ${results.length} issues.`);
    } catch (e: any) {
      toast.error(`Scan failed: ${e?.message || e}`);
    } finally {
      setProgress({ status: "idle", currentStep: "", progressPercent: 0 });
    }
  };

  const runHealAll = async () => {
    if (issues.length === 0) {
      toast.warning("Please run a debug scan first.");
      return;
    }
    toast.info("Starting AI Healer Engineering Agent...");
    try {
      await healMultipleIssues(issues);
      toast.success("Healing session complete!");
    } catch (e: any) {
      toast.error(`Healing failed: ${e?.message || e}`);
    }
  };

  const runHealSelected = async () => {
    if (selectedIssueIds.length === 0) {
      toast.warning("No issues selected.");
      return;
    }
    toast.info(`Healing ${selectedIssueIds.length} selected issues...`);
    try {
      await healMultipleIssues(issues, selectedIssueIds);
      toast.success("Healing complete for selected issues!");
    } catch (e: any) {
      toast.error(`Healing failed: ${e?.message || e}`);
    }
  };

  const runGeneratePatchOnly = async () => {
    if (!selectedIssueId) {
      toast.warning("Please select an issue first.");
      return;
    }
    const target = issues.find((i) => i.id === selectedIssueId);
    if (!target) return;
    toast.info("Generating patch only (skipping validation/apply)...");
    try {
      await healIssue(target, true);
      toast.success("Patch generated!");
    } catch (e: any) {
      toast.error(`Failed to generate patch: ${e?.message || e}`);
    }
  };

  const runRollbackLastFix = () => {
    const patches = useApp.getState().aiPatches;
    const applied = patches.filter((p) => p.status === "applied" || p.status === "approved");
    if (applied.length === 0) {
      toast.info("No applied fixes found to rollback.");
      return;
    }
    const last = applied[0];
    const r = rollbackPatch(last.id, "Emergency rollback from Autonomous Debug Mode");
    if (r.success) {
      toast.success(`Successfully rolled back fix: ${last.title}`);
    } else {
      toast.error(`Rollback failed: ${r.message}`);
    }
  };

  const toggleSelectIssue = (id: string) => {
    setSelectedIssueIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleApprove = (id: string) => {
    updateIssue(id, { status: "fixed" });
    toast.success("Patch approved and committed to staging!");
  };

  const handleReject = (id: string) => {
    updateIssue(id, { status: "open", patch: undefined });
    toast.error("Patch rejected.");
  };

  const handleRollback = (id: string) => {
    updateIssue(id, { status: "open" });
    toast.info("Patch rolled back.");
  };

  const startEdit = (issue: AIHealingIssue) => {
    setEditingPatchId(issue.id);
    setEditingPatchContent(issue.patch || "");
  };

  const saveEdit = (id: string) => {
    updateIssue(id, { patch: editingPatchContent });
    setEditingPatchId(null);
    toast.success("Patch edits saved.");
  };

  const PIPELINE_STEPS = [
    { label: "Debug Scan", state: "scanning" },
    { label: "Issue Classification", state: "classifying" },
    { label: "Root Cause Analysis", state: "analyzing" },
    { label: "Generate Fix", state: "fixing" },
    { label: "Patch File", state: "fixing" },
    { label: "Type Check", state: "validating" },
    { label: "Lint", state: "validating" },
    { label: "Build", state: "validating" },
    { label: "Integration Tests", state: "validating" },
    { label: "Regression Tests", state: "validating" },
    { label: "Present Patch", state: "completed" },
    { label: "Await Approval", state: "completed" },
    { label: "Commit", state: "completed" }
  ];

  const getStepStatus = (index: number) => {
    if (progress.status === "idle") return "pending";
    const currentStepIndex = PIPELINE_STEPS.findIndex((s) => s.state === progress.status);
    if (index < currentStepIndex) return "passed";
    if (index === currentStepIndex) return "active";
    return "pending";
  };

  return (
    <div className="space-y-6">
      {/* Controls Card */}
      <Card className="bg-card border border-border shadow-md">
        <CardContent className="p-4 flex flex-wrap gap-2 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <Button onClick={runScan} disabled={progress.status !== "idle"} variant="outline" className="gap-2 border-primary text-primary hover:bg-primary/5">
              <Icon name="Play" className="w-4 h-4" /> Run Debug Scan
            </Button>
            <Button onClick={runHealAll} disabled={progress.status !== "idle" || issues.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
              <Icon name="Sparkles" className="w-4 h-4" /> Heal All Issues
            </Button>
            <Button onClick={runHealSelected} disabled={progress.status !== "idle" || selectedIssueIds.length === 0} className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
              <Icon name="CheckSquare" className="w-4 h-4" /> Heal Selected ({selectedIssueIds.length})
            </Button>
            <Button onClick={runGeneratePatchOnly} disabled={progress.status !== "idle" || !selectedIssueId} variant="secondary" className="gap-2">
              <Icon name="FileCode" className="w-4 h-4" /> Generate Patch Only
            </Button>
          </div>
          <Button onClick={runRollbackLastFix} variant="destructive" className="gap-2">
            <Icon name="Undo2" className="w-4 h-4" /> Rollback Last Fix
          </Button>
        </CardContent>
      </Card>

      {/* Healer Pipeline Stepper */}
      {progress.status !== "idle" && (
        <Card className="border border-violet-200 dark:border-violet-850 bg-violet-50/20 dark:bg-violet-950/10">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-violet-700 dark:text-violet-400">
              <Icon name="Loader2" className="w-4 h-4 animate-spin" /> Healer Execution Pipeline
            </CardTitle>
            <CardDescription className="text-xs text-violet-600/80 dark:text-violet-400/80">
              {progress.currentStep}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex flex-wrap items-center gap-1 text-[10px] sm:text-xs">
              {PIPELINE_STEPS.map((step, idx) => {
                const status = getStepStatus(idx);
                return (
                  <div key={idx} className="flex items-center gap-1">
                    <span
                      className={`px-2 py-1 rounded-md font-medium border transition-colors duration-300 ${
                        status === "passed"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-800"
                          : status === "active"
                          ? "bg-violet-600 text-white border-violet-600 animate-pulse"
                          : "bg-secondary text-muted-foreground border-border"
                      }`}
                    >
                      {step.label}
                    </span>
                    {idx < PIPELINE_STEPS.length - 1 && (
                      <Icon name="ChevronRight" className="w-3 h-3 text-muted-foreground/50" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Healing Report Summary */}
      {report && (
        <Card className="border-2 border-emerald-500 bg-emerald-500/5 overflow-hidden">
          <div className="bg-emerald-600 text-white px-4 py-2 font-display text-sm font-bold flex items-center justify-between">
            <span>Self-Heal Report Summary</span>
            <Badge variant="outline" className="text-white border-white bg-emerald-700/50">Build: {report.buildStatus}</Badge>
          </div>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-card border border-border rounded-lg text-center shadow-sm">
              <p className="text-xs text-muted-foreground mb-1">Issues Found</p>
              <p className="text-2xl font-bold font-display">{report.issuesFound}</p>
            </div>
            <div className="p-3 bg-card border border-emerald-200 dark:border-emerald-950 rounded-lg text-center shadow-sm">
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">✓ Auto Fixed</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-display">{report.autoFixed}</p>
            </div>
            <div className="p-3 bg-card border border-amber-200 dark:border-amber-950 rounded-lg text-center shadow-sm">
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">⚠ Needs Review</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 font-display">{report.needsReview}</p>
            </div>
            <div className="p-3 bg-card border border-red-200 dark:border-red-950 rounded-lg text-center shadow-sm">
              <p className="text-xs text-red-600 dark:text-red-400 mb-1">❌ Failed</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 font-display">{report.failed}</p>
            </div>
          </CardContent>
          <div className="bg-emerald-550/10 px-4 py-2 text-xs text-muted-foreground border-t border-emerald-500/10 flex justify-between">
            <span>Files Changed: <strong className="text-foreground">{report.filesChanged}</strong></span>
            <span>Tests Passed: <strong className="text-foreground">{report.testsPassed}</strong></span>
          </div>
        </Card>
      )}

      {/* Main Grid: Issues List & Patch Review */}
      <div className="grid lg:grid-cols-5 gap-6">
        {/* Issues List */}
        <Card className="lg:col-span-2 border border-border">
          <CardHeader className="py-4">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Issues Found ({issues.length})</span>
              <div className="flex items-center gap-1.5 text-xs font-normal">
                <span className="text-emerald-600 font-semibold">✓ {issues.filter(i => i.status === "fixed").length}</span>
                <span className="text-amber-600 font-semibold">⚠ {issues.filter(i => i.status === "needs_review").length}</span>
                <span className="text-red-600 font-semibold">❌ {issues.filter(i => i.status === "failed").length}</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 max-h-[600px] overflow-y-auto space-y-2">
            {issues.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <Icon name="Search" className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                Run a debug scan to inspect the repository.
              </div>
            ) : (
              issues.map((issue) => {
                const isSelected = selectedIssueId === issue.id;
                const isChecked = selectedIssueIds.includes(issue.id);
                return (
                  <div
                    key={issue.id}
                    onClick={() => setSelectedIssueId(issue.id)}
                    className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                      isSelected
                        ? "border-violet-500 bg-violet-50/10 dark:bg-violet-950/5 ring-1 ring-violet-500"
                        : "border-border hover:bg-secondary/40"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelectIssue(issue.id)}
                        className="mt-1 accent-violet-600 w-3.5 h-3.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <Badge
                            variant={
                              issue.severity === "critical" || issue.severity === "error"
                                ? "danger"
                                : issue.severity === "warning"
                                ? "warning"
                                : "outline"
                            }
                            className="text-[9px] px-1.5 py-0 capitalize"
                          >
                            {issue.severity}
                          </Badge>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 capitalize font-semibold bg-secondary/30">
                            {issue.area}
                          </Badge>
                          <span className="ml-auto">
                            {issue.status === "fixed" ? (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[9px] border-emerald-200">✓ Fixed</Badge>
                            ) : issue.status === "needs_review" ? (
                              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 text-[9px] border-amber-200">⚠ Needs Review</Badge>
                            ) : issue.status === "failed" ? (
                              <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 text-[9px] border-red-200">❌ Failed</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] text-muted-foreground border-border">Open</Badge>
                            )}
                          </span>
                        </div>
                        <h4 className="font-semibold text-sm truncate text-foreground">{issue.title}</h4>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{issue.description}</p>
                        {issue.file && (
                          <div className="text-[10px] font-mono text-muted-foreground/70 truncate mt-1">
                            {issue.file.split("/").pop()}:{issue.line}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Patch Review Panel */}
        <Card className="lg:col-span-3 border border-border">
          <CardHeader className="py-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Icon name="GitCompare" className="w-4 h-4 text-violet-600" />
              Patch Review Screen
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {!selectedIssue ? (
              <div className="text-center py-20 text-muted-foreground text-sm">
                <Icon name="GitPullRequest" className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                Select an issue to view its diagnostic data and patch details.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Meta details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-secondary/20 p-3 rounded-lg border border-border">
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase block font-semibold">File</span>
                    <a
                      href={`file:///${selectedIssue.file}`}
                      className="text-xs font-mono font-medium text-primary hover:underline truncate block"
                    >
                      {selectedIssue.file || "n/a"}
                    </a>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase block font-semibold">Issue</span>
                    <span className="text-xs font-semibold text-foreground block">{selectedIssue.title}</span>
                  </div>
                </div>

                {/* Root Cause Card */}
                {selectedIssue.rootCause && (
                  <div className="p-3 bg-secondary/10 border border-border rounded-lg">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold block mb-0.5">Root Cause</span>
                    <p className="text-xs text-foreground font-medium">{selectedIssue.rootCause}</p>
                  </div>
                )}

                {/* AI Reasoning / Confidence */}
                {selectedIssue.confidence && (
                  <div className="grid sm:grid-cols-3 gap-4 items-center">
                    <div className="sm:col-span-1 bg-secondary/30 rounded-lg p-3 text-center border border-border">
                      <span className="text-[10px] text-muted-foreground uppercase block font-semibold mb-1">AI Confidence</span>
                      <span className="text-xl font-bold text-violet-600 font-display">{selectedIssue.confidence}%</span>
                    </div>
                    <div className="sm:col-span-2 p-3 bg-violet-50/15 dark:bg-violet-950/5 border border-violet-100 dark:border-violet-900 rounded-lg text-left">
                      <span className="text-[10px] text-violet-600 dark:text-violet-400 uppercase font-semibold block mb-0.5">Reasoning</span>
                      <p className="text-xs text-muted-foreground italic font-medium">{selectedIssue.reasoning}</p>
                    </div>
                  </div>
                )}

                {/* Validation Stats */}
                {selectedIssue.patch && (
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 bg-secondary/20 rounded-md border border-border">
                      <span className="text-[10px] text-muted-foreground block uppercase font-semibold">Build</span>
                      <strong className={selectedIssue.buildStatus === "PASS" ? "text-emerald-600" : "text-red-600"}>
                        {selectedIssue.buildStatus || "PENDING"}
                      </strong>
                    </div>
                    <div className="p-2 bg-secondary/20 rounded-md border border-border">
                      <span className="text-[10px] text-muted-foreground block uppercase font-semibold">Tests</span>
                      <strong className={selectedIssue.testStatus === "PASS" ? "text-emerald-600" : "text-red-600"}>
                        {selectedIssue.testStatus || "PENDING"}
                      </strong>
                    </div>
                    <div className="p-2 bg-secondary/20 rounded-md border border-border">
                      <span className="text-[10px] text-muted-foreground block uppercase font-semibold">Risk</span>
                      <strong className={selectedIssue.risk === "LOW" ? "text-emerald-600" : selectedIssue.risk === "MEDIUM" ? "text-amber-600" : "text-red-600"}>
                        {selectedIssue.risk || "n/a"}
                      </strong>
                    </div>
                  </div>
                )}

                {/* Patch diff display */}
                {selectedIssue.patch && (
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold block mb-1">Generated Patch (Unified Diff)</span>
                    {editingPatchId === selectedIssue.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editingPatchContent}
                          onChange={(e) => setEditingPatchContent(e.target.value)}
                          rows={8}
                          className="font-mono text-xs p-3 border border-primary bg-secondary/10"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEdit(selectedIssue.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white">Save Changes</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingPatchId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <pre className="text-xs p-3 rounded-lg bg-secondary/40 border border-border overflow-auto max-h-60 font-mono text-left whitespace-pre">
                        {selectedIssue.patch.split("\n").map((line, lIdx) => {
                          const isAdd = line.startsWith("+") && !line.startsWith("+++");
                          const isDel = line.startsWith("-") && !line.startsWith("---");
                          return (
                            <span
                              key={lIdx}
                              className={isAdd ? "text-emerald-600 bg-emerald-500/5 block font-semibold" : isDel ? "text-red-600 bg-red-500/5 block font-semibold" : "block"}
                            >
                              {line}
                            </span>
                          );
                        })}
                      </pre>
                    )}
                  </div>
                )}

                {/* Patch review actions */}
                <div className="flex gap-2 flex-wrap border-t border-border pt-3 mt-3">
                  {selectedIssue.patch && editingPatchId !== selectedIssue.id && (
                    <>
                      {selectedIssue.status !== "fixed" && (
                        <Button
                          onClick={() => handleApprove(selectedIssue.id)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                        >
                          <Icon name="Check" className="w-4 h-4" /> Approve & Commit
                        </Button>
                      )}
                      <Button
                        onClick={() => handleReject(selectedIssue.id)}
                        variant="destructive"
                        className="gap-2"
                      >
                        <Icon name="X" className="w-4 h-4" /> Reject Patch
                      </Button>
                      <Button
                        onClick={() => startEdit(selectedIssue)}
                        variant="secondary"
                        className="gap-2"
                      >
                        <Icon name="Edit3" className="w-4 h-4" /> Edit Patch
                      </Button>
                      {selectedIssue.status === "fixed" && (
                        <Button
                          onClick={() => handleRollback(selectedIssue.id)}
                          className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
                        >
                          <Icon name="Undo2" className="w-4 h-4" /> Rollback patch
                        </Button>
                      )}
                    </>
                  )}
                  {!selectedIssue.patch && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 p-2 bg-secondary/20 rounded-md border border-border w-full justify-center">
                      <Icon name="AlertTriangle" className="w-4 h-4 text-amber-500" />
                      No patch generated yet. Click <strong>Heal Selected</strong> or <strong>Generate Patch Only</strong>.
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* === Interactive Debug Chat === */}
      <DebugChatSection />
    </div>
  );
}

// ============================================================================
// Interactive Debug Chat Section
// ============================================================================

function DebugChatSection() {
  const providers = useApp((s) => s.providers);
  const [messages, setMessages] = useState<{ id: string; role: "user" | "assistant" | "system"; content: string; timestamp: string; actions?: any[]; provider?: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState("");

  const activeProviders = providers.filter((p) => p.isActive);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { id: `msg_${Date.now()}`, role: "user" as const, content: input.trim(), timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const { sendDebugMessage, executeAction } = await import("@/lib/debug-chat");
      const response = await sendDebugMessage(userMsg.content, selectedProviderId || undefined);
      setMessages((prev) => [...prev, response]);
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        id: `msg_err_${Date.now()}`,
        role: "assistant" as const,
        content: `Failed: ${e?.message ?? "Unknown error"}`,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: any) => {
    try {
      const { executeAction } = await import("@/lib/debug-chat");
      const result = await executeAction(action);
      toast[result.success ? "success" : "error"](result.message);
    } catch (e: any) {
      toast.error(`Action failed: ${e?.message}`);
    }
  };

  return (
    <Card className="bg-card border border-border shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon name="MessageSquare" className="w-4 h-4 text-brand" /> Interactive Debug Chat
          <select
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="ml-auto h-7 px-2 rounded-md border border-input bg-background text-xs"
          >
            <option value="">Auto-select provider</option>
            {activeProviders.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Messages */}
        <div className="max-h-96 overflow-y-auto space-y-2 p-2 rounded-lg bg-muted/30 border border-border">
          {messages.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Type a debug command below (e.g., &quot;Fix the rendering loop&quot; or &quot;Check provider health&quot;).
              The chat uses your configured AI providers and includes live system health context.
            </p>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`text-xs ${msg.role === "user" ? "text-right" : ""}`}>
                <div className={`inline-block max-w-[85%] p-2 rounded-lg ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border"
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {msg.actions.map((action: any) => (
                        <button
                          key={action.id}
                          onClick={() => handleAction(action)}
                          className="px-2 py-1 text-[10px] font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.provider && (
                    <p className="text-[9px] text-muted-foreground mt-1">via {msg.provider}</p>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="text-center py-2">
              <Icon name="Loader2" className="w-4 h-4 animate-spin inline text-muted-foreground" />
              <span className="text-xs text-muted-foreground ml-2">Analyzing...</span>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Type a debug command..."
            disabled={loading}
            className="flex-1 text-xs h-8"
          />
          <Button onClick={sendMessage} disabled={loading || !input.trim()} size="sm" className="gap-1">
            <Icon name="Send" className="w-3 h-3" /> Send
          </Button>
        </div>
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
