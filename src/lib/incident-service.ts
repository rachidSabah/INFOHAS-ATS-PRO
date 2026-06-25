// ============================================================================
// Incident Reporting Service
//
// Generates structured incident reports when failures occur.
// Stored in-memory (capped) for audit trail.
// ============================================================================

"use client";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export interface IncidentReport {
  id: string;
  severity: IncidentSeverity;
  timestamp: string;
  rootCause: string;
  affectedSystems: string[];
  repairActions: string[];
  duration: number; // ms
  rollbackRequired: boolean;
  resolved: boolean;
}

const incidents: IncidentReport[] = [];
const MAX_INCIDENTS = 100;

/**
 * Create and store an incident report.
 */
export function createIncident(opts: {
  severity?: IncidentSeverity;
  rootCause: string;
  affectedSystems: string[];
  repairActions: string[];
  duration?: number;
  rollbackRequired?: boolean;
  resolved?: boolean;
}): IncidentReport {
  const incident: IncidentReport = {
    id: `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    severity: opts.severity ?? "medium",
    timestamp: new Date().toISOString(),
    rootCause: opts.rootCause,
    affectedSystems: opts.affectedSystems,
    repairActions: opts.repairActions,
    duration: opts.duration ?? 0,
    rollbackRequired: opts.rollbackRequired ?? false,
    resolved: opts.resolved ?? true,
  };

  incidents.push(incident);
  if (incidents.length > MAX_INCIDENTS) incidents.shift();

  const logLevel = incident.severity === "critical" ? "error" : "warn";
  console[logLevel](
    `[Incident] ${incident.severity.toUpperCase()} — ${incident.rootCause}. ` +
    `Affected: ${incident.affectedSystems.join(", ")}. ` +
    `Actions: ${incident.repairActions.join(", ")}. ` +
    `Rollback: ${incident.rollbackRequired ? "yes" : "no"}. ` +
    `Resolved: ${incident.resolved ? "yes" : "no"}.`
  );

  return incident;
}

/**
 * Get all incident reports (newest first).
 */
export function getIncidents(): IncidentReport[] {
  return [...incidents].reverse();
}

/**
 * Get incidents by severity.
 */
export function getIncidentsBySeverity(severity: IncidentSeverity): IncidentReport[] {
  return incidents.filter((i) => i.severity === severity);
}

/**
 * Get the last N incidents.
 */
export function getRecentIncidents(count: number = 10): IncidentReport[] {
  return [...incidents].reverse().slice(0, count);
}

/**
 * Get incident statistics for dashboards.
 */
export function getIncidentStats(): {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  rollbackRate: number;
  avgDuration: number;
} {
  const total = incidents.length;
  const critical = incidents.filter((i) => i.severity === "critical").length;
  const high = incidents.filter((i) => i.severity === "high").length;
  const medium = incidents.filter((i) => i.severity === "medium").length;
  const low = incidents.filter((i) => i.severity === "low").length;
  const rollbacks = incidents.filter((i) => i.rollbackRequired).length;
  const totalDuration = incidents.reduce((sum, i) => sum + i.duration, 0);

  return {
    total,
    critical,
    high,
    medium,
    low,
    rollbackRate: total > 0 ? Math.round((rollbacks / total) * 100) : 0,
    avgDuration: total > 0 ? Math.round(totalDuration / total) : 0,
  };
}

/**
 * Clear all incidents — useful for testing.
 */
export function clearIncidents(): void {
  incidents.length = 0;
}
