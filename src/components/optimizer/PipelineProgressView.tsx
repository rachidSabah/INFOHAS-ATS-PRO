"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@/components/shared";
import type { PipelineProgress, PipelineResult, PipelineStep } from "@/lib/agents";

/**
 * PipelineProgressView — shows real-time progress of the 7-step optimization pipeline.
 *
 * 7 steps (per spec):
 *   Step 1: Parsing Resume        (happens before pipeline — shown as instant)
 *   Step 2: Job Analysis          (Job Intelligence Agent)
 *   Step 3: ATS Analysis          (ATS Analysis Agent — before)
 *   Step 4: Resume Optimization   (Resume Optimizer Agent)
 *   Step 5: Quality Assurance     (QA Agent)
 *   Step 6: Reflection            (optional — Reflection Agent)
 *   Step 7: Export Preparation    (final step — preparing export)
 *
 * Each step shows:
 *   - status (pending / running / completed / failed / skipped)
 *   - loading state (spinner)
 *   - success state (✓ green)
 *   - error state (✗ red + error message)
 *   - execution time (seconds)
 */

interface PipelineProgressViewProps {
  progress: PipelineProgress | null;
  isRunning: boolean;
  /** The final pipeline result (passed when pipeline completes — enables per-step status display) */
  result?: PipelineResult | null;
  /** Error message if the pipeline failed (for retry UI) */
  error?: string | null;
  /** Retry callback */
  onRetry?: () => void;
}

// 8 steps per V2 spec — step 1 (Parsing) + step 8 (Export Prep) wrap the
// 6-agent pipeline (Job Intel, Company+SkillGap parallel, ATS, Optimizer, QA, Reflection).
const ALL_STEPS = [
  { id: 0, name: "Parsing Resume", icon: "FileText", agent: "parser" },
  { id: 1, name: "Job Intelligence", icon: "Search", agent: "Job Intelligence" },
  { id: 2, name: "Company + Skill Gap", icon: "Building2", agent: "Company + Skill Gap (parallel)" },
  { id: 3, name: "ATS Analysis", icon: "ScanText", agent: "ATS Analysis (Before)" },
  { id: 4, name: "Resume Optimization", icon: "Wand2", agent: "Resume Optimizer" },
  { id: 5, name: "Quality Assurance", icon: "ShieldCheck", agent: "Quality Assurance" },
  { id: 6, name: "Reflection", icon: "Brain", agent: "Reflection" },
  { id: 7, name: "Export Preparation", icon: "Download", agent: "Export" },
];

