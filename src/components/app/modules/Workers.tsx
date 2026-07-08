"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";

export function Workers() {
  const jobs = useApp((s) => s.backgroundJobs);
  const enqueue = useApp((s) => s.enqueueJob);
  const runQueue = useApp((s) => s.runWorkerQueue);
  const clearHistory = useApp((s) => s.clearJobHistory);

  const [running, setRunning] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string>("refresh-blueprint");
  const [jobPriority, setJobPriority] = useState<"high" | "normal" | "low">("normal");

  const queuedCount = jobs.filter((j) => j.status === "queued").length;
  const runningCount = jobs.filter((j) => j.status === "running").length;
  const successCount = jobs.filter((j) => j.status === "success").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;

  const handleEnqueue = () => {
    const payload = selectedTask === "maintenance" 
      ? { task: "refresh-stale-caches", olderThanDays: 7 } 
      : { timestamp: new Date().toISOString() };

    const jobId = enqueue(selectedTask, payload, { priority: jobPriority });
    toast.success(`Enqueued job ${jobId} successfully.`);
  };

  const handleRunQueue = async () => {
    if (queuedCount === 0) {
      toast.info("No queued jobs to process.");
      return;
    }
    setRunning(true);
    try {
      await runQueue();
      toast.success("Worker queue processed successfully.");
    } catch (e: any) {
      toast.error(e?.message || "Worker processing encountered an error.");
    } finally {
      setRunning(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "queued":
        return <Badge variant="warning" className="gap-1 flex items-center w-fit"><Icon name="Clock" className="w-3 h-3" /> Queued</Badge>;
      case "running":
        return <Badge variant="brand" className="gap-1 flex items-center w-fit"><Icon name="Loader" className="w-3 h-3 animate-spin" /> Running</Badge>;
      case "success":
        return <Badge variant="success" className="gap-1 flex items-center w-fit"><Icon name="CheckCircle" className="w-3 h-3" /> Success</Badge>;
      case "failed":
        return <Badge variant="danger" className="gap-1 flex items-center w-fit"><Icon name="AlertCircle" className="w-3 h-3" /> Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Icon name="Activity" className="w-6 h-6 text-brand" /> Orchestration & Workers
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cloudflare Queues status, task dispatching, and asynchronous background worker metrics.
        </p>
      </div>

      {/* Stats summary */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Queued Jobs", value: queuedCount, icon: "Clock", color: "#F59E0B" },
          { label: "Running Workers", value: runningCount, icon: "Loader", color: "#6366F1", animate: runningCount > 0 },
          { label: "Successful Tasks", value: successCount, icon: "CheckCircle", color: "#10B981" },
          { label: "Failed Tasks", value: failedCount, icon: "AlertTriangle", color: "#DC2626" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${s.color}15`, color: s.color }}>
                <Icon name={s.icon} className={`w-5 h-5 ${s.animate ? "animate-spin" : ""}`} />
              </div>
              <div>
                <div className="text-2xl font-bold font-display">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Controls Card */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon name="Sliders" className="w-4 h-4 text-brand" /> Task Dispatcher
            </CardTitle>
            <CardDescription>Manually push tasks to the Cloudflare Queue pipeline.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="task_type">Job Type</Label>
              <select
                id="task_type"
                value={selectedTask}
                onChange={(e) => setSelectedTask(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
              >
                <option value="refresh-blueprint">Refresh Blueprint Cache</option>
                <option value="optimize">Optimize Resume</option>
                <option value="export">PDF/Word Export Gate</option>
                <option value="maintenance">Cache & Database Maintenance</option>
                <option value="health-check">System Health Check</option>
                <option value="reindex">Reindex Search Catalog</option>
              </select>
            </div>

            <div>
              <Label htmlFor="priority">Job Priority</Label>
              <select
                id="priority"
                value={jobPriority}
                onChange={(e) => setJobPriority(e.target.value as any)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>

            <Button onClick={handleEnqueue} className="w-full gap-2">
              <Icon name="PlusCircle" className="w-4 h-4" /> Enqueue Task
            </Button>

            <div className="border-t border-border pt-4">
              <Button
                onClick={handleRunQueue}
                disabled={running || queuedCount === 0}
                className="w-full bg-brand hover:bg-brand-dark text-white gap-2"
              >
                <Icon name={running ? "Loader" : "Play"} className={`w-4 h-4 ${running ? "animate-spin" : ""}`} />
                {running ? "Processing Queue..." : `Process Queue (${queuedCount})`}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Queue History Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Icon name="History" className="w-4 h-4 text-brand" /> Queue History
                </CardTitle>
                <CardDescription>Live log of jobs registered in the queue.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={clearHistory} disabled={jobs.length === 0}>
                Clear Logs
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                <Icon name="Inbox" className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                No jobs registered in the worker history yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                      <th className="py-2">Job ID</th>
                      <th className="py-2">Type</th>
                      <th className="py-2">Priority</th>
                      <th className="py-2">Status</th>
                      <th className="py-2 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="py-3 font-mono text-xs font-semibold">{job.id}</td>
                        <td className="py-3 capitalize text-xs">{job.type.replace("-", " ")}</td>
                        <td className="py-3">
                          <Badge variant={job.priority === "high" ? "danger" : job.priority === "normal" ? "brand" : "outline"} className="text-[10px] capitalize">
                            {job.priority}
                          </Badge>
                        </td>
                        <td className="py-3">{getStatusBadge(job.status)}</td>
                        <td className="py-3 text-right font-mono text-xs">
                          {job.durationMs ? `${job.durationMs}ms` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
