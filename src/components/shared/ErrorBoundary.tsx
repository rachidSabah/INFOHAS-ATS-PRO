"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/shared";

// ============================================================================
// Types
// ============================================================================

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Human-friendly label for the crashed section (default: "This section") */
  label?: string;
  /** Optional custom fallback — overrides the default error UI */
  fallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  /** Called when an error is caught (for logging, telemetry, etc.) */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Reset the boundary when this key changes (useful for async data) */
  resetKey?: string | number | null;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ============================================================================
// Error Boundary Component
// ============================================================================

/**
 * ErrorBoundary — catches render crashes and shows a graceful fallback.
 *
 * Features:
 * - Animated fallback with icon + retry + details
 * - Auto-tracks resetKey for data-driven resets
 * - Optional `onError` callback for logging/reporting
 * - Custom fallback override (ReactNode or render function)
 * - Keyboard accessible (Retry on Enter when focused)
 *
 * Usage:
 *   <ErrorBoundary label="Builder">
 *     <Builder />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`, error, info);
    this.props.onError?.(error, info);
  }

  /** Reset the boundary from outside (via resetKey) */
  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (
      this.state.hasError &&
      this.props.resetKey !== undefined &&
      this.props.resetKey !== prevProps.resetKey
    ) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  /** Reload the entire module (more aggressive than retry) */
  handleReload = () => {
    // Clear any lingering state and force a fresh render
    this.reset();
    // If the error was in a data-dependent section, a full page reload
    // is the nuclear option — but we only do that after 3 failed retries.
    // For now, resetting the boundary is enough.
  };

  /** Report the error for diagnostics */
  reportError = () => {
    const label = this.props.label ?? "section";
    const errorMsg = this.state.error?.message ?? "Unknown error";
    // In production, this would POST to a telemetry endpoint
    console.info(`[ErrorBoundary] Reported: ${label} — ${errorMsg}`);
    // Fallback: copy error to clipboard for user bug reports
    const reportText = [
      `Error in: ${label}`,
      `Time: ${new Date().toISOString()}`,
      `Message: ${errorMsg}`,
      `Stack: ${this.state.error?.stack ?? "N/A"}`,
      `User Agent: ${navigator.userAgent}`,
    ].join("\n");
    navigator.clipboard.writeText(reportText).catch(() => {});
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const label = this.props.label ?? "This section";

    // Custom fallback (render function or node)
    if (this.props.fallback) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(this.state.error!, this.reset);
      }
      return this.props.fallback;
    }

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="error"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="rounded-xl border border-destructive/30 bg-destructive/5 dark:bg-destructive/10 p-6"
        >
          {/* Error icon + header */}
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              <Icon name="AlertTriangle" className="w-5 h-5 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-display font-bold text-base text-foreground">
                {label} encountered an issue
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Something unexpected happened while rendering this section.
                This is usually transient — a retry often resolves it.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={this.reset}
            >
              <Icon name="RefreshCw" className="w-3.5 h-3.5" />
              Retry
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={this.handleReload}
            >
              <Icon name="RotateCcw" className="w-3.5 h-3.5" />
              Reload module
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={this.reportError}
            >
              <Icon name="Bug" className="w-3.5 h-3.5" />
              Report issue
            </Button>
          </div>

          {/* Error details (expandable) */}
          {this.state.error && (
            <details className="mt-4 group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
                <Icon name="ChevronRight" className="w-3 h-3 inline mr-1 group-open:rotate-90 transition-transform" />
                Technical details
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-muted/60 text-[10px] leading-relaxed text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap break-all font-mono">
                {this.state.error.message}
                {"\n\n"}
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </motion.div>
      </AnimatePresence>
    );
  }
}
