"use client";

// ============================================================================
// Shared unsaved-changes affordances for Super Admin panels.
//
// Every editable admin surface must tell the admin when the in-memory state
// differs from the last CONFIRMED save (the explicit Save button). This uses
// the same amber treatment as OptimizerDirective / FallbackChain /
// PersonaManagement / AgentConfigCenter so the behavior is identical
// everywhere: edit -> amber indicator appears -> Save -> indicator clears.
//
// The explicit Save buttons on the batch panels (Providers / Models / Prompts /
// Flags / Branding) intentionally stay enabled even when the indicator is
// hidden: they double as a repair/confirm path for the store's fire-and-forget
// per-edit sync, which can silently fail offline.
// ============================================================================

import { Icon } from "@/components/shared";

export function UnsavedBanner({
  saveLabel,
  children,
}: {
  /** Label of the button that commits the change, e.g. "Save branding". */
  saveLabel?: string;
  /** Custom message overrides the default "unsaved changes" wording. */
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="unsaved-banner"
      className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-center gap-2"
      role="status"
    >
      <Icon name="AlertTriangle" className="w-4 h-4 text-amber-600 shrink-0" />
      <span className="text-sm text-amber-800 dark:text-amber-200">
        {children ?? (
          <>
            You have unsaved changes. Click &quot;{saveLabel}&quot; to apply them.
          </>
        )}
      </span>
    </div>
  );
}
