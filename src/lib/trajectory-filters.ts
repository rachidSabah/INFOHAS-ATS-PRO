// ============================================================================
// Trajectory Filters — pure filtering/summarizing layer for the pipeline
// trajectory panel (Task 19, S2 polish).
//
// Task 18 (S2) made the router emit structured skip_provider events on the
// global event bus: { reason: "cooldown" | "provider_busy", layer, class,
// remainingMs, inFlight, waitedMs, cap }. Those events carry success: false,
// which the panel's generic chip logic rendered as FAILED — indistinguishable
// from real agent failures and mixed into the failure-rate story.
//
// This module gives the panel a dedicated SKIP view:
//   - skips are NOT failures: they mean "routed elsewhere on purpose"
//   - filterTrajectory: all / skips / failures views
//   - summarizeSkips: per-reason counts for the filter header
//   - describeSkipReason: one-line human explanation per skip event
//
// Kept pure (no React, no DOM) so it is unit-testable under the node vitest
// environment, mirroring the lib-level pattern used across this repo.
// ============================================================================

import type { AgentEvent } from "./agent-event-bus";

/** Panel views. "skips" isolates router skip events; "failures" shows real
 * agent failures with skip events excluded (they are intentional routing). */
export type TrajectoryFilter = "all" | "skips" | "failures";

/** Skip events: the router's skip_provider (future skip_* actions included).
 * Recognizable by action prefix so new skip reasons need no changes here. */
export function isSkipEvent(e: AgentEvent): boolean {
  return typeof e.action === "string" && e.action.startsWith("skip_");
}

/** Adaptive-cap lifecycle events (Task 20): cap_tighten (429 evidence halved
 * the cap) and cap_recover (successes stepped it back up). Informational —
 * neither skips nor failures. */
export function isCapEvent(e: AgentEvent): boolean {
  return typeof e.action === "string" && e.action.startsWith("cap_");
}

/** Real failures: success === false MINUS skip events. A provider being
 * skipped is the router working as designed, not work failing. */
export function isFailureEvent(e: AgentEvent): boolean {
  return e.success === false && !isSkipEvent(e);
}

/** Apply a panel filter to an event list (order preserved). */
export function filterTrajectory(events: AgentEvent[], filter: TrajectoryFilter): AgentEvent[] {
  switch (filter) {
    case "skips":
      return events.filter(isSkipEvent);
    case "failures":
      return events.filter(isFailureEvent);
    default:
      return events;
  }
}

export interface SkipSummary {
  /** Total skip events in the summarized window. */
  total: number;
  /** Count per metadata.reason (e.g. "cooldown", "provider_busy"); events
   * without a string reason land under "other". */
  byReason: Record<string, number>;
}

/** Reason breakdown for a window of events (ignores non-skip events). */
export function summarizeSkips(events: AgentEvent[]): SkipSummary {
  const byReason: Record<string, number> = {};
  let total = 0;
  for (const e of events) {
    if (!isSkipEvent(e)) continue;
    total++;
    const reason = e.metadata?.reason;
    const key = typeof reason === "string" && reason.length > 0 ? reason : "other";
    byReason[key] = (byReason[key] ?? 0) + 1;
  }
  return { total, byReason };
}

function fmtRemaining(remainingMs: unknown): string | null {
  if (typeof remainingMs !== "number" || !Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  return `${Math.max(1, Math.ceil(remainingMs / 1000))}s remaining`;
}

function fmtWaited(waitedMs: unknown): string | null {
  if (typeof waitedMs !== "number" || !Number.isFinite(waitedMs) || waitedMs <= 0) return null;
  return `waited ${(waitedMs / 1000).toFixed(1)}s`;
}

/** One-line human explanation of WHY a provider was skipped, from the
 * structured metadata the router emits. Degrades gracefully when fields
 * are missing (older events, future reasons). */
export function describeSkipReason(e: AgentEvent): string {
  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  const reason = typeof meta.reason === "string" ? meta.reason : "";

  if (reason === "cooldown") {
    const parts: string[] = ["cooldown"];
    if (typeof meta.class === "string" && meta.class) parts.push(meta.class);
    if (typeof meta.layer === "string" && meta.layer) parts.push(meta.layer);
    const rem = fmtRemaining(meta.remainingMs);
    if (rem) parts.push(rem);
    return parts.join(" · ");
  }

  if (reason === "provider_busy") {
    const parts: string[] = ["provider busy"];
    if (typeof meta.inFlight === "number") parts.push(`${meta.inFlight} in-flight`);
    if (typeof meta.cap === "number") parts.push(`cap ${meta.cap}`);
    const waited = fmtWaited(meta.waitedMs);
    if (waited) parts.push(waited);
    return parts.join(" · ");
  }

  // Task 24 — upstream failure-domain diversion: a same-upstream sibling of a
  // 429/quota-blocked provider was skipped before attempting (shared IP-keyed
  // limiter would reject it too). WHY = which upstream, which sibling, how long.
  if (reason === "upstream_quota_divert") {
    const parts: string[] = ["upstream 429 — diverted"];
    if (typeof meta.domain === "string" && meta.domain) parts.push(meta.domain);
    if (typeof meta.blockedBy === "string" && meta.blockedBy) parts.push(`sibling ${meta.blockedBy}`);
    const rem = fmtRemaining(meta.remainingMs);
    if (rem) parts.push(rem);
    return parts.join(" · ");
  }

  if (reason) return `skipped (${reason})`;
  return "skipped";
}