export function PipelineProgressView({ progress, isRunning, result, error, onRetry }: PipelineProgressViewProps) {
  if (!isRunning && !progress && !result && !error) return null;

  const percent = progress?.percent ?? (result ? 100 : 0);
  const etaSeconds = progress?.etaSeconds ?? 0;
  const currentStep = progress?.stepNumber ?? 0;
  const logLine = progress?.log ?? (error ? `Error: ${error}` : "Starting…");

  // Map the orchestrator's 6 agent steps to our 8-step display.
  // Orchestrator step indices: 0=JI, 1=Company+SkillGap, 2=ATS-before, 3=Optimizer, 4=QA, 5=Reflection
  // Our display: 0=Parsing, 1=JI, 2=Company+SkillGap, 3=ATS, 4=Optim, 5=QA, 6=Reflection, 7=Export
  const getStepStatus = (displayStepIndex: number): PipelineStep["status"] => {
    if (result) {
      // Pipeline complete — derive status from the result
      if (displayStepIndex === 0) return "completed"; // Parsing always done
      if (displayStepIndex === 7) return "completed"; // Export prep done
      const agentStep = result.steps[displayStepIndex - 1];
      return agentStep?.status ?? "skipped";
    }
    if (!isRunning) return "pending";
    // Map current progress step to display step
    // Orchestrator stepNumber is 1-based: 1=JI, 2=Company+SkillGap, 3=ATS, 4=Optim, 5=QA, 6=Reflection
    // Display step: 1=Parsing(done first), 2=JI, 3=Company+SkillGap, 4=ATS, 5=Optim, 6=QA, 7=Reflection, 8=Export
    if (displayStepIndex === 0) return "completed"; // Parsing done before pipeline
    if (displayStepIndex === 7) return "pending"; // Export prep not started
    const agentStepIndex = displayStepIndex - 1; // 0=JI, 1=Company+SkillGap, 2=ATS, 3=Optim, 4=QA, 5=Reflection
    const orchestratorStepNumber = currentStep; // 1-based from orchestrator
    if (agentStepIndex < orchestratorStepNumber - 1) return "completed";
    if (agentStepIndex === orchestratorStepNumber - 1) return "running";
    return "pending";
  };

  const getStepDuration = (displayStepIndex: number): number | undefined => {
    if (!result) return undefined;
    if (displayStepIndex === 0 || displayStepIndex === 7) return undefined;
    const agentStep = result.steps[displayStepIndex - 1];
    return agentStep?.durationMs;
  };

  const getStepError = (displayStepIndex: number): string | undefined => {
    if (!result) return undefined;
    if (displayStepIndex === 0 || displayStepIndex === 7) return undefined;
    const agentStep = result.steps[displayStepIndex - 1];
    return agentStep?.error;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-card border border-border shadow-premium p-5 sm:p-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${error ? "bg-red-100 dark:bg-red-950/30" : isRunning ? "bg-brand/10" : "bg-emerald-100 dark:bg-emerald-950/30"}`}>
          <Icon
            name={error ? "AlertCircle" : isRunning ? "Loader2" : "CheckCircle2"}
            className={`w-5 h-5 ${error ? "text-red-600" : isRunning ? "text-brand animate-spin" : "text-emerald-600"}`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm sm:text-base">
            {error ? "Optimization failed" : isRunning ? "Optimization in progress" : result ? "Optimization complete" : "Starting…"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {error ? "An error occurred — you can retry" : isRunning ? `Step ${Math.min(currentStep + 1, 8)} of 8: ${ALL_STEPS[Math.min(currentStep, 7)]?.name ?? "Processing"}` : "Pipeline finished"}
          </p>
        </div>
        {isRunning && etaSeconds > 0 && (
          <div className="text-right shrink-0">
            <div className="text-xs font-semibold text-brand">{etaSeconds}s</div>
            <div className="text-[10px] text-muted-foreground">est. remaining</div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="font-medium text-muted-foreground">Progress</span>
          <span className="font-bold text-foreground">{percent}%</span>
        </div>
        <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${error ? "bg-red-500" : "bg-gradient-to-r from-brand to-brand-dark"}`}
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* 7-step list with full status per step */}
      <div className="space-y-1.5 mb-4">
        {ALL_STEPS.map((step, i) => {
          const status = getStepStatus(i);
          const durationMs = getStepDuration(i);
          const stepError = getStepError(i);
          const isOptional = i === 5; // Reflection is optional

          return (
            <div
              key={i}
              className={`flex items-center gap-2.5 p-2 rounded-lg transition ${
                status === "running" ? "bg-brand/10 border border-brand/30" :
                status === "completed" ? "bg-emerald-50 dark:bg-emerald-950/15" :
                status === "failed" ? "bg-red-50 dark:bg-red-950/15 border border-red-200 dark:border-red-900" :
                status === "skipped" ? "bg-secondary/30 opacity-60" :
                "bg-secondary/40"
              }`}
            >
              {/* Status icon */}
              <div className="shrink-0">
                {status === "running" && <Icon name="Loader2" className="w-4 h-4 text-brand animate-spin" />}
                {status === "completed" && <Icon name="CheckCircle2" className="w-4 h-4 text-emerald-600" />}
                {status === "failed" && <Icon name="XCircle" className="w-4 h-4 text-red-600" />}
                {status === "skipped" && <Icon name="Minus" className="w-4 h-4 text-muted-foreground" />}
                {status === "pending" && (
                  <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
                    <span className="text-[8px] text-muted-foreground">{i + 1}</span>
                  </div>
                )}
              </div>

              {/* Step name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-medium ${status === "failed" ? "text-red-700 dark:text-red-400" : status === "completed" ? "text-emerald-700 dark:text-emerald-400" : status === "running" ? "text-brand" : "text-muted-foreground"}`}>
                    {step.name}
                  </span>
                  {isOptional && status === "pending" && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">optional</span>
                  )}
                  {isOptional && status === "skipped" && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">skipped</span>
                  )}
                </div>
                {stepError && (
                  <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 truncate">{stepError}</div>
                )}
              </div>

              {/* Execution time */}
              {durationMs !== undefined && (
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  {(durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Live log line */}
      <div className="rounded-lg bg-secondary/60 p-2.5 flex items-start gap-2">
        <Icon name="Terminal" className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <AnimatePresence mode="wait">
          <motion.p
            key={logLine}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="text-xs font-mono text-muted-foreground break-words"
          >
            {logLine}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Error + retry */}
      {error && onRetry && (
        <div className="mt-3 flex items-center justify-between gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="AlertTriangle" className="w-4 h-4 text-red-600 shrink-0" />
            <span className="text-xs text-red-700 dark:text-red-400 truncate">{error}</span>
          </div>
          <button
            onClick={onRetry}
            className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-md flex items-center gap-1.5 shrink-0"
          >
            <Icon name="RotateCcw" className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}
    </motion.div>
  );
}
