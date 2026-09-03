// ============================================================================
// AI Observability — structured log prefixes (directive #46).
//
// [AI_ROUTE] [AI_HEALTH] [AI_BENCHMARK] [AI_FAILOVER] [AI_CONFIG]
// [AI_CONFIG_SYNC] [PIPELINE] [SUPERVISOR] [AGENT] [RECOVERY]
//
// Rules:
//   - NEVER log secrets (API keys, tokens, provider credentials — dir. #43).
//   - Always key=value so logs are greppable and machine-parsable.
//   - Helpers are safe no-ops when console is unavailable.
// ============================================================================

/** Redact credential-looking substrings (defence in depth with the health
 *  manager's redactSecrets — this one also masks anything after `key=`. */
export function redact(message: string): string {
  return String(message ?? "")
    .replace(/(sk|pk|rk|ghp|gho|github_pat|xoxb|xoxp|AIza)[-_A-Za-z0-9]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|password|secret)(["'\s:=]+)[^\s"',;&]+/gi, "$1$2[redacted]");
}

type Level = "info" | "warn" | "error";

function emit(prefix: string, level: Level, parts: Record<string, unknown> | string, message?: string): void {
  try {
    let line = prefix;
    if (typeof parts === "string") {
      line += ` ${redact(parts)}`;
    } else {
      const kv = Object.entries(parts)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${k}=${typeof v === "string" ? redact(v) : String(v)}`)
        .join(" ");
      line += ` ${kv}`;
      if (message) line += ` :: ${redact(message)}`;
    }
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  } catch {
    /* logging must never throw */
  }
}

export const aiRouteLog = (parts: Record<string, unknown>, msg?: string) => emit("[AI_ROUTE]", "info", parts, msg);
export const aiHealthLog = (parts: Record<string, unknown>, msg?: string) => emit("[AI_HEALTH]", "info", parts, msg);
export const aiBenchmarkLog = (parts: Record<string, unknown>, msg?: string) => emit("[AI_BENCHMARK]", "info", parts, msg);
export const aiFailoverLog = (parts: Record<string, unknown>, msg?: string) => emit("[AI_FAILOVER]", "warn", parts, msg);
export const aiConfigLog = (parts: Record<string, unknown>, msg?: string) => emit("[AI_CONFIG]", "info", parts, msg);
export const aiConfigSyncLog = (parts: Record<string, unknown>, msg?: string) => emit("[AI_CONFIG_SYNC]", "info", parts, msg);
export const pipelineLog = (parts: Record<string, unknown>, msg?: string) => emit("[PIPELINE]", "info", parts, msg);
export const supervisorLog = (parts: Record<string, unknown>, msg?: string) => emit("[SUPERVISOR]", "info", parts, msg);
export const agentLog = (parts: Record<string, unknown>, msg?: string) => emit("[AGENT]", "info", parts, msg);
export const recoveryLog = (parts: Record<string, unknown>, msg?: string) => emit("[RECOVERY]", "warn", parts, msg);

/** All prefixes in one place — tests assert against this list. */
export const AI_LOG_PREFIXES = [
  "[AI_ROUTE]",
  "[AI_HEALTH]",
  "[AI_BENCHMARK]",
  "[AI_FAILOVER]",
  "[AI_CONFIG]",
  "[AI_CONFIG_SYNC]",
  "[PIPELINE]",
  "[SUPERVISOR]",
  "[AGENT]",
  "[RECOVERY]",
] as const;
