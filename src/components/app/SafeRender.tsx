"use client";

import { Component, ReactNode } from "react";

/**
 * SafeRender — a lightweight error boundary that catches render crashes
 * (e.g. "Cannot read properties of undefined (reading 'map')") and shows
 * a friendly fallback instead of Next.js's default "This page couldn't load"
 * error page.
 *
 * Usage:
 *   <SafeRender label="Company Intelligence">
 *     <CompanyResearch />
 *   </SafeRender>
 *
 * When a crash occurs inside the children, the fallback shows the label +
 * a Retry button that resets the boundary's internal state. The error is
 * also logged to the console so developers can diagnose it.
 */
interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  hasError: boolean;
  error?: Error;
}

export class SafeRender extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.warn(`[SafeRender${this.props.label ? `: ${this.props.label}` : ""}] Render crash:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      const label = this.props.label ?? "This section";
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 text-sm">
            <div className="font-semibold text-amber-800 dark:text-amber-200 mb-1 flex items-center gap-2">
              <span className="text-base">⚠</span> {label} couldn't render
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
              The AI returned data in an unexpected format. This is usually transient — please try again. If the problem persists, try a different resume or job description.
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-xs font-medium"
            >
              Try again
            </button>
          </div>
          {this.state.error && (
            <details className="text-[10px] text-muted-foreground">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all">{this.state.error.message}</pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
