// ============================================================================
// Audit Service — tracks all system actions for compliance and debugging
//
// Records who did what, when, and what was the outcome.
// Stored in-memory (capped) + synced to D1 via cloudApiSafe.
// ============================================================================

"use client";

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string; // "user", "system", "repair-scheduler", "circuit-breaker"
  action: string; // e.g., "provider.sync", "pipeline.start", "repair.apply"
  category: "admin" | "pipeline" | "provider" | "repair" | "export" | "auth";
  details: string;
  severity: "info" | "warning" | "error" | "critical";
  metadata?: Record<string, any>;
}

const auditLog: AuditEntry[] = [];
const MAX_ENTRIES = 500;

/**
 * Record an audit entry.
 */
export function audit(opts: {
  actor: string;
  action: string;
  category: AuditEntry["category"];
  details: string;
  severity?: AuditEntry["severity"];
  metadata?: Record<string, any>;
}): void {
  const entry: AuditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    actor: opts.actor,
    action: opts.action,
    category: opts.category,
    details: opts.details,
    severity: opts.severity ?? "info",
    metadata: opts.metadata,
  };

  auditLog.push(entry);
  if (auditLog.length > MAX_ENTRIES) auditLog.shift();

  // Log to console based on severity
  const logMsg = `[Audit] ${entry.severity.toUpperCase()} ${entry.actor} → ${entry.action}: ${entry.details}`;
  switch (entry.severity) {
    case "critical":
      console.error(logMsg);
      break;
    case "error":
      console.error(logMsg);
      break;
    case "warning":
      console.warn(logMsg);
      break;
    default:
      console.info(logMsg);
  }

  // Sync to D1 (non-blocking, non-fatal)
  try {
    import("./store").then(({ useApp }) => {
      useApp.getState().log({
        actor: entry.actor,
        action: entry.action,
        category: entry.category as any,
        details: entry.details,
        severity: entry.severity as any,
      });
    }).catch(() => {});
  } catch { /* non-fatal */ }
}

/**
 * Get all audit entries (newest first).
 */
export function getAuditLog(): AuditEntry[] {
  return [...auditLog].reverse();
}

/**
 * Get audit entries by category.
 */
export function getAuditByCategory(category: AuditEntry["category"]): AuditEntry[] {
  return auditLog.filter((e) => e.category === category).reverse();
}

/**
 * Get audit entries by severity.
 */
export function getAuditBySeverity(severity: AuditEntry["severity"]): AuditEntry[] {
  return auditLog.filter((e) => e.severity === severity).reverse();
}

/**
 * Get recent audit entries.
 */
export function getRecentAudit(count: number = 20): AuditEntry[] {
  return [...auditLog].reverse().slice(0, count);
}

/**
 * Get audit statistics for dashboards.
 */
export function getAuditStats(): {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const entry of auditLog) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;
  }

  return {
    total: auditLog.length,
    byCategory,
    bySeverity,
  };
}

/**
 * Clear audit log — useful for testing.
 */
export function clearAuditLog(): void {
  auditLog.length = 0;
}
