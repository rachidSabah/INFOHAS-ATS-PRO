// ============================================================================
// Error Boundary — crash recovery for Builder and Optimizer
// Wraps any component, catches crashes, shows restore button
// ============================================================================
"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props { children: ReactNode; fallbackLabel?: string; }
interface State { error: Error | null; crashCount: number; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, crashCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error("[ErrorBoundary] Crashed:", error.message, info?.componentStack?.slice(0, 300));
    this.setState((s) => ({ crashCount: s.crashCount + 1 }));
  }

  handleRestore = async () => {
    const saved = localStorage.getItem("resume-builder-autosave");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const { useApp } = await import("@/lib/store");
        const state = useApp.getState();
        if (data.resumeId && data.resumeData) {
          state.updateResume(data.resumeId, data.resumeData);
        }
      } catch {}
    }
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <span className="text-2xl">⚠</span>
          </div>
          <h2 className="text-lg font-semibold mb-2">
            {this.props.fallbackLabel || "Something went wrong"}
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {this.state.error.message}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => this.setState({ error: null })}>
              Retry
            </Button>
            <Button className="bg-brand hover:bg-brand-dark text-white" onClick={this.handleRestore}>
              Restore last auto-save
            </Button>
          </div>
          {this.state.crashCount > 1 && (
            <p className="text-xs text-red-500 mt-2">
              Multiple crashes detected. Try refreshing the page or clearing browser data.
            </p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
