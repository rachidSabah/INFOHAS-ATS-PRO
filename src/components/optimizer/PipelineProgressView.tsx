"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@/components/shared";
import type { PipelineProgress } from "@/lib/agents";

/**
 * PipelineProgress — shows real-time progress of the 5-agent optimization pipeline.
 *
 * Displays:
 *   - Current step name + number
 *   - Completion percentage (animated progress bar)
 *   - Estimated time remaining
 *   - Latest log line
 *
 * Used in the Optimizer's "optimize" step while the pipeline is running.
 */

const STEP_LABELS = [
  { name: "Analyzing Job Description", icon: "Search" },
  { name: "Calculating ATS Match", icon: "ScanText" },
  { name: "Optimizing Resume", icon: "Wand2" },
  { name: "Quality Verification", icon: "ShieldCheck" },
  { name: "Preparing Export", icon: "Download" },
];

interface PipelineProgressViewProps {
  progress: PipelineProgress | null;
  isRunning: boolean;
}

export function PipelineProgressView({ progress, isRunning }: PipelineProgressViewProps) {
  if (!isRunning && !progress) return null;

  const percent = progress?.percent ?? 0;
  const etaSeconds = progress?.etaSeconds ?? 0;
  const currentStep = progress?.stepNumber ?? 0;
  const totalSteps = progress?.totalSteps ?? 5;
  const logLine = progress?.log ?? "Starting…";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-card border border-border shadow-premium p-5 sm:p-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
          <Icon name="Loader2" className={`w-5 h-5 text-brand ${isRunning ? "animate-spin" : ""}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm sm:text-base">
            {isRunning ? "Optimization in progress" : "Optimization complete"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Step {currentStep} of {totalSteps}: {STEP_LABELS[(currentStep - 1) % STEP_LABELS.length]?.name ?? "Processing"}
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
            className="h-full bg-gradient-to-r from-brand to-brand-dark rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Step indicators */}
      <div className="grid grid-cols-5 gap-1.5 mb-4">
        {STEP_LABELS.map((step, i) => {
          const stepNum = i + 1;
          const isCompleted = currentStep > stepNum || (!isRunning && percent === 100);
          const isCurrent = currentStep === stepNum && isRunning;
          const isPending = currentStep < stepNum;
          return (
            <div
              key={i}
              className={`flex flex-col items-center gap-1 p-1.5 rounded-lg transition ${
                isCompleted ? "bg-emerald-50 dark:bg-emerald-950/20" :
                isCurrent ? "bg-brand/10" :
                "bg-secondary/40"
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  isCompleted ? "bg-emerald-500 text-white" :
                  isCurrent ? "bg-brand text-white" :
                  "bg-secondary text-muted-foreground"
                }`}
              >
                {isCompleted ? "✓" : stepNum}
              </div>
              <span className={`text-[9px] text-center leading-tight hidden sm:block ${
                isCompleted ? "text-emerald-600 dark:text-emerald-400 font-medium" :
                isCurrent ? "text-brand font-medium" :
                "text-muted-foreground"
              }`}>
                {step.name}
              </span>
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
    </motion.div>
  );
}
