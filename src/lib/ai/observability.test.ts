// ============================================================================
// Observability tests (directive #46) — structured prefixes + secret redaction
// ============================================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  aiRouteLog,
  aiHealthLog,
  aiBenchmarkLog,
  aiFailoverLog,
  aiConfigLog,
  aiConfigSyncLog,
  pipelineLog,
  supervisorLog,
  agentLog,
  recoveryLog,
  AI_LOG_PREFIXES,
  redact,
} from "./observability";

describe("AI observability prefixes (directive #46)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes all 10 required prefixes", () => {
    for (const prefix of [
      "[AI_ROUTE]", "[AI_HEALTH]", "[AI_BENCHMARK]", "[AI_FAILOVER]", "[AI_CONFIG]",
      "[AI_CONFIG_SYNC]", "[PIPELINE]", "[SUPERVISOR]", "[AGENT]", "[RECOVERY]",
    ]) {
      expect(AI_LOG_PREFIXES).toContain(prefix);
    }
  });

  it("emits structured key=value lines with the right prefix", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    aiRouteLog({ job: "job-1", provider: "ZenCode", model: "m1", status: "locked", authority: "readiness_gate" });
    expect(spy).toHaveBeenCalled();
    const line = spy.mock.calls[0][0] as string;
    expect(line.startsWith("[AI_ROUTE]")).toBe(true);
    expect(line).toContain("job=job-1");
    expect(line).toContain("provider=ZenCode");
    expect(line).toContain("authority=readiness_gate");
  });

  it("warn-level prefixes use console.warn ([AI_FAILOVER], [RECOVERY])", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    aiFailoverLog({ job: "j", agent: "qa", from: "a/x", to: "b/y", reason: "capability_mismatch" });
    expect(spy.mock.calls[0][0]).toContain("[AI_FAILOVER]");
    recoveryLog({ agent: "recovery", status: "engaged" });
    expect(spy.mock.calls[1][0]).toContain("[RECOVERY]");
  });

  it("every helper emits its exact prefix", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    aiHealthLog({});
    aiBenchmarkLog({});
    aiConfigLog({});
    aiConfigSyncLog({});
    pipelineLog({});
    supervisorLog({});
    agentLog({});
    const all = [...info.mock.calls, ...warn.mock.calls].map((c) => c[0] as string);
    expect(all.some((l) => l.startsWith("[AI_HEALTH]"))).toBe(true);
    expect(all.some((l) => l.startsWith("[AI_BENCHMARK]"))).toBe(true);
    expect(all.some((l) => l.startsWith("[AI_CONFIG] "))).toBe(true);
    expect(all.some((l) => l.startsWith("[AI_CONFIG_SYNC]"))).toBe(true);
    expect(all.some((l) => l.startsWith("[PIPELINE]"))).toBe(true);
    expect(all.some((l) => l.startsWith("[SUPERVISOR]"))).toBe(true);
    expect(all.some((l) => l.startsWith("[AGENT]"))).toBe(true);
  });

  it("never logs secrets — credentials are redacted (directive #43)", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    aiConfigLog({
      agent: "supervisor",
      apiKey: "sk-proj-abcdefgh12345678",
      token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      note: "Bearer abcdefgh123456789xyz",
    });
    const line = String(spy.mock.calls[0][0]);
    expect(line).not.toContain("sk-proj-abcdefgh12345678");
    expect(line).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(line).not.toContain("abcdefgh123456789xyz");
    expect(line).toContain("[redacted]");
  });

  it("redact() masks api-key style assignments", () => {
    expect(redact("api_key=supersecretvalue123")).toBe("api_key=[redacted]");
    expect(redact("normal message")).toBe("normal message");
  });

  it("logging never throws on weird input", () => {
    expect(() => aiRouteLog(undefined as any)).not.toThrow();
    expect(() => pipelineLog({ nested: { a: 1 } })).not.toThrow();
  });
});
