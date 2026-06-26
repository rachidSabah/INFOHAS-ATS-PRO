// ============================================================================
// Background Pipeline Runner
//
// Wraps the existing synchronous pipeline (handleOptimizationRequested) with
// async background execution, progress tracking, and toast notification.
//
// Uses setTimeout(0) to yield to the UI thread between pipeline steps, keeping
// the interface responsive during long-running optimizations. A singleton
// guard prevents double-runs.
// ============================================================================

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { handleOptimizationRequested } from "./supervisor";
import type { PipelineResult, PipelineProgress } from "./orchestrator";
import type { ResumeData, JobDescription } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Inputs for the background pipeline — mirrors what supervisor's
 * handleOptimizationRequested expects, minus the onProgress callback
 * (which we inject ourselves).
 */
export interface PipelineInputs {
  resume: ResumeData;
  jd: JobDescription;
  userDirectives?: string;
  aviationMode?: {
    airlineProfile: string;
    settings: Record<string, unknown>;
  };
  enableReflection?: boolean;
}

export interface BackgroundCallbacks {
  /** Called on every progress update from the pipeline */
  onProgress?: (progress: PipelineProgress) => void;
  /** Called when a single step finishes (step number + name) */
  onStepComplete?: (step: number, name: string) => void;
  /** Called when the pipeline completes successfully */
  onComplete?: (result: PipelineResult) => void;
  /** Called when the pipeline fails */
  onError?: (error: Error) => void;
}

export interface CancelHandle {
  cancel: () => void;
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let _isRunning = false;
let _progress: PipelineProgress | null = null;
let _abortController: AbortController | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanup(): void {
  _isRunning = false;
  _progress = null;
  _abortController = null;
}

/** Yield to the UI thread so React can flush pending state updates. */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// BackgroundPipeline singleton
// ---------------------------------------------------------------------------

/**
 * Singleton controller for running the optimization pipeline in the
 * background. All methods are static — only one pipeline can run at a time.
 *
 * Usage:
 *   const handle = BackgroundPipeline.start(inputs, {
 *     onProgress: (p) => setProgress(p),
 *     onComplete: (r) => setResult(r),
 *     onError: (e) => setError(e),
 *   });
 *   // later: handle.cancel()
 */
class BackgroundPipeline {
  /** Check if a pipeline is currently running in the background. */
  static isRunning(): boolean {
    return _isRunning;
  }

  /**
   * Start the pipeline in the background. Yields to the UI thread before
   * starting so React can flush the "running" state, and between each
   * progress callback so the progress bar re-renders promptly.
   *
   * @returns A CancelHandle that can abort the pipeline.
   */
  static start(
    inputs: PipelineInputs,
    callbacks: BackgroundCallbacks = {},
  ): CancelHandle {
    // --- Guard: prevent double-runs ---
    if (_isRunning) {
      console.warn(
        "[BackgroundPipeline] Pipeline already running — ignoring duplicate start",
      );
      return { cancel: () => {} };
    }

    _isRunning = true;
    _progress = null;

    const controller = new AbortController();
    _abortController = controller;

    // Yield to the UI thread so the "running" state renders before the
    // long synchronous pipeline work starts.
    setTimeout(async () => {
      if (controller.signal.aborted) {
        cleanup();
        return;
      }

      try {
        // Also yield once more so the initial "Starting pipeline…" UI can paint
        await yieldToUI();
        if (controller.signal.aborted) {
          cleanup();
          return;
        }

        const result = await handleOptimizationRequested({
          resume: inputs.resume,
          jd: inputs.jd,
          userDirectives: inputs.userDirectives,
          aviationMode: inputs.aviationMode,
          enableReflection: inputs.enableReflection,
          onProgress: (progress) => {
            if (controller.signal.aborted) return;
            _progress = progress;
            callbacks.onProgress?.(progress);
            callbacks.onStepComplete?.(
              progress.stepNumber,
              progress.stepName,
            );
          },
        });

        if (controller.signal.aborted) {
          cleanup();
          return;
        }

        if (result) {
          callbacks.onComplete?.(result);
          // Use setTimeout(0) for the toast so it doesn't block the UI
          // if the consumer's onComplete triggers heavy re-renders.
          setTimeout(() => {
            const delta =
              (result.afterATS?.scores.ats ?? 0) -
              (result.beforeATS?.scores.ats ?? 0);
            const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
            toast.success(
              `Optimization complete — ATS ${result.beforeATS?.scores.ats ?? "?"} → ${result.afterATS?.scores.ats ?? "?"} (${deltaStr} pts)`,
            );
          }, 0);
        } else {
          const err = new Error(
            "Optimization failed. The pipeline returned no result.",
          );
          callbacks.onError?.(err);
          setTimeout(() => toast.error(err.message), 0);
        }
      } catch (e: unknown) {
        if (controller.signal.aborted) {
          cleanup();
          return;
        }
        const err =
          e instanceof Error
            ? e
            : new Error(
                (e as Record<string, unknown>)?.message as string ??
                  "Optimization failed",
              );
        callbacks.onError?.(err);
        setTimeout(() => toast.error(err.message), 0);
      } finally {
        // Yield before cleanup so any final UI updates can flush
        await yieldToUI();
        cleanup();
      }
    }, 0);

    return {
      cancel: () => {
        controller.abort();
        cleanup();
      },
    };
  }

  /** Get the latest progress snapshot (or null if not running). */
  static getProgress(): PipelineProgress | null {
    return _progress;
  }

  /** Cancel the currently running pipeline (no-op if not running). */
  static cancel(): void {
    _abortController?.abort();
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * React hook that wraps the BackgroundPipeline singleton with local state,
 * making it easy to consume in functional components.
 *
 * @returns An object with start/cancel methods and reactive state.
 */
export function useBackgroundPipeline(): {
  start: (inputs: PipelineInputs) => void;
  cancel: () => void;
  isRunning: boolean;
  progress: PipelineProgress | null;
  result: PipelineResult | null;
  error: Error | null;
} {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const handleRef = useRef<CancelHandle | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const start = useCallback(
    (inputs: PipelineInputs) => {
      // Clear previous state
      setResult(null);
      setError(null);
      setProgress(null);
      setIsRunning(true);

      const handle = BackgroundPipeline.start(inputs, {
        onProgress: (p) => {
          if (!mountedRef.current) return;
          setProgress(p);
        },
        onComplete: (r) => {
          if (!mountedRef.current) return;
          setResult(r);
          setIsRunning(false);
        },
        onError: (e) => {
          if (!mountedRef.current) return;
          setError(e);
          setIsRunning(false);
        },
      });

      handleRef.current = handle;
    },
    [],
  );

  const cancel = useCallback(() => {
    BackgroundPipeline.cancel();
    handleRef.current = null;
    setIsRunning(false);
  }, []);

  // Cleanup on unmount — cancel any in-flight pipeline
  useEffect(() => {
    return () => {
      if (handleRef.current) {
        handleRef.current.cancel();
        handleRef.current = null;
      }
    };
  }, []);

  return { start, cancel, isRunning, progress, result, error };
}

export { BackgroundPipeline };
